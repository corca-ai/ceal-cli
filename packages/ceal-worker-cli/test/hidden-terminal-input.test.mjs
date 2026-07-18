import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { readHiddenTerminalEnrollmentCode } from "../dist/hidden-terminal-input.js";

// A structural stand-in for a raw-mode TTY stream that records the lifecycle
// calls a real `process.stdin` would receive, so the handle-release contract is
// testable without allocating a pseudo-terminal.
function fakeTty(overrides = {}) {
	const listeners = { data: [], end: [] };
	const calls = { resume: 0, pause: 0, setRawMode: [] };
	return {
		isTTY: true,
		isRaw: false,
		setRawMode(mode) { calls.setRawMode.push(mode); this.isRaw = mode; },
		resume() { calls.resume += 1; },
		pause() { calls.pause += 1; },
		on(event, fn) { listeners[event].push(fn); },
		once(event, fn) { listeners[event].push(fn); },
		off(event, fn) { listeners[event] = listeners[event].filter((listener) => listener !== fn); },
		emit(event, ...args) { for (const fn of [...listeners[event]]) fn(...args); },
		_calls: calls,
		_listeners: listeners,
		...overrides,
	};
}

function fakeStatus() {
	return { isTTY: true, writes: [], write(chunk) { this.writes.push(chunk); } };
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
