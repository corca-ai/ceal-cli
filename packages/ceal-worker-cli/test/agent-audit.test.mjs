import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectAgentAudit, inspectAgentSessionEvents } from "../dist/agent-audit.js";

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
		assert.equal(claude.depth, "session_events");
		assert.equal(claude.sessionCount, 2);
		// Event summaries expose kind counts only; the "secret" value stays local.
		assert.deepEqual(claude.sessions[0].events, { scan: "complete", eventCount: 1, kinds: { session_state: 1 }, unparsedLines: 0 });
		assert.deepEqual(claude.sessions[1].events, { scan: "complete", eventCount: 0, kinds: {}, unparsedLines: 1 });
		assert.deepEqual(claude.eventScan, { scannedSessions: 2, sessionLimit: 3 });
		assert.deepEqual(claude.sessions.map((session) => session.sessionRef), [
			"11111111-2222-3333-4444-555555555555",
			"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
		]);
		assert.equal(claude.sessions[0].lastActivityAt, NOW - 60_000);
		assert.equal(typeof claude.sessions[0].transcriptBytes, "number");
		// The projection carries file identity, stat metadata, and fixed-vocabulary
		// event metadata only.
		assert.equal(JSON.stringify(state).includes("transcript text"), false);
		// Pin the honesty-critical non-claim wording: content is parsed locally,
		// so the claim must be metadata-only surfacing, not "never read".
		assert.match(state.nonClaims[0], /kind counts and re-serialized timestamps/u);
		assert.match(state.nonClaims[0], /transcript content, prompts, tool arguments/u);
		assert.equal(state.nonClaims.some((claim) => claim.includes("never read")), false);

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
		assert.equal(codex.depth, "session_events");
		assert.equal(codex.inventory, undefined);
		assert.equal(codex.sessionCount, 2);
		// A parsed line without a recognized grammar is counted, never echoed.
		assert.deepEqual(codex.sessions[0].events, { scan: "complete", eventCount: 1, kinds: { other: 1 }, unparsedLines: 0 });
		assert.deepEqual(codex.eventScan, { scannedSessions: 2, sessionLimit: 3 });
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
	withHome((home) => {
		// An unreadable day shard is a declared partial gap, and with nothing
		// else found the walk proves nothing about inactivity.
		const day = path.join(home, ".codex", "sessions", "2026", "07", "24");
		mkdirSync(day, { recursive: true });
		chmodSync(day, 0o000);
		try {
			const codex = inspectAgentAudit(home, NOW).adapters.find((adapter) => adapter.runtime === "codex");
			assert.equal(codex.inventory, "partial");
			assert.equal(codex.health, "unknown");
			assert.equal(codex.sessionCount, undefined);
		} finally {
			chmodSync(day, 0o700);
		}
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

test("event depth classifies Claude lines with structural redaction", () => {
	withHome((home) => {
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		const lines = [
			'{"type":"user","message":{"role":"user","content":"do the thing SECRET-USER"},"timestamp":"2026-07-24T10:00:00.000Z"}',
			'{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"SECRET-THINK"}]},"timestamp":"2026-07-24T10:00:05.000Z"}',
			'{"type":"assistant","message":{"content":[{"type":"text","text":"SECRET-ANSWER"},{"type":"tool_use","name":"Bash","input":{"command":"SECRET-CMD"}}]},"timestamp":"2026-07-24T10:00:10.000Z"}',
			'{"type":"user","message":{"content":[{"type":"tool_result","content":"SECRET-RESULT"}]},"timestamp":"2026-07-24T10:00:15.000Z"}',
			'{"type":"assistant","message":{"content":[{"type":"text","text":"done"}]},"timestamp":"2026-07-24T10:00:20.000Z"}',
			'{"type":"file-history-snapshot","snapshot":{"path":"SECRET-PATH"}}',
			'{"type":"totally-new-kind","timestamp":"2026-07-24T10:00:25.000Z"}',
			"not json at all",
		];
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, `${lines.join("\n")}\n`);

		const state = inspectAgentAudit(home, NOW);
		const claude = state.adapters.find((adapter) => adapter.runtime === "claude");
		assert.equal(claude.depth, "session_events");
		assert.deepEqual(claude.sessions[0].events, {
			scan: "complete",
			eventCount: 7,
			kinds: { user_message: 1, reasoning: 1, tool_call: 1, tool_result: 1, assistant_message: 1, session_state: 1, other: 1 },
			unparsedLines: 1,
			firstEventAt: Date.parse("2026-07-24T10:00:00.000Z"),
			lastScannedEventAt: Date.parse("2026-07-24T10:00:25.000Z"),
		});
		// Structural redaction: no transcript field value survives into the state.
		assert.equal(JSON.stringify(state).includes("SECRET-"), false);
	});
});

test("event depth classifies Codex rollout lines and never echoes payloads", () => {
	withHome((home) => {
		const day = path.join(home, ".codex", "sessions", "2026", "07", "24");
		mkdirSync(day, { recursive: true });
		const lines = [
			'{"timestamp":"2026-07-24T11:00:00.000Z","type":"session_meta","payload":{"instructions":"SECRET-INSTR"}}',
			'{"timestamp":"2026-07-24T11:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"SECRET-MSG"}}',
			'{"timestamp":"2026-07-24T11:00:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"SECRET-INPUT"}]}}',
			'{"timestamp":"2026-07-24T11:00:03.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"SECRET-OUTPUT"}]}}',
			'{"timestamp":"2026-07-24T11:00:04.000Z","type":"response_item","payload":{"type":"message","role":"developer","content":[]}}',
			'{"timestamp":"2026-07-24T11:00:05.000Z","type":"response_item","payload":{"type":"reasoning","summary":["SECRET-SUMMARY"]}}',
			'{"timestamp":"2026-07-24T11:00:06.000Z","type":"response_item","payload":{"type":"custom_tool_call","input":"SECRET-ARGS"}}',
			'{"timestamp":"2026-07-24T11:00:07.000Z","type":"response_item","payload":{"type":"custom_tool_call_output","output":"SECRET-TOOLOUT"}}',
			'{"timestamp":"2026-07-24T11:00:08.000Z","type":"response_item","payload":{"type":"widget"}}',
		];
		writeSession(day, "rollout-2026-07-24T11-00-00-019f9174-fec1-78d2-b4be-91402cdc66d4.jsonl", NOW - 60_000, `${lines.join("\n")}\n`);

		const state = inspectAgentAudit(home, NOW);
		const codex = state.adapters.find((adapter) => adapter.runtime === "codex");
		assert.equal(codex.depth, "session_events");
		assert.deepEqual(codex.sessions[0].events, {
			scan: "complete",
			eventCount: 9,
			// The event_msg mirror of the user utterance counts as session_state,
			// so one message is never counted twice.
			kinds: { session_state: 3, user_message: 1, assistant_message: 1, reasoning: 1, tool_call: 1, tool_result: 1, other: 1 },
			unparsedLines: 0,
			firstEventAt: Date.parse("2026-07-24T11:00:00.000Z"),
			lastScannedEventAt: Date.parse("2026-07-24T11:00:08.000Z"),
		});
		assert.equal(JSON.stringify(state).includes("SECRET-"), false);
	});
});

test("event scan stays bounded and declares truncation and unreadable transcripts", () => {
	withHome((home) => {
		// Five sessions: only the newest three carry event summaries.
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		for (let index = 0; index < 5; index += 1) {
			writeSession(project, `11111111-2222-3333-4444-55555555555${index}.jsonl`, NOW - (index + 1) * 60_000, '{"type":"mode"}\n');
		}
		const claude = inspectAgentAudit(home, NOW).adapters.find((adapter) => adapter.runtime === "claude");
		assert.deepEqual(claude.eventScan, { scannedSessions: 3, sessionLimit: 3 });
		assert.deepEqual(claude.sessions.map((session) => session.events !== undefined), [true, true, true, false, false]);
	});
	withHome((home) => {
		// The 5000-line budget truncates a longer transcript, declared as such.
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, '{"type":"mode"}\n'.repeat(5010));
		const claude = inspectAgentAudit(home, NOW).adapters.find((adapter) => adapter.runtime === "claude");
		assert.equal(claude.sessions[0].events.scan, "truncated");
		assert.equal(claude.sessions[0].events.eventCount, 5000);
	});
	withHome((home) => {
		// The byte budget drops the trailing partial line instead of counting a
		// real event as unparsed.
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		const wideLine = `{"type":"mode","pad":"${"x".repeat(700)}"}\n`;
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, wideLine.repeat(3000));
		const claude = inspectAgentAudit(home, NOW).adapters.find((adapter) => adapter.runtime === "claude");
		assert.equal(claude.sessions[0].events.scan, "truncated");
		assert.equal(claude.sessions[0].events.unparsedLines, 0);
		assert.ok(claude.sessions[0].events.eventCount > 0);
		assert.ok(claude.sessions[0].events.eventCount < 3000);
	});
	withHome((home) => {
		// An unreadable transcript is a declared per-session gap; with no scanned
		// session the adapter honestly stays at inventory depth.
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, '{"type":"mode"}\n');
		chmodSync(path.join(project, "11111111-2222-3333-4444-555555555555.jsonl"), 0o000);
		try {
			const claude = inspectAgentAudit(home, NOW).adapters.find((adapter) => adapter.runtime === "claude");
			assert.equal(claude.sessions[0].events, "unreadable");
			assert.equal(claude.depth, "session_inventory");
			assert.deepEqual(claude.eventScan, { scannedSessions: 0, sessionLimit: 3 });
		} finally {
			chmodSync(path.join(project, "11111111-2222-3333-4444-555555555555.jsonl"), 0o600);
		}
	});
});

test("per-session drill-down scans any inventoried session without trusting the ref as a path", () => {
	withHome((home) => {
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		for (let index = 0; index < 5; index += 1) {
			writeSession(project, `11111111-2222-3333-4444-55555555555${index}.jsonl`, NOW - (index + 1) * 60_000, '{"type":"mode","secret":"SECRET-DRILL"}\n');
		}
		// The oldest session sits beyond the newest-3 auto-scan window; the
		// drill-down still reaches it with the same structural redaction.
		const lookup = inspectAgentSessionEvents(home, "claude", "11111111-2222-3333-4444-555555555554");
		assert.equal(lookup.status, "scanned");
		assert.equal(lookup.session.sessionRef, "11111111-2222-3333-4444-555555555554");
		assert.deepEqual(lookup.session.events, { scan: "complete", eventCount: 1, kinds: { session_state: 1 }, unparsedLines: 0 });
		assert.equal(JSON.stringify(lookup).includes("SECRET-DRILL"), false);
		assert.equal("transcriptPath" in lookup.session, false);

		assert.equal(inspectAgentSessionEvents(home, "claude", "99999999-9999-9999-9999-999999999999").status, "not_found");
		// Grammar violations are rejected before any filesystem access; the ref
		// is never joined into a path, so traversal shapes cannot resolve.
		assert.equal(inspectAgentSessionEvents(home, "claude", "../../etc/passwd"), null);
		assert.equal(inspectAgentSessionEvents(home, "shell", "11111111-2222-3333-4444-555555555554"), null);
	});
	withHome((home) => {
		const day = path.join(home, ".codex", "sessions", "2026", "07", "24");
		mkdirSync(day, { recursive: true });
		writeSession(day, "rollout-2026-07-24T11-00-00-019f9174-fec1-78d2-b4be-91402cdc66d4.jsonl", NOW - 60_000,
			'{"timestamp":"2026-07-24T11:00:00.000Z","type":"session_meta","payload":{"instructions":"SECRET-META"}}\n');
		const codex = inspectAgentSessionEvents(home, "codex", "019f9174-fec1-78d2-b4be-91402cdc66d4");
		assert.equal(codex.status, "scanned");
		assert.deepEqual(codex.session.events, {
			scan: "complete", eventCount: 1, kinds: { session_state: 1 }, unparsedLines: 0,
			firstEventAt: Date.parse("2026-07-24T11:00:00.000Z"), lastScannedEventAt: Date.parse("2026-07-24T11:00:00.000Z"),
		});
		assert.equal(JSON.stringify(codex).includes("SECRET-META"), false);
	});
	withHome((home) => {
		// A missing sessions root is a confirmed absence, not a walk failure.
		assert.equal(inspectAgentSessionEvents(home, "codex", "019f9174-fec1-78d2-b4be-91402cdc66d4").status, "not_found");
	});
	// A missing home cannot fabricate a lookup result.
	assert.equal(inspectAgentSessionEvents(undefined, "claude", "11111111-2222-3333-4444-555555555555").status, "unreadable");
	withHome((home) => {
		// An unreadable transcript stays a declared per-session gap.
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, '{"type":"mode"}\n');
		chmodSync(path.join(project, "11111111-2222-3333-4444-555555555555.jsonl"), 0o000);
		try {
			const lookup = inspectAgentSessionEvents(home, "claude", "11111111-2222-3333-4444-555555555555");
			assert.equal(lookup.status, "scanned");
			assert.equal(lookup.session.events, "unreadable");
		} finally {
			chmodSync(path.join(project, "11111111-2222-3333-4444-555555555555.jsonl"), 0o600);
		}
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
