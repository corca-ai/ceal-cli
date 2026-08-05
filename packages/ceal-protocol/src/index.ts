import { createHash } from "node:crypto";
import { CEAL_GATEWAY_POLICY_DENIAL_MESSAGE, CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION, CEAL_GATEWAY_RECOVERY_KINDS } from "./gateway-response-types.js";
import type { CealGatewayPolicyDenial, CealGatewayResponseFor } from "./gateway-response-types.js";
import { CEAL_PROTOCOL_VERSION } from "./gateway-response-types.js";
import { validateGatewayTargetCatalog } from "./gateway-target-catalog-validation.js";
import { validateGatewayCacheOrigin } from "./gateway-cache-origin-validation.js";
export { CEAL_MAX_CACHE_ORIGIN_AGE_MS } from "./gateway-cache-origin-validation.js";
import { negotiateCealProtocol, parseProtocolVersion } from "./protocol-negotiation.js";
import type { CealClientFailure, CealClientOperation, CealClientSuccess, CealGatewayAnnouncementPolicy, CealGatewayCallRequest, CealGatewayDiscoverBody, CealGatewayDiscoverRequest, CealGatewayHandshakeRequest, CealGatewayAuditReadbackRequest, CealGatewayReadbackRequest, CealGatewayRequest, CealGatewayWriteReceiptRequest } from "./gateway-response-types.js";
import {
	assertSafeJsonValue,
	CealProtocolValidationError,
	FORBIDDEN_AUDIT_DETAIL_KEY,
	invalidRequest,
	invalidResponse,
	isCealPublicSafeText,
	isOperation,
	isSafeExternalHttpsUrl,
	requireExactKeys,
	requireJsonByteSize,
	requirePrefixedRef,
	requireRecord,
	requireSafeRef,
	requireSafeText,
	SAFE_CODE,
} from "./gateway-validation-primitives.js";
export { CealProtocolValidationError, isCealPublicSafeText, redactCealPublicUnsafeText } from "./gateway-validation-primitives.js";
export type { CealProtocolValidationErrorCode } from "./gateway-validation-primitives.js";

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
export * from "./device-enrollment.js";
export * from "./leased-consumer-control.js";
export { PORTABLE_UNIX_SOCKET_PATH_MAX_BYTES, isSafeUnixSocketPath } from "./unix-socket-path-safety.js";
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
	CealGatewayAuditReadbackRequest,
	CealGatewayAnnouncementPolicy,
	CealGatewayAnnouncementPolicyNonClaim,
	CealGatewayAnnouncementProviderAuthority,
	CealGatewayAnnouncementScopeStatementKind,
	CealGatewayCacheOrigin,
	CealGatewayCallValue,
	CealGatewayConnectorRouteFailure,
	CealGatewayDiscoverBody,
	CealGatewayDiscoveryCapability,
	CealGatewayDiscoveryTarget,
	CealGatewayDiscoveryValue,
	CealGatewayTargetCatalog,
	CealGatewayEligibleProfile,
	CealGatewayHandshakeValue,
	CealGatewayHostNonClaim,
	CealGatewayHostNonClaims,
	CealGatewayWriteContract,
	CealGatewayWriteReceiptReadbackValue,
	CealGatewayWriteReceiptRequest,
	CealGatewayWriteRequestReceipt,
	CealCapabilityAccessDescriptor,
	CealCapabilityReadiness,
	CealGatewayPolicyDenial,
	CealGatewayPolicyDenialDecision,
	CealGatewayRateLimitPolicy,
	CealGatewayRecovery,
	CealGatewayRecoveryKind,
	CealGatewayRequestForInput,
	CealGatewayRequestInput,
	CealGatewayResponseFor,
} from "./gateway-response-types.js";
export { CEAL_GATEWAY_RECOVERY_KINDS, CEAL_PROTOCOL_VERSION } from "./gateway-response-types.js";
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

export {
	GOVERNED_RUNNER_CORPUS_SCHEMA,
	GOVERNED_RUNNER_CORPUS_VERSION,
} from "./governed-runner-conformance.js";
export type {
	GovernedRunnerConformanceCase,
	GovernedRunnerConformanceCorpus,
	GovernedRunnerConformanceKind,
	GovernedRunnerProofContract,
} from "./governed-runner-conformance.js";

export type CealClientResponse<TValue = unknown> = CealClientSuccess<TValue> | CealGatewayPolicyDenial | CealClientFailure;

const REQUEST_KEYS = ["body", "operation", "profile_ref", "protocol_version", "request_id"];
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_ARGUMENT_BYTES = 16 * 1024;
const MAX_RESPONSE_VALUE_BYTES = 64 * 1024;
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
	// responseValueMaxNodes: budget for the response.value walk (default 16384 =
	// 64KiB floor); a Gateway probe passes the DEPLOYED fleet's budget instead.
	options: { readonly responseValueMaxNodes?: number } = {},
): CealGatewayResponseFor<R> {
	try {
		const expectedRequest = decodeCealGatewayRequest(expectedRequestValue);
		const response = requireRecord(value);
		if (response.ok === true) validateSuccessResponse(response, expectedRequest, options.responseValueMaxNodes ?? 16_384);
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
			validateDiscoveryRequestBody(body);
			return;
		case "call":
			requireExactKeys(body, ["arguments", "capability_id", "purpose", "target_ref"]);
			requireSafeRef(body.capability_id);
			requireSafeRef(body.target_ref);
			requireSafeText(body.purpose, 512);
			assertSafeJsonValue(body.arguments, { forbidAuthorityKeys: true, allowHttpsUrl: true });
			requireJsonByteSize(body.arguments, MAX_ARGUMENT_BYTES, invalidRequest);
			return;
		case "readback":
			if (Object.hasOwn(body, "request_id")) {
				requireExactKeys(body, ["request_id"]);
				requireSafeRef(body.request_id);
				return;
			}
			requireExactKeys(body, ["write_request_ref"]);
			requirePrefixedRef(body.write_request_ref, "gateway-write-request:");
			if (!/^gateway-write-request:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(body.write_request_ref)) invalidRequest();
	}
}

function validateDiscoveryRequestBody(body: Record<string, unknown>): void {
	requireExactKeys(body, ["capability_id", "capability_ids", "cursor", "limit", "match"], ["capability_id", "capability_ids", "cursor", "limit", "match"]);
	const selection = {
		capabilityId: body.capability_id,
		capabilityIds: body.capability_ids,
		cursor: body.cursor,
		match: body.match,
		limit: body.limit,
	};
	validateDiscoverySelectorValues(selection);
	validateDiscoverySelectorDependencies(selection);
}

function validateDiscoverySelectorValues(selection: Readonly<{ capabilityId: unknown; capabilityIds: unknown; cursor: unknown; match: unknown; limit: unknown }>): void {
	if (selection.capabilityId !== undefined) requireSafeRef(selection.capabilityId);
	if (selection.capabilityIds !== undefined) validateDiscoveryCapabilityIds(selection.capabilityIds);
	if (selection.cursor !== undefined) requirePrefixedRef(selection.cursor, "cursor:");
	if (selection.match !== undefined) requireTargetSelector(selection.match);
	if (selection.limit === undefined) return;
	if (typeof selection.limit !== "number" || !Number.isSafeInteger(selection.limit) || selection.limit < 1 || selection.limit > 64) invalidRequest();
}

function validateDiscoverySelectorDependencies(selection: Readonly<{ capabilityId: unknown; capabilityIds: unknown; cursor: unknown; match: unknown; limit: unknown }>): void {
	if (selection.capabilityId !== undefined && selection.capabilityIds !== undefined) invalidRequest();
	if (selection.cursor !== undefined || selection.match !== undefined || selection.limit !== undefined) {
		if (selection.capabilityId === undefined && selection.capabilityIds === undefined) invalidRequest();
	}
	if (selection.cursor !== undefined && selection.match !== undefined) invalidRequest();
}

function validateDiscoveryCapabilityIds(value: unknown): void {
	if (!Array.isArray(value) || value.length < 1 || value.length > 8) invalidRequest();
	const ids = value.map((id) => {
		requireSafeRef(id);
		return String(id);
	});
	if (new Set(ids).size !== ids.length) invalidRequest();
}

function requireTargetSelector(value: unknown): void {
	if (isCealPublicSafeText(value, 512) || isSafeExternalHttpsUrl(value)) return;
	invalidRequest();
}

function validateSuccessResponse(response: Record<string, unknown>, expectedRequest: Readonly<CealGatewayRequest>, responseValueMaxNodes = 16_384): void {
	requireExactKeys(response, ["ok", "proof_ref_or_unavailable", "protocol_version", "request_id", "value"], ["proof_ref_or_unavailable"]);
	validateResponseIdentity(response, expectedRequest.request_id);
	assertSafeJsonValue(response.value, {
		forbidAuthorityKeys: false,
		allowHttpsUrl: true,
		allowResultContent: expectedRequest.operation === "call",
		// The byte cap below is the transport bound; the node budget only guards
		// pathological shapes (2026-08-05 discovery incident).
		maxNodes: responseValueMaxNodes,
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
			if (isAuditReadbackRequest(expectedRequest)) validateAuditReadbackValue(response.value, expectedRequest);
			else validateWriteReceiptReadbackValue(response.value, expectedRequest as CealGatewayWriteReceiptRequest);
	}
}

function validateHostProofReference(response: Record<string, unknown>): void {
	if (typeof response.proof_ref_or_unavailable !== "string") invalidResponse();
}

function validateHandshakeValue(value: unknown, expectedRequest: Readonly<CealGatewayHandshakeRequest>): void {
	const handshake = requireRecord(value);
	requireExactKeys(handshake, [
		"client_ref", "eligible_profiles", "host_decision", "instance_ref", "membership_ref",
		"negotiated_protocol_version", "non_claims", "profile_ref", "proof_level",
		"registration_ref", "schema_version", "subject_ref", "supported_gateway_protocol_range",
	], ["eligible_profiles"]);
	if (handshake.schema_version !== "ceal.gateway_handshake.v1"
		|| handshake.negotiated_protocol_version !== CEAL_PROTOCOL_VERSION
		|| handshake.profile_ref !== expectedRequest.profile_ref
		|| handshake.host_decision !== "accepted"
		|| handshake.proof_level !== "host_decision") invalidResponse();
	for (const field of ["membership_ref", "registration_ref", "client_ref", "subject_ref", "instance_ref"] as const) requireSafeRef(handshake[field]);
	const range = requireRecord(handshake.supported_gateway_protocol_range);
	requireExactKeys(range, ["maximum", "minimum"]);
	if (!negotiateCealProtocol(range).ok) invalidResponse();
	if ("eligible_profiles" in handshake) validateEligibleProfiles(handshake.eligible_profiles);
	validateHostNonClaims(handshake.non_claims);
}

// The negotiated eligible-Profile catalog is refs-only and may be empty. Order
// and uniqueness are the Gateway's contract, not re-asserted here; the generic
// safe-JSON pass already caps array length upstream of this decode.
function validateEligibleProfiles(value: unknown): void {
	if (!Array.isArray(value)) invalidResponse();
	for (const entry of value) {
		const profile = requireRecord(entry);
		requireExactKeys(profile, ["membership_ref", "profile_ref"]);
		requireSafeRef(profile.profile_ref);
		requireSafeRef(profile.membership_ref);
	}
}

function validateDiscoveryValue(value: unknown, expectedRequest: Readonly<CealGatewayDiscoverRequest>): void {
	const discovery = requireRecord(value);
	requireExactKeys(discovery, ["capabilities", "host_decision", "membership_ref", "non_claims", "profile_ref", "proof_level", "schema_version", "target_catalog", "targets"]);
	if (discovery.schema_version !== "ceal.gateway_discovery.v2"
		|| discovery.profile_ref !== expectedRequest.profile_ref
		|| discovery.host_decision !== "accepted"
		|| discovery.proof_level !== "host_decision") invalidResponse();
	requirePrefixedRef(discovery.membership_ref, "membership:");
	if (!Array.isArray(discovery.capabilities) || discovery.capabilities.length > 128) invalidResponse();
	const capabilityIds = new Set<string>();
	for (const capability of discovery.capabilities) validateDiscoveryCapability(capability, capabilityIds);
	validateDiscoveryTargets(discovery.targets, capabilityIds);
	validateTargetCatalog(discovery.target_catalog, discovery.targets, capabilityIds, expectedRequest.body);
	validateHostNonClaims(discovery.non_claims);
}

function validateTargetCatalog(
	value: unknown,
	targets: unknown,
	capabilityIds: ReadonlySet<string>,
	request: Readonly<CealGatewayDiscoverBody>,
): void {
	validateGatewayTargetCatalog({ requireRecord, requireExactKeys, requirePrefixedRef, invalidResponse }, value, targets, capabilityIds, request);
}

function validateDiscoveryCapability(value: unknown, seen: Set<string>): void {
	const capability = requireRecord(value);
	requireExactKeys(capability, ["announcement_policy", "capability_id", "effect", "evidence_requirement", "input_contract", "label", "target_requirement", "write_contract"], ["announcement_policy", "write_contract"]);
	requireSafeRef(capability.capability_id);
	if (seen.has(String(capability.capability_id))
		|| !["read", "write"].includes(String(capability.effect))
		|| !["required", "optional", "none"].includes(String(capability.target_requirement))) invalidResponse();
	if (capability.effect === "write") validateWriteContract(capability.write_contract);
	else if (capability.write_contract !== undefined) invalidResponse();
	seen.add(String(capability.capability_id));
	requireSafeText(capability.label, 128);
	requireSafeRef(capability.evidence_requirement);
	validateGenericInputContract(capability.input_contract);
	if (capability.announcement_policy !== undefined) validateAnnouncementPolicy(capability.announcement_policy, String(capability.capability_id), String(capability.effect), capability.write_contract);
}

const ANNOUNCEMENT_POLICY_NON_CLAIMS = [
	"policy_projection_does_not_authorize",
	"provider_roundtrip_not_established_by_discovery",
	"target_specific_scope_not_declared",
] as const;

const ANNOUNCEMENT_POLICY_CAPABILITY_BINDINGS: Readonly<Record<string, readonly Readonly<{
	effect: "read" | "write";
	scopeStatementKind: string;
	providerAuthorityKind: string;
}>[]>> = Object.freeze({
	"github.repository.get": [{ effect: "read", scopeStatementKind: "github_app_installation_repositories", providerAuthorityKind: "github_app" }],
	"github.repository.search": [{ effect: "read", scopeStatementKind: "github_app_installation_repositories", providerAuthorityKind: "github_app" }],
	"github.issue.get": [{ effect: "read", scopeStatementKind: "github_app_installation_repositories", providerAuthorityKind: "github_app" }],
	"github.pull_request.get": [{ effect: "read", scopeStatementKind: "github_app_installation_repositories", providerAuthorityKind: "github_app" }],
	"github.workflow_run.get": [{ effect: "read", scopeStatementKind: "github_app_installation_repositories", providerAuthorityKind: "github_app" }],
	"message.search": [{ effect: "read", scopeStatementKind: "slack_public_app_member_channels_only", providerAuthorityKind: "slack_app" }],
	"message.enumerate": [{ effect: "read", scopeStatementKind: "slack_public_app_member_channels_only", providerAuthorityKind: "slack_app" }],
	"message.get": [{ effect: "read", scopeStatementKind: "slack_public_app_member_channels_only", providerAuthorityKind: "slack_app" }],
	"resource.resolve": [
		{ effect: "read", scopeStatementKind: "slack_public_app_member_channels_only", providerAuthorityKind: "slack_app" },
		{ effect: "read", scopeStatementKind: "notion_connected_logical_area", providerAuthorityKind: "notion_integration" },
	],
	"conversation.thread.get": [{ effect: "read", scopeStatementKind: "slack_public_app_member_channels_only", providerAuthorityKind: "slack_app" }],
	"notion.search": [{ effect: "read", scopeStatementKind: "notion_connected_logical_area", providerAuthorityKind: "notion_integration" }],
	"notion.page.get": [{ effect: "read", scopeStatementKind: "notion_connected_logical_area", providerAuthorityKind: "notion_integration" }],
	"calendar.availability": [{ effect: "read", scopeStatementKind: "google_workspace_calendar_read_only", providerAuthorityKind: "google_service_account" }],
	"calendar.event.search": [{ effect: "read", scopeStatementKind: "google_workspace_calendar_read_only", providerAuthorityKind: "google_service_account" }],
	"calendar.event.get": [{ effect: "read", scopeStatementKind: "google_workspace_calendar_read_only", providerAuthorityKind: "google_service_account" }],
	"drive.file.search": [{ effect: "read", scopeStatementKind: "google_workspace_ceal_drive_or_direct_share_metadata", providerAuthorityKind: "google_service_account" }],
	"sheets.values.read": [{ effect: "read", scopeStatementKind: "google_workspace_ceal_drive_or_direct_share_sheet_ranges", providerAuthorityKind: "google_service_account" }],
	"sheets.values.update": [{ effect: "write", scopeStatementKind: "google_workspace_ceal_drive_or_direct_share_editable_sheet_ranges", providerAuthorityKind: "google_service_account" }],
});

function validateAnnouncementPolicy(value: unknown, capabilityId: string, effect: string, writeContract: unknown): void {
	const policy = requireRecord(value);
	requireExactKeys(policy, ["explicit_request_required", "non_claims", "provenance_requirement", "provider_application_authority", "schema_version", "scope_statement", "scope_statement_kind"]);
	validateAnnouncementPolicyBase(policy);
	validateAnnouncementPolicyCapabilityBinding(policy, capabilityId, effect);
	validateAnnouncementPolicyEffect(policy, effect, writeContract);
	validateAnnouncementPolicyNonClaims(policy.non_claims);
	validateAnnouncementProviderAuthority(policy.provider_application_authority);
}

/**
 * Reuses the wire decoder's closed announcement-policy contract at a Gateway
 * emission seam. A false result means omit the optional field; it must not
 * make an otherwise ordinary discovery response undecodable.
 */
export function isCealGatewayAnnouncementPolicy(
	value: unknown,
	{ capabilityId, effect, writeContract }: { capabilityId: string; effect: "read" | "write"; writeContract?: unknown },
): value is CealGatewayAnnouncementPolicy {
	try {
		validateAnnouncementPolicy(value, capabilityId, effect, writeContract);
		return true;
	} catch { return false; }
}

function validateAnnouncementPolicyBase(policy: Record<string, unknown>): void {
	if (policy.schema_version !== "ceal.gateway_announcement_policy.v1" || typeof policy.explicit_request_required !== "boolean") invalidResponse();
	if (typeof policy.scope_statement_kind !== "string" || ANNOUNCEMENT_SCOPE_STATEMENTS[policy.scope_statement_kind] !== policy.scope_statement) invalidResponse();
}

const ANNOUNCEMENT_SCOPE_STATEMENTS: Record<string, string> = Object.freeze({
	github_app_installation_repositories: "Repositories in the installed GitHub App installation.",
	slack_public_app_member_channels_only: "Public channels where the installed Slack app is a member; private channels, direct messages, multi-person direct messages, and requester membership are not declared by this connector.",
	notion_connected_logical_area: "Connected Notion logical area under provider-enforced sharing; descendant inventory is not declared.",
	google_workspace_ceal_drive_or_direct_share: "Files in the organization shared drive named Ceal Drive and files directly shared with the provider application.",
	google_workspace_calendar_read_only: "Approved Calendar availability and event reads only; Calendar mutation is not declared.",
	google_workspace_ceal_drive_or_direct_share_metadata: "Metadata search for files in the organization shared drive named Ceal Drive and files directly shared with the provider application; file-content read and mutation are not declared.",
	google_workspace_ceal_drive_or_direct_share_sheet_ranges: "Bounded values reads from governed Google Sheets in the organization shared drive named Ceal Drive and directly shared files; file mutation is not declared.",
	google_workspace_ceal_drive_or_direct_share_editable_sheet_ranges: "Bounded values updates in governed editable Google Sheets in the organization shared drive named Ceal Drive and directly shared files; Docs, Slides, and other Drive file mutation are not declared.",
});

function validateAnnouncementPolicyCapabilityBinding(policy: Record<string, unknown>, capabilityId: string, effect: string): void {
	const bindings = ANNOUNCEMENT_POLICY_CAPABILITY_BINDINGS[capabilityId];
	const authority = requireRecord(policy.provider_application_authority);
	if (!bindings?.some((binding) => binding.effect === effect && policy.scope_statement_kind === binding.scopeStatementKind && authority.kind === binding.providerAuthorityKind)) invalidResponse();
}

function validateAnnouncementPolicyEffect(policy: Record<string, unknown>, effect: string, writeContract: unknown): void {
	const expected = effect === "write"
		? { explicitRequestRequired: true, provenanceRequirement: "explicit_requester_event_gateway_receipt_audit_provider_readback" }
		: { explicitRequestRequired: false, provenanceRequirement: "gateway_receipt_audit" };
	if (policy.explicit_request_required !== expected.explicitRequestRequired || policy.provenance_requirement !== expected.provenanceRequirement) invalidResponse();
	if (effect === "write") validateAnnouncementWriteContract(writeContract);
}

function validateAnnouncementWriteContract(value: unknown): void {
	const contract = requireRecord(value);
	if (contract.idempotency !== "required" || contract.provider_readback !== "required"
		|| contract.attribution !== "requester_event" || contract.provenance_binding !== "gateway_attested_requester_event_v1") invalidResponse();
}

function validateAnnouncementPolicyNonClaims(value: unknown): void {
	if (!Array.isArray(value) || value.length === 0 || value.length > ANNOUNCEMENT_POLICY_NON_CLAIMS.length
		|| new Set(value).size !== value.length
		|| !value.every((item) => (ANNOUNCEMENT_POLICY_NON_CLAIMS as readonly unknown[]).includes(item))) invalidResponse();
}

function validateAnnouncementProviderAuthority(value: unknown): void {
	const authority = requireRecord(value);
	if (authority.kind === "github_app") {
		requireExactKeys(authority, ["granted_permissions", "kind"]);
		validateAnnouncementAuthorityList(authority.granted_permissions, /^([a-z_]{1,64}):(read|write|admin)$/u);
		if (!Array.isArray(authority.granted_permissions) || authority.granted_permissions.some((item) => typeof item !== "string" || /(?:credential|token|secret|password|api_key)/iu.test(item))) invalidResponse();
		return;
	}
	if (authority.kind === "slack_app") {
		requireExactKeys(authority, ["kind", "oauth_scope_observation"]);
		if (authority.oauth_scope_observation !== "not_exposed_by_current_connector") invalidResponse();
		return;
	}
	if (authority.kind === "notion_integration") {
		requireExactKeys(authority, ["descendant_inventory", "kind", "sharing"]);
		if (authority.sharing !== "provider_enforced" || authority.descendant_inventory !== "not_enumerable") invalidResponse();
		return;
	}
	if (authority.kind === "google_service_account") {
		requireExactKeys(authority, ["kind", "requested_api_scopes"]);
		validateAnnouncementAuthorityList(authority.requested_api_scopes, /^[A-Za-z0-9._:/-]{1,160}$/u);
		return;
	}
	invalidResponse();
}

function validateAnnouncementAuthorityList(value: unknown, pattern: RegExp): void {
	if (!Array.isArray(value) || value.length === 0 || value.length > 32 || new Set(value).size !== value.length
		|| !value.every((item) => typeof item === "string" && pattern.test(item))) invalidResponse();
}

function validateWriteContract(value: unknown): void {
	const contract = requireRecord(value);
	assertSafeJsonValue(contract, { forbidAuthorityKeys: false });
	if (!Object.hasOwn(contract, "side_effect_class") || !Object.hasOwn(contract, "idempotency")
		|| !Object.hasOwn(contract, "provider_readback")) invalidResponse();
	requireSafeRef(contract.side_effect_class);
	if (!["required", "optional", "not_required"].includes(String(contract.idempotency))) invalidResponse();
	if (!["required", "best_effort", "not_available"].includes(String(contract.provider_readback))) invalidResponse();
}

function validateGenericInputContract(value: unknown): void {
	const contract = requireRecord(value);
	requireSafeRef(contract.schema_version);
	if (!String(contract.schema_version).startsWith("ceal.")) invalidResponse();
	assertSafeJsonValue(contract, { forbidAuthorityKeys: false, allowHttpsUrl: true });
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
	requireExactKeys(call, ["cache_origin", "capability_id", "data", "grant_ref", "grant_revision", "host_decision", "non_claims", "proof_level", "redaction", "schema_version", "target_ref"], ["cache_origin"]);
	if (call.schema_version !== "ceal.gateway_call_result.v1"
		|| call.capability_id !== expectedRequest.body.capability_id
		|| call.target_ref !== expectedRequest.body.target_ref
		|| call.host_decision !== "accepted"
		|| call.proof_level !== "host_decision") invalidResponse();
	requirePrefixedRef(call.grant_ref, "grant:");
	requireIntegerRange(call.grant_revision, 1, Number.MAX_SAFE_INTEGER);
	validateGenericCapabilityResult(call.data, call.capability_id);
	validateCallRedaction(call.redaction);
	validateHostNonClaims(call.non_claims, true);
	if ("cache_origin" in call) validateGatewayCacheOrigin({ requireRecord, requireExactKeys, invalidResponse }, call.cache_origin);
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
		requireExactKeys(access, ["capability_id", "grant_ref", "grant_revision", "rate_limit", "readiness", "schema_version"], ["rate_limit"]);
		if (access.schema_version !== "ceal.capability_access.v1"
			|| !expectedCapabilities.includes(String(access.capability_id))
			|| seen.has(String(access.capability_id))
			|| !["ready", "degraded", "unavailable", "unknown"].includes(String(access.readiness))) invalidResponse();
		requirePrefixedRef(access.grant_ref, "grant:");
		requireIntegerRange(access.grant_revision, 1, Number.MAX_SAFE_INTEGER);
		if ("rate_limit" in access) validateRateLimitPolicy(access.rate_limit);
		seen.add(String(access.capability_id));
	}
}

const MAX_RATE_LIMIT_POLICY_WINDOW_MS = 24 * 60 * 60 * 1000;

function validateRateLimitPolicy(value: unknown): void {
	const policy = requireRecord(value);
	requireExactKeys(policy, ["counted_unit", "max_calls", "schema_version", "scope", "window_model", "window_ms"]);
	if (policy.schema_version !== "ceal.gateway_rate_limit_policy.v1"
		|| policy.counted_unit !== "governed_call"
		|| policy.scope !== "authenticated_principal"
		|| policy.window_model !== "rolling") invalidResponse();
	requireIntegerRange(policy.max_calls, 1, 10_000);
	requireIntegerRange(policy.window_ms, 1, MAX_RATE_LIMIT_POLICY_WINDOW_MS);
}

function validateCallRedaction(value: unknown): void {
	const redaction = requireRecord(value);
	requireExactKeys(redaction, ["omitted_classes", "state"]);
	if (redaction.state !== "applied"
		|| !Array.isArray(redaction.omitted_classes)
		|| redaction.omitted_classes.length === 0
		|| redaction.omitted_classes.length > 32) invalidResponse();
	for (const omittedClass of redaction.omitted_classes) requireSafeRef(omittedClass);
}

function validateAuditReadbackValue(value: unknown, expectedRequest: Readonly<CealGatewayAuditReadbackRequest>): void {
	const readback = requireRecord(value);
	requireExactKeys(readback, ["events", "request_id", "schema_version"]);
	const targetRequestId = readback.request_id;
	if (readback.schema_version !== "ceal.gateway_audit_readback.v1" || targetRequestId !== expectedRequest.body.request_id) invalidResponse();
	if (!Array.isArray(readback.events) || readback.events.length === 0 || readback.events.length > 128) invalidResponse();
	for (const event of readback.events) validateAuditEvent(event, expectedRequest, targetRequestId as string);
}

function validateAuditEvent(value: unknown, expectedRequest: Readonly<CealGatewayAuditReadbackRequest>, targetRequestId: string): void {
	const event = requireRecord(value);
	requireExactKeys(event, [
		"auth_decision",
		"call",
		"client_ref",
		"client_revision",
		"connector_route_failure",
		"error_code",
		"event_ref",
		"gateway_elapsed_ms",
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
	], ["call", "connector_route_failure", "gateway_elapsed_ms", "grant_snapshot"]);
	validateAuditEventIdentity(event, expectedRequest, targetRequestId);
	validateAuditEventDecisions(event);
	for (const field of ["event_ref", "membership_ref", "registration_ref", "client_ref", "subject_ref", "instance_ref"] as const) requireSafeRef(event[field]);
	requireIntegerRange(event.membership_revision, 1, Number.MAX_SAFE_INTEGER);
	requireIntegerRange(event.client_revision, 1, Number.MAX_SAFE_INTEGER);
	validateAuditEventError(event);
	if (event.gateway_elapsed_ms !== undefined) requireIntegerRange(event.gateway_elapsed_ms, 0, Number.MAX_SAFE_INTEGER);
	validateAuditEventConsistency(event);
	validateConnectorRouteFailure(event.connector_route_failure, event);
	validateAuthorizationSnapshot(event.grant_snapshot, event);
	if ("call" in event) validateAuditCallDetail(event.call, event);
	else if (event.operation === "call" && event.outcome === "succeeded") invalidResponse();
	// A failed call may honestly omit the provider_execution_not_reached
	// non-claim only when the provider was actually reached: an unavailable
	// backend after dispatch, or a resource that was fetched and then rejected
	// as the wrong kind for the invoked capability.
	const providerMayBeReached = event.operation === "call"
		&& (event.outcome === "succeeded" || event.error_code === "connector_unavailable" || event.error_code === "wrong_resource_kind");
	const providerWasReached = event.operation === "call" && event.error_code === "wrong_resource_kind";
	validateHostNonClaims(event.non_claims, providerMayBeReached, providerWasReached);
}

function validateWriteReceiptReadbackValue(value: unknown, expectedRequest: Readonly<CealGatewayWriteReceiptRequest>): void {
	const projection = requireRecord(value);
	requireExactKeys(projection, ["receipt", "schema_version"]);
	if (projection.schema_version !== "ceal.gateway_write_receipt_readback.v1") invalidResponse();
	const receipt = requireRecord(projection.receipt);
	requireExactKeys(receipt, [
		"admission_context_sha256", "idempotency_claim_sha256", "normalized_mutation_sha256", "provider_readback", "provider_result_sha256",
		"provider_state", "purpose_sha256", "schema_version", "source_evidence_sha256", "source_kind", "write_request_sha256",
	], ["admission_context_sha256", "provider_result_sha256", "purpose_sha256"]);
	if (!isValidWriteReceipt(receipt, expectedRequest.body.write_request_ref)) invalidResponse();
	for (const key of ["write_request_sha256", "source_evidence_sha256", "idempotency_claim_sha256", "normalized_mutation_sha256", "purpose_sha256", "admission_context_sha256", "provider_result_sha256"]) {
		if (receipt[key] !== undefined && (typeof receipt[key] !== "string" || !/^[a-f0-9]{64}$/u.test(receipt[key]))) invalidResponse();
	}
}

function isValidWriteReceipt(receipt: Record<string, unknown>, writeRequestRef: string): boolean {
	if (receipt.schema_version !== "ceal.gateway_write_request_receipt.v1") return false;
	if (!["authenticated_registered_client", "agent_lease_admission", "provider_authenticated_event"].includes(String(receipt.source_kind))) return false;
	if (!["outcome_unknown", "verified"].includes(String(receipt.provider_state))) return false;
	if (!["outcome_unknown", "verified"].includes(String(receipt.provider_readback))) return false;
	if ((receipt.provider_state === "verified") !== (receipt.provider_readback === "verified")) return false;
	return receipt.write_request_sha256 === sha256(writeRequestRef);
}

function isAuditReadbackRequest(request: Readonly<CealGatewayReadbackRequest>): request is CealGatewayAuditReadbackRequest {
	return Object.hasOwn(request.body, "request_id");
}

function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

function validateConnectorRouteFailure(value: unknown, event: Record<string, unknown>): void {
	if (value === undefined) return;
	if (!isConnectorRouteFailureEvent(event)) invalidResponse();
	const failure = requireRecord(value);
	requireExactKeys(failure, "cause" in failure
		? ["cause", "connector_kind", "phase", "schema_version"]
		: ["connector_kind", "phase", "schema_version"]);
	if (!isConnectorRouteFailureShape(failure)) invalidResponse();
	const nonClaims = event.non_claims;
	if (!Array.isArray(nonClaims) || !nonClaims.includes("provider_execution_not_reached")) invalidResponse();
}

const CONNECTOR_ROUTE_FAILURE_CODES = ["connector_unavailable", "rate_limited"];
/** `unknown` carries no recovery information, so it is omitted rather than published. */
const CONNECTOR_ROUTE_FAILURE_CAUSES = ["provider_throttled", "provider_unavailable", "binding_invalid", "scope_limit_exceeded"];

function isConnectorRouteFailureEvent(event: Record<string, unknown>): boolean {
	return event.outcome === "failed" && CONNECTOR_ROUTE_FAILURE_CODES.includes(String(event.error_code))
		&& event.policy_decision === "not_evaluated" && ["call", "discover"].includes(String(event.operation));
}

function isConnectorRouteFailureShape(failure: Record<string, unknown>): boolean {
	return failure.schema_version === "ceal.gateway_connector_route_failure.v1"
		&& typeof failure.connector_kind === "string" && /^[a-z][a-z0-9-]{0,63}$/u.test(failure.connector_kind)
		&& ["scope_observation", "target_selection", "route_resolution"].includes(String(failure.phase))
		&& (failure.cause === undefined || CONNECTOR_ROUTE_FAILURE_CAUSES.includes(String(failure.cause)));
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
	if (call.schema_version !== "ceal.gateway_audit_call_detail.v1"
		|| event.operation !== "call" || event.outcome !== "succeeded") invalidResponse();
	if (Object.keys(call).some((key) => FORBIDDEN_AUDIT_DETAIL_KEY.test(key))) invalidResponse();
	assertSafeJsonValue(call, { forbidAuthorityKeys: true, allowHttpsUrl: true });
	requireSafeRef(call.capability_id);
	requirePrefixedRef(call.target_ref, "target:");
	requirePrefixedRef(call.grant_ref, "grant:");
	requireIntegerRange(call.grant_revision, 1, Number.MAX_SAFE_INTEGER);
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

function validateHostNonClaims(value: unknown, providerMayBeReached = false, providerWasReached = false): void {
	const fixture = ["provider_execution_not_reached", "production_audit_not_reached"];
	const liveProvider = ["production_audit_not_reached"];
	if (providerWasReached) {
		if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(liveProvider)) invalidResponse();
		return;
	}
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
	requireExactKeys(error, ["code", "message", "next_action", "recovery"], ["next_action", "recovery"]);
	if (typeof error.code !== "string" || !SAFE_CODE.test(error.code)) invalidResponse();
	requireSafeText(error.message, 512);
	if ("next_action" in error) requireSafeText(error.next_action, 512);
	if ("recovery" in error) validateFailureRecovery(error.recovery);
}

const MAX_RECOVERY_RETRY_AFTER_MS = 60 * 60 * 1000;

function validateFailureRecovery(value: unknown): void {
	const recovery = requireRecord(value);
	requireExactKeys(recovery, ["kind", "retry_after_ms"], ["retry_after_ms"]);
	if (!(CEAL_GATEWAY_RECOVERY_KINDS as readonly unknown[]).includes(recovery.kind)) invalidResponse();
	if ("retry_after_ms" in recovery) {
		const wait = recovery.retry_after_ms;
		if (typeof wait !== "number" || !Number.isSafeInteger(wait) || wait < 0 || wait > MAX_RECOVERY_RETRY_AFTER_MS) invalidResponse();
	}
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
