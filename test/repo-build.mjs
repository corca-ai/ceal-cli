import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// `npm run build` emits into the checked-out `packages/<name>/dist`, which every
// test process shares. Two fixtures building there at once can let a third read a
// half-written `dist` through `npm pack`, so the release tier was pinned to
// `--test-concurrency=1` to hide the race behind serialization. This is the one
// owner of that build instead: an inter-process directory mutex plus an
// in-process memo, which is what lets the tier run in parallel honestly.
const BUILT = new Set();
const LOCK_ROOT = path.join(REPO_ROOT, "node_modules", ".cache", "ceal-test-build-locks");
// A build is ~2s; a lock older than this belongs to a process that died holding
// it, and waiting for a corpse forever would turn a crash into a hang.
const STALE_LOCK_MS = 120_000;
const WAIT_TIMEOUT_MS = 300_000;

export function ensurePackageBuilt(packagePath) {
	if (BUILT.has(packagePath)) return;
	withBuildLock(packagePath, () => {
		execFileSync("npm", ["run", "build"], { cwd: path.join(REPO_ROOT, packagePath), stdio: "pipe" });
	});
	BUILT.add(packagePath);
}

// Exported so the mutex can be proven against a cheap body instead of only
// against a two-second `tsc` run.
export function withBuildLock(name, run) {
	const lock = path.join(LOCK_ROOT, name.replaceAll(path.sep, "-"));
	acquire(lock);
	try {
		return run();
	} finally {
		rmSync(lock, { recursive: true, force: true });
	}
}

function acquire(lock) {
	mkdirSync(LOCK_ROOT, { recursive: true });
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	for (;;) {
		try {
			// `mkdir` is the atomic test-and-set: it either creates the directory or
			// fails with EEXIST, with no window between the two for a second process.
			mkdirSync(lock);
			writeFileSync(path.join(lock, "owner"), `${process.pid}\n`);
			return;
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			if (breakIfStale(lock)) continue;
			if (Date.now() > deadline) throw new Error(`timed out waiting for the package build lock at ${lock}`);
			sleep(25);
		}
	}
}

function breakIfStale(lock) {
	let age;
	try {
		age = Date.now() - statSync(lock).mtimeMs;
	} catch (error) {
		// The holder released it between our `mkdir` and our `stat`; retrying is the
		// whole recovery.
		if (error.code === "ENOENT") return true;
		throw error;
	}
	if (age < STALE_LOCK_MS) return false;
	let owner = "unknown";
	try {
		owner = readFileSync(path.join(lock, "owner"), "utf8").trim();
	} catch {}
	process.emitWarning(`breaking a package build lock held for ${Math.round(age / 1000)}s by pid ${owner}: ${lock}`);
	rmSync(lock, { recursive: true, force: true });
	return true;
}

function sleep(ms) {
	// The callers are synchronous fixture builders, so this has to block the thread
	// rather than yield to the event loop.
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
