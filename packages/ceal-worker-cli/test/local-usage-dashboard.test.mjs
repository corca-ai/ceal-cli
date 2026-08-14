import assert from "node:assert/strict";
import test from "node:test";
import { composeCodexDashboardAdapterInput } from "../dist/local-usage-dashboard.js";

const GENERATED_AT = Date.parse("2026-08-14T00:00:00.000Z");

test("composes privacy-safe Codex session and token evidence without inventing cost", () => {
	const dashboard = composeCodexDashboardAdapterInput({
		generatedAt: GENERATED_AT,
		identity: { profileRef: "profile:developer", instanceRef: "instance:local" },
		access: { observedAt: "2026-08-14T00:00:00.000Z", capabilityCount: 4, readCapabilityCount: 3, writeCapabilityCount: 1 },
		agentActivity: {
			schemaVersion: "ceal.agent_activity.v1",
			nonClaims: ["runtime-specific accounting"],
			adapters: [
				{
					runtime: "codex",
					root: "~/.codex",
					health: "active",
					coverage: "transcript-observed",
					depth: "session_events",
					sessionCount: 1,
					eventScan: { scannedSessions: 1, sessionLimit: 3 },
					sessions: [
						{
							sessionRef: "019f9174-fec1-78d2-b4be-91402cdc66d4",
							lastActivityAt: GENERATED_AT - 1000,
							transcriptBytes: 20,
							events: {
								scan: "complete",
								eventCount: 2,
								kinds: { tool_call: 1 },
								unparsedLines: 0,
								tokenUsage: {
									source: "runtime_cumulative_last",
									completeness: "full_transcript",
									usageEvents: 1,
									inputTokens: 10,
									outputTokens: 4,
								},
							},
						},
					],
				},
			],
		},
	});
	assert.equal(dashboard.schemaVersion, "ceal.local_usage_dashboard.codex_input.v1");
	assert.deepEqual(dashboard.identity, { profileRef: "profile:developer", instanceRef: "instance:local", state: "available" });
	assert.equal(dashboard.sessions[0].toolCallEvents, 1);
	assert.equal(dashboard.sessions[0].eventEvidence, "complete");
	assert.equal(dashboard.sessions[0].tokenEvidence, "available");
	assert.deepEqual(dashboard.sessions[0].tokens, {
		source: "runtime_cumulative_last",
		completeness: "full_transcript",
		input: 10,
		output: 4,
	});
	assert.deepEqual(dashboard.sessionDetailCoverage, { returned: 1, eligible: 1, state: "complete" });
	assert.deepEqual(dashboard.pricing, { state: "unsupported", authority: "unknown" });
	assert.match(dashboard.nonClaims.at(-1), /missing cost is not zero/u);
	assert.equal(JSON.stringify(dashboard).includes("~/.codex"), false);
});

test("keeps bounded inventory partial and unreadable distinct from empty", () => {
	const partial = composeCodexDashboardAdapterInput({
		generatedAt: GENERATED_AT,
		agentActivity: {
			schemaVersion: "ceal.agent_activity.v1",
			nonClaims: [],
			adapters: [
				{
					runtime: "codex",
					root: "private",
					health: "active",
					coverage: "transcript-observed",
					inventory: "partial",
					sessionCount: 30,
					sessions: [],
				},
			],
		},
	});
	assert.equal(partial.sources[0].inventoryState, "partial");
	assert.deepEqual(partial.sessionDetailCoverage, { returned: 0, eligible: 30, state: "partial" });

	const unreadable = composeCodexDashboardAdapterInput({
		generatedAt: GENERATED_AT,
		agentActivity: {
			schemaVersion: "ceal.agent_activity.v1",
			nonClaims: [],
			adapters: [{ runtime: "codex", root: "private", health: "unknown", coverage: "transcript-observed" }],
		},
	});
	assert.equal(unreadable.sources[0].inventoryState, "unreadable");
	assert.equal(unreadable.sessionDetailCoverage.eligible, undefined);

	const empty = composeCodexDashboardAdapterInput({
		generatedAt: GENERATED_AT,
		agentActivity: {
			schemaVersion: "ceal.agent_activity.v1",
			nonClaims: [],
			adapters: [{ runtime: "codex", root: "private", health: "inactive", coverage: "transcript-observed", sessionCount: 0, sessions: [] }],
		},
	});
	assert.equal(empty.sources[0].inventoryState, "observed_empty");
	assert.deepEqual(empty.sessionDetailCoverage, { returned: 0, eligible: 0, state: "observed_empty" });
});

test("distinguishes unavailable adapter and per-session unreadable event evidence", () => {
	const unavailable = composeCodexDashboardAdapterInput({
		generatedAt: GENERATED_AT,
		agentActivity: { schemaVersion: "ceal.agent_activity.v1", nonClaims: [], adapters: [] },
	});
	assert.equal(unavailable.sources[0].inventoryState, "unavailable");

	const unreadableEvents = composeCodexDashboardAdapterInput({
		generatedAt: GENERATED_AT,
		agentActivity: {
			schemaVersion: "ceal.agent_activity.v1",
			nonClaims: [],
			adapters: [
				{
					runtime: "codex",
					root: "private",
					health: "active",
					coverage: "transcript-observed",
					sessionCount: 1,
					sessions: [
						{ sessionRef: "019f9174-fec1-78d2-b4be-91402cdc66d4", lastActivityAt: GENERATED_AT, transcriptBytes: 1, events: "unreadable" },
					],
				},
			],
		},
	});
	assert.equal(unreadableEvents.sources[0].inventoryState, "complete");
	assert.equal(unreadableEvents.sessions[0].eventEvidence, "unreadable");
	assert.equal(unreadableEvents.sessions[0].tokenEvidence, "unavailable");

	const unparsed = composeCodexDashboardAdapterInput({
		generatedAt: GENERATED_AT,
		agentActivity: {
			schemaVersion: "ceal.agent_activity.v1",
			nonClaims: [],
			adapters: [
				{
					runtime: "codex",
					root: "private",
					health: "active",
					coverage: "transcript-observed",
					sessionCount: 1,
					sessions: [
						{
							sessionRef: "019f9174-fec1-78d2-b4be-91402cdc66d4",
							lastActivityAt: GENERATED_AT,
							transcriptBytes: 1,
							events: { scan: "complete", eventCount: 1, kinds: {}, unparsedLines: 1 },
						},
					],
				},
			],
		},
	});
	assert.equal(unparsed.sessions[0].eventEvidence, "partial");
	assert.equal(unparsed.sessions[0].unparsedLines, 1);
});
