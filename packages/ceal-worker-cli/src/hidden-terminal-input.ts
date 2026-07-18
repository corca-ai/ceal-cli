// Hidden, character-at-a-time enrollment-code reader for an interactive TTY.
// Extracted from the `bin` composition root so the stdin lifecycle is testable
// without a real pseudo-terminal: `bin` passes the process streams, tests pass a
// fake TTY and assert the handle is released.

/** Structural view of the TTY input stream this reader drives. */
export interface HiddenInputStream {
	isTTY?: boolean;
	isRaw?: boolean;
	setRawMode?(mode: boolean): unknown;
	resume(): unknown;
	pause(): unknown;
	on(event: "data", listener: (chunk: string | Buffer) => void): unknown;
	once(event: "end", listener: () => void): unknown;
	off(event: "data" | "end", listener: (chunk: string | Buffer) => void): unknown;
}

/** Structural view of the status stream the prompt/echo is written to. */
export interface HiddenInputStatusStream {
	isTTY?: boolean;
	write(chunk: string): unknown;
}

export async function readHiddenTerminalEnrollmentCode(
	stdin: HiddenInputStream,
	stderr: HiddenInputStatusStream,
): Promise<string> {
	if (!stdin.isTTY || !stderr.isTTY || typeof stdin.setRawMode !== "function") {
		throw new Error("interactive_enrollment_required");
	}
	const wasRaw = Boolean(stdin.isRaw);
	stderr.write("Device enrollment code (input hidden): ");
	stdin.setRawMode(true);
	stdin.resume();
	return new Promise((resolve, reject) => {
		const state = createHiddenInputState(resolve, reject, stderr);
		const onData = (chunk: string | Buffer): void => acceptHiddenInput(chunk, state);
		const onEnd = (): void => state.fail(new Error("stdin_ended"));
		state.cleanup = () => {
			stdin.off("data", onData);
			stdin.off("end", onEnd);
			stdin.setRawMode?.(wasRaw);
			// Release the stdin handle we resumed above. Without pausing, a resumed
			// TTY stays a ref'd libuv handle and keeps the event loop alive, so
			// `ceal session enroll` never returns to the shell after the code is
			// entered (the operator had to Ctrl-C). Pairing this pause with the
			// resume above lets the process exit once the command finishes.
			stdin.pause();
		};
		stdin.on("data", onData);
		stdin.once("end", onEnd);
	});
}

interface HiddenInputState {
	chunks: Buffer[];
	bytes: number;
	cleanup: () => void;
	finish: () => void;
	fail: (error: Error) => void;
}

function createHiddenInputState(
	resolve: (value: string) => void,
	reject: (reason?: unknown) => void,
	stderr: HiddenInputStatusStream,
): HiddenInputState {
	const state = {} as HiddenInputState;
	state.chunks = [];
	state.bytes = 0;
	state.cleanup = () => undefined;
	state.finish = () => {
		state.cleanup();
		stderr.write("[input hidden]\n");
		resolve(Buffer.concat(state.chunks).toString("utf8"));
	};
	state.fail = (error) => {
		state.cleanup();
		stderr.write("[input hidden]\n");
		reject(error);
	};
	return state;
}

function acceptHiddenInput(chunk: string | Buffer, state: HiddenInputState): void {
	const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
	for (const byte of input) if (handleHiddenInputByte(byte, state)) return;
}

function handleHiddenInputByte(byte: number, state: HiddenInputState): boolean {
	if (byte === 0x03) { state.fail(new Error("input_cancelled")); return true; }
	if (byte === 0x0d || byte === 0x0a) { state.finish(); return true; }
	if (byte === 0x08 || byte === 0x7f) {
		const previous = state.chunks.pop();
		if (previous) state.bytes -= previous.length;
		return false;
	}
	state.bytes += 1;
	if (state.bytes > 4096) { state.fail(new Error("stdin_secret_too_large")); return true; }
	state.chunks.push(Buffer.from([byte]));
	return false;
}
