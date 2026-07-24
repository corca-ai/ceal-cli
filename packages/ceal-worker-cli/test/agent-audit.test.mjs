import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectAgentAudit } from "../dist/agent-audit.js";

const NOW = Date.parse("2026-07-24T12:00:00.000Z");

test("agent audit inventories Claude sessions without reading transcript content", () => {
	withHome((home) => {
		const project = path.join(home, ".claude", "projects", "-home-user-codes-repo");
		mkdirSync(project, { recursive: true });
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, '{"type":"mode","secret":"raw transcript text"}\n');
		writeSession(project, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl", NOW - 3_600_000, "older\n");
		writeFileSync(path.join(project, "not-a-session.txt"), "ignored");
		symlinkSync(path.join(home, "outside.jsonl"), path.join(project, "cccccccc-1111-2222-3333-444444444444.jsonl"));

		const state = inspectAgentAudit(home, NOW);
		assert.equal(state.schemaVersion, "ceal.agent_activity.v1");
		const claude = state.adapters.find((adapter) => adapter.runtime === "claude");
		assert.equal(claude.health, "active");
		assert.equal(claude.coverage, "transcript-observed");
		assert.equal(claude.depth, "session_inventory");
		assert.equal(claude.sessionCount, 2);
		assert.deepEqual(claude.sessions.map((session) => session.sessionRef), [
			"11111111-2222-3333-4444-555555555555",
			"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
		]);
		assert.equal(claude.sessions[0].lastActivityAt, NOW - 60_000);
		assert.equal(typeof claude.sessions[0].transcriptBytes, "number");
		// The projection carries file identity and stat metadata only.
		assert.equal(JSON.stringify(state).includes("transcript text"), false);

		const codex = state.adapters.find((adapter) => adapter.runtime === "codex");
		assert.equal(codex.coverage, "unsupported");
		assert.equal(codex.health, "unknown");
	});
});

test("agent audit reports inactive, stale, and unknown honestly", () => {
	withHome((home) => {
		// No ~/.claude/projects at all: inactive with an explicit empty inventory.
		const absent = inspectAgentAudit(home, NOW).adapters.find((adapter) => adapter.runtime === "claude");
		assert.equal(absent.health, "inactive");
		assert.deepEqual(absent.sessions, []);
	});
	withHome((home) => {
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 48 * 3_600_000, "old\n");
		const stale = inspectAgentAudit(home, NOW).adapters.find((adapter) => adapter.runtime === "claude");
		assert.equal(stale.health, "stale");
	});
	// A missing home cannot fabricate an inventory.
	const unknown = inspectAgentAudit(undefined, NOW).adapters.find((adapter) => adapter.runtime === "claude");
	assert.equal(unknown.health, "unknown");
	assert.equal(unknown.sessions, undefined);
});

function writeSession(directory, name, mtimeMs, content) {
	const file = path.join(directory, name);
	writeFileSync(file, content);
	utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
}

function withHome(callback) {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-agent-audit-"));
	try {
		callback(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}
