import { required as requiredValue,requiredCapture } from "../../../test/required.ts";
import type { CealDiscoveryCacheKey } from "../dist/discovery-cache.js";
import { createCealDiscoveryCacheStore, DEFAULT_DISCOVERY_CACHE_TTL_MS, discoveryCacheEntryUsable } from "../dist/discovery-cache.js";
import { runCealCommand } from "../dist/index.js";
import type { CealObserverRuntime } from "../dist/observer.js";
import { buildObserverState, OBSERVER_DATA_SOURCES } from "../dist/observer.js";
import type { CealStoredSession } from "../dist/profile-store.js";
import { createCealSessionStore } from "../dist/profile-store.js";
import type { CealReceiptSpoolEntry } from "../dist/receipt-spool.js";
import { createCealReceiptSpoolStore as createRawReceiptSpoolStore } from "../dist/receipt-spool.js";
import { createCealSessionCapability } from "../dist/session-capability.js";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

const ACCESS_TOKEN = `ceal_personal_${"P".repeat(43)}`;
const REFRESH_TOKEN = `ceal_refresh_${"R".repeat(43)}`;
const TEST_SPOOL_IDENTITY = "a".repeat(64);
type ObserverHandle = { url: string; close: () => Promise<void> };
type ObserverSuggestion = { kind: string; evidence: unknown; next_action: string };
type ObserverState = {
	schema_version: string;
	session: { status: string; secrets: string; access_token?: unknown; profile_ref: string };
	discovery_cache: {
		status: string;
		capability_count?: number;
		capabilities?: unknown;
		within_ttl: boolean;
		age_ms: number;
		target_catalog?: unknown;
	};
	install: { status: string };
	guide: { status: string; hosts: Array<{ agent: string; status: string }> };
	receipts: {
		status: string;
		coverage?: string;
		entry_count?: number;
		entries: Array<{ request_ref: string; [key: string]: unknown }>;
		non_claim: string;
		dropped_appends: number;
		dropped_appends_capped: boolean;
		dropped_appends_are_a_floor: boolean;
		note: string;
	};
	agent_activity: { status: string; adapters: Array<Record<string, unknown>>; non_claims: string[] };
	suggestions: { status: string; entries: ObserverSuggestion[]; non_claim: string };
	privacy: {
		status: string;
		gateway_forwarding: string;
		provider_contact: string;
		receipt_spool_retention?: unknown;
		local_sources: string[];
		transcript_handling: string;
	};
};

function createCealReceiptSpoolStore(home: string, now: () => number = Date.now) {
	const store = createRawReceiptSpoolStore(home, now);
	return {
		load: () => store.load(TEST_SPOOL_IDENTITY),
		append: (value: CealReceiptSpoolEntry) => store.append(TEST_SPOOL_IDENTITY, value),
		recordDrop: () => store.recordDrop(TEST_SPOOL_IDENTITY),
		remove: () => store.remove(),
	};
}

test("ceal observe serves redacted cached state on a guarded loopback page", async (context) => {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-observer-home-"));
	context.after(() => rmSync(home, { recursive: true, force: true }));
	const sessionStore = createCealSessionStore(home);
	await sessionStore.save({
		gatewayEndpoint: "https://gateway.example.test/corca-ai/dev/api/ceal/v1",
		profileRef: "profile:observer-fixture",
		membershipRef: "membership:observer-fixture",
		registrationRef: "registration:observer-fixture",
		clientRef: "client:observer-fixture",
		subjectRef: "subject:observer-fixture",
		instanceRef: "instance:observer-fixture",
		accessToken: ACCESS_TOKEN,
		expiresAt: "2099-07-14T00:00:00.000Z",
		refreshToken: REFRESH_TOKEN,
		refreshTokenIdleExpiresAt: "2099-08-14T00:00:00.000Z",
		refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
	});
	const cacheStore = createCealDiscoveryCacheStore(home);
	await cacheStore.save({
		key: {
			gatewayEndpoint: "https://gateway.example.test/corca-ai/dev/api/ceal/v1",
			profileRef: "profile:observer-fixture",
			membershipRef: "membership:observer-fixture",
			negotiatedProtocolVersion: "1.4.0",
		},
		cachedAt: Date.parse("2026-07-24T00:00:00.000Z"),
		discovery: {
			schema_version: "ceal.gateway_discovery.v3",
			phase: "target_page",
			profile_ref: "profile:observer-fixture",
			membership_ref: "membership:observer-fixture",
			capabilities: [
				{
					capability_id: "message.search",
					label: "Search messages",
					effect: "read",
					target_requirement: "required",
					input_contract: { schema_version: "ceal.message_search_input.v1", required: ["query"], query: { type: "string", max_bytes: 512 } },
					evidence_requirement: "gateway_audit",
				},
			],
			targets: [],
			target_catalog: { target_count: 0, returned_count: 0, complete: true },
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		},
	});

	const spoolStore = createCealReceiptSpoolStore(home, () => Date.parse("2026-07-24T00:01:00.000Z"));
	await spoolStore.append({
		recordedAt: Date.parse("2026-07-24T00:00:30.000Z"),
		requestRef: "narnia:observer:1:call",
		status: "completed",
		evidence: "readback_verified",
		auditRefs: ["gateway-audit:event:777"],
		capabilityId: "message.search",
		targetRef: "target:team-inbox",
	});

	const io = collectingIo();
	let handle: ObserverHandle | undefined;
	const handleReady = new Promise((resolve) => {
		void runCealCommand(["observe", "--port", "0"], io, {
			session: createCealSessionCapability({ store: sessionStore }),
			loadDiscoveryCache: () => cacheStore.load(),
			loadReceiptSpool: () => spoolStore.load(),
			inspectAgentAudit: () => ({
				schemaVersion: "ceal.agent_activity.v1",
				adapters: [
					{
						runtime: "claude",
						root: "~/.claude",
						health: "active",
						coverage: "transcript-observed",
						depth: "session_events",
						sessionCount: 1,
						sessions: [
							{
								sessionRef: "11111111-2222-3333-4444-555555555555",
								lastActivityAt: Date.parse("2026-07-24T00:00:45.000Z"),
								transcriptBytes: 2048,
								events: {
									scan: "complete",
									eventCount: 3,
									kinds: { user_message: 1, tool_call: 1, assistant_message: 1 },
									unparsedLines: 0,
									firstEventAt: Date.parse("2026-07-24T00:00:40.000Z"),
									lastScannedEventAt: Date.parse("2026-07-24T00:00:45.000Z"),
									// Partial-field usage: only the supplied field may surface.
									tokenUsage: { source: "event_usage_sum", completeness: "full_transcript", usageEvents: 1, outputTokens: 15 },
								},
							},
						],
						eventScan: { scannedSessions: 1, sessionLimit: 3 },
					},
					{ runtime: "codex", root: "~/.codex", health: "unknown", coverage: "unsupported", note: "The Codex adapter is not implemented yet." },
				],
				nonClaims: ["Bounded event metadata only: fixed-vocabulary kind counts; raw payloads are never surfaced, copied, or forwarded."],
			}),
			inspectAgentSession: (runtimeName, sessionRef) => {
				if (runtimeName !== "claude" && runtimeName !== "codex") return null;
				if (sessionRef !== "11111111-2222-3333-4444-555555555555") return { status: "not_found" };
				return {
					status: "scanned",
					session: {
						sessionRef,
						lastActivityAt: Date.parse("2026-07-24T00:00:45.000Z"),
						transcriptBytes: 2048,
						events: {
							scan: "complete",
							eventCount: 3,
							kinds: { user_message: 1, tool_call: 1, assistant_message: 1 },
							unparsedLines: 0,
							firstEventAt: Date.parse("2026-07-24T00:00:40.000Z"),
							lastScannedEventAt: Date.parse("2026-07-24T00:00:45.000Z"),
							tokenUsage: {
								source: "event_usage_sum",
								completeness: "full_transcript",
								usageEvents: 1,
								inputTokens: 5,
								outputTokens: 15,
								cacheReadTokens: 100,
								cacheWriteTokens: 50,
							},
						},
					},
				};
			},
			inspectAgentGuide: () => ({
				status: "available",
				agent: "codex",
				guide_id: "ceal-guide",
				update_safe: true,
				registered: false,
				hosts: [
					{ agent: "codex", status: "staged", registration_path: "/tmp/codex/skills/ceal-guide", registered: false },
					{ agent: "claude", status: "registered", registration_path: "/tmp/claude/skills/ceal-guide", registered: true },
				],
			}),
			executablePath: process.execPath,
			now: () => Date.parse("2026-07-24T00:01:00.000Z"),
			onObserverListening: (value) => {
				handle = value;
				resolve(value);
			},
		}).then((code) => {
			io.exitCode = code;
		});
	});
	await handleReady;
	context.after(async () => {
		try {
			await closeObserverHandle(handle);
		} catch {
			/* already closed */
		}
	});

	const doc = parse(io.stdout.join(""));
	assert.equal(doc.schema_version, "ceal.observe.v1");
	assert.equal(doc.status, "serving");
	assert.match(doc.url, /^http:\/\/127\.0\.0\.1:\d+\/$/u);
	assert.deepEqual(doc.boundary, { admin_surface: false, provider_credentials: false, live_refresh: false });

	const stateResponse = await fetch(`${doc.url}api/observer/v1/state`);
	assert.equal(stateResponse.status, 200);
	assert.equal(stateResponse.headers.get("cache-control"), "no-store");
	const stateBody = await stateResponse.text();
	assert.doesNotMatch(stateBody, /ceal_personal_|ceal_refresh_/u);
	const state: ObserverState = JSON.parse(stateBody);
	assert.equal(state.schema_version, "ceal.observer_state.v1");
	assert.equal(state.session.status, "present");
	assert.equal(state.session.secrets, "redacted");
	assert.equal(state.session.access_token, undefined);
	assert.equal(state.session.profile_ref, "profile:observer-fixture");
	assert.equal(state.discovery_cache.status, "cached");
	assert.equal(state.discovery_cache.capability_count, 1);
	assert.deepEqual(state.discovery_cache.capabilities, [
		{
			capability_id: "message.search",
			label: "Search messages",
			effect: "read",
			target_requirement: "required",
			evidence_requirement: "gateway_audit",
		},
	]);
	assert.equal(state.discovery_cache.within_ttl, true);
	assert.equal(state.discovery_cache.age_ms, 60_000);
	assert.deepEqual(state.discovery_cache.target_catalog, { target_count: 0, returned_count: 0, complete: true });
	assert.equal(state.install.status, "unmanaged");
	assert.equal(state.guide.status, "available");
	// The scalar projection names one host, so the per-host list is what a
	// supervisor reads to see the other host's registration.
	assert.deepEqual(
		state.guide.hosts.map((host) => `${host.agent}:${host.status}`),
		["codex:staged", "claude:registered"],
	);
	assert.equal(state.receipts.status, "spooled");
	assert.equal(state.receipts.coverage, "ceal-mediated");
	assert.equal(state.receipts.entry_count, 1);
	assert.deepEqual(state.receipts.entries, [
		{
			recorded_at: "2026-07-24T00:00:30.000Z",
			request_ref: "narnia:observer:1:call",
			status: "completed",
			evidence: "readback_verified",
			capability: "message.search",
			target: "target:team-inbox",
			audit_refs: ["gateway-audit:event:777"],
		},
	]);
	assert.match(state.receipts.non_claim, /Gateway audit ledger stays authoritative/u);
	assert.equal(state.agent_activity.status, "inventoried");
	assert.deepEqual(state.agent_activity.adapters[0], {
		runtime: "claude",
		root: "~/.claude",
		health: "active",
		coverage: "transcript-observed",
		depth: "session_events",
		session_count: 1,
		sessions: [
			{
				session_ref: "11111111-2222-3333-4444-555555555555",
				last_activity_at: "2026-07-24T00:00:45.000Z",
				transcript_bytes: 2048,
				events: {
					scan: "complete",
					event_count: 3,
					kinds: { user_message: 1, tool_call: 1, assistant_message: 1 },
					unparsed_lines: 0,
					first_event_at: "2026-07-24T00:00:40.000Z",
					last_scanned_event_at: "2026-07-24T00:00:45.000Z",
					// Omitted-not-zero survives the projection: unsupplied fields have no key.
					token_usage: { source: "event_usage_sum", completeness: "full_transcript", usage_events: 1, output_tokens: 15 },
				},
			},
		],
		event_scan: { scanned_sessions: 1, session_limit: 3 },
	});
	assert.equal(requiredValue(state.agent_activity.adapters[1], "codex_agent_activity_adapter").coverage, "unsupported");
	assert.match(requiredValue(state.agent_activity.non_claims[0], "agent_activity_non_claim"), /never surfaced, copied, or forwarded/u);
	// A healthy fixture produces no suggestions: the rules stay silent instead
	// of inventing advice without observed evidence.
	assert.equal(state.suggestions.status, "evaluated");
	assert.deepEqual(state.suggestions.entries, []);
	assert.match(state.suggestions.non_claim, /not model judgment/u);
	assert.equal(state.privacy.status, "declared");
	assert.equal(state.privacy.gateway_forwarding, "none");
	assert.equal(state.privacy.provider_contact, "none");
	assert.deepEqual(state.privacy.receipt_spool_retention, { max_entries: 200, retention_ms: 30 * 24 * 60 * 60 * 1000 });
	assert.ok(state.privacy.local_sources.some((source) => source.includes("client-session.json")));
	assert.ok(state.privacy.local_sources.some((source) => source.includes("~/.codex/skills/ceal-guide")));
	assert.ok(state.privacy.local_sources.some((source) => source.includes("~/.claude/projects")));
	assert.match(state.privacy.transcript_handling, /never stored, rendered, or forwarded/u);

	const page = await fetch(doc.url);
	assert.equal(page.status, 200);
	const contentType = page.headers.get("content-type");
	const contentSecurityPolicy = page.headers.get("content-security-policy");
	assert.ok(contentType);
	assert.ok(contentSecurityPolicy);
	assert.match(contentType, /text\/html/u);
	assert.match(contentSecurityPolicy, /default-src 'none'/u);
	const html = await page.text();
	assert.match(html, /Ceal Observer/u);
	// A second registered host must be visible to a human supervisor, not only in
	// the JSON projection.
	assert.match(html, /Agent hosts/u);
	assert.match(html, /guide\.hosts/u);
	assert.match(html, /My agent work/u);
	assert.match(html, /Privacy & retention/u);
	assert.doesNotMatch(html, /ceal_personal_|ceal_refresh_/u);

	const drill = await fetch(`${doc.url}api/observer/v1/agent-session/claude/11111111-2222-3333-4444-555555555555`);
	assert.equal(drill.status, 200);
	const drillBody = await drill.json();
	assert.equal(drillBody.schema_version, "ceal.observer_agent_session.v1");
	assert.equal(drillBody.runtime, "claude");
	assert.equal(drillBody.status, "scanned");
	assert.deepEqual(drillBody.session, {
		session_ref: "11111111-2222-3333-4444-555555555555",
		last_activity_at: "2026-07-24T00:00:45.000Z",
		transcript_bytes: 2048,
		events: {
			scan: "complete",
			event_count: 3,
			kinds: { user_message: 1, tool_call: 1, assistant_message: 1 },
			unparsed_lines: 0,
			first_event_at: "2026-07-24T00:00:40.000Z",
			last_scanned_event_at: "2026-07-24T00:00:45.000Z",
			token_usage: {
				source: "event_usage_sum",
				completeness: "full_transcript",
				usage_events: 1,
				input_tokens: 5,
				output_tokens: 15,
				cache_read_tokens: 100,
				cache_write_tokens: 50,
			},
		},
	});
	assert.match(drillBody.non_claims[0], /never surfaced, copied, or forwarded/u);
	const drillMissing = await fetch(`${doc.url}api/observer/v1/agent-session/claude/99999999-9999-9999-9999-999999999999`);
	assert.equal(drillMissing.status, 404);
	assert.equal((await drillMissing.json()).status, "not_found");
	// A traversal-shaped ref never matches the route grammar.
	const drillBad = await fetch(`${doc.url}api/observer/v1/agent-session/claude/..%2F..%2Fetc%2Fpasswd`);
	assert.equal(drillBad.status, 404);
	assert.equal((await drillBad.json()).error, "unknown_observer_path");

	const rebound = await rawRequest(doc.url, "/api/observer/v1/state", { host: "evil.example:80" });
	assert.equal(rebound.status, 403);
	const forwarded = await fetch(`${doc.url}api/observer/v1/state`, { headers: { "x-forwarded-for": "203.0.113.7" } });
	assert.equal(forwarded.status, 403);
	const write = await fetch(doc.url, { method: "POST", body: "{}" });
	assert.equal(write.status, 405);
	const missing = await fetch(`${doc.url}unknown`);
	assert.equal(missing.status, 404);

	await closeObserverHandle(handle);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(io.exitCode, 0);
});

test("ceal observe renders a corrupt receipt spool as unreadable, not an empty history", async (context) => {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-observer-corrupt-"));
	context.after(() => rmSync(home, { recursive: true, force: true }));
	mkdirSync(path.join(home, ".ceal"), { mode: 0o700 });
	writeFileSync(path.join(home, ".ceal", "receipt-spool.json"), "{ not json", { mode: 0o600 });
	const spoolStore = createCealReceiptSpoolStore(home, () => Date.parse("2026-07-24T00:01:00.000Z"));

	const io = collectingIo();
	let handle: ObserverHandle | undefined;
	await new Promise((resolve) => {
		void runCealCommand(["observe", "--port", "0"], io, {
			loadReceiptSpool: () => spoolStore.load(),
			onObserverListening: (value) => {
				handle = value;
				resolve(value);
			},
		});
	});
	context.after(async () => {
		try {
			await closeObserverHandle(handle);
		} catch {
			/* already closed */
		}
	});
	const doc = parse(io.stdout.join(""));
	const state = await readJson<ObserverState>(await fetch(`${doc.url}api/observer/v1/state`));
	assert.equal(state.receipts.status, "unreadable");
	assert.equal("entries" in state.receipts, false);
	await closeObserverHandle(handle);
});

test("every ~/.ceal file this client reads is named in the privacy projection", async (context) => {
	// The page's whole claim is that it names the *fixed* local sources it reads.
	// A store that adds a file without adding it here does not break a test, it
	// makes a standing declaration quietly false — which is how the drops counter
	// shipped unlisted in the first place.
	//
	// The names therefore come from running the stores and reading the directory
	// back, not from a filename pattern matched against the sources. A pattern
	// only sees the files someone chose to name conventionally, which is the one
	// case that needs no help; the disk shows whatever a store actually wrote.
	const home = mkdtempSync(path.join(tmpdir(), "ceal-observer-privacy-"));
	context.after(() => rmSync(home, { recursive: true, force: true }));
	await createCealSessionStore(home).save({
		gatewayEndpoint: "https://gateway.example.test/corca-ai/dev/api/ceal/v1",
		profileRef: "profile:privacy-fixture",
		membershipRef: "membership:privacy-fixture",
		registrationRef: "registration:privacy-fixture",
		clientRef: "client:privacy-fixture",
		subjectRef: "subject:privacy-fixture",
		instanceRef: "instance:privacy-fixture",
		accessToken: ACCESS_TOKEN,
		expiresAt: "2099-07-14T00:00:00.000Z",
		refreshToken: REFRESH_TOKEN,
		refreshTokenIdleExpiresAt: "2099-08-14T00:00:00.000Z",
		refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
	});
	await createCealDiscoveryCacheStore(home).save({
		key: {
			gatewayEndpoint: "https://gateway.example.test/corca-ai/dev/api/ceal/v1",
			profileRef: "profile:privacy-fixture",
			membershipRef: "membership:privacy-fixture",
			negotiatedProtocolVersion: "1.4.0",
		},
		cachedAt: Date.parse("2026-07-24T00:00:00.000Z"),
		discovery: {
			schema_version: "ceal.gateway_discovery.v3",
			phase: "target_page",
			profile_ref: "profile:privacy-fixture",
			membership_ref: "membership:privacy-fixture",
			capabilities: [],
			targets: [],
			target_catalog: { target_count: 0, returned_count: 0, complete: true },
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		},
	});
	const privacySpool = createCealReceiptSpoolStore(home, () => Date.parse("2026-07-24T00:01:00.000Z"));
	await privacySpool.append({
		recordedAt: Date.parse("2026-07-24T00:00:30.000Z"),
		requestRef: "narnia:privacy:1:call",
		status: "completed",
		evidence: "readback_verified",
		auditRefs: [],
	});
	await privacySpool.recordDrop();
	const stateFiles = new Set(
		// Locks are coordination, not a source this page reads. Temporaries belong
		// to a write in flight and are gone by the time one finishes.
		readdirSync(path.join(home, ".ceal")).filter((name) => !name.endsWith(".lock") && !name.endsWith(".tmp")),
	);
	assert.ok(stateFiles.size >= 4, `only ${stateFiles.size} files were written; the stores driven above produce at least four`);
	// Reading the disk only sees the stores this test drives, so the store surface
	// itself is gated too: a new `~/.ceal` store must be exercised above or named
	// as writing somewhere else, and either way somebody had to look at it.
	const factories = new Set(
		readdirSync(new URL("../src", import.meta.url), { recursive: true })
			.filter((name) => String(name).endsWith(".ts"))
			.flatMap((name) => [
				// Both export forms, so moving a factory to `export const` cannot
				// quietly drop it out of this gate.
				...readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8").matchAll(
					/export (?:async )?(?:function|const|let) (createCeal\w*Store)/gu,
				),
			])
			.map((match) => requiredCapture(match, 1, "store_factory")),
	);
	const exercised = new Set(["createCealSessionStore", "createCealDiscoveryCacheStore", "createCealReceiptSpoolStore"]);
	// Registers guides into the agent host's own directory (~/.claude, ~/.codex),
	// which the transcript-handling line covers rather than the ~/.ceal list.
	const elsewhere = new Set(["createCealAgentGuideStore"]);
	assert.deepEqual(
		[...factories].filter((name) => !exercised.has(name) && !elsewhere.has(name)),
		[],
		"a local store is neither exercised by this sweep nor declared as writing outside ~/.ceal",
	);

	const io = collectingIo();
	let handle: ObserverHandle | undefined;
	await new Promise((resolve) => {
		void runCealCommand(["observe", "--port", "0"], io, {
			onObserverListening: (value) => {
				handle = value;
				resolve(value);
			},
		});
	});
	// Without this the server outlives a failed assertion and the whole run hangs
	// instead of reporting which file went undeclared.
	context.after(async () => {
		try {
			await closeObserverHandle(handle);
		} catch {
			/* already closed */
		}
	});
	const doc = parse(io.stdout.join(""));
	const declared = (await readJson<ObserverState>(await fetch(`${doc.url}api/observer/v1/state`))).privacy.local_sources.join("\n");
	assert.deepEqual(
		[...stateFiles].filter((name) => !declared.includes(name)),
		[],
		"a ~/.ceal file this client reads is missing from the declared privacy sources",
	);
	// The `ceal observe` envelope advertises the same fact in its own vocabulary,
	// and it used to be a second hand-kept list: a source added to one and not the
	// other goes quietly stale, which is exactly how the drops counter shipped
	// undeclared. Both now render from `observer.ts`, and this pins that.
	const envelope = parse(io.stdout.join(""));
	assert.deepEqual(envelope.data_sources, [...OBSERVER_DATA_SOURCES]);
	assert.ok(envelope.data_sources.includes("receipt_spool_metadata"));
	await closeObserverHandle(handle);
});

test("an empty retention window is not reported as every receipt having been lost", async (context) => {
	// Three unlike states share `entries: []`. A spool that exists but whose
	// entries all aged out of the 30-day window is the common one: those receipts
	// were recorded, and were rendered for a month. Saying "every receipt this
	// client tried to record was lost" there would swap the false claim this
	// counter removed for an equally false one pointing the other way.
	const io = collectingIo();
	let handle: ObserverHandle | undefined;
	await new Promise((resolve) => {
		void runCealCommand(["observe", "--port", "0"], io, {
			loadReceiptSpool: async () => ({
				entries: [],
				bounds: { maxEntries: 200, retentionMs: 30 * 24 * 60 * 60 * 1000 },
				drops: { count: 2, atLeast: false },
				spoolPresent: true,
			}),
			onObserverListening: (value) => {
				handle = value;
				resolve(value);
			},
		});
	});
	context.after(async () => {
		try {
			await closeObserverHandle(handle);
		} catch {
			/* already closed */
		}
	});
	const doc = parse(io.stdout.join(""));
	const state = await readJson<ObserverState>(await fetch(`${doc.url}api/observer/v1/state`));
	assert.equal(state.receipts.status, "absent");
	assert.equal(state.receipts.dropped_appends, 2);
	assert.match(state.receipts.note, /within the retention window/u);
	assert.doesNotMatch(state.receipts.note, /every receipt this client tried to record was lost/u);
	// The count has to reach the page, not just the API: the empty-history branch
	// used to render the note alone, which is the one branch where the whole
	// signal is that something is missing.
	//
	// Mechanism-only, and deliberately labelled as such: the page renders client
	// side and this gate has no DOM, so this pins the shape of the branch rather
	// than the rendered output. A plain `/dropped_appends/` match over the page
	// would be vacuous — the identifier appears in the script's own source.
	//
	// The limit that follows from that, stated rather than papered over: this
	// catches the branch being deleted (probed) and not the branch being
	// neutered, because a dead `if (false)` still carries the identifier. Closing
	// it needs a DOM in this gate, which is a larger move than this slice.
	const page = await (await fetch(doc.url)).text();
	const emptyHistoryBranch = /else if \(s\.receipts\.note\)\s*\{([\s\S]*?)\n {2}\}/u.exec(page);
	assert.ok(emptyHistoryBranch, "the page must still have an empty-history branch to check");
	assert.match(
		requiredValue(emptyHistoryBranch?.[1], "empty_history_branch"),
		/dropped_appends/u,
		"the empty-history branch must render the drop count, not only the note",
	);
	await closeObserverHandle(handle);
});

test("ceal observe says the receipt history is incomplete rather than short", async (context) => {
	// The spool swallows every append failure so a call's result cannot change,
	// which used to mean a lost receipt left the page rendering a shorter history
	// as if it were the whole one. The worst case is the first receipt being the
	// lost one: with no spool file at all, "no calls yet" is the strongest false
	// claim this page can make.
	const home = mkdtempSync(path.join(tmpdir(), "ceal-observer-drops-"));
	context.after(() => rmSync(home, { recursive: true, force: true }));
	const spoolStore = createCealReceiptSpoolStore(home, () => Date.parse("2026-07-24T00:01:00.000Z"));
	await spoolStore.recordDrop();
	await spoolStore.recordDrop();

	const io = collectingIo();
	let handle: ObserverHandle | undefined;
	await new Promise((resolve) => {
		void runCealCommand(["observe", "--port", "0"], io, {
			loadReceiptSpool: () => spoolStore.load(),
			onObserverListening: (value) => {
				handle = value;
				resolve(value);
			},
		});
	});
	context.after(async () => {
		try {
			await closeObserverHandle(handle);
		} catch {
			/* already closed */
		}
	});
	const doc = parse(io.stdout.join(""));
	const absent = await readJson<ObserverState>(await fetch(`${doc.url}api/observer/v1/state`));
	assert.equal(absent.receipts.status, "absent");
	assert.equal(absent.receipts.dropped_appends, 2);
	assert.equal(absent.receipts.dropped_appends_capped, false);
	assert.equal(absent.receipts.dropped_appends_are_a_floor, true);
	assert.match(absent.receipts.note, /every receipt this client tried to record was lost/u);
	assert.doesNotMatch(absent.receipts.note, /No spooled call outcomes yet/u);

	// With entries present the count rides alongside them, so a partial history
	// is not mistaken for a complete one either.
	await spoolStore.append({
		recordedAt: Date.parse("2026-07-24T00:00:30.000Z"),
		requestRef: "narnia:call:kept",
		status: "completed",
		evidence: "readback_verified",
		auditRefs: [],
	});
	const spooled = await readJson<ObserverState>(await fetch(`${doc.url}api/observer/v1/state`));
	assert.equal(spooled.receipts.status, "spooled");
	assert.equal(spooled.receipts.entry_count, 1);
	assert.equal(spooled.receipts.dropped_appends, 2);

	// A clean spool says nothing about drops at all: rendering a zero would
	// invite reading this page as provably complete, which it never is.
	await spoolStore.remove();
	await spoolStore.append({
		recordedAt: Date.parse("2026-07-24T00:00:40.000Z"),
		requestRef: "narnia:call:fresh",
		status: "completed",
		evidence: "readback_verified",
		auditRefs: [],
	});
	const clean = await readJson<ObserverState>(await fetch(`${doc.url}api/observer/v1/state`));
	assert.equal(clean.receipts.status, "spooled");
	assert.equal("dropped_appends" in clean.receipts, false);
	await closeObserverHandle(handle);
});

test("ceal observe reports absent stores and rejects invalid ports without serving", async () => {
	const io = collectingIo();
	let handle: ObserverHandle | undefined;
	await new Promise((resolve) => {
		void runCealCommand(["observe", "--port", "0"], io, {
			onObserverListening: (value) => {
				handle = value;
				resolve(value);
			},
		});
	});
	const doc = parse(io.stdout.join(""));
	const state = await readJson<ObserverState>(await fetch(`${doc.url}api/observer/v1/state`));
	assert.equal(state.session.status, "unavailable");
	assert.equal(state.discovery_cache.status, "unavailable");
	assert.equal(state.install.status, "unavailable");
	assert.equal(state.guide.status, "unavailable");
	assert.equal(state.receipts.status, "unavailable");
	assert.equal(state.agent_activity.status, "unavailable");
	assert.equal(state.privacy.status, "declared");
	assert.equal("receipt_spool_retention" in state.privacy, false);
	await closeObserverHandle(handle);

	const invalid = collectingIo();
	assert.equal(await runCealCommand(["observe", "--port", "80"], invalid, {}), 2);
	assert.match(invalid.stdout.join(""), /invalid_argument/u);
	const trailing = collectingIo();
	assert.equal(await runCealCommand(["observe", "extra"], trailing, {}), 2);
});

// The session and spool here come from the real stores rather than hand-rolled
// object literals. A `.mjs` fixture is invisible to `tsc`, so a literal that
// drifts from `CealStoredSession` or `CealReceiptSpoolState` keeps passing while
// the shape it claims to stand in for no longer exists — and both of these had
// already drifted, missing the whole refresh-token half and `drops`/
// `spoolPresent` respectively.
test("local suggestions fire deterministically and stay linked to observed evidence", async (context) => {
	const NOW = Date.parse("2026-07-24T00:10:00.000Z");
	const home = mkdtempSync(path.join(tmpdir(), "ceal-observer-suggestions-"));
	context.after(() => rmSync(home, { recursive: true, force: true }));
	const sessionStore = createCealSessionStore(home);
	await sessionStore.save({
		gatewayEndpoint: "https://gateway.example.test/corca-ai/dev/api/ceal/v1",
		profileRef: "profile:suggestion-fixture",
		membershipRef: "membership:suggestion-fixture",
		registrationRef: "registration:suggestion-fixture",
		clientRef: "client:suggestion-fixture",
		subjectRef: "subject:suggestion-fixture",
		instanceRef: "instance:suggestion-fixture",
		accessToken: ACCESS_TOKEN,
		expiresAt: "2099-07-14T00:00:00.000Z",
		refreshToken: REFRESH_TOKEN,
		refreshTokenIdleExpiresAt: "2099-08-14T00:00:00.000Z",
		refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
	});
	const spoolStore = createCealReceiptSpoolStore(home, () => NOW);
	const failedReceipts: Array<[string, "not_read_back" | "outcome_unknown", number]> = [
		["narnia:sugg:1:call", "not_read_back", 120_000],
		["narnia:sugg:2:call", "outcome_unknown", 60_000],
	];
	for (const [requestRef, evidence, offset] of failedReceipts) {
		await spoolStore.append({
			recordedAt: NOW - offset,
			requestRef,
			status: "error",
			evidence,
			auditRefs: [],
			capabilityId: "message.search",
			targetRef: "target:team-inbox",
		});
	}
	const runtime: CealObserverRuntime = {
		loadStoredSession: () => sessionStore.load(),
		// No cached catalog at all: the genuinely missing case.
		loadDiscoveryCache: async () => null,
		loadReceiptSpool: () => spoolStore.load(),
		inspectAgentAudit: () => ({
			schemaVersion: "ceal.agent_activity.v1",
			adapters: [
				{ runtime: "claude", root: "~/.claude", health: "stale", coverage: "transcript-observed" },
				{ runtime: "codex", root: "~/.codex", health: "inactive", coverage: "transcript-observed" },
			],
			nonClaims: [],
		}),
		now: () => NOW,
	};
	const state = materializeObserverState(await buildObserverState(runtime));
	const byKind = new Map(state.suggestions.entries.map((entry) => [entry.kind, entry]));
	assert.deepEqual([...byKind.keys()].sort(), [
		"missing_cache_opportunity",
		"repeated_failed_work",
		"stale_collector",
		"unknown_outcome_receipt",
	]);
	// Only the stale collector fires; an inactive (unused) runtime is not advice.
	const staleCollector = byKind.get("stale_collector");
	const missingCache = byKind.get("missing_cache_opportunity");
	const repeatedFailedWork = byKind.get("repeated_failed_work");
	const unknownOutcome = byKind.get("unknown_outcome_receipt");
	assert.ok(staleCollector && missingCache && repeatedFailedWork && unknownOutcome);
	assert.deepEqual(staleCollector.evidence, { runtime: "claude", root: "~/.claude", health: "stale" });
	assert.deepEqual(missingCache.evidence, {
		session: "present",
		discovery_cache: "absent",
	});
	assert.match(missingCache.next_action, /ceal capabilities/u);
	// Rendered entries are newest-first, so the latest failure leads the refs
	// and anchors the receipt lookup.
	assert.deepEqual(repeatedFailedWork.evidence, {
		capability: "message.search",
		request_refs: ["narnia:sugg:2:call", "narnia:sugg:1:call"],
	});
	assert.match(repeatedFailedWork.next_action, /ceal receipt show narnia:sugg:2:call/u);
	assert.deepEqual(unknownOutcome.evidence, {
		request_ref: "narnia:sugg:2:call",
		capability: "message.search",
	});
	// Deterministic: the same local state yields the same suggestions.
	const rerun = materializeObserverState(await buildObserverState(runtime));
	assert.deepEqual(rerun.suggestions, state.suggestions);

	// A merely expired cache self-heals on the next discovery: routine TTL
	// expiry must not keep the suggestion permanently on.
	const expired = materializeObserverState(
		await buildObserverState({
			...runtime,
			loadDiscoveryCache: async () => ({
				key: {
					gatewayEndpoint: "https://gateway.example.test/corca-ai/dev/api/ceal/v1",
					profileRef: "profile:suggestion-fixture",
					membershipRef: "membership:suggestion-fixture",
					negotiatedProtocolVersion: "1.4.0",
				},
				// Expressed relative to the shared default rather than as a literal, so
				// this fixture stays genuinely expired when the window is retuned.
				cachedAt: NOW - DEFAULT_DISCOVERY_CACHE_TTL_MS - 60_000,
				discovery: { capabilities: [], targets: [] },
			}),
		}),
	);
	assert.equal(expired.discovery_cache.within_ttl, false);
	assert.equal(
		expired.suggestions.entries.some((entry) => entry.kind === "missing_cache_opportunity"),
		false,
	);
});

test("observer binds its session and receipt projections to one session snapshot", async () => {
	const oldSession = {
		gatewayEndpoint: "https://gateway.example.test/corca-ai/dev/api/ceal/v1",
		profileRef: "profile:old",
		membershipRef: "membership:old",
		registrationRef: "registration:old",
		clientRef: "client:old",
		subjectRef: "subject:old",
		instanceRef: "instance:old",
		accessToken: ACCESS_TOKEN,
		expiresAt: "2099-07-14T00:00:00.000Z",
		refreshToken: REFRESH_TOKEN,
		refreshTokenIdleExpiresAt: "2099-08-14T00:00:00.000Z",
		refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
	};
	const replacement = {
		...oldSession,
		profileRef: "profile:new",
		membershipRef: "membership:new",
		registrationRef: "registration:new",
		clientRef: "client:new",
		subjectRef: "subject:new",
		instanceRef: "instance:new",
	};
	let sessionReads = 0;
	const state = materializeObserverState(
		await buildObserverState({
			// If the observer reads twice, this models enrollment replacing the session
			// between the receipt projection and the visible session projection.
			loadStoredSession: async () => (++sessionReads === 1 ? oldSession : replacement),
			loadReceiptSpool: async (session) => {
				assert.equal(session, oldSession, "the receipt loader must receive the exact projected session snapshot");
				return {
					entries: [
						{
							recordedAt: Date.parse("2026-07-24T00:00:30.000Z"),
							requestRef: "narnia:old:receipt",
							status: "completed",
							evidence: "readback_verified",
							auditRefs: [],
						},
					],
					bounds: { maxEntries: 200, retentionMs: 30 * 24 * 60 * 60 * 1000 },
					drops: { count: 0, atLeast: false },
					spoolPresent: true,
				};
			},
			now: () => Date.parse("2026-07-24T00:01:00.000Z"),
		}),
	);

	assert.equal(sessionReads, 1);
	assert.equal(state.session.profile_ref, "profile:old");
	assert.equal(requiredValue(state.receipts.entries[0], "old_receipt").request_ref, "narnia:old:receipt");
});

test("observer refuses to attribute another session's discovery cache to the current session", async () => {
	const current = sessionForCacheKey({
		gatewayEndpoint: "https://gateway.example.test/api/ceal/v1",
		profileRef: "profile:current",
		membershipRef: "membership:current",
		negotiatedProtocolVersion: "1.4.0",
	});
	const foreignKey = {
		gatewayEndpoint: current.gatewayEndpoint,
		profileRef: "profile:previous",
		membershipRef: "membership:previous",
		negotiatedProtocolVersion: "1.4.0",
	};
	const state = materializeObserverState(
		await buildObserverState({
			loadStoredSession: async () => current,
			loadDiscoveryCache: async () => ({
				key: foreignKey,
				cachedAt: Date.parse("2026-07-24T00:00:00.000Z"),
				discovery: { capabilities: [{ capability_id: "must.not.surface" }], targets: [] },
			}),
			now: () => Date.parse("2026-07-24T00:01:00.000Z"),
		}),
	);
	assert.equal(state.session.profile_ref, "profile:current");
	assert.deepEqual(state.discovery_cache, { status: "not_current_session" });
	assert.equal(JSON.stringify(state).includes("must.not.surface"), false);
	assert.equal(
		state.suggestions.entries.some((entry) => entry.kind === "missing_cache_opportunity"),
		true,
	);
});

// The observer and the store both answer "is this cache entry still fresh", and
// an operator debugging a cache that never serves reads the observer's answer.
// While the two were separate copies they disagreed: the store grew a
// backward-clock guard and the observer did not, so an entry stamped in the
// future rendered `within_ttl: true` while `capabilities` re-probed on every
// call. This pins them to one answer across the boundary cases rather than
// pinning the observer's rendering alone.
test("the observer and the discovery cache agree on freshness, including a backward clock", async () => {
	const key = {
		gatewayEndpoint: "https://gateway.example.test/corca-ai/dev/api/ceal/v1",
		profileRef: "profile:freshness",
		membershipRef: "membership:freshness",
		negotiatedProtocolVersion: "1.4.0",
	};
	// A payload the store's own decoder accepts, so the only thing that can make
	// the two answers differ below is the clock — not entry validity.
	const discovery = {
		schema_version: "ceal.gateway_discovery.v3",
		phase: "target_page",
		profile_ref: key.profileRef,
		membership_ref: key.membershipRef,
		capabilities: [],
		targets: [],
		target_catalog: { target_count: 0, returned_count: 0, complete: true },
		host_decision: "accepted",
		proof_level: "host_decision",
		non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	};
	// An explicit TTL, deliberately not the default: this case proves the observer
	// and the store agree about whatever window they are GIVEN. The separate test
	// below proves they agree about the window they FALL BACK to.
	const ttl = 300_000;
	const now = Date.UTC(2026, 6, 27, 12, 0, 0);
	const cases = [
		{ label: "fresh", cachedAt: now - 60_000, usable: true },
		{ label: "expired", cachedAt: now - 10 * 60_000, usable: false },
		{ label: "exactly at the ttl boundary", cachedAt: now - ttl, usable: false },
		{ label: "stamped in the future by a backward clock step", cachedAt: now + 10 * 60_000, usable: false },
	];
	for (const scenario of cases) {
		const entry = { key, cachedAt: scenario.cachedAt, discovery };
		const state = materializeObserverState(
			await buildObserverState({
				loadStoredSession: async () => sessionForCacheKey(key),
				loadDiscoveryCache: async () => entry,
				discoveryCacheTtlMs: ttl,
				now: () => now,
			}),
		);
		assert.equal(
			state.discovery_cache.within_ttl,
			discoveryCacheEntryUsable(entry, key, now, ttl),
			`${scenario.label}: the observer and the store disagree about freshness`,
		);
		assert.equal(state.discovery_cache.within_ttl, scenario.usable, scenario.label);
		// A negative age is not a thing to render at an operator; `within_ttl` is
		// what carries the anomaly.
		assert.ok(state.discovery_cache.age_ms >= 0, `${scenario.label}: rendered a negative age`);
	}
});

test("the observer falls back to the SAME default window as the cli", async () => {
	// The observer used to carry its own `?? 300_000`, so an observer built
	// without an explicit TTL could render `within_ttl` against a window the CLI
	// had already moved off. Both now fall back to the one exported constant;
	// re-introduce a second literal in observer.ts and this goes red.
	const key = {
		gatewayEndpoint: "https://gateway.example/api/ceal/v1",
		profileRef: "profile:work",
		membershipRef: "membership:work",
		negotiatedProtocolVersion: "1.4.0",
	};
	const discovery = {
		schema_version: "ceal.gateway_discovery.v3",
		phase: "target_page",
		profile_ref: key.profileRef,
		membership_ref: key.membershipRef,
		capabilities: [],
		targets: [],
		target_catalog: { target_count: 0, returned_count: 0, complete: true },
		host_decision: "accepted",
		proof_level: "host_decision",
		non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	};
	const now = Date.UTC(2026, 6, 27, 12, 0, 0);
	// Inside the shared default, outside the former 5-minute one.
	const cachedAt = now - DEFAULT_DISCOVERY_CACHE_TTL_MS + 60_000;
	const entry = { key, cachedAt, discovery };
	const state = materializeObserverState(
		await buildObserverState({
			loadStoredSession: async () => sessionForCacheKey(key),
			loadDiscoveryCache: async () => entry,
			now: () => now,
		}),
	);
	assert.equal(
		state.discovery_cache.within_ttl,
		discoveryCacheEntryUsable(entry, key, now, DEFAULT_DISCOVERY_CACHE_TTL_MS),
		"the observer's fallback window disagrees with the store's",
	);
	assert.equal(state.discovery_cache.within_ttl, true);
});

function sessionForCacheKey(key: CealDiscoveryCacheKey): CealStoredSession {
	return {
		gatewayEndpoint: key.gatewayEndpoint,
		profileRef: key.profileRef,
		membershipRef: key.membershipRef,
		registrationRef: "registration:observer",
		clientRef: "client:observer",
		subjectRef: "subject:observer",
		instanceRef: "instance:observer",
		accessToken: ACCESS_TOKEN,
		expiresAt: "2099-07-14T00:00:00.000Z",
		refreshToken: REFRESH_TOKEN,
		refreshTokenIdleExpiresAt: "2099-08-14T00:00:00.000Z",
		refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
	};
}

function rawRequest(baseUrl: string, requestPath: string, headers: Record<string, string>): Promise<{ status: number | undefined }> {
	const port = Number(new URL(baseUrl).port);
	return new Promise((resolve, reject) => {
		const request = httpRequest({ host: "127.0.0.1", port, path: requestPath, method: "GET", headers, setHost: false }, (response) => {
			response.resume();
			response.once("end", () => resolve({ status: response.statusCode }));
		});
		request.once("error", reject);
		request.end();
	});
}

function collectingIo() {
	const io: { stdout: string[]; stderr: string[]; exitCode: number | undefined } = { stdout: [], stderr: [], exitCode: undefined };
	return {
		stdout: { write: (chunk: string) => io.stdout.push(String(chunk)), join: (separator: string = "") => io.stdout.join(separator) },
		stderr: { write: (chunk: string) => io.stderr.push(String(chunk)), join: (separator: string = "") => io.stderr.join(separator) },
		get exitCode() {
			return io.exitCode;
		},
		set exitCode(value) {
			io.exitCode = value;
		},
	};
}

async function readJson<T>(response: Response): Promise<T> {
	return JSON.parse(await response.text());
}

function materializeObserverState(value: Record<string, unknown>): ObserverState {
	return JSON.parse(JSON.stringify(value));
}

async function closeObserverHandle(handle: ObserverHandle | undefined): Promise<void> {
	assert.ok(handle, "observer server did not report a listening handle");
	await handle.close();
}
