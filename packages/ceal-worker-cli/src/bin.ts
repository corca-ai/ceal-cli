#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { renderPlainYamlDocument, runCealCommand } from "./index.js";
import { createCealSessionStore } from "./profile-store.js";

let sessionStore: ReturnType<typeof createCealSessionStore> | undefined;
try { sessionStore = createCealSessionStore(process.env.HOME); } catch { sessionStore = undefined; }

void runCealCommand(process.argv.slice(2), {
	stdout: process.stdout,
	stderr: process.stderr,
}, {
	readSecret: readStdinSecret,
	promptEnrollmentCode: readHiddenTerminalEnrollmentCode,
	isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stderr.isTTY && typeof process.stdin.setRawMode === "function"),
	isInputTerminal: () => Boolean(process.stdin.isTTY),
	loadSession: sessionStore ? () => sessionStore.load() : undefined,
	saveSession: sessionStore ? (session) => sessionStore.save(session) : undefined,
	removeSession: sessionStore ? () => sessionStore.remove() : undefined,
	withSessionStateLock: sessionStore ? (action) => sessionStore.withStateLock(action) : undefined,
	nextRequestId: () => `ceal:${randomUUID()}`,
}).then((code) => {
	process.exitCode = code;
}, () => {
	process.stdout.write(renderPlainYamlDocument({
		schema_version: "ceal.error.v1",
		command: "ceal",
		ok: false,
		status: "error",
		credential_context: "gateway_issued_client_session",
		error: {
			kind: "unexpected_failure",
			message: "The Ceal command could not be completed.",
			next_action: "Retry once, then inspect the installed version and Gateway reachability.",
		},
	}));
	process.exitCode = 3;
});

async function readStdinSecret(): Promise<string> {
	let value = "";
	for await (const chunk of process.stdin) {
		value += String(chunk);
		if (value.length > 4097) throw new Error("stdin_secret_too_large");
	}
	return value.replace(/\r?\n$/u, "");
}

async function readHiddenTerminalEnrollmentCode(): Promise<string> {
	if (!process.stdin.isTTY || !process.stderr.isTTY || typeof process.stdin.setRawMode !== "function") {
		throw new Error("interactive_enrollment_required");
	}
	const wasRaw = process.stdin.isRaw;
	process.stderr.write("Device enrollment code (input hidden): ");
	process.stdin.setRawMode(true);
	process.stdin.resume();
	return new Promise((resolve, reject) => {
		const state = createHiddenInputState(resolve, reject);
		const onData = (chunk: string | Buffer) => acceptHiddenInput(chunk, state);
		const onEnd = () => state.fail(new Error("stdin_ended"));
		state.cleanup = () => {
			process.stdin.off("data", onData);
			process.stdin.off("end", onEnd);
			process.stdin.setRawMode(wasRaw);
		};
		process.stdin.on("data", onData);
		process.stdin.once("end", onEnd);
	});
}

interface HiddenInputState {
	chunks: Buffer[];
	bytes: number;
	cleanup: () => void;
	finish: () => void;
	fail: (error: Error) => void;
}

function createHiddenInputState(resolve: (value: string) => void, reject: (reason?: unknown) => void): HiddenInputState {
	const state = {} as HiddenInputState;
	state.chunks = [];
	state.bytes = 0;
	state.cleanup = () => undefined;
	state.finish = () => {
		state.cleanup();
		process.stderr.write("[input hidden]\n");
		resolve(Buffer.concat(state.chunks).toString("utf8"));
	};
	state.fail = (error) => {
		state.cleanup();
		process.stderr.write("[input hidden]\n");
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
