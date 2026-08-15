import { createHash } from "node:crypto";
import type { CealAgentAuditAdapterState, CealAgentAuditSession, CealAgentAuditState } from "./agent-audit.js";
import { CEAL_SAFE_MODEL_KEY, CEAL_SAFE_PROFILE_REF, CEAL_SAFE_REF } from "./safe-ref.js";

type LocalUsageObservationState = "complete" | "partial" | "observed_empty" | "unsupported" | "unavailable" | "unreadable";

interface CealLocalUsageDashboardIdentity {
	profileRef?: string;
	instanceRef?: string;
	state: "available" | "unavailable";
}

interface CealLocalUsageDashboardAccess {
	state: "available" | "unavailable";
	authority: "gateway";
	observedAt?: string;
	capabilityCount?: number;
	readCapabilityCount?: number;
	writeCapabilityCount?: number;
	capabilities?: CealLocalUsageCapability[];
}

interface CealLocalUsageCapability {
	capabilityId: string;
	label: string;
	effect: "read" | "write";
	targetRequirement: "required" | "optional" | "none";
	evidenceRequirement: string;
}

interface CealLocalUsageDashboardSession {
	sessionRef: string;
	runtime: "claude" | "codex";
	lastActivityAt: string;
	eventEvidence: "complete" | "partial" | "unreadable" | "not_scanned";
	unparsedLines?: number;
	tokenEvidence: "available" | "unavailable";
	modelKey?: string;
	toolCallEvents?: number;
	tokens?: {
		source: "event_usage_sum" | "runtime_cumulative_last";
		completeness: "full_transcript" | "scanned_prefix";
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
}

export interface CealRuntimeDashboardAdapterInputV1 {
	schemaVersion: "ceal.local_usage_dashboard.codex_input.v1" | "ceal.local_usage_dashboard.claude_input.v1";
	generatedAt: string;
	identity: CealLocalUsageDashboardIdentity;
	sources: Array<{
		ref: "agent_activity:codex" | "agent_activity:claude";
		runtime: "codex" | "claude";
		rootDisplay: "Codex sessions" | "Claude sessions";
		inventoryState: LocalUsageObservationState;
		nonClaims: string[];
	}>;
	sessions: CealLocalUsageDashboardSession[];
	sessionDetailCoverage: { returned: number; eligible?: number; state: LocalUsageObservationState };
	pricing: { state: "unsupported"; authority: "unknown" };
	access: CealLocalUsageDashboardAccess;
	nonClaims: string[];
}

export interface ComposeLocalUsageDashboardInput {
	generatedAt: number;
	agentActivity: CealAgentAuditState;
	identity?: { profileRef: string; instanceRef: string };
	access?: {
		observedAt: string;
		capabilityCount: number;
		readCapabilityCount: number;
		writeCapabilityCount: number;
		capabilities: CealLocalUsageCapability[];
	};
}

export interface CealLocalUsageDashboardV1 {
	schema_version: "ceal.local_usage_dashboard.v1";
	fixture_only: false;
	production_provenance: "ceal_cli_owned_adapter";
	generated_at: string;
	window: { start_date: string; end_date: string };
	timezone: string;
	identity: { state: "available" | "unavailable"; profile_ref?: string; instance_ref?: string };
	sources: Array<{
		source_ref: "agent_activity:codex" | "agent_activity:claude";
		runtime: "codex" | "claude";
		root_display: "Codex sessions" | "Claude sessions";
		observation_state: LocalUsageObservationState;
	}>;
	metric_coverage: Record<"sessions" | "agent_tool_calls" | "tokens" | "estimated_cost", DashboardMetricCoverage>;
	daily: DashboardDailyRow[];
	totals: { sessions: number | null; agent_tool_calls: number | null; tokens: number | null; estimated_cost: string | null };
	sessions: Array<{
		session_ref: string;
		runtime: "codex" | "claude";
		last_activity_at: string;
		event_evidence: CealLocalUsageDashboardSession["eventEvidence"];
		token_evidence: CealLocalUsageDashboardSession["tokenEvidence"];
		agent_tool_calls: number | null;
		tokens: number | null;
		estimated_cost: string | null;
		model_key: string | null;
		comparability_group: "codex:runtime_cumulative_last:v1" | "claude:event_usage_sum:v1";
	}>;
	session_detail_coverage: { returned: number; eligible: number | null; observation_state: LocalUsageObservationState };
	pricing:
		| { observation_state: "unsupported"; authority: "unknown"; reason: "pricing_snapshot_unavailable" }
		| {
				observation_state: "unsupported";
				authority: "local_pricing_snapshot";
				reason: "model_identity_unavailable" | "pricing_rate_unavailable" | "cost_derivation_unavailable";
				currency: string;
		  }
		| {
				observation_state: "complete" | "partial";
				authority: "local_pricing_snapshot";
				reason: "estimated_not_billed";
				currency: string;
				derivation: "per_session_half_up_6dp";
		  };
	access: {
		observation_state: "available" | "unavailable";
		authority: "gateway";
		observed_at?: string;
		capability_count?: number;
		read_capability_count?: number;
		write_capability_count?: number;
		capabilities?: Array<{
			capability_id: string;
			label: string;
			effect: "read" | "write";
			target_requirement: "required" | "optional" | "none";
			evidence_requirement: string;
		}>;
	};
	suggestions: DashboardSuggestion[];
	non_claims: string[];
}

interface DashboardMetricCoverage {
	observation_state: LocalUsageObservationState;
	source_refs: string[];
	effective_window: { start_date: string; end_date: string };
	numerator: number;
	denominator: number | null;
	comparability_group: string;
}

interface DashboardDailyRow {
	date: string;
	sessions: number | null;
	agent_tool_calls: number | null;
	tokens: number | null;
	estimated_cost: string | null;
}

interface DashboardSuggestion {
	suggestion_id: "token_concentration" | "tool_concentration" | "token_coverage_gap" | "tool_coverage_gap" | "cost_unavailable";
	analyzer: { analyzer_id: "ceal.local_usage_rules"; version: "2" };
	recommendation: string;
	rationale: string;
	evidence: { metric: "tokens" | "agent_tool_calls" | "estimated_cost"; source_refs: string[]; session_refs: string[] };
	next_action: { kind: "inspect_sessions" | "review_evidence"; label: string };
}

interface UsageAnalysisInputV1 {
	schema_version: "ceal.local_usage_analysis_input.v1";
	runtime: "codex" | "claude";
	source_ref: "agent_activity:codex" | "agent_activity:claude";
	coverage: { agent_tool_calls: LocalUsageObservationState; tokens: LocalUsageObservationState };
	pricing: CealLocalUsageDashboardV1["pricing"];
	sessions: Array<{ session_ref: string; tokens: number | null; agent_tool_calls: number | null }>;
}

type UsageAnalysisFindingV1 =
	| {
			finding_id: "token_concentration" | "tool_concentration";
			metric: "tokens" | "agent_tool_calls";
			source_ref: string;
			session_ref: string;
			population: number;
			share_percent: number;
	  }
	| {
			finding_id: "token_coverage_gap" | "tool_coverage_gap";
			metric: "tokens" | "agent_tool_calls";
			source_ref: string;
			covered: number;
			returned: number;
	  }
	| {
			finding_id: "cost_unavailable";
			metric: "estimated_cost";
			pricing_reason: Exclude<CealLocalUsageDashboardV1["pricing"]["reason"], "estimated_not_billed">;
	  };

export interface ComposeCanonicalDashboardInput {
	adapter: CealRuntimeDashboardAdapterInputV1;
	timezone: string;
	window: { startDate: string; endDate: string };
	pricingSnapshot?: unknown;
}

export interface CealLocalPricingSnapshotV1 {
	schema_version: "ceal.local_pricing_snapshot.v1";
	snapshot_ref: string;
	revision: string;
	observed_at: string;
	currency: string;
	rates: Array<{
		model_key: string;
		input_per_million: string;
		output_per_million: string;
		cache_read_per_million: string;
		cache_write_per_million: string;
	}>;
}

const SUPPORTED_PRICING_CURRENCIES = new Set(["USD"]);

const COST_NON_CLAIM =
	"Monetary cost requires an accepted local pricing snapshot, complete model identity, and a matching rate; missing cost is not zero.";

export function composeCodexDashboardAdapterInput(input: ComposeLocalUsageDashboardInput): CealRuntimeDashboardAdapterInputV1 {
	return composeRuntimeDashboardAdapterInput(input, "codex");
}

export function composeClaudeDashboardAdapterInput(input: ComposeLocalUsageDashboardInput): CealRuntimeDashboardAdapterInputV1 {
	return composeRuntimeDashboardAdapterInput(input, "claude");
}

function composeRuntimeDashboardAdapterInput(
	input: ComposeLocalUsageDashboardInput,
	runtime: "claude" | "codex",
): CealRuntimeDashboardAdapterInputV1 {
	const adapter = input.agentActivity.adapters.find((entry) => entry.runtime === runtime);
	const state = observationState(adapter);
	const sessions = adapter?.sessions?.map((session) => projectSession(session, runtime)) ?? [];
	return {
		schemaVersion: runtime === "codex" ? "ceal.local_usage_dashboard.codex_input.v1" : "ceal.local_usage_dashboard.claude_input.v1",
		generatedAt: new Date(input.generatedAt).toISOString(),
		identity: input.identity ? { ...input.identity, state: "available" } : { state: "unavailable" },
		sources: [
			{
				ref: runtime === "codex" ? "agent_activity:codex" : "agent_activity:claude",
				runtime,
				rootDisplay: runtime === "codex" ? "Codex sessions" : "Claude sessions",
				inventoryState: state,
				nonClaims: [...input.agentActivity.nonClaims],
			},
		],
		sessions,
		sessionDetailCoverage: {
			returned: sessions.length,
			...(adapter?.sessionCount === undefined || adapter.inventory === "partial" ? {} : { eligible: adapter.sessionCount }),
			state: coverageState(adapter, sessions.length),
		},
		pricing: { state: "unsupported", authority: "unknown" },
		access: input.access ? { state: "available", authority: "gateway", ...input.access } : { state: "unavailable", authority: "gateway" },
		nonClaims: [...input.agentActivity.nonClaims, COST_NON_CLAIM],
	};
}

export function composeCanonicalLocalUsageDashboard(input: ComposeCanonicalDashboardInput): CealLocalUsageDashboardV1 {
	assertLocalDate(input.window.startDate);
	assertLocalDate(input.window.endDate);
	if (input.window.startDate >= input.window.endDate)
		throw new Error("Local usage dashboard window must be a non-empty half-open date range.");
	const generatedAt = Date.parse(input.adapter.generatedAt);
	if (!Number.isFinite(generatedAt)) throw new Error("Local usage dashboard generated_at is invalid.");
	const runtime = input.adapter.sources[0]?.runtime ?? "codex";
	const sourceRef = runtime === "codex" ? "agent_activity:codex" : "agent_activity:claude";
	const sessionGroup = `${runtime}:session_inventory:v1`;
	const toolGroup = `${runtime}:tool_events:v1`;
	const tokenGroup = runtime === "codex" ? "codex:runtime_cumulative_last:v1" : "claude:event_usage_sum:v1";
	const sessions = input.adapter.sessions.filter((session) => {
		const instant = Date.parse(session.lastActivityAt);
		if (!Number.isFinite(instant) || instant > generatedAt) return false;
		const date = localDate(instant, input.timezone);
		return date >= input.window.startDate && date < input.window.endDate;
	});
	const rows = new Map<string, DashboardDailyRow>();
	const toolObservations = new Map<string, number>();
	const tokenObservations = new Map<string, number>();
	for (const session of sessions) {
		const date = localDate(Date.parse(session.lastActivityAt), input.timezone);
		const row = rows.get(date) ?? { date, sessions: 0, agent_tool_calls: 0, tokens: 0, estimated_cost: null };
		row.sessions = (row.sessions ?? 0) + 1;
		const toolCalls = session.eventEvidence === "complete" ? (session.toolCallEvents ?? 0) : null;
		if (toolCalls !== null) {
			row.agent_tool_calls = (row.agent_tool_calls ?? 0) + toolCalls;
			toolObservations.set(date, (toolObservations.get(date) ?? 0) + 1);
		}
		const tokens = sessionTokenTotal(session);
		if (tokens !== null) {
			row.tokens = (row.tokens ?? 0) + tokens;
			tokenObservations.set(date, (tokenObservations.get(date) ?? 0) + 1);
		}
		rows.set(date, row);
	}
	for (const [date, row] of rows) {
		if (!toolObservations.has(date)) row.agent_tool_calls = null;
		if (!tokenObservations.has(date)) row.tokens = null;
	}
	const daily = [...rows.values()].sort((left, right) => left.date.localeCompare(right.date));
	const sourceState = input.adapter.sources[0]?.inventoryState ?? "unavailable";
	const eligible = sourceState === "complete" || sourceState === "observed_empty" ? sessions.length : null;
	const sessionState = effectiveCoverageState(sourceState, sessions.length, eligible);
	const toolValues = sessions.filter((session) => session.eventEvidence === "complete").length;
	const toolState = metricState(sessionState, toolValues, sessions.length);
	const tokenValues = sessions.filter((session) => sessionTokenTotal(session) !== null).length;
	const tokenState = metricState(sessionState, tokenValues, sessions.length);
	const effectiveWindow = { start_date: input.window.startDate, end_date: input.window.endDate };
	const pricingSnapshot = decodeLocalPricingSnapshot(input.pricingSnapshot);
	const pricedSessions = sessions.filter((session) => sessionTokenTotal(session) !== null);
	const completeModelCoverage = pricedSessions.length > 0 && pricedSessions.every((session) => session.modelKey !== undefined);
	const completeRateCoverage =
		completeModelCoverage && pricedSessions.every((session) => pricingSnapshot?.rates.some((rate) => rate.model_key === session.modelKey));
	const sessionCosts = new Map<string, string>();
	if (pricingSnapshot && runtime === "codex") {
		for (const session of pricedSessions) {
			const rate = pricingSnapshot.rates.find((candidate) => candidate.model_key === session.modelKey);
			const amount = rate ? deriveSessionCost(session, rate) : null;
			if (amount !== null) sessionCosts.set(session.sessionRef, amount);
		}
	}
	for (const row of daily) {
		const costs = sessions
			.filter((session) => localDate(Date.parse(session.lastActivityAt), input.timezone) === row.date)
			.map((session) => sessionCosts.get(session.sessionRef))
			.filter((amount): amount is string => amount !== undefined);
		row.estimated_cost = costs.length > 0 ? sumDecimalAmounts(costs) : null;
	}
	const costState: LocalUsageObservationState =
		sessionCosts.size === 0 ? "unsupported" : tokenState === "complete" && sessionCosts.size === sessions.length ? "complete" : "partial";
	const pricing: CealLocalUsageDashboardV1["pricing"] = pricingSnapshot
		? sessionCosts.size > 0
			? {
					observation_state: costState as "complete" | "partial",
					authority: "local_pricing_snapshot",
					reason: "estimated_not_billed",
					currency: pricingSnapshot.currency,
					derivation: "per_session_half_up_6dp",
				}
			: {
					observation_state: "unsupported",
					authority: "local_pricing_snapshot",
					reason: !completeModelCoverage
						? "model_identity_unavailable"
						: completeRateCoverage
							? "cost_derivation_unavailable"
							: "pricing_rate_unavailable",
					currency: pricingSnapshot.currency,
				}
		: { observation_state: "unsupported", authority: "unknown", reason: "pricing_snapshot_unavailable" };
	const suggestions = buildUsageSuggestions(
		sessions.map((session) => ({
			sessionRef: session.sessionRef,
			tokens: sessionTokenTotal(session),
			toolCalls: session.eventEvidence === "complete" ? (session.toolCallEvents ?? 0) : null,
		})),
		toolState,
		tokenState,
		pricing,
		sourceRef,
	);
	return {
		schema_version: "ceal.local_usage_dashboard.v1",
		fixture_only: false,
		production_provenance: "ceal_cli_owned_adapter",
		generated_at: input.adapter.generatedAt,
		window: effectiveWindow,
		timezone: input.timezone,
		identity:
			input.adapter.identity.state === "available"
				? { state: "available", profile_ref: input.adapter.identity.profileRef, instance_ref: input.adapter.identity.instanceRef }
				: { state: "unavailable" },
		sources: input.adapter.sources.map((source) => ({
			source_ref: source.ref,
			runtime: source.runtime,
			root_display: source.rootDisplay,
			observation_state: source.inventoryState,
		})),
		metric_coverage: {
			sessions: metricCoverage(sessionState, sessions.length, eligible, effectiveWindow, sessionGroup, sourceRef),
			agent_tool_calls: metricCoverage(toolState, toolValues, sessions.length, effectiveWindow, toolGroup, sourceRef),
			tokens: metricCoverage(tokenState, tokenValues, sessions.length, effectiveWindow, tokenGroup, sourceRef),
			estimated_cost: metricCoverage(
				costState,
				sessionCosts.size,
				sessions.length,
				effectiveWindow,
				pricingSnapshot && runtime === "codex"
					? `pricing:${pricingSnapshot.currency}:${createHash("sha256").update(pricingSnapshot.revision).digest("hex").slice(0, 16)}:per_session_half_up_6dp`
					: "unsupported",
				sourceRef,
			),
		},
		daily,
		totals: {
			sessions: coveredTotal(daily, "sessions", sessionState, sessions.length),
			agent_tool_calls: coveredTotal(daily, "agent_tool_calls", toolState, toolValues),
			tokens: coveredTotal(daily, "tokens", tokenState, tokenValues),
			estimated_cost: sessionCosts.size > 0 ? sumDecimalAmounts([...sessionCosts.values()]) : null,
		},
		sessions: sessions.map((session) => ({
			session_ref: session.sessionRef,
			runtime: session.runtime,
			last_activity_at: session.lastActivityAt,
			event_evidence: session.eventEvidence,
			token_evidence: session.tokenEvidence,
			agent_tool_calls: session.eventEvidence === "complete" ? (session.toolCallEvents ?? 0) : null,
			tokens: sessionTokenTotal(session),
			estimated_cost: sessionCosts.get(session.sessionRef) ?? null,
			model_key: session.modelKey ?? null,
			comparability_group: tokenGroup,
		})),
		session_detail_coverage: { returned: sessions.length, eligible, observation_state: sessionState },
		pricing,
		access:
			input.adapter.access.state === "available"
				? {
						observation_state: "available",
						authority: "gateway",
						observed_at: input.adapter.access.observedAt,
						capability_count: input.adapter.access.capabilityCount,
						read_capability_count: input.adapter.access.readCapabilityCount,
						write_capability_count: input.adapter.access.writeCapabilityCount,
						capabilities: (input.adapter.access.capabilities ?? []).map((capability) => ({
							capability_id: capability.capabilityId,
							label: capability.label,
							effect: capability.effect,
							target_requirement: capability.targetRequirement,
							evidence_requirement: capability.evidenceRequirement,
						})),
					}
				: { observation_state: "unavailable", authority: "gateway" },
		suggestions,
		non_claims: [...input.adapter.nonClaims],
	};
}

export function decodeLocalPricingSnapshot(value: unknown): CealLocalPricingSnapshotV1 | null {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["schema_version", "snapshot_ref", "revision", "observed_at", "currency", "rates"]) ||
		value.schema_version !== "ceal.local_pricing_snapshot.v1" ||
		typeof value.snapshot_ref !== "string" ||
		!/^pricing:[A-Za-z0-9._:-]{1,120}$/u.test(value.snapshot_ref) ||
		typeof value.revision !== "string" ||
		!/^pricing-rev-[A-Za-z0-9._:-]{1,112}$/u.test(value.revision) ||
		typeof value.observed_at !== "string" ||
		!validCanonicalInstant(value.observed_at) ||
		typeof value.currency !== "string" ||
		!SUPPORTED_PRICING_CURRENCIES.has(value.currency) ||
		!Array.isArray(value.rates) ||
		value.rates.length === 0 ||
		value.rates.length > 256
	)
		return null;
	const seen = new Set<string>();
	for (const rate of value.rates) {
		if (
			!isRecord(rate) ||
			!hasExactKeys(rate, ["model_key", "input_per_million", "output_per_million", "cache_read_per_million", "cache_write_per_million"]) ||
			typeof rate.model_key !== "string" ||
			!CEAL_SAFE_REF.test(rate.model_key) ||
			seen.has(rate.model_key) ||
			![rate.input_per_million, rate.output_per_million, rate.cache_read_per_million, rate.cache_write_per_million].every(validDecimalRate)
		)
			return null;
		seen.add(rate.model_key);
	}
	return JSON.parse(JSON.stringify(value)) as CealLocalPricingSnapshotV1;
}

function buildUsageSuggestions(
	sessions: Array<{ sessionRef: string; tokens: number | null; toolCalls: number | null }>,
	toolState: LocalUsageObservationState,
	tokenState: LocalUsageObservationState,
	pricing: CealLocalUsageDashboardV1["pricing"],
	sourceRef: "agent_activity:codex" | "agent_activity:claude",
): DashboardSuggestion[] {
	const analysisInput = usageAnalysisInput(
		sessions.map((session) => ({
			session_ref: session.sessionRef,
			tokens: session.tokens,
			agent_tool_calls: session.toolCalls,
		})),
		toolState,
		tokenState,
		pricing,
		sourceRef,
	);
	return renderUsageFindings(analysisInput, analyzeUsage(analysisInput)).slice(0, 4);
}

function usageAnalysisInput(
	sessions: UsageAnalysisInputV1["sessions"],
	toolState: LocalUsageObservationState,
	tokenState: LocalUsageObservationState,
	pricing: CealLocalUsageDashboardV1["pricing"],
	sourceRef: "agent_activity:codex" | "agent_activity:claude",
): UsageAnalysisInputV1 {
	return {
		schema_version: "ceal.local_usage_analysis_input.v1",
		runtime: sourceRef === "agent_activity:codex" ? "codex" : "claude",
		source_ref: sourceRef,
		coverage: { agent_tool_calls: toolState, tokens: tokenState },
		pricing,
		sessions,
	};
}

function analyzeUsage(input: UsageAnalysisInputV1): UsageAnalysisFindingV1[] {
	const sessions = input.sessions;
	const sourceRef = input.source_ref;
	const tokenState = input.coverage.tokens;
	const toolState = input.coverage.agent_tool_calls;
	const findings: UsageAnalysisFindingV1[] = [];
	const tokenSessions = sessions.filter(
		(entry): entry is { session_ref: string; tokens: number; agent_tool_calls: number | null } => entry.tokens !== null,
	);
	const tokenValues = tokenSessions.length;
	const tokenTotal = tokenSessions.reduce((sum, entry) => sum + entry.tokens, 0);
	const highest = tokenSessions.reduce<(typeof tokenSessions)[number] | null>(
		(current, entry) => (current === null || entry.tokens > current.tokens ? entry : current),
		null,
	);
	if (
		tokenState === "complete" &&
		tokenSessions.length === sessions.length &&
		tokenSessions.length >= 4 &&
		highest &&
		tokenTotal > 0 &&
		highest.tokens * 2 >= tokenTotal
	) {
		const share = Math.round((highest.tokens / tokenTotal) * 100);
		findings.push({
			finding_id: "token_concentration",
			metric: "tokens",
			source_ref: sourceRef,
			session_ref: highest.session_ref,
			population: tokenSessions.length,
			share_percent: share,
		});
	}
	const toolSessions = sessions.filter(
		(entry): entry is { session_ref: string; tokens: number | null; agent_tool_calls: number } => entry.agent_tool_calls !== null,
	);
	const toolTotal = toolSessions.reduce((sum, entry) => sum + entry.agent_tool_calls, 0);
	const highestTool = toolSessions.reduce<(typeof toolSessions)[number] | null>(
		(current, entry) => (current === null || entry.agent_tool_calls > current.agent_tool_calls ? entry : current),
		null,
	);
	if (
		toolState === "complete" &&
		toolSessions.length === sessions.length &&
		toolSessions.length >= 4 &&
		highestTool &&
		toolTotal > 0 &&
		highestTool.agent_tool_calls * 2 >= toolTotal
	) {
		const share = Math.round((highestTool.agent_tool_calls / toolTotal) * 100);
		findings.push({
			finding_id: "tool_concentration",
			metric: "agent_tool_calls",
			source_ref: sourceRef,
			session_ref: highestTool.session_ref,
			population: toolSessions.length,
			share_percent: share,
		});
	}
	if (tokenValues < sessions.length)
		findings.push({
			finding_id: "token_coverage_gap",
			metric: "tokens",
			source_ref: sourceRef,
			covered: tokenValues,
			returned: sessions.length,
		});
	const toolValues = toolSessions.length;
	if (toolValues < sessions.length)
		findings.push({
			finding_id: "tool_coverage_gap",
			metric: "agent_tool_calls",
			source_ref: sourceRef,
			covered: toolValues,
			returned: sessions.length,
		});
	if (tokenValues > 0 && input.pricing.observation_state === "unsupported")
		findings.push({
			finding_id: "cost_unavailable",
			metric: "estimated_cost",
			pricing_reason: input.pricing.reason as Exclude<typeof input.pricing.reason, "estimated_not_billed">,
		});
	return findings;
}

function renderUsageFindings(input: UsageAnalysisInputV1, findings: UsageAnalysisFindingV1[]): DashboardSuggestion[] {
	if (!validUsageFindings(input, findings)) return [];
	const analyzer = { analyzer_id: "ceal.local_usage_rules" as const, version: "2" as const };
	return findings.map((finding) => {
		if (finding.finding_id === "token_concentration")
			return {
				suggestion_id: finding.finding_id,
				analyzer,
				recommendation: "Inspect the highest-token session in this fully covered set.",
				rationale: `One of ${finding.population} fully covered sessions accounts for ${finding.share_percent}% of their token total; this is concentration, not a productivity judgment.`,
				evidence: { metric: finding.metric, source_refs: [finding.source_ref], session_refs: [finding.session_ref] },
				next_action: { kind: "inspect_sessions", label: "Inspect the referenced session" },
			};
		if (finding.finding_id === "tool_concentration")
			return {
				suggestion_id: finding.finding_id,
				analyzer,
				recommendation: "Inspect the session with the highest tool-call concentration.",
				rationale: `One of ${finding.population} fully covered sessions accounts for ${finding.share_percent}% of observed tool calls; this is concentration, not a productivity or repetition judgment.`,
				evidence: { metric: finding.metric, source_refs: [finding.source_ref], session_refs: [finding.session_ref] },
				next_action: { kind: "inspect_sessions", label: "Inspect the referenced session" },
			};
		if (finding.finding_id === "token_coverage_gap")
			return {
				suggestion_id: finding.finding_id,
				analyzer,
				recommendation: "Treat token totals as a covered subset until more sessions expose token evidence.",
				rationale: `${finding.covered} of ${finding.returned} returned sessions carry comparable ${input.runtime === "codex" ? "Codex" : "Claude"} token evidence.`,
				evidence: { metric: finding.metric, source_refs: [finding.source_ref], session_refs: [] },
				next_action: { kind: "review_evidence", label: "Review token coverage" },
			};
		if (finding.finding_id === "tool_coverage_gap")
			return {
				suggestion_id: finding.finding_id,
				analyzer,
				recommendation: "Do not optimize tool usage from the current total alone.",
				rationale: `${finding.covered} of ${finding.returned} returned sessions have complete tool-event evidence.`,
				evidence: { metric: finding.metric, source_refs: [finding.source_ref], session_refs: [] },
				next_action: { kind: "review_evidence", label: "Review tool-call coverage" },
			};
		if (finding.finding_id === "cost_unavailable")
			return {
				suggestion_id: finding.finding_id,
				analyzer,
				recommendation: "Use token evidence until monetary cost can be derived from owned inputs.",
				rationale: pricingRationale(finding.pricing_reason),
				evidence: { metric: finding.metric, source_refs: [], session_refs: [] },
				next_action: { kind: "review_evidence", label: "Review pricing status" },
			};
		throw new Error("Unhandled local usage finding");
	});
}

function validUsageFindings(input: UsageAnalysisInputV1, findings: unknown): findings is UsageAnalysisFindingV1[] {
	if (!Array.isArray(findings)) return false;
	try {
		return JSON.stringify(findings) === JSON.stringify(analyzeUsage(input));
	} catch {
		return false;
	}
}

/** @testOnly */
export function inspectLocalUsageAnalysisBoundaryForTest(
	datasetValue: unknown,
	suppliedFindings?: unknown,
): { input: UsageAnalysisInputV1; findings: UsageAnalysisFindingV1[]; accepted: boolean; suggestions: DashboardSuggestion[] } | null {
	const dataset = decodeProductionLocalUsageDashboard(datasetValue);
	if (!dataset) return null;
	const sourceRef = dataset.sources[0]?.source_ref;
	if (sourceRef !== "agent_activity:codex" && sourceRef !== "agent_activity:claude") return null;
	const input = usageAnalysisInput(
		dataset.sessions.map((session) => ({
			session_ref: session.session_ref,
			tokens: session.tokens,
			agent_tool_calls: session.agent_tool_calls,
		})),
		dataset.metric_coverage.agent_tool_calls.observation_state,
		dataset.metric_coverage.tokens.observation_state,
		dataset.pricing,
		sourceRef,
	);
	const findings = analyzeUsage(input);
	const candidate = suppliedFindings === undefined ? findings : suppliedFindings;
	const accepted = validUsageFindings(input, candidate);
	return { input, findings, accepted, suggestions: accepted ? renderUsageFindings(input, candidate).slice(0, 4) : [] };
}

function pricingRationale(reason: Exclude<CealLocalUsageDashboardV1["pricing"]["reason"], "estimated_not_billed">): string {
	if (reason === "pricing_snapshot_unavailable") return "No production pricing snapshot was supplied; missing cost is not zero.";
	if (reason === "model_identity_unavailable")
		return "Covered token observations do not all carry complete model identity; missing cost is not zero.";
	if (reason === "pricing_rate_unavailable")
		return "The accepted pricing snapshot lacks a matching rate for at least one covered model; missing cost is not zero.";
	return "Pricing, model, and rate evidence are present, but decimal cost derivation is not implemented; missing cost is not zero.";
}

export function decodeProductionLocalUsageDashboard(value: unknown): CealLocalUsageDashboardV1 | null {
	if (!isRecord(value)) return null;
	const record = value;
	if (
		!hasExactKeys(record, [
			"schema_version",
			"fixture_only",
			"production_provenance",
			"generated_at",
			"window",
			"timezone",
			"identity",
			"sources",
			"metric_coverage",
			"daily",
			"totals",
			"sessions",
			"session_detail_coverage",
			"pricing",
			"access",
			"suggestions",
			"non_claims",
		])
	)
		return null;
	if (record.schema_version !== "ceal.local_usage_dashboard.v1") return null;
	if (record.fixture_only !== false || record.production_provenance !== "ceal_cli_owned_adapter") return null;
	if (typeof record.generated_at !== "string" || !Number.isFinite(Date.parse(record.generated_at))) return null;
	if (typeof record.timezone !== "string" || !validTimezone(record.timezone) || !validWireWindow(record.window)) return null;
	if (!validIdentity(record.identity) || !validSources(record.sources) || !validMetricCoverage(record.metric_coverage)) return null;
	if (!validDaily(record.daily) || !validTotals(record.totals) || !validSessions(record.sessions)) return null;
	if (!validSessionDetailCoverage(record.session_detail_coverage) || !validPricing(record.pricing) || !validAccess(record.access))
		return null;
	if (!validSuggestions(record.suggestions)) return null;
	if (
		!Array.isArray(record.non_claims) ||
		!record.non_claims.every((entry) => typeof entry === "string" && entry.length <= 1000 && !looksLikeAbsolutePath(entry))
	)
		return null;
	if (!validDatasetSemantics(record as unknown as CealLocalUsageDashboardV1)) return null;
	return JSON.parse(JSON.stringify(record)) as CealLocalUsageDashboardV1;
}

export function defaultLocalUsageWindow(now: number, timezone: string): { startDate: string; endDate: string } {
	const current = localDate(now, timezone);
	const endDate = shiftLocalDate(current, 1);
	return { startDate: shiftLocalDate(endDate, -365), endDate };
}

function assertLocalDate(value: string): void {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || shiftLocalDate(value, 0) !== value) throw new Error("Invalid local dashboard date.");
}

function localDate(instant: number, timezone: string): string {
	const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
		instant,
	);
	const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	return `${values.year}-${values.month}-${values.day}`;
}

function shiftLocalDate(value: string, days: number): string {
	const date = new Date(`${value}T00:00:00.000Z`);
	if (!Number.isFinite(date.valueOf())) return "invalid";
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function sessionTokenTotal(session: CealLocalUsageDashboardSession): number | null {
	if (!session.tokens || session.tokens.input === undefined || session.tokens.output === undefined) return null;
	return session.tokens.input + session.tokens.output;
}

function effectiveCoverageState(source: LocalUsageObservationState, returned: number, eligible: number | null): LocalUsageObservationState {
	if (source !== "complete" && source !== "observed_empty") return source;
	if (returned === 0 && eligible === 0) return "observed_empty";
	return eligible === returned ? "complete" : "partial";
}

function metricState(sessionState: LocalUsageObservationState, numerator: number, denominator: number): LocalUsageObservationState {
	if (sessionState === "unavailable" || sessionState === "unreadable") return sessionState;
	if (denominator === 0) return sessionState === "observed_empty" ? "observed_empty" : "unavailable";
	return numerator === denominator && sessionState === "complete" ? "complete" : numerator > 0 ? "partial" : "unavailable";
}

function metricCoverage(
	observationState: LocalUsageObservationState,
	numerator: number,
	denominator: number | null,
	effectiveWindow: { start_date: string; end_date: string },
	comparabilityGroup: string,
	sourceRef: "agent_activity:codex" | "agent_activity:claude",
): DashboardMetricCoverage {
	return {
		observation_state: observationState,
		source_refs: [sourceRef],
		effective_window: effectiveWindow,
		numerator,
		denominator,
		comparability_group: comparabilityGroup,
	};
}

function coveredTotal(
	rows: DashboardDailyRow[],
	key: "sessions" | "agent_tool_calls" | "tokens",
	state: LocalUsageObservationState,
	numerator: number,
): number | null {
	if (state === "unsupported" || state === "unavailable" || state === "unreadable" || (state === "partial" && numerator === 0)) return null;
	let total = 0;
	for (const row of rows) {
		const value = row[key];
		if (value !== null) total += value;
	}
	return total;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(record).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validWireWindow(value: unknown): value is { start_date: string; end_date: string } {
	if (!isRecord(value) || !hasExactKeys(value, ["start_date", "end_date"])) return false;
	return (
		typeof value.start_date === "string" &&
		typeof value.end_date === "string" &&
		validLocalDate(value.start_date) &&
		validLocalDate(value.end_date) &&
		value.start_date < value.end_date
	);
}

function validLocalDate(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/u.test(value) && shiftLocalDate(value, 0) === value;
}

function validTimezone(value: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
		return true;
	} catch {
		return false;
	}
}

function validIdentity(value: unknown): boolean {
	if (!isRecord(value) || (value.state !== "available" && value.state !== "unavailable")) return false;
	if (value.state === "unavailable") return hasExactKeys(value, ["state"]);
	return (
		hasExactKeys(value, ["state", "profile_ref", "instance_ref"]) &&
		typeof value.profile_ref === "string" &&
		typeof value.instance_ref === "string" &&
		CEAL_SAFE_PROFILE_REF.test(value.profile_ref) &&
		CEAL_SAFE_REF.test(value.instance_ref)
	);
}

function validSources(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.length === 1 &&
		value.every(
			(entry) =>
				isRecord(entry) &&
				hasExactKeys(entry, ["source_ref", "runtime", "root_display", "observation_state"]) &&
				((entry.source_ref === "agent_activity:codex" && entry.runtime === "codex" && entry.root_display === "Codex sessions") ||
					(entry.source_ref === "agent_activity:claude" && entry.runtime === "claude" && entry.root_display === "Claude sessions")) &&
				validState(entry.observation_state),
		)
	);
}

function validMetricCoverage(value: unknown): boolean {
	if (!isRecord(value) || !hasExactKeys(value, ["sessions", "agent_tool_calls", "tokens", "estimated_cost"])) return false;
	return Object.values(value).every(
		(entry) =>
			isRecord(entry) &&
			hasExactKeys(entry, ["observation_state", "source_refs", "effective_window", "numerator", "denominator", "comparability_group"]) &&
			validState(entry.observation_state) &&
			Array.isArray(entry.source_refs) &&
			entry.source_refs.length === 1 &&
			(entry.source_refs[0] === "agent_activity:codex" || entry.source_refs[0] === "agent_activity:claude") &&
			validWireWindow(entry.effective_window) &&
			nonNegativeInteger(entry.numerator) &&
			(entry.denominator === null || nonNegativeInteger(entry.denominator)) &&
			typeof entry.comparability_group === "string" &&
			CEAL_SAFE_REF.test(entry.comparability_group),
	);
}

function validDaily(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.every(
			(entry) =>
				isRecord(entry) &&
				hasExactKeys(entry, ["date", "sessions", "agent_tool_calls", "tokens", "estimated_cost"]) &&
				typeof entry.date === "string" &&
				validLocalDate(entry.date) &&
				metricNumber(entry.sessions) &&
				metricNumber(entry.agent_tool_calls) &&
				metricNumber(entry.tokens) &&
				decimalAmount(entry.estimated_cost),
		)
	);
}

function validTotals(value: unknown): boolean {
	return (
		isRecord(value) &&
		hasExactKeys(value, ["sessions", "agent_tool_calls", "tokens", "estimated_cost"]) &&
		metricNumber(value.sessions) &&
		metricNumber(value.agent_tool_calls) &&
		metricNumber(value.tokens) &&
		decimalAmount(value.estimated_cost)
	);
}

function validSessions(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.every(
			(entry) =>
				isRecord(entry) &&
				hasExactKeys(entry, [
					"session_ref",
					"runtime",
					"last_activity_at",
					"event_evidence",
					"token_evidence",
					"agent_tool_calls",
					"tokens",
					"estimated_cost",
					"model_key",
					"comparability_group",
				]) &&
				typeof entry.session_ref === "string" &&
				/^[0-9a-f-]{36}$/u.test(entry.session_ref) &&
				(entry.runtime === "codex" || entry.runtime === "claude") &&
				typeof entry.last_activity_at === "string" &&
				Number.isFinite(Date.parse(entry.last_activity_at)) &&
				["complete", "partial", "unreadable", "not_scanned"].includes(String(entry.event_evidence)) &&
				["available", "unavailable"].includes(String(entry.token_evidence)) &&
				metricNumber(entry.agent_tool_calls) &&
				metricNumber(entry.tokens) &&
				decimalAmount(entry.estimated_cost) &&
				(entry.model_key === null || (typeof entry.model_key === "string" && CEAL_SAFE_MODEL_KEY.test(entry.model_key))) &&
				(entry.comparability_group === "codex:runtime_cumulative_last:v1" || entry.comparability_group === "claude:event_usage_sum:v1"),
		)
	);
}

function validSessionDetailCoverage(value: unknown): boolean {
	return (
		isRecord(value) &&
		hasExactKeys(value, ["returned", "eligible", "observation_state"]) &&
		nonNegativeInteger(value.returned) &&
		(value.eligible === null || nonNegativeInteger(value.eligible)) &&
		validState(value.observation_state)
	);
}

function validPricing(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (value.reason === "estimated_not_billed")
		return (
			(value.observation_state === "complete" || value.observation_state === "partial") &&
			value.authority === "local_pricing_snapshot" &&
			hasExactKeys(value, ["observation_state", "authority", "reason", "currency", "derivation"]) &&
			typeof value.currency === "string" &&
			SUPPORTED_PRICING_CURRENCIES.has(value.currency) &&
			value.derivation === "per_session_half_up_6dp"
		);
	if (value.observation_state !== "unsupported") return false;
	if (value.authority === "unknown")
		return hasExactKeys(value, ["observation_state", "authority", "reason"]) && value.reason === "pricing_snapshot_unavailable";
	return (
		value.authority === "local_pricing_snapshot" &&
		hasExactKeys(value, ["observation_state", "authority", "reason", "currency"]) &&
		["model_identity_unavailable", "pricing_rate_unavailable", "cost_derivation_unavailable"].includes(String(value.reason)) &&
		typeof value.currency === "string" &&
		SUPPORTED_PRICING_CURRENCIES.has(value.currency)
	);
}

function validAccess(value: unknown): boolean {
	if (!isRecord(value) || value.authority !== "gateway") return false;
	if (value.observation_state === "unavailable") return hasExactKeys(value, ["observation_state", "authority"]);
	if (!Array.isArray(value.capabilities)) return false;
	const capabilityIds = value.capabilities
		.filter(isRecord)
		.map((capability) => capability.capability_id)
		.filter((capabilityId): capabilityId is string => typeof capabilityId === "string");
	return (
		value.observation_state === "available" &&
		hasExactKeys(value, [
			"observation_state",
			"authority",
			"observed_at",
			"capability_count",
			"read_capability_count",
			"write_capability_count",
			"capabilities",
		]) &&
		typeof value.observed_at === "string" &&
		Number.isFinite(Date.parse(value.observed_at)) &&
		nonNegativeInteger(value.capability_count) &&
		nonNegativeInteger(value.read_capability_count) &&
		nonNegativeInteger(value.write_capability_count) &&
		value.capabilities.length === value.capability_count &&
		value.capabilities.length <= 128 &&
		value.capabilities.every(validCapability) &&
		new Set(capabilityIds).size === value.capabilities.length &&
		value.read_capability_count + value.write_capability_count === value.capability_count &&
		value.capabilities.filter((entry) => isRecord(entry) && entry.effect === "read").length === value.read_capability_count
	);
}

function validSuggestions(value: unknown): boolean {
	if (!Array.isArray(value) || value.length > 4) return false;
	const ids = new Set<string>();
	for (const entry of value) {
		if (
			!isRecord(entry) ||
			!hasExactKeys(entry, ["suggestion_id", "analyzer", "recommendation", "rationale", "evidence", "next_action"]) ||
			!["token_concentration", "tool_concentration", "token_coverage_gap", "tool_coverage_gap", "cost_unavailable"].includes(
				String(entry.suggestion_id),
			) ||
			ids.has(String(entry.suggestion_id)) ||
			!isRecord(entry.analyzer) ||
			!hasExactKeys(entry.analyzer, ["analyzer_id", "version"]) ||
			entry.analyzer.analyzer_id !== "ceal.local_usage_rules" ||
			entry.analyzer.version !== "2" ||
			!boundedDisplayText(entry.recommendation, 240) ||
			!boundedDisplayText(entry.rationale, 320) ||
			!isRecord(entry.evidence) ||
			!hasExactKeys(entry.evidence, ["metric", "source_refs", "session_refs"]) ||
			!["tokens", "agent_tool_calls", "estimated_cost"].includes(String(entry.evidence.metric)) ||
			!Array.isArray(entry.evidence.source_refs) ||
			!entry.evidence.source_refs.every((ref) => typeof ref === "string" && CEAL_SAFE_REF.test(ref)) ||
			!Array.isArray(entry.evidence.session_refs) ||
			!entry.evidence.session_refs.every((ref) => typeof ref === "string" && /^[0-9a-f-]{36}$/u.test(ref)) ||
			!isRecord(entry.next_action) ||
			!hasExactKeys(entry.next_action, ["kind", "label"]) ||
			!(["inspect_sessions", "review_evidence"] as unknown[]).includes(entry.next_action.kind) ||
			!boundedDisplayText(entry.next_action.label, 120)
		)
			return false;
		ids.add(String(entry.suggestion_id));
	}
	return true;
}

function boundedDisplayText(value: unknown, maxLength: number): value is string {
	return typeof value === "string" && value.length >= 1 && value.length <= maxLength && !looksLikeAbsolutePath(value);
}

function validCapability(value: unknown): boolean {
	return (
		isRecord(value) &&
		hasExactKeys(value, ["capability_id", "label", "effect", "target_requirement", "evidence_requirement"]) &&
		typeof value.capability_id === "string" &&
		CEAL_SAFE_REF.test(value.capability_id) &&
		typeof value.label === "string" &&
		value.label.length >= 1 &&
		value.label.length <= 128 &&
		!looksLikeAbsolutePath(value.label) &&
		(value.effect === "read" || value.effect === "write") &&
		(value.target_requirement === "required" || value.target_requirement === "optional" || value.target_requirement === "none") &&
		typeof value.evidence_requirement === "string" &&
		CEAL_SAFE_REF.test(value.evidence_requirement)
	);
}

function validState(value: unknown): value is LocalUsageObservationState {
	return ["complete", "partial", "observed_empty", "unsupported", "unavailable", "unreadable"].includes(String(value));
}

function nonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function metricNumber(value: unknown): boolean {
	return value === null || nonNegativeInteger(value);
}

function decimalAmount(value: unknown): boolean {
	return value === null || (typeof value === "string" && /^(?:0|[1-9][0-9]{0,15})(?:[.][0-9]{1,6})?$/u.test(value));
}

function validDecimalRate(value: unknown): boolean {
	return typeof value === "string" && /^(?:0|[1-9][0-9]{0,5})(?:[.][0-9]{1,9})?$/u.test(value);
}

function deriveSessionCost(session: CealLocalUsageDashboardSession, rate: CealLocalPricingSnapshotV1["rates"][number]): string | null {
	if (!session.tokens) return null;
	const input = session.tokens.input ?? 0;
	const cacheRead = session.tokens.cacheRead ?? 0;
	if (cacheRead > input) return null;
	const categories: Array<[number, string]> = [
		[input - cacheRead, rate.input_per_million],
		[session.tokens.output ?? 0, rate.output_per_million],
		[cacheRead, rate.cache_read_per_million],
		[session.tokens.cacheWrite ?? 0, rate.cache_write_per_million],
	];
	let scaled = 0n;
	for (const [tokens, decimal] of categories) scaled += BigInt(tokens) * decimalToScale9(decimal);
	const micros = (scaled + 500_000_000n) / 1_000_000_000n;
	if (micros > BigInt(Number.MAX_SAFE_INTEGER)) return null;
	return microsToDecimal(micros);
}

function decimalToScale9(value: string): bigint {
	const [whole, fraction = ""] = value.split(".");
	return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
}

function decimalToMicros(value: string): bigint {
	const [whole, fraction = ""] = value.split(".");
	return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function microsToDecimal(value: bigint): string {
	const whole = value / 1_000_000n;
	const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
	return fraction ? `${whole}.${fraction}` : whole.toString();
}

function sumDecimalAmounts(values: string[]): string {
	return microsToDecimal(values.reduce((sum, value) => sum + decimalToMicros(value), 0n));
}

function validCanonicalInstant(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$/u.test(value)) return false;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function looksLikeAbsolutePath(value: string): boolean {
	return /(^|\s)(?:\/[A-Za-z0-9._-]|[A-Za-z]:[\\/])/u.test(value);
}

function validDatasetSemantics(dataset: CealLocalUsageDashboardV1): boolean {
	const source = dataset.sources[0];
	if (!source) return false;
	const runtime = source.runtime;
	const sourceRef = runtime === "codex" ? "agent_activity:codex" : "agent_activity:claude";
	const tokenGroup = runtime === "codex" ? "codex:runtime_cumulative_last:v1" : "claude:event_usage_sum:v1";
	if (
		source.source_ref !== sourceRef ||
		dataset.sessions.some((session) => session.runtime !== runtime || session.comparability_group !== tokenGroup)
	)
		return false;
	if (Object.values(dataset.metric_coverage).some((entry) => entry.source_refs.length !== 1 || entry.source_refs[0] !== sourceRef))
		return false;
	if (
		dataset.metric_coverage.sessions.comparability_group !== `${runtime}:session_inventory:v1` ||
		dataset.metric_coverage.agent_tool_calls.comparability_group !== `${runtime}:tool_events:v1` ||
		dataset.metric_coverage.tokens.comparability_group !== tokenGroup
	)
		return false;
	if (
		runtime === "claude" &&
		(dataset.pricing.reason === "estimated_not_billed" || dataset.sessions.some((session) => session.model_key !== null))
	)
		return false;
	const { start_date: startDate, end_date: endDate } = dataset.window;
	let previousDate = "";
	const seenDates = new Set<string>();
	for (const row of dataset.daily) {
		if (row.date < startDate || row.date >= endDate || seenDates.has(row.date) || (previousDate !== "" && row.date <= previousDate))
			return false;
		seenDates.add(row.date);
		previousDate = row.date;
	}
	const generatedAt = Date.parse(dataset.generated_at);
	for (const session of dataset.sessions) {
		if (session.model_key !== null && session.event_evidence !== "complete") return false;
		if (
			session.estimated_cost !== null &&
			(session.tokens === null ||
				session.model_key === null ||
				session.event_evidence !== "complete" ||
				session.token_evidence !== "available")
		)
			return false;
		const instant = Date.parse(session.last_activity_at);
		if (instant > generatedAt) return false;
		const date = localDate(instant, dataset.timezone);
		if (date < startDate || date >= endDate) return false;
	}
	const detail = dataset.session_detail_coverage;
	if (detail.returned !== dataset.sessions.length || (detail.eligible !== null && detail.eligible < detail.returned)) return false;
	if (detail.observation_state === "complete" && detail.eligible !== detail.returned) return false;
	if (detail.observation_state === "observed_empty" && (detail.returned !== 0 || detail.eligible !== 0)) return false;
	const coverage = dataset.metric_coverage;
	if (
		!sameWindow(coverage.sessions.effective_window, dataset.window) ||
		!sameWindow(coverage.agent_tool_calls.effective_window, dataset.window) ||
		!sameWindow(coverage.tokens.effective_window, dataset.window) ||
		!sameWindow(coverage.estimated_cost.effective_window, dataset.window)
	)
		return false;
	if (
		coverage.sessions.numerator !== detail.returned ||
		coverage.sessions.denominator !== detail.eligible ||
		coverage.sessions.observation_state !== detail.observation_state
	)
		return false;
	const completeTools = dataset.sessions.filter((session) => session.agent_tool_calls !== null).length;
	const completeTokens = dataset.sessions.filter((session) => session.tokens !== null).length;
	if (!validSuggestionSemantics(dataset, completeTokens)) return false;
	const pricedSessions = dataset.sessions.filter((session) => session.tokens !== null);
	const completeModelCoverage = pricedSessions.length > 0 && pricedSessions.every((session) => session.model_key !== null);
	if (
		dataset.pricing.authority === "local_pricing_snapshot" &&
		dataset.pricing.reason !== "estimated_not_billed" &&
		((completeModelCoverage && dataset.pricing.reason === "model_identity_unavailable") ||
			(!completeModelCoverage && dataset.pricing.reason !== "model_identity_unavailable"))
	)
		return false;
	const enclosingPartial = coverage.sessions.observation_state === "partial";
	if (
		!validMetricCardinality(coverage.agent_tool_calls, completeTools, dataset.sessions.length, enclosingPartial) ||
		!validMetricCardinality(coverage.tokens, completeTokens, dataset.sessions.length, enclosingPartial)
	)
		return false;
	const pricedCount = dataset.sessions.filter((session) => session.estimated_cost !== null).length;
	if (coverage.estimated_cost.numerator !== pricedCount || coverage.estimated_cost.denominator !== dataset.sessions.length) return false;
	if (dataset.pricing.reason === "estimated_not_billed") {
		if (pricedCount === 0) return false;
		const groupParts = coverage.estimated_cost.comparability_group.split(":");
		if (
			groupParts.length !== 4 ||
			groupParts[0] !== "pricing" ||
			groupParts[1] !== dataset.pricing.currency ||
			!/^[a-f0-9]{16}$/u.test(groupParts[2]) ||
			groupParts[3] !== "per_session_half_up_6dp"
		)
			return false;
		if (!validMetricCardinality(coverage.estimated_cost, pricedCount, dataset.sessions.length, enclosingPartial)) return false;
		if (dataset.pricing.observation_state !== coverage.estimated_cost.observation_state) return false;
	} else if (coverage.estimated_cost.observation_state !== "unsupported" || pricedCount !== 0) return false;
	if (
		dataset.totals.sessions !== expectedTotal(dataset.daily, "sessions", coverage.sessions) ||
		dataset.totals.agent_tool_calls !== expectedTotal(dataset.daily, "agent_tool_calls", coverage.agent_tool_calls) ||
		dataset.totals.tokens !== expectedTotal(dataset.daily, "tokens", coverage.tokens)
	)
		return false;
	const sessionCostTotal = pricedCount > 0 ? sumDecimalAmounts(dataset.sessions.flatMap((session) => session.estimated_cost ?? [])) : null;
	const dailyCostTotal = dataset.daily.some((row) => row.estimated_cost !== null)
		? sumDecimalAmounts(dataset.daily.flatMap((row) => row.estimated_cost ?? []))
		: null;
	if (dataset.totals.estimated_cost !== sessionCostTotal || dataset.totals.estimated_cost !== dailyCostTotal) return false;
	for (const row of dataset.daily) {
		const costs = dataset.sessions
			.filter((session) => localDate(Date.parse(session.last_activity_at), dataset.timezone) === row.date)
			.flatMap((session) => session.estimated_cost ?? []);
		if (row.estimated_cost !== (costs.length > 0 ? sumDecimalAmounts(costs) : null)) return false;
	}
	return sumNonNull(dataset.daily, "sessions") === dataset.sessions.length;
}

function validSuggestionSemantics(dataset: CealLocalUsageDashboardV1, completeTokens: number): boolean {
	const expected = buildUsageSuggestions(
		dataset.sessions.map((session) => ({ sessionRef: session.session_ref, tokens: session.tokens, toolCalls: session.agent_tool_calls })),
		dataset.metric_coverage.agent_tool_calls.observation_state,
		dataset.metric_coverage.tokens.observation_state,
		dataset.pricing,
		dataset.sources[0]?.source_ref ?? "agent_activity:codex",
	);
	return (
		JSON.stringify(dataset.suggestions) === JSON.stringify(expected) &&
		completeTokens === dataset.sessions.filter((session) => session.tokens !== null).length
	);
}

function sameWindow(left: { start_date: string; end_date: string }, right: { start_date: string; end_date: string }): boolean {
	return left.start_date === right.start_date && left.end_date === right.end_date;
}

function validMetricCardinality(
	coverage: DashboardMetricCoverage,
	numerator: number,
	denominator: number,
	enclosingPartial: boolean,
): boolean {
	if (coverage.numerator !== numerator || coverage.denominator !== denominator || numerator > denominator) return false;
	if (coverage.observation_state === "complete") return numerator === denominator;
	if (coverage.observation_state === "observed_empty") return numerator === 0 && denominator === 0;
	if (coverage.observation_state === "partial") return numerator > 0 && (numerator < denominator || enclosingPartial);
	return numerator === 0;
}

function expectedTotal(
	rows: DashboardDailyRow[],
	key: "sessions" | "agent_tool_calls" | "tokens",
	coverage: DashboardMetricCoverage,
): number | null {
	if (
		coverage.observation_state === "unsupported" ||
		coverage.observation_state === "unavailable" ||
		coverage.observation_state === "unreadable" ||
		(coverage.observation_state === "partial" && coverage.numerator === 0)
	)
		return null;
	return sumNonNull(rows, key);
}

function sumNonNull(rows: DashboardDailyRow[], key: "sessions" | "agent_tool_calls" | "tokens"): number {
	return rows.reduce((total, row) => total + (row[key] ?? 0), 0);
}

function observationState(adapter: CealAgentAuditAdapterState | undefined): LocalUsageObservationState {
	if (!adapter) return "unavailable";
	if (adapter.health === "unknown") return "unreadable";
	if (adapter.inventory === "partial") return "partial";
	if (adapter.sessionCount === 0) return "observed_empty";
	return "complete";
}

function coverageState(adapter: CealAgentAuditAdapterState | undefined, returned: number): LocalUsageObservationState {
	const source = observationState(adapter);
	if (source !== "complete") return source;
	return adapter?.sessionCount === returned ? "complete" : "partial";
}

function projectSession(session: CealAgentAuditSession, runtime: "claude" | "codex"): CealLocalUsageDashboardSession {
	const events = typeof session.events === "object" ? session.events : undefined;
	const usage = events?.tokenUsage;
	return {
		sessionRef: session.sessionRef,
		runtime,
		lastActivityAt: new Date(session.lastActivityAt).toISOString(),
		eventEvidence:
			session.events === "unreadable"
				? "unreadable"
				: events?.scan === "truncated" || (events?.unparsedLines ?? 0) > 0
					? "partial"
					: events
						? "complete"
						: "not_scanned",
		...(events === undefined ? {} : { unparsedLines: events.unparsedLines }),
		tokenEvidence: usage ? "available" : "unavailable",
		...(events?.kinds.tool_call === undefined ? {} : { toolCallEvents: events.kinds.tool_call }),
		...(events?.modelIdentity?.source === "turn_context" ? { modelKey: events.modelIdentity.modelKey } : {}),
		...(!usage || (runtime === "codex" ? usage.source !== "runtime_cumulative_last" : usage.source !== "event_usage_sum")
			? {}
			: {
					tokens: {
						source: usage.source,
						completeness: usage.completeness,
						...(usage.inputTokens === undefined ? {} : { input: usage.inputTokens }),
						...(usage.outputTokens === undefined ? {} : { output: usage.outputTokens }),
						...(usage.cacheReadTokens === undefined ? {} : { cacheRead: usage.cacheReadTokens }),
						...(usage.cacheWriteTokens === undefined ? {} : { cacheWrite: usage.cacheWriteTokens }),
					},
				}),
	};
}
