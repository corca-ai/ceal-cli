import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { createCealDiscoveryCacheStore } from "../dist/discovery-cache.js";
import { runCealCommand } from "../dist/index.js";
import { buildObserverState, OBSERVER_DATA_SOURCES } from "../dist/observer.js";
import { createCealSessionStore } from "../dist/profile-store.js";
import { createCealReceiptSpoolStore } from "../dist/receipt-spool.js";

const ACCESS_TOKEN = `ceal_personal_${"P".repeat(43)}`;
const REFRESH_TOKEN = `ceal_refresh_${"R".repeat(43)}`;

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
			negotiatedProtocolVersion: "1.3.0",
		},
		cachedAt: Date.parse("2026-07-24T00:00:00.000Z"),
		discovery: {
			schema_version: "ceal.gateway_discovery.v2",
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
			target_catalog: { target_count: 3, returned_count: 0, complete: false, selection_required: true },
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
	let handle;
	const handleReady = new Promise((resolve) => {
		void runCealCommand(["observe", "--port", "0"], io, {
			loadSession: () => sessionStore.load(),
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
				status: "staged",
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
			await handle.close();
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
	const state = JSON.parse(stateBody);
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
	assert.deepEqual(state.discovery_cache.target_catalog, { target_count: 3, returned_count: 0, complete: false, selection_required: true });
	assert.equal(state.install.status, "unmanaged");
	assert.equal(state.guide.status, "staged");
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
	assert.equal(state.agent_activity.adapters[1].coverage, "unsupported");
	assert.match(state.agent_activity.non_claims[0], /never surfaced, copied, or forwarded/u);
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
	assert.match(page.headers.get("content-type"), /text\/html/u);
	assert.match(page.headers.get("content-security-policy"), /default-src 'none'/u);
	const html = await page.text();
	assert.match(html, /Ceal Workbench/u);
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

	await handle.close();
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
	let handle;
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
			await handle.close();
		} catch {
			/* already closed */
		}
	});
	const doc = parse(io.stdout.join(""));
	const state = await (await fetch(`${doc.url}api/observer/v1/state`)).json();
	assert.equal(state.receipts.status, "unreadable");
	assert.equal("entries" in state.receipts, false);
	await handle.close();
});

test("every ~/.ceal file this client reads is named in the privacy projection", async (context) => {
	// The page's whole claim is that it names the *fixed* local sources it reads.
	// A store that adds a file without adding it here does not break a test, it
	// makes a standing declaration quietly false — which is how the drops counter
	// shipped unlisted in the first place. Deriving the names from the store
	// sources means the next one cannot.
	const sources = readdirSync(new URL("../src", import.meta.url), { recursive: true })
		.filter((name) => String(name).endsWith(".ts"))
		.map((name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"))
		.join("\n");
	const stateFiles = new Set([...sources.matchAll(/"(client-[a-z-]+\.json|receipt-spool[a-z.-]*)"/gu)].map((match) => match[1]));
	// Locks are coordination, not a source this page reads, so they are excluded
	// deliberately rather than by the regex happening to miss them.
	stateFiles.delete("receipt-spool.lock");
	stateFiles.delete("client-session.lock");
	assert.ok(stateFiles.size >= 4, `only ${stateFiles.size} store files found; the sweep is not reaching the stores`);

	const io = collectingIo();
	let handle;
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
			await handle.close();
		} catch {
			/* already closed */
		}
	});
	const doc = parse(io.stdout.join(""));
	const declared = (await (await fetch(`${doc.url}api/observer/v1/state`)).json()).privacy.local_sources.join("\n");
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
	await handle.close();
});

test("an empty retention window is not reported as every receipt having been lost", async (context) => {
	// Three unlike states share `entries: []`. A spool that exists but whose
	// entries all aged out of the 30-day window is the common one: those receipts
	// were recorded, and were rendered for a month. Saying "every receipt this
	// client tried to record was lost" there would swap the false claim this
	// counter removed for an equally false one pointing the other way.
	const io = collectingIo();
	let handle;
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
			await handle.close();
		} catch {
			/* already closed */
		}
	});
	const doc = parse(io.stdout.join(""));
	const state = await (await fetch(`${doc.url}api/observer/v1/state`)).json();
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
	assert.match(emptyHistoryBranch[1], /dropped_appends/u, "the empty-history branch must render the drop count, not only the note");
	await handle.close();
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
	let handle;
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
			await handle.close();
		} catch {
			/* already closed */
		}
	});
	const doc = parse(io.stdout.join(""));
	const absent = await (await fetch(`${doc.url}api/observer/v1/state`)).json();
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
	const spooled = await (await fetch(`${doc.url}api/observer/v1/state`)).json();
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
	const clean = await (await fetch(`${doc.url}api/observer/v1/state`)).json();
	assert.equal(clean.receipts.status, "spooled");
	assert.equal("dropped_appends" in clean.receipts, false);
	await handle.close();
});

test("ceal observe reports absent stores and rejects invalid ports without serving", async () => {
	const io = collectingIo();
	let handle;
	await new Promise((resolve) => {
		void runCealCommand(["observe", "--port", "0"], io, {
			onObserverListening: (value) => {
				handle = value;
				resolve(value);
			},
		});
	});
	const doc = parse(io.stdout.join(""));
	const state = await (await fetch(`${doc.url}api/observer/v1/state`)).json();
	assert.equal(state.session.status, "unavailable");
	assert.equal(state.discovery_cache.status, "unavailable");
	assert.equal(state.install.status, "unavailable");
	assert.equal(state.guide.status, "unavailable");
	assert.equal(state.receipts.status, "unavailable");
	assert.equal(state.agent_activity.status, "unavailable");
	assert.equal(state.privacy.status, "declared");
	assert.equal("receipt_spool_retention" in state.privacy, false);
	await handle.close();

	const invalid = collectingIo();
	assert.equal(await runCealCommand(["observe", "--port", "80"], invalid, {}), 2);
	assert.match(invalid.stdout.join(""), /invalid_argument/u);
	const trailing = collectingIo();
	assert.equal(await runCealCommand(["observe", "extra"], trailing, {}), 2);
});

test("local suggestions fire deterministically and stay linked to observed evidence", async () => {
	const NOW = Date.parse("2026-07-24T00:10:00.000Z");
	const runtime = {
		loadSession: async () => ({
			gatewayEndpoint: "https://gateway.example.test/corca-ai/dev/api/ceal/v1",
			profileRef: "profile:suggestion-fixture",
			membershipRef: "membership:suggestion-fixture",
			registrationRef: "registration:suggestion-fixture",
			clientRef: "client:suggestion-fixture",
			subjectRef: "subject:suggestion-fixture",
			instanceRef: "instance:suggestion-fixture",
			accessToken: ACCESS_TOKEN,
			expiresAt: "2099-07-14T00:00:00.000Z",
		}),
		// No cached catalog at all: the genuinely missing case.
		loadDiscoveryCache: async () => null,
		loadReceiptSpool: async () => ({
			entries: [
				{
					recordedAt: NOW - 120_000,
					requestRef: "narnia:sugg:1:call",
					status: "error",
					evidence: "not_read_back",
					auditRefs: [],
					capabilityId: "message.search",
					targetRef: "target:team-inbox",
				},
				{
					recordedAt: NOW - 60_000,
					requestRef: "narnia:sugg:2:call",
					status: "error",
					evidence: "outcome_unknown",
					auditRefs: [],
					capabilityId: "message.search",
					targetRef: "target:team-inbox",
				},
			],
			bounds: { maxEntries: 200, retentionMs: 30 * 24 * 60 * 60 * 1000 },
		}),
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
	const state = await buildObserverState(runtime);
	const byKind = new Map(state.suggestions.entries.map((entry) => [entry.kind, entry]));
	assert.deepEqual([...byKind.keys()].sort(), [
		"missing_cache_opportunity",
		"repeated_failed_work",
		"stale_collector",
		"unknown_outcome_receipt",
	]);
	// Only the stale collector fires; an inactive (unused) runtime is not advice.
	assert.deepEqual(byKind.get("stale_collector").evidence, { runtime: "claude", root: "~/.claude", health: "stale" });
	assert.deepEqual(byKind.get("missing_cache_opportunity").evidence, {
		session: "present",
		discovery_cache: "absent",
	});
	assert.match(byKind.get("missing_cache_opportunity").next_action, /ceal capabilities/u);
	// Rendered entries are newest-first, so the latest failure leads the refs
	// and anchors the receipt lookup.
	assert.deepEqual(byKind.get("repeated_failed_work").evidence, {
		capability: "message.search",
		request_refs: ["narnia:sugg:2:call", "narnia:sugg:1:call"],
	});
	assert.match(byKind.get("repeated_failed_work").next_action, /ceal receipt show narnia:sugg:2:call/u);
	assert.deepEqual(byKind.get("unknown_outcome_receipt").evidence, {
		request_ref: "narnia:sugg:2:call",
		capability: "message.search",
	});
	// Deterministic: the same local state yields the same suggestions.
	const rerun = await buildObserverState(runtime);
	assert.deepEqual(rerun.suggestions, state.suggestions);

	// A merely expired cache self-heals on the next discovery: routine TTL
	// expiry must not keep the suggestion permanently on.
	const expired = await buildObserverState({
		...runtime,
		loadDiscoveryCache: async () => ({
			key: {
				gatewayEndpoint: "https://gateway.example.test/corca-ai/dev/api/ceal/v1",
				profileRef: "profile:suggestion-fixture",
				membershipRef: "membership:suggestion-fixture",
				negotiatedProtocolVersion: "1.3.0",
			},
			cachedAt: NOW - 10 * 60_000,
			discovery: { capabilities: [], targets: [] },
		}),
	});
	assert.equal(expired.discovery_cache.within_ttl, false);
	assert.equal(
		expired.suggestions.entries.some((entry) => entry.kind === "missing_cache_opportunity"),
		false,
	);
});

function rawRequest(baseUrl, requestPath, headers) {
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
	const io = { stdout: [], stderr: [], exitCode: undefined };
	return {
		stdout: { write: (chunk) => io.stdout.push(String(chunk)), join: (separator) => io.stdout.join(separator ?? "") },
		stderr: { write: (chunk) => io.stderr.push(String(chunk)), join: (separator) => io.stderr.join(separator ?? "") },
		get exitCode() {
			return io.exitCode;
		},
		set exitCode(value) {
			io.exitCode = value;
		},
	};
}
