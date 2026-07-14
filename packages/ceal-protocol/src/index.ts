import { CEAL_GATEWAY_POLICY_DENIAL_MESSAGE, CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION } from "./gateway-response-types.js";
import type { CealGatewayMessageSearchCoverage, CealGatewayPolicyDenial, CealGatewayResponseFor } from "./gateway-response-types.js";
import { CEAL_PROTOCOL_VERSION } from "./gateway-response-types.js";
import { negotiateCealProtocol, parseProtocolVersion } from "./protocol-negotiation.js";
import type { CealClientFailure, CealClientOperation, CealClientSuccess, CealGatewayCallRequest, CealGatewayDiscoverRequest, CealGatewayHandshakeRequest, CealGatewayReadbackRequest, CealGatewayRequest } from "./gateway-response-types.js";
import {
	validateMessageGetResult,
	validateMessageSearchInputContract,
	validateMessageSearchResult,
} from "./gateway-message-contract.js";

export {
	CEAL_GATEWAY_POLICY_DENIAL_MESSAGE,
	CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION,
} from "./gateway-response-types.js";
export {
	CEAL_ENROLLMENT_EXCHANGE_SCHEMA,
	CEAL_ENROLLMENT_CREATE_SCHEMA,
	CEAL_ENROLLMENT_CREATE_RESULT_SCHEMA,
	CEAL_ENROLLMENT_RESULT_SCHEMA,
	decodeCealEnrollmentCreateRequest,
	decodeCealEnrollmentCreateResult,
	decodeCealEnrollmentExchangeRequest,
	decodeCealEnrollmentResponse,
} from "./enrollment.js";
export type {
	CealEnrollmentExchangeRequest,
	CealEnrollmentCreateRequest,
	CealEnrollmentCreateResult,
	CealEnrollmentFailure,
	CealEnrollmentResponse,
	CealEnrollmentResult,
} from "./enrollment.js";
export {
	CEAL_CLIENT_REFRESH_REQUEST_SCHEMA,
	CEAL_CLIENT_REFRESH_RESULT_SCHEMA,
	CEAL_CLIENT_REVOKE_REQUEST_SCHEMA,
	CEAL_CLIENT_REVOKE_RESULT_SCHEMA,
	decodeCealClientRefreshRequest,
	decodeCealClientRefreshResponse,
	decodeCealClientRevokeRequest,
	decodeCealClientRevokeResponse,
} from "./personal-client-session.js";
export type {
	CealClientRefreshRequest,
	CealClientRefreshResponse,
	CealClientRefreshResult,
	CealClientRevokeRequest,
	CealClientRevokeResponse,
	CealClientRevokeResult,
	CealClientSessionFailure,
} from "./personal-client-session.js";
export type {
	CealGatewayAuditEvent,
	CealGatewayAuthorizationSnapshot,
	CealGatewayAuditCallDetail,
	CealGatewayAuditReadbackValue,
	CealGatewayCallValue,
	CealGatewayDiscoveryCapability,
	CealGatewayDiscoveryTarget,
	CealGatewayDiscoveryValue,
	CealGatewayHandshakeValue,
	CealGatewayHostNonClaim,
	CealGatewayHostNonClaims,
	CealGatewayMessageSearchResult,
	CealGatewayMessageSearchCallValue,
	CealGatewayMessageSearchCoverage,
	CealGatewayMessageSearchResultItem,
	CealCapabilityAccessDescriptor,
	CealCapabilityReadiness,
	CealGatewayPolicyDenial,
	CealGatewayPolicyDenialDecision,
	CealGatewayRequestForInput,
	CealGatewayRequestInput,
	CealGatewayResponseFor,
} from "./gateway-response-types.js";
export { CEAL_PROTOCOL_VERSION } from "./gateway-response-types.js";
export { CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE, negotiateCealProtocol } from "./protocol-negotiation.js";
export type {
	CealProtocolNegotiation,
	CealProtocolNegotiationFailure,
	CealProtocolNegotiationSuccess,
} from "./protocol-negotiation.js";
export type {
	CealClientFailure,
	CealClientOperation,
	CealClientRequest,
	CealClientSuccess,
	CealGatewayCallRequest,
	CealGatewayDiscoverRequest,
	CealGatewayHandshakeRequest,
	CealGatewayReadbackRequest,
	CealGatewayRequest,
	CealProofReferenceOrUnavailable,
	CealProofUnavailable,
	CealProtocolRange,
} from "./gateway-response-types.js";

export const GOVERNED_RUNNER_CORPUS_SCHEMA = "ceal.governed_runner_conformance_corpus.v1" as const;
export const GOVERNED_RUNNER_CORPUS_VERSION = "1.0.0" as const;

export type CealClientResponse<TValue = unknown> = CealClientSuccess<TValue> | CealGatewayPolicyDenial | CealClientFailure;

export type GovernedRunnerConformanceKind =
	| "runner_context"
	| "denial"
	| "ledger"
	| "dispatch"
	| "egress"
	| "wake";

export interface GovernedRunnerProofContract {
	requirement: "local_state";
	reached: "local_state";
	fixture: "local_projection_fixture";
	claims_allowed: string[];
	non_claims: string[];
	production_gateway_handshake_checked: false;
	production_gateway_audit_reached: false;
	live_provider_dispatch_checked: false;
	connector_completion_readback_checked: false;
}

export interface GovernedRunnerConformanceCase {
	id: string;
	kind: GovernedRunnerConformanceKind;
	input: unknown;
	expected: unknown;
	proof_contract: GovernedRunnerProofContract;
}

export interface GovernedRunnerConformanceCorpus {
	schema_version: typeof GOVERNED_RUNNER_CORPUS_SCHEMA;
	corpus_version: typeof GOVERNED_RUNNER_CORPUS_VERSION;
	protocol_version: typeof CEAL_PROTOCOL_VERSION;
	cases: GovernedRunnerConformanceCase[];
}

export type CealProtocolValidationErrorCode = "invalid_gateway_request" | "invalid_client_response";

export class CealProtocolValidationError extends Error {
	override readonly name = "CealProtocolValidationError";

	constructor(readonly code: CealProtocolValidationErrorCode) {
		super(code === "invalid_gateway_request"
			? "Ceal Gateway request is invalid."
			: "Ceal client response is invalid.");
	}
}

const REQUEST_KEYS = ["body", "operation", "profile_ref", "protocol_version", "request_id"];
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const RAW_PROVIDER_REF = /(?:\b[CDGUW][A-Z0-9]{8,}\b|(?:slack|github|notion|google-workspace):[^\s"']+|[0-9]{10}[.][0-9]{4,})/u;
const SECRET_MATERIAL = /(?:xox[baprs]-[A-Za-z0-9-]+|gh[opusr]_[A-Za-z0-9_-]+|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|Bearer\s+\S+|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+)/iu;
const OPAQUE_TEXT_MATERIAL = /(?:\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b|\b(?=[A-Za-z0-9_-]{24,}\b)(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{24,}\b)/u;
const FORBIDDEN_SECRET_KEY = /^(?:[a-z0-9_]*(?:token|secret|password|credential(?:s)?|private_?key)|api_?key|authorization|bearer|raw_?provider_?payload|provider_?payload)$/iu;
const FORBIDDEN_AUTHORITY_KEY = /^(?:actor_?ref|owner_?ref|registration_?ref|runner_?ref|auth_?decision|policy_?decision|host_?decision)$/iu;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_ARGUMENT_BYTES = 16 * 1024;
const MAX_RESPONSE_VALUE_BYTES = 64 * 1024;
const TEXT_ENCODER = new TextEncoder();
const MESSAGE_CONTRACT_CONTEXT = {
	invalid: invalidResponse,
	record: requireRecord,
	exact: requireExactKeys,
	prefixed: requirePrefixedRef,
	safeText: requireSafeText,
	byteLength,
	assertCoverage: assertCealGatewayMessageSearchCoverage,
};

export function decodeCealGatewayRequest(value: unknown): CealGatewayRequest {
	try {
		const envelope = requireRecord(value);
		requireExactKeys(envelope, REQUEST_KEYS);
		requireSafeRef(envelope.request_id);
		requireSafeRef(envelope.profile_ref);
		if (typeof envelope.protocol_version !== "string" || !parseProtocolVersion(envelope.protocol_version)) invalidRequest();
		if (!isOperation(envelope.operation)) invalidRequest();
		validateRequestBody(envelope.operation, envelope.body);
		requireJsonByteSize(envelope, MAX_REQUEST_BYTES, invalidRequest);
		return envelope as unknown as CealGatewayRequest;
	} catch (error) {
		if (error instanceof CealProtocolValidationError) throw error;
		invalidRequest();
	}
}

export function decodeCealClientResponse<R extends CealGatewayRequest>(
	value: unknown,
	expectedRequestValue: Readonly<R>,
): CealGatewayResponseFor<R> {
	try {
		const expectedRequest = decodeCealGatewayRequest(expectedRequestValue);
		const response = requireRecord(value);
		if (response.ok === true) validateSuccessResponse(response, expectedRequest);
		else if (response.ok === false) validateFailureResponse(response, expectedRequest);
		else invalidResponse();
		return response as unknown as CealGatewayResponseFor<R>;
	} catch (error) {
		if (error instanceof CealProtocolValidationError) throw error;
		invalidResponse();
	}
}

function validateRequestBody(operation: CealClientOperation, bodyValue: unknown): void {
	const body = requireRecord(bodyValue);
	switch (operation) {
		case "handshake": {
			requireExactKeys(body, ["client"]);
			const client = requireRecord(body.client);
			requireExactKeys(client, ["name", "version"]);
			requireSafeText(client.name, 128);
			requireSafeText(client.version, 128);
			return;
		}
		case "discover":
			requireExactKeys(body, []);
			return;
		case "call":
			requireExactKeys(body, ["arguments", "capability_id", "purpose", "target_ref"]);
			requireSafeRef(body.capability_id);
			requireSafeRef(body.target_ref);
			requireSafeText(body.purpose, 512);
			assertSafeJsonValue(body.arguments, { forbidAuthorityKeys: true });
			requireJsonByteSize(body.arguments, MAX_ARGUMENT_BYTES, invalidRequest);
			return;
		case "readback":
			requireExactKeys(body, ["request_id"]);
			requireSafeRef(body.request_id);
	}
}

function validateSuccessResponse(response: Record<string, unknown>, expectedRequest: Readonly<CealGatewayRequest>): void {
	requireExactKeys(response, ["ok", "proof_ref_or_unavailable", "protocol_version", "request_id", "value"], ["proof_ref_or_unavailable"]);
	validateResponseIdentity(response, expectedRequest.request_id);
	assertSafeJsonValue(response.value, {
		forbidAuthorityKeys: false,
		allowAuthorizedMessageContent: expectedRequest.operation === "call" && expectedRequest.body.capability_id === "message.get",
	});
	requireJsonByteSize(response.value, MAX_RESPONSE_VALUE_BYTES, invalidResponse);
	if ("proof_ref_or_unavailable" in response) validateProofReference(response.proof_ref_or_unavailable);
	validateOperationSuccessResponse(response, expectedRequest);
}

function validateOperationSuccessResponse(response: Record<string, unknown>, expectedRequest: Readonly<CealGatewayRequest>): void {
	switch (expectedRequest.operation) {
		case "handshake":
			validateHostProofReference(response);
			validateHandshakeValue(response.value, expectedRequest);
			return;
		case "discover":
			validateHostProofReference(response);
			validateDiscoveryValue(response.value, expectedRequest);
			return;
		case "call":
			validateHostProofReference(response);
			validateCallValue(response.value, expectedRequest);
			return;
		case "readback":
			validateHostProofReference(response);
			validateAuditReadbackValue(response.value, expectedRequest);
	}
}

function validateHostProofReference(response: Record<string, unknown>): void {
	if (typeof response.proof_ref_or_unavailable !== "string") invalidResponse();
}

function validateHandshakeValue(value: unknown, expectedRequest: Readonly<CealGatewayHandshakeRequest>): void {
	const handshake = requireRecord(value);
	requireExactKeys(handshake, [
		"client_ref",
		"host_decision",
		"instance_ref",
		"membership_ref",
		"negotiated_protocol_version",
		"non_claims",
		"profile_ref",
		"proof_level",
		"registration_ref",
		"schema_version",
		"subject_ref",
		"supported_gateway_protocol_range",
	]);
	if (handshake.schema_version !== "ceal.gateway_handshake.v1"
		|| handshake.negotiated_protocol_version !== CEAL_PROTOCOL_VERSION
		|| handshake.profile_ref !== expectedRequest.profile_ref
		|| handshake.host_decision !== "accepted"
		|| handshake.proof_level !== "host_decision") invalidResponse();
	for (const field of ["membership_ref", "registration_ref", "client_ref", "subject_ref", "instance_ref"] as const) requireSafeRef(handshake[field]);
	const range = requireRecord(handshake.supported_gateway_protocol_range);
	requireExactKeys(range, ["maximum", "minimum"]);
	if (!negotiateCealProtocol(range).ok) invalidResponse();
	validateHostNonClaims(handshake.non_claims);
}

function validateDiscoveryValue(value: unknown, expectedRequest: Readonly<CealGatewayDiscoverRequest>): void {
	const discovery = requireRecord(value);
	requireExactKeys(discovery, ["capabilities", "host_decision", "membership_ref", "non_claims", "profile_ref", "proof_level", "schema_version", "targets"]);
	if (discovery.schema_version !== "ceal.gateway_discovery.v1"
		|| discovery.profile_ref !== expectedRequest.profile_ref
		|| discovery.host_decision !== "accepted"
		|| discovery.proof_level !== "host_decision") invalidResponse();
	requirePrefixedRef(discovery.membership_ref, "membership:");
	if (!Array.isArray(discovery.capabilities) || discovery.capabilities.length > 128) invalidResponse();
	const capabilityIds = new Set<string>();
	for (const capability of discovery.capabilities) validateDiscoveryCapability(capability, capabilityIds);
	validateDiscoveryTargets(discovery.targets, capabilityIds);
	validateHostNonClaims(discovery.non_claims);
}

function validateDiscoveryCapability(value: unknown, seen: Set<string>): void {
	const capability = requireRecord(value);
	requireExactKeys(capability, ["capability_id", "effect", "evidence_requirement", "input_contract", "label", "target_requirement"]);
	requireSafeRef(capability.capability_id);
	if (seen.has(String(capability.capability_id))
		|| !["read", "write"].includes(String(capability.effect))
		|| !["required", "optional", "none"].includes(String(capability.target_requirement))) invalidResponse();
	seen.add(String(capability.capability_id));
	requireSafeText(capability.label, 128);
	requireSafeRef(capability.evidence_requirement);
	if (capability.capability_id === "message.search") validateMessageSearchInputContract(capability.input_contract, MESSAGE_CONTRACT_CONTEXT);
	else validateGenericInputContract(capability.input_contract);
}

function validateGenericInputContract(value: unknown): void {
	const contract = requireRecord(value);
	requireSafeRef(contract.schema_version);
	if (!String(contract.schema_version).startsWith("ceal.")) invalidResponse();
}

function validateDiscoveryTargets(value: unknown, capabilityIds: ReadonlySet<string>): void {
	if (!Array.isArray(value) || value.length > 64) invalidResponse();
	const seen = new Set<string>();
	for (const item of value) validateDiscoveryTarget(item, seen, capabilityIds);
}

function validateDiscoveryTarget(value: unknown, seen: Set<string>, availableCapabilities: ReadonlySet<string>): void {
	const target = requireRecord(value);
	requireExactKeys(target, ["access", "capability_access", "capability_ids", "label", "target_ref"]);
	requirePrefixedRef(target.target_ref, "target:");
	if (seen.has(target.target_ref)) invalidResponse();
	seen.add(target.target_ref);
	requireSafeText(target.label, 128);
	if (target.access !== "granted" && target.access !== "request_required") invalidResponse();
	const expectedCapabilities = validateTargetCapabilityIds(target, availableCapabilities);
	if (target.access === "granted") validateCapabilityAccess(target.capability_access, expectedCapabilities);
	else if (!Array.isArray(target.capability_access) || target.capability_access.length !== 0) invalidResponse();
}

function validateTargetCapabilityIds(target: Record<string, unknown>, availableCapabilities: ReadonlySet<string>): string[] {
	if (!Array.isArray(target.capability_ids) || target.capability_ids.length > availableCapabilities.size) invalidResponse();
	const expected = target.capability_ids.map(String);
	if (new Set(expected).size !== expected.length || expected.some((id) => !availableCapabilities.has(id))) invalidResponse();
	if ((target.access === "granted") !== (expected.length > 0)) invalidResponse();
	return expected;
}

function validateCallValue(value: unknown, expectedRequest: Readonly<CealGatewayCallRequest>): void {
	const call = requireRecord(value);
	requireExactKeys(call, ["capability_id", "data", "grant_ref", "grant_revision", "host_decision", "non_claims", "proof_level", "redaction", "schema_version", "target_ref"]);
	if (call.schema_version !== "ceal.gateway_call_result.v1"
		|| call.capability_id !== expectedRequest.body.capability_id
		|| call.target_ref !== expectedRequest.body.target_ref
		|| call.host_decision !== "accepted"
		|| call.proof_level !== "host_decision") invalidResponse();
	requirePrefixedRef(call.grant_ref, "grant:");
	requireIntegerRange(call.grant_revision, 1, Number.MAX_SAFE_INTEGER);
	if (call.capability_id === "message.search") validateMessageSearchResult(call.data, expectedRequest, MESSAGE_CONTRACT_CONTEXT);
	else if (call.capability_id === "message.get") validateMessageGetResult(call.data, expectedRequest, MESSAGE_CONTRACT_CONTEXT);
	else validateGenericCapabilityResult(call.data, call.capability_id);
	validateCallRedaction(call.redaction, call.capability_id);
	validateHostNonClaims(call.non_claims, true);
}

function validateGenericCapabilityResult(value: unknown, capabilityId: unknown): void {
	const result = requireRecord(value);
	requireSafeRef(result.schema_version);
	const expectedPrefix = `ceal.${String(capabilityId).replaceAll(".", "_")}_result.`;
	if (!String(result.schema_version).startsWith(expectedPrefix)) invalidResponse();
}

function validateCapabilityAccess(value: unknown, expectedCapabilities: readonly string[]): void {
	if (!Array.isArray(value) || value.length !== expectedCapabilities.length) invalidResponse();
	const seen = new Set<string>();
	for (const item of value) {
		const access = requireRecord(item);
		requireExactKeys(access, ["capability_id", "grant_ref", "grant_revision", "readiness", "schema_version"]);
		if (access.schema_version !== "ceal.capability_access.v1"
			|| !expectedCapabilities.includes(String(access.capability_id))
			|| seen.has(String(access.capability_id))
			|| !["ready", "degraded", "unavailable", "unknown"].includes(String(access.readiness))) invalidResponse();
		requirePrefixedRef(access.grant_ref, "grant:");
		requireIntegerRange(access.grant_revision, 1, Number.MAX_SAFE_INTEGER);
		seen.add(String(access.capability_id));
	}
}

export function assertCealGatewayMessageSearchCoverage(
	value: unknown,
): asserts value is CealGatewayMessageSearchCoverage {
	const coverage = requireRecord(value);
	requireExactKeys(coverage, ["completeness", "match_semantics", "reply_coverage", "schema_version", "source", "truncated"]);
	if (!validMessageSearchCoverageVocabulary(coverage)) invalidResponse();
	if (coverage.source === "authoritative_index" && coverage.reply_coverage !== "included") invalidResponse();
	if (coverage.source === "bounded_projection" && coverage.completeness !== "incomplete") invalidResponse();
	if (coverage.truncated && coverage.completeness !== "incomplete") invalidResponse();
}

function validMessageSearchCoverageVocabulary(coverage: Record<string, unknown>): boolean {
	return coverage.schema_version === "ceal.message_search_coverage.v1"
		&& ["authoritative_index", "bounded_projection"].includes(String(coverage.source))
		&& ["backend_ranked", "literal_case_insensitive", "token_and_case_insensitive"].includes(String(coverage.match_semantics))
		&& ["included", "excluded"].includes(String(coverage.reply_coverage))
		&& ["bounded", "incomplete"].includes(String(coverage.completeness))
		&& typeof coverage.truncated === "boolean";
}

function validateCallRedaction(value: unknown, capabilityId: unknown): void {
	const redaction = requireRecord(value);
	requireExactKeys(redaction, ["omitted_classes", "state"]);
	if (redaction.state !== "applied"
		|| !Array.isArray(redaction.omitted_classes)
		|| redaction.omitted_classes.length === 0
		|| redaction.omitted_classes.length > 32) invalidResponse();
	for (const omittedClass of redaction.omitted_classes) requireSafeRef(omittedClass);
	if (capabilityId === "message.search"
		&& JSON.stringify(redaction.omitted_classes) !== JSON.stringify(["query_text", "raw_provider_ids", "raw_messages"])) invalidResponse();
}

function validateAuditReadbackValue(value: unknown, expectedRequest: Readonly<CealGatewayReadbackRequest>): void {
	const readback = requireRecord(value);
	requireExactKeys(readback, ["events", "request_id", "schema_version"]);
	const targetRequestId = readback.request_id;
	if (readback.schema_version !== "ceal.gateway_audit_readback.v1" || targetRequestId !== expectedRequest.body.request_id) invalidResponse();
	if (!Array.isArray(readback.events) || readback.events.length === 0 || readback.events.length > 128) invalidResponse();
	for (const event of readback.events) validateAuditEvent(event, expectedRequest, targetRequestId as string);
}

function validateAuditEvent(value: unknown, expectedRequest: Readonly<CealGatewayReadbackRequest>, targetRequestId: string): void {
	const event = requireRecord(value);
	requireExactKeys(event, [
		"auth_decision",
		"call",
		"client_ref",
		"client_revision",
		"error_code",
		"event_ref",
		"grant_snapshot",
		"instance_ref",
		"membership_ref",
		"membership_revision",
		"non_claims",
		"occurred_at",
		"operation",
		"outcome",
		"policy_decision",
		"profile_ref",
		"proof_level",
		"registration_ref",
		"request_id",
		"schema_version",
		"subject_ref",
	], ["call", "grant_snapshot"]);
	validateAuditEventIdentity(event, expectedRequest, targetRequestId);
	validateAuditEventDecisions(event);
	for (const field of ["event_ref", "membership_ref", "registration_ref", "client_ref", "subject_ref", "instance_ref"] as const) requireSafeRef(event[field]);
	requireIntegerRange(event.membership_revision, 1, Number.MAX_SAFE_INTEGER);
	requireIntegerRange(event.client_revision, 1, Number.MAX_SAFE_INTEGER);
	validateAuditEventError(event);
	validateAuditEventConsistency(event);
	validateAuthorizationSnapshot(event.grant_snapshot, event);
	if ("call" in event) validateAuditCallDetail(event.call, event);
	else if (event.operation === "call" && event.outcome === "succeeded") invalidResponse();
	const providerMayBeReached = event.operation === "call"
		&& (event.outcome === "succeeded" || event.error_code === "connector_unavailable");
	validateHostNonClaims(event.non_claims, providerMayBeReached);
}

function validateAuthorizationSnapshot(value: unknown, event: Record<string, unknown>): void {
	const required = event.operation === "call" && event.policy_decision === "allowed";
	if (value === undefined) { if (required) invalidResponse(); return; }
	if (!required) invalidResponse();
	const snapshot = requireRecord(value);
	requireExactKeys(snapshot, ["capability_id", "grant_ref", "grant_revision", "schema_version", "target_ref"]);
	if (snapshot.schema_version !== "ceal.gateway_authorization_snapshot.v1") invalidResponse();
	requireSafeRef(snapshot.capability_id);
	requirePrefixedRef(snapshot.target_ref, "target:");
	requirePrefixedRef(snapshot.grant_ref, "grant:");
	requireIntegerRange(snapshot.grant_revision, 1, Number.MAX_SAFE_INTEGER);
}

function validateAuditEventIdentity(event: Record<string, unknown>, expectedRequest: Readonly<CealGatewayReadbackRequest>, targetRequestId: string): void {
	if (event.schema_version !== "ceal.gateway_audit_event.v1"
		|| event.request_id !== targetRequestId
		|| event.profile_ref !== expectedRequest.profile_ref
		|| event.proof_level !== "host_decision"
		|| !isOperation(event.operation)) invalidResponse();
	if (typeof event.occurred_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$/u.test(event.occurred_at)) invalidResponse();
}

function validateAuditCallDetail(value: unknown, event: Record<string, unknown>): void {
	const call = requireRecord(value);
	const authorization = requireRecord(event.grant_snapshot);
	if (call.capability_id !== authorization.capability_id || call.target_ref !== authorization.target_ref
		|| call.grant_ref !== authorization.grant_ref || call.grant_revision !== authorization.grant_revision) invalidResponse();
	if (call.capability_id !== "message.search") {
		requireExactKeys(call, ["capability_id", "grant_ref", "grant_revision", "input_summary", "output_summary", "schema_version", "target_ref"]);
		if (call.schema_version !== "ceal.gateway_audit_call_detail.v1") invalidResponse();
		requireSafeRef(call.capability_id);
		requirePrefixedRef(call.grant_ref, "grant:");
		requireIntegerRange(call.grant_revision, 1, Number.MAX_SAFE_INTEGER);
		requirePrefixedRef(call.target_ref, "target:");
		requireRecord(call.input_summary);
		requireRecord(call.output_summary);
		return;
	}
	requireExactKeys(call, ["capability_id", "coverage", "grant_ref", "grant_revision", "query_utf8_bytes", "requested_limit", "requested_offset", "result_count", "schema_version", "target_ref"], ["requested_offset"]);
	if (![call.schema_version === "ceal.gateway_audit_call_detail.v1", call.capability_id === "message.search",
		event.operation === "call", event.outcome === "succeeded"].every(Boolean)) invalidResponse();
	requirePrefixedRef(call.target_ref, "target:");
	requirePrefixedRef(call.grant_ref, "grant:");
	requireIntegerRange(call.grant_revision, 1, Number.MAX_SAFE_INTEGER);
	requireIntegerRange(call.requested_limit, 1, 10);
	if (call.requested_offset !== undefined) requireIntegerRange(call.requested_offset, 0, 1000);
	requireIntegerRange(call.query_utf8_bytes, 1, 512);
	requireIntegerRange(call.result_count, 0, call.requested_limit);
	assertCealGatewayMessageSearchCoverage(call.coverage);
}

function requireIntegerRange(value: unknown, minimum: number, maximum: number): asserts value is number {
	if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) invalidResponse();
}

function validateAuditEventDecisions(event: Record<string, unknown>): void {
	if (!["allowed", "denied"].includes(String(event.auth_decision))
		|| !["allowed", "denied", "not_evaluated"].includes(String(event.policy_decision))
		|| !["succeeded", "denied", "failed"].includes(String(event.outcome))) invalidResponse();
}

function validateAuditEventError(event: Record<string, unknown>): void {
	if (event.error_code !== null && (typeof event.error_code !== "string" || !SAFE_CODE.test(event.error_code))) invalidResponse();
	if ((event.outcome === "succeeded") !== (event.error_code === null)) invalidResponse();
}

function validateAuditEventConsistency(event: Record<string, unknown>): void {
	switch (event.outcome) {
		case "succeeded":
			if (event.auth_decision !== "allowed" || event.policy_decision !== "allowed") invalidResponse();
			return;
		case "denied":
			validateDeniedAuditEvent(event);
			return;
		case "failed":
			if (event.auth_decision !== "allowed" || event.policy_decision === "denied") invalidResponse();
	}
}

function validateDeniedAuditEvent(event: Record<string, unknown>): void {
	const authenticationDenied = event.auth_decision === "denied" && event.policy_decision === "not_evaluated";
	const authenticatedDenial = event.auth_decision === "allowed"
		&& (event.policy_decision === "denied" || event.policy_decision === "not_evaluated");
	if (!authenticationDenied && !authenticatedDenial) invalidResponse();
}

function validateHostNonClaims(value: unknown, providerMayBeReached = false): void {
	const fixture = ["provider_execution_not_reached", "production_audit_not_reached"];
	const liveProvider = ["production_audit_not_reached"];
	if (!Array.isArray(value) || (JSON.stringify(value) !== JSON.stringify(fixture)
		&& (!providerMayBeReached || JSON.stringify(value) !== JSON.stringify(liveProvider)))) invalidResponse();
}

function validateFailureResponse(response: Record<string, unknown>, expectedRequest: Readonly<CealGatewayRequest>): void {
	const error = requireRecord(response.error);
	if (error.code === "policy_denied") {
		if (expectedRequest.operation !== "call") invalidResponse();
		validatePolicyDenial(response, error, expectedRequest);
		return;
	}
	requireExactKeys(response, ["error", "ok", "proof_ref_or_unavailable", "protocol_version", "request_id"], ["proof_ref_or_unavailable"]);
	validateResponseIdentity(response, expectedRequest.request_id);
	if ("proof_ref_or_unavailable" in response) validateProofReference(response.proof_ref_or_unavailable);
	requireExactKeys(error, ["code", "message", "next_action"], ["next_action"]);
	if (typeof error.code !== "string" || !SAFE_CODE.test(error.code)) invalidResponse();
	requireSafeText(error.message, 512);
	if ("next_action" in error) requireSafeText(error.next_action, 512);
}

function validatePolicyDenial(
	response: Record<string, unknown>,
	error: Record<string, unknown>,
	expectedRequest: Readonly<CealGatewayCallRequest>,
): void {
	requireExactKeys(response, ["error", "ok", "proof_ref_or_unavailable", "protocol_version", "request_id"]);
	validateResponseIdentity(response, expectedRequest.request_id);
	if (typeof response.proof_ref_or_unavailable !== "string") invalidResponse();
	validateProofReference(response.proof_ref_or_unavailable);
	requireExactKeys(error, ["code", "decision", "message", "next_action"]);
	if (error.code !== "policy_denied"
		|| error.message !== CEAL_GATEWAY_POLICY_DENIAL_MESSAGE
		|| error.next_action !== CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION) invalidResponse();
	const decision = requireRecord(error.decision);
	requireExactKeys(decision, ["capability_id", "host_decision", "non_claims", "proof_level", "schema_version", "target_ref"]);
	if (decision.schema_version !== "ceal.gateway_policy_denial.v1"
		|| decision.capability_id !== expectedRequest.body.capability_id
		|| decision.target_ref !== expectedRequest.body.target_ref
		|| decision.host_decision !== "denied"
		|| decision.proof_level !== "host_decision") invalidResponse();
	validateHostNonClaims(decision.non_claims);
}

function validateResponseIdentity(response: Record<string, unknown>, expectedRequestId: string): void {
	if (response.request_id !== expectedRequestId || response.protocol_version !== CEAL_PROTOCOL_VERSION) invalidResponse();
}

function validateProofReference(value: unknown): void {
	if (typeof value === "string") {
		requireSafeRef(value);
		return;
	}
	const unavailable = requireRecord(value);
	requireExactKeys(unavailable, ["owner_surface", "reason", "state"]);
	if (unavailable.state !== "unavailable") invalidResponse();
	requireSafeText(unavailable.reason, 256);
	requireSafeText(unavailable.owner_surface, 128);
}

function assertSafeJsonValue(value: unknown, options: { forbidAuthorityKeys: boolean; allowAuthorizedMessageContent?: boolean }, depth = 0, count = { value: 0 }): void {
	count.value += 1;
	if (depth > 8 || count.value > 512) invalidByContext(options);
	if (value === null || typeof value === "boolean") return;
	if (typeof value === "number") return assertSafeJsonNumber(value, options);
	if (typeof value === "string") return assertSafeJsonString(value, options);
	if (Array.isArray(value)) {
		return assertSafeJsonArray(value, options, depth, count);
	}
	assertSafeJsonRecord(requireRecord(value), options, depth, count);
}

function assertSafeJsonNumber(value: number, options: { forbidAuthorityKeys: boolean; allowAuthorizedMessageContent?: boolean }): void {
	if (!Number.isFinite(value)) invalidByContext(options);
}

function assertSafeJsonString(value: string, options: { forbidAuthorityKeys: boolean; allowAuthorizedMessageContent?: boolean }): void {
	if (byteLength(value) > 4096 || SECRET_MATERIAL.test(value) || RAW_PROVIDER_REF.test(value)) invalidByContext(options);
}

function assertSafeJsonArray(value: unknown[], options: { forbidAuthorityKeys: boolean; allowAuthorizedMessageContent?: boolean }, depth: number, count: { value: number }): void {
	if (value.length > 128) invalidByContext(options);
	for (const item of value) assertSafeJsonValue(item, options, depth + 1, count);
}

function assertSafeJsonRecord(record: Record<string, unknown>, options: { forbidAuthorityKeys: boolean; allowAuthorizedMessageContent?: boolean }, depth: number, count: { value: number }): void {
	const entries = Object.entries(record);
	if (entries.length > 128) invalidByContext(options);
	for (const [key, child] of entries) {
		if (!isSafeNegativeMaterialAssertion(key, child)) assertSafeJsonKey(key, options);
		if (options.allowAuthorizedMessageContent && (key === "text" || key === "source_url")) {
			if (typeof child !== "string" || byteLength(child) > 8192) invalidByContext(options);
		} else assertSafeJsonValue(child, options, depth + 1, count);
	}
}

function isSafeNegativeMaterialAssertion(key: string, value: unknown): boolean {
	return key === "credential_material_included" && value === false;
}

function assertSafeJsonKey(key: string, options: { forbidAuthorityKeys: boolean; allowAuthorizedMessageContent?: boolean }): void {
	const invalid = !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(key)
		|| FORBIDDEN_SECRET_KEY.test(key)
		|| (options.forbidAuthorityKeys && FORBIDDEN_AUTHORITY_KEY.test(key));
	if (invalid) invalidByContext(options);
}

function requireSafeRef(value: unknown): asserts value is string {
	if (typeof value !== "string" || !SAFE_REF.test(value) || SECRET_MATERIAL.test(value) || RAW_PROVIDER_REF.test(value)) invalidRequestOrResponse();
}

function requirePrefixedRef(value: unknown, prefix: string): asserts value is string {
	requireSafeRef(value);
	if (!value.startsWith(prefix)) invalidRequestOrResponse();
}

function requireSafeText(value: unknown, maxBytes: number): asserts value is string {
	if (!isCealPublicSafeText(value, maxBytes)) invalidRequestOrResponse();
}

export function isCealPublicSafeText(value: unknown, maxBytes: number): value is string {
	return typeof value === "string" && value.trim() !== "" && byteLength(value) <= maxBytes && !hasControlCharacter(value)
		&& !SECRET_MATERIAL.test(value) && !RAW_PROVIDER_REF.test(value) && !OPAQUE_TEXT_MATERIAL.test(value);
}

export function redactCealPublicUnsafeText(value: string): string {
	return replaceAll(value, SECRET_MATERIAL, "[redacted-secret]").replace(new RegExp(RAW_PROVIDER_REF.source, `${RAW_PROVIDER_REF.flags}g`), "[provider-ref]")
		.replace(new RegExp(OPAQUE_TEXT_MATERIAL.source, `${OPAQUE_TEXT_MATERIAL.flags}g`), "[redacted-opaque]")
		.split("").map((character) => hasControlCharacter(character) ? " " : character).join("").trim();
}

function replaceAll(value: string, pattern: RegExp, replacement: string): string {
	return value.replace(new RegExp(pattern.source, `${pattern.flags}g`), replacement);
}

function requireJsonByteSize(value: unknown, maximum: number, fail: () => never): void {
	let serialized: string;
	try {
		serialized = JSON.stringify(value);
	} catch {
		fail();
	}
	if (serialized === undefined || byteLength(serialized) > maximum) fail();
}

function byteLength(value: string): number {
	return TEXT_ENCODER.encode(value).byteLength;
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code <= 31 || code === 127;
	});
}

function requireExactKeys(record: Record<string, unknown>, allowedKeys: string[], optionalKeys: string[] = []): void {
	const allowed = new Set(allowedKeys);
	const optional = new Set(optionalKeys);
	if (Object.keys(record).some((key) => !allowed.has(key))) invalidRequestOrResponse();
	for (const key of allowed) if (!optional.has(key) && !Object.hasOwn(record, key)) invalidRequestOrResponse();
}

function requireRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalidRequestOrResponse();
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) invalidRequestOrResponse();
	return value as Record<string, unknown>;
}

function isOperation(value: unknown): value is CealClientOperation {
	return ["handshake", "discover", "call", "readback"].includes(String(value));
}

function invalidByContext(options: { forbidAuthorityKeys: boolean }): never {
	if (options.forbidAuthorityKeys) invalidRequest();
	invalidResponse();
}

class InvalidWireShapeError extends Error {}

function invalidRequestOrResponse(): never {
	throw new InvalidWireShapeError();
}

function invalidRequest(): never {
	throw new CealProtocolValidationError("invalid_gateway_request");
}

function invalidResponse(): never {
	throw new CealProtocolValidationError("invalid_client_response");
}
