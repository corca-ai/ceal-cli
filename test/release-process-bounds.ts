import {
	type BoundedProcessOptions,
	type BoundedProcessResult,
	runBoundedProcess,
} from "../packages/ceal-worker-cli/src/bounded-process.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants as osConstants } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_TEST_PROCESS_TIMEOUT_MS = 120_000;

const DEFAULT_ASYNC_BOUNDS: Omit<BoundedProcessOptions, "cwd" | "env"> = Object.freeze({
	timeoutMs: RELEASE_TEST_PROCESS_TIMEOUT_MS,
	terminationGraceMs: 1_000,
	postKillReportMs: 1_000,
	postExitDrainMs: 250,
	maxCapturedOutputBytes: 1024 * 1024,
});

export interface ReleaseProcessOptions {
	encoding?: BufferEncoding;
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	timeoutStartMarker?: string;
	timeoutStartDeadlineMs?: number;
}

export interface ReleaseProcessResult {
	status: number | null;
	signal: NodeJS.Signals | null;
	stdout: string | Buffer;
	stderr: string | Buffer;
	output: [null, string | Buffer, string | Buffer];
	error?: (Error & { code?: string | undefined }) | undefined;
	timedOut: boolean;
	truncated: boolean;
}

export function runSyncReleaseProcess(
	command: string,
	args: readonly string[],
	options: ReleaseProcessOptions = {},
	timeoutMs = RELEASE_TEST_PROCESS_TIMEOUT_MS,
	supervisorSlackMs = 5_000,
): ReleaseProcessResult {
	const targetEnv = releaseTestEnv(options.env ?? process.env);
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
	const supervisor = spawnSync(process.execPath, [fileURLToPath(new URL("release-process-supervisor.ts", import.meta.url))], {
		encoding: "utf8",
		env: releaseTestEnv(process.env),
		input: JSON.stringify({ command, args, bounds }),
		killSignal: "SIGKILL",
		maxBuffer: DEFAULT_ASYNC_BOUNDS.maxCapturedOutputBytes * 3,
		timeout:
			Math.max(timeoutMs, options.timeoutStartDeadlineMs ?? timeoutMs) +
			bounds.terminationGraceMs +
			bounds.postKillReportMs +
			bounds.postExitDrainMs +
			supervisorSlackMs,
	});
	if (supervisor.error || supervisor.status !== 0) {
		const stdout = supervisor.stdout ?? "";
		const stderr = supervisor.stderr ?? "";
		return {
			status: supervisor.status,
			signal: supervisor.signal,
			stdout,
			stderr,
			output: [null, stdout, stderr],
			error: supervisor.error,
			timedOut: false,
			truncated: false,
		};
	}
	const result = parseBoundedProcessResult(JSON.parse(supervisor.stdout));
	const error = result.spawnError
		? Object.assign(new Error(result.spawnError), { code: "SPAWN_ERROR" })
		: result.timedOut
			? Object.assign(new Error(`Release test command timed out: ${command}`), { code: "ETIMEDOUT" })
			: undefined;
	const encode = (value: string): string | Buffer => (options.encoding ? value : Buffer.from(value));
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

function parseBoundedProcessResult(value: unknown): BoundedProcessResult {
	const record =
		typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
	if (!record) throw new Error("release process supervisor returned a non-object result");
	const code = record.code;
	const signal = record.signal;
	if ((code !== null && typeof code !== "number") || (signal !== null && (typeof signal !== "string" || !isNodeSignal(signal))))
		throw new Error("release process supervisor returned invalid exit status");
	if (
		(record.spawnError !== null && typeof record.spawnError !== "string") ||
		typeof record.stdout !== "string" ||
		typeof record.stderr !== "string"
	)
		throw new Error("release process supervisor returned invalid output");
	if (typeof record.truncated !== "boolean" || typeof record.timedOut !== "boolean")
		throw new Error("release process supervisor returned invalid status flags");
	return {
		code,
		signal: signal === null ? null : signal,
		spawnError: record.spawnError,
		stdout: record.stdout,
		stderr: record.stderr,
		truncated: record.truncated,
		timedOut: record.timedOut,
	};
}

function isNodeSignal(value: string): value is NodeJS.Signals {
	// Source-backing process behavior gives fresh checkouts feedback without a dist build;
	// emitted artifact proof remains a separate build/release boundary.
	const signalNumbers = new Set(Object.values(osConstants.signals).filter((number): number is number => typeof number === "number"));
	return Object.entries(osConstants.signals).some(([name, number]) => name === value && signalNumbers.has(number));
}

export function runAsyncReleaseProcess(
	command: string,
	args: readonly string[],
	options: Pick<ReleaseProcessOptions, "cwd" | "env">,
	bounds: Partial<Omit<BoundedProcessOptions, "cwd" | "env">> = {},
): Promise<BoundedProcessResult> {
	return runBoundedProcess(command, args, {
		...DEFAULT_ASYNC_BOUNDS,
		...bounds,
		cwd: options.cwd ?? process.cwd(),
		env: releaseTestEnv(options.env ?? process.env),
	});
}

function releaseTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const clean = { ...env };
	// These children prove untrusted historical installers and native artifacts.
	// They need ordinary tool paths, never the parent CI job's credential surface.
	delete clean.NODE_V8_COVERAGE;
	delete clean.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
	delete clean.ACTIONS_ID_TOKEN_REQUEST_URL;
	delete clean.ACTIONS_RUNTIME_TOKEN;
	delete clean.GITHUB_TOKEN;
	return clean;
}

export function execReleaseTestProcess(command: string, args: readonly string[], options: ReleaseProcessOptions = {}): string | Buffer {
	const result = runSyncReleaseProcess(command, args, options);
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(`Release test command exited ${result.status}: ${command} ${args.join(" ")}\n${String(result.stderr)}`);
	return result.stdout;
}

export function listReleaseTarEntries(archive: string, compressed = false): string[] {
	return String(execReleaseTestProcess("tar", [compressed ? "-tzf" : "-tf", archive], { encoding: "utf8" }))
		.trim()
		.split("\n");
}

export function assertReleaseGuideArchive(
	manifest: { guide: { format: string; files: Array<{ path: string }> } },
	outputDirectory: string,
	requiredReference: string,
): void {
	assert.equal(manifest.guide.format, "ustar");
	assert.deepEqual(
		listReleaseTarEntries(path.join(outputDirectory, "ceal-guide.tar")),
		manifest.guide.files.map((file) => file.path),
	);
	assert.ok(manifest.guide.files.some((file) => file.path === requiredReference));
}

export function assertReleaseManifestProvenance(
	manifest: { artifact: { sha256: string }; client: unknown; protocol: { sha256: string } },
	result: { artifact: { sha256: string }; client: unknown },
	protocolSha256: string,
): void {
	assert.equal(manifest.artifact.sha256, result.artifact.sha256);
	assert.deepEqual(manifest.client, result.client);
	assert.equal(manifest.protocol.sha256, protocolSha256);
}

export function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
