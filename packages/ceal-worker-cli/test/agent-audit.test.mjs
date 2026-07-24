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

		// The Claude fixture home has no ~/.codex/sessions: a confirmed absence.
		const codex = state.adapters.find((adapter) => adapter.runtime === "codex");
		assert.equal(codex.coverage, "transcript-observed");
		assert.equal(codex.health, "inactive");
	});
});

test("agent audit inventories Codex rollouts newest-first without reading content", () => {
	withHome((home) => {
		const july = path.join(home, ".codex", "sessions", "2026", "07", "24");
		const june = path.join(home, ".codex", "sessions", "2026", "06", "01");
		mkdirSync(july, { recursive: true });
		mkdirSync(june, { recursive: true });
		writeSession(july, "rollout-2026-07-24T09-09-51-019f9174-fec1-78d2-b4be-91402cdc66d4.jsonl", NOW - 60_000, '{"secret":"raw rollout text"}\n');
		writeSession(june, "rollout-2026-06-01T01-02-03-019f0000-0000-7000-8000-000000000001.jsonl", NOW - 40 * 24 * 3_600_000, "older\n");
		writeFileSync(path.join(july, "not-a-rollout.jsonl"), "ignored");
		symlinkSync(path.join(home, "outside.jsonl"), path.join(july, "rollout-2026-07-24T10-00-00-019f9174-fec1-78d2-b4be-91402cdc66d5.jsonl"));

		const codex = inspectAgentAudit(home, NOW).adapters.find((adapter) => adapter.runtime === "codex");
		assert.equal(codex.health, "active");
		assert.equal(codex.coverage, "transcript-observed");
		assert.equal(codex.depth, "session_inventory");
		assert.equal(codex.inventory, undefined);
		assert.equal(codex.sessionCount, 2);
		// Only the machine-generated rollout UUID surfaces as a session_ref.
		assert.deepEqual(codex.sessions.map((session) => session.sessionRef), [
			"019f9174-fec1-78d2-b4be-91402cdc66d4",
			"019f0000-0000-7000-8000-000000000001",
		]);
		assert.equal(JSON.stringify(inspectAgentAudit(home, NOW)).includes("rollout text"), false);
	});
});

test("codex adapter reports inactive, unknown, and recency-safe partial honestly", () => {
	withHome((home) => {
		// ~/.codex exists but sessions/ does not: a confirmed absence.
		mkdirSync(path.join(home, ".codex"), { recursive: true });
		const absent = inspectAgentAudit(home, NOW).adapters.find((adapter) => adapter.runtime === "codex");
		assert.equal(absent.health, "inactive");
		assert.deepEqual(absent.sessions, []);
	});
	withHome((home) => {
		// A symlinked sessions root is refused and stays unknown.
		mkdirSync(path.join(home, ".codex"), { recursive: true });
		mkdirSync(path.join(home, "elsewhere"));
		symlinkSync(path.join(home, "elsewhere"), path.join(home, ".codex", "sessions"));
		const refused = inspectAgentAudit(home, NOW).adapters.find((adapter) => adapter.runtime === "codex");
		assert.equal(refused.health, "unknown");
		assert.equal(refused.sessions, undefined);
	});
	withHome((home) => {
		// Newest-first walk: junk in the newest shard exhausts the budget before
		// an older real session is reached, but the newest real session is kept,
		// so recency-derived health stays honest under `partial`.
		const newest = path.join(home, ".codex", "sessions", "2026", "07", "24");
		const oldest = path.join(home, ".codex", "sessions", "2025", "01", "01");
		mkdirSync(newest, { recursive: true });
		mkdirSync(oldest, { recursive: true });
		writeSession(newest, "rollout-2026-07-24T09-09-51-019f9174-fec1-78d2-b4be-91402cdc66d4.jsonl", NOW - 60_000, "x\n");
		for (let index = 0; index < 2000; index += 1) writeFileSync(path.join(newest, `noise-${index}.txt`), "");
		writeSession(oldest, "rollout-2025-01-01T00-00-00-019f0000-0000-7000-8000-000000000002.jsonl", NOW - 500 * 24 * 3_600_000, "y\n");

		const codex = inspectAgentAudit(home, NOW).adapters.find((adapter) => adapter.runtime === "codex");
		assert.equal(codex.inventory, "partial");
		assert.match(codex.note, /truncated or partly unreadable/u);
		assert.equal(codex.health, "active");
		assert.deepEqual(codex.sessions.map((session) => session.sessionRef), ["019f9174-fec1-78d2-b4be-91402cdc66d4"]);
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
	// A lookup failure that is not a confirmed absence (here: projects is a
	// symlink, refused) stays unknown instead of fabricating an empty inventory.
	withHome((home) => {
		mkdirSync(path.join(home, ".claude"), { recursive: true });
		mkdirSync(path.join(home, "elsewhere"));
		symlinkSync(path.join(home, "elsewhere"), path.join(home, ".claude", "projects"));
		const refused = inspectAgentAudit(home, NOW).adapters.find((adapter) => adapter.runtime === "claude");
		assert.equal(refused.health, "unknown");
		assert.equal(refused.sessions, undefined);
	});
});

test("agent audit marks a truncated walk as a partial inventory, never complete", () => {
	withHome((home) => {
		// One junk-stuffed project exhausts the walk budget before a later
		// project's real session is reached.
		const junk = path.join(home, ".claude", "projects", "a-junk");
		mkdirSync(junk, { recursive: true });
		for (let index = 0; index < 2000; index += 1) writeFileSync(path.join(junk, `noise-${index}.txt`), "");
		const real = path.join(home, ".claude", "projects", "z-real");
		mkdirSync(real, { recursive: true });
		writeSession(real, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, "x\n");

		const claude = inspectAgentAudit(home, NOW).adapters.find((adapter) => adapter.runtime === "claude");
		assert.equal(claude.inventory, "partial");
		assert.match(claude.note, /truncated or partly unreadable/u);
		// A partial walk that found nothing proves nothing about inactivity.
		assert.equal(claude.health, "unknown");
		assert.equal(claude.sessionCount, undefined);
	});
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
