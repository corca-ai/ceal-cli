import { isObjectRecord } from "../scripts/lib/object-record.ts";
import { toolchainEnv } from "../scripts/lib/toolchain-env.ts";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";

type BuildRunner = (packagePath: string) => void;
type DistReader<Result> = () => Result;
type BuildOptions = { readonly buildEnv?: NodeJS.ProcessEnv };
type LockGeneration = ReturnType<typeof statSync>;
type Owner = { pid: number; marker: string };
type LockHandle = { marker: string; generation: LockGeneration };
type SupervisorResult = {
	code: number | null;
	signal: string | null;
	spawnError: string | null;
	stdout: string;
	stderr: string;
	truncated: boolean;
	timedOut: boolean;
	orphaned: boolean;
};
const RESULT_KEYS = ["code", "signal", "spawnError", "stdout", "stderr", "truncated", "timedOut", "orphaned"];

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error;
}

function isSupervisorResult(value: unknown): value is SupervisorResult {
	if (!isObjectRecord(value)) return false;
	const result = value;
	return (
		Object.keys(result).length === RESULT_KEYS.length &&
		RESULT_KEYS.every((key) => Object.hasOwn(result, key)) &&
		(result.code === null || (typeof result.code === "number" && Number.isSafeInteger(result.code))) &&
		(result.signal === null || typeof result.signal === "string") &&
		(result.spawnError === null || typeof result.spawnError === "string") &&
		typeof result.stdout === "string" &&
		typeof result.stderr === "string" &&
		typeof result.truncated === "boolean" &&
		typeof result.timedOut === "boolean" &&
		typeof result.orphaned === "boolean"
	);
}

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
//   - There is ONE lock for the whole workspace, not one per package. It no longer
//     guards the Protocol -- that is an installed artifact now, already built, and
//     nothing here rewrites it -- but the client and the Worker still compile against
//     each other's output, so per-package locks would let one compile read a tree the
//     other is rewriting.
const BUILT = new Set();
const LOCK = path.join(REPO_ROOT, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
const WAIT_TIMEOUT_MS = 600_000;
const BUILD_TIMEOUT_MS = 600_000;
const BUILD_TERMINATION_GRACE_MS = 2_000;
const BUILD_POST_KILL_REPORT_MS = 1_000;
const BUILD_POST_EXIT_DRAIN_MS = 250;
const BUILD_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const BUILD_SUPERVISOR = fileURLToPath(new URL("repo-build-supervisor.ts", import.meta.url));
// A holder writes its owner record immediately after `mkdir`, so a lock that is
// still owner-less this long after its directory was created belongs to a process
// that died in that window. Without this the wait is unbounded in practice: an
// owner-less lock names no pid, so the liveness check can never declare it dead.
const OWNER_WRITE_GRACE_MS = 2_000;

// Run `read` with exclusive access to the workspace `dist`, having first ensured
// every listed package is built. `read` must finish everything it does with
// `dist` before returning — copying out or packing is fine, holding a path to
// come back to later is not.

export function withBuiltPackages<Result>(packagePaths: readonly string[], read: DistReader<Result>, options: BuildOptions = {}): Result {
	const build = options.buildEnv === undefined ? runNpmBuild : (packagePath: string) => runNpmBuild(packagePath, options.buildEnv);
	return withDistLock(() => {
		for (const packagePath of packagePaths) ensurePackageBuilt(packagePath, build);
		return read();
	});
}

// Exported so the memo can be proven against a counter instead of a real `tsc`
// run, which would make the contract tier a writer of the `dist` its sibling
// tests execute.
export function ensurePackageBuilt(packagePath: string, build: BuildRunner = runNpmBuild): boolean {
	const key = path.normalize(packagePath);
	if (BUILT.has(key)) return false;
	build(key);
	BUILT.add(key);
	return true;
}

function runNpmBuild(packagePath: string, baseEnv: NodeJS.ProcessEnv = process.env): void {
	const packageRoot = path.join(REPO_ROOT, packagePath);
	const cache = path.join(REPO_ROOT, "node_modules", ".cache", "ceal-tsbuildinfo", `${path.basename(packagePath)}.tsbuildinfo`);
	// TypeScript trusts an incremental record even if somebody removed its emitted
	// tree. Every repo-owned clean removes the whole directory, so absence is the
	// fail-closed signal that the cache must go with it.
	if (!existsSync(path.join(packageRoot, "dist"))) rmSync(cache, { force: true });
	mkdirSync(path.dirname(cache), { recursive: true });
	const buildEnv = toolchainEnv(baseEnv);
	const result = spawnSync(process.execPath, [BUILD_SUPERVISOR], {
		encoding: "utf8",
		env: buildEnv,
		input: JSON.stringify({
			command: "npm",
			args: ["run", "build", "--", "--incremental", "--tsBuildInfoFile", cache],
			cwd: packageRoot,
			env: buildEnv,
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
	let parsed: unknown;
	try {
		parsed = JSON.parse(result.stdout);
	} catch (error) {
		throw new Error(`build supervisor returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isSupervisorResult(parsed)) throw new Error("build supervisor returned an invalid result");
	const build = parsed;
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
export function withDistLock<Result>(run: () => Result): Result {
	const handle = acquire();
	try {
		return run();
	} finally {
		release(handle);
	}
}

function acquire(): LockHandle {
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

function publishCandidate(): LockHandle | null {
	const nonce = randomBytes(16).toString("hex");
	const candidate = `${LOCK}.candidate-${process.pid}-${nonce}`;
	try {
		mkdirSync(candidate);
		writeFileSync(path.join(candidate, `owner-${nonce}`), `${process.pid}\n`, { flag: "wx" });
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
		return { marker: `owner-${nonce}`, generation: statSync(LOCK) };
	} catch (error: unknown) {
		rmSync(candidate, { recursive: true, force: true });
		if (isNodeError(error) && (error.code === "EEXIST" || error.code === "ENOTEMPTY")) return null;
		throw error;
	}
}

function release(handle: LockHandle): void {
	// A nonce-addressed marker is the ownership proof. If a successor replaced the
	// path, its marker has a different name and this unlink is an ENOENT no-op.
	disposeMarker(handle.marker, handle.generation);
}

function reclaimIfHolderIsGone(): boolean {
	let generation: ReturnType<typeof statSync>;
	try {
		generation = statSync(LOCK);
	} catch (error: unknown) {
		return isNodeError(error) && error.code === "ENOENT";
	}
	if (!generation) return false;
	const owner = readOwner();
	if (owner) {
		if (!processIsGone(owner.pid)) return false;
		return disposeMarker(owner.marker, generation);
	}
	// New holders publish a completed private candidate atomically. An empty
	// visible directory can only be a legacy holder that died before its owner
	// write; rmdir is deliberate because it cannot remove a non-empty successor.
	if (Date.now() - generation.mtimeMs < OWNER_WRITE_GRACE_MS) return false;
	let entries: string[];
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
		} catch (error: unknown) {
			if (!isNodeError(error)) throw error;
			if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error;
			return error.code === "ENOENT";
		}
	}
	// Fixed-owner legacy and unknown non-empty generations are intentionally
	// non-claimable: their marker cannot be unlinked without a successor race.
	return false;
}

function disposeMarker(marker: string, expectedGeneration: LockGeneration): boolean {
	if (!expectedGeneration) return false;
	const markerPath = path.join(LOCK, marker);
	try {
		unlinkSync(markerPath);
	} catch (error: unknown) {
		if (!isNodeError(error)) throw error;
		if (error.code === "ENOENT") return true;
		throw error;
	}
	let retained: LockGeneration;
	try {
		retained = statSync(LOCK);
	} catch (error: unknown) {
		if (isNodeError(error) && error.code === "ENOENT") return true;
		throw error;
	}
	if (retained.dev !== expectedGeneration.dev || retained.ino !== expectedGeneration.ino) return false;
	try {
		rmdirSync(LOCK);
		return true;
	} catch (error: unknown) {
		if (!isNodeError(error)) throw error;
		if (error.code === "ENOENT") return true;
		if (error.code === "ENOTEMPTY" || error.code === "EEXIST") return false;
		throw error;
	}
}

function readOwner(lockPath: string = LOCK): Owner | null {
	let entries: string[];
	try {
		entries = readdirSync(lockPath);
	} catch {
		return null;
	}
	if (entries.length !== 1) return null;
	const [marker] = entries;
	if (!marker || !/^owner-[a-f0-9]{32}$/u.test(marker)) return null;
	let raw: string;
	try {
		raw = readFileSync(path.join(lockPath, marker), "utf8");
	} catch {
		return null;
	}
	const parsedPid = Number(raw.trim());
	return Number.isSafeInteger(parsedPid) && parsedPid > 0 ? { pid: parsedPid, marker } : null;
}

export function processIsGone(pid: number): boolean {
	try {
		// Signal 0 performs the permission and existence checks without delivering a
		// signal, so this asks "is that pid alive" and nothing else.
		process.kill(pid, 0);
		return false;
	} catch (error: unknown) {
		// EPERM means it is alive and owned by somebody else, which is still alive.
		return isNodeError(error) && error.code === "ESRCH";
	}
}

function sleep(ms: number): void {
	// The callers are synchronous fixture builders, so this has to block the thread
	// rather than yield to the event loop.
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const packagePaths = process.argv.slice(2);
	if (packagePaths.length === 0) throw new Error("usage: node test/repo-build.ts <package-path> [...]");
	withBuiltPackages(packagePaths, () => undefined);
}
