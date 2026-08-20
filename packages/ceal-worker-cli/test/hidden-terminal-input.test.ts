import { readHiddenTerminalEnrollmentCode } from "../dist/hidden-terminal-input.js";
import type { HiddenInputStatusStream, HiddenInputStream } from "../src/hidden-terminal-input.js";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

type DataListener = (chunk: string | Buffer) => void;
type EndListener = () => void;
type FakeTtyOverrides = Partial<Pick<HiddenInputStream, "isTTY" | "isRaw">>;

interface FakeTtyCalls {
	resume: number;
	pause: number;
	setRawMode: boolean[];
}

interface FakeTty extends HiddenInputStream {
	_calls: FakeTtyCalls;
	_listeners: { data: DataListener[]; end: EndListener[] };
	emit(event: "data", ...args: [string | Buffer]): void;
	emit(event: "end"): void;
}

function isDataListener(event: "data" | "end", _listener: DataListener | EndListener): _listener is DataListener {
	return event === "data";
}

// A structural stand-in for a raw-mode TTY stream that records the lifecycle
// calls a real `process.stdin` would receive, so the handle-release contract is
// testable without allocating a pseudo-terminal.
class FakeTtyStream implements FakeTty {
	isTTY = true;
	isRaw = false;
	readonly _calls: FakeTtyCalls = { resume: 0, pause: 0, setRawMode: [] };
	readonly _listeners: FakeTty["_listeners"] = { data: [], end: [] };

	constructor(overrides: FakeTtyOverrides = {}) {
		if (overrides.isTTY !== undefined) this.isTTY = overrides.isTTY;
		if (overrides.isRaw !== undefined) this.isRaw = overrides.isRaw;
	}

	setRawMode(mode: boolean): void {
		this._calls.setRawMode.push(mode);
		this.isRaw = mode;
	}

	resume(): void {
		this._calls.resume += 1;
	}

	pause(): void {
		this._calls.pause += 1;
	}

	on(event: "data", fn: DataListener): void;
	on(event: "end", fn: EndListener): void;
	on(event: "data" | "end", fn: DataListener | EndListener): void {
		if (isDataListener(event, fn)) this._listeners.data.push(fn);
		else this._listeners.end.push(fn);
	}

	once(_event: "end", fn: EndListener): void {
		this._listeners.end.push(fn);
	}

	off(event: "data", fn: DataListener): void;
	off(event: "end", fn: EndListener): void;
	off(event: "data" | "end", fn: DataListener | EndListener): void {
		if (isDataListener(event, fn)) this._listeners.data = this._listeners.data.filter((listener) => listener !== fn);
		else this._listeners.end = this._listeners.end.filter((listener) => listener !== fn);
	}

	emit(event: "data", ...args: [string | Buffer]): void;
	emit(event: "end"): void;
	emit(event: "data" | "end", ...args: [string | Buffer] | []): void {
		if (event === "data" && args.length === 1) for (const fn of [...this._listeners.data]) fn(args[0]);
		else for (const fn of [...this._listeners.end]) fn();
	}
}

function fakeTty(overrides: FakeTtyOverrides = {}): FakeTty {
	return new FakeTtyStream(overrides);
}

function fakeStatus(): HiddenInputStatusStream & { writes: string[] } {
	const writes: string[] = [];
	return {
		isTTY: true,
		writes,
		write(chunk: string): void {
			writes.push(chunk);
		},
	};
}

test("hidden reader returns the typed code and releases the resumed stdin handle", async () => {
	const stdin = fakeTty();
	const stderr = fakeStatus();
	const pending = readHiddenTerminalEnrollmentCode(stdin, stderr);
	stdin.emit("data", Buffer.from("device-code-value"));
	stdin.emit("data", Buffer.from([0x0d])); // carriage return submits
	assert.equal(await pending, "device-code-value");
	// The regression: a resumed TTY must be paused again, or the process never
	// exits after enrollment (the operator had to Ctrl-C).
	assert.equal(stdin._calls.resume, 1);
	assert.equal(stdin._calls.pause, 1, "must pause the resumed stdin so `session enroll` can exit");
	// Raw mode is entered then restored to its prior value; listeners are removed.
	assert.deepEqual(stdin._calls.setRawMode, [true, false]);
	assert.equal(stdin._listeners.data.length, 0);
	assert.equal(stdin._listeners.end.length, 0);
});

test("hidden reader releases the handle even when the input is cancelled", async () => {
	const stdin = fakeTty();
	const pending = readHiddenTerminalEnrollmentCode(stdin, fakeStatus());
	stdin.emit("data", Buffer.from([0x03])); // Ctrl-C
	await assert.rejects(pending, /input_cancelled/u);
	assert.equal(stdin._calls.pause, 1, "cancel path must also pause the resumed stdin");
	assert.deepEqual(stdin._calls.setRawMode, [true, false]);
});

test("hidden reader refuses a non-TTY stdin without resuming it", async () => {
	const stdin = fakeTty({ isTTY: false });
	await assert.rejects(readHiddenTerminalEnrollmentCode(stdin, fakeStatus()), /interactive_enrollment_required/u);
	assert.equal(stdin._calls.resume, 0);
	assert.equal(stdin._calls.pause, 0);
});
