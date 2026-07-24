import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { createCealDiscoveryCacheStore } from "../dist/discovery-cache.js";
import { runCealCommand } from "../dist/index.js";
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
			capabilities: [{
				capability_id: "message.search", label: "Search messages", effect: "read", target_requirement: "required",
				input_contract: { schema_version: "ceal.message_search_input.v1", required: ["query"], query: { type: "string", max_bytes: 512 } },
				evidence_requirement: "gateway_audit",
			}],
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
						runtime: "claude", root: "~/.claude", health: "active", coverage: "transcript-observed",
						depth: "session_inventory", sessionCount: 1,
						sessions: [{ sessionRef: "11111111-2222-3333-4444-555555555555", lastActivityAt: Date.parse("2026-07-24T00:00:45.000Z"), transcriptBytes: 2048 }],
					},
					{ runtime: "codex", root: "~/.codex", health: "unknown", coverage: "unsupported", note: "The Codex adapter is not implemented yet." },
				],
				nonClaims: ["Session inventory only: transcript content is never read, copied, or forwarded."],
			}),
			inspectAgentGuide: () => ({ status: "staged", agent: "codex", guide_id: "ceal-guide", update_safe: true, registered: false }),
			executablePath: process.execPath,
			now: () => Date.parse("2026-07-24T00:01:00.000Z"),
			onObserverListening: (value) => { handle = value; resolve(value); },
		}).then((code) => { io.exitCode = code; });
	});
	await handleReady;
	context.after(async () => { try { await handle.close(); } catch { /* already closed */ } });

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
	assert.deepEqual(state.discovery_cache.capabilities, [{
		capability_id: "message.search", label: "Search messages", effect: "read", target_requirement: "required", evidence_requirement: "gateway_audit",
	}]);
	assert.equal(state.discovery_cache.within_ttl, true);
	assert.equal(state.discovery_cache.age_ms, 60_000);
	assert.deepEqual(state.discovery_cache.target_catalog, { target_count: 3, returned_count: 0, complete: false, selection_required: true });
	assert.equal(state.install.status, "unmanaged");
	assert.equal(state.guide.status, "staged");
	assert.equal(state.receipts.status, "spooled");
	assert.equal(state.receipts.coverage, "ceal-mediated");
	assert.equal(state.receipts.entry_count, 1);
	assert.deepEqual(state.receipts.entries, [{
		recorded_at: "2026-07-24T00:00:30.000Z",
		request_ref: "narnia:observer:1:call",
		status: "completed",
		evidence: "readback_verified",
		capability: "message.search",
		target: "target:team-inbox",
		audit_refs: ["gateway-audit:event:777"],
	}]);
	assert.match(state.receipts.non_claim, /Gateway audit ledger stays authoritative/u);
	assert.equal(state.agent_activity.status, "inventoried");
	assert.deepEqual(state.agent_activity.adapters[0], {
		runtime: "claude", root: "~/.claude", health: "active", coverage: "transcript-observed",
		depth: "session_inventory", session_count: 1,
		sessions: [{ session_ref: "11111111-2222-3333-4444-555555555555", last_activity_at: "2026-07-24T00:00:45.000Z", transcript_bytes: 2048 }],
	});
	assert.equal(state.agent_activity.adapters[1].coverage, "unsupported");
	assert.match(state.agent_activity.non_claims[0], /never read, copied, or forwarded/u);

	const page = await fetch(doc.url);
	assert.equal(page.status, 200);
	assert.match(page.headers.get("content-type"), /text\/html/u);
	assert.match(page.headers.get("content-security-policy"), /default-src 'none'/u);
	const html = await page.text();
	assert.match(html, /Ceal local observer/u);
	assert.doesNotMatch(html, /ceal_personal_|ceal_refresh_/u);

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
			onObserverListening: (value) => { handle = value; resolve(value); },
		});
	});
	context.after(async () => { try { await handle.close(); } catch { /* already closed */ } });
	const doc = parse(io.stdout.join(""));
	const state = await (await fetch(`${doc.url}api/observer/v1/state`)).json();
	assert.equal(state.receipts.status, "unreadable");
	assert.equal("entries" in state.receipts, false);
	await handle.close();
});

test("ceal observe reports absent stores and rejects invalid ports without serving", async () => {
	const io = collectingIo();
	let handle;
	await new Promise((resolve) => {
		void runCealCommand(["observe", "--port", "0"], io, {
			onObserverListening: (value) => { handle = value; resolve(value); },
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
	await handle.close();

	const invalid = collectingIo();
	assert.equal(await runCealCommand(["observe", "--port", "80"], invalid, {}), 2);
	assert.match(invalid.stdout.join(""), /invalid_argument/u);
	const trailing = collectingIo();
	assert.equal(await runCealCommand(["observe", "extra"], trailing, {}), 2);
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
		get exitCode() { return io.exitCode; },
		set exitCode(value) { io.exitCode = value; },
	};
}
