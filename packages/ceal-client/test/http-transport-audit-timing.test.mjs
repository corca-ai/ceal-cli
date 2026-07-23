import assert from "node:assert/strict";
import test from "node:test";
import {
	CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER,
	CEAL_GATEWAY_PROFILES_ACCEPT_HEADER,
	CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER,
	createCealClient,
	createCealHttpTransport,
} from "../dist/index.js";

const PROFILE = "profile:test";
const observedHeaders = new Map();

function responseFor(body) {
	if (body.operation === "handshake") {
		return success(body, {
			schema_version: "ceal.gateway_handshake.v1", negotiated_protocol_version: "1.3.0", supported_gateway_protocol_range: { minimum: "1.3.0", maximum: "1.3.0" },
			profile_ref: PROFILE, membership_ref: "membership:test", registration_ref: "registration:test",
			client_ref: "client:test", subject_ref: "subject:test", instance_ref: "instance:test",
			host_decision: "accepted", proof_level: "host_decision", non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		});
	}
	if (body.operation === "call") {
		return success(body, {
			schema_version: "ceal.gateway_call_result.v1", capability_id: "message.search", grant_ref: "grant:workspace-message-search", grant_revision: 3, target_ref: "target:workspace",
			data: { schema_version: "ceal.message_search_result.v1", query: { redacted: true, utf8_bytes: 12, empty: false }, result_count: 0, results: [], coverage: { schema_version: "ceal.message_search_coverage.v1", source: "authoritative_index", match_semantics: "backend_ranked", reply_coverage: "included", completeness: "bounded", truncated: false }, minimization: { raw_provider_ids_included: false, raw_messages_included: false, credential_material_included: false } },
			redaction: { state: "applied", omitted_classes: ["query_text", "raw_provider_ids", "raw_messages"] }, host_decision: "accepted", proof_level: "host_decision", non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		});
	}
	return {
		ok: false, request_id: body.request_id, protocol_version: "1.3.0", proof_ref_or_unavailable: `proof:${body.request_id}`,
		error: { code: "unauthenticated", message: "Authentication is required.", next_action: "Use a Gateway-issued profile." },
	};
}

function success(body, value) {
	return { ok: true, request_id: body.request_id, protocol_version: "1.3.0", proof_ref_or_unavailable: `proof:${body.request_id}`, value };
}

test("HTTP transport scopes strict optional audit timing negotiation to readback", async () => {
	assert.equal(CEAL_GATEWAY_PROFILES_ACCEPT_HEADER, "x-ceal-profiles");
	assert.equal(CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER, "x-ceal-route-provenance");
	assert.equal(CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER, "x-ceal-audit-timing");
	observedHeaders.clear();
	const client = createCealClient(createCealHttpTransport({
		endpoint: "https://gateway.example.test/client", accessToken: "gateway-issued-token",
		fetchFn: async (_endpoint, init) => {
			const body = JSON.parse(init.body);
			observedHeaders.set(body.operation, init.headers);
			return globalThis.Response.json(responseFor(body), { status: body.operation === "readback" ? 401 : 200 });
		},
	}));
	assert.equal((await client.request({ request_id: "request:handshake:header-scope", operation: "handshake", profile_ref: PROFILE, body: { client: { name: "ceal", version: "0.65.0" } } })).ok, true);
	assert.equal((await client.request({ request_id: "request:call:header-scope", operation: "call", profile_ref: PROFILE, body: { capability_id: "message.search", target_ref: "target:workspace", arguments: { query: "audit timing", limit: 1 }, purpose: "Prove audit timing header scope" } })).ok, true);
	assert.equal((await client.request({ request_id: "request:readback:header-scope", operation: "readback", profile_ref: PROFILE, body: { request_id: "request:call:header-scope" } })).ok, false);

	assert.equal(observedHeaders.get("handshake")["x-ceal-recovery"], "accept");
	assert.equal(observedHeaders.get("handshake")[CEAL_GATEWAY_PROFILES_ACCEPT_HEADER], "accept");
	assert.equal(observedHeaders.get("handshake")[CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER], "accept");
	assert.equal(observedHeaders.get("handshake")[CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER], undefined);
	assert.equal(observedHeaders.get("call")[CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER], undefined);
	assert.equal(observedHeaders.get("readback")[CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER], "accept");
});
