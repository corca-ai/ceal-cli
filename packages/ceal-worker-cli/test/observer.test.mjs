import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { parse } from "yaml";
import { createCealDiscoveryCacheStore, DEFAULT_DISCOVERY_CACHE_TTL_MS, discoveryCacheEntryUsable } from "../dist/discovery-cache.js";
import { loadWorkbenchCealOverview, runCealCommand } from "../dist/index.js";
import { buildObserverState, OBSERVER_DATA_SOURCES, observerPresentationIntent } from "../dist/observer.js";
import { createCealSessionStore } from "../dist/profile-store.js";
import { createCealReceiptSpoolStore as createRawReceiptSpoolStore } from "../dist/receipt-spool.js";

const ACCESS_TOKEN = `ceal_personal_${"P".repeat(43)}`;
const REFRESH_TOKEN = `ceal_refresh_${"R".repeat(43)}`;
const TEST_SPOOL_IDENTITY = "a".repeat(64);

test("observer presentation never implies positive state for gaps or unknown values", () => {
	assert.equal(observerPresentationIntent("session", "present"), "positive");
	assert.equal(observerPresentationIntent("session", "absent"), "attention");
	assert.equal(observerPresentationIntent("cache", "cached"), "neutral");
	assert.equal(observerPresentationIntent("cache", "unreadable"), "unavailable");
	assert.equal(observerPresentationIntent("adapter", "stale"), "attention");
	assert.equal(observerPresentationIntent("adapter", "future_value"), "unknown");
	assert.equal(observerPresentationIntent("future_source", "present"), "unknown");
});

test("Ceal-backed summary is allowlisted and keeps live authority distinct", async () => {
	const state = await buildObserverState({
		now: () => Date.parse("2026-08-14T00:00:00.000Z"),
		loadCealOverview: async () => ({
			status: "connected",
			source: "ceal_gateway",
			authority: "gateway",
			profile_ref: "profile:personal",
			instance_ref: "instance:ceal",
			protocol_version: "1.3.0",
			capability_count: 3,
			read_capability_count: 2,
			write_capability_count: 1,
			access_token: ACCESS_TOKEN,
			membership_ref: "membership:must-not-surface",
		}),
	});
	assert.deepEqual(state.ceal, {
		status: "connected",
		source: "ceal_gateway",
		authority: "gateway",
		observed_at: "2026-08-14T00:00:00.000Z",
		profile_ref: "profile:personal",
		instance_ref: "instance:ceal",
		protocol_version: "1.3.0",
		capability_count: 3,
		read_capability_count: 2,
		write_capability_count: 1,
	});
	assert.equal(state.local_usage_dashboard_input.schemaVersion, "ceal.local_usage_dashboard.codex_input.v1");
	assert.deepEqual(state.local_usage_dashboard_input.identity, { state: "unavailable" });
	assert.deepEqual(state.local_usage_dashboard_input.access, {
		state: "available",
		authority: "gateway",
		observedAt: "2026-08-14T00:00:00.000Z",
		capabilityCount: 3,
		readCapabilityCount: 2,
		writeCapabilityCount: 1,
	});
	assert.equal(state.local_usage_dashboard_input.sources[0].inventoryState, "unavailable");
	assert.equal(state.local_usage_dashboard_input.pricing.state, "unsupported");
	assert.doesNotMatch(JSON.stringify(state.ceal), /ceal_personal_|membership:/u);
});

test("Ceal summary stamps completion time and bounds injected error vocabulary", async () => {
	const times = [Date.parse("2026-08-14T00:00:00.000Z"), Date.parse("2026-08-14T00:00:02.000Z")];
	const connected = await buildObserverState({
		now: () => times.shift(),
		loadCealOverview: async () => ({
			status: "connected",
			source: "ceal_gateway",
			authority: "gateway",
			profile_ref: "profile:personal",
			instance_ref: "instance:personal",
			protocol_version: "1.3.0",
			capability_count: 0,
			read_capability_count: 0,
			write_capability_count: 0,
		}),
	});
	assert.equal(connected.generated_at, "2026-08-14T00:00:00.000Z");
	assert.equal(connected.ceal.observed_at, "2026-08-14T00:00:02.000Z");

	const errored = await buildObserverState({
		loadCealOverview: async () => ({ status: "error", source: "ceal_gateway", error_kind: "secret_backend_detail" }),
	});
	assert.deepEqual(errored.ceal, { status: "error", source: "ceal_gateway", error_kind: "gateway_error" });
});

test("a failed Agent inspection remains unreadable rather than adapter-unavailable", async () => {
	const state = await buildObserverState({
		now: () => Date.parse("2026-08-14T00:00:00.000Z"),
		inspectAgentAudit: () => {
			throw new Error("private read failure");
		},
	});
	assert.equal(state.agent_activity.status, "inventoried");
	assert.equal(state.agent_activity.adapters[0].health, "unknown");
	assert.equal(state.local_usage_dashboard_input.sources[0].inventoryState, "unreadable");
	assert.doesNotMatch(JSON.stringify(state), /private read failure/u);
});

test("production Workbench projection performs only handshake then discovery and never refreshes", async (context) => {
	const operations = [];
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		operations.push(body.operation);
		const value = body.operation === "handshake" ? observerHandshakeResponse(body) : observerDiscoveryResponse(body);
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(value));
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	context.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	let sessionReads = 0;
	const overview = await loadWorkbenchCealOverview({
		loadSession: async () => {
			sessionReads += 1;
			return observerStoredSession(`http://127.0.0.1:${address.port}/gateway/client`);
		},
		nextRequestId: () => "observer:proof",
	});
	assert.deepEqual(operations, ["handshake", "discover"]);
	assert.equal(sessionReads, 1);
	assert.deepEqual(overview, {
		status: "connected",
		source: "ceal_gateway",
		authority: "gateway",
		profile_ref: "profile:personal",
		instance_ref: "instance:personal",
		protocol_version: "1.3.0",
		capability_count: 1,
		read_capability_count: 1,
		write_capability_count: 0,
	});
});

test("production Workbench projection makes no request without a session", async () => {
	let requestIds = 0;
	assert.deepEqual(
		await loadWorkbenchCealOverview({
			loadSession: async () => null,
			nextRequestId: () => {
				requestIds += 1;
				return "must-not-run";
			},
		}),
		{ status: "unavailable", source: "ceal_gateway", reason: "session_unavailable" },
	);
	assert.equal(requestIds, 0);
});

function observerStoredSession(gatewayEndpoint) {
	return {
		gatewayEndpoint,
		profileRef: "profile:personal",
		membershipRef: "membership:personal",
		registrationRef: "registration:personal",
		clientRef: "client:personal",
		subjectRef: "subject:personal",
		instanceRef: "instance:personal",
		accessToken: ACCESS_TOKEN,
		expiresAt: "2099-08-14T00:00:00.000Z",
		refreshToken: REFRESH_TOKEN,
		refreshTokenIdleExpiresAt: "2099-09-14T00:00:00.000Z",
		refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
	};
}

function observerSuccess(request, value) {
	return {
		ok: true,
		request_id: request.request_id,
		protocol_version: "1.3.0",
		proof_ref_or_unavailable: `audit:${request.request_id}`,
		value,
	};
}

function observerHandshakeResponse(request) {
	return observerSuccess(request, {
		schema_version: "ceal.gateway_handshake.v1",
		negotiated_protocol_version: "1.3.0",
		supported_gateway_protocol_range: { minimum: "1.3.0", maximum: "1.3.0" },
		profile_ref: request.profile_ref,
		membership_ref: "membership:personal",
		registration_ref: "registration:personal",
		client_ref: "client:personal",
		subject_ref: "subject:personal",
		instance_ref: "instance:personal",
		host_decision: "accepted",
		proof_level: "host_decision",
		non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	});
}

function observerDiscoveryResponse(request) {
	return observerSuccess(request, {
		schema_version: "ceal.gateway_discovery.v2",
		profile_ref: request.profile_ref,
		membership_ref: "membership:personal",
		capabilities: [
			{
				capability_id: "message.search",
				label: "Search messages",
				effect: "read",
				target_requirement: "required",
				input_contract: {
					schema_version: "ceal.message_search_input.v1",
					required: ["query"],
					query: { type: "string", max_bytes: 512 },
					limit: { type: "integer", minimum: 1, maximum: 10, default: 5 },
				},
				evidence_requirement: "gateway_audit",
			},
		],
		targets: [],
		target_catalog: { target_count: 1, returned_count: 0, complete: false, selection_required: true },
		host_decision: "accepted",
		proof_level: "host_decision",
		non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	});
}

function createCealReceiptSpoolStore(home, now = Date.now) {
	const store = createRawReceiptSpoolStore(home, now);
	return {
		load: () => store.load(TEST_SPOOL_IDENTITY),
		append: (value) => store.append(TEST_SPOOL_IDENTITY, value),
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
	assert.deepEqual(doc.boundary, { admin_surface: false, provider_credentials: false, live_refresh: true });

	const stateResponse = await fetch(`${doc.url}api/observer/v2/state`);
	assert.equal(stateResponse.status, 200);
	assert.equal(stateResponse.headers.get("cache-control"), "no-store");
	const stateBody = await stateResponse.text();
	assert.doesNotMatch(
		stateBody,
		/ceal_personal_|ceal_refresh_|membership_ref|registration_ref|client_ref|subject_ref|target_catalog|cached_target_count/u,
	);
	const state = JSON.parse(stateBody);
	assert.equal(state.schema_version, "ceal.observer_state.v2");
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
	assert.deepEqual(state.receipts.activity_recorded_at, ["2026-07-24T00:00:30.000Z"]);
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
	assert.equal(state.privacy.gateway_contact, "personal handshake and capability discovery");
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
	assert.match(html, /Recent local Agent sessions/u);
	assert.match(html, /Setup & privacy/u);
	assert.match(html, /Attention/u);
	assert.match(html, /Agent activity/u);
	assert.match(html, /Ceal evidence/u);
	assert.match(html, /outcomes recorded locally/u);
	assert.match(html, /not a complete Gateway activity total/u);
	assert.match(html, /receipt record time, not exact call time/u);
	assert.match(html, /Activity history and monetary cost contracts are unavailable/u);
	assert.match(html, /Outcome and capability mix/u);
	assert.match(html, /newest detailed receipt rows/u);
	assert.match(html, /Runtime overview/u);
	assert.match(html, /with token evidence/u);
	assert.match(html, /Missing values are not zero/u);
	assert.match(html, /All retained record times supplied by the bounded local spool are counted/u);
	assert.match(html, /Activity received/u);
	assert.match(html, /All shown/u);
	assert.match(html, /365 days/u);
	assert.match(html, /recordedAt <= generatedAt/u);
	assert.match(html, /calendarStart\.getDay/u);
	assert.match(html, /role='img' aria-label=/u);
	assert.match(html, /Local receipt activity is unavailable/u);
	assert.match(html, /Missing activity is not rendered as zero/u);
	assert.match(html, /aria-label="Visual theme"/u);
	assert.match(html, /aria-label="Color appearance"/u);
	assert.match(html, /data-mode="system"/u);
	assert.match(html, /data-mode="light"/u);
	assert.match(html, /data-mode="dark"/u);
	assert.match(html, /<dialog id="detail"/u);
	assert.match(html, /ceal receipt show/u);
	assert.match(html, /cannot safely name the project/u);
	assert.doesNotMatch(html, /Ceal caused|Observed Agent cost|\$0/u);
	assert.doesNotMatch(html, /ceal_personal_|ceal_refresh_/u);
	const embeddedScript = html.match(/<script>([\s\S]*)<\/script>/u)?.[1];
	assert.ok(embeddedScript);
	assert.doesNotThrow(() => new vm.Script(embeddedScript), "the browser-delivered observer script must parse");
	const overviewSource = embeddedScript.slice(
		embeddedScript.indexOf("  const localDateKey"),
		embeddedScript.indexOf("  const usageEntries"),
	);
	const renderOverview = (observerState, period = "365") => {
		const context = {
			s: observerState,
			esc: (value) =>
				String(value).replace(
					/[&<>"']/gu,
					(character) =>
						({
							"&": "&amp;",
							"<": "&lt;",
							">": "&gt;",
							'"': "&quot;",
							"'": "&#39;",
						})[character],
				),
			Intl,
			result: "",
		};
		vm.runInNewContext(`${overviewSource}; result = activityOverview(${JSON.stringify(period)});`, context);
		return context.result;
	};
	const renderedOverview = renderOverview(state);
	assert.match(renderedOverview, /outcomes recorded locally/u);
	assert.match(renderedOverview, /not a complete Gateway activity total/u);
	assert.match(renderedOverview, /Activity received 1 retained record-time value;/u);
	assert.match(renderedOverview, /role='img' aria-label=/u);
	const mixedDetailState = structuredClone(state);
	mixedDetailState.receipts = {
		...mixedDetailState.receipts,
		entry_count: 25,
		activity_recorded_at: Array.from({ length: 25 }, (_, index) => `2026-07-23T12:${String(index).padStart(2, "0")}:00.000Z`),
		entries: [
			{ recorded_at: "2026-07-23T12:24:00.000Z", status: "completed", capability: "message.search" },
			{ recorded_at: "2026-07-23T12:23:00.000Z", status: "completed", capability: "message.search" },
			{ recorded_at: "2026-07-23T12:22:00.000Z", status: "failed", capability: "message.search" },
			{ recorded_at: "2026-07-23T12:21:00.000Z", status: "failed", capability: "file.read" },
		],
	};
	const mixedDetailOverview = renderOverview(mixedDetailState);
	assert.match(mixedDetailOverview, /<h2>25 outcomes recorded locally<\/h2>/u);
	assert.match(mixedDetailOverview, /<h3>completed<\/h3><strong>2<\/strong>/u);
	assert.match(mixedDetailOverview, /<h3>failed<\/h3><strong>2<\/strong>/u);
	assert.match(mixedDetailOverview, /message[.]search · 3<br>file[.]read · 1/u);
	assert.equal((mixedDetailOverview.match(/data-receipt=/gu) ?? []).length, 4);
	const emptyDetailOverview = renderOverview({
		...state,
		receipts: { ...state.receipts, activity_recorded_at: [], entries: [], entry_count: 0 },
	});
	assert.match(emptyDetailOverview, /No outcome mix in the visible detail subset/u);
	assert.doesNotMatch(emptyDetailOverview, /<div class='metric-strip'><\/div>/u);
	const unreadableOverview = renderOverview({ ...state, receipts: { status: "unreadable", non_claim: state.receipts.non_claim } });
	assert.match(unreadableOverview, /Local receipt activity is unavailable/u);
	assert.match(unreadableOverview, /No activity count is inferred/u);
	assert.match(unreadableOverview, /Retained-entry coverage is unavailable/u);
	assert.doesNotMatch(unreadableOverview, /<em>0<\/em>/u);
	assert.doesNotMatch(unreadableOverview, /0 of 0/u);
	const runtimeSummarySource = embeddedScript.slice(
		embeddedScript.indexOf("  const runtimeSummary"),
		embeddedScript.indexOf("  const privacy"),
	);
	const renderRuntimeSummary = (agentActivity) => {
		const context = {
			activity: agentActivity,
			esc: (value) => String(value),
			result: "",
		};
		vm.runInNewContext(`${runtimeSummarySource}; result = runtimeSummary;`, context);
		return context.result;
	};
	const renderedRuntimeSummary = renderRuntimeSummary({
		adapters: [
			{
				runtime: "claude",
				health: "active",
				coverage: "transcript-observed",
				sessions: [{ events: { token_usage: { output_tokens: 4 } } }, { events: { event_count: 2 } }, { events: "unreadable" }, {}],
			},
		],
	});
	assert.match(renderedRuntimeSummary, /4 visible sessions/u);
	assert.match(renderedRuntimeSummary, /2 with event evidence · 1 with token evidence/u);
	assert.match(renderedRuntimeSummary, /active · transcript-observed/u);
	assert.match(renderRuntimeSummary({ status: "unavailable" }), /Runtime overview is unavailable/u);
	assert.match(renderRuntimeSummary({ status: "unavailable" }), /Missing sessions are not rendered as zero/u);
	const droppedOverview = renderOverview({
		...state,
		receipts: {
			status: "absent",
			note: "No call outcome could be spooled.",
			dropped_appends: 2,
			dropped_appends_note: "At least 2 receipt appends were lost. This history is incomplete.",
			non_claim: state.receipts.non_claim,
		},
	});
	assert.match(droppedOverview, /At least 2 receipt appends were lost/u);
	assert.match(droppedOverview, /not proof of no Gateway activity/u);
	const futureState = structuredClone(state);
	futureState.receipts = {
		...futureState.receipts,
		status: "spooled",
		entry_count: 21,
		activity_recorded_at: [new Date(Date.parse(state.generated_at) + 86_400_000).toISOString()],
		entries: [
			{
				recorded_at: new Date(Date.parse(state.generated_at) + 86_400_000).toISOString(),
				request_ref: "req_future",
				status: "failed",
				evidence: "not_read_back",
			},
		],
	};
	const futureOverview = renderOverview(futureState);
	assert.match(futureOverview, /<h2>0 outcomes recorded locally<\/h2>/u);
	assert.doesNotMatch(futureOverview, /req_future/u);
	const retainedOverviewState = structuredClone(state);
	retainedOverviewState.receipts = {
		...retainedOverviewState.receipts,
		entry_count: 25,
		activity_recorded_at: Array.from({ length: 25 }, (_, index) => new Date(Date.parse(state.generated_at) - index * 1_000).toISOString()),
		entries: Array.from({ length: 20 }, (_, index) => ({
			recorded_at: new Date(Date.parse(state.generated_at) - index * 1_000).toISOString(),
			request_ref: `narnia:rendered:${index}:call`,
			status: "completed",
			evidence: "readback_verified",
		})),
	};
	const retainedOverview = renderOverview(retainedOverviewState);
	assert.match(retainedOverview, /<h2>25 outcomes recorded locally<\/h2>/u);
	assert.match(retainedOverview, /Activity received 25 retained record-time values/u);
	assert.equal((retainedOverview.match(/data-receipt=/gu) || []).length, 20);

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

	const rebound = await rawRequest(doc.url, "/api/observer/v2/state", { host: "evil.example:80" });
	assert.equal(rebound.status, 403);
	const forwarded = await fetch(`${doc.url}api/observer/v2/state`, { headers: { "x-forwarded-for": "203.0.113.7" } });
	assert.equal(forwarded.status, 403);
	const write = await fetch(doc.url, { method: "POST", body: "{}" });
	assert.equal(write.status, 405);
	const missing = await fetch(`${doc.url}unknown`);
	assert.equal(missing.status, 404);

	await handle.close();
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(io.exitCode, 0);
});

test("observer activity covers the retained spool while detail stays capped", async () => {
	const base = Date.parse("2026-07-24T00:00:00.000Z");
	const retained = Array.from({ length: 25 }, (_, index) => ({
		recordedAt: base + index * 1_000,
		requestRef: `narnia:retained:${index}:call`,
		status: "completed",
		evidence: "readback_verified",
		auditRefs: [],
	}));
	const state = await buildObserverState({
		loadReceiptSpool: async () => ({
			entries: retained,
			bounds: { maxEntries: 200, retentionMs: 30 * 24 * 60 * 60 * 1000 },
			drops: { count: 0, atLeast: false },
			spoolPresent: true,
		}),
		now: () => base + 60_000,
	});
	assert.equal(state.receipts.entry_count, 25);
	assert.equal(state.receipts.activity_recorded_at.length, 25);
	assert.equal(state.receipts.entries.length, 20);
	assert.equal(state.receipts.activity_recorded_at[0], "2026-07-24T00:00:00.000Z");
	assert.equal(state.receipts.activity_recorded_at.at(-1), "2026-07-24T00:00:24.000Z");
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
	const state = await (await fetch(`${doc.url}api/observer/v2/state`)).json();
	assert.equal(state.receipts.status, "unreadable");
	assert.equal("entries" in state.receipts, false);
	await handle.close();
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
			negotiatedProtocolVersion: "1.3.0",
		},
		cachedAt: Date.parse("2026-07-24T00:00:00.000Z"),
		discovery: {
			schema_version: "ceal.gateway_discovery.v2",
			profile_ref: "profile:privacy-fixture",
			membership_ref: "membership:privacy-fixture",
			capabilities: [],
			targets: [],
			target_catalog: { target_count: 0, returned_count: 0, complete: true, selection_required: false },
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
			.map((match) => match[1]),
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
	const declared = (await (await fetch(`${doc.url}api/observer/v2/state`)).json()).privacy.local_sources.join("\n");
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
	const state = await (await fetch(`${doc.url}api/observer/v2/state`)).json();
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
	const absent = await (await fetch(`${doc.url}api/observer/v2/state`)).json();
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
	const spooled = await (await fetch(`${doc.url}api/observer/v2/state`)).json();
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
	const clean = await (await fetch(`${doc.url}api/observer/v2/state`)).json();
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
	const state = await (await fetch(`${doc.url}api/observer/v2/state`)).json();
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
	for (const [requestRef, evidence, offset] of [
		["narnia:sugg:1:call", "not_read_back", 120_000],
		["narnia:sugg:2:call", "outcome_unknown", 60_000],
	]) {
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
	const runtime = {
		loadSession: () => sessionStore.load(),
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
			// Expressed relative to the shared default rather than as a literal, so
			// this fixture stays genuinely expired when the window is retuned.
			cachedAt: NOW - DEFAULT_DISCOVERY_CACHE_TTL_MS - 60_000,
			discovery: { capabilities: [], targets: [] },
		}),
	});
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
	const state = await buildObserverState({
		// If the observer reads twice, this models enrollment replacing the session
		// between the receipt projection and the visible session projection.
		loadSession: async () => (++sessionReads === 1 ? oldSession : replacement),
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
	});

	assert.equal(sessionReads, 1);
	assert.equal(state.session.profile_ref, "profile:old");
	assert.equal(state.receipts.entries[0].request_ref, "narnia:old:receipt");
});

test("observer refuses to attribute another session's discovery cache to the current session", async () => {
	const current = sessionForCacheKey({
		gatewayEndpoint: "https://gateway.example.test/api/ceal/v1",
		profileRef: "profile:current",
		membershipRef: "membership:current",
		negotiatedProtocolVersion: "1.3.0",
	});
	const foreignKey = {
		gatewayEndpoint: current.gatewayEndpoint,
		profileRef: "profile:previous",
		membershipRef: "membership:previous",
		negotiatedProtocolVersion: "1.3.0",
	};
	const state = await buildObserverState({
		loadSession: async () => current,
		loadDiscoveryCache: async () => ({
			key: foreignKey,
			cachedAt: Date.parse("2026-07-24T00:00:00.000Z"),
			discovery: { capabilities: [{ capability_id: "must.not.surface" }], targets: [] },
		}),
		now: () => Date.parse("2026-07-24T00:01:00.000Z"),
	});
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
		negotiatedProtocolVersion: "1.3.0",
	};
	// A payload the store's own decoder accepts, so the only thing that can make
	// the two answers differ below is the clock — not entry validity.
	const discovery = {
		schema_version: "ceal.gateway_discovery.v2",
		profile_ref: key.profileRef,
		membership_ref: key.membershipRef,
		capabilities: [],
		targets: [],
		target_catalog: { target_count: 0, returned_count: 0, complete: true, selection_required: false },
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
		const state = await buildObserverState({
			loadSession: async () => sessionForCacheKey(key),
			loadDiscoveryCache: async () => entry,
			discoveryCacheTtlMs: ttl,
			now: () => now,
		});
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
		negotiatedProtocolVersion: "1.3.0",
	};
	const discovery = {
		schema_version: "ceal.gateway_discovery.v2",
		profile_ref: key.profileRef,
		membership_ref: key.membershipRef,
		capabilities: [],
		targets: [],
		target_catalog: { target_count: 0, returned_count: 0, complete: true, selection_required: false },
		host_decision: "accepted",
		proof_level: "host_decision",
		non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	};
	const now = Date.UTC(2026, 6, 27, 12, 0, 0);
	// Inside the shared default, outside the former 5-minute one.
	const cachedAt = now - DEFAULT_DISCOVERY_CACHE_TTL_MS + 60_000;
	const entry = { key, cachedAt, discovery };
	const state = await buildObserverState({
		loadSession: async () => sessionForCacheKey(key),
		loadDiscoveryCache: async () => entry,
		now: () => now,
	});
	assert.equal(
		state.discovery_cache.within_ttl,
		discoveryCacheEntryUsable(entry, key, now, DEFAULT_DISCOVERY_CACHE_TTL_MS),
		"the observer's fallback window disagrees with the store's",
	);
	assert.equal(state.discovery_cache.within_ttl, true);
});

function sessionForCacheKey(key) {
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
