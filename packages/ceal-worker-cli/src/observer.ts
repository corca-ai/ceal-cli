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
<html lang="en">
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
  .day.level-1 { background:color-mix(in srgb,var(--accent) 35%,var(--soft)); }
  .day.level-2 { background:color-mix(in srgb,var(--accent) 65%,var(--soft)); }
  .day.level-3 { background:var(--accent); }
  .legend { display:flex; gap:.5rem; align-items:center; color:var(--muted); font-size:.72rem; }
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
  .pagination { display:flex; justify-content:center; align-items:center; gap:1rem; margin:1.5rem 0; }
  .pagination button { font:inherit; border:1px solid var(--line); background:var(--panel); color:var(--ink); border-radius:6px; padding:.45rem .7rem; }
  .pagination button:disabled { opacity:.45; }
  .hero.compact { padding-bottom:1.4rem; }
  :root[data-theme="editorial"] .hero h2, :root[data-theme="editorial"] .section-head h2 { font-family:Georgia,"Times New Roman",serif; font-weight:400; }
  :root[data-theme="editorial"] { --selected:color-mix(in srgb,var(--warn) 12%,var(--panel)); }
  :root[data-theme="terminal"] body, :root[data-theme="terminal"] .hero h2, :root[data-theme="terminal"] .section-head h2 { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:-.025em; }
  :root[data-theme="terminal"] .card, :root[data-theme="terminal"] .unsupported, :root[data-theme="terminal"] select, :root[data-theme="terminal"] button { border-radius:2px; }
  :root[data-theme="terminal"] .day { border-radius:1px; }
  @media (max-width:700px) { body{padding:0 1rem 4rem}.topbar{padding:.7rem 0}.topbar nav { order:3; width:100%; overflow:auto; margin:0; } .controls{margin-left:auto}.support-grid, .session-list { grid-template-columns:1fr; } .metric-tabs { grid-template-columns:repeat(2,1fr); } .runtime-tabs{display:flex}.hero { padding-top:1.6rem; } .boundary{font-size:.78rem} }
</style>
</head>
<body>
<header class="topbar"><h1 tabindex="-1">Ceal Workbench</h1><nav id="nav"></nav><div class="controls"><select id="theme" aria-label="Visual theme"><option value="developer">Developer</option><option value="editorial">Editorial</option><option value="terminal">Terminal</option></select><div class="mode" role="group" aria-label="Color appearance"><button type="button" data-mode="system" aria-pressed="true">Auto</button><button type="button" data-mode="light" aria-pressed="false">Light</button><button type="button" data-mode="dark" aria-pressed="false">Dark</button></div></div></header>
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
const sessionSummary = (events) => {
  if (events === undefined) return "Event evidence not scanned";
  if (events === "unreadable") return "Event evidence unreadable";
  return "Scan " + fmt(events.scan) + " · " + fmt(events.event_count) + " events";
};
const VIEWS = ["Usage", "Sessions", "Access", "Evidence", "Setup & privacy"];
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
  const metricLabels = { sessions: "Sessions", agent_tool_calls: "Agent tool calls", tokens: "Tokens", estimated_cost: "Estimated cost" };
  const metricUnits = { sessions: "sessions", agent_tool_calls: "tool-call events", tokens: "tokens", estimated_cost: "estimated cost" };
  let selectedMetric = "sessions";
  let sessionPage = 1;
  const sessionPageSize = 20;
  const coverageCopy = (metric) => {
    const coverage = dashboard.metric_coverage[metric];
    const denominator = coverage.denominator === null ? "unknown eligible population" : coverage.denominator + " eligible sessions";
    return coverage.observation_state + " · " + coverage.numerator + " observed of " + denominator + " · " + coverage.comparability_group;
  };
  const metricValue = (metric) => {
    const value = dashboard.totals[metric];
    if (value === null) return "Unavailable";
    if (metric === "estimated_cost" && dashboard.pricing.reason === "estimated_not_billed") return dashboard.pricing.currency + " " + value;
    return new Intl.NumberFormat().format(value);
  };
  const usageOverview = () => {
    const metric = selectedMetric;
    const coverage = dashboard.metric_coverage[metric];
    const max = Math.max(1, ...dashboard.daily.map((day) => day[metric] ?? 0));
    const cells = dashboard.daily.map((day) => {
      const value = day[metric];
      const level = value === null || value === 0 ? 0 : value / max < .34 ? 1 : value / max < .67 ? 2 : 3;
      const label = day.date + " · " + (value === null ? "unavailable" : value + " " + metricUnits[metric]);
      return "<span class='day level-" + level + "' title='" + esc(label) + "' role='img' aria-label='" + esc(label) + "'></span>";
    }).join("");
    const identity = dashboard.identity.state === "available"
      ? "<div class='identity'><div><p class='eyebrow'>LOCAL PROFILE</p><strong>" + esc(dashboard.identity.profile_ref) + "</strong><span class='muted'>Instance " + esc(dashboard.identity.instance_ref) + "</span></div><span class='badge'>Local profile</span></div>"
      : "<div class='unsupported'><strong>Local Profile unavailable</strong><p>No identity is inferred.</p></div>";
    const axes = Object.keys(metricLabels).map((key) => "<button type='button' data-metric='" + key + "' aria-pressed='" + String(key === metric) + "'><span>" + esc(metricLabels[key]) + "</span><strong>" + esc(metricValue(key)) + "</strong></button>").join("");
    const runtimeAxes = dashboards.map((entry) => { const runtime = entry.sources[0]?.runtime || "unknown"; return "<button type='button' data-runtime='" + esc(runtime) + "' aria-pressed='" + String(entry === dashboard) + "'>" + esc(runtime === "codex" ? "Codex" : "Claude") + "</button>"; }).join("");
    const availability = coverage.observation_state === "unsupported" || coverage.observation_state === "unavailable" || coverage.observation_state === "unreadable"
      ? "<div class='unsupported'><strong>" + esc(metricLabels[metric]) + " is " + esc(coverage.observation_state) + "</strong><p>Missing evidence is not rendered as zero.</p></div>"
      : "<div class='activity-grid' aria-label='Daily " + esc(metricLabels[metric]) + "'>" + cells + "</div>";
    const headline = dashboard.totals[metric] === null
      ? esc(metricLabels[metric]) + " is " + esc(coverage.observation_state) + "."
      : "<em>" + esc(metricValue(metric)) + "</em> " + esc(metricUnits[metric]) + " observed.";
    const suggestionCard = (entry, index) => "<article class='card'><span class='pill'>" + esc(entry.analyzer.analyzer_id + " v" + entry.analyzer.version) + "</span><h3>" + esc(entry.recommendation) + "</h3><p>" + esc(entry.rationale) + "</p><p class='muted'>Evidence: " + esc(entry.evidence.metric) + (entry.evidence.session_refs.length ? " · " + entry.evidence.session_refs.length + " referenced session" : " · aggregate coverage") + "</p><button type='button' class='next-action' data-suggestion-action='" + index + "'>" + esc(entry.next_action.label) + "</button></article>";
    const primarySuggestions = dashboard.suggestions.slice(0, 2).map(suggestionCard).join("");
    const remainingSuggestions = dashboard.suggestions.slice(2);
    const usageSuggestions = dashboard.suggestions.length
      ? primarySuggestions + (remainingSuggestions.length ? "<details class='suggestion-more'><summary>" + remainingSuggestions.length + " more suggestions</summary>" + remainingSuggestions.map((entry, index) => suggestionCard(entry, index + 2)).join("") + "</details>" : "")
      : "<div class='card'><strong>No deterministic usage suggestions</strong><p class='muted'>This is not a completeness or productivity claim.</p></div>";
    return identity
      + "<div class='metric-tabs runtime-tabs' role='group' aria-label='Runtime partition'>" + runtimeAxes + "</div><section class='hero'><p class='eyebrow'>LOCAL USAGE · " + esc(dashboard.window.start_date) + " — " + esc(dashboard.window.end_date) + "</p><h2>" + headline + "</h2><p class='hero-summary'>Local runtime evidence in " + esc(dashboard.timezone) + ". Runtime accounting stays partitioned; missing values are never treated as zero.</p></section>"
      + "<div class='metric-tabs' role='group' aria-label='Usage metric'>" + axes + "</div>"
      + "<section class='overview-section'><div class='section-head'><div><p class='eyebrow'>ACTIVITY FIELD</p><h2>When you worked</h2></div></div>" + availability + "<p class='evidence-line'>Source: " + esc(coverage.source_refs.join(", ")) + " <span>·</span> Coverage: " + esc(coverageCopy(metric)) + (metric === "estimated_cost" && dashboard.pricing.reason === "estimated_not_billed" ? " <span>·</span> Estimated locally; not billed cost" : "") + "</p></section>"
      + "<section class='overview-section'><div class='section-head'><div><p class='eyebrow'>SUGGESTIONS</p><h2>Ways to use Ceal better</h2></div></div>" + usageSuggestions + "<p class='warn'>Deterministic local rules over the canonical dataset; not model judgment or a productivity score.</p></section>";
  };
  const sessionsView = () => {
    const total = dashboard.sessions.length;
    const coverage = dashboard.session_detail_coverage;
    const pageCount = Math.max(1, Math.ceil(total / sessionPageSize));
    sessionPage = Math.min(sessionPage, pageCount);
    const start = (sessionPage - 1) * sessionPageSize;
    const visible = dashboard.sessions.slice(start, start + sessionPageSize);
    const cards = visible.length ? visible.map((entry) => "<button class='card attention canonical-session' data-session-ref='" + esc(entry.session_ref) + "'><strong>" + esc(entry.runtime) + " session</strong><span>" + esc(entry.last_activity_at) + "</span><p class='muted'>" + (entry.agent_tool_calls === null ? "Tool calls unavailable" : entry.agent_tool_calls + " tool calls") + " · " + (entry.tokens === null ? "Tokens unavailable" : new Intl.NumberFormat().format(entry.tokens) + " tokens") + " · " + (entry.model_key === null ? "Model unavailable" : "Model " + esc(entry.model_key)) + "</p></button>").join("") : coverage.observation_state === "observed_empty" ? "<div class='unsupported'><strong>No sessions observed in the selected window</strong><p>The bounded source was readable and observed empty.</p></div>" : "<div class='unsupported'><strong>Session inventory is " + esc(coverage.observation_state) + "</strong><p>No zero-session claim is made.</p></div>";
    const population = coverage.eligible === null ? total + " returned sessions; eligible total unknown" : total + " of " + coverage.eligible + " eligible sessions returned";
    const pagination = pageCount > 1 ? "<div class='pagination' aria-label='Session pages'><button type='button' data-page='" + (sessionPage - 1) + "'" + (sessionPage === 1 ? " disabled" : "") + ">Previous</button><span role='status' aria-live='polite'>Page " + sessionPage + " of " + pageCount + " · " + population + "</span><button type='button' data-page='" + (sessionPage + 1) + "'" + (sessionPage === pageCount ? " disabled" : "") + ">Next</button></div>" : "<p class='evidence-line' role='status'>" + population + " · " + esc(coverageCopy("sessions")) + "</p>";
    const title = coverage.observation_state === "complete" || coverage.observation_state === "observed_empty" ? "Sessions observed in the selected local window." : "Returned sessions from " + coverage.observation_state + " local evidence.";
    return "<section class='hero compact'><p class='eyebrow'>SESSIONS</p><h2>" + esc(title) + "</h2><p class='hero-summary'>Twenty rows per page keeps the returned list usable when local history grows beyond one hundred sessions.</p></section><div class='session-list'>" + cards + "</div>" + pagination;
  };
  const accessView = () => {
    const access = dashboard.access;
    const capabilityCards = access.observation_state === "available" && access.capabilities.length
      ? "<section><p class='eyebrow'>CAPABILITY CATALOG</p><div class='session-list'>" + access.capabilities.map((capability) => "<article class='card'><span class='pill'>" + esc(capability.effect) + "</span><h3>" + esc(capability.label) + "</h3><p class='mono'>" + esc(capability.capability_id) + "</p><p class='muted'>Resource target: " + esc(capability.target_requirement) + " · Audit evidence: " + esc(capability.evidence_requirement) + "</p></article>").join("") + "</div></section>"
      : access.observation_state === "available"
        ? "<div class='unsupported'><strong>No capabilities returned</strong><p>The Gateway returned an observed-empty capability catalog.</p></div>"
        : "";
    const summary = access.observation_state === "available"
      ? "<div class='metric-strip'><div class='card'><h3>AVAILABLE CAPABILITIES</h3><strong>" + access.capability_count + "</strong></div><div class='card'><h3>READ</h3><strong>" + access.read_capability_count + "</strong></div><div class='card'><h3>WRITE</h3><strong>" + access.write_capability_count + "</strong></div></div><p class='evidence-line'>Gateway authority · observed " + esc(access.observed_at) + "</p>"
      : "<div class='unsupported'><strong>Capability access unavailable</strong><p>No access count is inferred.</p></div>";
    const accessTitle = dashboard.identity.state === "available" ? "Gateway-observed access for this local Profile." : "Gateway-observed capability summary.";
    return "<section class='hero compact'><p class='eyebrow'>ACCESS</p><h2>" + accessTitle + "</h2><p class='hero-summary'>Gateway authority is independent from local Profile observation. This catalog describes capabilities, not a complete resource inventory.</p></section>" + summary + capabilityCards + "<div class='unsupported'><strong>Need access to something else?</strong><p>The resource catalog and request workflow still need an Admin-owned contract.</p><button type='button' disabled aria-describedby='access-reason'>Request access</button><span id='access-reason' class='muted'> Unavailable in this version</span></div>";
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

  const bodies = { "Evidence": cealBody, "Setup & privacy": privacyBody };
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
    root.innerHTML = view === "Usage" ? usageOverview() : view === "Sessions" ? sessionsView() : view === "Access" ? accessView() : bodies[view];
    for (const button of nav.querySelectorAll("button")) {
      button.setAttribute("aria-current", String(button.textContent === view));
    }
    if (focusSelector) root.querySelector(focusSelector)?.focus();
  };
  for (const view of VIEWS) {
    const button = document.createElement("button");
    button.textContent = view;
    button.addEventListener("click", () => show(view));
    nav.appendChild(button);
  }
  const openCanonicalSession = (origin) => {
    const entry = dashboard.sessions.find((candidate) => candidate.session_ref === origin.dataset.sessionRef);
    if (!entry) return false;
    openDetail(origin, "Agent session evidence", rows(Object.entries(entry)) + "<p class='warn'>Local structural evidence only; no prompt or transcript content is rendered.</p>");
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
      const direction = pageButton.textContent;
      sessionPage = Number(pageButton.dataset.page);
      const lastPage = Math.max(1, Math.ceil(dashboard.sessions.length / sessionPageSize));
      const focusSelector = direction === "Previous" || sessionPage === lastPage ? ".pagination button:first-child" : ".pagination button:last-child";
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
        Array.from(nav.querySelectorAll("button")).find((button) => button.textContent === "Evidence")?.focus();
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
  for (const button of document.querySelectorAll(".mode [data-mode]")) button.addEventListener("click", () => {
    if (button.dataset.mode === "system") delete document.documentElement.dataset.mode;
    else document.documentElement.dataset.mode = button.dataset.mode;
    for (const candidate of document.querySelectorAll(".mode [data-mode]")) {
      candidate.setAttribute("aria-pressed", String(candidate === button));
    }
  });
  document.documentElement.dataset.theme = "developer";
  show(VIEWS[0]);
}).catch(() => { document.getElementById("root").textContent = "Could not read Workbench state."; });
</script>
</body>
</html>
`;
