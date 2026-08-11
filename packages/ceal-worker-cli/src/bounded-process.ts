import { spawn } from "node:child_process";

export interface BoundedProcessOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	timeoutMs: number;
	terminationGraceMs: number;
	postKillReportMs: number;
	postExitDrainMs: number;
	maxCapturedOutputBytes: number;
}

export interface BoundedProcessResult {
	code: number | null;
	signal: NodeJS.Signals | null;
	spawnError: string | null;
	stdout: string;
	stderr: string;
	truncated: boolean;
	timedOut: boolean;
}

/** Run one process tree with bounded time, output, termination, and pipe drain. */
export async function runBoundedProcess(
	command: string,
	args: readonly string[],
	options: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
	return new Promise((resolveResult) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		let stdout = "";
		let stderr = "";
		let capturedBytes = 0;
		let truncated = false;
		let timedOut = false;
		let settled = false;
		let exitCode: number | null = null;
		let exitSignal: NodeJS.Signals | null = null;
		let spawnError: string | null = null;
		const timers: NodeJS.Timeout[] = [];
		const settle = (code: number | null, signal: NodeJS.Signals | null = exitSignal) => {
			if (settled) return;
			settled = true;
			for (const timer of timers) clearTimeout(timer);
			child.stdout.destroy();
			child.stderr.destroy();
			child.unref();
			resolveResult({ code, signal, spawnError, stdout, stderr, truncated, timedOut });
		};
		const after = (delay: number, action: () => void) => {
			const timer = setTimeout(action, delay);
			timer.unref();
			timers.push(timer);
		};
		after(options.timeoutMs, () => {
			timedOut = true;
			signalGroup(child, "SIGTERM");
			after(options.terminationGraceMs, () => {
				signalGroup(child, "SIGKILL");
				after(options.postKillReportMs, () => settle(null));
			});
		});
		const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
			if (truncated) return;
			if (capturedBytes + chunk.byteLength > options.maxCapturedOutputBytes) {
				truncated = true;
				signalGroup(child, "SIGKILL");
				after(options.postKillReportMs, () => settle(null));
				return;
			}
			capturedBytes += chunk.byteLength;
			const next = (stream === "stdout" ? stdout : stderr) + chunk.toString("utf8");
			if (stream === "stdout") stdout = next;
			else stderr = next;
		};
		child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
		child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));
		child.on("error", (error) => {
			spawnError = error instanceof Error ? error.message : String(error);
			settle(null);
		});
		child.on("exit", (code, signal) => {
			exitCode = code;
			exitSignal = signal;
			after(options.postExitDrainMs, () => settle(exitCode));
		});
		child.on("close", (code, signal) => settle(code, signal));
	});
}

function signalGroup(child: ReturnType<typeof spawn>, signal: "SIGTERM" | "SIGKILL"): void {
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
