import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
	CEAL_GATEWAY_WRITE_IDENTITY_FIELDS,
	CEAL_PROTOCOL_VERSION,
	CEAL_GATEWAY_WRITE_IDENTITY_ROLES,
	decodeCealClientResponse,
	isValidCealGatewayWriteIdentitySeparation,
	type CealGatewayWriteReceiptRequest,
} from "../dist/index.js";
import { isErrorWithCode } from "./protocol-test-support.ts";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const WRITE_REQUEST_REF = "gateway-write-request:123e4567-e89b-12d3-a456-426614174000";

function receipt(overrides: Record<string, unknown> = {}) {
	return {
		schema_version: "ceal.gateway_write_request_receipt.v1",
		write_request_sha256: sha256(WRITE_REQUEST_REF),
		source_kind: "authenticated_registered_client",
		source_evidence_sha256: sha256("client-binding"),
		idempotency_claim_sha256: sha256("instance\u0000profile\u0000capability\u0000target\u0000key"),
		normalized_mutation_sha256: sha256("canonical-arguments"),
		provider_state: "outcome_unknown",
		provider_readback: "outcome_unknown",
		...overrides,
	};
}

function readbackResponse(body: unknown) {
	const request: CealGatewayWriteReceiptRequest = { protocol_version: CEAL_PROTOCOL_VERSION, request_id: "request:readback:write-identity", profile_ref: "profile:test", operation: "readback", body: { write_request_ref: WRITE_REQUEST_REF } };
	const response = {
		protocol_version: CEAL_PROTOCOL_VERSION, request_id: request.request_id, ok: true,
		proof_ref_or_unavailable: `proof:${request.request_id}`,
		value: { schema_version: "ceal.gateway_write_receipt_readback.v1", receipt: body },
	};
	return { request, response };
}

test("the three write-identity roles are a table, not three restated names", () => {
	assert.deepEqual([...CEAL_GATEWAY_WRITE_IDENTITY_ROLES], ["replay_identity", "lookup_handle", "collision_evidence"]);
	assert.deepEqual({ ...CEAL_GATEWAY_WRITE_IDENTITY_FIELDS }, {
		replay_identity: "idempotency_claim_sha256",
		lookup_handle: "write_request_sha256",
		collision_evidence: "normalized_mutation_sha256",
	});
	assert.equal(new Set(Object.values(CEAL_GATEWAY_WRITE_IDENTITY_FIELDS)).size, CEAL_GATEWAY_WRITE_IDENTITY_ROLES.length);
});

// The failure this exists to catch is SILENT: a producer that derives the replay
// claim from the per-attempt lookup handle gives every retry a fresh claim, so
// idempotency stops working with no error anywhere — just duplicate provider
// mutations. Equality between two domain-separated SHA-256 digests is never
// chance; it is one derivation reused for two roles.
test("a receipt that collapses two identity roles into one digest is refused", () => {
	assert.equal(isValidCealGatewayWriteIdentitySeparation(receipt()), true);
	const shared = sha256("one-derivation-for-two-roles");
	const collisions = [
		// The lookup handle became a second replay identity.
		{ write_request_sha256: shared, idempotency_claim_sha256: shared },
		// Collision evidence derived from the claim it must be able to contradict.
		{ idempotency_claim_sha256: shared, normalized_mutation_sha256: shared },
		// Collision evidence derived from the per-attempt handle.
		{ write_request_sha256: shared, normalized_mutation_sha256: shared },
		{ write_request_sha256: shared, idempotency_claim_sha256: shared, normalized_mutation_sha256: shared },
	];
	for (const overrides of collisions) {
		assert.equal(isValidCealGatewayWriteIdentitySeparation(receipt(overrides)), false, JSON.stringify(Object.keys(overrides)));
	}
});

test("every identity role must be present and digest-shaped", () => {
	for (const field of Object.values(CEAL_GATEWAY_WRITE_IDENTITY_FIELDS)) {
		assert.equal(isValidCealGatewayWriteIdentitySeparation(receipt({ [field]: undefined })), false, `${field} absent`);
		assert.equal(isValidCealGatewayWriteIdentitySeparation(receipt({ [field]: sha256("x").toUpperCase() })), false, `${field} not lowercase hex`);
		assert.equal(isValidCealGatewayWriteIdentitySeparation(receipt({ [field]: sha256("x").slice(0, 63) })), false, `${field} wrong length`);
	}
});

test("the wire decoder refuses a collapsed receipt at the readback boundary", () => {
	const { request, response } = readbackResponse(receipt());
	assert.deepEqual(decodeCealClientResponse(response, request), response);
	const collapsed = readbackResponse(receipt({ normalized_mutation_sha256: sha256(WRITE_REQUEST_REF) }));
	assert.throws(() => decodeCealClientResponse(collapsed.response, collapsed.request), (error) => isErrorWithCode(error, "invalid_client_response"));
});
