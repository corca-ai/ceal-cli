import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { CealAgentAuditState, CealAgentSessionEventsLookup } from "../dist/agent-audit.js";
import {
	inspectAgentAudit as inspectAgentAuditWithRuntime,
	inspectAgentSessionEvents as inspectAgentSessionEventsWithRuntime,
} from "../dist/agent-audit.js";
import type { CealAgentHostOverrides } from "../dist/agent-guide.js";

type AuditAdapter = CealAgentAuditState["adapters"][number];
type AuditSession = NonNullable<AuditAdapter["sessions"]>[number];
type AuditEvents = Exclude<NonNullable<AuditSession["events"]>, "unreadable">;
type AuditRuntime = "claude" | "codex";

const NOW = Date.parse("2026-07-24T12:00:00.000Z");
const FIXED_MONOTONIC_CLOCK = Object.freeze({ monotonicNow: () => 0 });

function inspectAgentAudit(home: string | undefined, overrides: CealAgentHostOverrides, now: number) {
	return inspectAgentAuditWithRuntime(home, overrides, now, FIXED_MONOTONIC_CLOCK);
}

function inspectAgentSessionEvents(home: string | undefined, overrides: CealAgentHostOverrides, runtime: string, sessionRef: string) {
	return inspectAgentSessionEventsWithRuntime(home, overrides, runtime, sessionRef, FIXED_MONOTONIC_CLOCK);
}

function expectDefined<T>(value: T | null | undefined): T {
	if (value === undefined || value === null) throw new Error("expected a defined fixture value");
	return value;
}

function adapterFor(state: CealAgentAuditState, runtime: AuditRuntime): AuditAdapter {
	return expectDefined(state.adapters.find((adapter) => adapter.runtime === runtime));
}

function sessionsOf(adapter: AuditAdapter): AuditSession[] {
	return expectDefined(adapter.sessions);
}

function sessionAt(adapter: AuditAdapter, index = 0): AuditSession {
	return expectDefined(sessionsOf(adapter)[index]);
}

function eventsOf(session: AuditSession): AuditEvents {
	const events = session.events;
	if (events === undefined || events === "unreadable") throw new Error("expected a scanned fixture session");
	return events;
}

function scannedLookup(lookup: CealAgentSessionEventsLookup | null): AuditSession {
	if (lookup === null || lookup.status !== "scanned") throw new Error("expected a scanned fixture lookup");
	return expectDefined(lookup.session);
}

test("agent audit inventories Claude sessions without reading transcript content", () => {
	withHome((home) => {
		const project = path.join(home, ".claude", "projects", "-home-user-codes-repo");
		mkdirSync(project, { recursive: true });
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, '{"type":"mode","secret":"raw transcript text"}\n');
		writeSession(project, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl", NOW - 3_600_000, "older\n");
		writeFileSync(path.join(project, "not-a-session.txt"), "ignored");
		symlinkSync(path.join(home, "outside.jsonl"), path.join(project, "cccccccc-1111-2222-3333-444444444444.jsonl"));

		const state = inspectAgentAudit(home, {}, NOW);
		assert.equal(state.schemaVersion, "ceal.agent_activity.v1");
		const claude = adapterFor(state, "claude");
		assert.equal(claude.health, "active");
		assert.equal(claude.coverage, "transcript-observed");
		assert.equal(claude.depth, "session_events");
		assert.equal(claude.sessionCount, 2);
		// Event summaries expose kind counts only; the "secret" value stays local.
		assert.deepEqual(sessionAt(claude).events, { scan: "complete", eventCount: 1, kinds: { session_state: 1 }, unparsedLines: 0 });
		assert.deepEqual(sessionAt(claude, 1).events, { scan: "complete", eventCount: 0, kinds: {}, unparsedLines: 1 });
		assert.deepEqual(claude.eventScan, { scannedSessions: 2, sessionLimit: 3 });
		assert.deepEqual(
			sessionsOf(claude).map((session) => session.sessionRef),
			["11111111-2222-3333-4444-555555555555", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
		);
		assert.equal(sessionAt(claude).lastActivityAt, NOW - 60_000);
		assert.equal(typeof sessionAt(claude).transcriptBytes, "number");
		// The projection carries file identity, stat metadata, and fixed-vocabulary
		// event metadata only.
		assert.equal(JSON.stringify(state).includes("transcript text"), false);
		// Pin the honesty-critical non-claim wording: content is parsed locally,
		// so the claim must be metadata-only surfacing, not "never read".
		assert.match(state.nonClaims[0], /kind counts and re-serialized timestamps/u);
		assert.match(state.nonClaims[0], /transcript content, prompts, tool arguments/u);
		assert.equal(
			state.nonClaims.some((claim) => claim.includes("never read")),
			false,
		);

		// The Claude fixture home has no ~/.codex/sessions: a confirmed absence.
		const codex = adapterFor(state, "codex");
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
		writeSession(
			july,
			"rollout-2026-07-24T09-09-51-019f9174-fec1-78d2-b4be-91402cdc66d4.jsonl",
			NOW - 60_000,
			'{"secret":"raw rollout text"}\n',
		);
		writeSession(june, "rollout-2026-06-01T01-02-03-019f0000-0000-7000-8000-000000000001.jsonl", NOW - 40 * 24 * 3_600_000, "older\n");
		writeFileSync(path.join(july, "not-a-rollout.jsonl"), "ignored");
		symlinkSync(path.join(home, "outside.jsonl"), path.join(july, "rollout-2026-07-24T10-00-00-019f9174-fec1-78d2-b4be-91402cdc66d5.jsonl"));

		const codex = adapterFor(inspectAgentAudit(home, {}, NOW), "codex");
		assert.equal(codex.health, "active");
		assert.equal(codex.coverage, "transcript-observed");
		assert.equal(codex.depth, "session_events");
		assert.equal(codex.inventory, undefined);
		assert.equal(codex.sessionCount, 2);
		// A parsed line without a recognized grammar is counted, never echoed.
		assert.deepEqual(sessionAt(codex).events, { scan: "complete", eventCount: 1, kinds: { other: 1 }, unparsedLines: 0 });
		assert.deepEqual(codex.eventScan, { scannedSessions: 2, sessionLimit: 3 });
		// Only the machine-generated rollout UUID surfaces as a session_ref.
		assert.deepEqual(
			sessionsOf(codex).map((session) => session.sessionRef),
			["019f9174-fec1-78d2-b4be-91402cdc66d4", "019f0000-0000-7000-8000-000000000001"],
		);
		assert.equal(JSON.stringify(inspectAgentAudit(home, {}, NOW)).includes("rollout text"), false);
	});
});

test("a walk that exhausts its monotonic deadline reports unknown instead of fabricating inactivity", () => {
	withHome((home) => {
		const july = path.join(home, ".codex", "sessions", "2026", "07", "24");
		mkdirSync(july, { recursive: true });
		writeSession(july, "rollout-2026-07-24T09-09-51-019f9174-fec1-78d2-b4be-91402cdc66d4.jsonl", NOW - 60_000, "x\n");
		let reading = 0;
		const codex = adapterFor(
			inspectAgentAuditWithRuntime(home, {}, NOW, {
				monotonicNow: () => {
					reading += 101;
					return reading;
				},
			}),
			"codex",
		);
		assert.equal(codex.health, "unknown");
		assert.equal(codex.inventory, "partial");
	});
});

test("codex bounded inventory keeps the newest rollout after a large streamed directory", () => {
	withHome((home) => {
		const day = path.join(home, ".codex", "sessions", "2026", "07", "24");
		mkdirSync(day, { recursive: true });
		for (let index = 0; index < 2000; index += 1) writeFileSync(path.join(day, `noise-${String(index).padStart(4, "0")}.txt`), "");
		writeSession(day, "rollout-2026-07-24T09-09-51-019f9174-fec1-78d2-b4be-91402cdc66d4.jsonl", NOW - 60_000, "x\n");

		const codex = adapterFor(inspectAgentAudit(home, {}, NOW), "codex");
		assert.equal(codex.inventory, "partial");
		assert.deepEqual(
			sessionsOf(codex).map((session) => session.sessionRef),
			["019f9174-fec1-78d2-b4be-91402cdc66d4"],
		);
	});
});

test("codex adapter reports inactive, unknown, and recency-safe partial honestly", () => {
	withHome((home) => {
		// ~/.codex exists but sessions/ does not: a confirmed absence.
		mkdirSync(path.join(home, ".codex"), { recursive: true });
		const absent = adapterFor(inspectAgentAudit(home, {}, NOW), "codex");
		assert.equal(absent.health, "inactive");
		assert.deepEqual(absent.sessions, []);
	});
	withHome((home) => {
		// A symlinked sessions root is refused and stays unknown.
		mkdirSync(path.join(home, ".codex"), { recursive: true });
		mkdirSync(path.join(home, "elsewhere"));
		symlinkSync(path.join(home, "elsewhere"), path.join(home, ".codex", "sessions"));
		const refused = adapterFor(inspectAgentAudit(home, {}, NOW), "codex");
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

		const codex = adapterFor(inspectAgentAudit(home, {}, NOW), "codex");
		assert.equal(codex.inventory, "partial");
		assert.match(expectDefined(codex.note), /truncated or partly unreadable/u);
		assert.equal(codex.health, "active");
		assert.deepEqual(
			sessionsOf(codex).map((session) => session.sessionRef),
			["019f9174-fec1-78d2-b4be-91402cdc66d4"],
		);
	});
	withHome((home) => {
		// An unreadable day shard is a declared partial gap, and with nothing
		// else found the walk proves nothing about inactivity.
		const day = path.join(home, ".codex", "sessions", "2026", "07", "24");
		mkdirSync(day, { recursive: true });
		chmodSync(day, 0o000);
		try {
			const codex = adapterFor(inspectAgentAudit(home, {}, NOW), "codex");
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
		const absent = adapterFor(inspectAgentAudit(home, {}, NOW), "claude");
		assert.equal(absent.health, "inactive");
		assert.deepEqual(absent.sessions, []);
	});
	withHome((home) => {
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 48 * 3_600_000, "old\n");
		const stale = adapterFor(inspectAgentAudit(home, {}, NOW), "claude");
		assert.equal(stale.health, "stale");
	});
	// A missing home cannot fabricate an inventory.
	const unknown = adapterFor(inspectAgentAudit(undefined, {}, NOW), "claude");
	assert.equal(unknown.health, "unknown");
	assert.equal(unknown.sessions, undefined);
	// A lookup failure that is not a confirmed absence (here: projects is a
	// symlink, refused) stays unknown instead of fabricating an empty inventory.
	withHome((home) => {
		mkdirSync(path.join(home, ".claude"), { recursive: true });
		mkdirSync(path.join(home, "elsewhere"));
		symlinkSync(path.join(home, "elsewhere"), path.join(home, ".claude", "projects"));
		const refused = adapterFor(inspectAgentAudit(home, {}, NOW), "claude");
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

		const claude = adapterFor(inspectAgentAudit(home, {}, NOW), "claude");
		assert.equal(claude.inventory, "partial");
		assert.match(expectDefined(claude.note), /truncated or partly unreadable/u);
		// A partial walk that found nothing proves nothing about inactivity.
		assert.equal(claude.health, "unknown");
		assert.equal(claude.sessionCount, undefined);
		assert.equal(
			expectDefined(inspectAgentSessionEvents(home, {}, "claude", "11111111-2222-3333-4444-555555555555")).status,
			"unreadable",
			"a bounded miss cannot claim the requested session is absent",
		);
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

		const state = inspectAgentAudit(home, {}, NOW);
		const claude = adapterFor(state, "claude");
		assert.equal(claude.depth, "session_events");
		assert.deepEqual(eventsOf(sessionAt(claude)), {
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

		const state = inspectAgentAudit(home, {}, NOW);
		const codex = adapterFor(state, "codex");
		assert.equal(codex.depth, "session_events");
		assert.deepEqual(eventsOf(sessionAt(codex)), {
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
		const claude = adapterFor(inspectAgentAudit(home, {}, NOW), "claude");
		assert.deepEqual(claude.eventScan, { scannedSessions: 3, sessionLimit: 3 });
		assert.deepEqual(
			sessionsOf(claude).map((session) => session.events !== undefined),
			[true, true, true, false, false],
		);
	});
	withHome((home) => {
		// The 5000-line budget truncates a longer transcript, declared as such.
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, '{"type":"mode"}\n'.repeat(5010));
		const claude = adapterFor(inspectAgentAudit(home, {}, NOW), "claude");
		assert.equal(eventsOf(sessionAt(claude)).scan, "truncated");
		assert.equal(eventsOf(sessionAt(claude)).eventCount, 5000);
	});
	withHome((home) => {
		// The byte budget drops the trailing partial line instead of counting a
		// real event as unparsed.
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		const wideLine = `{"type":"mode","pad":"${"x".repeat(700)}"}\n`;
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, wideLine.repeat(3000));
		const claude = adapterFor(inspectAgentAudit(home, {}, NOW), "claude");
		assert.equal(eventsOf(sessionAt(claude)).scan, "truncated");
		assert.equal(eventsOf(sessionAt(claude)).unparsedLines, 0);
		assert.ok(eventsOf(sessionAt(claude)).eventCount > 0);
		assert.ok(eventsOf(sessionAt(claude)).eventCount < 3000);
	});
	withHome((home) => {
		// An unreadable transcript is a declared per-session gap; with no scanned
		// session the adapter honestly stays at inventory depth.
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, '{"type":"mode"}\n');
		chmodSync(path.join(project, "11111111-2222-3333-4444-555555555555.jsonl"), 0o000);
		try {
			const claude = adapterFor(inspectAgentAudit(home, {}, NOW), "claude");
			assert.equal(sessionAt(claude).events, "unreadable");
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
			writeSession(
				project,
				`11111111-2222-3333-4444-55555555555${index}.jsonl`,
				NOW - (index + 1) * 60_000,
				'{"type":"mode","secret":"SECRET-DRILL"}\n',
			);
		}
		// The oldest session sits beyond the newest-3 auto-scan window; the
		// drill-down still reaches it with the same structural redaction.
		const lookup = inspectAgentSessionEvents(home, {}, "claude", "11111111-2222-3333-4444-555555555554");
		const session = scannedLookup(lookup);
		assert.equal(session.sessionRef, "11111111-2222-3333-4444-555555555554");
		assert.deepEqual(session.events, { scan: "complete", eventCount: 1, kinds: { session_state: 1 }, unparsedLines: 0 });
		assert.equal(JSON.stringify(lookup).includes("SECRET-DRILL"), false);
		assert.equal("transcriptPath" in session, false);

		assert.equal(expectDefined(inspectAgentSessionEvents(home, {}, "claude", "99999999-9999-9999-9999-999999999999")).status, "not_found");
		// Grammar violations are rejected before any filesystem access; the ref
		// is never joined into a path, so traversal shapes cannot resolve.
		assert.equal(inspectAgentSessionEvents(home, {}, "claude", "../../etc/passwd"), null);
		assert.equal(inspectAgentSessionEvents(home, {}, "shell", "11111111-2222-3333-4444-555555555554"), null);
	});
	withHome((home) => {
		const day = path.join(home, ".codex", "sessions", "2026", "07", "24");
		mkdirSync(day, { recursive: true });
		writeSession(
			day,
			"rollout-2026-07-24T11-00-00-019f9174-fec1-78d2-b4be-91402cdc66d4.jsonl",
			NOW - 60_000,
			'{"timestamp":"2026-07-24T11:00:00.000Z","type":"session_meta","payload":{"instructions":"SECRET-META"}}\n',
		);
		const codex = inspectAgentSessionEvents(home, {}, "codex", "019f9174-fec1-78d2-b4be-91402cdc66d4");
		assert.deepEqual(scannedLookup(codex).events, {
			scan: "complete",
			eventCount: 1,
			kinds: { session_state: 1 },
			unparsedLines: 0,
			firstEventAt: Date.parse("2026-07-24T11:00:00.000Z"),
			lastScannedEventAt: Date.parse("2026-07-24T11:00:00.000Z"),
		});
		assert.equal(JSON.stringify(codex).includes("SECRET-META"), false);
	});
	withHome((home) => {
		// A missing sessions root is a confirmed absence, not a walk failure.
		assert.equal(expectDefined(inspectAgentSessionEvents(home, {}, "codex", "019f9174-fec1-78d2-b4be-91402cdc66d4")).status, "not_found");
	});
	withHome((home) => {
		// A ref duplicated across projects resolves to the newest transcript —
		// this tiebreak decides which file gets opened, so it stays pinned.
		const older = path.join(home, ".claude", "projects", "a-old");
		const newer = path.join(home, ".claude", "projects", "b-new");
		mkdirSync(older, { recursive: true });
		mkdirSync(newer, { recursive: true });
		writeSession(older, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 3_600_000, '{"type":"mode"}\n');
		writeSession(newer, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, '{"type":"mode"}\n{"type":"mode"}\n');
		const lookup = inspectAgentSessionEvents(home, {}, "claude", "11111111-2222-3333-4444-555555555555");
		const session = scannedLookup(lookup);
		assert.equal(session.lastActivityAt, NOW - 60_000);
		assert.equal(eventsOf(session).eventCount, 2);
	});
	// A missing home cannot fabricate a lookup result.
	assert.equal(
		expectDefined(inspectAgentSessionEvents(undefined, {}, "claude", "11111111-2222-3333-4444-555555555555")).status,
		"unreadable",
	);
	withHome((home) => {
		// An unreadable transcript stays a declared per-session gap.
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, '{"type":"mode"}\n');
		chmodSync(path.join(project, "11111111-2222-3333-4444-555555555555.jsonl"), 0o000);
		try {
			const lookup = inspectAgentSessionEvents(home, {}, "claude", "11111111-2222-3333-4444-555555555555");
			assert.equal(lookup?.status, "scanned");
			assert.equal(lookup?.session?.events, "unreadable");
		} finally {
			chmodSync(path.join(project, "11111111-2222-3333-4444-555555555555.jsonl"), 0o600);
		}
	});
});

test("token figures surface only when the runtime supplied usage, summed once per Claude request", () => {
	withHome((home) => {
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		const usage = '{"input_tokens":2,"output_tokens":10,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}';
		const lines = [
			// One API turn split across two records repeats the identical usage
			// object; the sum counts it once via the shared requestId.
			`{"type":"assistant","requestId":"req_1","message":{"content":[{"type":"text","text":"a"}],"usage":${usage}},"timestamp":"2026-07-24T10:00:00.000Z"}`,
			`{"type":"assistant","requestId":"req_1","message":{"content":[{"type":"tool_use","name":"Bash","input":{}}],"usage":${usage}},"timestamp":"2026-07-24T10:00:01.000Z"}`,
			// Second turn falls back to the message id as the dedupe key.
			'{"type":"assistant","message":{"id":"msg_2","content":[{"type":"text","text":"b"}],"usage":{"input_tokens":3,"output_tokens":5}},"timestamp":"2026-07-24T10:00:02.000Z"}',
			// Non-integer, negative, and beyond-safe-range values are ignored,
			// never rendered.
			'{"type":"assistant","requestId":"req_3","message":{"content":[{"type":"text","text":"c"}],"usage":{"input_tokens":-4,"output_tokens":"9","cache_read_input_tokens":1e308}},"timestamp":"2026-07-24T10:00:03.000Z"}',
			'{"type":"user","message":{"role":"user","content":"hi"},"timestamp":"2026-07-24T10:00:04.000Z"}',
		];
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, `${lines.join("\n")}\n`);
		const claude = adapterFor(inspectAgentAudit(home, {}, NOW), "claude");
		assert.deepEqual(eventsOf(sessionAt(claude)).tokenUsage, {
			source: "event_usage_sum",
			completeness: "full_transcript",
			usageEvents: 2,
			inputTokens: 5,
			outputTokens: 15,
			cacheReadTokens: 100,
			cacheWriteTokens: 50,
		});
	});
	withHome((home) => {
		// Codex supplies its own session-cumulative accounting: the last
		// token_count reading wins instead of summing.
		const day = path.join(home, ".codex", "sessions", "2026", "07", "24");
		mkdirSync(day, { recursive: true });
		const lines = [
			'{"timestamp":"2026-07-24T11:00:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":80,"cache_write_input_tokens":0,"output_tokens":20}}}}',
			// The last reading replaces the whole earlier reading as supplied:
			// a field it no longer carries (cache_write) drops instead of
			// inheriting a stale earlier value.
			'{"timestamp":"2026-07-24T11:00:01.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":200,"cached_input_tokens":150,"output_tokens":40}}}}',
		];
		writeSession(day, "rollout-2026-07-24T11-00-00-019f9174-fec1-78d2-b4be-91402cdc66d4.jsonl", NOW - 60_000, `${lines.join("\n")}\n`);
		const codex = adapterFor(inspectAgentAudit(home, {}, NOW), "codex");
		assert.deepEqual(eventsOf(sessionAt(codex)).tokenUsage, {
			source: "runtime_cumulative_last",
			completeness: "full_transcript",
			usageEvents: 2,
			inputTokens: 200,
			outputTokens: 40,
			cacheReadTokens: 150,
		});
	});
	withHome((home) => {
		// Omitted, not zero: a transcript whose runtime supplied no usage shows
		// no token figures at all.
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		writeSession(
			project,
			"11111111-2222-3333-4444-555555555555.jsonl",
			NOW - 60_000,
			'{"type":"assistant","message":{"content":[{"type":"text","text":"a"}]},"timestamp":"2026-07-24T10:00:00.000Z"}\n',
		);
		const claude = adapterFor(inspectAgentAudit(home, {}, NOW), "claude");
		assert.equal("tokenUsage" in eventsOf(sessionAt(claude)), false);
	});
	withHome((home) => {
		// A truncated scan declares its figures cover only the scanned prefix.
		const project = path.join(home, ".claude", "projects", "-repo");
		mkdirSync(project, { recursive: true });
		// A runtime-supplied zero still surfaces: only absence is omitted.
		const usageLine =
			'{"type":"assistant","requestId":"req_1","message":{"content":[{"type":"text","text":"a"}],"usage":{"input_tokens":1,"output_tokens":2,"cache_creation_input_tokens":0}},"timestamp":"2026-07-24T10:00:00.000Z"}\n';
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, usageLine + '{"type":"mode"}\n'.repeat(5010));
		const claude = adapterFor(inspectAgentAudit(home, {}, NOW), "claude");
		assert.equal(eventsOf(sessionAt(claude)).scan, "truncated");
		assert.deepEqual(eventsOf(sessionAt(claude)).tokenUsage, {
			source: "event_usage_sum",
			completeness: "scanned_prefix",
			usageEvents: 1,
			inputTokens: 1,
			outputTokens: 2,
			cacheWriteTokens: 0,
		});
	});
	// The token non-claim is honesty-critical wording: runtime-supplied, not
	// comparable across runtimes, no cost claim, and no latency figure.
	const state = inspectAgentAudit(undefined, {}, NOW);
	assert.match(state.nonClaims[2], /runtime-supplied/u);
	assert.match(state.nonClaims[2], /not comparable across runtimes/u);
	assert.match(state.nonClaims[2], /No latency figure/u);
});

// The audit and `guide status` answer questions about the same directory, so a
// moved host root must move both. The audit used to hardcode `~/.claude` and
// `~/.codex`, so an operator who set either override read an empty audit while
// the guide surface followed the override.
test("a configured host root is scanned and reported instead of the default", () => {
	withHome((home) => {
		const moved = path.join(home, "moved-claude");
		const project = path.join(moved, "projects", "-home-user-codes-repo");
		mkdirSync(project, { recursive: true });
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, '{"type":"mode"}\n');
		// The default root exists and is empty, so a hardcoded scan would report
		// `inactive` here rather than failing loudly.
		mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });

		const claude = adapterFor(inspectAgentAudit(home, { claude: moved }, NOW), "claude");
		assert.equal(claude.health, "active");
		assert.equal(claude.sessionCount, 1);
		assert.equal(claude.root, moved);
	});
});

test("a configured Codex root is scanned and reported instead of the default", () => {
	withHome((home) => {
		const moved = path.join(home, "moved-codex");
		const day = path.join(moved, "sessions", "2026", "07", "24");
		mkdirSync(day, { recursive: true });
		writeSession(day, "rollout-2026-07-24T11-00-00-019f9174-fec1-78d2-b4be-91402cdc66d4.jsonl", NOW - 60_000, '{"type":"mode"}\n');

		const codex = adapterFor(inspectAgentAudit(home, { codex: moved }, NOW), "codex");
		assert.equal(codex.health, "active");
		assert.equal(codex.sessionCount, 1);
		assert.equal(codex.root, moved);
	});
});

// An override that cannot be joined safely is a refusal in the guide store, and
// the audit must not quietly fall back to the default root instead.
test("an unusable host override is refused rather than replaced by the default", () => {
	withHome((home) => {
		const project = path.join(home, ".claude", "projects", "-home-user-codes-repo");
		mkdirSync(project, { recursive: true });
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, '{"type":"mode"}\n');

		const claude = adapterFor(inspectAgentAudit(home, { claude: "relative/path" }, NOW), "claude");
		assert.equal(claude.health, "unknown");
		assert.equal(claude.root, "relative/path");
	});
});

test("a session drill-down follows the configured host root", () => {
	withHome((home) => {
		const moved = path.join(home, "moved-claude");
		const project = path.join(moved, "projects", "-home-user-codes-repo");
		mkdirSync(project, { recursive: true });
		writeSession(project, "11111111-2222-3333-4444-555555555555.jsonl", NOW - 60_000, '{"type":"mode"}\n');

		const lookup = inspectAgentSessionEvents(home, { claude: moved }, "claude", "11111111-2222-3333-4444-555555555555");
		assert.equal(expectDefined(lookup).status, "scanned");
		assert.equal(expectDefined(inspectAgentSessionEvents(home, {}, "claude", "11111111-2222-3333-4444-555555555555")).status, "not_found");
	});
});

function writeSession(directory: string, name: string, mtimeMs: number, content: string): void {
	const file = path.join(directory, name);
	writeFileSync(file, content);
	utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
}

function withHome(callback: (home: string) => void): void {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-agent-audit-"));
	try {
		callback(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}
