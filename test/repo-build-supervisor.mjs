import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const payload = JSON.parse(readFileSync(0, "utf8"));
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
let exitCode = null;
let exitSignal = null;
const timers = [];

function after(delay, action) {
	const timer = setTimeout(action, delay);
	timers.push(timer);
}

function signalGroup(signal) {
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
	} catch (error) {
		return error.code === "EPERM";
	}
}

function settle(spawnError = null) {
	if (settled) return;
	settled = true;
	for (const timer of timers) clearTimeout(timer);
	child.stdout.destroy();
	child.stderr.destroy();
	child.unref();
	process.stdout.write(JSON.stringify({ code: exitCode, signal: exitSignal, spawnError, stdout, stderr, truncated, timedOut, orphaned }));
}

function killAndReport() {
	signalGroup("SIGKILL");
	after(payload.postKillReportMs, () => settle());
}

function expire() {
	if (settled || timedOut) return;
	timedOut = true;
	signalGroup("SIGTERM");
	after(payload.terminationGraceMs, killAndReport);
}

function capture(stream, chunk) {
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
