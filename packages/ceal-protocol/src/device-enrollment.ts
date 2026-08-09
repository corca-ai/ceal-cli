import { createHash } from "node:crypto";
import { decodeCealEnrollmentResponse } from "./enrollment.js";
import type { CealEnrollmentResult } from "./enrollment.js";
import { CEAL_PROTOCOL_VERSION } from "./gateway-response-types.js";

export const CEAL_DEVICE_ENROLLMENT_FEATURE = "device_enrollment_sealed_v1" as const;
export const CEAL_DEVICE_ENROLLMENT_APPROVAL_WAIT_FEATURE = "device_enrollment_approval_wait_v1" as const;
export const CEAL_DEVICE_ENROLLMENT_START_SCHEMA = "ceal.device_enrollment_start.v1" as const;
export const CEAL_DEVICE_ENROLLMENT_START_RESULT_SCHEMA = "ceal.device_enrollment_start_result.v1" as const;
export const CEAL_DEVICE_ENROLLMENT_CHALLENGE_REQUEST_SCHEMA = "ceal.device_enrollment_challenge_request.v1" as const;
export const CEAL_DEVICE_ENROLLMENT_CHALLENGE_SCHEMA = "ceal.device_enrollment_challenge.v1" as const;
export const CEAL_DEVICE_ENROLLMENT_POLL_SCHEMA = "ceal.device_enrollment_poll.v1" as const;
export const CEAL_DEVICE_ENROLLMENT_POLL_RESULT_SCHEMA = "ceal.device_enrollment_poll_result.v1" as const;
export const CEAL_DEVICE_ENROLLMENT_PROOF_SUITE = "Ed25519" as const;
export const CEAL_DEVICE_ENROLLMENT_RECIPIENT_SUITE = "X25519" as const;
export const CEAL_DEVICE_ENROLLMENT_PUBLIC_KEY_ENCODING = "raw_32_byte_base64url" as const;
export const CEAL_DEVICE_ENROLLMENT_HPKE_SUITE = "DHKEM(X25519,HKDF-SHA256)/HKDF-SHA256/AES-256-GCM" as const;
export const CEAL_DEVICE_ENROLLMENT_HPKE_INFO_SCHEMA = "ceal.device_enrollment_hpke_info.v1" as const;
export const CEAL_DEVICE_ENROLLMENT_HPKE_AAD_SCHEMA = "ceal.device_enrollment_hpke_aad.v1" as const;

export interface CealDeviceEnrollmentStartRequest {
	schema_version: typeof CEAL_DEVICE_ENROLLMENT_START_SCHEMA;
	email: string;
	proof_suite: typeof CEAL_DEVICE_ENROLLMENT_PROOF_SUITE;
	proof_public_key: string;
	recipient_suite: typeof CEAL_DEVICE_ENROLLMENT_RECIPIENT_SUITE;
	recipient_public_key: string;
	client: {
		name: "ceal";
		version: string;
		protocol_version: typeof CEAL_PROTOCOL_VERSION;
		features: [typeof CEAL_DEVICE_ENROLLMENT_FEATURE] | [typeof CEAL_DEVICE_ENROLLMENT_FEATURE, typeof CEAL_DEVICE_ENROLLMENT_APPROVAL_WAIT_FEATURE];
	};
}

export interface CealDeviceEnrollmentStartResult {
	schema_version: typeof CEAL_DEVICE_ENROLLMENT_START_RESULT_SCHEMA;
	status: "pending";
	transaction_ref: string;
	registration_ref: string;
	gateway_origin: string;
	proof_key_sha256: string;
	recipient_key_sha256: string;
	challenge_handle: string;
	browser_session_url: string;
	challenge: CealDeviceEnrollmentChallenge;
}

export interface CealDeviceEnrollmentChallenge {
	schema_version: typeof CEAL_DEVICE_ENROLLMENT_CHALLENGE_SCHEMA;
	registration_ref: string;
	nonce_ref: string;
	nonce: string;
	gateway_origin: string;
	proof_suite: typeof CEAL_DEVICE_ENROLLMENT_PROOF_SUITE;
	protocol_version: typeof CEAL_PROTOCOL_VERSION;
	expires_at: string;
}

/**
 * A non-enumerating request for an additional independent proof nonce. Gateway
 * never invalidates another unexpired nonce for this transaction from this call.
 */
export interface CealDeviceEnrollmentChallengeRequest {
	schema_version: typeof CEAL_DEVICE_ENROLLMENT_CHALLENGE_REQUEST_SCHEMA;
	registration_ref: string;
	challenge_handle: string;
}

export interface CealDeviceEnrollmentPollRequest {
	schema_version: typeof CEAL_DEVICE_ENROLLMENT_POLL_SCHEMA;
	registration_ref: string;
	nonce_ref: string;
	signature: string;
}

/** Public, non-secret context which the HPKE AAD binds to this exact delivery. */
export interface CealDeviceEnrollmentDeliveryBinding {
	gateway_origin: string;
	protocol_version: typeof CEAL_PROTOCOL_VERSION;
	feature: typeof CEAL_DEVICE_ENROLLMENT_FEATURE;
	transaction_ref: string;
	registration_ref: string;
	profile_ref: string;
	membership_ref: string;
	client_ref: string;
	subject_ref: string;
	instance_ref: string;
	policy_ref: string;
	policy_version: number;
	session_family_ref: string;
	proof_key_sha256: string;
	recipient_key_sha256: string;
	delivery_generation: number;
	expires_at: string;
}

/** Locally retained, non-secret facts that a client must match before opening a sealed delivery. */
export interface CealDeviceEnrollmentDeliveryExpectation {
	gateway_origin: string;
	protocol_version: typeof CEAL_PROTOCOL_VERSION;
	transaction_ref: string;
	registration_ref: string;
	proof_public_key: string;
	recipient_public_key: string;
}

/** Configured Gateway facts the client checks before opening the verifier URL or signing a challenge. */
export interface CealDeviceEnrollmentStartExpectation {
	gateway_origin: string;
	protocol_version: typeof CEAL_PROTOCOL_VERSION;
	proof_public_key: string;
	recipient_public_key: string;
}

export type CealDeviceEnrollmentPollResponse =
	| { schema_version: typeof CEAL_DEVICE_ENROLLMENT_POLL_RESULT_SCHEMA; status: "pending"; retry_after_ms: number }
	| { schema_version: typeof CEAL_DEVICE_ENROLLMENT_POLL_RESULT_SCHEMA; status: "approval_required"; retry_after_ms: number }
	| {
		schema_version: typeof CEAL_DEVICE_ENROLLMENT_POLL_RESULT_SCHEMA;
		status: "sealed";
		suite: typeof CEAL_DEVICE_ENROLLMENT_HPKE_SUITE;
		binding: CealDeviceEnrollmentDeliveryBinding;
		encapsulated_key: string;
		ciphertext: string;
	}
	| { schema_version: typeof CEAL_DEVICE_ENROLLMENT_POLL_RESULT_SCHEMA; status: "failed"; code: "unsupported_feature" | "recovery_required" | "expired" };

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/u;
const BASE64URL_64_BYTES = /^[A-Za-z0-9_-]{86}$/u;
const BASE64URL_CIPHERTEXT = /^[A-Za-z0-9_-]{23,32768}$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SEMVER = /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/u;

export function decodeCealDeviceEnrollmentStartRequest(value: unknown): CealDeviceEnrollmentStartRequest {
	const record = requireRecord(value);
	requireExactKeys(record, ["client", "email", "proof_public_key", "proof_suite", "recipient_public_key", "recipient_suite", "schema_version"]);
	const client = requireRecord(record.client);
	requireExactKeys(client, ["features", "name", "protocol_version", "version"]);
	if (!validStartRequest(record, client)) invalid();
	return record as unknown as CealDeviceEnrollmentStartRequest;
}

export function decodeCealDeviceEnrollmentStartResult(value: unknown): CealDeviceEnrollmentStartResult {
	const record = requireRecord(value);
	requireExactKeys(record, ["browser_session_url", "challenge", "challenge_handle", "gateway_origin", "proof_key_sha256", "recipient_key_sha256", "registration_ref", "schema_version", "status", "transaction_ref"]);
	if (!validStartResult(record)) invalid();
	const challenge = decodeCealDeviceEnrollmentChallenge(record.challenge);
	if (challenge.registration_ref !== record.registration_ref || challenge.gateway_origin !== record.gateway_origin
		|| !safeBrowserSessionUrl(record.browser_session_url, record.gateway_origin)) invalid();
	return record as unknown as CealDeviceEnrollmentStartResult;
}

export function decodeCealDeviceEnrollmentChallenge(value: unknown): CealDeviceEnrollmentChallenge {
	const record = requireRecord(value);
	requireExactKeys(record, ["expires_at", "gateway_origin", "nonce", "nonce_ref", "proof_suite", "protocol_version", "registration_ref", "schema_version"]);
	if (record.schema_version !== CEAL_DEVICE_ENROLLMENT_CHALLENGE_SCHEMA || !safeRef(record.registration_ref)
		|| !safeRef(record.nonce_ref) || !publicKey(record.nonce) || !safeHttpsOrigin(record.gateway_origin)
		|| record.proof_suite !== CEAL_DEVICE_ENROLLMENT_PROOF_SUITE || record.protocol_version !== CEAL_PROTOCOL_VERSION || !timestamp(record.expires_at)) invalid();
	return record as unknown as CealDeviceEnrollmentChallenge;
}

export function decodeCealDeviceEnrollmentChallengeRequest(value: unknown): CealDeviceEnrollmentChallengeRequest {
	const record = requireRecord(value);
	requireExactKeys(record, ["challenge_handle", "registration_ref", "schema_version"]);
	if (record.schema_version !== CEAL_DEVICE_ENROLLMENT_CHALLENGE_REQUEST_SCHEMA || !safeRef(record.registration_ref) || !opaqueHandle(record.challenge_handle)) invalid();
	return record as unknown as CealDeviceEnrollmentChallengeRequest;
}

export function decodeCealDeviceEnrollmentPollRequest(value: unknown): CealDeviceEnrollmentPollRequest {
	const record = requireRecord(value);
	requireExactKeys(record, ["nonce_ref", "registration_ref", "schema_version", "signature"]);
	if (record.schema_version !== CEAL_DEVICE_ENROLLMENT_POLL_SCHEMA || !safeRef(record.registration_ref)
		|| !safeRef(record.nonce_ref) || typeof record.signature !== "string" || !BASE64URL_64_BYTES.test(record.signature)) invalid();
	return record as unknown as CealDeviceEnrollmentPollRequest;
}

export function decodeCealDeviceEnrollmentPollResponse(value: unknown): CealDeviceEnrollmentPollResponse {
	const record = requireRecord(value);
	if (record.schema_version !== CEAL_DEVICE_ENROLLMENT_POLL_RESULT_SCHEMA || typeof record.status !== "string") invalid();
	return decodePollResult(record);
}

/** Canonical Ed25519 proof payload; Gateway and client sign/verify these UTF-8 bytes exactly. */
export function deviceEnrollmentProofPayload(challenge: CealDeviceEnrollmentChallenge): Uint8Array {
	const decoded = decodeCealDeviceEnrollmentChallenge(challenge);
	return encodeCanonical(["ceal.device_enrollment_proof.v1", decoded.proof_suite, decoded.protocol_version,
		decoded.gateway_origin, decoded.registration_ref, decoded.nonce_ref, decoded.nonce]);
}

/** SHA-256 fingerprint of a raw 32-byte base64url public key, rendered as lower-case hexadecimal. */
export function deviceEnrollmentPublicKeyFingerprint(publicKey: string): string {
	if (!publicKeyValue(publicKey)) invalid();
	return createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("hex");
}

/** Canonical HPKE info. It binds the KEM context to this protocol and recipient key. */
export function deviceEnrollmentHpkeInfo(binding: CealDeviceEnrollmentDeliveryBinding): Uint8Array {
	const decoded = decodeCealDeviceEnrollmentDeliveryBinding(binding);
	return encodeCanonical([CEAL_DEVICE_ENROLLMENT_HPKE_INFO_SCHEMA, decoded.gateway_origin, decoded.protocol_version,
		decoded.feature, decoded.registration_ref, decoded.recipient_key_sha256]);
}

/** Canonical HPKE AEAD AAD. Gateway seals and ceal opens these UTF-8 bytes exactly. */
export function deviceEnrollmentHpkeAssociatedData(binding: CealDeviceEnrollmentDeliveryBinding): Uint8Array {
	const decoded = decodeCealDeviceEnrollmentDeliveryBinding(binding);
	return encodeCanonical([CEAL_DEVICE_ENROLLMENT_HPKE_AAD_SCHEMA, decoded.gateway_origin, decoded.protocol_version,
		decoded.feature, decoded.transaction_ref, decoded.registration_ref, decoded.profile_ref, decoded.membership_ref,
		decoded.client_ref, decoded.subject_ref, decoded.instance_ref, decoded.policy_ref, decoded.policy_version,
		decoded.session_family_ref, decoded.proof_key_sha256, decoded.recipient_key_sha256,
		decoded.delivery_generation, decoded.expires_at]);
}

/** The decrypted sealed plaintext is the existing successful enrollment result, never a new token shape. */
export function decodeCealDeviceEnrollmentSealedPayload(value: unknown): CealEnrollmentResult {
	const enrollment = decodeCealEnrollmentResponse(value);
	if (!enrollment.ok) invalid();
	return enrollment;
}

/** Reject a correctly decrypted payload if its durable identity differs from the authenticated AAD binding. */
export function assertCealDeviceEnrollmentSealedPayloadBinding(
	binding: CealDeviceEnrollmentDeliveryBinding,
	payload: CealEnrollmentResult,
): void {
	const decodedBinding = decodeCealDeviceEnrollmentDeliveryBinding(binding);
	const decodedPayload = decodeCealDeviceEnrollmentSealedPayload(payload);
	for (const key of ["registration_ref", "profile_ref", "membership_ref", "client_ref", "subject_ref", "instance_ref"] as const) {
		if (decodedBinding[key] !== decodedPayload[key]) invalid();
	}
}

/** Reject a delivery before decryption when it does not belong to this Gateway, transaction, and local device keys. */
export function assertCealDeviceEnrollmentDeliveryExpectation(
	binding: CealDeviceEnrollmentDeliveryBinding,
	expected: CealDeviceEnrollmentDeliveryExpectation,
): void {
	const decodedBinding = decodeCealDeviceEnrollmentDeliveryBinding(binding);
	if (!validDeliveryExpectation(expected) || !matchingDeliveryExpectation(decodedBinding, expected)) invalid();
}

/** The client must call this before it opens `browser_session_url` or signs the challenge. */
export function assertCealDeviceEnrollmentStartExpectation(
	result: CealDeviceEnrollmentStartResult,
	expected: CealDeviceEnrollmentStartExpectation,
): void {
	const decodedResult = decodeCealDeviceEnrollmentStartResult(result);
	if (!safeHttpsOrigin(expected.gateway_origin) || expected.protocol_version !== CEAL_PROTOCOL_VERSION
		|| !publicKey(expected.proof_public_key) || !publicKey(expected.recipient_public_key)
		|| decodedResult.gateway_origin !== expected.gateway_origin || decodedResult.challenge.gateway_origin !== expected.gateway_origin
		|| decodedResult.challenge.protocol_version !== expected.protocol_version
		|| decodedResult.proof_key_sha256 !== deviceEnrollmentPublicKeyFingerprint(expected.proof_public_key)
		|| decodedResult.recipient_key_sha256 !== deviceEnrollmentPublicKeyFingerprint(expected.recipient_public_key)) invalid();
}

export function decodeCealDeviceEnrollmentDeliveryBinding(value: unknown): CealDeviceEnrollmentDeliveryBinding {
	const record = requireRecord(value);
	requireExactKeys(record, ["client_ref", "delivery_generation", "expires_at", "feature", "gateway_origin", "instance_ref", "membership_ref", "policy_ref", "policy_version", "profile_ref", "proof_key_sha256", "protocol_version", "recipient_key_sha256", "registration_ref", "session_family_ref", "subject_ref", "transaction_ref"]);
	if (!validDeliveryBinding(record)) invalid();
	return record as unknown as CealDeviceEnrollmentDeliveryBinding;
}

function requireRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
	return value as Record<string, unknown>;
}
function validStartRequest(record: Record<string, unknown>, client: Record<string, unknown>): boolean {
	return record.schema_version === CEAL_DEVICE_ENROLLMENT_START_SCHEMA && validStartIdentity(record) && validStartClient(client);
}
function validStartIdentity(record: Record<string, unknown>): boolean {
	return validEmail(record.email) && record.proof_suite === CEAL_DEVICE_ENROLLMENT_PROOF_SUITE
		&& record.recipient_suite === CEAL_DEVICE_ENROLLMENT_RECIPIENT_SUITE && publicKey(record.proof_public_key)
		&& publicKey(record.recipient_public_key) && record.proof_public_key !== record.recipient_public_key;
}
function validStartResult(record: Record<string, unknown>): boolean {
	return record.schema_version === CEAL_DEVICE_ENROLLMENT_START_RESULT_SCHEMA && record.status === "pending"
		&& validStartResultBinding(record) && opaqueHandle(record.challenge_handle);
}
function validStartResultBinding(record: Record<string, unknown>): boolean {
	return safeRef(record.transaction_ref) && safeRef(record.registration_ref) && safeHttpsOrigin(record.gateway_origin)
		&& sha256(record.proof_key_sha256) && sha256(record.recipient_key_sha256);
}
function validStartClient(client: Record<string, unknown>): boolean {
	return client.name === "ceal" && semver(client.version) && client.protocol_version === CEAL_PROTOCOL_VERSION
		&& Array.isArray(client.features) && (sameFeatures(client.features, [CEAL_DEVICE_ENROLLMENT_FEATURE])
			|| sameFeatures(client.features, [CEAL_DEVICE_ENROLLMENT_FEATURE, CEAL_DEVICE_ENROLLMENT_APPROVAL_WAIT_FEATURE]));
}
function sameFeatures(actual: unknown[], expected: readonly string[]): boolean { return actual.length === expected.length && actual.every((value, index) => value === expected[index]); }
function decodePollResult(record: Record<string, unknown>): CealDeviceEnrollmentPollResponse {
	switch (record.status) {
		case "pending": return decodePendingPollResult(record);
		case "approval_required": return decodeApprovalRequiredPollResult(record);
		case "sealed": return decodeSealedPollResult(record);
		case "failed": return decodeFailedPollResult(record);
		default: return invalid();
	}
}
function decodeApprovalRequiredPollResult(record: Record<string, unknown>): CealDeviceEnrollmentPollResponse {
	requireExactKeys(record, ["retry_after_ms", "schema_version", "status"]);
	if (typeof record.retry_after_ms !== "number" || !Number.isSafeInteger(record.retry_after_ms)
		|| record.retry_after_ms < 1000 || record.retry_after_ms > 30_000) invalid();
	return record as unknown as CealDeviceEnrollmentPollResponse;
}
function decodePendingPollResult(record: Record<string, unknown>): CealDeviceEnrollmentPollResponse {
	requireExactKeys(record, ["retry_after_ms", "schema_version", "status"]);
	if (typeof record.retry_after_ms !== "number" || !Number.isSafeInteger(record.retry_after_ms)
		|| record.retry_after_ms < 1000 || record.retry_after_ms > 30_000) invalid();
	return record as unknown as CealDeviceEnrollmentPollResponse;
}
function decodeSealedPollResult(record: Record<string, unknown>): CealDeviceEnrollmentPollResponse {
	requireExactKeys(record, ["binding", "ciphertext", "encapsulated_key", "schema_version", "status", "suite"]);
	if (record.suite !== CEAL_DEVICE_ENROLLMENT_HPKE_SUITE || !publicKey(record.encapsulated_key)
		|| typeof record.ciphertext !== "string" || !canonicalBase64url(record.ciphertext, BASE64URL_CIPHERTEXT)) invalid();
	decodeCealDeviceEnrollmentDeliveryBinding(record.binding);
	return record as unknown as CealDeviceEnrollmentPollResponse;
}
function decodeFailedPollResult(record: Record<string, unknown>): CealDeviceEnrollmentPollResponse {
	requireExactKeys(record, ["code", "schema_version", "status"]);
	if (!new Set(["unsupported_feature", "recovery_required", "expired"]).has(String(record.code))) invalid();
	return record as unknown as CealDeviceEnrollmentPollResponse;
}
function validDeliveryRefs(record: Record<string, unknown>): boolean {
	return ["transaction_ref", "registration_ref", "profile_ref", "membership_ref", "client_ref", "subject_ref", "instance_ref", "policy_ref", "session_family_ref"]
		.every((key) => safeRef(record[key]));
}
function validDeliveryBinding(record: Record<string, unknown>): boolean {
	return validDeliveryContext(record) && validDeliveryRefs(record) && validDeliveryKeyBinding(record)
		&& positiveInteger(record.policy_version) && positiveInteger(record.delivery_generation) && timestamp(record.expires_at);
}
function validDeliveryContext(record: Record<string, unknown>): boolean {
	return safeHttpsOrigin(record.gateway_origin) && record.protocol_version === CEAL_PROTOCOL_VERSION && record.feature === CEAL_DEVICE_ENROLLMENT_FEATURE;
}
function validDeliveryKeyBinding(record: Record<string, unknown>): boolean {
	return sha256(record.proof_key_sha256) && sha256(record.recipient_key_sha256);
}
function validDeliveryExpectation(expected: CealDeviceEnrollmentDeliveryExpectation): boolean {
	return safeHttpsOrigin(expected.gateway_origin) && expected.protocol_version === CEAL_PROTOCOL_VERSION
		&& safeRef(expected.transaction_ref) && safeRef(expected.registration_ref)
		&& publicKey(expected.proof_public_key) && publicKey(expected.recipient_public_key);
}
function matchingDeliveryExpectation(binding: CealDeviceEnrollmentDeliveryBinding, expected: CealDeviceEnrollmentDeliveryExpectation): boolean {
	return binding.gateway_origin === expected.gateway_origin && binding.protocol_version === expected.protocol_version
		&& binding.transaction_ref === expected.transaction_ref && binding.registration_ref === expected.registration_ref
		&& binding.proof_key_sha256 === deviceEnrollmentPublicKeyFingerprint(expected.proof_public_key)
		&& binding.recipient_key_sha256 === deviceEnrollmentPublicKeyFingerprint(expected.recipient_public_key);
}
function requireExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
	if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...expected].sort())) invalid();
}
function safeRef(value: unknown): value is string { return typeof value === "string" && SAFE_REF.test(value); }
function publicKey(value: unknown): value is string { return typeof value === "string" && publicKeyValue(value); }
function publicKeyValue(value: string): boolean {
	const decoded = canonicalBase64url(value, BASE64URL_32_BYTES);
	return decoded !== null && !decoded.every((byte) => byte === 0);
}
function canonicalBase64url(value: string, pattern: RegExp): Buffer | null {
	if (!pattern.test(value)) return null;
	const decoded = Buffer.from(value, "base64url");
	return decoded.toString("base64url") === value ? decoded : null;
}
function opaqueHandle(value: unknown): value is string { return typeof value === "string" && BASE64URL_32_BYTES.test(value); }
function sha256(value: unknown): value is string { return typeof value === "string" && SHA256_HEX.test(value); }
function semver(value: unknown): value is string { return typeof value === "string" && SEMVER.test(value); }
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function timestamp(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$/u.test(value)) return false;
	const parsed = new Date(value);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function validEmail(value: unknown): value is string { return typeof value === "string" && value.length <= 320 && /^[^\s@]+@[^\s@]+$/u.test(value); }
function safeHttpsOrigin(value: unknown): value is string {
	try { const url = new URL(String(value)); return url.protocol === "https:" && !url.username && !url.password && !url.pathname.replace(/\/$/u, "") && !url.search && !url.hash; } catch { return false; }
}
function safeBrowserSessionUrl(value: unknown, gatewayOrigin: unknown): value is string {
	try { const url = new URL(String(value)); return url.origin === gatewayOrigin && url.protocol === "https:" && !url.username && !url.password && url.pathname.length > 1 && !url.search; } catch { return false; }
}
function encodeCanonical(parts: readonly (string | number)[]): Uint8Array { return new TextEncoder().encode(JSON.stringify(parts)); }
function invalid(): never { throw new TypeError("Invalid Ceal device enrollment message."); }
