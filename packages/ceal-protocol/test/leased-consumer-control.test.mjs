import assert from "node:assert/strict";
import test from "node:test";
import {
	CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA,
	CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA,
	CEAL_LEASED_CONSUMER_CONTROL_SESSION_SCHEMA,
	decodeCealLeasedConsumerControlRequest,
	decodeCealLeasedConsumerControlResponse,
	decodeCealLeasedConsumerControlSession,
} from "../dist/index.js";

const lease = { event_ref: "event:one", lease_ref: "lease:one", lease_fence: 1, delivery_attempt: 1, expires_at: "2026-08-01T00:00:30.000Z" };
const leaseInput = { event_ref: lease.event_ref, lease_ref: lease.lease_ref, lease_fence: lease.lease_fence };

test("leased-consumer control decoders accept only the protected session and five exact operation shapes", () => {
	assert.deepEqual(decodeCealLeasedConsumerControlSession({
		schema_version: CEAL_LEASED_CONSUMER_CONTROL_SESSION_SCHEMA, transport: "unix_socket", socket_path: "/run/ceal/leased-control.sock", service_credential: "private-service-credential",
	}).transport, "unix_socket");
	for (const request of [
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "acquire", input: {} },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "projection", input: leaseInput },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "recheck", input: leaseInput },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "call", input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id: "github.issue.create", target_ref: "target:issue", purpose: "create issue", arguments: { title: "Hello" } } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "complete", input: { ...leaseInput, disposition: "completed", agent_run_ref: "run:one" } },
	]) assert.equal(decodeCealLeasedConsumerControlRequest(request).operation, request.operation);
});

test("leased-consumer control response projections never return credential, consumer identity, or raw provider fields", () => {
	for (const response of [
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "acquire", result: { status: "leased", lease } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "projection", result: { status: "available", event_ref: "event:one", event_revision: 1, normalized_projection_ref: "projection:one", normalized_projection_revision: 1, projection: { schema_version: "ceal.gateway_normalized_projection.v1", text: "bounded", context: { conversation_kind: "channel", is_thread_reply: false } } } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "recheck", result: { status: "active", lease } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "leased_consumer_call_unavailable" } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "complete", result: { status: "completed", replayed: false } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "acquire", result: { status: "control_unavailable" } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "projection", result: { status: "control_unavailable" } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "recheck", result: { status: "control_unavailable" } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "complete", result: { status: "control_unavailable" } },
	]) assert.equal(decodeCealLeasedConsumerControlResponse(response).operation, response.operation);
});

test("leased-consumer control rejects a public/admin socket, caller authority, receipt assertion, and widened result", () => {
	assert.throws(() => decodeCealLeasedConsumerControlSession({
		schema_version: CEAL_LEASED_CONSUMER_CONTROL_SESSION_SCHEMA, transport: "unix_socket", socket_path: "/run/ceal/admin-gateway.sock", service_credential: "private-service-credential",
	}), TypeError);
	for (const request of [
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "acquire", input: { instance_ref: "instance:prod" } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "projection", input: { ...leaseInput, service_credential: "forged" } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "complete", input: { ...leaseInput, disposition: "completed", receipt_refs: ["receipt:forged"] } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "call", input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id: "github.issue.create", target_ref: "target:issue", purpose: "create issue", arguments: { authorization: "forged" } } },
	]) assert.throws(() => decodeCealLeasedConsumerControlRequest(request), TypeError);
	assert.throws(() => decodeCealLeasedConsumerControlRequest({
		schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "call",
		input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id: "github.issue.create", target_ref: "target:issue", purpose: "create issue", arguments: { text: "x".repeat(32 * 1024) } },
	}), TypeError);
	assert.throws(() => decodeCealLeasedConsumerControlResponse({
		schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "projection",
		result: { status: "available", event_ref: "event:one", event_revision: 1, normalized_projection_ref: "projection:one", normalized_projection_revision: 1, projection: { schema_version: "ceal.gateway_normalized_projection.v1", text: "bounded" }, provider_url: "https://provider.example" },
	}), TypeError);
	assert.throws(() => decodeCealLeasedConsumerControlResponse({
		schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "admitted", service_call_ref: "service-call:private" },
	}), TypeError);
	assert.throws(() => decodeCealLeasedConsumerControlResponse({
		schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "idempotency_not_allowed" },
	}), TypeError);
});
