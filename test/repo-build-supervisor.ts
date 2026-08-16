import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

type SupervisorRequest = {
	command: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	timeoutMs: number;
	terminationGraceMs: number;
	postKillReportMs: number;
	postExitDrainMs: number;
	maxCapturedOutputBytes: number;
};
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
const REQUEST_KEYS = [
	"command",
	"args",
	"cwd",
	"env",
	"timeoutMs",
	"terminationGraceMs",
	"postKillReportMs",
	"postExitDrainMs",
	"maxCapturedOutputBytes",
];
const MAX_TIMEOUT_MS = 86_400_000;
const MAX_GRACE_MS = 600_000;
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const present = Object.keys(value);
	return present.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isBoundedInteger(value: unknown, maximum: number, allowZero: boolean): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0) && value <= maximum;
}

function isSupervisorRequest(value: unknown): value is SupervisorRequest {
	if (!isRecord(value)) return false;
	const request = value;
	return (
		hasExactKeys(request, REQUEST_KEYS) &&
		typeof request.command === "string" &&
		request.command.length > 0 &&
		Array.isArray(request.args) &&
		request.args.every((arg) => typeof arg === "string") &&
		typeof request.cwd === "string" &&
		request.cwd.length > 0 &&
		typeof request.env === "object" &&
		request.env !== null &&
		!Array.isArray(request.env) &&
		Object.values(request.env).every((entry) => typeof entry === "string" || entry === undefined) &&
		isBoundedInteger(request.timeoutMs, MAX_TIMEOUT_MS, false) &&
		isBoundedInteger(request.terminationGraceMs, MAX_GRACE_MS, true) &&
		isBoundedInteger(request.postKillReportMs, MAX_GRACE_MS, true) &&
		isBoundedInteger(request.postExitDrainMs, MAX_GRACE_MS, true) &&
		isBoundedInteger(request.maxCapturedOutputBytes, MAX_CAPTURED_OUTPUT_BYTES, false)
	);
}

let payload: SupervisorRequest;
try {
	const parsed: unknown = JSON.parse(readFileSync(0, "utf8"));
	if (!isSupervisorRequest(parsed)) throw new Error("invalid supervisor request");
	payload = parsed;
} catch (error: unknown) {
	process.stderr.write(`invalid build supervisor request: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
	throw error;
}
// The toolchain is repo-owned and must stay in this detached process group. A
// process that deliberately creates a new session is outside this supervisor's
// containment contract; ordinary npm/tsc descendants inherit this group.
const child = spawn(payload.command, payload.args, {
	cwd: payload.cwd,
	env: payload.env,
	stdio: ["ignore", "pipe", "pipe"],
	detached: true,
});
let stdout = "";
let stderr = "";
let capturedBytes = 0;
let truncated = false;
let timedOut = false;
let orphaned = false;
let settled = false;
let exitCode: number | null = null;
let exitSignal: NodeJS.Signals | null = null;
const timers: ReturnType<typeof setTimeout>[] = [];

function after(delay: number, action: () => void): void {
	const timer = setTimeout(action, delay);
	timers.push(timer);
}

function signalGroup(signal: NodeJS.Signals): void {
	try {
		if (child.pid !== undefined) process.kill(-child.pid, signal);
	} catch {
		try {
			child.kill(signal);
		} catch {
			/* Already gone. */
		}
	}
}

function processGroupAlive() {
	if (child.pid === undefined) return false;
	try {
		process.kill(-child.pid, 0);
		return true;
	} catch (error: unknown) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}

function settle(spawnError: string | null = null): void {
	if (settled) return;
	settled = true;
	for (const timer of timers) clearTimeout(timer);
	child.stdout.destroy();
	child.stderr.destroy();
	child.unref();
	const result: SupervisorResult = { code: exitCode, signal: exitSignal, spawnError, stdout, stderr, truncated, timedOut, orphaned };
	process.stdout.write(JSON.stringify(result));
}

function killAndReport(): void {
	signalGroup("SIGKILL");
	after(payload.postKillReportMs, () => settle());
}

function expire(): void {
	if (settled || timedOut) return;
	timedOut = true;
	signalGroup("SIGTERM");
	after(payload.terminationGraceMs, killAndReport);
}

function capture(stream: "stdout" | "stderr", chunk: Buffer): void {
	if (truncated) return;
	if (capturedBytes + chunk.byteLength > payload.maxCapturedOutputBytes) {
		truncated = true;
		killAndReport();
		return;
	}
	capturedBytes += chunk.byteLength;
	if (stream === "stdout") stdout += chunk.toString("utf8");
	else stderr += chunk.toString("utf8");
}

child.stdout.on("data", (chunk) => capture("stdout", chunk));
child.stderr.on("data", (chunk) => capture("stderr", chunk));
child.on("error", (error) => settle(error instanceof Error ? error.message : String(error)));
child.on("exit", (code, signal) => {
	exitCode = code;
	exitSignal = signal;
	if (timedOut) return;
	after(payload.postExitDrainMs, () => {
		if (!processGroupAlive()) return settle();
		orphaned = true;
		killAndReport();
	});
});
child.on("close", (code, signal) => {
	exitCode = code;
	exitSignal = signal;
	if (!timedOut && !orphaned && !processGroupAlive()) settle();
});

after(payload.timeoutMs, expire);
