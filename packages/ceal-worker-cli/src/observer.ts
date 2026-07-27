import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import {
	AGENT_AUDIT_NON_CLAIMS,
	type CealAgentAuditSession,
	type CealAgentAuditState,
	type CealAgentAuditTokenUsage,
	type CealAgentSessionEventsLookup,
} from "./agent-audit.js";
import type { CealAgentGuideState } from "./agent-guide.js";
import type { CealDiscoveryCacheEntry } from "./discovery-cache.js";
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
	loadReceiptSpool?: () => Promise<CealReceiptSpoolState | null>;
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

export async function buildObserverState(runtime: CealObserverRuntime): Promise<Record<string, unknown>> {
	const now = runtime.now?.() ?? Date.now();
	const receipts = await observeReceiptSpool(runtime);
	const session = await observeSession(runtime);
	const discoveryCache = await observeDiscoveryCache(runtime, now);
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
	if (session.status === "present" && cache.status === "absent") {
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
const PRIVACY_LOCAL_SOURCES = [
	"~/.ceal/client-session.json (session identity; token fields never serialized)",
	"~/.ceal/client-discovery-cache.json (cached capability/target catalog)",
	"~/.ceal/receipt-spool.json (allowlisted call-outcome metadata)",
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

async function observeReceiptSpool(runtime: CealObserverRuntime): Promise<Record<string, unknown>> {
	if (!runtime.loadReceiptSpool) return { status: "unavailable", non_claim: RECEIPT_SPOOL_NON_CLAIM };
	let spool: CealReceiptSpoolState | null;
	try {
		spool = await runtime.loadReceiptSpool();
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

async function observeSession(runtime: CealObserverRuntime): Promise<Record<string, unknown>> {
	if (!runtime.loadSession) return { status: "unavailable" };
	let session: CealStoredSession | null;
	try {
		session = await runtime.loadSession();
	} catch {
		return { status: "unreadable" };
	}
	if (!session) return { status: "absent" };
	// Structural allowlist: token fields are never read into this projection.
	return {
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
	};
}

async function observeDiscoveryCache(runtime: CealObserverRuntime, now: number): Promise<Record<string, unknown>> {
	if (!runtime.loadDiscoveryCache) return { status: "unavailable" };
	let entry: CealDiscoveryCacheEntry | null;
	try {
		entry = await runtime.loadDiscoveryCache();
	} catch {
		return { status: "unreadable" };
	}
	if (!entry) return { status: "absent" };
	const ttl = runtime.discoveryCacheTtlMs ?? 300_000;
	const age = Math.max(0, now - entry.cachedAt);
	const capabilities = Array.isArray(entry.discovery.capabilities) ? entry.discovery.capabilities : [];
	const targets = Array.isArray(entry.discovery.targets) ? entry.discovery.targets : [];
	const targetCatalog = entry.discovery.target_catalog;
	return {
		status: "cached",
		cached_at: new Date(entry.cachedAt).toISOString(),
		age_ms: age,
		ttl_ms: ttl,
		within_ttl: age < ttl,
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

// Workbench shell: the masterplan's first navigation — "My agent work" and
// "Ceal" stay deliberately separate views, and "Privacy & retention" makes the
// local data boundary and (absent) forwarding state inspectable. One embedded
// document over the one state endpoint; no router, no build step.
const OBSERVER_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ceal Workbench</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; }
  h1 { font-size: 1.2rem; } h2 { font-size: 1rem; margin-top: 1.6rem; }
  .badge { border: 1px solid currentColor; border-radius: 4px; padding: 0 .4rem; margin-left: .5rem; font-size: .8rem; }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; padding: .15rem .8rem .15rem 0; vertical-align: top; word-break: break-all; }
  .muted { opacity: .65; }
  .warn { color: #b45309; }
  nav { margin: 1rem 0; display: flex; gap: .5rem; }
  nav button { font: inherit; padding: .2rem .8rem; border: 1px solid currentColor; border-radius: 4px; background: none; color: inherit; cursor: pointer; opacity: .65; }
  nav button[aria-current="true"] { opacity: 1; font-weight: 700; }
</style>
</head>
<body>
<h1>Ceal Workbench <span class="badge">cached/local-safe</span><span class="badge">read-only</span></h1>
<p class="muted">No admin surface, no provider credentials, no live refresh. Reload the page after running a live command to see newer cached state.</p>
<nav id="nav"></nav>
<div id="root">Loading local state…</div>
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
const VIEWS = ["My agent work", "Ceal", "Privacy & retention"];
fetch("/api/observer/v1/state").then((r) => r.json()).then((s) => {
  const activity = s.agent_activity;
  let agentView = "";
  if (Array.isArray(activity.adapters)) {
    agentView += activity.adapters.map((adapter) => {
      let body = rows(Object.entries(adapter).filter(([k]) => k !== "sessions"));
      if (Array.isArray(adapter.sessions) && adapter.sessions.length) {
        body += "<h2 class=\\"muted\\">Recent sessions</h2>" + adapter.sessions
          .map((sessionEntry) => "<div>" + rows(Object.entries(sessionEntry))
            + (sessionEntry.events === undefined && typeof sessionEntry.session_ref === "string"
              ? "<button class=\\"drill\\" data-runtime=\\"" + esc(String(adapter.runtime)) + "\\" data-ref=\\"" + esc(sessionEntry.session_ref) + "\\">Scan events</button><div class=\\"drill-result\\"></div>"
              : "")
            + "</div>").join("<hr>");
      }
      return body;
    }).join("<hr>");
  }
  if (Array.isArray(activity.non_claims)) agentView += list(activity.non_claims, "warn");
  const sugg = s.suggestions ?? {};
  let suggView = Array.isArray(sugg.entries) && sugg.entries.length
    ? sugg.entries.map((entry) => rows(Object.entries(entry))).join("<hr>")
    : "<p class=\\"muted\\">No suggestions from the local rules.</p>";
  if (typeof sugg.non_claim === "string") suggView += "<p class=\\"warn\\">" + esc(sugg.non_claim) + "</p>";
  const agentBody = section("Suggestions (" + (sugg.status ?? "unavailable") + ")", suggView)
    + section("Agent activity (" + activity.status + ")", agentView);

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
      .map((entry) => rows(Object.entries(entry))).join("<hr>");
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
  const cealBody = parts.join("");

  const privacy = s.privacy ?? {};
  let privacyView = rows([["boundary", s.boundary],
    ["gateway_forwarding", privacy.gateway_forwarding], ["provider_contact", privacy.provider_contact],
    ["receipt_spool_retention", privacy.receipt_spool_retention]]);
  if (Array.isArray(privacy.local_sources)) {
    privacyView += "<h2 class=\\"muted\\">Local sources read by this client</h2>" + list(privacy.local_sources, "muted");
  }
  if (typeof privacy.transcript_handling === "string") privacyView += "<p>" + esc(privacy.transcript_handling) + "</p>";
  privacyView += list(s.non_claims, "warn");
  const privacyBody = section("Privacy & retention (" + (privacy.status ?? "unavailable") + ")", privacyView);

  const bodies = { "My agent work": agentBody, "Ceal": cealBody, "Privacy & retention": privacyBody };
  const nav = document.getElementById("nav");
  const root = document.getElementById("root");
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
    const drill = event.target.closest ? event.target.closest("button.drill") : null;
    if (!drill) return;
    drill.disabled = true;
    fetch("/api/observer/v1/agent-session/" + drill.dataset.runtime + "/" + drill.dataset.ref)
      .then((r) => r.json())
      .then((detail) => { drill.nextElementSibling.innerHTML = rows(Object.entries(detail)); })
      .catch(() => { drill.nextElementSibling.textContent = "Could not scan this session."; drill.disabled = false; });
  });
  show(VIEWS[0]);
}).catch(() => { document.getElementById("root").textContent = "Could not read local observer state."; });
</script>
</body>
</html>
`;
