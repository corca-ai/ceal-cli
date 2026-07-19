export const CEAL_PROTOCOL_VERSION = "1.3.0" as const;

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

/**
 * Closed recovery vocabulary: clients branch on the class, never on server
 * prose. An unknown kind must be treated as absent (fall back to the local
 * code table), and a non-member value must never be echoed into agent context.
 */
export const CEAL_GATEWAY_RECOVERY_KINDS = [
	"retry",
	"re_authenticate",
	"select_granted_scope",
	"request_approval",
	"operator_restore",
	"upgrade_client",
	"none",
] as const;

export type CealGatewayRecoveryKind = (typeof CEAL_GATEWAY_RECOVERY_KINDS)[number];

export interface CealGatewayRecovery {
	kind: CealGatewayRecoveryKind;
	/** Bounded wait hint for kind "retry"; clients must clamp before use. */
	retry_after_ms?: number;
}

export interface CealClientFailure {
	ok: false;
	request_id: string;
	protocol_version: typeof CEAL_PROTOCOL_VERSION;
	proof_ref_or_unavailable?: CealProofReferenceOrUnavailable;
	error: { code: string; message: string; next_action?: string; recovery?: CealGatewayRecovery };
}

interface CealGatewayRequestEnvelope<TOperation extends CealClientOperation, TBody> {
	request_id: string;
	protocol_version: string;
	operation: TOperation;
	profile_ref: string;
	body: TBody;
}

export type CealGatewayHandshakeRequest = CealGatewayRequestEnvelope<"handshake", { client: { name: string; version: string } }>;
/**
 * A target catalog is intentionally selected in the Gateway rather than
 * mirrored into a worker. Empty discovery returns only the small capability
 * catalog; a capability plus match selects a bounded target page.
 */
export interface CealGatewayDiscoverBody {
	capability_id?: string;
	match?: string;
	cursor?: string;
	limit?: number;
}

export type CealGatewayDiscoverRequest = CealGatewayRequestEnvelope<"discover", CealGatewayDiscoverBody>;
export type CealGatewayCallRequest = CealGatewayRequestEnvelope<"call", { capability_id: string; target_ref: string; arguments: unknown; purpose: string }>;
export type CealGatewayReadbackRequest = CealGatewayRequestEnvelope<"readback", { request_id: string }>;
export type CealGatewayRequest = CealGatewayHandshakeRequest | CealGatewayDiscoverRequest | CealGatewayCallRequest | CealGatewayReadbackRequest;

export type CealGatewayHostNonClaim = "provider_execution_not_reached" | "production_audit_not_reached";
export type CealGatewayHostNonClaims = readonly CealGatewayHostNonClaim[];

/** One Profile the authenticated subject/client may currently select. */
export interface CealGatewayEligibleProfile {
	profile_ref: string;
	membership_ref: string;
}

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
	/**
	 * Optional eligible-Profile catalog: present only when the client negotiated
	 * for it (`x-ceal-profiles: accept`). Refs-only, may be empty, and is not
	 * emitted by an older Gateway or a non-negotiating client.
	 */
	eligible_profiles?: readonly CealGatewayEligibleProfile[];
}

export interface CealGatewayDiscoveryValue {
	schema_version: "ceal.gateway_discovery.v2";
	profile_ref: string;
	membership_ref: string;
	capabilities: CealGatewayDiscoveryCapability[];
	targets: CealGatewayDiscoveryTarget[];
	target_catalog: CealGatewayTargetCatalog;
	host_decision: "accepted";
	proof_level: "host_decision";
	non_claims: CealGatewayHostNonClaims;
}

/** Bounded metadata for a current Profile target selection. */
export interface CealGatewayTargetCatalog {
	target_count: number;
	returned_count: number;
	complete: boolean;
	selection_required: boolean;
	next_cursor?: string;
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
	side_effect_class: string;
	idempotency: "required" | "optional" | "not_required";
	provider_readback: "required" | "best_effort" | "not_available";
	[key: string]: unknown;
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

/**
 * Present only when a read result was served from the Gateway's profile-keyed
 * read cache (#606b) instead of a fresh provider call. It labels the served
 * result with the timestamp of the underlying provider read and its staleness,
 * so an agent is never silently handed a cached read as if it were live.
 *
 * This field is the SOLE live-vs-replay discriminator: a cache serve replays the
 * original serve's `non_claims` (the live-provenance form), because the data was
 * genuinely provider-fetched once and is provenance-equivalent. A decoder that
 * must distinguish a fresh serve from a cached replay MUST branch on the presence
 * of `cache_origin`, not on `non_claims`. The per-serve "this request did not
 * reach the provider" fact is on the audit ledger, not in the value's non_claims.
 */
export interface CealGatewayCacheOrigin {
	schema_version: "ceal.gateway_cache_origin.v1";
	/** ISO-8601 UTC timestamp of the underlying provider read this result replays. */
	origin_at: string;
	/** Milliseconds between that provider read and this serve — the served result's staleness. */
	age_ms: number;
}

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
	/** Set only on a cache serve; absent on a fresh provider-backed result. */
	cache_origin?: CealGatewayCacheOrigin;
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

export interface CealGatewayAuditCallDetail {
	schema_version: "ceal.gateway_audit_call_detail.v1";
	capability_id: string;
	target_ref: string;
	grant_ref: string;
	grant_revision: number;
	[key: string]: unknown;
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
