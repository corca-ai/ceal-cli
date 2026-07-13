import {
	CEAL_GATEWAY_POLICY_DENIAL_MESSAGE,
	CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION,
} from "./gateway-response-types.js";
import type {
	CealGatewayPolicyDenial,
	CealGatewayResponseFor,
} from "./gateway-response-types.js";
import { CEAL_PROTOCOL_VERSION } from "./gateway-response-types.js";
import type {
	CealClientFailure,
	CealClientOperation,
	CealClientSuccess,
	CealGatewayCallRequest,
	CealGatewayDiscoverRequest,
	CealGatewayHandshakeRequest,
	CealGatewayReadbackRequest,
	CealGatewayRequest,
} from "./gateway-response-types.js";

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
	CealGatewayMessageSearchCoverage,
	CealGatewayMessageSearchResultItem,
	CealMessageSearchBackendDescriptor,
	CealMessageSearchBackendMode,
	CealMessageSearchCredentialIdentityClass,
	CealMessageSearchMatchMode,
	CealMessageSearchProvenance,
	CealGatewayPolicyDenial,
	CealGatewayPolicyDenialDecision,
	CealGatewayRequestForInput,
	CealGatewayRequestInput,
	CealGatewayResponseFor,
} from "./gateway-response-types.js";
export { CEAL_PROTOCOL_VERSION } from "./gateway-response-types.js";
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
export const CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE = Object.freeze({
	minimum: CEAL_PROTOCOL_VERSION,
	maximum: CEAL_PROTOCOL_VERSION,
});

export interface CealProtocolNegotiationSuccess {
	schema_version: "ceal.protocol_negotiation.v1";
	ok: true;
	protocol_version: typeof CEAL_PROTOCOL_VERSION;
}

export interface CealProtocolNegotiationFailure {
	schema_version: "ceal.protocol_negotiation.v1";
	ok: false;
	error: {
		code: "invalid_gateway_protocol_range" | "incompatible_protocol";
		message: string;
		next_action: string;
	};
}

export type CealProtocolNegotiation = CealProtocolNegotiationSuccess | CealProtocolNegotiationFailure;

/**
 * Select the one wire version this release actually implements.
 *
 * A broad Gateway range never promotes an unimplemented future version: the
 * current protocol must itself fall inside the advertised range.
 */
export function negotiateCealProtocol(gatewayRange: unknown): CealProtocolNegotiation {
	const parsedRange = parseProtocolRange(gatewayRange);
	if (!parsedRange || compareProtocolVersions(parsedRange.minimum, parsedRange.maximum) > 0) {
		return protocolNegotiationFailure(
			"invalid_gateway_protocol_range",
			"The Gateway advertised an invalid Ceal protocol range.",
			"Inspect the Gateway release metadata and retry with a valid minimum and maximum protocol version.",
		);
	}
	const current = parseProtocolVersion(CEAL_PROTOCOL_VERSION);
	if (!current || compareProtocolVersions(parsedRange.minimum, current) > 0 || compareProtocolVersions(current, parsedRange.maximum) > 0) {
		return protocolNegotiationFailure(
			"incompatible_protocol",
			"The Ceal client and Gateway do not share an implemented protocol version.",
			"Upgrade the Ceal client or Gateway to releases with overlapping protocol support.",
		);
	}
	return {
		schema_version: "ceal.protocol_negotiation.v1",
		ok: true,
		protocol_version: CEAL_PROTOCOL_VERSION,
	};
}

type ParsedProtocolVersion = readonly [number, number, number];

function parseProtocolRange(value: unknown): { minimum: ParsedProtocolVersion; maximum: ParsedProtocolVersion } | null {
	if (!value || typeof value !== "object") return null;
	const range = value as Record<string, unknown>;
	const minimum = parseProtocolVersion(range.minimum);
	const maximum = parseProtocolVersion(range.maximum);
	return minimum && maximum ? { minimum, maximum } : null;
}

function parseProtocolVersion(value: unknown): ParsedProtocolVersion | null {
	if (typeof value !== "string") return null;
	const match = /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/u.exec(value);
	if (!match) return null;
	const parsed = match.slice(1).map(Number);
	if (parsed.some((part) => !Number.isSafeInteger(part))) return null;
	return parsed as unknown as ParsedProtocolVersion;
}

function compareProtocolVersions(left: ParsedProtocolVersion, right: ParsedProtocolVersion): number {
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) return left[index] - right[index];
	}
	return 0;
}

function protocolNegotiationFailure(
	code: CealProtocolNegotiationFailure["error"]["code"],
	message: string,
	nextAction: string,
): CealProtocolNegotiationFailure {
	return {
		schema_version: "ceal.protocol_negotiation.v1",
		ok: false,
		error: { code, message, next_action: nextAction },
	};
}

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
const SECRET_MATERIAL = /(?:xox[baprs]-|gh[opusr]_|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|AKIA|Bearer\s+|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)/iu;
const OPAQUE_TEXT_MATERIAL = /(?:\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b|\b(?=[A-Za-z0-9_-]{24,}\b)(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{24,}\b)/u;
const FORBIDDEN_SECRET_KEY = /^(?:[a-z0-9_]*(?:token|secret|password|credential(?:s)?|private_?key)|api_?key|authorization|bearer|raw_?provider_?payload|provider_?payload)$/iu;
const FORBIDDEN_AUTHORITY_KEY = /^(?:actor_?ref|owner_?ref|registration_?ref|runner_?ref|auth_?decision|policy_?decision|host_?decision)$/iu;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_ARGUMENT_BYTES = 16 * 1024;
const MAX_RESPONSE_VALUE_BYTES = 64 * 1024;
const TEXT_ENCODER = new TextEncoder();

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
	assertSafeJsonValue(response.value, { forbidAuthorityKeys: false });
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
		"negotiated_protocol_version",
		"non_claims",
		"profile_ref",
		"proof_level",
		"registration_ref",
		"runner_ref",
		"schema_version",
		"supported_gateway_protocol_range",
	]);
	if (handshake.schema_version !== "ceal.gateway_handshake.v1"
		|| handshake.negotiated_protocol_version !== CEAL_PROTOCOL_VERSION
		|| handshake.profile_ref !== expectedRequest.profile_ref
		|| handshake.host_decision !== "accepted"
		|| handshake.proof_level !== "host_decision") invalidResponse();
	for (const field of ["registration_ref", "client_ref", "runner_ref"] as const) requireSafeRef(handshake[field]);
	const range = requireRecord(handshake.supported_gateway_protocol_range);
	requireExactKeys(range, ["maximum", "minimum"]);
	if (!negotiateCealProtocol(range).ok) invalidResponse();
	validateHostNonClaims(handshake.non_claims);
}

function validateDiscoveryValue(value: unknown, expectedRequest: Readonly<CealGatewayDiscoverRequest>): void {
	const discovery = requireRecord(value);
	requireExactKeys(discovery, ["capabilities", "host_decision", "non_claims", "profile_ref", "proof_level", "schema_version", "targets"]);
	if (discovery.schema_version !== "ceal.gateway_discovery.v1"
		|| discovery.profile_ref !== expectedRequest.profile_ref
		|| discovery.host_decision !== "accepted"
		|| discovery.proof_level !== "host_decision") invalidResponse();
	if (!Array.isArray(discovery.capabilities) || discovery.capabilities.length !== 1) invalidResponse();
	validateDiscoveryCapability(discovery.capabilities[0]);
	validateDiscoveryTargets(discovery.targets);
	validateHostNonClaims(discovery.non_claims);
}

function validateDiscoveryCapability(value: unknown): void {
	const capability = requireRecord(value);
	requireExactKeys(capability, ["capability_id", "effect", "evidence_requirement", "input_contract", "label", "target_requirement"]);
	if (capability.capability_id !== "message.search"
		|| capability.effect !== "read"
		|| capability.target_requirement !== "required"
		|| capability.evidence_requirement !== "gateway_audit") invalidResponse();
	requireSafeText(capability.label, 128);
	validateMessageSearchInputContract(capability.input_contract);
}

function validateMessageSearchInputContract(value: unknown): void {
	const contract = requireRecord(value);
	requireExactKeys(contract, ["limit", "query", "required", "schema_version"]);
	if (contract.schema_version !== "ceal.message_search_input.v1"
		|| !Array.isArray(contract.required)
		|| contract.required.length !== 1
		|| contract.required[0] !== "query") invalidResponse();
	const query = requireRecord(contract.query);
	requireExactKeys(query, ["max_bytes", "type"]);
	if (query.type !== "string" || query.max_bytes !== 512) invalidResponse();
	const limit = requireRecord(contract.limit);
	requireExactKeys(limit, ["default", "maximum", "minimum", "type"]);
	if (limit.type !== "integer" || limit.minimum !== 1 || limit.maximum !== 10 || limit.default !== 5) invalidResponse();
}

function validateDiscoveryTargets(value: unknown): void {
	if (!Array.isArray(value) || value.length === 0 || value.length > 64) invalidResponse();
	const seen = new Set<string>();
	for (const item of value) validateDiscoveryTarget(item, seen);
}

function validateDiscoveryTarget(value: unknown, seen: Set<string>): void {
	const target = requireRecord(value);
	requireExactKeys(target, ["access", "capability_ids", "label", "search_backend", "target_ref"], ["search_backend"]);
	requirePrefixedRef(target.target_ref, "target:");
	if (seen.has(target.target_ref)) invalidResponse();
	seen.add(target.target_ref);
	requireSafeText(target.label, 128);
	if (target.access !== "granted" && target.access !== "request_required") invalidResponse();
	const expectedCapabilities = target.access === "granted" ? ["message.search"] : [];
	if (JSON.stringify(target.capability_ids) !== JSON.stringify(expectedCapabilities)) invalidResponse();
	if (target.access === "granted") validateMessageSearchBackendDescriptor(target.search_backend);
	else if ("search_backend" in target) invalidResponse();
}

function validateCallValue(value: unknown, expectedRequest: Readonly<CealGatewayCallRequest>): void {
	const call = requireRecord(value);
	requireExactKeys(call, ["capability_id", "data", "host_decision", "non_claims", "proof_level", "redaction", "schema_version", "target_ref"]);
	if (call.schema_version !== "ceal.gateway_call_result.v1"
		|| call.capability_id !== expectedRequest.body.capability_id
		|| call.capability_id !== "message.search"
		|| call.target_ref !== expectedRequest.body.target_ref
		|| call.host_decision !== "accepted"
		|| call.proof_level !== "host_decision") invalidResponse();
	validateMessageSearchResult(call.data, expectedRequest);
	validateCallRedaction(call.redaction);
	validateHostNonClaims(call.non_claims, true);
}

function validateMessageSearchResult(value: unknown, expectedRequest: Readonly<CealGatewayCallRequest>): void {
	const result = requireRecord(value);
	requireExactKeys(result, ["coverage", "minimization", "query", "result_count", "results", "schema_version"]);
	if (result.schema_version !== "ceal.message_search_result.v1") invalidResponse();
	const input = requireMessageSearchInput(expectedRequest.body.arguments);
	validateRedactedQuery(result.query, input.queryUtf8Bytes);
	if (!Array.isArray(result.results) || result.results.length > input.limit || result.result_count !== result.results.length) invalidResponse();
	const seen = new Set<string>();
	for (const item of result.results) validateMessageSearchResultItem(item, expectedRequest.body.target_ref, seen);
	validateMessageSearchCoverage(result.coverage);
	const minimization = requireRecord(result.minimization);
	requireExactKeys(minimization, ["credential_material_included", "raw_messages_included", "raw_provider_ids_included"]);
	if (minimization.credential_material_included !== false
		|| minimization.raw_messages_included !== false
		|| minimization.raw_provider_ids_included !== false) invalidResponse();
}

function validateMessageSearchBackendDescriptor(value: unknown): void {
	const backend = requireRecord(value);
	requireExactKeys(backend, ["completeness", "credential_identity_class", "match_mode", "mode", "provenance", "schema_version", "scope", "thread_replies"]);
	if (backend.schema_version !== "ceal.message_search_backend.v1"
		|| !["mature_search", "degraded_fallback"].includes(String(backend.mode))
		|| !["delegated_user", "organization_service", "bot"].includes(String(backend.credential_identity_class))
		|| backend.scope !== "granted_target"
		|| !["provider_search", "recent_channel_history"].includes(String(backend.provenance))
		|| !["provider_ranked", "literal_case_insensitive_substring"].includes(String(backend.match_mode))
		|| !["included", "excluded"].includes(String(backend.thread_replies))
		|| !["bounded", "incomplete"].includes(String(backend.completeness))) invalidResponse();
	if (backend.mode === "mature_search" && (backend.provenance !== "provider_search" || backend.thread_replies !== "included")) invalidResponse();
	if (backend.mode === "degraded_fallback" && (backend.provenance !== "recent_channel_history" || backend.completeness !== "incomplete")) invalidResponse();
}

function validateMessageSearchCoverage(value: unknown): void {
	const coverage = requireRecord(value);
	requireExactKeys(coverage, ["completeness", "credential_identity_class", "match_mode", "mode", "provenance", "provider_truncated", "schema_version", "scope", "thread_replies"]);
	if (typeof coverage.provider_truncated !== "boolean") invalidResponse();
	const { provider_truncated: _providerTruncated, ...backend } = coverage;
	validateMessageSearchBackendDescriptor(backend);
	if (coverage.provider_truncated && coverage.completeness !== "incomplete") invalidResponse();
}

function requireMessageSearchInput(value: unknown): { queryUtf8Bytes: number; limit: number } {
	const input = requireRecord(value);
	requireExactKeys(input, ["limit", "query"], ["limit"]);
	if (typeof input.query !== "string" || input.query.trim() === "") invalidResponse();
	const queryUtf8Bytes = byteLength(input.query);
	if (queryUtf8Bytes > 512) invalidResponse();
	const limit = input.limit === undefined ? 5 : input.limit;
	if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 10) invalidResponse();
	return { queryUtf8Bytes, limit: limit as number };
}

function validateRedactedQuery(value: unknown, expectedUtf8Bytes: number): void {
	const query = requireRecord(value);
	requireExactKeys(query, ["empty", "redacted", "utf8_bytes"]);
	if (query.redacted !== true
		|| query.utf8_bytes !== expectedUtf8Bytes
		|| query.empty !== false) invalidResponse();
}

function validateMessageSearchResultItem(value: unknown, expectedTargetRef: string, seen: Set<string>): void {
	const item = requireRecord(value);
	requireExactKeys(item, ["created_at", "ref", "source_label", "target_ref", "text_preview", "thread_ref"], ["thread_ref"]);
	requirePrefixedRef(item.ref, "message:");
	if (seen.has(item.ref as string) || item.target_ref !== expectedTargetRef) invalidResponse();
	seen.add(item.ref as string);
	if ("thread_ref" in item) requirePrefixedRef(item.thread_ref, "thread:");
	if (typeof item.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$/u.test(item.created_at)) invalidResponse();
	requireSafeText(item.source_label, 128);
	requireSafeText(item.text_preview, 1024);
}

function validateCallRedaction(value: unknown): void {
	const redaction = requireRecord(value);
	requireExactKeys(redaction, ["omitted_classes", "state"]);
	if (redaction.state !== "applied"
		|| !Array.isArray(redaction.omitted_classes)
		|| JSON.stringify(redaction.omitted_classes) !== JSON.stringify(["query_text", "raw_provider_ids", "raw_messages"])) invalidResponse();
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
		"error_code",
		"event_ref",
		"non_claims",
		"occurred_at",
		"operation",
		"outcome",
		"policy_decision",
		"profile_ref",
		"proof_level",
		"registration_ref",
		"request_id",
		"runner_ref",
		"schema_version",
	], ["call"]);
	validateAuditEventIdentity(event, expectedRequest, targetRequestId);
	validateAuditEventDecisions(event);
	for (const field of ["event_ref", "registration_ref", "client_ref", "runner_ref"] as const) requireSafeRef(event[field]);
	validateAuditEventError(event);
	validateAuditEventConsistency(event);
	if ("call" in event) validateAuditCallDetail(event.call, event);
	else if (event.operation === "call" && event.outcome === "succeeded") invalidResponse();
	const providerMayBeReached = event.operation === "call"
		&& (event.outcome === "succeeded" || event.error_code === "connector_unavailable");
	validateHostNonClaims(event.non_claims, providerMayBeReached);
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
	requireExactKeys(call, ["capability_id", "coverage", "query_utf8_bytes", "requested_limit", "result_count", "schema_version", "target_ref"]);
	if (call.schema_version !== "ceal.gateway_audit_call_detail.v1"
		|| call.capability_id !== "message.search"
		|| event.operation !== "call"
		|| event.outcome !== "succeeded") invalidResponse();
	requirePrefixedRef(call.target_ref, "target:");
	if (!Number.isInteger(call.requested_limit) || (call.requested_limit as number) < 1 || (call.requested_limit as number) > 10
		|| !Number.isInteger(call.query_utf8_bytes) || (call.query_utf8_bytes as number) < 1 || (call.query_utf8_bytes as number) > 512
		|| !Number.isInteger(call.result_count) || (call.result_count as number) < 0 || (call.result_count as number) > (call.requested_limit as number)) invalidResponse();
	validateMessageSearchCoverage(call.coverage);
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

function assertSafeJsonValue(value: unknown, options: { forbidAuthorityKeys: boolean }, depth = 0, count = { value: 0 }): void {
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

function assertSafeJsonNumber(value: number, options: { forbidAuthorityKeys: boolean }): void {
	if (!Number.isFinite(value)) invalidByContext(options);
}

function assertSafeJsonString(value: string, options: { forbidAuthorityKeys: boolean }): void {
	if (byteLength(value) > 4096 || SECRET_MATERIAL.test(value) || RAW_PROVIDER_REF.test(value)) invalidByContext(options);
}

function assertSafeJsonArray(value: unknown[], options: { forbidAuthorityKeys: boolean }, depth: number, count: { value: number }): void {
	if (value.length > 128) invalidByContext(options);
	for (const item of value) assertSafeJsonValue(item, options, depth + 1, count);
}

function assertSafeJsonRecord(record: Record<string, unknown>, options: { forbidAuthorityKeys: boolean }, depth: number, count: { value: number }): void {
	const entries = Object.entries(record);
	if (entries.length > 128) invalidByContext(options);
	for (const [key, child] of entries) {
		if (!isSafeNegativeMaterialAssertion(key, child)) assertSafeJsonKey(key, options);
		assertSafeJsonValue(child, options, depth + 1, count);
	}
}

function isSafeNegativeMaterialAssertion(key: string, value: unknown): boolean {
	return key === "credential_material_included" && value === false;
}

function assertSafeJsonKey(key: string, options: { forbidAuthorityKeys: boolean }): void {
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
	if (typeof value !== "string" || value.trim() === "" || byteLength(value) > maxBytes || hasControlCharacter(value)
		|| SECRET_MATERIAL.test(value) || RAW_PROVIDER_REF.test(value) || OPAQUE_TEXT_MATERIAL.test(value)) invalidRequestOrResponse();
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
