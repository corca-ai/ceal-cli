/* global process */
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runBoundedProcess } from "../dist/bounded-process.js";

test("timeout kills a TERM-ignoring descendant after its leader exits on TERM", { timeout: 5_000 }, async (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-bounded-process-tree-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const pidFile = path.join(root, "descendant.pid");
	const fixture = path.join(root, "fixture.sh");
	writeFileSync(
		fixture,
		`#!/bin/sh
trap 'exit 0' TERM
sh -c 'trap "" TERM; while :; do sleep 1; done' </dev/null >/dev/null 2>&1 &
descendant=$!
printf '%s\n' "$descendant" > ${JSON.stringify(pidFile)}
printf 'ready\n'
while :; do sleep 1; done
`,
	);
	chmodSync(fixture, 0o755);

	const result = await runBoundedProcess(fixture, [], {
		cwd: root,
		env: process.env,
		timeoutMs: 30,
		terminationGraceMs: 80,
		postKillReportMs: 30,
		postExitDrainMs: 10,
		maxCapturedOutputBytes: 1024,
		timeoutStartMarker: "ready\n",
		timeoutStartDeadlineMs: 1_000,
	});
	const descendant = Number(readFileSync(pidFile, "utf8").trim());
	context.after(() => killIfAlive(descendant));

	assert.equal(result.timedOut, true);
	await waitUntil(() => !processAlive(descendant));
	assert.equal(processAlive(descendant), false, `descendant pid ${descendant} survived the process-group escalation`);
});

async function waitUntil(predicate, timeoutMs = 1_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("timed-out descendant remained alive after the group-kill deadline");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function processAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

function killIfAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0 || !processAlive(pid)) return;
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		/* Already gone. */
	}
}
