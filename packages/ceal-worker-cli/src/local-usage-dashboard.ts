import type { CealAgentAuditAdapterState, CealAgentAuditSession, CealAgentAuditState } from "./agent-audit.js";

type LocalUsageObservationState = "complete" | "partial" | "observed_empty" | "unavailable" | "unreadable";

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
}

interface CealLocalUsageDashboardSession {
	sessionRef: string;
	runtime: "codex";
	lastActivityAt: string;
	eventEvidence: "complete" | "partial" | "unreadable" | "not_scanned";
	unparsedLines?: number;
	tokenEvidence: "available" | "unavailable";
	toolCallEvents?: number;
	tokens?: {
		source: "runtime_cumulative_last";
		completeness: "full_transcript" | "scanned_prefix";
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
}

export interface CealCodexDashboardAdapterInputV1 {
	schemaVersion: "ceal.local_usage_dashboard.codex_input.v1";
	generatedAt: string;
	identity: CealLocalUsageDashboardIdentity;
	sources: Array<{
		ref: "agent_activity:codex";
		runtime: "codex";
		rootDisplay: "Codex sessions";
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
	};
}

const COST_NON_CLAIM = "Monetary cost is unsupported until a versioned pricing snapshot contract is accepted; missing cost is not zero.";

export function composeCodexDashboardAdapterInput(input: ComposeLocalUsageDashboardInput): CealCodexDashboardAdapterInputV1 {
	const adapter = input.agentActivity.adapters.find((entry) => entry.runtime === "codex");
	const state = observationState(adapter);
	const sessions = adapter?.sessions?.map(projectSession) ?? [];
	return {
		schemaVersion: "ceal.local_usage_dashboard.codex_input.v1",
		generatedAt: new Date(input.generatedAt).toISOString(),
		identity: input.identity ? { ...input.identity, state: "available" } : { state: "unavailable" },
		sources: [
			{
				ref: "agent_activity:codex",
				runtime: "codex",
				rootDisplay: "Codex sessions",
				inventoryState: state,
				nonClaims: [...input.agentActivity.nonClaims],
			},
		],
		sessions,
		sessionDetailCoverage: {
			returned: sessions.length,
			...(adapter?.sessionCount === undefined ? {} : { eligible: adapter.sessionCount }),
			state: coverageState(adapter, sessions.length),
		},
		pricing: { state: "unsupported", authority: "unknown" },
		access: input.access ? { state: "available", authority: "gateway", ...input.access } : { state: "unavailable", authority: "gateway" },
		nonClaims: [...input.agentActivity.nonClaims, COST_NON_CLAIM],
	};
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

function projectSession(session: CealAgentAuditSession): CealLocalUsageDashboardSession {
	const events = typeof session.events === "object" ? session.events : undefined;
	const usage = events?.tokenUsage;
	return {
		sessionRef: session.sessionRef,
		runtime: "codex",
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
		...(usage?.source !== "runtime_cumulative_last"
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
