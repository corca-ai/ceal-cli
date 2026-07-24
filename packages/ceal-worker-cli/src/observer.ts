import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { CealAgentGuideState } from "./agent-guide.js";
import type { CealDiscoveryCacheEntry } from "./discovery-cache.js";
import type { CealStoredSession } from "./profile-store.js";
import { inspectInstalledWorkerRelease } from "./stable-update.js";

// Local client observer: one loopback page over the state this client already
// holds. Boundary (fixed): no admin surface, no provider credential, and no
// live refresh — the server never contacts the Gateway or any provider, and
// session token material never enters a response (structural allowlist, not
// string masking). Receipts have no local store, so they render as unknown.

export interface CealObserverRuntime {
	loadSession?: () => Promise<CealStoredSession | null>;
	loadDiscoveryCache?: () => Promise<CealDiscoveryCacheEntry | null>;
	inspectAgentGuide?: () => CealAgentGuideState;
	executablePath?: string;
	discoveryCacheTtlMs?: number;
	now?: () => number;
}

const OBSERVER_NON_CLAIMS = [
	"This view renders cached/local state only; it does not prove current Gateway, policy, connector, or provider behavior.",
	"Absent or unverified Gateway data is unknown, not a denial or an availability claim.",
] as const;

const RECEIPTS_UNKNOWN = {
	status: "unknown",
	non_claim: "Receipts have no local cache; live evidence exists only through 'ceal receipt show <request-ref>'.",
} as const;

export async function buildObserverState(runtime: CealObserverRuntime): Promise<Record<string, unknown>> {
	const now = runtime.now?.() ?? Date.now();
	return {
		schema_version: "ceal.observer_state.v1",
		command: "ceal",
		proof_level: "local_state",
		generated_at: new Date(now).toISOString(),
		boundary: { admin_surface: false, provider_credentials: false, live_refresh: false },
		session: await observeSession(runtime),
		discovery_cache: await observeDiscoveryCache(runtime, now),
		install: observeInstall(runtime),
		guide: observeGuide(runtime),
		receipts: RECEIPTS_UNKNOWN,
		non_claims: [...OBSERVER_NON_CLAIMS],
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
		...(Array.isArray(entry.discovery.non_claims) ? { non_claims: entry.discovery.non_claims.filter((value) => typeof value === "string") } : {}),
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

function scalarProjection(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null) return {};
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.filter(([, entry]) => ["string", "number", "boolean"].includes(typeof entry)));
}

// Loopback guard, after the agentsview pattern: only direct 127.0.0.1/localhost
// requests are served, a proxy-forwarded request fails closed, and the Host
// header must be a loopback name so a DNS-rebinding page cannot read state.
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const FORWARDED_HEADERS = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip"] as const;

function hostAllowed(hostHeader: string | undefined): boolean {
	if (!hostHeader) return false;
	const host = hostHeader.startsWith("[")
		? hostHeader.replace(/\]:\d+$/u, "]")
		: hostHeader.replace(/:\d+$/u, "");
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

const OBSERVER_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ceal local observer</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; }
  h1 { font-size: 1.2rem; } h2 { font-size: 1rem; margin-top: 1.6rem; }
  .badge { border: 1px solid currentColor; border-radius: 4px; padding: 0 .4rem; margin-left: .5rem; font-size: .8rem; }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; padding: .15rem .8rem .15rem 0; vertical-align: top; word-break: break-all; }
  .muted { opacity: .65; }
  .warn { color: #b45309; }
</style>
</head>
<body>
<h1>Ceal local observer <span class="badge">cached/local-safe</span><span class="badge">read-only</span></h1>
<p class="muted">No admin surface, no provider credentials, no live refresh. Reload the page after running a live command to see newer cached state.</p>
<div id="root">Loading local state…</div>
<script>
const rows = (pairs) => "<table>" + pairs
  .filter(([, v]) => v !== undefined && v !== null)
  .map(([k, v]) => "<tr><th>" + esc(k) + "</th><td>" + esc(String(v)) + "</td></tr>").join("") + "</table>";
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const section = (title, body) => "<h2>" + esc(title) + "</h2>" + body;
fetch("/api/observer/v1/state").then((r) => r.json()).then((s) => {
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
  parts.push(section("Agent guide (" + s.guide.status + ")", rows(Object.entries(s.guide).filter(([, v]) => typeof v !== "object"))));
  parts.push(section("Receipts (" + s.receipts.status + ")", "<p class=\\"warn\\">" + esc(s.receipts.non_claim) + "</p>"));
  parts.push(section("Non-claims", "<ul>" + s.non_claims.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul>"));
  document.getElementById("root").innerHTML = parts.join("");
}).catch(() => { document.getElementById("root").textContent = "Could not read local observer state."; });
</script>
</body>
</html>
`;
