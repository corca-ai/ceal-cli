import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { toolchainEnv } from "../scripts/lib/toolchain-env.ts";

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
const BUILD_TIMEOUT_MS = 600_000;
const BUILD_TERMINATION_GRACE_MS = 2_000;
const BUILD_POST_KILL_REPORT_MS = 1_000;
const BUILD_POST_EXIT_DRAIN_MS = 250;
const BUILD_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const BUILD_SUPERVISOR = fileURLToPath(new URL("repo-build-supervisor.mjs", import.meta.url));
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
		for (const packagePath of packagePaths) ensurePackageBuilt(packagePath);
		return read();
	});
}

// Exported so the memo can be proven against a counter instead of a real `tsc`
// run, which would make the contract tier a writer of the `dist` its sibling
// tests execute.
export function ensurePackageBuilt(packagePath, build = runNpmBuild) {
	const key = path.normalize(packagePath);
	if (BUILT.has(key)) return false;
	build(key);
	BUILT.add(key);
	return true;
}

function runNpmBuild(packagePath) {
	const packageRoot = path.join(REPO_ROOT, packagePath);
	const cache = path.join(REPO_ROOT, "node_modules", ".cache", "ceal-tsbuildinfo", `${path.basename(packagePath)}.tsbuildinfo`);
	// TypeScript trusts an incremental record even if somebody removed its emitted
	// tree. Every repo-owned clean removes the whole directory, so absence is the
	// fail-closed signal that the cache must go with it.
	if (!existsSync(path.join(packageRoot, "dist"))) rmSync(cache, { force: true });
	mkdirSync(path.dirname(cache), { recursive: true });
	const result = spawnSync(process.execPath, [BUILD_SUPERVISOR], {
		encoding: "utf8",
		env: toolchainEnv(),
		input: JSON.stringify({
			command: "npm",
			args: ["run", "build", "--", "--incremental", "--tsBuildInfoFile", cache],
			cwd: packageRoot,
			env: toolchainEnv(),
			timeoutMs: BUILD_TIMEOUT_MS,
			terminationGraceMs: BUILD_TERMINATION_GRACE_MS,
			postKillReportMs: BUILD_POST_KILL_REPORT_MS,
			postExitDrainMs: BUILD_POST_EXIT_DRAIN_MS,
			maxCapturedOutputBytes: BUILD_MAX_OUTPUT_BYTES,
		}),
		killSignal: "SIGKILL",
		// JSON escaping can expand a captured control byte to six output bytes.
		maxBuffer: BUILD_MAX_OUTPUT_BYTES * 8,
		timeout: BUILD_TIMEOUT_MS + BUILD_TERMINATION_GRACE_MS + BUILD_POST_KILL_REPORT_MS + BUILD_POST_EXIT_DRAIN_MS + 5_000,
	});
	if (result.error || result.status !== 0) throw result.error ?? new Error(`build supervisor exited ${result.status}: ${result.stderr}`);
	const build = JSON.parse(result.stdout);
	if (build.spawnError || build.timedOut || build.truncated || build.orphaned || build.code !== 0) {
		const reason = build.spawnError
			? `could not start (${build.spawnError})`
			: build.timedOut
				? "timed out"
				: build.truncated
					? "exceeded its output bound"
					: build.orphaned
						? "left a descendant running"
						: `exited ${build.code}${build.signal ? ` on ${build.signal}` : ""}`;
		throw new Error(`workspace package build ${reason}: ${packagePath}\n${build.stderr || build.stdout}`);
	}
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
	const deadline = performance.now() + WAIT_TIMEOUT_MS;
	for (;;) {
		const nonce = publishCandidate();
		if (nonce) return nonce;
		// Liveness, not elapsed time, decides whether a lock is abandoned. A wall
		// clock cannot tell a slow compile on a loaded runner from a dead holder,
		// and breaking a live holder recreates the double-writer state this lock
		// exists to prevent. `local-store-lock.ts` reaches the same conclusion.
		const reclaimed = reclaimIfHolderIsGone();
		// Always perform one liveness check after a failed acquisition, even when
		// filesystem scheduling consumed the wait deadline. The deadline bounds
		// waiting for a live holder; it must not shadow a dead-holder reclamation.
		// A successful reclaim earns one immediate acquisition attempt even when the
		// deadline elapsed while inspecting or quarantining that stale generation.
		if (reclaimed) continue;
		if (performance.now() > deadline) throw new Error(`timed out waiting for the workspace dist lock at ${LOCK}`);
		sleep(25);
	}
}

function publishCandidate() {
	const nonce = randomBytes(16).toString("hex");
	const candidate = `${LOCK}.candidate-${process.pid}-${nonce}`;
	try {
		mkdirSync(candidate);
		writeFileSync(path.join(candidate, "owner"), `${process.pid} ${nonce}\n`, { flag: "wx" });
	} catch (error) {
		rmSync(candidate, { recursive: true, force: true });
		throw error;
	}
	try {
		// POSIX rename may replace an existing empty directory. Refuse that
		// cross-version legacy state here so the grace/reclaim path decides it.
		// A legacy holder can still appear between this check and rename; current
		// candidates are non-empty, so same-version contenders remain atomic.
		if (existsSync(LOCK)) {
			rmSync(candidate, { recursive: true, force: true });
			return null;
		}
		renameSync(candidate, LOCK);
		return nonce;
	} catch (error) {
		rmSync(candidate, { recursive: true, force: true });
		if (error.code === "EEXIST" || error.code === "ENOTEMPTY") return null;
		throw error;
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
	let generation;
	try {
		generation = statSync(LOCK);
	} catch (error) {
		return error.code === "ENOENT";
	}
	const owner = readOwner();
	if (owner) {
		if (!processIsGone(owner.pid)) return false;
		return quarantineGeneration(generation, owner.nonce, `dead pid ${owner.pid}`);
	}
	// New holders publish a completed private candidate atomically. An empty
	// visible directory can only be a legacy holder that died before its owner
	// write; rmdir is deliberate because it cannot remove a non-empty successor.
	if (Date.now() - generation.mtimeMs < OWNER_WRITE_GRACE_MS) return false;
	let entries;
	try {
		entries = readdirSync(LOCK);
	} catch {
		return false;
	}
	if (entries.length === 0) {
		try {
			rmdirSync(LOCK);
			process.emitWarning(`reclaiming the workspace dist lock from a legacy owner-less holder: ${LOCK}`);
			return true;
		} catch (error) {
			if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error;
			return error.code === "ENOENT";
		}
	}
	return quarantineGeneration(
		generation,
		`invalid-${generation.dev.toString(16)}-${generation.ino.toString(16)}`,
		"an invalid owner generation",
	);
}

function quarantineGeneration(generation, suffix, reason) {
	const tombstone = `${LOCK}.reclaimed-${suffix}`;
	try {
		renameSync(LOCK, tombstone);
		process.emitWarning(`reclaiming the workspace dist lock from ${reason}: ${LOCK}`);
		return true;
	} catch (error) {
		if (error.code === "ENOENT") return true;
		if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
	}
	const retained = statSync(tombstone);
	if (retained.dev !== generation.dev || retained.ino !== generation.ino) {
		throw new Error(`workspace dist lock tombstone identity mismatch at ${tombstone}`);
	}
	return true;
}

function readOwner(lockPath = LOCK) {
	let raw;
	try {
		raw = readFileSync(path.join(lockPath, "owner"), "utf8");
	} catch {
		return null;
	}
	const parts = raw.trim().split(" ");
	if (parts.length !== 2) return null;
	const [pid, nonce] = parts;
	const parsedPid = Number(pid);
	return Number.isSafeInteger(parsedPid) && parsedPid > 0 && /^[a-f0-9]{32}$/u.test(nonce ?? "") ? { pid: parsedPid, nonce } : null;
}

export function processIsGone(pid) {
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const packagePaths = process.argv.slice(2);
	if (packagePaths.length === 0) throw new Error("usage: node test/repo-build.mjs <package-path> [...]");
	withBuiltPackages(packagePaths, () => undefined);
}
