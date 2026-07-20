import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import test from "node:test";
import {
	CEAL_GATEWAY_PROFILES_ACCEPT_HEADER,
	CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER,
	CealHttpTransportError,
	createCealClient,
	createCealHttpTransport,
} from "../dist/index.js";

const request = {
	request_id: "request:handshake:001",
	operation: "handshake",
	profile_ref: "profile:test",
	body: { client: { name: "ceal", version: "0.65.0" } },
};

test("HTTP transport posts a strict request to a loopback Gateway and decodes its correlated response", async () => {
	let observed;
	const server = createServer((incoming, outgoing) => {
		const chunks = [];
		incoming.on("data", (chunk) => chunks.push(chunk));
		incoming.on("end", () => {
			observed = {
				method: incoming.method,
				authorization: incoming.headers.authorization,
				body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
			};
			outgoing.writeHead(200, { "content-type": "application/json" });
			outgoing.end(JSON.stringify(handshakeResponse(request)));
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		assert.equal(typeof address, "object");
		const client = createCealClient(createCealHttpTransport({
			endpoint: `http://127.0.0.1:${address.port}/gateway/client`,
			accessToken: "gateway-issued-token",
		}));
		const response = await client.request(request);
		assert.equal(response.ok, true);
		assert.deepEqual(observed, {
			method: "POST",
			authorization: "Bearer gateway-issued-token",
			body: { ...request, protocol_version: "1.3.0" },
		});
	} finally {
		await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	}
});

test("HTTP transport negotiates strict optional fields with exact server header literals", async () => {
	// Golden value: the client cannot import the server's literal, so pin the
	// negotiation constant to the exact string the Gateway matches. A drift here
	// silently disables the catalog without a wire-visible error.
	assert.equal(CEAL_GATEWAY_PROFILES_ACCEPT_HEADER, "x-ceal-profiles");
	assert.equal(CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER, "x-ceal-route-provenance");

	let observedHeaders;
	const client = createCealClient(createCealHttpTransport({
		endpoint: "https://gateway.example.test/client",
		accessToken: "gateway-issued-token",
		fetchFn: async (_endpoint, init) => {
			observedHeaders = init.headers;
			return globalThis.Response.json(handshakeResponse(request));
		},
	}));
	const response = await client.request(request);
	assert.equal(response.ok, true);
	// Sent unconditionally alongside the recovery negotiation, mirroring it.
	assert.equal(observedHeaders["x-ceal-recovery"], "accept");
	assert.equal(observedHeaders[CEAL_GATEWAY_PROFILES_ACCEPT_HEADER], "accept");
	assert.equal(observedHeaders[CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER], "accept");
});

test("HTTP transport refuses redirects before the request body can reach another endpoint", async () => {
	let redirectedRequestReached = false;
	const target = createServer((_incoming, outgoing) => {
		redirectedRequestReached = true;
		outgoing.writeHead(500, { "content-type": "application/json" });
		outgoing.end("{}");
	});
	await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
	const targetAddress = target.address();
	assert.equal(typeof targetAddress, "object");

	const redirect = createServer((_incoming, outgoing) => {
		outgoing.writeHead(307, { location: `http://127.0.0.1:${targetAddress.port}/redirect-target` });
		outgoing.end();
	});
	await new Promise((resolve) => redirect.listen(0, "127.0.0.1", resolve));
	try {
		const address = redirect.address();
		assert.equal(typeof address, "object");
		const client = createCealClient(createCealHttpTransport({
			endpoint: `http://127.0.0.1:${address.port}/gateway/client`,
			accessToken: "gateway-issued-token",
		}));
		await assert.rejects(client.request(request), hasTransportCode("request_failed"));
		assert.equal(redirectedRequestReached, false);
	} finally {
		await Promise.all([
			new Promise((resolve, reject) => redirect.close((error) => error ? reject(error) : resolve())),
			new Promise((resolve, reject) => target.close((error) => error ? reject(error) : resolve())),
		]);
	}
});

test("HTTP transport returns a valid failure envelope on non-2xx", async () => {
	const failure = {
		ok: false,
		request_id: request.request_id,
		protocol_version: "1.3.0",
		error: { code: "unauthenticated", message: "Authentication is required.", next_action: "Use a Gateway-issued profile." },
	};
	const transport = createCealHttpTransport({
		endpoint: "https://gateway.example.test/client",
		accessToken: "safe-token",
		fetchFn: async () => globalThis.Response.json(failure, { status: 401 }),
	});
	assert.deepEqual(await createCealClient(transport).request(request), failure);
});

test("HTTP transport keeps discovery, allowed call, and policy denial responses correlated to their operations", async () => {
	const discoveryRequest = {
		request_id: "request:discover:001",
		operation: "discover",
		profile_ref: "profile:test",
		body: {},
	};
	const callRequest = {
		request_id: "request:call:001",
		operation: "call",
		profile_ref: "profile:test",
		body: {
			capability_id: "message.search",
			target_ref: "target:workspace",
			arguments: { query: "quarterly plan", limit: 5 },
			purpose: "Find an approved workspace message",
		},
	};
	const cases = [
		{ request: discoveryRequest, response: discoveryResponse(discoveryRequest), status: 200 },
		{ request: callRequest, response: allowedCallResponse(callRequest), status: 200 },
		{ request: callRequest, response: policyDenialResponse(callRequest), status: 403 },
	];
	for (const item of cases) {
		const transport = createCealHttpTransport({
			endpoint: "https://gateway.example.test/client",
			accessToken: "safe-token",
			fetchFn: async () => globalThis.Response.json(item.response, { status: item.status }),
		});
		assert.deepEqual(await createCealClient(transport).request(item.request), item.response);
	}

	const mismatchedTransport = createCealHttpTransport({
		endpoint: "https://gateway.example.test/client",
		accessToken: "safe-token",
		fetchFn: async () => globalThis.Response.json(allowedCallResponse({
			...callRequest,
			request_id: discoveryRequest.request_id,
		})),
	});
	await assert.rejects(
		createCealClient(mismatchedTransport).request(discoveryRequest),
		hasTransportCode("invalid_response"),
	);
});

test("HTTP transport rejects unsafe endpoints and invalid outbound requests before fetch", async () => {
	for (const endpoint of [
		"http://gateway.example.test/client",
		"http://localhost:19390/client",
		"https://user:pass@gateway.example.test/client",
		"https://gateway.example.test/client?deployment=secret",
		"https://gateway.example.test/client#fragment",
		"file:///tmp/gateway",
	]) {
		assert.throws(
			() => createCealHttpTransport({ endpoint, accessToken: "safe-token" }),
			hasTransportCode("invalid_configuration"),
		);
	}
	let fetched = false;
	const client = createCealClient(createCealHttpTransport({
		endpoint: "http://127.0.0.1:19390/client",
		accessToken: "safe-token",
		fetchFn: async () => { fetched = true; throw new Error("must not fetch"); },
	}));
	await assert.rejects(
		client.request({ request_id: "request:discover:001", operation: "discover", body: {} }),
		hasTransportCode("invalid_request"),
	);
	assert.equal(fetched, false);
});

test("HTTP transport bounds and validates response bytes without leaking token or provider response", async () => {
	const token = "gateway-secret-token";
	const cases = [
		{
			code: "invalid_response",
			fetchFn: async () => new globalThis.Response("not-json", { status: 502, headers: { "content-type": "text/plain" } }),
		},
		{
			code: "invalid_response",
			fetchFn: async () => globalThis.Response.json({ ok: true, request_id: "request:mismatch", protocol_version: "1.3.0", value: {} }),
		},
		{
			code: "invalid_response",
			fetchFn: async () => globalThis.Response.json({ ok: true, request_id: request.request_id, protocol_version: "1.0.0", value: {} }),
		},
		{
			code: "response_too_large",
			fetchFn: async () => globalThis.Response.json({ ok: true, request_id: request.request_id, protocol_version: "1.3.0", value: { payload: token.repeat(20) } }),
			maxResponseBytes: 64,
		},
		{
			code: "request_failed",
			fetchFn: async () => { throw new Error(`provider echoed ${token}`); },
		},
	];
	for (const item of cases) {
		const client = createCealClient(createCealHttpTransport({
			endpoint: "https://gateway.example.test/client",
			accessToken: token,
			fetchFn: item.fetchFn,
			maxResponseBytes: item.maxResponseBytes,
		}));
		await assert.rejects(client.request(request), (error) => {
			assert.equal(error instanceof CealHttpTransportError, true);
			assert.equal(error.code, item.code);
			assert.doesNotMatch(error.message, new RegExp(token, "u"));
			assert.doesNotMatch(error.message, /provider echoed/u);
			return true;
		});
	}
});

test("HTTP transport enforces the total request timeout even when injected fetch ignores abort", async () => {
	const client = createCealClient(createCealHttpTransport({
		endpoint: "https://gateway.example.test/client",
		accessToken: "safe-token",
		timeoutMs: 5,
		fetchFn: async () => new Promise(() => {}),
	}));
	await assert.rejects(client.request(request), hasTransportCode("request_timeout"));
});

function hasTransportCode(code) {
	return (error) => error instanceof CealHttpTransportError && error.code === code;
}

function handshakeResponse(input) {
	return successResponse(input, {
			schema_version: "ceal.gateway_handshake.v1",
			negotiated_protocol_version: "1.3.0",
			supported_gateway_protocol_range: { minimum: "1.3.0", maximum: "1.3.0" },
			profile_ref: input.profile_ref,
			membership_ref: "membership:test",
			registration_ref: "registration:test",
			client_ref: "client:test",
			subject_ref: "subject:test",
			instance_ref: "instance:test",
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	});
}

function discoveryResponse(input) {
	const selected = input.body.capability_id === "message.search";
	return successResponse(input, {
			schema_version: "ceal.gateway_discovery.v2",
			profile_ref: input.profile_ref,
			membership_ref: "membership:test",
			capabilities: [{
				capability_id: "message.search",
				label: "Search approved messages",
				effect: "read",
				target_requirement: "required",
				input_contract: {
					schema_version: "ceal.message_search_input.v1",
					required: ["query"],
					query: { type: "string", max_bytes: 512 },
					limit: { type: "integer", minimum: 1, maximum: 10, default: 5 },
				},
				evidence_requirement: "gateway_audit",
			}],
			targets: selected ? [{
				target_ref: "target:workspace",
				label: "Approved workspace",
				access: "granted",
				capability_ids: ["message.search"],
				capability_access: [matureCapabilityAccess()],
			}] : [],
			target_catalog: selected
				? { target_count: 1, returned_count: 1, complete: true, selection_required: false }
				: { target_count: 1, returned_count: 0, complete: false, selection_required: true },
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	});
}

function allowedCallResponse(input) {
	return successResponse(input, {
			schema_version: "ceal.gateway_call_result.v1",
			capability_id: input.body.capability_id,
			grant_ref: "grant:workspace-message-search",
			grant_revision: 3,
			target_ref: input.body.target_ref,
			data: {
				schema_version: "ceal.message_search_result.v1",
				query: { redacted: true, utf8_bytes: 14, empty: false },
				result_count: 1,
				results: [{
					ref: "message:result:001",
					target_ref: input.body.target_ref,
					created_at: "2026-07-10T00:00:00.000Z",
					source_label: "Approved workspace",
					text_preview: "Quarterly plan review is scheduled.",
				}],
				coverage: matureSearchCoverage(),
				minimization: {
					raw_provider_ids_included: false,
					raw_messages_included: false,
					credential_material_included: false,
				},
			},
			redaction: {
				state: "applied",
				omitted_classes: ["query_text", "raw_provider_ids", "raw_messages"],
			},
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	});
}

function successResponse(input, value) {
	return {
		ok: true,
		request_id: input.request_id,
		protocol_version: "1.3.0",
		proof_ref_or_unavailable: `proof:${input.request_id}`,
		value,
	};
}

function matureCapabilityAccess() {
	return {
		schema_version: "ceal.capability_access.v1",
		capability_id: "message.search",
		grant_ref: "grant:workspace-message-search",
		grant_revision: 3,
		readiness: "ready",
	};
}

function matureSearchCoverage() {
	return {
		schema_version: "ceal.message_search_coverage.v1",
		source: "authoritative_index",
		match_semantics: "backend_ranked",
		reply_coverage: "included",
		completeness: "bounded",
		truncated: false,
	};
}

function policyDenialResponse(input) {
	return {
		ok: false,
		request_id: input.request_id,
		protocol_version: "1.3.0",
		proof_ref_or_unavailable: `proof:${input.request_id}`,
		error: {
			code: "policy_denied",
			message: "The authenticated profile is not granted this capability for the requested target.",
			next_action: "Request policy approval for this capability and target.",
			decision: {
				schema_version: "ceal.gateway_policy_denial.v1",
				capability_id: input.body.capability_id,
				target_ref: input.body.target_ref,
				host_decision: "denied",
				proof_level: "host_decision",
				non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
			},
		},
	};
}
