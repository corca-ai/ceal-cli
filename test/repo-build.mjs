import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { toolchainEnv } from "../scripts/lib/toolchain-env.mjs";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// `npm run build` emits into the checked-out `packages/<name>/dist`, which every
// test process shares, and the fixtures then *read* that same tree back through
// `npm pack` or `cpSync`. The release tier was pinned to `--test-concurrency=1`
// to hide the resulting race. This module is the alternative: one owner for both
// halves, so the tier can run in parallel without a writer landing in the middle
// of somebody else's read.
//
// Two things about the shape are load-bearing:
//
//   - The lock spans the read, not just the build. Guarding only the build leaves
//     exactly the original race — a process releases, starts packing, and the next
//     process's `tsc` truncates the files being packed.
//   - There is ONE lock for the whole workspace, not one per package. `tsc` for
//     `ceal-client` resolves `@corca-ai/ceal-protocol` through the workspace link
//     into `packages/ceal-protocol/dist`, so per-package locks would let the
//     client's compile read a tree the protocol's compile is rewriting.
const BUILT = new Set();
const LOCK = path.join(REPO_ROOT, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
const WAIT_TIMEOUT_MS = 600_000;
// A holder writes its owner record immediately after `mkdir`, so a lock that is
// still owner-less this long after its directory was created belongs to a process
// that died in that window. Without this the wait is unbounded in practice: an
// owner-less lock names no pid, so the liveness check can never declare it dead.
const OWNER_WRITE_GRACE_MS = 2_000;

// Run `read` with exclusive access to the workspace `dist`, having first ensured
// every listed package is built. `read` must finish everything it does with
// `dist` before returning — copying out or packing is fine, holding a path to
// come back to later is not.
export function withBuiltPackages(packagePaths, read) {
	return withDistLock(() => {
		for (const packagePath of packagePaths) ensureBuilt(packagePath);
		return read();
	});
}

// Exported so the memo can be proven against a counter instead of a real `tsc`
// run, which would make the contract tier a writer of the `dist` its sibling
// tests execute.
export function ensureBuilt(packagePath, build = runNpmBuild) {
	const key = path.normalize(packagePath);
	if (BUILT.has(key)) return false;
	build(key);
	BUILT.add(key);
	return true;
}

function runNpmBuild(packagePath) {
	execFileSync("npm", ["run", "build"], { cwd: path.join(REPO_ROOT, packagePath), stdio: "pipe", env: toolchainEnv() });
}

// Exported so the mutex can be proven against a cheap body instead of only
// against a multi-second compile.
export function withDistLock(run) {
	const nonce = acquire();
	try {
		return run();
	} finally {
		release(nonce);
	}
}

function acquire() {
	mkdirSync(path.dirname(LOCK), { recursive: true });
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	for (;;) {
		const nonce = randomBytes(16).toString("hex");
		try {
			// `mkdir` is the atomic test-and-set: it either creates the directory or
			// fails with EEXIST, with no window between the two for a second process.
			mkdirSync(LOCK);
			writeFileSync(path.join(LOCK, "owner"), `${process.pid} ${nonce}\n`);
			return nonce;
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			if (Date.now() > deadline) throw new Error(`timed out waiting for the workspace dist lock at ${LOCK}`);
			// Liveness, not elapsed time, decides whether a lock is abandoned. A wall
			// clock cannot tell a slow compile on a loaded runner from a dead holder,
			// and breaking a live holder recreates the double-writer state this lock
			// exists to prevent. `local-store-lock.ts` reaches the same conclusion.
			reclaimIfHolderIsGone();
			sleep(25);
		}
	}
}

function release(nonce) {
	// Only the owner may delete the lock. Without this check a process whose lock
	// was reclaimed as stale would go on to delete its *successor's* lock, handing
	// the mutex to a third process while the second is still inside it.
	if (readOwner()?.nonce !== nonce) return;
	rmSync(LOCK, { recursive: true, force: true });
}

function reclaimIfHolderIsGone() {
	const owner = readOwner();
	if (owner) {
		if (!processIsGone(owner.pid)) return;
		reclaim(`dead pid ${owner.pid}`);
		return;
	}
	// No readable owner record: either the holder is between its `mkdir` and its
	// `writeFileSync` right now, or it died in that window. Age is what separates
	// the two, and reading the directory's own mtime rather than a per-waiter timer
	// is deliberate — every waiter then agrees about which lock is the stale one,
	// so two of them cannot each reclaim and delete the other's replacement.
	let age;
	try {
		age = Date.now() - statSync(LOCK).mtimeMs;
	} catch {
		return;
	}
	if (age < OWNER_WRITE_GRACE_MS) return;
	reclaim("a holder that died before recording itself");
}

function reclaim(reason) {
	process.emitWarning(`reclaiming the workspace dist lock from ${reason}: ${LOCK}`);
	rmSync(LOCK, { recursive: true, force: true });
}

function readOwner() {
	let raw;
	try {
		raw = readFileSync(path.join(LOCK, "owner"), "utf8");
	} catch {
		return null;
	}
	const [pid, nonce] = raw.trim().split(" ");
	return Number.isInteger(Number(pid)) && nonce ? { pid: Number(pid), nonce } : null;
}

function processIsGone(pid) {
	try {
		// Signal 0 performs the permission and existence checks without delivering a
		// signal, so this asks "is that pid alive" and nothing else.
		process.kill(pid, 0);
		return false;
	} catch (error) {
		// EPERM means it is alive and owned by somebody else, which is still alive.
		return error.code === "ESRCH";
	}
}

function sleep(ms) {
	// The callers are synchronous fixture builders, so this has to block the thread
	// rather than yield to the event loop.
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
