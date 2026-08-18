import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { CEAL_PROTOCOL_VERSION } from "@corca-ai/ceal-protocol";
import {
	AGENT_AUDIT_NON_CLAIMS,
	type CealAgentAuditSession,
	type CealAgentAuditState,
	type CealAgentAuditTokenUsage,
	type CealAgentSessionEventsLookup,
} from "./agent-audit.js";
import type { CealAgentGuideState } from "./agent-guide.js";
import {
	type CealDiscoveryCacheEntry,
	DEFAULT_DISCOVERY_CACHE_TTL_MS,
	discoveryCacheFreshness,
	discoveryCacheKeyMatches,
} from "./discovery-cache.js";
import {
	composeCanonicalLocalUsageDashboard,
	composeClaudeDashboardAdapterInput,
	composeCodexDashboardAdapterInput,
	decodeProductionLocalUsageDashboard,
	defaultLocalUsageWindow,
} from "./local-usage-dashboard.js";
import type { CealStoredSession } from "./profile-store.js";
import type { CealReceiptSpoolState } from "./receipt-spool.js";
import { inspectInstalledWorkerRelease } from "./stable-update.js";

// Personal Workbench: one loopback page over a bounded live Ceal summary and
// local supporting evidence. The browser never receives session token material,
// provider credentials, Admin data, or raw Gateway/provider payloads.

export interface CealObserverRuntime {
	loadSession?: () => Promise<CealStoredSession | null>;
	loadDiscoveryCache?: () => Promise<CealDiscoveryCacheEntry | null>;
	loadReceiptSpool?: (session: CealStoredSession | null) => Promise<CealReceiptSpoolState | null>;
	inspectAgentAudit?: () => CealAgentAuditState;
	inspectAgentSession?: (runtime: string, sessionRef: string) => CealAgentSessionEventsLookup | null;
	inspectAgentGuide?: () => CealAgentGuideState;
	executablePath?: string;
	discoveryCacheTtlMs?: number;
	now?: () => number;
	timezone?: string;
	loadCealOverview?: () => Promise<CealGatewayOverview>;
	loadPricingSnapshot?: (now: number) => unknown;
}

export type CealGatewayOverview =
	| { status: "unavailable"; source: "ceal_gateway"; reason: "session_unavailable" }
	| { status: "error"; source: "ceal_gateway"; error_kind: CealGatewayOverviewErrorKind }
	| {
			status: "connected";
			source: "ceal_gateway";
			authority: "gateway";
			profile_ref: string;
			instance_ref: string;
			protocol_version: string;
			capability_count: number;
			read_capability_count: number;
			write_capability_count: number;
			capabilities: Array<{
				capability_id: string;
				label: string;
				effect: "read" | "write";
				target_requirement: "required" | "optional" | "none";
				evidence_requirement: string;
			}>;
	  };

export type CealGatewayOverviewErrorKind =
	| "session_load_failed"
	| "gateway_unreachable"
	| "authentication_failed"
	| "invalid_response"
	| "request_timeout"
	| "request_failed"
	| "protocol_mismatch"
	| "gateway_error";

const CEAL_GATEWAY_OVERVIEW_ERROR_KINDS = new Set<CealGatewayOverviewErrorKind>([
	"session_load_failed",
	"gateway_unreachable",
	"authentication_failed",
	"invalid_response",
	"request_timeout",
	"request_failed",
	"protocol_mismatch",
	"gateway_error",
]);

const OBSERVER_NON_CLAIMS = [
	"The live Ceal summary proves only handshake and capability discovery for the current personal scope; it does not prove provider readiness or execution.",
	"Local receipt and Agent evidence may have different retention and coverage from the live Ceal summary.",
] as const;

const RECEIPT_SPOOL_NON_CLAIM =
	"Client-recorded call metadata only; the Gateway audit ledger stays authoritative through 'ceal receipt show <request-ref>'." as const;

// The page shows a bounded recent window; the spool file itself already caps
// total entries and retention.
const RECEIPT_SPOOL_RENDER_LIMIT = 20;

type ObserverPresentationIntent = "neutral" | "positive" | "attention" | "unavailable" | "unknown";

/**
 * Maps only locally observed source values to presentation intent. This is a
 * display decision, not a health or authorization verdict.
 *
 * @testOnly
 */
export function observerPresentationIntent(source: string, value: unknown): ObserverPresentationIntent {
	if (value === "unavailable" || value === "unreadable") return "unavailable";
	if (source === "session") return value === "present" ? "positive" : value === "absent" ? "attention" : "unknown";
	if (source === "cache")
		return value === "cached" ? "neutral" : value === "absent" || value === "not_current_session" ? "attention" : "unknown";
	if (source === "install") return value === "managed" ? "positive" : value === "unmanaged" ? "attention" : "unknown";
	if (source === "guide")
		return value === "registered"
			? "positive"
			: value === "unregistered" || value === "conflict"
				? "attention"
				: value === "staged" || value === "mixed"
					? "neutral"
					: "unknown";
	if (source === "adapter")
		return value === "active" ? "positive" : value === "stale" ? "attention" : value === "inactive" ? "neutral" : "unknown";
	return "unknown";
}

/**
 * Exported so the observer suite can build the page state directly instead of
 * asserting on rendered output, which would prove the renderer rather than what
 * it was given.
 *
 * @testOnly
 */
export async function buildObserverState(runtime: CealObserverRuntime): Promise<Record<string, unknown>> {
	const now = runtime.now?.() ?? Date.now();
	// Load the session once. Both projections must describe the same local
	// identity even when enrollment replaces the stored session mid-request.
	const sessionSnapshot = await observeSession(runtime);
	const receipts = await observeReceiptSpool(runtime, sessionSnapshot.stored);
	const session = sessionSnapshot.observed;
	const discoveryCache = await observeDiscoveryCache(runtime, now, sessionSnapshot.stored);
	const agentAuditSource = observeAgentAuditSource(runtime);
	const agentActivity = projectAgentAudit(agentAuditSource);
	const ceal = await observeCeal(runtime);
	const accessCapabilities = Array.isArray(ceal.capabilities) && ceal.capabilities.every(isObservedCapability) ? ceal.capabilities : null;
	const localUsageDashboardInput = composeCodexDashboardAdapterInput({
		generatedAt: now,
		agentActivity: agentAuditSource ?? { schemaVersion: "ceal.agent_activity.v1", adapters: [], nonClaims: [...AGENT_AUDIT_NON_CLAIMS] },
		...(sessionSnapshot.stored
			? { identity: { profileRef: sessionSnapshot.stored.profileRef, instanceRef: sessionSnapshot.stored.instanceRef } }
			: {}),
		...(ceal.status === "connected" && accessCapabilities
			? {
					access: {
						observedAt: String(ceal.observed_at),
						capabilityCount: Number(ceal.capability_count),
						readCapabilityCount: Number(ceal.read_capability_count),
						writeCapabilityCount: Number(ceal.write_capability_count),
						capabilities: accessCapabilities.map((capability) => ({
							capabilityId: String(capability.capability_id),
							label: String(capability.label),
							effect: capability.effect,
							targetRequirement: capability.target_requirement,
							evidenceRequirement: String(capability.evidence_requirement),
						})),
					},
				}
			: {}),
	});
	const claudeUsageDashboardInput = composeClaudeDashboardAdapterInput({
		generatedAt: now,
		agentActivity: agentAuditSource ?? { schemaVersion: "ceal.agent_activity.v1", adapters: [], nonClaims: [...AGENT_AUDIT_NON_CLAIMS] },
		...(sessionSnapshot.stored
			? { identity: { profileRef: sessionSnapshot.stored.profileRef, instanceRef: sessionSnapshot.stored.instanceRef } }
			: {}),
	});
	const timezone = runtime.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	const pricingSnapshot = runtime.loadPricingSnapshot?.(now);
	const localUsageDashboard = decodeProductionLocalUsageDashboard(
		composeCanonicalLocalUsageDashboard({
			adapter: localUsageDashboardInput,
			timezone,
			window: defaultLocalUsageWindow(now, timezone),
			pricingSnapshot,
		}),
	);
	if (!localUsageDashboard) throw new Error("Internal local usage dashboard composition failed validation.");
	const claudeUsageDashboard = decodeProductionLocalUsageDashboard(
		composeCanonicalLocalUsageDashboard({
			adapter: claudeUsageDashboardInput,
			timezone,
			window: defaultLocalUsageWindow(now, timezone),
			pricingSnapshot,
		}),
	);
	if (!claudeUsageDashboard) throw new Error("Internal Claude usage dashboard composition failed validation.");
	return {
		schema_version: "ceal.observer_state.v2",
		command: "ceal",
		proof_level: "mixed_gateway_and_local_evidence",
		generated_at: new Date(now).toISOString(),
		boundary: { admin_surface: false, provider_credentials: false, live_refresh: true },
		ceal,
		session,
		discovery_cache: discoveryCache,
		install: observeInstall(runtime),
		guide: observeGuide(runtime),
		receipts,
		agent_activity: agentActivity,
		local_usage_dashboard_input: localUsageDashboardInput,
		local_usage_dashboard: localUsageDashboard,
		local_usage_dashboards: [localUsageDashboard, claudeUsageDashboard],
		suggestions: buildLocalSuggestions(session, discoveryCache, receipts, agentActivity),
		privacy: observePrivacy(receipts),
		non_claims: [...OBSERVER_NON_CLAIMS],
	};
}

function isObservedCapability(value: unknown): value is {
	capability_id: string;
	label: string;
	effect: "read" | "write";
	target_requirement: "required" | "optional" | "none";
	evidence_requirement: string;
} {
	if (!value || typeof value !== "object") return false;
	const capability = value as Record<string, unknown>;
	return (
		typeof capability.capability_id === "string" &&
		typeof capability.label === "string" &&
		(capability.effect === "read" || capability.effect === "write") &&
		(capability.target_requirement === "required" ||
			capability.target_requirement === "optional" ||
			capability.target_requirement === "none") &&
		typeof capability.evidence_requirement === "string"
	);
}

async function observeCeal(runtime: CealObserverRuntime): Promise<Record<string, unknown>> {
	if (!runtime.loadCealOverview) return { status: "unavailable", source: "ceal_gateway", reason: "session_unavailable" };
	try {
		const overview = await runtime.loadCealOverview();
		if (overview.status === "connected") {
			if (
				!Array.isArray(overview.capabilities) ||
				!overview.capabilities.every(isObservedCapability) ||
				overview.capability_count !== overview.capabilities.length ||
				overview.read_capability_count !== overview.capabilities.filter((capability) => capability.effect === "read").length ||
				overview.write_capability_count !== overview.capabilities.filter((capability) => capability.effect === "write").length
			)
				return { status: "error", source: "ceal_gateway", error_kind: "invalid_response" };
			return {
				status: "connected",
				source: "ceal_gateway",
				authority: "gateway",
				observed_at: new Date(runtime.now?.() ?? Date.now()).toISOString(),
				profile_ref: overview.profile_ref,
				instance_ref: overview.instance_ref,
				protocol_version: overview.protocol_version,
				capability_count: overview.capability_count,
				read_capability_count: overview.read_capability_count,
				write_capability_count: overview.write_capability_count,
				capabilities: overview.capabilities.map((capability) => ({ ...capability })),
			};
		}
		if (overview.status === "error") {
			return {
				status: "error",
				source: "ceal_gateway",
				error_kind: CEAL_GATEWAY_OVERVIEW_ERROR_KINDS.has(overview.error_kind) ? overview.error_kind : "gateway_error",
			};
		}
		return { status: "unavailable", source: "ceal_gateway", reason: "session_unavailable" };
	} catch {
		return { status: "error", source: "ceal_gateway", error_kind: "gateway_unreachable" };
	}
}

// Masterplan contract for initial Workbench suggestions: local, deterministic,
// and linked to their observed evidence — never opaque model judgments about
// the user. Every rule below reads only the projections this page already
// renders, so each entry's evidence is independently inspectable above it.
const SUGGESTIONS_NON_CLAIM =
	"Deterministic local rules over the cached/local sections above; not model judgment, a completeness claim, or a Gateway policy conclusion." as const;

function buildLocalSuggestions(
	session: Record<string, unknown>,
	cache: Record<string, unknown>,
	receipts: Record<string, unknown>,
	activity: Record<string, unknown>,
): Record<string, unknown> {
	const entries: Record<string, unknown>[] = [];
	const adapters = Array.isArray(activity.adapters) ? (activity.adapters as Record<string, unknown>[]) : [];
	for (const adapter of adapters) {
		// "stale" means sessions exist but none is recent — observed evidence of a
		// collector gap. "inactive"/"unknown" stay silent: an unused runtime or a
		// read failure is not evidence the owner should act.
		if (adapter.health !== "stale") continue;
		entries.push({
			kind: "stale_collector",
			evidence: { runtime: adapter.runtime, root: adapter.root, health: adapter.health },
			suggestion: `The ${String(adapter.runtime)} transcript root has sessions but none within the recency window, so recent work there is not locally observed.`,
			next_action: `If ${String(adapter.runtime)} is still in use, confirm it writes transcripts under ${String(adapter.root)}.`,
		});
	}
	// Only a genuinely missing catalog fires (masterplan: "a missing Ceal cache
	// opportunity"). Routine TTL expiry self-heals on the next discovery and
	// would keep this entry permanently on, eroding trust in the section.
	if (session.status === "present" && (cache.status === "absent" || cache.status === "not_current_session")) {
		entries.push({
			kind: "missing_cache_opportunity",
			evidence: { session: session.status, discovery_cache: cache.status },
			suggestion: "A client session is present but no local capability catalog has been cached yet.",
			next_action: "Run 'ceal capabilities' to cache the capability catalog.",
		});
	}
	const spooled = Array.isArray(receipts.entries) ? (receipts.entries as Record<string, unknown>[]) : [];
	const failedByCapability = new Map<string, string[]>();
	for (const entry of spooled) {
		if (entry.status === "completed" || typeof entry.capability !== "string") continue;
		const refs = failedByCapability.get(entry.capability) ?? [];
		refs.push(String(entry.request_ref));
		failedByCapability.set(entry.capability, refs);
	}
	for (const [capability, refs] of failedByCapability) {
		if (refs.length < 2) continue;
		entries.push({
			kind: "repeated_failed_work",
			evidence: { capability, request_refs: refs },
			suggestion: `The rendered spool window holds ${refs.length} non-completed '${capability}' calls.`,
			// Rendered entries are newest-first, so refs[0] is the latest failure.
			next_action: `Read 'ceal receipt show ${refs[0]}' for the audited disposition before retrying.`,
		});
	}
	for (const entry of spooled) {
		if (entry.evidence !== "outcome_unknown") continue;
		entries.push({
			kind: "unknown_outcome_receipt",
			evidence: {
				request_ref: entry.request_ref,
				...(typeof entry.capability === "string" ? { capability: entry.capability } : {}),
			},
			suggestion: "A call ended with an unknown Gateway outcome; the Gateway may have completed it after the client stopped waiting.",
			next_action: `Run 'ceal receipt show ${String(entry.request_ref)}' to resolve the outcome before repeating a write.`,
		});
	}
	return { status: "evaluated", entries, non_claim: SUGGESTIONS_NON_CLAIM };
}

// The privacy projection is declared, not probed: it names the fixed local
// sources this client reads and the fixed no-forwarding boundary of this page.
// The only dynamic value is the retention bound echoed from the loaded spool.
// The vocabulary the `ceal observe` result envelope advertises, kept here beside
// the privacy projection rather than in the command that prints it. They are two
// renderings of one fact — what this page reads — and when they lived apart the
// drops counter reached one of them and not the other. `observer.test.mjs` gates
// that every ~/.ceal file the stores name appears in both.
export const OBSERVER_DATA_SOURCES = [
	"live_gateway_handshake_and_discovery",
	"client_session_redacted",
	"client_discovery_cache",
	"installed_release_generation",
	"agent_guide_registration",
	"receipt_spool_metadata",
	"agent_runtime_transcript_inventory",
	"local_pricing_snapshot",
] as const;

const PRIVACY_LOCAL_SOURCES = [
	"~/.ceal/client-session.json (session identity; token fields never serialized)",
	"~/.ceal/client-discovery-cache.json (cached capability/target catalog)",
	"~/.ceal/receipt-spool.json (allowlisted call-outcome metadata)",
	"~/.ceal/receipt-spool-drops (count only, of receipts this client failed to spool; no per-call data)",
	"~/.ceal/pricing-snapshot.json (optional versioned model rates; no credential or billing history)",
	"managed worker install layout (generation manifest metadata and staged guide asset presence)",
	"~/.codex/skills/ceal-guide and ~/.claude/skills/ceal-guide, or the directories CODEX_HOME/CLAUDE_CONFIG_DIR configure (guide registration link inspection; no skill content read)",
	"~/.claude/projects and ~/.codex/sessions, or the same subdirectories under the roots CLAUDE_CONFIG_DIR/CODEX_HOME configure (bounded local transcript scan; fixed-vocabulary metadata only)",
] as const;

function observePrivacy(receipts: Record<string, unknown>): Record<string, unknown> {
	const bounds = receipts.bounds;
	return {
		status: "declared",
		local_sources: [...PRIVACY_LOCAL_SOURCES],
		gateway_contact: "personal handshake and capability discovery",
		provider_contact: "none",
		transcript_handling:
			"Agent transcripts are parsed locally under fixed byte/line budgets for kind counts, timestamps, and runtime-supplied token totals; their text is never stored, rendered, or forwarded.",
		...(typeof bounds === "object" && bounds !== null ? { receipt_spool_retention: bounds } : {}),
	};
}

function observeAgentAuditSource(runtime: CealObserverRuntime): CealAgentAuditState | null {
	if (!runtime.inspectAgentAudit) return null;
	try {
		return runtime.inspectAgentAudit();
	} catch {
		return {
			schemaVersion: "ceal.agent_activity.v1",
			adapters: [{ runtime: "codex", root: "Codex sessions", health: "unknown", coverage: "transcript-observed" }],
			nonClaims: [...AGENT_AUDIT_NON_CLAIMS],
		};
	}
}

function projectAgentAudit(state: CealAgentAuditState | null): Record<string, unknown> {
	if (!state) return { status: "unavailable" };
	return {
		status: "inventoried",
		schema_version: state.schemaVersion,
		adapters: state.adapters.map((adapter) => ({
			runtime: adapter.runtime,
			root: adapter.root,
			health: adapter.health,
			coverage: adapter.coverage,
			...(adapter.depth === undefined ? {} : { depth: adapter.depth }),
			...(adapter.inventory === undefined ? {} : { inventory: adapter.inventory }),
			...(adapter.sessionCount === undefined ? {} : { session_count: adapter.sessionCount }),
			...(adapter.sessions === undefined
				? {}
				: {
						sessions: adapter.sessions.map((session) => ({
							session_ref: session.sessionRef,
							last_activity_at: new Date(session.lastActivityAt).toISOString(),
							transcript_bytes: session.transcriptBytes,
							...(session.events === undefined ? {} : { events: projectSessionEvents(session.events) }),
						})),
					}),
			...(adapter.eventScan === undefined
				? {}
				: {
						event_scan: { scanned_sessions: adapter.eventScan.scannedSessions, session_limit: adapter.eventScan.sessionLimit },
					}),
			...(adapter.note === undefined ? {} : { note: adapter.note }),
		})),
		non_claims: state.nonClaims,
	};
}

// Event summaries re-key to the page's snake_case vocabulary; the values are
// already structurally redacted (fixed kinds, integers, parsed epochs).
function projectSessionEvents(events: NonNullable<CealAgentAuditSession["events"]>): unknown {
	if (events === "unreadable") return "unreadable";
	return {
		scan: events.scan,
		event_count: events.eventCount,
		kinds: events.kinds,
		unparsed_lines: events.unparsedLines,
		...(events.firstEventAt === undefined ? {} : { first_event_at: new Date(events.firstEventAt).toISOString() }),
		...(events.lastScannedEventAt === undefined ? {} : { last_scanned_event_at: new Date(events.lastScannedEventAt).toISOString() }),
		...(events.tokenUsage === undefined ? {} : { token_usage: projectTokenUsage(events.tokenUsage) }),
	};
}

// Runtime-supplied token figures keep their omitted-not-zero shape: a field
// the runtime never supplied has no key here either.
function projectTokenUsage(usage: CealAgentAuditTokenUsage): Record<string, unknown> {
	return {
		source: usage.source,
		completeness: usage.completeness,
		usage_events: usage.usageEvents,
		...(usage.inputTokens === undefined ? {} : { input_tokens: usage.inputTokens }),
		...(usage.outputTokens === undefined ? {} : { output_tokens: usage.outputTokens }),
		...(usage.cacheReadTokens === undefined ? {} : { cache_read_tokens: usage.cacheReadTokens }),
		...(usage.cacheWriteTokens === undefined ? {} : { cache_write_tokens: usage.cacheWriteTokens }),
	};
}

// A zero count is omitted rather than rendered: an absent key reads as "nothing
// to say", while `dropped_appends: 0` invites reading the spool as provably
// complete, which it is not — a drop is only counted when the client survived to
// count it.
function droppedAppends(drops: CealReceiptSpoolState["drops"] | undefined): Record<string, unknown> {
	// The state arrives from a runtime callback, so the observer treats its shape
	// as input rather than as something it built. A missing counter is "nothing
	// to say", not a crash that would take the whole observe page down with it.
	if (!drops || typeof drops.count !== "number" || drops.count <= 0) return {};
	return {
		dropped_appends: drops.count,
		// Always a floor, never a total. A drop is only counted when the client
		// survived to count it, so a killed process, an unset HOME, and a failure
		// of the counter itself all lose receipts without appearing here. Reading
		// this as exact would be the same over-claim the counter exists to remove.
		dropped_appends_are_a_floor: true,
		dropped_appends_capped: drops.atLeast,
		dropped_appends_note: drops.atLeast
			? "At least this many receipt appends were lost; the counter stopped at its cap. This history is incomplete."
			: "At least this many receipt appends were lost and are not in this history. Gateway readback ('ceal receipt show') remains authoritative.",
	};
}

// Three unlike states share `entries: []`, and only one of them justifies the
// strongest sentence. Flattening them would replace the false "no calls yet"
// this counter was added to remove with an equally false "everything was lost".
function absentReceiptsNote(spool: CealReceiptSpoolState | null): string {
	if (!spool || !(spool.drops?.count > 0)) return "No spooled call outcomes yet; entries appear after receipt-bearing 'ceal call' results.";
	if (!spool.spoolPresent) return "No call outcome could be spooled; every receipt this client tried to record was lost.";
	return "No call outcomes are within the retention window, and receipt appends were lost as well.";
}

async function observeReceiptSpool(runtime: CealObserverRuntime, session: CealStoredSession | null): Promise<Record<string, unknown>> {
	if (!runtime.loadReceiptSpool) return { status: "unavailable", non_claim: RECEIPT_SPOOL_NON_CLAIM };
	let spool: CealReceiptSpoolState | null;
	try {
		spool = await runtime.loadReceiptSpool(session);
	} catch {
		return { status: "unreadable", non_claim: RECEIPT_SPOOL_NON_CLAIM };
	}
	// "No history" and "a history that was lost" are different answers, and only
	// one of them means this client made no calls — so the store returns a state
	// with zero entries when it has drops but no spool file, and the `absent`
	// branch below renders the difference instead of flattening it.
	const drops = spool ? droppedAppends(spool.drops) : {};
	if (!spool || spool.entries.length === 0) {
		return {
			status: "absent",
			note: absentReceiptsNote(spool),
			...drops,
			non_claim: RECEIPT_SPOOL_NON_CLAIM,
		};
	}
	// Render newest-first by recorded time, not append order, so concurrent
	// writers or clock skew cannot scramble the visible history.
	const ordered = [...spool.entries].sort((a, b) => a.recordedAt - b.recordedAt);
	return {
		status: "spooled",
		// Masterplan coverage vocabulary: the spool records only Ceal-mediated
		// call outcomes; agent-native transcript/hook evidence is a later tier.
		coverage: "ceal-mediated",
		entry_count: spool.entries.length,
		bounds: { max_entries: spool.bounds.maxEntries, retention_ms: spool.bounds.retentionMs },
		...drops,
		// Activity needs every still-retained record time, while detail remains
		// deliberately smaller. Keeping this projection timestamp-only avoids
		// widening the visible request/capability/target metadata surface merely
		// to draw an honest retained-window count.
		activity_recorded_at: ordered.map((entry) => new Date(entry.recordedAt).toISOString()),
		entries: ordered
			.slice(-RECEIPT_SPOOL_RENDER_LIMIT)
			.reverse()
			.map((entry) => ({
				recorded_at: new Date(entry.recordedAt).toISOString(),
				request_ref: entry.requestRef,
				status: entry.status,
				evidence: entry.evidence,
				...(entry.capabilityId === undefined ? {} : { capability: entry.capabilityId }),
				...(entry.targetRef === undefined ? {} : { target: entry.targetRef }),
				...(entry.errorKind === undefined ? {} : { error_kind: entry.errorKind }),
				...(entry.auditRefs.length === 0 ? {} : { audit_refs: entry.auditRefs }),
			})),
		non_claim: RECEIPT_SPOOL_NON_CLAIM,
	};
}

async function observeSession(
	runtime: CealObserverRuntime,
): Promise<{ stored: CealStoredSession | null; observed: Record<string, unknown> }> {
	if (!runtime.loadSession) return { stored: null, observed: { status: "unavailable" } };
	let session: CealStoredSession | null;
	try {
		session = await runtime.loadSession();
	} catch {
		return { stored: null, observed: { status: "unreadable" } };
	}
	if (!session) return { stored: null, observed: { status: "absent" } };
	// Structural allowlist: token fields are never read into this projection.
	return {
		stored: session,
		observed: {
			status: "present",
			gateway_endpoint: session.gatewayEndpoint,
			profile_ref: session.profileRef,
			instance_ref: session.instanceRef,
			expires_at: session.expiresAt,
			refresh_token_idle_expires_at: session.refreshTokenIdleExpiresAt,
			refresh_token_absolute_expires_at: session.refreshTokenAbsoluteExpiresAt,
			secrets: "redacted",
		},
	};
}

async function observeDiscoveryCache(
	runtime: CealObserverRuntime,
	now: number,
	session: CealStoredSession | null,
): Promise<Record<string, unknown>> {
	if (!runtime.loadDiscoveryCache) return { status: "unavailable" };
	let entry: CealDiscoveryCacheEntry | null;
	try {
		entry = await runtime.loadDiscoveryCache();
	} catch {
		return { status: "unreadable" };
	}
	if (!entry) return { status: "absent" };
	if (
		!session ||
		!discoveryCacheKeyMatches(entry.key, {
			gatewayEndpoint: session.gatewayEndpoint,
			profileRef: session.profileRef,
			membershipRef: session.membershipRef,
			negotiatedProtocolVersion: CEAL_PROTOCOL_VERSION,
		})
	) {
		return { status: "not_current_session" };
	}
	const ttl = runtime.discoveryCacheTtlMs ?? DEFAULT_DISCOVERY_CACHE_TTL_MS;
	// Freshness is the store's judgement, not a second copy of it — see
	// `discoveryCacheFreshness`.
	const { ageMs: age, withinTtl } = discoveryCacheFreshness(entry.cachedAt, now, ttl);
	const capabilities = Array.isArray(entry.discovery.capabilities) ? entry.discovery.capabilities : [];
	return {
		status: "cached",
		cached_at: new Date(entry.cachedAt).toISOString(),
		age_ms: age,
		ttl_ms: ttl,
		within_ttl: withinTtl,
		gateway_endpoint: entry.key.gatewayEndpoint,
		profile_ref: entry.key.profileRef,
		negotiated_protocol_version: entry.key.negotiatedProtocolVersion,
		capability_count: capabilities.length,
		capabilities: capabilities.map((capability) => scalarProjection(capability)),
		...(Array.isArray(entry.discovery.non_claims)
			? { non_claims: entry.discovery.non_claims.filter((value) => typeof value === "string") }
			: {}),
	};
}

function observeInstall(runtime: CealObserverRuntime): Record<string, unknown> {
	if (!runtime.executablePath) return { status: "unavailable" };
	const installed = inspectInstalledWorkerRelease(runtime.executablePath);
	if (!installed) return { status: "unmanaged", note: "This command is not running from a managed installed worker release." };
	const manifest = readGenerationManifest(installed.generationDirectory);
	return {
		status: "managed",
		install_directory: installed.installDirectory,
		generation: installed.generationDirectory.slice(installed.generationDirectory.lastIndexOf("/") + 1),
		...(manifest ?? {}),
	};
}

function readGenerationManifest(generationDirectory: string): Record<string, unknown> | null {
	try {
		const name = readdirSync(generationDirectory).find((entry) => /^ceal-worker-release-manifest-.+[.]json$/u.test(entry));
		if (!name) return null;
		const file = join(generationDirectory, name);
		if (!existsSync(file) || !lstatSync(file).isFile()) return null;
		const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		return {
			...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
			...(typeof manifest.platform === "string" ? { platform: manifest.platform } : {}),
			...(typeof manifest.artifact_state === "string" ? { artifact_state: manifest.artifact_state } : {}),
		};
	} catch {
		return null;
	}
}

function observeGuide(runtime: CealObserverRuntime): Record<string, unknown> {
	if (!runtime.inspectAgentGuide) return { status: "unavailable" };
	try {
		return { ...runtime.inspectAgentGuide() };
	} catch {
		return { status: "unavailable" };
	}
}

// Allow-by-type on purpose: cached capability/catalog entries are non-secret
// Gateway metadata, and dropping every nested value keeps a poisoned cache
// file from smuggling structures into the page. The session projection above
// stays allow-by-name because it fronts a store that does hold secrets.
function scalarProjection(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null) return {};
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).filter(([, entry]) => ["string", "number", "boolean"].includes(typeof entry)),
	);
}

// Loopback guard, after the agentsview pattern: only direct 127.0.0.1/localhost
// requests are served, a proxy-forwarded request fails closed, and the Host
// header must be a loopback name so a DNS-rebinding page cannot read state.
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const FORWARDED_HEADERS = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip"] as const;

function hostAllowed(hostHeader: string | undefined): boolean {
	if (!hostHeader) return false;
	const host = hostHeader.startsWith("[") ? hostHeader.replace(/\]:\d+$/u, "]") : hostHeader.replace(/:\d+$/u, "");
	return ALLOWED_HOSTS.has(host.toLowerCase());
}

export function createCealObserverServer(runtime: CealObserverRuntime): Server {
	return createServer((request, response) => {
		void handleRequest(request, response, runtime).catch(() => {
			if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
			response.end(JSON.stringify({ ok: false, error: "observer_failed" }));
		});
	});
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, runtime: CealObserverRuntime): Promise<void> {
	if (FORWARDED_HEADERS.some((header) => request.headers[header] !== undefined) || !hostAllowed(request.headers.host)) {
		response.writeHead(403, { "content-type": "application/json" });
		response.end(JSON.stringify({ ok: false, error: "loopback_only" }));
		return;
	}
	if (request.method !== "GET") {
		response.writeHead(405, { allow: "GET", "content-type": "application/json" });
		response.end(JSON.stringify({ ok: false, error: "read_only_observer" }));
		return;
	}
	const url = request.url?.split("?")[0];
	if (url === "/api/observer/v2/state") {
		const state = await buildObserverState(runtime);
		response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
		response.end(`${JSON.stringify(state, null, 2)}\n`);
		return;
	}
	const drillDown = url === undefined ? null : AGENT_SESSION_ROUTE.exec(url);
	if (drillDown) {
		respondAgentSession(response, runtime, drillDown[1], drillDown[2]);
		return;
	}
	if (url === "/") {
		response.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
			"x-content-type-options": "nosniff",
			"referrer-policy": "no-referrer",
		});
		response.end(OBSERVER_PAGE);
		return;
	}
	response.writeHead(404, { "content-type": "application/json" });
	response.end(JSON.stringify({ ok: false, error: "unknown_observer_path" }));
}

// Per-session drill-down: the same bounded structural event scan the state
// endpoint runs for the newest sessions, on demand for any inventoried one.
// The route grammar is deliberately loose (segment shape only); the audit
// module re-validates runtime and ref before any filesystem access and null
// maps to a plain 404, so this route adds no new input reachability.
const AGENT_SESSION_ROUTE = /^\/api\/observer\/v1\/agent-session\/([a-z]+)\/([0-9a-f-]{1,64})$/u;

function respondAgentSession(response: ServerResponse, runtime: CealObserverRuntime, adapterRuntime: string, sessionRef: string): void {
	const body = (status: number, payload: Record<string, unknown>) => {
		response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
		response.end(`${JSON.stringify(payload, null, 2)}\n`);
	};
	const envelope = {
		schema_version: "ceal.observer_agent_session.v1",
		runtime: adapterRuntime,
		session_ref: sessionRef,
	};
	if (!runtime.inspectAgentSession) {
		body(200, { ...envelope, status: "unavailable" });
		return;
	}
	let lookup: CealAgentSessionEventsLookup | null;
	try {
		lookup = runtime.inspectAgentSession(adapterRuntime, sessionRef);
	} catch {
		lookup = { status: "unreadable" };
	}
	if (lookup === null) {
		body(404, { ok: false, error: "unknown_observer_path" });
		return;
	}
	const session = lookup.session;
	// "unreadable" is a declared local gap on the owner's own machine, not an
	// absence, so it stays 200 like every other declared-gap projection here.
	body(lookup.status === "not_found" ? 404 : 200, {
		...envelope,
		status: lookup.status,
		...(session === undefined
			? {}
			: {
					session: {
						session_ref: session.sessionRef,
						last_activity_at: new Date(session.lastActivityAt).toISOString(),
						transcript_bytes: session.transcriptBytes,
						...(session.events === undefined ? {} : { events: projectSessionEvents(session.events) }),
					},
				}),
		non_claims: [...AGENT_AUDIT_NON_CLAIMS],
	});
}

// Workbench shell: bounded receipt evidence leads; Agent activity, Ceal
// evidence, and setup/privacy stay separate so the composition cannot imply a
// relationship the producers do not supply. One embedded document over the
// one state endpoint; no router, no build step.
const OBSERVER_PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ceal Workbench</title>
<style>
  :root { color-scheme:light; --ink:#17211b; --muted:#667069; --line:#d9dfda; --paper:#f4f6f3; --panel:#fff; --soft:#e9eeea; --accent:#167a4c; --accent-strong:#0d5936; --warn:#8a4b08; --selected:#e2ebff; --shadow:0 12px 32px #17211b0b; }
  @media (prefers-color-scheme:dark) { :root:not([data-mode]) { color-scheme:dark; --ink:#edf2ee; --muted:#9ba79f; --line:#303a33; --paper:#101512; --panel:#171e19; --soft:#222b25; --accent:#72d09b; --warn:#f2b765; --selected:#23354a; } }
  :root[data-mode="dark"] { color-scheme:dark; --ink:#edf2ee; --muted:#9ba79f; --line:#303a33; --paper:#101512; --panel:#171e19; --soft:#222b25; --accent:#72d09b; --warn:#f2b765; --selected:#23354a; }
  :root[data-mode="light"] { color-scheme:light; --ink:#17211b; --muted:#667069; --line:#d9dfda; --paper:#f5f7f4; --panel:#fff; --soft:#e9eeea; --accent:#245b3c; --warn:#8a4b08; --selected:#e2ebff; }
  * { box-sizing: border-box; }
  body { background:var(--paper); color:var(--ink); font:14px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; margin:0 auto; max-width:86rem; padding:0 2rem 5rem; }
  h1 { font-size:1.15rem; letter-spacing:-.03em; margin:0; } h2 { font-size:1rem; margin:1.6rem 0 .75rem; }
  .topbar { min-height:4.5rem; display:flex; align-items:center; gap:1.25rem; flex-wrap:wrap; border-bottom:1px solid var(--line); position:sticky; top:0; z-index:10; background:color-mix(in srgb,var(--paper) 92%,transparent); backdrop-filter:blur(14px); }
  .topbar nav { margin:0 auto; } .controls { display:flex; align-items:center; gap:.45rem; flex-wrap:wrap; }
  select { background:var(--panel); color:var(--ink); border:1px solid var(--line); border-radius:6px; padding:.38rem .55rem; font:inherit; font-size:.75rem; }
  .mode { display:flex; background:var(--soft); border:1px solid var(--line); border-radius:7px; padding:2px; }
  .mode button { border:0; background:none; color:var(--muted); border-radius:5px; padding:.28rem .45rem; font:inherit; font-size:.7rem; cursor:pointer; }
  .mode button[aria-pressed="true"] { background:var(--panel); color:var(--ink); box-shadow:0 1px 3px #0002; }
  .badge { border: 1px solid currentColor; border-radius: 4px; padding: 0 .4rem; margin-left: .5rem; font-size: .8rem; }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; padding: .15rem .8rem .15rem 0; vertical-align: top; word-break: break-all; }
  .muted { color:var(--muted); }
  .warn { color:var(--warn); }
  .boundary { border:1px solid var(--line); background:var(--panel); border-radius:10px; margin:1.1rem 0 1.4rem; padding:.7rem .9rem; color:var(--muted); box-shadow:var(--shadow); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr)); gap:.65rem; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:1rem; box-shadow:var(--shadow); }
  .card, .unsupported { min-width:0; overflow-wrap:anywhere; }
  .card h3 { font-size:.82rem; margin:0 0 .35rem; color:var(--muted); }
  .attention { width:100%; color:inherit; text-align:left; font:inherit; cursor:pointer; margin-bottom:.6rem; }
  .attention strong { display:block; margin-bottom:.35rem; }
  .next { color:var(--accent); margin:.5rem 0 0; }
  .next-action { margin-top:.65rem; border:1px solid var(--accent); background:transparent; color:var(--accent); border-radius:7px; padding:.48rem .65rem; font:inherit; font-weight:650; cursor:pointer; }
  dialog { width:min(38rem,calc(100% - 2rem)); border:1px solid var(--line); border-radius:12px; padding:0; box-shadow:0 24px 70px #0003; }
  dialog::backdrop { background:#17211b88; }
  .detail-head { display:flex; justify-content:space-between; align-items:center; padding:1rem 1.1rem; border-bottom:1px solid var(--line); }
  .detail-head h2 { margin:0; } .detail-body { padding:1rem 1.1rem 1.25rem; }
  nav { margin: 1rem 0; display: flex; gap: .5rem; }
  nav button { font: inherit; padding:.48rem .75rem; border:0; border-radius:7px; background:none; color:var(--muted); cursor:pointer; }
  nav button[aria-current="true"] { color:var(--ink); background:var(--panel); box-shadow:0 1px 4px #0001; font-weight:700; }
  nav button:focus-visible, .mode button:focus-visible, .next-action:focus-visible, select:focus-visible { outline:3px solid var(--accent); outline-offset:2px; }
  .hero { padding:2.3rem 0 1.7rem; max-width:64rem; }
  .eyebrow { color:var(--accent); font-size:.7rem; letter-spacing:.12em; font-weight:700; text-transform:uppercase; }
  .hero h2 { font-size:clamp(2.1rem,4.4vw,4rem); line-height:1.02; letter-spacing:-.06em; margin:.55rem 0 .8rem; }
  .hero h2 em { color:var(--accent); font-style:normal; }
  .hero-summary { max-width:62ch; color:var(--muted); font-size:1rem; }
  .evidence-line { color:var(--muted); display:flex; flex-wrap:wrap; gap:.4rem 1rem; }
  .overview-section { background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:1.25rem; margin-top:1rem; box-shadow:var(--shadow); }
  .section-head { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }
  .section-head h2 { margin:0; font-size:1.25rem; }
  .activity-grid { display:grid; grid-template-rows:repeat(7,13px); grid-auto-flow:column; grid-auto-columns:13px; gap:4px; overflow:auto; padding:1.2rem 0 .8rem; scrollbar-width:thin; }
  .day { width:13px; height:13px; border-radius:3px; background:var(--soft); }
  .day.level-0 { border:1px solid var(--line); }
  .day.unavailable { border:1px dashed var(--muted); background:repeating-linear-gradient(135deg,transparent 0 3px,var(--line) 3px 5px); }
  .day.level-1 { background:color-mix(in srgb,var(--accent) 30%,var(--soft)); }
  .day.level-2 { background:color-mix(in srgb,var(--accent) 62%,var(--soft)); }
  .day.level-3 { background:var(--accent); }
  .legend { display:flex; gap:.5rem; align-items:center; color:var(--muted); font-size:.72rem; }
  .legend-scale { display:flex; gap:3px; }
  .legend-scale .day { display:inline-block; }
  .heatmap-caption { display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap; }
  .support-grid { display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-top:2rem; }
  .unsupported { border:1px dashed var(--line); background:color-mix(in srgb,var(--panel) 80%,var(--soft)); padding:1rem; border-radius:8px; }
  .unsupported strong { display:block; margin-bottom:.3rem; }
  .unsupported p { color:var(--muted); margin:.25rem 0; }
  .outcome-list { margin-top:1rem; display:grid; grid-template-columns:repeat(auto-fit,minmax(16rem,1fr)); gap:.6rem; }
  .metric-strip { display:grid; grid-template-columns:repeat(auto-fit,minmax(9rem,1fr)); gap:.55rem; margin:1rem 0; }
  .metric-strip .card strong { font-size:1.3rem; }
  .identity { display:flex; justify-content:space-between; align-items:center; gap:1rem; padding:1rem 0; border-bottom:1px solid var(--line); }
  .identity strong, .identity span { display:block; }
  .metric-tabs { display:grid; grid-template-columns:repeat(4,1fr); gap:.7rem; margin-bottom:1rem; }
  .metric-tabs button { min-width:0; padding:1rem; text-align:left; border:1px solid var(--line); background:var(--panel); color:var(--ink); border-radius:12px; cursor:pointer; box-shadow:var(--shadow); }
  .metric-tabs button span, .metric-tabs button strong { display:block; }
  .metric-tabs button span { color:var(--muted); font-size:.72rem; }
  .metric-tabs button strong { font-size:1.35rem; margin-top:.25rem; overflow-wrap:anywhere; letter-spacing:-.035em; }
  .metric-tabs button[aria-pressed="true"] { border-color:var(--accent); box-shadow:inset 0 -4px var(--accent),var(--shadow); }
  .runtime-tabs { display:flex; max-width:34rem; margin:0; }
  .runtime-tabs button { flex:1; padding:.7rem 1rem; box-shadow:none; }
  .session-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.65rem; }
  .session-card strong { font-size:1rem; color:var(--ink); }
  .session-meta { display:flex; justify-content:space-between; gap:.75rem; color:var(--muted); font-size:.75rem; margin:.35rem 0 .7rem; }
  .session-metrics { display:flex; flex-wrap:wrap; gap:.4rem; }
  .session-metrics span { background:var(--soft); border-radius:5px; padding:.22rem .4rem; font-size:.72rem; }
  .capability-list { display:grid; gap:.55rem; }
  .capability-row { display:grid; grid-template-columns:minmax(11rem,1.1fr) minmax(15rem,2fr) auto; gap:1rem; align-items:center; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:1rem; }
  .capability-row h3 { margin:0 0 .2rem; font-size:1rem; color:var(--ink); }
  .capability-row p { margin:0; }
  .capability-kind { justify-self:end; text-align:right; }
  .receipt-list { display:grid; gap:.55rem; margin-top:1rem; }
  .receipt-row { display:grid; grid-template-columns:minmax(10rem,1fr) auto auto; gap:1rem; align-items:center; padding:.75rem 0; border-bottom:1px solid var(--line); }
  .receipt-row:last-child { border-bottom:0; }
  .pagination { display:flex; justify-content:center; align-items:center; gap:1rem; margin:1.5rem 0; }
  .pagination button { font:inherit; border:1px solid var(--line); background:var(--panel); color:var(--ink); border-radius:6px; padding:.45rem .7rem; }
  .pagination button:disabled { opacity:.45; }
  .hero.compact { padding-bottom:1.4rem; }
  :root[data-theme="editorial"] .hero h2, :root[data-theme="editorial"] .section-head h2 { font-family:Georgia,"Times New Roman",serif; font-weight:400; }
  :root[data-theme="editorial"] { --selected:color-mix(in srgb,var(--warn) 12%,var(--panel)); }
  :root[data-theme="terminal"] body, :root[data-theme="terminal"] .hero h2, :root[data-theme="terminal"] .section-head h2 { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:-.025em; }
  :root[data-theme="terminal"] .card, :root[data-theme="terminal"] .unsupported, :root[data-theme="terminal"] select, :root[data-theme="terminal"] button { border-radius:2px; }
  :root[data-theme="terminal"] .day { border-radius:1px; }
  @media (max-width:700px) { body{padding:0 1rem 4rem}.topbar{padding:.7rem 0}.topbar nav { order:3; width:100%; overflow:auto; margin:0; } .controls{margin-left:auto}.support-grid, .session-list { grid-template-columns:1fr; } .metric-tabs { grid-template-columns:repeat(2,1fr); } .runtime-tabs{display:flex}.hero { padding-top:1.6rem; } .boundary{font-size:.78rem}.capability-row,.receipt-row{grid-template-columns:1fr}.capability-kind{justify-self:start;text-align:left} }
</style>
</head>
<body>
<header class="topbar"><h1 tabindex="-1">Ceal Workbench</h1><nav id="nav"></nav><div class="controls"><select id="language" aria-label="Language"><option value="ko">한국어</option><option value="en">English</option></select><select id="theme" aria-label="Visual theme"><option value="developer">Developer</option><option value="editorial">Editorial</option><option value="terminal">Terminal</option></select><div class="mode" role="group" aria-label="Color appearance"><button type="button" data-mode="system" aria-pressed="true">Auto</button><button type="button" data-mode="light" aria-pressed="false">Light</button><button type="button" data-mode="dark" aria-pressed="false">Dark</button></div></div></header>
<p class="boundary" id="boundary">Personal Ceal view. Loading this page reads the current Gateway handshake and capability catalog when a client session is available; it never calls a provider. Local evidence remains separately labeled.</p>
<div id="root">Loading Ceal and local evidence…</div>
<dialog id="detail" aria-labelledby="detail-title"><div class="detail-head"><h2 id="detail-title">Local evidence</h2><button id="detail-close" type="button">Close</button></div><div class="detail-body" id="detail-body"></div></dialog>
<script>
const fmt = (v) => Array.isArray(v) ? v.map(fmt).join(", ")
  : (typeof v === "object" && v !== null) ? Object.entries(v).map(([k, x]) => k + ": " + fmt(x)).join(" \\u00b7 ")
  : String(v);
const rows = (pairs) => "<table>" + pairs
  .filter(([, v]) => v !== undefined && v !== null)
  .map(([k, v]) => "<tr><th>" + esc(k) + "</th><td>" + esc(fmt(v)) + "</td></tr>").join("") + "</table>";
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const section = (title, body) => "<h2>" + esc(title) + "</h2>" + body;
const list = (items, className) => "<ul>" + items.map((n) => "<li class=\\"" + className + "\\">" + esc(n) + "</li>").join("") + "</ul>";
let language = navigator.language && navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
let observationTimezone;
const tx = (english, korean) => language === "ko" ? korean : english;
const VIEW_LABELS = {
  "Usage": ["Usage", "사용량"],
  "Sessions": ["Sessions", "세션"],
  "Access": ["Access", "권한"],
  "Evidence": ["Evidence", "데이터 근거"],
  "Setup & privacy": ["Setup & privacy", "설정 및 개인정보"]
};
const viewLabel = (view) => language === "ko" ? VIEW_LABELS[view][1] : VIEW_LABELS[view][0];
const formatTime = (instant) => new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", { dateStyle:"medium", timeStyle:"short", timeZone:observationTimezone }).format(new Date(instant));
const sessionSummary = (events) => {
  if (events === undefined) return "Event evidence not scanned";
  if (events === "unreadable") return "Event evidence unreadable";
  return "Scan " + fmt(events.scan) + " · " + fmt(events.event_count) + " events";
};
const VIEWS = ["Usage", "Sessions", "Access", "Evidence"];
const SUGGESTION_DESTINATIONS = {
  stale_collector: ["Evidence", "Agent adapter"],
  missing_cache_opportunity: ["Setup & privacy", "Discovery cache"],
  repeated_failed_work: ["Evidence", "Recent Ceal calls"],
  unknown_outcome_receipt: ["Evidence", "Recent Ceal calls"]
};
fetch("/api/observer/v2/state").then((r) => r.json()).then((s) => {
  const isSyntheticDemo = Array.isArray(s.agent_activity?.non_claims) && s.agent_activity.non_claims.some((claim) => String(claim).startsWith("Synthetic fixed-vocabulary review evidence"));
  if (isSyntheticDemo) {
    document.title = "Ceal Workbench · Synthetic demo";
    document.getElementById("boundary").innerHTML = "<strong>Synthetic demo data</strong> · Fixed presentation evidence only. No personal transcripts, credentials, provider payloads, or production usage are shown.";
  }
  const readinessView = "<div class=\\"grid\\">" + [
    ["Client session", s.session.status],
    ["Capability cache", s.discovery_cache.status + (s.discovery_cache.status === "cached" ? (s.discovery_cache.within_ttl ? " · fresh" : " · stale") : "")],
    ["Installed release", s.install.status],
    ["Agent guide", s.guide.status]
  ].map(([label, value]) => "<div class=\\"card\\"><h3>" + esc(label) + "</h3><strong>" + esc(String(value)) + "</strong></div>").join("") + "</div>";
  const activity = s.agent_activity;
  let agentView = "";
  if (Array.isArray(activity.adapters)) {
    agentView += activity.adapters.map((adapter) => {
      let body = "<div class=\\"muted\\">" + esc(String(adapter.runtime)) + " · " + esc(String(adapter.health)) + " · " + esc(String(adapter.coverage)) + (adapter.inventory === "partial" ? " · partial inventory" : "") + "</div>";
      if (Array.isArray(adapter.sessions) && adapter.sessions.length) {
        body += "<div class=\\"grid\\">" + adapter.sessions
          .map((sessionEntry) => "<button class=\\"card attention session\\" data-runtime=\\"" + esc(String(adapter.runtime)) + "\\" data-ref=\\"" + esc(sessionEntry.session_ref) + "\\"><strong>" + esc(String(adapter.runtime)) + " session</strong><span>" + esc(sessionEntry.last_activity_at) + "</span><p class=\\"muted\\">" + esc(sessionSummary(sessionEntry.events)) + "</p></button>")
          .join("") + "</div>";
      } else {
        body += "<p class=\\"muted\\">No locally observed sessions for this runtime.</p>";
      }
      return body;
    }).join("<hr>");
  }
  if (Array.isArray(activity.non_claims)) agentView += list(activity.non_claims, "warn");
  const sugg = s.suggestions ?? {};
  let suggView = Array.isArray(sugg.entries) && sugg.entries.length
    ? sugg.entries.map((entry, index) => "<button class=\\"card attention\\" data-attention=\\"" + index + "\\"><strong>" + esc(entry.suggestion) + "</strong><span class=\\"muted\\">Evidence: " + esc(fmt(entry.evidence)) + "</span><p class=\\"next\\">Next: " + esc(entry.next_action) + "</p></button>").join("")
    : "<div class=\\"card\\"><strong>No local-rule suggestions</strong><p class=\\"muted\\">This does not prove that the system is healthy or complete.</p></div>";
  if (typeof sugg.non_claim === "string") suggView += "<p class=\\"warn\\">" + esc(sugg.non_claim) + "</p>";
  const workBody = "<p>Recent local Agent sessions. Select one to inspect its observable event and token shape.</p>"
    + "<p class=\\"warn\\">This version cannot safely name the project, summarize the work, or prove which Ceal calls belong to a session.</p>"
    + section("Recent work (" + activity.status + ")", agentView);

  const parts = [];
  parts.push(section("Session (" + s.session.status + ")", rows(Object.entries(s.session))));
  const cache = s.discovery_cache;
  let cacheBody = rows(Object.entries(cache).filter(([k]) => k !== "capabilities"));
  if (Array.isArray(cache.capabilities) && cache.capabilities.length) {
    cacheBody += "<h2 class=\\"muted\\">Cached capabilities</h2>" + cache.capabilities
      .map((c) => rows(Object.entries(c))).join("<hr>");
  }
  parts.push(section("Discovery cache (" + cache.status + ")", cacheBody));
  parts.push(section("Installed release (" + s.install.status + ")", rows(Object.entries(s.install))));
  // The scalar fields project one host, so a supervisor reading only them would
  // miss a second host that is still staged or in conflict.
  let guideBody = rows(Object.entries(s.guide).filter(([, v]) => typeof v !== "object"));
  if (Array.isArray(s.guide.hosts) && s.guide.hosts.length) {
    guideBody += "<h2 class=\\"muted\\">Agent hosts</h2>" + s.guide.hosts
      .map((host) => rows(Object.entries(host))).join("<hr>");
  }
  parts.push(section("Agent guide (" + s.guide.status + ")", guideBody));
  let receiptsBody = "";
  if (Array.isArray(s.receipts.entries) && s.receipts.entries.length) {
    receiptsBody += rows(Object.entries(s.receipts).filter(([k]) => k !== "entries" && k !== "non_claim"));
    receiptsBody += "<h2 class=\\"muted\\">Recent call outcomes</h2>" + s.receipts.entries
      .map((entry, index) => "<button class=\\"card attention\\" data-receipt=\\"" + index + "\\"><strong>" + esc(entry.capability || "Ceal call") + "</strong><span class=\\"muted\\">" + esc(entry.recorded_at + " · " + entry.status + " · " + entry.evidence) + "</span></button>").join("");
  } else if (s.receipts.note) {
    receiptsBody += "<p class=\\"muted\\">" + esc(s.receipts.note) + "</p>";
    // Without this the drop count reaches the JSON and never the human: the
    // empty-history branch used to render the note alone, which is the one
    // branch where the whole signal is that something is missing.
    if (s.receipts.dropped_appends !== undefined) {
      receiptsBody += rows(Object.entries(s.receipts).filter(([k]) => k.startsWith("dropped_appends")));
    }
  }
  receiptsBody += "<p class=\\"warn\\">" + esc(s.receipts.non_claim) + "</p>";
  parts.push(section("Receipts (" + s.receipts.status + ")", receiptsBody));
  const setupBody = section("Local readiness", readinessView) + parts.slice(0, 4).join("");
  const cealBody = section("Attention", suggView) + parts.slice(4).join("");

  const dashboards = Array.isArray(s.local_usage_dashboards) ? s.local_usage_dashboards : [s.local_usage_dashboard];
  let dashboard = dashboards.find((entry) => entry.sources[0]?.runtime === "codex") || dashboards[0];
  observationTimezone = dashboard.timezone;
  const metricLabels = { sessions: ["Sessions", "세션"], agent_tool_calls: ["Agent tool calls", "도구 호출"], tokens: ["Tokens", "토큰"], estimated_cost: ["Estimated cost", "예상 비용"] };
  const metricUnits = { sessions: ["sessions", "세션"], agent_tool_calls: ["tool-call events", "도구 호출"], tokens: ["tokens", "토큰"], estimated_cost: ["estimated cost", "예상 비용"] };
  const metricDescriptions = {
    sessions: ["Days with locally observed Agent sessions.", "로컬에서 관측된 Agent 세션 수를 날짜별로 표시합니다."],
    agent_tool_calls: ["Structurally classified tool-call events, not Ceal or provider calls.", "구조적으로 분류된 도구 호출 이벤트입니다. Ceal 호출이나 Provider 호출 수가 아닙니다."],
    tokens: ["Runtime-reported token observations for the selected partition.", "선택한 런타임이 기록한 토큰 관측값입니다."],
    estimated_cost: ["Local estimate from covered tokens and an accepted pricing snapshot; not billed cost.", "관측된 토큰과 로컬 가격표로 계산한 추정치이며 실제 청구액이 아닙니다."]
  };
  const metricLabel = (metric) => metricLabels[metric][language === "ko" ? 1 : 0];
  const metricUnit = (metric) => metricUnits[metric][language === "ko" ? 1 : 0];
  const metricDescription = (metric) => metricDescriptions[metric][language === "ko" ? 1 : 0];
  let selectedMetric = "sessions";
  let sessionPage = 1;
  const sessionPageSize = 20;
  const observationStateLabel = (value) => {
    const labels = { complete:["complete","완전 관측"], partial:["partial","부분 관측"], observed_empty:["observed empty","관측 결과 없음"], unavailable:["unavailable","확인 불가"], unreadable:["unreadable","읽기 실패"], unsupported:["unsupported","미지원"] }[value] || [value,"상태 미확인"];
    return labels[language === "ko" ? 1 : 0];
  };
  const coverageCopy = (metric) => {
    const coverage = dashboard.metric_coverage[metric];
    const denominator = coverage.denominator === null ? tx("eligible population unknown", "전체 대상 수 미확인") : language === "ko" ? "전체 " + coverage.denominator + "개 세션" : coverage.denominator + " eligible sessions";
    return observationStateLabel(coverage.observation_state) + " · " + coverage.numerator + tx(" observed of ", "개 관측 / ") + denominator + " · " + coverage.comparability_group;
  };
  const metricValue = (metric) => {
    const value = dashboard.totals[metric];
    if (value === null) return tx("Unavailable", "확인 불가");
    if (metric === "estimated_cost" && dashboard.pricing.reason === "estimated_not_billed") return dashboard.pricing.currency + " " + value;
    return new Intl.NumberFormat(language === "ko" ? "ko-KR" : "en-US").format(value);
  };
  const usageOverview = () => {
    const metric = selectedMetric;
    const coverage = dashboard.metric_coverage[metric];
    const max = Math.max(1, ...dashboard.daily.map((day) => day[metric] ?? 0));
    const cells = dashboard.daily.map((day) => {
      const value = day[metric];
      const level = value === null || value === 0 ? 0 : value / max < .34 ? 1 : value / max < .67 ? 2 : 3;
      const label = day.date + " · " + (value === null ? tx("unavailable", "확인 불가") : value + " " + metricUnit(metric));
      return "<span class='day level-" + level + (value === null ? " unavailable" : "") + "' title='" + esc(label) + "' role='img' aria-label='" + esc(label) + "'></span>";
    }).join("");
    const identity = dashboard.identity.state === "available"
      ? "<div class='identity'><div><p class='eyebrow'>" + tx("LOCAL PROFILE", "로컬 프로필") + "</p><strong>" + esc(dashboard.identity.profile_ref) + "</strong><span class='muted'>" + tx("Instance ", "인스턴스 ") + esc(dashboard.identity.instance_ref) + "</span></div><span class='badge'>" + tx("Local profile", "로컬 프로필") + "</span></div>"
      : "<div class='unsupported'><strong>" + tx("Local Profile unavailable", "로컬 프로필 확인 불가") + "</strong><p>" + tx("No identity is inferred.", "프로필 정보를 추측하지 않습니다.") + "</p></div>";
    const axes = Object.keys(metricLabels).map((key) => "<button type='button' data-metric='" + key + "' aria-pressed='" + String(key === metric) + "'><span>" + esc(metricLabel(key)) + "</span><strong>" + esc(metricValue(key)) + "</strong></button>").join("");
    const runtimeAxes = dashboards.map((entry) => { const runtime = entry.sources[0]?.runtime || "unknown"; return "<button type='button' data-runtime='" + esc(runtime) + "' aria-pressed='" + String(entry === dashboard) + "'>" + esc(runtime === "codex" ? "Codex" : "Claude") + "</button>"; }).join("");
    const availability = coverage.observation_state === "unsupported" || coverage.observation_state === "unavailable" || coverage.observation_state === "unreadable"
      ? "<div class='unsupported'><strong>" + esc(metricLabel(metric)) + " · " + esc(observationStateLabel(coverage.observation_state)) + "</strong><p>" + tx("Missing evidence is not rendered as zero.", "없는 데이터는 0으로 표시하지 않습니다.") + "</p></div>"
      : "<div class='activity-grid' aria-label='" + esc(tx("Daily " + metricLabel(metric), metricLabel(metric) + " 일별 분포")) + "'>" + cells + "</div>";
    const headline = dashboard.totals[metric] === null
      ? esc(metricLabel(metric)) + " · " + esc(observationStateLabel(coverage.observation_state))
      : language === "ko" ? "<em>" + esc(metricValue(metric)) + "</em> " + esc(metricUnit(metric)) + "이 관측되었습니다." : "<em>" + esc(metricValue(metric)) + "</em> " + esc(metricUnit(metric)) + " observed.";
    const suggestionKorean = (entry) => {
      const percent = entry.rationale.match(/([0-9]+)%/u)?.[1];
      if (entry.suggestion_id === "token_concentration") return ["토큰 사용이 한 세션에 집중되어 있습니다.", "완전히 관측된 세션 중 하나가 전체 토큰의 " + (percent ? percent + "%" : "절반 이상") + "를 차지합니다. 생산성 평가는 아닙니다."];
      if (entry.suggestion_id === "tool_concentration") return ["도구 호출이 한 세션에 집중되어 있습니다.", "완전히 관측된 세션 중 하나가 도구 호출의 " + (percent ? percent + "%" : "절반 이상") + "를 차지합니다. 반복 작업이나 낭비를 뜻하지 않습니다."];
      if (entry.suggestion_id === "token_coverage_gap") return ["토큰 합계는 관측된 일부 세션만 반영합니다.", "토큰 근거가 없는 세션은 합계에서 제외되어 있습니다."];
      if (entry.suggestion_id === "tool_coverage_gap") return ["현재 도구 호출 합계만으로 사용 방식을 판단하지 마세요.", "일부 세션의 도구 이벤트 근거가 완전하지 않습니다."];
      return ["비용을 계산할 근거가 아직 부족합니다.", "가격 또는 모델 근거가 준비되기 전까지 토큰 사용량을 참고하세요."];
    };
    const suggestionCard = (entry, index) => {
      const localized = language === "ko" ? suggestionKorean(entry) : [entry.recommendation, entry.rationale];
      const actionLabel = language === "ko" ? (entry.next_action.kind === "inspect_sessions" ? "근거 세션 보기" : "데이터 근거 보기") : entry.next_action.label;
      return "<article class='card'><span class='pill'>" + esc(entry.analyzer.analyzer_id + " v" + entry.analyzer.version) + "</span><h3>" + esc(localized[0]) + "</h3><p>" + esc(localized[1]) + "</p><p class='muted'>" + tx("Evidence", "근거") + ": " + esc(entry.evidence.metric) + (entry.evidence.session_refs.length ? " · " + entry.evidence.session_refs.length + tx(" referenced session", "개 세션") : " · " + tx("aggregate coverage", "집계 범위")) + "</p><button type='button' class='next-action' data-suggestion-action='" + index + "'>" + esc(actionLabel) + "</button></article>";
    };
    const primarySuggestions = dashboard.suggestions.slice(0, 2).map(suggestionCard).join("");
    const remainingSuggestions = dashboard.suggestions.slice(2);
    const usageSuggestions = dashboard.suggestions.length
      ? primarySuggestions + (remainingSuggestions.length ? "<details class='suggestion-more'><summary>" + remainingSuggestions.length + tx(" more suggestions", "개의 제안 더 보기") + "</summary>" + remainingSuggestions.map((entry, index) => suggestionCard(entry, index + 2)).join("") + "</details>" : "")
      : "<div class='card'><strong>" + tx("No deterministic usage suggestions", "현재 표시할 사용 제안이 없습니다") + "</strong><p class='muted'>" + tx("This is not a completeness or productivity claim.", "상태가 완전하거나 생산성이 높다는 뜻은 아닙니다.") + "</p></div>";
    const legend = "<div class='heatmap-caption'><span>" + tx("Each square is one date present in the local observation window. Color intensity is relative to the busiest observed day; omitted dates are not inferred as zero.", "한 칸은 로컬 관측 범위에 포함된 날짜 하나입니다. 색은 관측된 가장 높은 날과 비교한 상대값이며, 표시되지 않은 날짜를 0으로 추정하지 않습니다.") + "</span><div class='legend'><span>" + tx("Observed zero", "관측값 0") + "</span><span class='legend-scale'><i class='day level-0'></i><i class='day level-1'></i><i class='day level-2'></i><i class='day level-3'></i></span><span>" + tx("Higher", "높음") + "</span><i class='day unavailable'></i><span>" + tx("Unavailable", "확인 불가") + "</span></div></div>";
    return identity
      + "<div class='metric-tabs runtime-tabs' role='group' aria-label='" + tx("Runtime partition", "런타임 구분") + "'>" + runtimeAxes + "</div><section class='hero'><p class='eyebrow'>" + tx("LOCAL USAGE", "로컬 사용량") + " · " + esc(dashboard.window.start_date) + " — " + esc(dashboard.window.end_date) + "</p><h2>" + headline + "</h2><p class='hero-summary'>" + esc(metricDescription(metric)) + " " + tx("Runtime accounting stays partitioned; missing values are never treated as zero.", "런타임별 집계는 분리되며 없는 값은 0으로 간주하지 않습니다.") + "</p></section>"
      + "<div class='metric-tabs' role='group' aria-label='" + tx("Usage metric", "사용량 지표") + "'>" + axes + "</div>"
      + "<section class='overview-section'><div class='section-head'><div><p class='eyebrow'>" + tx("ACTIVITY FIELD", "활동 분포") + "</p><h2>" + tx("When and how much you worked", "언제 얼마나 사용했는지") + "</h2></div></div>" + availability + legend + "<p class='evidence-line'>" + tx("Source", "출처") + ": " + esc(coverage.source_refs.join(", ")) + " <span>·</span> " + tx("Coverage", "관측 범위") + ": " + esc(coverageCopy(metric)) + (metric === "estimated_cost" && dashboard.pricing.reason === "estimated_not_billed" ? " <span>·</span> " + tx("Estimated locally; not billed cost", "로컬 추정치이며 실제 청구액이 아님") : "") + "</p></section>"
      + "<section class='overview-section'><div class='section-head'><div><p class='eyebrow'>" + tx("SUGGESTIONS", "제안") + "</p><h2>" + tx("Ways to use Ceal better", "사용 패턴에서 확인할 점") + "</h2></div></div>" + usageSuggestions + "<p class='warn'>" + tx("Deterministic local rules over the canonical dataset; not model judgment or a productivity score.", "정규화된 로컬 데이터에 적용한 고정 규칙이며 모델 판단이나 생산성 점수가 아닙니다.") + "</p></section>";
  };
  const sessionsView = () => {
    const total = dashboard.sessions.length;
    const coverage = dashboard.session_detail_coverage;
    const pageCount = Math.max(1, Math.ceil(total / sessionPageSize));
    sessionPage = Math.min(sessionPage, pageCount);
    const start = (sessionPage - 1) * sessionPageSize;
    const visible = dashboard.sessions.slice(start, start + sessionPageSize);
    const demoTasksKo = ["API 인증 흐름 구현", "대시보드 사용량 화면 개선", "권한 모델 검토", "테스트 실패 원인 분석", "CLI 배포 절차 정리", "데이터 계약 리팩터링"];
    const demoTasksEn = ["Implement API authentication", "Improve usage dashboard", "Review access model", "Investigate test failure", "Document CLI release flow", "Refactor data contract"];
    const cards = visible.length ? visible.map((entry, index) => {
      const absoluteIndex = start + index;
      const task = isSyntheticDemo ? (language === "ko" ? demoTasksKo : demoTasksEn)[absoluteIndex % demoTasksKo.length] : tx("Work details unavailable", "작업 내용 미확인");
      const taskNote = isSyntheticDemo ? tx("Synthetic task label", "합성 작업명") : tx("No privacy-safe task title was produced", "안전하게 표시할 작업명이 생성되지 않음");
      const tools = entry.agent_tool_calls === null ? tx("Tools unknown", "도구 호출 미확인") : entry.agent_tool_calls + tx(" tool calls", "회 도구 호출");
      const tokens = entry.tokens === null ? tx("Tokens unknown", "토큰 미확인") : new Intl.NumberFormat(language === "ko" ? "ko-KR" : "en-US").format(entry.tokens) + tx(" tokens", " 토큰");
      const model = entry.model_key === null ? tx("Model unknown", "모델 미확인") : entry.model_key;
      return "<button class='card attention canonical-session session-card' data-session-ref='" + esc(entry.session_ref) + "'><span class='pill'>" + esc(entry.runtime) + "</span><strong>" + esc(task) + "</strong><div class='session-meta'><span>" + esc(taskNote) + "</span><time>" + esc(formatTime(entry.last_activity_at)) + "</time></div><div class='session-metrics'><span>" + esc(tools) + "</span><span>" + esc(tokens) + "</span><span>" + esc(model) + "</span></div></button>";
    }).join("") : coverage.observation_state === "observed_empty" ? "<div class='unsupported'><strong>" + tx("No sessions observed in the selected window", "선택한 기간에 관측된 세션이 없습니다") + "</strong><p>" + tx("The bounded source was readable and observed empty.", "데이터 소스는 읽을 수 있었으며 결과가 비어 있었습니다.") + "</p></div>" : "<div class='unsupported'><strong>" + tx("Session inventory", "세션 목록") + " · " + esc(observationStateLabel(coverage.observation_state)) + "</strong><p>" + tx("No zero-session claim is made.", "세션이 0개라고 단정하지 않습니다.") + "</p></div>";
    const population = coverage.eligible === null ? (language === "ko" ? total + "개 반환 · 전체 대상 수 미확인" : total + " returned sessions; eligible total unknown") : (language === "ko" ? "전체 " + coverage.eligible + "개 중 " + total + "개 반환" : total + " of " + coverage.eligible + " eligible sessions returned");
    const pagination = pageCount > 1 ? "<div class='pagination' aria-label='" + tx("Session pages", "세션 페이지") + "'><button type='button' data-page='" + (sessionPage - 1) + "'" + (sessionPage === 1 ? " disabled" : "") + ">" + tx("Previous", "이전") + "</button><span role='status' aria-live='polite'>" + (language === "ko" ? sessionPage + " / " + pageCount + " 페이지 · " : "Page " + sessionPage + " of " + pageCount + " · ") + population + "</span><button type='button' data-page='" + (sessionPage + 1) + "'" + (sessionPage === pageCount ? " disabled" : "") + ">" + tx("Next", "다음") + "</button></div>" : "<p class='evidence-line' role='status'>" + population + " · " + esc(coverageCopy("sessions")) + "</p>";
    const title = coverage.observation_state === "complete" || coverage.observation_state === "observed_empty" ? tx("What happened in each observed session", "각 세션에서 어떤 작업이 있었는지") : tx("Sessions returned from incomplete local evidence", "일부 로컬 근거에서 확인된 세션");
    return "<section class='hero compact'><p class='eyebrow'>" + tx("SESSIONS", "세션") + "</p><h2>" + esc(title) + "</h2><p class='hero-summary'>" + tx("Task titles appear only when a privacy-safe producer supplies them. The demo uses explicit synthetic labels; real evidence is never guessed.", "작업명은 안전한 데이터 생산자가 제공할 때만 표시합니다. 데모의 작업명은 합성 데이터이며 실제 작업 내용은 추측하지 않습니다.") + "</p></section><div class='session-list'>" + cards + "</div>" + pagination;
  };
  const accessView = () => {
    const access = dashboard.access;
    const capabilityDescription = (capability) => {
      const action = capability.effect === "write" ? tx("Can change external state", "외부 상태를 변경할 수 있음") : tx("Reads information without changing it", "정보를 변경하지 않고 조회함");
      const target = capability.target_requirement === "required" ? tx("A resource target is required", "대상 리소스를 지정해야 함") : capability.target_requirement === "optional" ? tx("A resource target is optional", "대상 리소스는 선택 사항") : tx("No resource target is needed", "대상 리소스가 필요하지 않음");
      return action + " · " + target;
    };
    const capabilityCards = access.observation_state === "available" && access.capabilities.length
      ? "<section><p class='eyebrow'>" + tx("CAPABILITY CATALOG", "사용 가능한 기능") + "</p><div class='capability-list'>" + access.capabilities.map((capability) => "<article class='capability-row'><div><h3>" + esc(capability.label) + "</h3><p class='mono muted'>" + esc(capability.capability_id) + "</p></div><p>" + esc(capabilityDescription(capability)) + "</p><div class='capability-kind'><span class='pill'>" + esc(capability.effect === "write" ? tx("WRITE", "변경") : tx("READ", "조회")) + "</span><p class='muted'>" + tx("Audit", "감사 근거") + ": " + esc(capability.evidence_requirement) + "</p></div></article>").join("") + "</div></section>"
      : access.observation_state === "available"
        ? "<div class='unsupported'><strong>" + tx("No capabilities returned", "사용 가능한 기능이 없습니다") + "</strong><p>" + tx("The Gateway returned an observed-empty capability catalog.", "Gateway가 비어 있는 기능 목록을 반환했습니다.") + "</p></div>"
        : "";
    const summary = access.observation_state === "available"
      ? "<div class='metric-strip'><div class='card'><h3>" + tx("AVAILABLE", "전체") + "</h3><strong>" + access.capability_count + "</strong></div><div class='card'><h3>" + tx("READ", "조회") + "</h3><strong>" + access.read_capability_count + "</strong></div><div class='card'><h3>" + tx("WRITE", "변경") + "</h3><strong>" + access.write_capability_count + "</strong></div></div><p class='evidence-line'>Gateway · " + tx("observed", "관측 시각") + " " + esc(formatTime(access.observed_at)) + "</p>"
      : "<div class='unsupported'><strong>" + tx("Capability access unavailable", "권한 정보를 확인할 수 없습니다") + "</strong><p>" + tx("No access count is inferred.", "권한 개수를 추측하지 않습니다.") + "</p></div>";
    const accessTitle = tx("What this Profile can do through Ceal", "이 프로필로 Ceal에서 할 수 있는 일");
    return "<section class='hero compact'><p class='eyebrow'>" + tx("ACCESS", "권한") + "</p><h2>" + accessTitle + "</h2><p class='hero-summary'>" + tx("Gateway-observed capabilities are grouped by whether they read or change state. This is not a complete resource inventory.", "Gateway가 확인한 기능을 조회와 변경으로 구분합니다. 접근 가능한 모든 리소스의 목록은 아닙니다.") + "</p></section>" + summary + capabilityCards + "<div class='unsupported'><strong>" + tx("Need access to something else?", "다른 리소스가 필요한가요?") + "</strong><p>" + tx("The resource catalog and request workflow still need an Admin-owned contract.", "리소스 목록과 접근 요청 방식은 아직 Admin 계약이 필요합니다.") + "</p><button type='button' disabled aria-describedby='access-reason'>" + tx("Request access", "접근 요청") + "</button><span id='access-reason' class='muted'> " + tx("Unavailable in this version", "현재 버전에서는 사용할 수 없음") + "</span></div>";
  };
  const evidenceView = () => {
    const receipt = s.receipts || {};
    const retained = typeof receipt.entry_count === "number" ? receipt.entry_count : null;
    const retentionDays = typeof receipt.bounds?.retention_ms === "number" ? Math.round(receipt.bounds.retention_ms / 86400000) : null;
    const dropped = typeof receipt.dropped_appends === "number" ? receipt.dropped_appends : null;
    const receiptState = receipt.status === "spooled" ? tx("Readable local history", "읽을 수 있는 로컬 기록") : receipt.status === "absent" ? tx("No retained local history", "보관된 로컬 기록 없음") : tx("Local history unavailable", "로컬 기록 확인 불가");
    const recent = Array.isArray(receipt.entries) ? receipt.entries.slice(0, 6) : [];
    const outcomeLabel = (value) => ({ completed:["Completed","완료"], blocked:["Blocked before completion","완료 전 차단"], error:["Ended with an error","오류로 종료"] }[value] || [value,"결과 상태 미확인"])[language === "ko" ? 1 : 0];
    const evidenceLabel = (value) => ({ readback_verified:["Verified by Gateway readback","Gateway 조회로 확인"], not_read_back:["Gateway readback was not performed","Gateway 조회를 수행하지 않음"], readback_unavailable:["Gateway readback was unavailable","Gateway 조회 불가"], outcome_unknown:["Final outcome is unknown","최종 결과 미확인"] }[value] || [value,"근거 상태 미확인"])[language === "ko" ? 1 : 0];
    const sourceStateLabel = (value) => ({ complete:["Complete","완전 관측"], partial:["Partial","부분 관측"], observed_empty:["Observed empty","관측 결과 없음"], unreadable:["Unreadable","읽기 실패"], unavailable:["Unavailable","확인 불가"] }[value] || [value,"상태 미확인"])[language === "ko" ? 1 : 0];
    const recentRows = recent.length ? "<div class='receipt-list'>" + recent.map((entry) => "<article class='receipt-row'><div><strong>" + esc(entry.capability || tx("Ceal call", "Ceal 호출")) + "</strong><p class='muted'>" + esc(formatTime(entry.recorded_at)) + "</p></div><span class='pill'>" + esc(outcomeLabel(entry.status)) + "</span><span class='muted'>" + esc(evidenceLabel(entry.evidence)) + "</span></article>").join("") + "</div>" : "<div class='unsupported'><strong>" + tx("No recent receipt detail", "최근 영수증 상세가 없습니다") + "</strong><p>" + tx("This does not prove that no Ceal call occurred.", "Ceal 호출이 없었다는 뜻은 아닙니다.") + "</p></div>";
    const sourceCards = dashboard.sources.map((source) => "<div class='card'><h3>" + esc(source.root_display) + "</h3><strong>" + esc(sourceStateLabel(source.observation_state)) + "</strong><p class='muted'>" + tx("Technical source: ", "기술 출처: ") + esc(source.source_ref) + "</p></div>").join("");
    const loss = dropped === null ? tx("No local loss counter is available.", "로컬 유실 카운터를 확인할 수 없습니다.") : language === "ko" ? "최소 " + dropped + "개의 기록 추가가 유실되었습니다. 이 기록은 완전하지 않습니다." : "At least " + dropped + " receipt appends were lost. This history is incomplete.";
    return "<section class='hero compact'><p class='eyebrow'>" + tx("EVIDENCE", "데이터 근거") + "</p><h2>" + tx("How much of this dashboard can be trusted", "이 대시보드의 숫자를 어디까지 믿을 수 있는지") + "</h2><p class='hero-summary'>" + tx("This page explains data sources, observation coverage, and known gaps. It is not a raw diagnostics dump.", "이 페이지는 데이터 출처와 관측 범위, 알려진 누락을 설명합니다. 내부 진단값을 그대로 나열하지 않습니다.") + "</p></section>"
      + "<section class='overview-section'><div class='section-head'><div><p class='eyebrow'>" + tx("USAGE SOURCES", "사용량 출처") + "</p><h2>" + tx("Runtime evidence currently in view", "현재 화면에 반영된 런타임 근거") + "</h2></div></div><div class='metric-strip'>" + sourceCards + "</div><p class='evidence-line'>" + tx("Selected session coverage", "선택한 세션 관측 범위") + ": " + esc(coverageCopy("sessions")) + "</p></section>"
      + "<section class='overview-section'><div class='section-head'><div><p class='eyebrow'>" + tx("LOCAL CALL HISTORY", "로컬 호출 기록") + "</p><h2>" + receiptState + "</h2></div></div><div class='metric-strip'><div class='card'><h3>" + tx("RETAINED OUTCOMES", "보관된 결과") + "</h3><strong>" + (retained === null ? tx("Unknown", "미확인") : retained) + "</strong></div><div class='card'><h3>" + tx("RETENTION", "보관 기간") + "</h3><strong>" + (retentionDays === null ? tx("Unknown", "미확인") : retentionDays + tx(" days", "일")) + "</strong></div><div class='card'><h3>" + tx("KNOWN LOST APPENDS", "확인된 유실") + "</h3><strong>" + (dropped === null ? tx("Unknown", "미확인") : tx("At least ", "최소 ") + dropped) + "</strong></div></div><p class='warn'>" + esc(loss) + "</p>" + recentRows + "<p class='evidence-line'>" + tx("Gateway receipt readback remains authoritative for an individual call outcome.", "개별 호출 결과는 Gateway 영수증 조회가 최종 근거입니다.") + "</p></section>"
      + "<section class='overview-section'><div class='section-head'><div><p class='eyebrow'>" + tx("KNOWN LIMITS", "알려진 한계") + "</p><h2>" + tx("What this dashboard does not claim", "이 대시보드가 단정하지 않는 것") + "</h2></div></div>" + list([tx("Local history is not the complete Gateway audit ledger.", "로컬 기록은 전체 Gateway 감사 로그가 아닙니다."), tx("Runtime token accounting is not comparable across partitions unless explicitly grouped.", "명시적으로 같은 그룹이 아닌 런타임 토큰 값은 서로 비교하지 않습니다."), tx("Session task names are not inferred from prompts or transcript content.", "프롬프트나 대화 내용으로 세션 작업명을 추측하지 않습니다."), tx("Missing evidence is never treated as zero.", "없는 근거를 0으로 간주하지 않습니다.")], "muted") + "</section>";
  };

  const usageEntries = [];
  if (Array.isArray(activity.adapters)) for (const adapter of activity.adapters) {
    if (!Array.isArray(adapter.sessions)) continue;
    for (const sessionEntry of adapter.sessions) {
      const tokenUsage = sessionEntry.events && sessionEntry.events.token_usage;
      if (tokenUsage) usageEntries.push({ runtime: adapter.runtime, session_ref: sessionEntry.session_ref, ...tokenUsage });
    }
  }
  const usageBody = "<p>Runtime-supplied token evidence for locally observed sessions. Missing values are unknown, not zero.</p>"
    + (usageEntries.length ? usageEntries.map((entry) => "<div class=\\"card\\">" + rows(Object.entries(entry)) + "</div>").join("")
      : "<div class=\\"card\\"><strong>No token evidence in the bounded session view</strong><p class=\\"muted\\">This may mean the runtime did not supply usage or the current scan did not include it.</p></div>")
    + "<p class=\\"warn\\">Token accounting from different runtimes may use different sources and completeness rules; this view does not rank or total them together.</p>";

  const runtimeSummaryCards = Array.isArray(activity.adapters) ? activity.adapters.map((adapter) => {
    const sessions = Array.isArray(adapter.sessions) ? adapter.sessions : [];
    const scanned = sessions.filter((entry) => entry.events && entry.events !== "unreadable").length;
    const tokenSessions = sessions.filter((entry) => entry.events && entry.events.token_usage).length;
    return "<div class=\\"card\\"><h3>" + esc(String(adapter.runtime)) + "</h3><strong>" + sessions.length + " visible session" + (sessions.length === 1 ? "" : "s") + "</strong><p class=\\"muted\\">" + scanned + " with event evidence · " + tokenSessions + " with token evidence</p><p class=\\"muted\\">" + esc(String(adapter.health)) + " · " + esc(String(adapter.coverage)) + (adapter.inventory === "partial" ? " · partial inventory" : "") + "</p></div>";
  }).join("") : "";
  const runtimeSummary = runtimeSummaryCards
    ? "<div class=\\"metric-strip\\">" + runtimeSummaryCards + "</div>"
    : "<div class=\\"unsupported\\"><strong>Runtime overview is unavailable</strong><p>No readable Agent adapter inventory was supplied. Missing sessions are not rendered as zero.</p></div>";

  const privacy = s.privacy ?? {};
  let privacyView = rows([["boundary", s.boundary],
    ["gateway_contact", privacy.gateway_contact], ["provider_contact", privacy.provider_contact],
    ["receipt_spool_retention", privacy.receipt_spool_retention]]);
  if (Array.isArray(privacy.local_sources)) {
    privacyView += "<h2 class=\\"muted\\">Local sources read by this client</h2>" + list(privacy.local_sources, "muted");
  }
  if (typeof privacy.transcript_handling === "string") privacyView += "<p>" + esc(privacy.transcript_handling) + "</p>";
  privacyView += list(s.non_claims, "warn");
  const privacyBody = setupBody + section("Privacy & retention (" + (privacy.status ?? "unavailable") + ")", privacyView);

  const bodies = { "Setup & privacy": privacyBody };
  const nav = document.getElementById("nav");
  const root = document.getElementById("root");
  const detail = document.getElementById("detail");
  const detailBody = document.getElementById("detail-body");
  let detailOrigin = null;
  const openDetail = (origin, title, content) => {
    detailOrigin = origin;
    document.getElementById("detail-title").textContent = title;
    detailBody.innerHTML = content;
    detail.showModal();
    document.getElementById("detail-close").focus();
  };
  document.getElementById("detail-close").addEventListener("click", () => detail.close());
  detail.addEventListener("close", () => {
    if (detailOrigin && document.contains(detailOrigin)) detailOrigin.focus();
    else document.querySelector("h1").focus();
  });
  let currentView = VIEWS[0];
  const show = (view, focusSelector) => {
    currentView = view;
    root.innerHTML = view === "Usage" ? usageOverview() : view === "Sessions" ? sessionsView() : view === "Access" ? accessView() : view === "Evidence" ? evidenceView() : bodies[view];
    for (const button of nav.querySelectorAll("button")) {
      button.setAttribute("aria-current", String(button.dataset.view === view));
    }
    if (focusSelector) root.querySelector(focusSelector)?.focus();
  };
  for (const view of VIEWS) {
    const button = document.createElement("button");
    button.dataset.view = view;
    button.textContent = viewLabel(view);
    button.addEventListener("click", () => show(view));
    nav.appendChild(button);
  }
  const openCanonicalSession = (origin) => {
    const entry = dashboard.sessions.find((candidate) => candidate.session_ref === origin.dataset.sessionRef);
    if (!entry) return false;
    const detail = "<div class='metric-strip'><div class='card'><h3>" + tx("LAST ACTIVITY", "최근 활동") + "</h3><strong>" + esc(formatTime(entry.last_activity_at)) + "</strong></div><div class='card'><h3>" + tx("TOOL CALLS", "도구 호출") + "</h3><strong>" + (entry.agent_tool_calls ?? tx("Unknown", "미확인")) + "</strong></div><div class='card'><h3>" + tx("TOKENS", "토큰") + "</h3><strong>" + (entry.tokens ?? tx("Unknown", "미확인")) + "</strong></div></div><p class='evidence-line'>" + tx("Session reference", "세션 참조") + ": " + esc(entry.session_ref) + " · " + tx("Model", "모델") + ": " + esc(entry.model_key || tx("unknown", "미확인")) + "</p><p class='warn'>" + tx("Local structural evidence only; no prompt or transcript content is rendered.", "로컬 구조 정보만 표시하며 프롬프트나 대화 내용은 보여주지 않습니다.") + "</p>";
    openDetail(origin, tx("Agent session evidence", "Agent 세션 근거"), detail);
    return true;
  };
  // Per-session drill-down: an explicit owner click fetches the bounded scan
  // for one listed session; a view switch discards the result (no local copy).
  root.addEventListener("click", (event) => {
    const runtimeButton = event.target.closest ? event.target.closest("button[data-runtime]") : null;
    if (runtimeButton) {
      const next = dashboards.find((entry) => entry.sources[0]?.runtime === runtimeButton.dataset.runtime);
      if (!next) return;
      dashboard = next;
      observationTimezone = dashboard.timezone;
      sessionPage = 1;
      show(currentView, "button[data-runtime='" + runtimeButton.dataset.runtime + "']");
      return;
    }
    const metricButton = event.target.closest ? event.target.closest("button[data-metric]") : null;
    if (metricButton) {
      selectedMetric = metricButton.dataset.metric;
      show("Usage", "button[data-metric='" + selectedMetric + "']");
      return;
    }
    const pageButton = event.target.closest ? event.target.closest("button[data-page]") : null;
    if (pageButton && !pageButton.disabled) {
      const previousPage = sessionPage;
      sessionPage = Number(pageButton.dataset.page);
      const lastPage = Math.max(1, Math.ceil(dashboard.sessions.length / sessionPageSize));
      const focusSelector = sessionPage < previousPage || sessionPage === lastPage ? ".pagination button:first-child" : ".pagination button:last-child";
      show("Sessions", focusSelector);
      return;
    }
    const suggestionAction = event.target.closest ? event.target.closest("button[data-suggestion-action]") : null;
    if (suggestionAction) {
      const entry = dashboard.suggestions[Number(suggestionAction.dataset.suggestionAction)];
      if (!entry) return;
      if (entry.next_action.kind === "inspect_sessions" && entry.evidence.session_refs.length) {
        const sessionRef = entry.evidence.session_refs[0];
        const sessionIndex = dashboard.sessions.findIndex((candidate) => candidate.session_ref === sessionRef);
        if (sessionIndex < 0) return;
        sessionPage = Math.floor(sessionIndex / sessionPageSize) + 1;
        show("Sessions", "button[data-session-ref='" + sessionRef + "']");
        const sessionButton = root.querySelector("button[data-session-ref='" + sessionRef + "']");
        if (sessionButton) openCanonicalSession(sessionButton);
        return;
      }
      if (entry.next_action.kind === "review_evidence") {
        show("Evidence");
        nav.querySelector("button[data-view='Evidence']")?.focus();
      }
      return;
    }
    const canonicalSession = event.target.closest ? event.target.closest("button[data-session-ref]") : null;
    if (canonicalSession) {
      openCanonicalSession(canonicalSession);
      return;
    }
    const attention = event.target.closest ? event.target.closest("button[data-attention]") : null;
    if (attention) {
      const entry = sugg.entries[Number(attention.dataset.attention)];
      const destination = SUGGESTION_DESTINATIONS[entry.kind];
      const source = destination ? "<p class=\\"muted\\">Source: " + esc(destination[1]) + " in " + esc(destination[0]) + "</p>" : "";
      openDetail(attention, "Attention evidence", source + rows(Object.entries(entry.evidence || {}))
        + "<h2>Next safe action</h2><p>" + esc(entry.next_action) + "</p><p class=\\"warn\\">" + esc(sugg.non_claim || "Local evidence only.") + "</p>");
      return;
    }
    const receiptButton = event.target.closest ? event.target.closest("button[data-receipt]") : null;
    if (receiptButton) {
      const receipt = s.receipts.entries[Number(receiptButton.dataset.receipt)];
      const needsReadback = ["not_read_back", "readback_unavailable", "outcome_unknown"].includes(receipt.evidence)
        && typeof receipt.request_ref === "string";
      const next = needsReadback
        ? "<h2>Authoritative readback</h2><code>ceal receipt show " + esc(receipt.request_ref) + "</code>"
        : "";
      openDetail(receiptButton, "Ceal call evidence", rows(Object.entries(receipt)) + next
        + "<p class=\\"warn\\">" + esc(s.receipts.non_claim) + "</p>");
      return;
    }
    const sessionButton = event.target.closest ? event.target.closest("button.session") : null;
    if (!sessionButton) return;
    const adapter = activity.adapters.find((candidate) => String(candidate.runtime) === sessionButton.dataset.runtime);
    const sessionEntry = adapter && Array.isArray(adapter.sessions)
      ? adapter.sessions.find((candidate) => candidate.session_ref === sessionButton.dataset.ref)
      : null;
    if (sessionEntry && sessionEntry.events !== undefined) {
      openDetail(sessionButton, "Agent session evidence", rows([
        ["runtime", adapter.runtime], ["session_ref", sessionEntry.session_ref],
        ["last_activity_at", sessionEntry.last_activity_at], ["events", sessionEntry.events]
      ]) + "<p class=\\"warn\\">Local fixed-vocabulary evidence only; no prompt or transcript content is rendered.</p>");
      return;
    }
    sessionButton.disabled = true;
    sessionButton.setAttribute("aria-busy", "true");
    fetch("/api/observer/v1/agent-session/" + sessionButton.dataset.runtime + "/" + sessionButton.dataset.ref)
      .then((r) => r.json())
      .then((sessionDetail) => {
        sessionButton.disabled = false;
        sessionButton.removeAttribute("aria-busy");
        openDetail(sessionButton, "Agent session evidence", rows(Object.entries(sessionDetail))
          + "<p class=\\"warn\\">Local fixed-vocabulary evidence only; no prompt or transcript content is rendered.</p>");
      })
      .catch(() => {
        sessionButton.disabled = false;
        sessionButton.removeAttribute("aria-busy");
        openDetail(sessionButton, "Session evidence unavailable", "<p>The bounded local scan could not read this session.</p>");
      });
  });
  document.getElementById("theme").addEventListener("change", (event) => {
    document.documentElement.dataset.theme = event.target.value;
  });
  const languageControl = document.getElementById("language");
  languageControl.value = language;
  const updateChrome = () => {
    document.documentElement.lang = language;
    for (const button of nav.querySelectorAll("button[data-view]")) button.textContent = viewLabel(button.dataset.view);
    const modeLabels = language === "ko" ? ["자동", "라이트", "다크"] : ["Auto", "Light", "Dark"];
    Array.from(document.querySelectorAll(".mode [data-mode]")).forEach((button, index) => { button.textContent = modeLabels[index]; });
    document.getElementById("detail-close").textContent = tx("Close", "닫기");
    document.getElementById("boundary").innerHTML = isSyntheticDemo
      ? "<strong>" + tx("Synthetic demo data", "합성 데모 데이터") + "</strong> · " + tx("Fixed presentation evidence only. No personal transcripts, credentials, provider payloads, or production usage are shown.", "화면 검토용 합성 근거만 사용합니다. 개인 대화, 인증정보, Provider 응답, 실제 운영 사용량은 표시하지 않습니다.")
      : tx("Personal Ceal view. Gateway and local evidence remain separately labeled; this page never calls a provider.", "개인 Ceal 화면입니다. Gateway 근거와 로컬 근거를 구분해 표시하며 Provider를 직접 호출하지 않습니다.");
  };
  languageControl.addEventListener("change", (event) => {
    language = event.target.value === "ko" ? "ko" : "en";
    updateChrome();
    show(currentView);
  });
  for (const button of document.querySelectorAll(".mode [data-mode]")) button.addEventListener("click", () => {
    if (button.dataset.mode === "system") delete document.documentElement.dataset.mode;
    else document.documentElement.dataset.mode = button.dataset.mode;
    for (const candidate of document.querySelectorAll(".mode [data-mode]")) {
      candidate.setAttribute("aria-pressed", String(candidate === button));
    }
  });
  document.documentElement.dataset.theme = "developer";
  updateChrome();
  show(VIEWS[0]);
}).catch(() => { document.getElementById("root").textContent = "Could not read Workbench state."; });
</script>
</body>
</html>
`;
