export const CEAL_PROTOCOL_VERSION = "1.2.0" as const;

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
	membership_ref: string;
	registration_ref: string;
	client_ref: string;
	subject_ref: string;
	instance_ref: string;
	host_decision: "accepted";
	proof_level: "host_decision";
	non_claims: CealGatewayHostNonClaims;
}

export interface CealGatewayDiscoveryValue {
	schema_version: "ceal.gateway_discovery.v1";
	profile_ref: string;
	membership_ref: string;
	capabilities: CealGatewayDiscoveryCapability[];
	targets: CealGatewayDiscoveryTarget[];
	host_decision: "accepted";
	proof_level: "host_decision";
	non_claims: CealGatewayHostNonClaims;
}

export interface CealGatewayDiscoveryCapability {
	capability_id: string;
	label: string;
	effect: "read" | "write";
	target_requirement: "required" | "optional" | "none";
	input_contract: Record<string, unknown>;
	evidence_requirement: string;
	/** Required for a discovered write capability; absent for a read capability. */
	write_contract?: CealGatewayWriteContract;
}

/** Provider-neutral declaration of a governed mutation's operational boundary. */
export interface CealGatewayWriteContract {
	side_effect_class: "append_reply";
	idempotency: "required";
	dry_run: "unsupported";
	attribution: "subject";
	compensation: "irreversible";
	provider_readback: "required";
}

export type CealCapabilityReadiness = "ready" | "degraded" | "unavailable" | "unknown";

export interface CealCapabilityAccessDescriptor {
	schema_version: "ceal.capability_access.v1";
	capability_id: string;
	grant_ref: string;
	grant_revision: number;
	readiness: CealCapabilityReadiness;
}

export interface CealGatewayGrantedDiscoveryTarget {
	target_ref: string;
	label: string;
	access: "granted";
	capability_ids: string[];
	capability_access: CealCapabilityAccessDescriptor[];
}

export interface CealGatewayRequestRequiredDiscoveryTarget {
	target_ref: string;
	label: string;
	access: "request_required";
	capability_ids: [];
	capability_access: [];
}

export type CealGatewayDiscoveryTarget = CealGatewayGrantedDiscoveryTarget | CealGatewayRequestRequiredDiscoveryTarget;

export interface CealGatewayCallValue {
	schema_version: "ceal.gateway_call_result.v1";
	capability_id: string;
	target_ref: string;
	grant_ref: string;
	grant_revision: number;
	data: Record<string, unknown>;
	redaction: {
		state: "applied";
		omitted_classes: readonly string[];
	};
	host_decision: "accepted";
	proof_level: "host_decision";
	non_claims: CealGatewayHostNonClaims;
}

export interface CealGatewayMessageSearchResult {
	schema_version: "ceal.message_search_result.v1";
	query: { redacted: true; utf8_bytes: number; empty: false };
	offset: number;
	next_offset?: number;
	result_count: number;
	results: CealGatewayMessageSearchResultItem[];
	coverage: CealGatewayMessageSearchCoverage;
	minimization: {
		/** True only when an approved provider-origin source citation is returned. */
		raw_provider_ids_included: boolean;
		raw_messages_included: false;
		credential_material_included: false;
	};
}

export type CealGatewayMessageSearchCallValue = Omit<CealGatewayCallValue, "capability_id" | "data"> & {
	capability_id: "message.search";
	data: CealGatewayMessageSearchResult;
};

export interface CealGatewayMessageSearchCoverage {
	schema_version: "ceal.message_search_coverage.v1";
	source: "authoritative_index" | "bounded_projection";
	match_semantics: "backend_ranked" | "literal_case_insensitive" | "token_and_case_insensitive";
	reply_coverage: "included" | "excluded";
	completeness: "bounded" | "incomplete";
	truncated: boolean;
}

export interface CealGatewayMessageSearchResultItem {
	ref: string;
	thread_ref?: string;
	target_ref: string;
	created_at: string;
	source_label: string;
	text_preview: string;
	source?: CealGatewaySourceReference;
}

/** A safe provider-origin citation; never a bearer credential or Ceal action. */
export interface CealGatewaySourceReference {
	provider: "slack";
	url: string;
}

export interface CealGatewayMessageGetResult {
	schema_version: "ceal.message_get_result.v1";
	ref: string;
	source_label: string;
	source?: CealGatewaySourceReference;
	text: string;
	offset: number;
	next_offset?: number;
}

export interface CealGatewayResourceResolveResult {
	schema_version: "ceal.resource_resolve_result.v1";
	resource: {
		ref: string;
		kind: "message";
		source: CealGatewaySourceReference;
	};
}

export interface CealGatewayMessageCreateResult {
	schema_version: "ceal.message_create_result.v1";
	delivery: "verified" | "replayed";
	message_ref: string;
	reply_to: string;
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
	membership_ref: string;
	membership_revision: number;
	registration_ref: string;
	client_ref: string;
	client_revision: number;
	subject_ref: string;
	instance_ref: string;
	occurred_at: string;
	operation: CealGatewayRequest["operation"];
	auth_decision: "allowed" | "denied";
	policy_decision: "allowed" | "denied" | "not_evaluated";
	outcome: "succeeded" | "denied" | "failed";
	error_code: string | null;
	grant_snapshot?: CealGatewayAuthorizationSnapshot;
	call?: CealGatewayAuditCallDetail;
	proof_level: "host_decision";
	non_claims: CealGatewayHostNonClaims;
}

export interface CealGatewayAuthorizationSnapshot {
	schema_version: "ceal.gateway_authorization_snapshot.v1";
	capability_id: string;
	target_ref: string;
	grant_ref: string;
	grant_revision: number;
}

export interface CealGatewayMessageSearchAuditCallDetail {
	schema_version: "ceal.gateway_audit_call_detail.v1";
	capability_id: "message.search";
	target_ref: string;
	grant_ref: string;
	grant_revision: number;
	requested_limit: number;
	requested_offset?: number;
	query_utf8_bytes: number;
	result_count: number;
	coverage: CealGatewayMessageSearchCoverage;
}

export interface CealGatewayGenericAuditCallDetail {
	schema_version: "ceal.gateway_audit_call_detail.v1";
	capability_id: string;
	target_ref: string;
	grant_ref: string;
	grant_revision: number;
	input_summary: Record<string, unknown>;
	output_summary: Record<string, unknown>;
}

export type CealGatewayAuditCallDetail = CealGatewayMessageSearchAuditCallDetail | CealGatewayGenericAuditCallDetail;

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
