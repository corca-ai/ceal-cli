import assert from "node:assert/strict";
import test from "node:test";
import {
	CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA,
	CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA,
	CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_REQUEST_SCHEMA,
	CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_RESPONSE_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_DELETE_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_DELETE_DATA_SCHEMA,
	decodeCealLeasedConsumerCapabilityControlResponse,
	decodeCealLeasedConsumerDispositionControlRequest,
	decodeCealLeasedConsumerDispositionControlResponse,
} from "../dist/index.js";

const leaseInput = { event_ref: "event:one", lease_ref: "lease:one", lease_fence: 1 };
const result = { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "message.delete", effect: "write", result_ref: `result:${"a".repeat(64)}`, handles: [{ kind: "message", ref: `message:${"c".repeat(64)}` }], data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_DELETE_DATA_SCHEMA, terminal: "readback_confirmed" } };
const receipt = {
	schema_version: "ceal.leased_consumer_capability_receipt.v1",
	receipt_ref: `capability-receipt:${"d".repeat(64)}`,
	capability_id: "message.delete",
	effect: "write",
	object: { kind: "message", ref: `message:${"c".repeat(64)}` },
	requester: { subject_ref: `subject:${"e".repeat(64)}` },
	provider_outcome: "verified",
	result_delivery: "transport_lost",
	content: { bytes: 0, sha256: "f".repeat(64) },
	author: { status: "absent", reason: "not_available_without_provider_fetch" },
};

test("candidate v6 adds an exact disposition without widening v4", () => {
	const request = { schema_version: CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_REQUEST_SCHEMA, operation: "call", input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id: "message.delete", target_ref: `target:${"b".repeat(64)}`, purpose: "delete", idempotency_key: "write:delete-one", arguments: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_DELETE_ARGUMENTS_SCHEMA, message_ref: `message:${"c".repeat(64)}` } } };
	assert.equal(decodeCealLeasedConsumerDispositionControlRequest(request).operation, "call");
	for (const disposition of [
		{ status: "result", result, provider_outcome: "verified", result_delivery: "pending" },
		{ status: "capability_result_unavailable", provider_outcome: "verified", result_delivery: "transport_lost" },
		{ status: "write_unknown", provider_outcome: "outcome_unknown", result_delivery: "unavailable" },
		{ status: "capability_unavailable", provider_outcome: "not_attempted", result_delivery: "unavailable" },
		{ status: "result_available", result_ref: result.result_ref, provider_outcome: "verified", result_delivery: "transport_lost" },
	]) assert.equal(decodeCealLeasedConsumerDispositionControlResponse({ schema_version: CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_RESPONSE_SCHEMA, operation: "call", result: disposition }).operation, "call");
	const replay = { schema_version: CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_REQUEST_SCHEMA, operation: "result", input: { ...leaseInput, result_ref: result.result_ref } };
	assert.equal(decodeCealLeasedConsumerDispositionControlRequest(replay).operation, "result");
	assert.equal(decodeCealLeasedConsumerDispositionControlResponse({ schema_version: CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_RESPONSE_SCHEMA, operation: "result", result: { status: "result", result, receipt, replayed: true } }).operation, "result");
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse({ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "capability_unavailable", provider_outcome: "not_attempted", result_delivery: "unavailable" } }), TypeError);
});

test("candidate v6 rejects illegal disposition matrices and private locators", () => {
	const allowed = new Set([
		"capability_unavailable:not_attempted:unavailable", "capability_unavailable:outcome_unknown:unavailable",
		"capability_result_unavailable:verified:unavailable", "capability_result_unavailable:verified:pending", "capability_result_unavailable:verified:transport_lost",
		"write_unknown:outcome_unknown:unavailable",
	]);
	for (const status of ["capability_unavailable", "capability_result_unavailable", "write_unknown", "result_not_replayable"])
		for (const provider_outcome of ["not_attempted", "outcome_unknown", "verified"])
			for (const result_delivery of ["unavailable", "pending", "offered", "transport_lost"]) {
				const response = { schema_version: CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status, provider_outcome, result_delivery } };
				const key = `${status}:${provider_outcome}:${result_delivery}`;
				if (allowed.has(key)) assert.equal(decodeCealLeasedConsumerDispositionControlResponse(response).operation, "call");
				else assert.throws(() => decodeCealLeasedConsumerDispositionControlResponse(response), TypeError, key);
			}
	for (const status of ["lease_lost", "lease_expired", "action_scope_unavailable", "action_scope_mismatch", "capability_unavailable", "authentication_failed"]) {
		assert.equal(decodeCealLeasedConsumerDispositionControlResponse({ schema_version: CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status } }).operation, "call");
	}
	for (const status of ["capability_result_unavailable", "write_unknown", "result_not_replayable", "result_available", "result"]) {
		assert.throws(() => decodeCealLeasedConsumerDispositionControlResponse({ schema_version: CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status } }), TypeError);
	}
	assert.throws(() => decodeCealLeasedConsumerDispositionControlRequest({ schema_version: CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_REQUEST_SCHEMA, operation: "result", input: { ...leaseInput, result_ref: result.result_ref, service_call_ref: "private:one" } }), TypeError);
	assert.throws(() => decodeCealLeasedConsumerDispositionControlResponse({ schema_version: CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_RESPONSE_SCHEMA, operation: "result", result: { status: "result_unavailable", provider_outcome: "verified", result_delivery: "unavailable", result_ref: result.result_ref } }), TypeError);
	for (const leaked of [
		{ raw_response: {} }, { credential: "secret" }, { provider_locator: "C0123456789" }, { provider_url: "https://provider.example" }, { locator: "C0123456789" }, { service_call_ref: "private:one" },
	]) assert.throws(() => decodeCealLeasedConsumerDispositionControlResponse({ schema_version: CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "capability_unavailable", provider_outcome: "not_attempted", result_delivery: "unavailable", ...leaked } }), TypeError);
});
