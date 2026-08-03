import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import test from "node:test";
import {
	CEAL_DEVICE_ENROLLMENT_FEATURE,
	CEAL_DEVICE_ENROLLMENT_APPROVAL_WAIT_FEATURE,
	CEAL_DEVICE_ENROLLMENT_CHALLENGE_REQUEST_SCHEMA,
	CEAL_DEVICE_ENROLLMENT_HPKE_SUITE,
	CEAL_DEVICE_ENROLLMENT_PROOF_SUITE,
	CEAL_DEVICE_ENROLLMENT_RECIPIENT_SUITE,
	assertCealDeviceEnrollmentSealedPayloadBinding,
	assertCealDeviceEnrollmentDeliveryExpectation,
	assertCealDeviceEnrollmentStartExpectation,
	decodeCealDeviceEnrollmentChallenge,
	decodeCealDeviceEnrollmentChallengeRequest,
	decodeCealDeviceEnrollmentPollRequest,
	decodeCealDeviceEnrollmentPollResponse,
	decodeCealDeviceEnrollmentSealedPayload,
	decodeCealDeviceEnrollmentStartRequest,
	decodeCealDeviceEnrollmentStartResult,
	deviceEnrollmentHpkeAssociatedData,
	deviceEnrollmentHpkeInfo,
	deviceEnrollmentProofPayload,
	deviceEnrollmentPublicKeyFingerprint,
} from "../dist/index.js";

const { privateKey: proofPrivateKey, publicKey: proofPublicKey } = generateKeyPairSync("ed25519");
const { publicKey: recipientPublicKey } = generateKeyPairSync("x25519");
const PROOF_KEY = proofPublicKey.export({ format: "jwk" }).x;
const RECIPIENT_KEY = recipientPublicKey.export({ format: "jwk" }).x;
const NONCE = "qoI8FzONCv0y1G9ZgjVzcvQGuQ6lFzP-k6XPwHWE5UQ";
const binding = {
	gateway_origin: "https://ceal.example.test",
	protocol_version: "1.3.0",
	feature: CEAL_DEVICE_ENROLLMENT_FEATURE,
	transaction_ref: "transaction:device-1",
	registration_ref: "registration:device-1",
	profile_ref: "profile:work",
	membership_ref: "membership:employee-1",
	client_ref: "client:macbook",
	subject_ref: "subject:employee-1",
	instance_ref: "instance:ceal-prod",
	policy_ref: "policy:employee-default",
	policy_version: 1,
	session_family_ref: "session-family:device-1",
	proof_key_sha256: deviceEnrollmentPublicKeyFingerprint(PROOF_KEY),
	recipient_key_sha256: deviceEnrollmentPublicKeyFingerprint(RECIPIENT_KEY),
	delivery_generation: 1,
	expires_at: "2026-07-28T12:00:00.000Z",
};
const challenge = {
	schema_version: "ceal.device_enrollment_challenge.v1",
	registration_ref: binding.registration_ref,
	nonce_ref: "nonce:device-1",
	nonce: NONCE,
	gateway_origin: binding.gateway_origin,
	proof_suite: CEAL_DEVICE_ENROLLMENT_PROOF_SUITE,
	protocol_version: binding.protocol_version,
	expires_at: binding.expires_at,
};

test("device enrollment start names raw-key algorithms and embeds the required poll challenge", () => {
	const startRequest = decodeCealDeviceEnrollmentStartRequest({
		schema_version: "ceal.device_enrollment_start.v1",
		email: "employee@example.test",
		proof_suite: CEAL_DEVICE_ENROLLMENT_PROOF_SUITE,
		proof_public_key: PROOF_KEY,
		recipient_suite: CEAL_DEVICE_ENROLLMENT_RECIPIENT_SUITE,
		recipient_public_key: RECIPIENT_KEY,
		client: { name: "ceal", version: "0.70.0", protocol_version: binding.protocol_version, features: [CEAL_DEVICE_ENROLLMENT_FEATURE] },
	});
	assert.equal(startRequest.client.features[0], CEAL_DEVICE_ENROLLMENT_FEATURE);
	assert.deepEqual(decodeCealDeviceEnrollmentStartRequest({ ...startRequest, client: { ...startRequest.client, features: [CEAL_DEVICE_ENROLLMENT_FEATURE, CEAL_DEVICE_ENROLLMENT_APPROVAL_WAIT_FEATURE] } }).client.features, [CEAL_DEVICE_ENROLLMENT_FEATURE, CEAL_DEVICE_ENROLLMENT_APPROVAL_WAIT_FEATURE]);
	assert.throws(() => decodeCealDeviceEnrollmentStartRequest({ ...startRequest, client: { ...startRequest.client, features: [CEAL_DEVICE_ENROLLMENT_APPROVAL_WAIT_FEATURE, CEAL_DEVICE_ENROLLMENT_FEATURE] } }), TypeError);
	assert.throws(() => decodeCealDeviceEnrollmentStartRequest({ ...startRequest, recipient_public_key: startRequest.proof_public_key }), TypeError);
	assert.throws(() => decodeCealDeviceEnrollmentStartRequest({ ...startRequest, recipient_public_key: "A".repeat(43) }), TypeError);
	assert.throws(() => decodeCealDeviceEnrollmentStartRequest({ ...startRequest, client: { ...startRequest.client, protocol_version: "1.2.0" } }), TypeError);
	assert.equal(decodeCealDeviceEnrollmentStartResult({
		schema_version: "ceal.device_enrollment_start_result.v1", status: "pending",
		transaction_ref: binding.transaction_ref, registration_ref: binding.registration_ref, gateway_origin: binding.gateway_origin,
		proof_key_sha256: binding.proof_key_sha256, recipient_key_sha256: binding.recipient_key_sha256,
		challenge_handle: "H".repeat(43), browser_session_url: "https://ceal.example.test/device/session#opaque", challenge,
	}).challenge.nonce_ref, challenge.nonce_ref);
	assert.deepEqual(decodeCealDeviceEnrollmentChallengeRequest({
		schema_version: CEAL_DEVICE_ENROLLMENT_CHALLENGE_REQUEST_SCHEMA, registration_ref: binding.registration_ref, challenge_handle: "H".repeat(43),
	}), { schema_version: CEAL_DEVICE_ENROLLMENT_CHALLENGE_REQUEST_SCHEMA, registration_ref: binding.registration_ref, challenge_handle: "H".repeat(43) });
	const start = {
		schema_version: "ceal.device_enrollment_start_result.v1", status: "pending", transaction_ref: binding.transaction_ref, registration_ref: binding.registration_ref,
		gateway_origin: binding.gateway_origin, proof_key_sha256: binding.proof_key_sha256, recipient_key_sha256: binding.recipient_key_sha256,
		challenge_handle: "H".repeat(43), browser_session_url: "https://ceal.example.test/device/session#opaque", challenge,
	};
	const startExpectation = { gateway_origin: binding.gateway_origin, protocol_version: binding.protocol_version, proof_public_key: PROOF_KEY, recipient_public_key: RECIPIENT_KEY };
	assert.doesNotThrow(() => assertCealDeviceEnrollmentStartExpectation(start, startExpectation));
	assert.throws(() => assertCealDeviceEnrollmentStartExpectation({ ...start, gateway_origin: "https://evil.example.test", browser_session_url: "https://evil.example.test/device/session#opaque", challenge: { ...challenge, gateway_origin: "https://evil.example.test" } }, startExpectation), TypeError);
	assert.throws(() => assertCealDeviceEnrollmentStartExpectation({ ...start, recipient_key_sha256: "a".repeat(64) }, startExpectation), TypeError);
	assert.throws(() => decodeCealDeviceEnrollmentStartResult({
		schema_version: "ceal.device_enrollment_start_result.v1", status: "pending",
		transaction_ref: binding.transaction_ref, registration_ref: binding.registration_ref, gateway_origin: binding.gateway_origin,
		proof_key_sha256: binding.proof_key_sha256, recipient_key_sha256: binding.recipient_key_sha256,
		challenge_handle: "H".repeat(43), browser_session_url: "https://evil.example.test/device/session#opaque", challenge,
	}), TypeError);
});

test("Ed25519 proof payload has a fixed wire encoding and verifies with the declared proof key", () => {
	const decoded = decodeCealDeviceEnrollmentChallenge(challenge);
	const payload = deviceEnrollmentProofPayload(decoded);
	assert.equal(Buffer.from(payload).toString("utf8"), JSON.stringify([
		"ceal.device_enrollment_proof.v1", "Ed25519", "1.3.0", "https://ceal.example.test", "registration:device-1", "nonce:device-1", NONCE,
	]));
	const signature = sign(null, payload, proofPrivateKey);
	assert.equal(verify(null, payload, proofPublicKey, signature), true);
	assert.equal(decodeCealDeviceEnrollmentPollRequest({
		schema_version: "ceal.device_enrollment_poll.v1", registration_ref: binding.registration_ref,
		nonce_ref: challenge.nonce_ref, signature: signature.toString("base64url"),
	}).nonce_ref, challenge.nonce_ref);
	assert.throws(() => decodeCealDeviceEnrollmentChallenge({ ...challenge, gateway_origin: "http://ceal.example.test" }), TypeError);
});

test("device enrollment exposes a bounded non-terminal additional-device approval wait", () => {
	assert.deepEqual(decodeCealDeviceEnrollmentPollResponse({
		schema_version: "ceal.device_enrollment_poll_result.v1", status: "approval_required", retry_after_ms: 10_000,
	}), { schema_version: "ceal.device_enrollment_poll_result.v1", status: "approval_required", retry_after_ms: 10_000 });
	assert.throws(() => decodeCealDeviceEnrollmentPollResponse({
		schema_version: "ceal.device_enrollment_poll_result.v1", status: "approval_required", retry_after_ms: 999,
	}), TypeError);
});

test("sealed delivery binds canonical HPKE info/AAD and rejects a decrypted identity mismatch", () => {
	assert.equal(Buffer.from(deviceEnrollmentHpkeInfo(binding)).toString("utf8"), JSON.stringify([
		"ceal.device_enrollment_hpke_info.v1", binding.gateway_origin, binding.protocol_version,
		binding.feature, binding.registration_ref, binding.recipient_key_sha256,
	]));
	assert.equal(Buffer.from(deviceEnrollmentHpkeAssociatedData(binding)).toString("utf8"), JSON.stringify([
		"ceal.device_enrollment_hpke_aad.v1", binding.gateway_origin, binding.protocol_version,
		binding.feature, binding.transaction_ref, binding.registration_ref, binding.profile_ref, binding.membership_ref,
		binding.client_ref, binding.subject_ref, binding.instance_ref, binding.policy_ref, binding.policy_version,
		binding.session_family_ref, binding.proof_key_sha256, binding.recipient_key_sha256, 1, binding.expires_at,
	]));
	const sealed = decodeCealDeviceEnrollmentPollResponse({
		schema_version: "ceal.device_enrollment_poll_result.v1", status: "sealed", suite: CEAL_DEVICE_ENROLLMENT_HPKE_SUITE,
		binding, encapsulated_key: RECIPIENT_KEY, ciphertext: "D".repeat(23),
	});
	assert.equal(sealed.status, "sealed");
	const payload = decodeCealDeviceEnrollmentSealedPayload({
		schema_version: "ceal.enrollment_result.v1", ok: true,
		profile_ref: binding.profile_ref, membership_ref: binding.membership_ref, registration_ref: binding.registration_ref,
		client_ref: binding.client_ref, subject_ref: binding.subject_ref, instance_ref: binding.instance_ref,
		access_token: `ceal_personal_${"P".repeat(43)}`, expires_at: binding.expires_at,
		refresh_token: `ceal_refresh_${"R".repeat(43)}`,
		refresh_token_idle_expires_at: binding.expires_at, refresh_token_absolute_expires_at: binding.expires_at,
	});
	assert.doesNotThrow(() => assertCealDeviceEnrollmentSealedPayloadBinding(binding, payload));
	assert.doesNotThrow(() => assertCealDeviceEnrollmentDeliveryExpectation(binding, {
		gateway_origin: binding.gateway_origin, protocol_version: binding.protocol_version, transaction_ref: binding.transaction_ref, registration_ref: binding.registration_ref,
		proof_public_key: PROOF_KEY, recipient_public_key: RECIPIENT_KEY,
	}));
	assert.throws(() => assertCealDeviceEnrollmentDeliveryExpectation(binding, {
		gateway_origin: "https://evil.example.test", protocol_version: binding.protocol_version, transaction_ref: binding.transaction_ref, registration_ref: binding.registration_ref,
		proof_public_key: PROOF_KEY, recipient_public_key: RECIPIENT_KEY,
	}), TypeError);
	assert.throws(() => assertCealDeviceEnrollmentSealedPayloadBinding({ ...binding, client_ref: "client:other" }, payload), TypeError);
	assert.throws(() => decodeCealDeviceEnrollmentPollResponse({ ...sealed, access_token: "must-not-appear" }), TypeError);
});
