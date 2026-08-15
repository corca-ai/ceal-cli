import assert from "node:assert/strict";
import test from "node:test";
import {
	composeCanonicalLocalUsageDashboard,
	composeClaudeDashboardAdapterInput,
	composeCodexDashboardAdapterInput,
	decodeProductionLocalUsageDashboard,
	defaultLocalUsageWindow,
	inspectLocalUsageAnalysisBoundaryForTest,
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

test("keeps Claude event-usage accounting in its own canonical partition", () => {
	const adapter = composeClaudeDashboardAdapterInput({
		generatedAt: GENERATED_AT,
		agentActivity: {
			schemaVersion: "ceal.agent_activity.v1",
			nonClaims: ["runtime-specific accounting"],
			adapters: [
				{
					runtime: "claude",
					root: "private",
					health: "active",
					coverage: "transcript-observed",
					sessionCount: 2,
					sessions: [
						{
							sessionRef: "11111111-2222-3333-4444-555555555555",
							lastActivityAt: Date.parse("2026-08-13T10:00:00Z"),
							transcriptBytes: 1,
							events: {
								scan: "complete",
								eventCount: 2,
								kinds: { tool_call: 1 },
								unparsedLines: 0,
								tokenUsage: {
									source: "event_usage_sum",
									completeness: "full_transcript",
									usageEvents: 1,
									inputTokens: 20,
									outputTokens: 5,
								},
							},
						},
						{
							sessionRef: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
							lastActivityAt: Date.parse("2026-08-12T10:00:00Z"),
							transcriptBytes: 1,
							events: {
								scan: "complete",
								eventCount: 1,
								kinds: {},
								unparsedLines: 0,
							},
						},
					],
				},
			],
		},
	});
	assert.equal(adapter.schemaVersion, "ceal.local_usage_dashboard.claude_input.v1");
	const dataset = composeCanonicalLocalUsageDashboard({
		adapter,
		timezone: "UTC",
		window: { startDate: "2026-08-01", endDate: "2026-08-15" },
		pricingSnapshot: {
			schema_version: "ceal.local_pricing_snapshot.v1",
			snapshot_ref: "pricing:claude-review",
			revision: "pricing-rev-claude-review",
			observed_at: "2026-08-13T00:00:00.000Z",
			currency: "USD",
			rates: [
				{
					model_key: "claude-review-model",
					input_per_million: "1",
					output_per_million: "2",
					cache_read_per_million: "0",
					cache_write_per_million: "0",
				},
			],
		},
	});
	assert.equal(dataset.sources[0].source_ref, "agent_activity:claude");
	assert.equal(dataset.totals.tokens, 25);
	assert.equal(dataset.metric_coverage.tokens.comparability_group, "claude:event_usage_sum:v1");
	assert.equal(dataset.sessions[0].runtime, "claude");
	assert.equal(dataset.sessions[0].model_key, null);
	assert.equal(dataset.totals.estimated_cost, null);
	assert.equal(dataset.pricing.authority, "local_pricing_snapshot");
	assert.equal(dataset.pricing.currency, "USD");
	assert.equal(dataset.pricing.reason, "model_identity_unavailable");
	assert.equal(dataset.metric_coverage.estimated_cost.comparability_group, "unsupported");
	assert.match(dataset.suggestions.find((entry) => entry.suggestion_id === "token_coverage_gap")?.rationale ?? "", /Claude token evidence/u);
	assert.deepEqual(decodeProductionLocalUsageDashboard(dataset), dataset);
	assert.equal(
		decodeProductionLocalUsageDashboard({
			...dataset,
			sessions: [{ ...dataset.sessions[0], runtime: "codex", comparability_group: "codex:runtime_cumulative_last:v1" }],
		}),
		null,
	);
	for (const mutation of [
		{ ...dataset, sources: [{ ...dataset.sources[0], runtime: "codex" }] },
		{ ...dataset, sessions: [{ ...dataset.sessions[0], runtime: "codex" }, ...dataset.sessions.slice(1)] },
		{
			...dataset,
			sessions: [{ ...dataset.sessions[0], comparability_group: "codex:runtime_cumulative_last:v1" }, ...dataset.sessions.slice(1)],
		},
		{
			...dataset,
			metric_coverage: {
				...dataset.metric_coverage,
				tokens: { ...dataset.metric_coverage.tokens, source_refs: ["agent_activity:codex"] },
			},
		},
		{
			...dataset,
			metric_coverage: {
				...dataset.metric_coverage,
				tokens: { ...dataset.metric_coverage.tokens, comparability_group: "codex:runtime_cumulative_last:v1" },
			},
		},
	])
		assert.equal(decodeProductionLocalUsageDashboard(mutation), null);
});

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
				cache_write_per_million: "2",
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
		{ ...snapshot, currency: "ZZZ" },
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
				tokens: {
					source: "runtime_cumulative_last",
					completeness: "full_transcript",
					input: 10,
					output: 2,
					cacheRead: 4,
					cacheWrite: 3,
				},
			},
		],
	};
	const withModel = composeCanonicalLocalUsageDashboard({
		adapter: adapterWithModel,
		timezone: "UTC",
		window: { startDate: "2026-08-01", endDate: "2026-08-15" },
		pricingSnapshot: snapshot,
	});
	assert.equal(withModel.pricing.reason, "estimated_not_billed");
	assert.equal(withModel.pricing.observation_state, "complete");
	assert.equal(withModel.sessions[0].estimated_cost, "0.000034");
	assert.equal(withModel.daily[0].estimated_cost, "0.000034");
	assert.equal(withModel.totals.estimated_cost, "0.000034");
	assert.match(withModel.metric_coverage.estimated_cost.comparability_group, /^pricing:USD:[a-f0-9]{16}:per_session_half_up_6dp$/u);
	assert.equal(decodeProductionLocalUsageDashboard({ ...withModel, pricing: { ...withModel.pricing, currency: "ZZZ" } }), null);
	assert.equal(
		decodeProductionLocalUsageDashboard({
			...withModel,
			metric_coverage: {
				...withModel.metric_coverage,
				estimated_cost: {
					...withModel.metric_coverage.estimated_cost,
					comparability_group: withModel.metric_coverage.estimated_cost.comparability_group.replace("pricing:USD:", "pricing:ZZZ:"),
				},
			},
		}),
		null,
	);
	assert.equal(
		withModel.suggestions.some((entry) => entry.suggestion_id === "cost_unavailable"),
		false,
	);
	assert.equal(decodeProductionLocalUsageDashboard({ ...withModel, sessions: [{ ...withModel.sessions[0], tokens: null }] }), null);
	assert.equal(
		decodeProductionLocalUsageDashboard({
			...withModel,
			daily: [
				{ date: "2026-08-12", sessions: 0, agent_tool_calls: 0, tokens: 0, estimated_cost: "0.000034" },
				{ ...withModel.daily[0], estimated_cost: null },
			],
		}),
		null,
	);
	const roundedHalfUp = composeCanonicalLocalUsageDashboard({
		adapter: {
			...adapterWithModel,
			sessions: [
				{
					...adapterWithModel.sessions[0],
					tokens: { ...adapterWithModel.sessions[0].tokens, input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
				},
			],
		},
		timezone: "UTC",
		window: { startDate: "2026-08-01", endDate: "2026-08-15" },
		pricingSnapshot: {
			...snapshot,
			rates: [
				{
					...snapshot.rates[0],
					input_per_million: "0.05",
					output_per_million: "0",
					cache_read_per_million: "0",
					cache_write_per_million: "0",
				},
			],
		},
	});
	assert.equal(roundedHalfUp.totals.estimated_cost, "0.000001");
	const invalidCacheSubset = composeCanonicalLocalUsageDashboard({
		adapter: {
			...adapterWithModel,
			sessions: [{ ...adapterWithModel.sessions[0], tokens: { ...adapterWithModel.sessions[0].tokens, input: 1, cacheRead: 2 } }],
		},
		timezone: "UTC",
		window: { startDate: "2026-08-01", endDate: "2026-08-15" },
		pricingSnapshot: snapshot,
	});
	assert.equal(invalidCacheSubset.totals.estimated_cost, null);
	const partialRates = composeCanonicalLocalUsageDashboard({
		adapter: {
			...adapterWithModel,
			sessionDetailCoverage: { returned: 2, eligible: 2, state: "complete" },
			sessions: [
				adapterWithModel.sessions[0],
				{ ...adapterWithModel.sessions[0], sessionRef: "019f9174-fec1-78d2-b4be-91402cdc66d5", modelKey: "gpt-unpriced" },
			],
		},
		timezone: "UTC",
		window: { startDate: "2026-08-01", endDate: "2026-08-15" },
		pricingSnapshot: snapshot,
	});
	assert.equal(partialRates.pricing.observation_state, "partial");
	assert.equal(partialRates.metric_coverage.estimated_cost.numerator, 1);
	assert.equal(partialRates.metric_coverage.estimated_cost.denominator, 2);
	const concentrated = composeCanonicalLocalUsageDashboard({
		adapter: {
			...adapterWithModel,
			sessionDetailCoverage: { returned: 4, eligible: 4, state: "complete" },
			sessions: [10, 1, 1, 1].map((input, index) => ({
				...adapterWithModel.sessions[0],
				sessionRef: `019f9174-fec1-78d2-b4be-91402cdc66d${index + 4}`,
				tokens: { ...adapterWithModel.sessions[0].tokens, input, output: 0 },
				toolCallEvents: index === 0 ? 10 : 1,
			})),
		},
		timezone: "UTC",
		window: { startDate: "2026-08-01", endDate: "2026-08-15" },
		pricingSnapshot: snapshot,
	});
	assert.equal(concentrated.suggestions[0].suggestion_id, "token_concentration");
	assert.match(concentrated.suggestions[0].rationale, /One of 4 fully covered sessions/u);
	assert.equal(concentrated.suggestions[1].suggestion_id, "tool_concentration");
	assert.match(concentrated.suggestions[1].rationale, /not a productivity or repetition judgment/u);
	const analysis = inspectLocalUsageAnalysisBoundaryForTest(concentrated);
	assert.ok(analysis);
	assert.equal(analysis.accepted, true);
	assert.deepEqual(analysis.suggestions, concentrated.suggestions);
	assert.deepEqual(Object.keys(analysis.input).sort(), ["coverage", "pricing", "runtime", "schema_version", "sessions", "source_ref"]);
	assert.doesNotMatch(
		JSON.stringify(analysis.input),
		/(?:prompt|tool_argument|provider_payload|credential|secret|\/Users\/|\/home\/|[A-Za-z]:\\)/iu,
	);
	const tokenFinding = analysis.findings.find((finding) => finding.finding_id === "token_concentration");
	assert.ok(tokenFinding);
	for (const findings of [
		[...analysis.findings, analysis.findings[0]],
		[...analysis.findings].reverse(),
		analysis.findings.map((finding) =>
			finding.finding_id === "token_concentration" ? { ...finding, session_ref: "11111111-2222-3333-4444-555555555555" } : finding,
		),
		analysis.findings.map((finding) => ("source_ref" in finding ? { ...finding, source_ref: "agent_activity:foreign" } : finding)),
		analysis.findings.map((finding) =>
			finding.finding_id === "token_concentration" ? { ...finding, share_percent: finding.share_percent - 1 } : finding,
		),
		analysis.findings.map((finding) => (finding.finding_id === "token_concentration" ? { ...finding, metric: "agent_tool_calls" } : finding)),
		[{ finding_id: "unknown", metric: "tokens" }],
	]) {
		const rejected = inspectLocalUsageAnalysisBoundaryForTest(concentrated, findings);
		assert.equal(rejected?.accepted, false);
		assert.deepEqual(rejected?.suggestions, []);
	}
	const concentrationAt = (values) =>
		composeCanonicalLocalUsageDashboard({
			adapter: {
				...adapterWithModel,
				sessionDetailCoverage: { returned: values.length, eligible: values.length, state: "complete" },
				sessions: values.map((value, index) => ({
					...adapterWithModel.sessions[0],
					sessionRef: `019f9174-fec1-78d2-b4be-91402cdc67${String(index).padStart(2, "0")}`,
					tokens: { ...adapterWithModel.sessions[0].tokens, input: value, output: 0 },
					toolCallEvents: value,
				})),
			},
			timezone: "UTC",
			window: { startDate: "2026-08-01", endDate: "2026-08-15" },
		});
	assert.deepEqual(
		concentrationAt([2, 1, 1, 0])
			.suggestions.slice(0, 2)
			.map((entry) => entry.suggestion_id),
		["token_concentration", "tool_concentration"],
	);
	assert.equal(
		concentrationAt([2, 1, 1, 1]).suggestions.some((entry) => entry.suggestion_id.endsWith("_concentration")),
		false,
	);
	assert.equal(
		concentrationAt([10, 1, 1]).suggestions.some((entry) => entry.suggestion_id.endsWith("_concentration")),
		false,
	);
	const partialConcentration = composeCanonicalLocalUsageDashboard({
		adapter: {
			...adapterWithModel,
			sources: adapterWithModel.sources.map((source) => ({ ...source, inventoryState: "partial" })),
			sessionDetailCoverage: { returned: 4, state: "partial" },
			sessions: concentrated.sessions.map((session) => ({
				...adapterWithModel.sessions[0],
				sessionRef: session.session_ref,
				toolCallEvents: session.agent_tool_calls,
			})),
		},
		timezone: "UTC",
		window: { startDate: "2026-08-01", endDate: "2026-08-15" },
	});
	assert.equal(
		partialConcentration.suggestions.some((entry) => entry.suggestion_id === "tool_concentration"),
		false,
	);
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
