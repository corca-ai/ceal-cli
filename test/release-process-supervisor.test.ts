import assert from "node:assert/strict";
import test from "node:test";
import { parsePayload } from "./release-process-supervisor.ts";

const bounds = {
	cwd: process.cwd(),
	env: {},
	timeoutMs: 1_000,
	terminationGraceMs: 10,
	postKillReportMs: 10,
	postExitDrainMs: 10,
	maxCapturedOutputBytes: 100,
};

test("parses a minimal valid supervisor payload", () => {
	assert.deepEqual(parsePayload({ command: process.execPath, args: ["-e", ""], bounds }), {
		command: process.execPath,
		args: ["-e", ""],
		bounds,
	});
});

for (const [label, value] of [
	["root", null],
	["command", { args: [], bounds }],
	["args", { command: process.execPath, args: [1], bounds }],
	["bounds", { command: process.execPath, args: [], bounds: null }],
	["timeout", { command: process.execPath, args: [], bounds: { ...bounds, timeoutMs: -1 } }],
	["env", { command: process.execPath, args: [], bounds: { ...bounds, env: { X: 1 } } }],
] as const) {
	test(`rejects malformed ${label} before any spawn`, () => assert.throws(() => parsePayload(value)));
}
