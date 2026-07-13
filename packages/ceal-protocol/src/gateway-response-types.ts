export const CEAL_PROTOCOL_VERSION = "1.0.0" as const;

export interface CealProtocolRange { minimum: string; maximum: string }
export type CealClientOperation = "handshake" | "discover" | "call" | "readback";

export interface CealClientRequest<TBody = unknown> {
	request_id: string;
	protocol_version: typeof CEAL_PROTOCOL_VERSION;
	operation: CealClientOperation;
	profile_ref: string;
	body: TBody;
}

export interface CealProofUnavailable { state: "unavailable"; reason: string; owner_surface: string }
export type CealProofReferenceOrUnavailable = string | CealProofUnavailable;

export interface CealClientSuccess<TValue = unknown> {
	ok: true;
	request_id: string;
	protocol_version: typeof CEAL_PROTOCOL_VERSION;
	value: TValue;
	proof_ref_or_unavailable?: CealProofReferenceOrUnavailable;
}

export interface CealClientFailure {
	ok: false;
	request_id: string;
	protocol_version: typeof CEAL_PROTOCOL_VERSION;
	proof_ref_or_unavailable?: CealProofReferenceOrUnavailable;
	error: { code: string; message: string; next_action?: string };
}

interface CealGatewayRequestEnvelope<TOperation extends CealClientOperation, TBody> {
	request_id: string;
	protocol_version: string;
	operation: TOperation;
	profile_ref: string;
	body: TBody;
}

export type CealGatewayHandshakeRequest = CealGatewayRequestEnvelope<"handshake", { client: { name: string; version: string } }>;
export type CealGatewayDiscoverRequest = CealGatewayRequestEnvelope<"discover", Record<string, never>>;
export type CealGatewayCallRequest = CealGatewayRequestEnvelope<"call", { capability_id: string; target_ref: string; arguments: unknown; purpose: string }>;
export type CealGatewayReadbackRequest = CealGatewayRequestEnvelope<"readback", { request_id: string }>;
export type CealGatewayRequest = CealGatewayHandshakeRequest | CealGatewayDiscoverRequest | CealGatewayCallRequest | CealGatewayReadbackRequest;

export type CealGatewayHostNonClaim = "provider_execution_not_reached" | "production_audit_not_reached";
export type CealGatewayHostNonClaims = readonly CealGatewayHostNonClaim[];

export interface CealGatewayHandshakeValue {
	schema_version: "ceal.gateway_handshake.v1";
	negotiated_protocol_version: typeof CEAL_PROTOCOL_VERSION;
	supported_gateway_protocol_range: CealProtocolRange;
	profile_ref: string;
	registration_ref: string;
	client_ref: string;
	runner_ref: string;
	host_decision: "accepted";
	proof_level: "host_decision";
	non_claims: CealGatewayHostNonClaims;
}

export interface CealGatewayDiscoveryValue {
	schema_version: "ceal.gateway_discovery.v1";
	profile_ref: string;
	capabilities: CealGatewayDiscoveryCapability[];
	targets: CealGatewayDiscoveryTarget[];
	host_decision: "accepted";
	proof_level: "host_decision";
	non_claims: CealGatewayHostNonClaims;
}

export interface CealGatewayDiscoveryCapability {
	capability_id: "message.search";
	label: string;
	effect: "read";
	target_requirement: "required";
	input_contract: {
		schema_version: "ceal.message_search_input.v1";
		required: readonly ["query"];
		query: { type: "string"; max_bytes: 512 };
		limit: { type: "integer"; minimum: 1; maximum: 10; default: 5 };
	};
	evidence_requirement: "gateway_audit";
}

export type CealMessageSearchBackendMode = "mature_search" | "degraded_fallback";
export type CealMessageSearchCredentialIdentityClass = "delegated_user" | "organization_service" | "bot";
export type CealMessageSearchProvenance = "provider_search" | "recent_channel_history";
export type CealMessageSearchMatchMode = "provider_ranked" | "literal_case_insensitive_substring";

export interface CealMessageSearchBackendDescriptor {
	schema_version: "ceal.message_search_backend.v1";
	mode: CealMessageSearchBackendMode;
	credential_identity_class: CealMessageSearchCredentialIdentityClass;
	scope: "granted_target";
	provenance: CealMessageSearchProvenance;
	match_mode: CealMessageSearchMatchMode;
	thread_replies: "included" | "excluded";
	completeness: "bounded" | "incomplete";
}

export interface CealGatewayGrantedDiscoveryTarget {
	target_ref: string;
	label: string;
	access: "granted";
	capability_ids: ["message.search"];
	search_backend: CealMessageSearchBackendDescriptor;
}

export interface CealGatewayRequestRequiredDiscoveryTarget {
	target_ref: string;
	label: string;
	access: "request_required";
	capability_ids: [];
}

export type CealGatewayDiscoveryTarget = CealGatewayGrantedDiscoveryTarget | CealGatewayRequestRequiredDiscoveryTarget;

export interface CealGatewayCallValue {
	schema_version: "ceal.gateway_call_result.v1";
	capability_id: "message.search";
	target_ref: string;
	data: CealGatewayMessageSearchResult;
	redaction: {
		state: "applied";
		omitted_classes: readonly ["query_text", "raw_provider_ids", "raw_messages"];
	};
	host_decision: "accepted";
	proof_level: "host_decision";
	non_claims: CealGatewayHostNonClaims;
}

export interface CealGatewayMessageSearchResult {
	schema_version: "ceal.message_search_result.v1";
	query: { redacted: true; utf8_bytes: number; empty: false };
	result_count: number;
	results: CealGatewayMessageSearchResultItem[];
	coverage: CealGatewayMessageSearchCoverage;
	minimization: {
		raw_provider_ids_included: false;
		raw_messages_included: false;
		credential_material_included: false;
	};
}

export interface CealGatewayMessageSearchCoverage extends CealMessageSearchBackendDescriptor {
	provider_truncated: boolean;
}

export interface CealGatewayMessageSearchResultItem {
	ref: string;
	thread_ref?: string;
	target_ref: string;
	created_at: string;
	source_label: string;
	text_preview: string;
}

export const CEAL_GATEWAY_POLICY_DENIAL_MESSAGE = "The authenticated profile is not granted this capability for the requested target." as const;
export const CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION = "Request policy approval for this capability and target." as const;

export interface CealGatewayPolicyDenialDecision {
	schema_version: "ceal.gateway_policy_denial.v1";
	capability_id: string;
	target_ref: string;
	host_decision: "denied";
	proof_level: "host_decision";
	non_claims: CealGatewayHostNonClaims;
}

export interface CealGatewayPolicyDenial {
	ok: false;
	request_id: string;
	protocol_version: typeof CEAL_PROTOCOL_VERSION;
	proof_ref_or_unavailable: string;
	error: {
		code: "policy_denied";
		message: typeof CEAL_GATEWAY_POLICY_DENIAL_MESSAGE;
		next_action: typeof CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION;
		decision: CealGatewayPolicyDenialDecision;
	};
}

export interface CealGatewayAuditEvent {
	schema_version: "ceal.gateway_audit_event.v1";
	event_ref: string;
	request_id: string;
	profile_ref: string;
	registration_ref: string;
	client_ref: string;
	runner_ref: string;
	occurred_at: string;
	operation: CealGatewayRequest["operation"];
	auth_decision: "allowed" | "denied";
	policy_decision: "allowed" | "denied" | "not_evaluated";
	outcome: "succeeded" | "denied" | "failed";
	error_code: string | null;
	call?: CealGatewayAuditCallDetail;
	proof_level: "host_decision";
	non_claims: CealGatewayHostNonClaims;
}

export interface CealGatewayAuditCallDetail {
	schema_version: "ceal.gateway_audit_call_detail.v1";
	capability_id: "message.search";
	target_ref: string;
	requested_limit: number;
	query_utf8_bytes: number;
	result_count: number;
	coverage: CealGatewayMessageSearchCoverage;
}

export interface CealGatewayAuditReadbackValue {
	schema_version: "ceal.gateway_audit_readback.v1";
	request_id: string;
	events: CealGatewayAuditEvent[];
}

export type CealGatewayResponseFor<R extends CealGatewayRequest> =
	R extends CealGatewayHandshakeRequest ? CealClientSuccess<CealGatewayHandshakeValue> | CealClientFailure
		: R extends CealGatewayDiscoverRequest ? CealClientSuccess<CealGatewayDiscoveryValue> | CealClientFailure
			: R extends CealGatewayCallRequest ? CealClientSuccess<CealGatewayCallValue> | CealGatewayPolicyDenial | CealClientFailure
				: R extends CealGatewayReadbackRequest ? CealClientSuccess<CealGatewayAuditReadbackValue> | CealClientFailure
					: never;

type WithoutProtocol<T> = T extends CealGatewayRequest ? Omit<T, "protocol_version"> : never;

export type CealGatewayRequestInput = WithoutProtocol<CealGatewayRequest>;

export type CealGatewayRequestForInput<I extends CealGatewayRequestInput> =
	I extends { operation: "handshake" } ? CealGatewayHandshakeRequest
		: I extends { operation: "discover" } ? CealGatewayDiscoverRequest
			: I extends { operation: "call" } ? CealGatewayCallRequest
				: I extends { operation: "readback" } ? CealGatewayReadbackRequest
					: never;
