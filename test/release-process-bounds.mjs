import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBoundedProcess } from "../packages/ceal-worker-cli/dist/bounded-process.js";

export const RELEASE_TEST_PROCESS_TIMEOUT_MS = 120_000;

const DEFAULT_ASYNC_BOUNDS = Object.freeze({
	timeoutMs: RELEASE_TEST_PROCESS_TIMEOUT_MS,
	terminationGraceMs: 1_000,
	postKillReportMs: 1_000,
	postExitDrainMs: 250,
	maxCapturedOutputBytes: 1024 * 1024,
});

export function runSyncReleaseProcess(command, args, options = {}, timeoutMs = RELEASE_TEST_PROCESS_TIMEOUT_MS) {
	const targetEnv = withoutCoverageCollector(options.env ?? process.env);
	const bounds = {
		...DEFAULT_ASYNC_BOUNDS,
		timeoutMs,
		terminationGraceMs: Math.min(DEFAULT_ASYNC_BOUNDS.terminationGraceMs, timeoutMs),
		postKillReportMs: Math.min(DEFAULT_ASYNC_BOUNDS.postKillReportMs, timeoutMs),
		timeoutStartMarker: options.timeoutStartMarker,
		timeoutStartDeadlineMs: options.timeoutStartDeadlineMs,
		cwd: options.cwd ?? process.cwd(),
		env: targetEnv,
	};
	const supervisor = spawnSync(process.execPath, [fileURLToPath(new URL("release-process-supervisor.mjs", import.meta.url))], {
		encoding: "utf8",
		env: withoutCoverageCollector(process.env),
		input: JSON.stringify({ command, args, bounds }),
		killSignal: "SIGKILL",
		maxBuffer: DEFAULT_ASYNC_BOUNDS.maxCapturedOutputBytes * 3,
		timeout: timeoutMs + bounds.terminationGraceMs + bounds.postKillReportMs + bounds.postExitDrainMs + 5_000,
	});
	if (supervisor.error || supervisor.status !== 0) return supervisor;
	const result = JSON.parse(supervisor.stdout);
	const error = result.spawnError
		? Object.assign(new Error(result.spawnError), { code: "SPAWN_ERROR" })
		: result.timedOut
			? Object.assign(new Error(`Release test command timed out: ${command}`), { code: "ETIMEDOUT" })
			: undefined;
	const encode = (value) => (options.encoding ? value : Buffer.from(value));
	return {
		status: result.code,
		signal: result.signal,
		stdout: encode(result.stdout),
		stderr: encode(result.stderr),
		output: [null, encode(result.stdout), encode(result.stderr)],
		error,
		timedOut: result.timedOut,
		truncated: result.truncated,
	};
}

export function runAsyncReleaseProcess(command, args, options, bounds = {}) {
	return runBoundedProcess(command, args, {
		...DEFAULT_ASYNC_BOUNDS,
		...bounds,
		cwd: options.cwd,
		env: withoutCoverageCollector(options.env ?? process.env),
	});
}

function withoutCoverageCollector(env) {
	const clean = { ...env };
	delete clean.NODE_V8_COVERAGE;
	return clean;
}

export function execReleaseTestProcess(command, args, options = {}) {
	const result = runSyncReleaseProcess(command, args, options);
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(`Release test command exited ${result.status}: ${command} ${args.join(" ")}\n${String(result.stderr)}`);
	return result.stdout;
}

export function listReleaseTarEntries(archive, compressed = false) {
	return execReleaseTestProcess("tar", [compressed ? "-tzf" : "-tf", archive], { encoding: "utf8" })
		.trim()
		.split("\n");
}

export function assertReleaseGuideArchive(manifest, outputDirectory, requiredReference) {
	assert.equal(manifest.guide.format, "ustar");
	assert.deepEqual(
		listReleaseTarEntries(path.join(outputDirectory, "ceal-guide.tar")),
		manifest.guide.files.map((file) => file.path),
	);
	assert.ok(manifest.guide.files.some((file) => file.path === requiredReference));
}

export function assertReleaseManifestProvenance(manifest, result, protocolSha256) {
	assert.equal(manifest.artifact.sha256, result.artifact.sha256);
	assert.deepEqual(manifest.client, result.client);
	assert.equal(manifest.protocol.sha256, protocolSha256);
}

export function processIsAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
