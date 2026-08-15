import assert from "node:assert/strict";
import test from "node:test";
import {
	composeCanonicalLocalUsageDashboard,
	composeCodexDashboardAdapterInput,
	decodeProductionLocalUsageDashboard,
	defaultLocalUsageWindow,
} from "../dist/local-usage-dashboard.js";

const GENERATED_AT = Date.parse("2026-08-14T00:00:00.000Z");
const CAPABILITIES = [
	{
		capabilityId: "message.search",
		label: "Search messages",
		effect: "read",
		targetRequirement: "required",
		evidenceRequirement: "gateway_audit",
	},
	{
		capabilityId: "document.read",
		label: "Read documents",
		effect: "read",
		targetRequirement: "required",
		evidenceRequirement: "gateway_audit",
	},
	{
		capabilityId: "calendar.read",
		label: "Read calendar",
		effect: "read",
		targetRequirement: "optional",
		evidenceRequirement: "gateway_audit",
	},
	{
		capabilityId: "message.send",
		label: "Send messages",
		effect: "write",
		targetRequirement: "required",
		evidenceRequirement: "gateway_audit",
	},
];

test("composes privacy-safe Codex session and token evidence without inventing cost", () => {
	const dashboard = composeCodexDashboardAdapterInput({
		generatedAt: GENERATED_AT,
		identity: { profileRef: "profile:developer", instanceRef: "instance:local" },
		access: {
			observedAt: "2026-08-14T00:00:00.000Z",
			capabilityCount: 4,
			readCapabilityCount: 3,
			writeCapabilityCount: 1,
			capabilities: CAPABILITIES,
		},
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
								modelIdentity: { source: "turn_context", modelKey: "gpt-5.3-codex" },
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
	assert.equal(dashboard.sessions[0].modelKey, "gpt-5.3-codex");
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

test("composes a fail-closed canonical browser dataset with reconciling covered-subset totals", () => {
	const adapter = composeCodexDashboardAdapterInput({
		generatedAt: GENERATED_AT,
		identity: { profileRef: "profile:developer", instanceRef: "instance:local" },
		access: {
			observedAt: "2026-08-14T00:00:00.000Z",
			capabilityCount: 4,
			readCapabilityCount: 3,
			writeCapabilityCount: 1,
			capabilities: CAPABILITIES,
		},
		agentActivity: {
			schemaVersion: "ceal.agent_activity.v1",
			nonClaims: ["local bounded evidence"],
			adapters: [
				{
					runtime: "codex",
					root: "private",
					health: "active",
					coverage: "transcript-observed",
					sessionCount: 2,
					sessions: [
						{
							sessionRef: "019f9174-fec1-78d2-b4be-91402cdc66d4",
							lastActivityAt: Date.parse("2026-08-13T10:00:00Z"),
							transcriptBytes: 1,
							events: {
								scan: "complete",
								eventCount: 2,
								kinds: { tool_call: 2 },
								unparsedLines: 0,
								tokenUsage: {
									source: "runtime_cumulative_last",
									completeness: "full_transcript",
									usageEvents: 1,
									inputTokens: 10,
									outputTokens: 5,
								},
							},
						},
						{ sessionRef: "019f9174-fec1-78d2-b4be-91402cdc66d5", lastActivityAt: Date.parse("2026-08-13T12:00:00Z"), transcriptBytes: 1 },
					],
				},
			],
		},
	});
	const dataset = composeCanonicalLocalUsageDashboard({
		adapter,
		timezone: "Asia/Seoul",
		window: { startDate: "2026-08-01", endDate: "2026-08-15" },
	});
	assert.equal(dataset.fixture_only, false);
	assert.equal(dataset.production_provenance, "ceal_cli_owned_adapter");
	assert.deepEqual(dataset.window, { start_date: "2026-08-01", end_date: "2026-08-15" });
	assert.deepEqual(dataset.daily, [{ date: "2026-08-13", sessions: 2, agent_tool_calls: 2, tokens: 15, estimated_cost: null }]);
	assert.deepEqual(dataset.totals, { sessions: 2, agent_tool_calls: 2, tokens: 15, estimated_cost: null });
	assert.equal(dataset.metric_coverage.sessions.observation_state, "complete");
	assert.equal(dataset.metric_coverage.agent_tool_calls.observation_state, "partial");
	assert.equal(dataset.metric_coverage.tokens.observation_state, "partial");
	assert.equal(dataset.metric_coverage.estimated_cost.observation_state, "unsupported");
	assert.deepEqual(
		dataset.suggestions.map((entry) => entry.suggestion_id),
		["token_coverage_gap", "tool_coverage_gap", "cost_unavailable"],
	);
	assert.deepEqual(dataset.suggestions[0].evidence.session_refs, []);
	assert.deepEqual(decodeProductionLocalUsageDashboard(dataset), dataset);
	assert.equal(decodeProductionLocalUsageDashboard({ ...dataset, fixture_only: true }), null);
	assert.equal(decodeProductionLocalUsageDashboard({ ...dataset, production_provenance: "synthetic" }), null);
	assert.equal(decodeProductionLocalUsageDashboard({ ...dataset, prompt: "private content" }), null);
	assert.equal(decodeProductionLocalUsageDashboard({ ...dataset, window: { start_date: "bad", end_date: "2026-08-15" } }), null);
	const { identity: _identity, ...missingIdentity } = dataset;
	assert.equal(decodeProductionLocalUsageDashboard(missingIdentity), null);
	assert.equal(
		decodeProductionLocalUsageDashboard({
			...dataset,
			sessions: [{ ...dataset.sessions[0], transcript_path: "/Users/private/session.jsonl" }],
		}),
		null,
	);
	assert.equal(
		decodeProductionLocalUsageDashboard({
			...dataset,
			suggestions: [
				{
					...dataset.suggestions[0],
					evidence: { ...dataset.suggestions[0].evidence, session_refs: ["11111111-2222-3333-4444-555555555555"] },
				},
				...dataset.suggestions.slice(1),
			],
		}),
		null,
	);
	assert.equal(
		decodeProductionLocalUsageDashboard({
			...dataset,
			suggestions: [{ ...dataset.suggestions[0], recommendation: "PRIVATE PROMPT CONTENT" }, ...dataset.suggestions.slice(1)],
		}),
		null,
	);
	assert.equal(
		decodeProductionLocalUsageDashboard({
			...dataset,
			suggestions: [
				{ ...dataset.suggestions[0], evidence: { ...dataset.suggestions[0].evidence, source_refs: ["invented:source"] } },
				...dataset.suggestions.slice(1),
			],
		}),
		null,
	);
	assert.equal(decodeProductionLocalUsageDashboard({ ...dataset, totals: { ...dataset.totals, sessions: 999 } }), null);
	assert.equal(decodeProductionLocalUsageDashboard({ ...dataset, daily: [{ ...dataset.daily[0], date: "2025-01-01" }] }), null);
	assert.equal(
		decodeProductionLocalUsageDashboard({
			...dataset,
			identity: { state: "available", profile_ref: "private prompt text", instance_ref: "bad ref" },
		}),
		null,
	);
	assert.equal(
		decodeProductionLocalUsageDashboard({
			...dataset,
			metric_coverage: {
				...dataset.metric_coverage,
				tokens: { ...dataset.metric_coverage.tokens, comparability_group: "/Users/private/pricing" },
			},
		}),
		null,
	);
	assert.equal(
		decodeProductionLocalUsageDashboard({
			...dataset,
			session_detail_coverage: { returned: 999, eligible: 0, observation_state: "complete" },
		}),
		null,
	);
	const firstCapability = dataset.access.capabilities[0];
	for (const capabilities of [
		[firstCapability, firstCapability, ...dataset.access.capabilities.slice(2)],
		[{ ...firstCapability, target_requirement: "sometimes" }, ...dataset.access.capabilities.slice(1)],
		[{ ...firstCapability, effect: "execute" }, ...dataset.access.capabilities.slice(1)],
		[{ ...firstCapability, label: "x".repeat(129) }, ...dataset.access.capabilities.slice(1)],
		[{ ...firstCapability, provider_payload: "private" }, ...dataset.access.capabilities.slice(1)],
	])
		assert.equal(decodeProductionLocalUsageDashboard({ ...dataset, access: { ...dataset.access, capabilities } }), null);
	assert.equal(
		decodeProductionLocalUsageDashboard({
			...dataset,
			sessions: [{ ...dataset.sessions[0], event_evidence: "partial", model_key: "gpt-5.3-codex" }, ...dataset.sessions.slice(1)],
		}),
		null,
	);
	assert.equal(JSON.stringify(dataset).includes("private"), false);
});

test("accepts a strict pricing snapshot but keeps cost unsupported without local model identity", () => {
	const snapshot = {
		schema_version: "ceal.local_pricing_snapshot.v1",
		snapshot_ref: "pricing:codex:2026-08-14",
		revision: "pricing-rev-1",
		observed_at: "2026-08-14T00:00:00.000Z",
		currency: "USD",
		rates: [
			{
				model_key: "gpt-5",
				input_per_million: "1.25",
				output_per_million: "10",
				cache_read_per_million: "0.125",
				cache_write_per_million: "0",
			},
		],
	};
	const adapter = composeCodexDashboardAdapterInput({
		generatedAt: GENERATED_AT,
		agentActivity: { schemaVersion: "ceal.agent_activity.v1", adapters: [], nonClaims: [] },
	});
	const composeWithPricing = (pricingSnapshot) =>
		composeCanonicalLocalUsageDashboard({
			adapter,
			timezone: "UTC",
			window: { startDate: "2026-08-01", endDate: "2026-08-15" },
			pricingSnapshot,
		});
	for (const invalid of [
		{ ...snapshot, currency: "usd" },
		{ ...snapshot, currency: "ZZZZ" },
		{ ...snapshot, observed_at: "2026-08-14" },
		{ ...snapshot, snapshot_ref: "AKIAIOSFODNN7EXAMPLE" },
		{ ...snapshot, revision: "credential-shaped-value" },
		{ ...snapshot, rates: [{ ...snapshot.rates[0], input_per_million: -1 }] },
		{ ...snapshot, rates: [snapshot.rates[0], snapshot.rates[0]] },
		{ ...snapshot, credential: "secret" },
		{ ...snapshot, snapshot_ref: "/Users/private/pricing.json" },
	])
		assert.deepEqual(composeWithPricing(invalid).pricing, {
			observation_state: "unsupported",
			authority: "unknown",
			reason: "pricing_snapshot_unavailable",
		});
	const dataset = composeWithPricing(snapshot);
	assert.deepEqual(dataset.pricing, {
		observation_state: "unsupported",
		authority: "local_pricing_snapshot",
		reason: "model_identity_unavailable",
		currency: "USD",
	});
	assert.equal(JSON.stringify(dataset).includes(snapshot.snapshot_ref), false);
	assert.equal(JSON.stringify(dataset).includes(snapshot.revision), false);
	assert.equal(dataset.totals.estimated_cost, null);
	assert.deepEqual(decodeProductionLocalUsageDashboard(dataset), dataset);
	assert.equal(
		decodeProductionLocalUsageDashboard({ ...dataset, pricing: { ...dataset.pricing, reason: "cost_derivation_unavailable" } }),
		null,
	);
	const adapterWithModel = {
		...adapter,
		sources: [{ ...adapter.sources[0], inventoryState: "complete" }],
		sessionDetailCoverage: { returned: 1, eligible: 1, state: "complete" },
		sessions: [
			{
				sessionRef: "019f9174-fec1-78d2-b4be-91402cdc66d4",
				runtime: "codex",
				lastActivityAt: "2026-08-13T00:00:00.000Z",
				eventEvidence: "complete",
				tokenEvidence: "available",
				modelKey: "gpt-5",
				toolCallEvents: 0,
				tokens: { source: "runtime_cumulative_last", completeness: "full_transcript", input: 10, output: 2 },
			},
		],
	};
	const withModel = composeCanonicalLocalUsageDashboard({
		adapter: adapterWithModel,
		timezone: "UTC",
		window: { startDate: "2026-08-01", endDate: "2026-08-15" },
		pricingSnapshot: snapshot,
	});
	assert.equal(withModel.pricing.reason, "cost_derivation_unavailable");
	assert.match(
		withModel.suggestions.find((entry) => entry.suggestion_id === "cost_unavailable").rationale,
		/derivation is not implemented/u,
	);
	const concentrated = composeCanonicalLocalUsageDashboard({
		adapter: {
			...adapterWithModel,
			sessionDetailCoverage: { returned: 4, eligible: 4, state: "complete" },
			sessions: [10, 1, 1, 1].map((input, index) => ({
				...adapterWithModel.sessions[0],
				sessionRef: `019f9174-fec1-78d2-b4be-91402cdc66d${index + 4}`,
				tokens: { ...adapterWithModel.sessions[0].tokens, input, output: 0 },
			})),
		},
		timezone: "UTC",
		window: { startDate: "2026-08-01", endDate: "2026-08-15" },
		pricingSnapshot: snapshot,
	});
	assert.equal(concentrated.suggestions[0].suggestion_id, "token_concentration");
	assert.match(concentrated.suggestions[0].rationale, /One of 4 fully covered sessions/u);
	assert.equal(withModel.totals.estimated_cost, null);
	assert.equal(
		decodeProductionLocalUsageDashboard({ ...withModel, pricing: { ...withModel.pricing, reason: "model_identity_unavailable" } }),
		null,
	);
	assert.equal(
		composeCanonicalLocalUsageDashboard({
			adapter: { ...adapterWithModel, sessions: [{ ...adapterWithModel.sessions[0], modelKey: "gpt-unpriced" }] },
			timezone: "UTC",
			window: { startDate: "2026-08-01", endDate: "2026-08-15" },
			pricingSnapshot: snapshot,
		}).pricing.reason,
		"pricing_rate_unavailable",
	);
});

test("canonical window uses local calendar dates and excludes future or out-of-window sessions", () => {
	assert.deepEqual(defaultLocalUsageWindow(Date.parse("2026-08-14T23:30:00Z"), "Asia/Seoul"), {
		startDate: "2025-08-16",
		endDate: "2026-08-16",
	});
	const adapter = composeCodexDashboardAdapterInput({
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
					sessionCount: 2,
					sessions: [
						{ sessionRef: "019f9174-fec1-78d2-b4be-91402cdc66d4", lastActivityAt: Date.parse("2026-07-31T14:59:59Z"), transcriptBytes: 1 },
						{ sessionRef: "019f9174-fec1-78d2-b4be-91402cdc66d5", lastActivityAt: GENERATED_AT + 1, transcriptBytes: 1 },
					],
				},
			],
		},
	});
	const dataset = composeCanonicalLocalUsageDashboard({
		adapter,
		timezone: "Asia/Seoul",
		window: { startDate: "2026-08-01", endDate: "2026-08-15" },
	});
	assert.equal(dataset.sessions.length, 0);
	assert.equal(dataset.session_detail_coverage.observation_state, "observed_empty");
	assert.equal(dataset.totals.sessions, 0);
	assert.throws(
		() => composeCanonicalLocalUsageDashboard({ adapter, timezone: "UTC", window: { startDate: "2026-08-01", endDate: "2026-08-01" } }),
		/non-empty/u,
	);
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
	assert.deepEqual(partial.sessionDetailCoverage, { returned: 0, state: "partial" });

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

test("canonical decoder accepts complete evidence for returned rows inside a partial inventory", () => {
	const adapter = composeCodexDashboardAdapterInput({
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
					sessionCount: 4,
					sessions: [
						{
							sessionRef: "019f9174-fec1-78d2-b4be-91402cdc66d4",
							lastActivityAt: Date.parse("2026-08-13T10:00:00Z"),
							transcriptBytes: 1,
							events: {
								scan: "complete",
								eventCount: 1,
								kinds: { tool_call: 1 },
								unparsedLines: 0,
								tokenUsage: { source: "runtime_cumulative_last", completeness: "full_transcript", usageEvents: 1, inputTokens: 2, outputTokens: 1 },
							},
						},
					],
				},
			],
		},
	});
	const dataset = composeCanonicalLocalUsageDashboard({
		adapter,
		timezone: "UTC",
		window: { startDate: "2026-08-01", endDate: "2026-08-15" },
	});
	assert.equal(dataset.metric_coverage.sessions.observation_state, "partial");
	assert.deepEqual(
		{
			state: dataset.metric_coverage.tokens.observation_state,
			numerator: dataset.metric_coverage.tokens.numerator,
			denominator: dataset.metric_coverage.tokens.denominator,
		},
		{ state: "partial", numerator: 1, denominator: 1 },
	);
	assert.deepEqual(decodeProductionLocalUsageDashboard(dataset), dataset);
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
