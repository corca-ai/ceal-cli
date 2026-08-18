import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { CealGatewayRequestInput } from "@corca-ai/ceal-protocol";
import {
	ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS,
	CEAL_GATEWAY_ADDITIVE_DECODE_GENERATION,
	CEAL_GATEWAY_DECODE_GENERATION_HEADER,
} from "@corca-ai/ceal-protocol";
import {
	CEAL_DEFAULT_HTTP_TIMEOUT_MS,
	CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER,
	CEAL_GATEWAY_PROFILES_ACCEPT_HEADER,
	CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER,
	CealHttpTransportError,
	createCealClient,
	createCealHttpTransport,
} from "../src/index.ts";
import { close, listen, parseJsonRecord, readBody, serverPort } from "./client-response-test-support.ts";

test("HTTP transport gives bounded Gateway capability calls a thirty-second default budget", () => {
	assert.equal(CEAL_DEFAULT_HTTP_TIMEOUT_MS, 30_000);
});

type HandshakeInput = Extract<CealGatewayRequestInput, { operation: "handshake" }>;
type DiscoverInput = Extract<CealGatewayRequestInput, { operation: "discover" }>;
type CallInput = Extract<CealGatewayRequestInput, { operation: "call" }>;

const request: HandshakeInput = {
	request_id: "request:handshake:001",
	operation: "handshake",
	profile_ref: "profile:test",
	body: { client: { name: "ceal", version: "0.65.0" } },
};

test("HTTP transport posts a strict request to a loopback Gateway and decodes its correlated response", async () => {
	let observed: { method: string | undefined; authorization: string | undefined; body: ReturnType<typeof parseJsonRecord> } | undefined;
	const server = createServer(async (incoming, outgoing) => {
		observed = {
			method: incoming.method,
			authorization: typeof incoming.headers.authorization === "string" ? incoming.headers.authorization : undefined,
			body: parseJsonRecord(await readBody(incoming)),
		};
		outgoing.writeHead(200, { "content-type": "application/json" });
		outgoing.end(JSON.stringify(handshakeResponse(request)));
	});
	await listen(server);
	try {
		const client = createCealClient(
			createCealHttpTransport({
				endpoint: `http://127.0.0.1:${serverPort(server)}/gateway/client`,
				accessToken: "gateway-issued-token",
			}),
		);
		const response = await client.request(request);
		assert.equal(response.ok, true);
		assert.deepEqual(observed, {
			method: "POST",
			authorization: "Bearer gateway-issued-token",
			body: { ...request, protocol_version: "1.3.0" },
		});
	} finally {
		await close(server);
	}
});

test("HTTP transport scopes strict optional audit timing negotiation to readback", async () => {
	// Golden value: the client cannot import the server's literal, so pin the
	// negotiation constant to the exact string the Gateway matches. A drift here
	// silently disables the catalog without a wire-visible error.
	assert.equal(CEAL_GATEWAY_PROFILES_ACCEPT_HEADER, "x-ceal-profiles");
	assert.equal(CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER, "x-ceal-route-provenance");
	assert.equal(CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER, "x-ceal-audit-timing");

	const observedHeaders = new Map<string, Record<string, string>>();
	const client = createCealClient(
		createCealHttpTransport({
			endpoint: "https://gateway.example.test/client",
			accessToken: "gateway-issued-token",
			fetchFn: async (_endpoint, init) => {
				if (!init?.body || typeof init.body !== "string") throw new Error("missing JSON request body");
				const body = parseJsonRecord(init.body);
				const headers = Object.fromEntries(new Headers(init.headers).entries());
				observedHeaders.set(String(body.operation), headers);
				if (body.operation === "readback") {
					return globalThis.Response.json(
						{
							ok: false,
							request_id: body.request_id,
							protocol_version: "1.3.0",
							proof_ref_or_unavailable: `proof:${body.request_id}`,
							error: { code: "unauthenticated", message: "Authentication is required.", next_action: "Use a Gateway-issued profile." },
						},
						{ status: 401 },
					);
				}
				const captured = requestFromBody(body);
				if (captured.operation === "call") return globalThis.Response.json(allowedCallResponse(captured));
				if (captured.operation === "discover") return globalThis.Response.json(discoveryResponse(captured));
				if (captured.operation === "handshake") return globalThis.Response.json(handshakeResponse(captured));
				throw new Error("unsupported captured request");
			},
		}),
	);
	const response = await client.request(request);
	assert.equal(response.ok, true);
	const discovery = await client.request({
		request_id: "request:discover:header-scope",
		operation: "discover",
		profile_ref: "profile:test",
		body: {},
	});
	assert.equal(discovery.ok, true);
	const call = await client.request({
		request_id: "request:call:header-scope",
		operation: "call",
		profile_ref: "profile:test",
		body: {
			capability_id: "message.search",
			target_ref: "target:workspace",
			arguments: { query: "audit timing", limit: 1 },
			purpose: "Prove audit timing header scope",
		},
	});
	assert.equal(call.ok, true);
	const readback = await client.request({
		request_id: "request:readback:001",
		operation: "readback",
		profile_ref: "profile:test",
		body: { request_id: "request:prior:001" },
	});
	assert.equal(readback.ok, false);
	const handshakeHeaders = requireHeaders(observedHeaders, "handshake");
	const discoveryHeaders = requireHeaders(observedHeaders, "discover");
	const callHeaders = requireHeaders(observedHeaders, "call");
	const readbackHeaders = requireHeaders(observedHeaders, "readback");
	assert.equal(handshakeHeaders["x-ceal-recovery"], "accept");
	for (const headers of [handshakeHeaders, discoveryHeaders, callHeaders, readbackHeaders]) {
		assert.equal(headers[CEAL_GATEWAY_DECODE_GENERATION_HEADER], CEAL_GATEWAY_ADDITIVE_DECODE_GENERATION);
	}
	for (const field of ["recovery", "rate_limit_policy", "profiles", "route_provenance"] as const) {
		assert.equal(handshakeHeaders[ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS[field].legacyAcceptHeader], "accept");
	}
	assert.equal(handshakeHeaders[CEAL_GATEWAY_PROFILES_ACCEPT_HEADER], "accept");
	assert.equal(handshakeHeaders[CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER], "accept");
	assert.equal(handshakeHeaders[CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER], undefined);
	assert.equal(callHeaders[CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER], undefined);
	assert.equal(readbackHeaders[CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER], "accept");
});

test("HTTP transport removes additive keys but still refuses authority keys and closed-enum drift", async () => {
	const baseHandshake = handshakeResponse(request);
	const benign = {
		...baseHandshake,
		gateway_hint: "later envelope guidance",
		value: { ...baseHandshake.value, presentation_hint: "later handshake guidance" },
	};
	const accepted = createCealHttpTransport({
		endpoint: "https://gateway.example.test/client",
		accessToken: "safe-token",
		fetchFn: async () => globalThis.Response.json(benign),
	});
	const decoded = await createCealClient(accepted).request(request);
	assert.equal(Object.hasOwn(decoded, "gateway_hint"), false);
	if (decoded.ok) assert.equal(Object.hasOwn(decoded.value, "presentation_hint"), false);

	const authority = { ...handshakeResponse(request), grant_revision: 9 };
	const authorityTransport = createCealHttpTransport({
		endpoint: "https://gateway.example.test/client",
		accessToken: "safe-token",
		fetchFn: async () => globalThis.Response.json(authority),
	});
	await assert.rejects(createCealClient(authorityTransport).request(request), hasTransportCode("invalid_response"));

	const closedEnum = {
		ok: false,
		request_id: request.request_id,
		protocol_version: "1.3.0",
		error: {
			code: "unavailable",
			message: "Gateway is unavailable.",
			recovery: { kind: "retry_with_new_member" },
		},
	};
	const closedEnumTransport = createCealHttpTransport({
		endpoint: "https://gateway.example.test/client",
		accessToken: "safe-token",
		fetchFn: async () => globalThis.Response.json(closedEnum, { status: 503 }),
	});
	await assert.rejects(createCealClient(closedEnumTransport).request(request), hasTransportCode("invalid_response"));
});

test("HTTP transport refuses redirects before the request body can reach another endpoint", async () => {
	let redirectedRequestReached = false;
	const target = createServer((_incoming, outgoing) => {
		redirectedRequestReached = true;
		outgoing.writeHead(500, { "content-type": "application/json" });
		outgoing.end("{}");
	});
	await listen(target);

	const redirect = createServer((_incoming, outgoing) => {
		outgoing.writeHead(307, { location: `http://127.0.0.1:${serverPort(target)}/redirect-target` });
		outgoing.end();
	});
	await listen(redirect);
	try {
		const client = createCealClient(
			createCealHttpTransport({
				endpoint: `http://127.0.0.1:${serverPort(redirect)}/gateway/client`,
				accessToken: "gateway-issued-token",
			}),
		);
		await assert.rejects(client.request(request), hasTransportCode("request_failed"));
		assert.equal(redirectedRequestReached, false);
	} finally {
		await Promise.all([close(redirect), close(target)]);
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

// The decoder branches purely on the body's own `ok`, never on transport status
// (packages/ceal-protocol/src/index.ts), so a non-2xx carrying a schema-valid
// success body is a reachable state — a proxy serving a stale cached success on
// an error status is the ordinary way to reach it. The guard that refuses it had
// no test at all, so a refactor that dropped or inverted it would have shipped
// a success to the caller with nothing red.
test("HTTP transport refuses a non-2xx response whose body claims success", async () => {
	// A body the decoder genuinely accepts, so the refusal can only come from the
	// status disagreement and not from the body being unreadable.
	const stale = handshakeResponse(request);
	const transport = createCealHttpTransport({
		endpoint: "https://gateway.example.test/client",
		accessToken: "safe-token",
		fetchFn: async () => globalThis.Response.json(stale, { status: 502 }),
	});
	await assert.rejects(createCealClient(transport).request(request), hasTransportCode("invalid_response"));
	// Positive control: the same body on a 2xx is accepted, so the refusal is
	// about the status disagreement and not about the body being unreadable.
	const ok = createCealHttpTransport({
		endpoint: "https://gateway.example.test/client",
		accessToken: "safe-token",
		fetchFn: async () => globalThis.Response.json(stale, { status: 200 }),
	});
	assert.equal((await createCealClient(ok).request(request)).ok, true);
});

test("HTTP transport preserves bounded response diagnostics without retaining the response body", async () => {
	const cases = [
		{
			label: "non-json 401",
			response: () => new globalThis.Response("proxy unauthorized", { status: 401, headers: { "content-type": "text/plain" } }),
			status: 401,
			contentType: "text/plain",
			kind: "content_type_invalid",
			protocolVersion: undefined,
			schemaVersion: undefined,
			envelopeKind: undefined,
			errorCode: undefined,
		},
		{
			label: "malformed json",
			response: () => new globalThis.Response("{not-json", { status: 502, headers: { "content-type": "application/json" } }),
			status: 502,
			contentType: "application/json",
			kind: "body_malformed",
			protocolVersion: undefined,
			schemaVersion: undefined,
			envelopeKind: undefined,
			errorCode: undefined,
		},
		{
			label: "protocol schema mismatch",
			response: () =>
				globalThis.Response.json({
					ok: true,
					request_id: "request:wrong",
					protocol_version: "1.3.0",
					value: { schema_version: "ceal.gateway_discovery.v2" },
				}),
			status: 200,
			contentType: "application/json",
			kind: "protocol_invalid",
			protocolVersion: "1.3.0",
			schemaVersion: "ceal.gateway_discovery.v2",
			envelopeKind: "success",
			errorCode: undefined,
		},
		{
			label: "malformed failure envelope",
			response: () => globalThis.Response.json({
				ok: false,
				request_id: request.request_id,
				protocol_version: "1.3.0",
				error: { code: "unsafe code", message: "safe" },
			}, { status: 502 }),
			status: 502,
			contentType: "application/json",
			kind: "protocol_invalid",
			protocolVersion: "1.3.0",
			schemaVersion: null,
			envelopeKind: "failure",
			errorCode: null,
		},
		{
			label: "unexpected success status",
			response: () => globalThis.Response.json(handshakeResponse(request), { status: 502 }),
			status: 502,
			contentType: "application/json",
			kind: "unexpected_success_status",
			protocolVersion: undefined,
			schemaVersion: undefined,
			envelopeKind: undefined,
			errorCode: undefined,
		},
	];
	for (const item of cases) {
		const transport = createCealHttpTransport({
			endpoint: "https://gateway.example.test/client",
			accessToken: "safe-token",
			fetchFn: async () => item.response(),
		});
		await assert.rejects(createCealClient(transport).request(request), (error) => {
			assert.ok(error instanceof CealHttpTransportError, item.label);
			assert.equal(error.http_status, item.status, item.label);
			assert.equal(error.request_id, request.request_id, item.label);
			assert.equal(error.operation, request.operation, item.label);
			assert.equal(error.response_content_type, item.contentType, item.label);
			assert.equal(error.response_kind, item.kind, item.label);
			assert.equal(error.response_protocol_version, item.protocolVersion, item.label);
			assert.equal(error.response_schema_version, item.schemaVersion, item.label);
			assert.equal(error.response_envelope_kind, item.envelopeKind, item.label);
			assert.equal(error.response_error_code, item.errorCode, item.label);
			assert.doesNotMatch(error.message, /proxy unauthorized|safe-token/u, item.label);
			return true;
		});
	}
});

test("HTTP transport identifies an incomplete discovery target page without a continuation cursor", async () => {
	const discoveryRequest: DiscoverInput = {
		request_id: "request:discover:shape-001",
		operation: "discover",
		profile_ref: "profile:test",
		body: {},
	};
	const response = discoveryResponse(discoveryRequest);
	const legacyTargetCatalog = {
		...response,
		value: {
			...response.value,
			target_catalog: { target_count: 0, returned_count: 0, complete: false, selection_required: true },
		},
	};
	const transport = createCealHttpTransport({
		endpoint: "https://gateway.example.test/client",
		accessToken: "safe-token",
		fetchFn: async () => globalThis.Response.json(legacyTargetCatalog),
	});
	await assert.rejects(createCealClient(transport).request(discoveryRequest), (error) => {
		assert.ok(error instanceof CealHttpTransportError);
		assert.equal(error.response_kind, "protocol_invalid");
		assert.equal(error.response_envelope_kind, "success");
		assert.equal(error.response_schema_version, "ceal.gateway_discovery.v2");
		assert.equal(error.response_shape_issue, "discovery_target_catalog_incomplete_without_cursor");
		assert.doesNotMatch(error.message, /selection_required|target_count|safe-token/u);
		return true;
	});
});

// The declared-length branch had no test on either side of the refactor that
// moved it into request-bounds.ts, so nothing would have said if its two codes
// swapped. They are different answers to the caller: `invalid_response` means the
// header is not a length, `response_too_large` means it is one and it does not fit.
test("HTTP transport tells a malformed content-length from an oversized one", async () => {
	const body = { ok: true, request_id: request.request_id, protocol_version: "1.3.0", value: {} };
	const cases: Array<[string, string]> = [
		["not-a-number", "invalid_response"],
		["-5", "invalid_response"],
		["12.5", "invalid_response"],
		// Too large to be an exact integer: malformed, not merely oversized. The
		// session clients answer the other way on this input, on purpose.
		["99999999999999999999", "invalid_response"],
		["300000", "response_too_large"],
	];
	for (const [declared, code] of cases) {
		const transport = createCealHttpTransport({
			endpoint: "https://gateway.example.test/client",
			accessToken: "safe-token",
			maxResponseBytes: 1024,
			fetchFn: async () =>
				new globalThis.Response(JSON.stringify(body), {
					status: 200,
					headers: { "content-type": "application/json", "content-length": declared },
				}),
		});
		await assert.rejects(createCealClient(transport).request(request), hasTransportCode(code), declared);
	}
});

test("HTTP transport keeps discovery, allowed call, and policy denial responses correlated to their operations", async () => {
	const discoveryRequest: DiscoverInput = {
		request_id: "request:discover:001",
		operation: "discover",
		profile_ref: "profile:test",
		body: {},
	};
	const callRequest: CallInput = {
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
		if (item.request.operation === "discover") assert.deepEqual(await createCealClient(transport).request(item.request), item.response);
		else assert.deepEqual(await createCealClient(transport).request(item.request), item.response);
	}

	const mismatchedTransport = createCealHttpTransport({
		endpoint: "https://gateway.example.test/client",
		accessToken: "safe-token",
		fetchFn: async () =>
			globalThis.Response.json(
				allowedCallResponse({
					...callRequest,
					request_id: discoveryRequest.request_id,
				}),
			),
	});
	await assert.rejects(createCealClient(mismatchedTransport).request(discoveryRequest), hasTransportCode("invalid_response"));
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
		assert.throws(() => createCealHttpTransport({ endpoint, accessToken: "safe-token" }), hasTransportCode("invalid_configuration"));
	}
	let fetched = false;
	const client = createCealClient(
		createCealHttpTransport({
			endpoint: "http://127.0.0.1:19390/client",
			accessToken: "safe-token",
			fetchFn: async () => {
				fetched = true;
				throw new Error("must not fetch");
			},
		}),
	);
	await assert.rejects(
		client.request({ request_id: "request:discover:001", operation: "discover", profile_ref: "profile:test", body: { capability_id: "" } }),
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
			fetchFn: async () =>
				new globalThis.Response(JSON.stringify(handshakeResponse(request)), {
					status: 200,
					headers: { "content-type": "text/plain; application/json" },
				}),
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
			fetchFn: async () =>
				globalThis.Response.json({ ok: true, request_id: request.request_id, protocol_version: "1.3.0", value: { payload: token.repeat(20) } }),
			maxResponseBytes: 64,
		},
		{
			code: "request_failed",
			fetchFn: async () => {
				throw new Error(`provider echoed ${token}`);
			},
		},
	];
	for (const item of cases) {
		const client = createCealClient(
			createCealHttpTransport({
				endpoint: "https://gateway.example.test/client",
				accessToken: token,
				fetchFn: item.fetchFn,
				...(item.maxResponseBytes === undefined ? {} : { maxResponseBytes: item.maxResponseBytes }),
			}),
		);
		await assert.rejects(client.request(request), (error) => {
			if (!(error instanceof CealHttpTransportError)) return false;
			assert.equal(error.code, item.code);
			assert.doesNotMatch(error.message, new RegExp(token, "u"));
			assert.doesNotMatch(error.message, /provider echoed/u);
			return true;
		});
	}
});

test("HTTP transport retains structured JSON media types with parameters", async () => {
	const transport = createCealHttpTransport({
		endpoint: "https://gateway.example.test/client",
		accessToken: "safe-token",
		fetchFn: async () =>
			new globalThis.Response(JSON.stringify(handshakeResponse(request)), {
				status: 200,
				headers: { "content-type": "application/problem+json; charset=utf-8" },
			}),
	});
	assert.equal((await createCealClient(transport).request(request)).ok, true);
});

test("HTTP transport enforces the total request timeout even when injected fetch ignores abort", async () => {
	const client = createCealClient(
		createCealHttpTransport({
			endpoint: "https://gateway.example.test/client",
			accessToken: "safe-token",
			timeoutMs: 5,
			fetchFn: async () => new Promise(() => {}),
		}),
	);
	await assert.rejects(client.request(request), hasTransportCode("request_timeout"));
});

test("HTTP transport preserves timeout classification when injected fetch rejects on abort", async () => {
	const client = createCealClient(
		createCealHttpTransport({
			endpoint: "https://gateway.example.test/client",
			accessToken: "safe-token",
			timeoutMs: 5,
			fetchFn: async (_url, init) =>
				new Promise((_resolve, reject) => {
					requireSignal(init).addEventListener("abort", () => reject(new Error("aborted fetch")), { once: true });
				}),
		}),
	);
	await assert.rejects(client.request(request), hasTransportCode("request_timeout"));
});

test("HTTP transport preserves timeout classification when response body rejects on abort", async () => {
	const client = createCealClient(
		createCealHttpTransport({
			endpoint: "https://gateway.example.test/client",
			accessToken: "safe-token",
			timeoutMs: 5,
			fetchFn: async (_url, init) =>
				new globalThis.Response(
					new globalThis.ReadableStream({
						start(stream) {
							requireSignal(init).addEventListener("abort", () => stream.error(new Error("aborted body")), { once: true });
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		}),
	);
	await assert.rejects(client.request(request), hasTransportCode("request_timeout"));
});

function hasTransportCode(code: string) {
	return (error: unknown): boolean => error instanceof CealHttpTransportError && error.code === code;
}

function requireHeaders(headers: Map<string, Record<string, string>>, key: string): Record<string, string> {
	const value = headers.get(key);
	if (!value) throw new Error(`missing captured headers: ${key}`);
	return value;
}

function requireSignal(init: RequestInit | undefined): AbortSignal {
	if (!init?.signal) throw new Error("missing abort signal");
	return init.signal;
}

function handshakeResponse(input: HandshakeInput) {
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

function discoveryResponse(input: DiscoverInput) {
	const selected = input.body.capability_id === "message.search";
	return successResponse(input, {
		schema_version: "ceal.gateway_discovery.v2",
		profile_ref: input.profile_ref,
		membership_ref: "membership:test",
		capabilities: [
			{
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
			},
		],
		targets: selected
			? [
					{
						target_ref: "target:workspace",
						label: "Approved workspace",
						access: "granted",
						capability_ids: ["message.search"],
						capability_access: [matureCapabilityAccess()],
					},
				]
			: [],
		target_catalog: selected
			? { target_count: 1, returned_count: 1, complete: true }
			: { target_count: 0, returned_count: 0, complete: true },
		host_decision: "accepted",
		proof_level: "host_decision",
		non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	});
}

function allowedCallResponse(input: CallInput) {
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
			results: [
				{
					ref: "message:result:001",
					target_ref: input.body.target_ref,
					created_at: "2026-07-10T00:00:00.000Z",
					source_label: "Approved workspace",
					text_preview: "Quarterly plan review is scheduled.",
				},
			],
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

function successResponse(input: CealGatewayRequestInput, value: Record<string, unknown>) {
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

function policyDenialResponse(input: CallInput) {
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

function requestFromBody(body: Record<string, unknown>): CealGatewayRequestInput {
	if (typeof body.request_id !== "string" || typeof body.profile_ref !== "string") throw new Error("invalid captured request");
	if (body.operation === "handshake")
		return {
			request_id: body.request_id,
			operation: "handshake",
			profile_ref: body.profile_ref,
			body: { client: { name: "ceal", version: "test" } },
		};
	if (body.operation === "discover") return { request_id: body.request_id, operation: "discover", profile_ref: body.profile_ref, body: {} };
	if (body.operation === "call")
		return {
			request_id: body.request_id,
			operation: "call",
			profile_ref: body.profile_ref,
			body: { capability_id: "message.search", target_ref: "target:workspace", arguments: {}, purpose: "test" },
		};
	throw new Error("unsupported captured request");
}
