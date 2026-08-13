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
import type { CealStoredSession } from "./profile-store.js";
import type { CealReceiptSpoolState } from "./receipt-spool.js";
import { inspectInstalledWorkerRelease } from "./stable-update.js";

// Local client observer: one loopback page over the state this client already
// holds. Boundary (fixed): no admin surface, no provider credential, and no
// live refresh — the server never contacts the Gateway or any provider, and
// session token material never enters a response (structural allowlist, not
// string masking). Receipts render from the local receipt spool's allowlisted
// call-outcome metadata; the Gateway audit ledger stays authoritative.

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
}

const OBSERVER_NON_CLAIMS = [
	"This view renders cached/local state only; it does not prove current Gateway, policy, connector, or provider behavior.",
	"Absent or unverified Gateway data is unknown, not a denial or an availability claim.",
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
	const agentActivity = observeAgentAudit(runtime);
	return {
		schema_version: "ceal.observer_state.v1",
		command: "ceal",
		proof_level: "local_state",
		generated_at: new Date(now).toISOString(),
		boundary: { admin_surface: false, provider_credentials: false, live_refresh: false },
		session,
		discovery_cache: discoveryCache,
		install: observeInstall(runtime),
		guide: observeGuide(runtime),
		receipts,
		agent_activity: agentActivity,
		suggestions: buildLocalSuggestions(session, discoveryCache, receipts, agentActivity),
		privacy: observePrivacy(receipts),
		non_claims: [...OBSERVER_NON_CLAIMS],
	};
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
	"client_session_redacted",
	"client_discovery_cache",
	"installed_release_generation",
	"agent_guide_registration",
	"receipt_spool_metadata",
	"agent_runtime_transcript_inventory",
] as const;

const PRIVACY_LOCAL_SOURCES = [
	"~/.ceal/client-session.json (session identity; token fields never serialized)",
	"~/.ceal/client-discovery-cache.json (cached capability/target catalog)",
	"~/.ceal/receipt-spool.json (allowlisted call-outcome metadata)",
	"~/.ceal/receipt-spool-drops (count only, of receipts this client failed to spool; no per-call data)",
	"managed worker install layout (generation manifest metadata and staged guide asset presence)",
	"~/.codex/skills/ceal-guide and ~/.claude/skills/ceal-guide, or the directories CODEX_HOME/CLAUDE_CONFIG_DIR configure (guide registration link inspection; no skill content read)",
	"~/.claude/projects and ~/.codex/sessions, or the same subdirectories under the roots CLAUDE_CONFIG_DIR/CODEX_HOME configure (bounded local transcript scan; fixed-vocabulary metadata only)",
] as const;

function observePrivacy(receipts: Record<string, unknown>): Record<string, unknown> {
	const bounds = receipts.bounds;
	return {
		status: "declared",
		local_sources: [...PRIVACY_LOCAL_SOURCES],
		gateway_forwarding: "none",
		provider_contact: "none",
		transcript_handling:
			"Agent transcripts are parsed locally under fixed byte/line budgets for kind counts, timestamps, and runtime-supplied token totals; their text is never stored, rendered, or forwarded.",
		...(typeof bounds === "object" && bounds !== null ? { receipt_spool_retention: bounds } : {}),
	};
}

function observeAgentAudit(runtime: CealObserverRuntime): Record<string, unknown> {
	if (!runtime.inspectAgentAudit) return { status: "unavailable" };
	let state: CealAgentAuditState;
	try {
		state = runtime.inspectAgentAudit();
	} catch {
		return { status: "unavailable" };
	}
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
			membership_ref: session.membershipRef,
			registration_ref: session.registrationRef,
			client_ref: session.clientRef,
			subject_ref: session.subjectRef,
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
	const targets = Array.isArray(entry.discovery.targets) ? entry.discovery.targets : [];
	const targetCatalog = entry.discovery.target_catalog;
	return {
		status: "cached",
		cached_at: new Date(entry.cachedAt).toISOString(),
		age_ms: age,
		ttl_ms: ttl,
		within_ttl: withinTtl,
		gateway_endpoint: entry.key.gatewayEndpoint,
		profile_ref: entry.key.profileRef,
		membership_ref: entry.key.membershipRef,
		negotiated_protocol_version: entry.key.negotiatedProtocolVersion,
		capability_count: capabilities.length,
		capabilities: capabilities.map((capability) => scalarProjection(capability)),
		cached_target_count: targets.length,
		...(typeof targetCatalog === "object" && targetCatalog !== null ? { target_catalog: scalarProjection(targetCatalog) } : {}),
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
	if (url === "/api/observer/v1/state") {
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
  :root { color-scheme:light; --ink:#17211b; --muted:#667069; --line:#d9dfda; --paper:#f5f7f4; --panel:#fff; --soft:#e9eeea; --accent:#245b3c; --warn:#8a4b08; --selected:#e2ebff; }
  @media (prefers-color-scheme:dark) { :root:not([data-mode]) { color-scheme:dark; --ink:#edf2ee; --muted:#9ba79f; --line:#303a33; --paper:#101512; --panel:#171e19; --soft:#222b25; --accent:#72d09b; --warn:#f2b765; --selected:#23354a; } }
  :root[data-mode="dark"] { color-scheme:dark; --ink:#edf2ee; --muted:#9ba79f; --line:#303a33; --paper:#101512; --panel:#171e19; --soft:#222b25; --accent:#72d09b; --warn:#f2b765; --selected:#23354a; }
  :root[data-mode="light"] { color-scheme:light; --ink:#17211b; --muted:#667069; --line:#d9dfda; --paper:#f5f7f4; --panel:#fff; --soft:#e9eeea; --accent:#245b3c; --warn:#8a4b08; --selected:#e2ebff; }
  * { box-sizing: border-box; }
  body { background:var(--paper); color:var(--ink); font:14px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; margin:0 auto; max-width:76rem; padding:1.5rem 1.25rem 5rem; }
  h1 { font-size:1.15rem; letter-spacing:-.03em; margin:0; } h2 { font-size:1rem; margin:1.6rem 0 .75rem; }
  .topbar { display:flex; align-items:center; gap:1rem; flex-wrap:wrap; border-bottom:1px solid var(--line); padding-bottom:1rem; }
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
  .boundary { border-left:3px solid var(--accent); margin:.8rem 0 1.4rem; padding:.35rem .75rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr)); gap:.65rem; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:.9rem; }
  .card h3 { font-size:.82rem; margin:0 0 .35rem; color:var(--muted); }
  .attention { width:100%; color:inherit; text-align:left; font:inherit; cursor:pointer; margin-bottom:.6rem; }
  .attention strong { display:block; margin-bottom:.35rem; }
  .next { color:var(--accent); margin:.5rem 0 0; }
  dialog { width:min(38rem,calc(100% - 2rem)); border:1px solid var(--line); border-radius:12px; padding:0; box-shadow:0 24px 70px #0003; }
  dialog::backdrop { background:#17211b88; }
  .detail-head { display:flex; justify-content:space-between; align-items:center; padding:1rem 1.1rem; border-bottom:1px solid var(--line); }
  .detail-head h2 { margin:0; } .detail-body { padding:1rem 1.1rem 1.25rem; }
  nav { margin: 1rem 0; display: flex; gap: .5rem; }
  nav button { font: inherit; padding: .2rem .8rem; border: 1px solid currentColor; border-radius: 4px; background: none; color: inherit; cursor: pointer; opacity: .65; }
  nav button[aria-current="true"] { opacity: 1; font-weight: 700; }
  nav button:focus-visible, .mode button:focus-visible, select:focus-visible { outline:3px solid var(--accent); outline-offset:2px; }
  .hero { padding:3.4rem 0 2.4rem; max-width:58rem; }
  .eyebrow { color:var(--accent); font-size:.7rem; letter-spacing:.12em; font-weight:700; text-transform:uppercase; }
  .hero h2 { font-size:clamp(2rem,5vw,4.2rem); line-height:1.04; letter-spacing:-.055em; margin:.7rem 0 1rem; }
  .hero h2 em { color:var(--accent); font-style:normal; }
  .evidence-line { color:var(--muted); display:flex; flex-wrap:wrap; gap:.4rem 1rem; }
  .overview-section { border-top:1px solid var(--ink); padding-top:1rem; margin-top:1rem; }
  .section-head { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }
  .section-head h2 { margin:0; font-size:1.25rem; }
  .activity-grid { display:grid; grid-template-rows:repeat(7,12px); grid-auto-flow:column; grid-auto-columns:12px; gap:4px; overflow:auto; padding:1.5rem 0 .7rem; }
  .day { width:12px; height:12px; border-radius:2px; background:var(--soft); }
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
  :root[data-theme="editorial"] .hero h2, :root[data-theme="editorial"] .section-head h2 { font-family:Georgia,"Times New Roman",serif; font-weight:400; }
  :root[data-theme="editorial"] { --selected:color-mix(in srgb,var(--warn) 12%,var(--panel)); }
  :root[data-theme="terminal"] body, :root[data-theme="terminal"] .hero h2, :root[data-theme="terminal"] .section-head h2 { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:-.025em; }
  :root[data-theme="terminal"] .card, :root[data-theme="terminal"] .unsupported, :root[data-theme="terminal"] select, :root[data-theme="terminal"] button { border-radius:2px; }
  :root[data-theme="terminal"] .day { border-radius:1px; }
  @media (max-width:700px) { .topbar nav { order:3; width:100%; overflow:auto; } .support-grid { grid-template-columns:1fr; } .hero { padding-top:2.2rem; } }
</style>
</head>
<body>
<header class="topbar"><h1 tabindex="-1">Ceal Workbench</h1><nav id="nav"></nav><div class="controls"><select id="theme" aria-label="Visual theme"><option value="developer">Developer</option><option value="editorial">Editorial</option><option value="terminal">Terminal</option></select><div class="mode" role="group" aria-label="Color appearance"><button type="button" data-mode="system" aria-pressed="true">Auto</button><button type="button" data-mode="light" aria-pressed="false">Light</button><button type="button" data-mode="dark" aria-pressed="false">Dark</button></div></div></header>
<p class="boundary">Local evidence only. This read-only page never contacts the Gateway or a provider. Reload after running a live command to see newer cached state.</p>
<div id="root">Loading local state…</div>
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
const VIEWS = ["Overview", "Agent activity", "Ceal evidence", "Setup & privacy"];
const SUGGESTION_DESTINATIONS = {
  stale_collector: ["Agent activity", "Agent adapter"],
  missing_cache_opportunity: ["Setup & privacy", "Discovery cache"],
  repeated_failed_work: ["Ceal evidence", "Recent Ceal calls"],
  unknown_outcome_receipt: ["Ceal evidence", "Recent Ceal calls"]
};
fetch("/api/observer/v1/state").then((r) => r.json()).then((s) => {
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
      let body = "<div class=\\"muted\\">" + esc(String(adapter.runtime)) + " · " + esc(String(adapter.health)) + " · " + esc(String(adapter.coverage)) + "</div>";
      if (Array.isArray(adapter.sessions) && adapter.sessions.length) {
        body += "<div class=\\"grid\\">" + adapter.sessions
          .map((sessionEntry) => "<button class=\\"card attention session\\" data-runtime=\\"" + esc(String(adapter.runtime)) + "\\" data-ref=\\"" + esc(sessionEntry.session_ref) + "\\"><strong>" + esc(String(adapter.runtime)) + " session</strong><span>" + esc(sessionEntry.last_activity_at) + "</span><p class=\\"muted\\">" + esc(sessionEntry.events === undefined ? "Select to scan locally observed events" : fmt(sessionEntry.events)) + "</p></button>")
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

  const localDateKey = (value) => {
    const date = new Date(value);
    const pad = (part) => String(part).padStart(2, "0");
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  };
  const periodStart = (days) => {
    if (days === "all") return null;
    const start = new Date(s.generated_at);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - Number(days) + 1);
    return start;
  };
  const activityOverview = (days) => {
    const entries = Array.isArray(s.receipts.entries) ? s.receipts.entries : [];
    const activityTimes = Array.isArray(s.receipts.activity_recorded_at) ? s.receipts.activity_recorded_at : entries.map((entry) => entry.recorded_at);
    const historyReadable = s.receipts.status === "spooled" || s.receipts.status === "absent";
    const start = periodStart(days);
    const generatedAt = new Date(s.generated_at);
    const filteredTimes = activityTimes.filter((value) => {
      const recordedAt = new Date(value);
      return !Number.isNaN(recordedAt.getTime()) && (!start || recordedAt >= start) && recordedAt <= generatedAt;
    });
    const counts = new Map();
    for (const value of filteredTimes) counts.set(localDateKey(value), (counts.get(localDateKey(value)) || 0) + 1);
    const calendarStart = start || (filteredTimes.length ? new Date(Math.min(...filteredTimes.map((value) => new Date(value).getTime()))) : new Date(s.generated_at));
    calendarStart.setHours(0, 0, 0, 0);
    const end = new Date(s.generated_at);
    end.setHours(0, 0, 0, 0);
    let cells = "";
    for (let offset = 0; offset < calendarStart.getDay(); offset += 1) cells += "<span class='day' aria-hidden='true'></span>";
    for (let date = new Date(calendarStart); date <= end; date.setDate(date.getDate() + 1)) {
      const key = localDateKey(date);
      const count = counts.get(key) || 0;
      const level = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : 3;
      const dayLabel = key + " · " + count + " locally recorded outcome" + (count === 1 ? "" : "s");
      cells += "<span class='day level-" + level + "' title='" + esc(dayLabel) + "' role='img' aria-label='" + esc(dayLabel) + "'></span>";
    }
    const periodLabel = days === "all" ? "all shown" : days + " days";
    const sourceState = s.receipts.status === "spooled" ? "readable retained history" : s.receipts.status;
    const dropCopy = !historyReadable
      ? "Drop evidence is unavailable with this source state."
      : s.receipts.dropped_appends === undefined
      ? "No known dropped-append count is present; completeness is not implied."
      : s.receipts.dropped_appends_note;
    const filteredEntries = entries.filter((entry) => {
      const recordedAt = new Date(entry.recorded_at);
      return !Number.isNaN(recordedAt.getTime()) && (!start || recordedAt >= start) && recordedAt <= generatedAt;
    });
    const outcomeCards = !historyReadable
      ? "<div class='unsupported'><strong>Receipt activity could not be read</strong><p>The local receipt source is " + esc(s.receipts.status) + ". No activity count is inferred.</p></div>"
      : filteredEntries.length
      ? filteredEntries.map((entry) => "<button class='card attention' data-receipt='" + entries.indexOf(entry) + "'><strong>" + esc(entry.capability || "Ceal outcome") + "</strong><span class='muted'>Recorded " + esc(entry.recorded_at) + " · " + esc(entry.status) + "</span></button>").join("")
      : "<div class='unsupported'><strong>No locally recorded outcomes in this selected view</strong><p>" + esc(s.receipts.note || "The retained local window has no matching entries.") + "</p><p>This is not proof of no Gateway activity.</p></div>";
    const heroClaim = historyReadable
      ? "<h2><em>" + filteredTimes.length + "</em> locally recorded outcomes are visible in this selected period of the retained window.</h2>"
      : "<h2>Receipt activity is unavailable.</h2>";
    const calendar = historyReadable
      ? "<div class='activity-grid' aria-label='Daily locally recorded Ceal outcomes'>" + cells + "</div><div class='legend'><span>Timezone: " + esc(Intl.DateTimeFormat().resolvedOptions().timeZone || "local") + "</span><span>·</span><span>All retained record times supplied by the bounded local spool are counted</span></div>"
      : "<div class='unsupported'><strong>Daily activity is unavailable</strong><p>The local source could not provide readable receipt history. Missing activity is not rendered as zero.</p></div>";
    const retainedCoverage = historyReadable
      ? "Activity received " + activityTimes.length + " retained record-time value" + (activityTimes.length === 1 ? "" : "s") + "; detail shows at most " + entries.length + " of " + esc(String(s.receipts.entry_count ?? entries.length)) + " retained entries."
      : "Retained-entry coverage is unavailable with this source state.";
    const outcomeCounts = new Map();
    const capabilityCounts = new Map();
    for (const entry of filteredEntries) {
      outcomeCounts.set(entry.status, (outcomeCounts.get(entry.status) || 0) + 1);
      const capability = entry.capability || "unlabeled capability";
      capabilityCounts.set(capability, (capabilityCounts.get(capability) || 0) + 1);
    }
    const mixCards = [...outcomeCounts].map(([label, count]) => "<div class='card'><h3>" + esc(label) + "</h3><strong>" + count + "</strong></div>").join("");
    const mixSummary = mixCards
      ? "<div class='metric-strip'>" + mixCards + "</div>"
      : "<div class='unsupported'><strong>No outcome mix in the visible detail subset</strong><p>No detailed receipt row matches this selected period.</p></div>";
    const capabilitySummary = [...capabilityCounts].map(([label, count]) => esc(label) + " · " + count).join("<br>") || "No capability labels in the visible detail subset.";
    return "<section class='hero'><p class='eyebrow'>LOCAL RECEIPT EVIDENCE · " + esc(periodLabel) + "</p>" + heroClaim + "<div class='evidence-line'><span>Timestamp: receipt record time, not exact call time</span><span>Authority: local advisory</span><span>Source: " + esc(sourceState) + "</span></div></section>"
      + "<section class='overview-section'><div class='section-head'><div><p class='eyebrow'>01 · ACTIVITY</p><h2>When outcomes entered this local history</h2></div><select id='period' aria-label='Activity period'><option value='30'" + (days === "30" ? " selected" : "") + ">30 days</option><option value='90'" + (days === "90" ? " selected" : "") + ">90 days</option><option value='365'" + (days === "365" ? " selected" : "") + ">365 days</option><option value='all'" + (days === "all" ? " selected" : "") + ">All shown</option></select></div>" + calendar + "</section>"
      + "<section class='overview-section'><div class='section-head'><div><p class='eyebrow'>02 · VISIBLE DETAIL</p><h2>Outcome and capability mix</h2></div></div><p class='muted'>These summaries use only the newest detailed receipt rows in the selected period, not the full activity projection.</p>" + mixSummary + "<div class='card'><h3>CAPABILITIES IN VISIBLE DETAIL</h3><p>" + capabilitySummary + "</p></div><div class='outcome-list'>" + outcomeCards + "</div></section>"
      + "<section class='overview-section'><div class='section-head'><div><p class='eyebrow'>03 · EVIDENCE</p><h2>What is known about this activity</h2></div></div><div class='support-grid'><div class='card'><h3>LOCAL COVERAGE</h3><strong>" + esc(sourceState) + "</strong><p class='muted'>" + retainedCoverage + "</p><p class='muted'>" + esc(dropCopy || "History may be incomplete.") + "</p><p class='muted'>" + esc(s.receipts.non_claim) + "</p></div><div class='unsupported'><strong>Correlated work and monetary cost are unsupported</strong><p>This observer has no producer-owned work-to-call correlation and no runtime-supplied monetary cost.</p><p>Missing values are not zero. No timestamp join or token-price estimate is used.</p></div></div></section>";
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

  const runtimeSummary = Array.isArray(activity.adapters) ? activity.adapters.map((adapter) => {
    const sessions = Array.isArray(adapter.sessions) ? adapter.sessions : [];
    const scanned = sessions.filter((entry) => entry.events && entry.events !== "unreadable").length;
    const tokenSessions = sessions.filter((entry) => entry.events && entry.events.token_usage).length;
    return "<div class=\\"card\\"><h3>" + esc(String(adapter.runtime)) + "</h3><strong>" + sessions.length + " visible session" + (sessions.length === 1 ? "" : "s") + "</strong><p class=\\"muted\\">" + scanned + " with event evidence · " + tokenSessions + " with token evidence</p><p class=\\"muted\\">" + esc(String(adapter.health)) + " · " + esc(String(adapter.coverage)) + "</p></div>";
  }).join("") : "";

  const privacy = s.privacy ?? {};
  let privacyView = rows([["boundary", s.boundary],
    ["gateway_forwarding", privacy.gateway_forwarding], ["provider_contact", privacy.provider_contact],
    ["receipt_spool_retention", privacy.receipt_spool_retention]]);
  if (Array.isArray(privacy.local_sources)) {
    privacyView += "<h2 class=\\"muted\\">Local sources read by this client</h2>" + list(privacy.local_sources, "muted");
  }
  if (typeof privacy.transcript_handling === "string") privacyView += "<p>" + esc(privacy.transcript_handling) + "</p>";
  privacyView += list(s.non_claims, "warn");
  const privacyBody = setupBody + section("Privacy & retention (" + (privacy.status ?? "unavailable") + ")", privacyView);

  const bodies = { "Overview": activityOverview("365"), "Agent activity": section("Runtime overview", "<div class=\\"metric-strip\\">" + runtimeSummary + "</div>") + workBody + section("Runtime-partitioned token evidence", usageBody), "Ceal evidence": cealBody, "Setup & privacy": privacyBody };
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
  const show = (view) => {
    root.innerHTML = bodies[view];
    for (const button of nav.querySelectorAll("button")) {
      button.setAttribute("aria-current", String(button.textContent === view));
    }
  };
  for (const view of VIEWS) {
    const button = document.createElement("button");
    button.textContent = view;
    button.addEventListener("click", () => show(view));
    nav.appendChild(button);
  }
  // Per-session drill-down: an explicit owner click fetches the bounded scan
  // for one listed session; a view switch discards the result (no local copy).
  root.addEventListener("click", (event) => {
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
  root.addEventListener("change", (event) => {
    if (event.target && event.target.id === "period") {
      bodies.Overview = activityOverview(event.target.value);
      show("Overview");
    }
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
}).catch(() => { document.getElementById("root").textContent = "Could not read local observer state."; });
</script>
</body>
</html>
`;
