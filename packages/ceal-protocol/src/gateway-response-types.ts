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
	/**
	 * Additive multi-capability target selection. Each returned target still
	 * carries only the capability-specific grants it actually has.
	 */
	capability_ids?: string[];
	match?: string;
	cursor?: string;
	limit?: number;
}

export type CealGatewayDiscoverRequest = CealGatewayRequestEnvelope<"discover", CealGatewayDiscoverBody>;
export type CealGatewayCallRequest = CealGatewayRequestEnvelope<"call", { capability_id: string; target_ref: string; arguments: unknown; purpose: string }>;
/** Reads the Gateway journal entry for one earlier request made by this binding. */
export type CealGatewayAuditReadbackRequest = CealGatewayRequestEnvelope<"readback", { request_id: string }>;
/**
 * Reads one redacted provider-write receipt. The opaque reference is accepted
 * only as a lookup capability: it must never be echoed in a response, journal,
 * or receipt projection.
 */
export type CealGatewayWriteReceiptRequest = CealGatewayRequestEnvelope<"readback", { write_request_ref: string }>;
export type CealGatewayReadbackRequest = CealGatewayAuditReadbackRequest | CealGatewayWriteReceiptRequest;
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
	/**
	 * Optional, negotiated, non-authorizing policy explanation for a newer
	 * client. Its absence means scope is not declared by the Gateway; it never
	 * changes ordinary discovery, grants, target selection, or call policy.
	 */
	announcement_policy?: CealGatewayAnnouncementPolicy;
}

export type CealGatewayAnnouncementPolicyNonClaim =
	| "policy_projection_does_not_authorize"
	| "provider_roundtrip_not_established_by_discovery"
	| "target_specific_scope_not_declared";

export type CealGatewayAnnouncementScopeStatementKind =
	| "github_app_installation_repositories"
	| "slack_public_app_member_channels_only"
	| "notion_connected_logical_area"
	| "google_workspace_ceal_drive_or_direct_share"
	| "google_workspace_calendar_read_only"
	| "google_workspace_ceal_drive_or_direct_share_metadata"
	| "google_workspace_ceal_drive_or_direct_share_sheet_ranges"
	| "google_workspace_ceal_drive_or_direct_share_editable_sheet_ranges";

/** A deliberately small client-safe projection of the installed app authority. */
export type CealGatewayAnnouncementProviderAuthority =
	| { kind: "github_app"; granted_permissions: readonly string[] }
	| { kind: "slack_app"; oauth_scope_observation: "not_exposed_by_current_connector" }
	| { kind: "notion_integration"; sharing: "provider_enforced"; descendant_inventory: "not_enumerable" }
	| { kind: "google_service_account"; requested_api_scopes: readonly string[] };

/**
 * Gateway-owned policy context for announcement/onboarding rendering. This is
 * capability-level and intentionally cannot carry target, grant, binding,
 * credential, evidence, or provider-resource identity.
 */
export interface CealGatewayAnnouncementPolicy {
	schema_version: "ceal.gateway_announcement_policy.v1";
	scope_statement_kind: CealGatewayAnnouncementScopeStatementKind;
	scope_statement: string;
	provider_application_authority: CealGatewayAnnouncementProviderAuthority;
	explicit_request_required: boolean;
	provenance_requirement: "gateway_receipt_audit" | "explicit_requester_event_gateway_receipt_audit_provider_readback";
	non_claims: readonly CealGatewayAnnouncementPolicyNonClaim[];
}

/** Provider-neutral declaration of a governed mutation's operational boundary. */
export interface CealGatewayWriteContract {
	side_effect_class: string;
	idempotency: "required" | "optional" | "not_required";
	provider_readback: "required" | "best_effort" | "not_available";
	/** Present only when an announcement policy may describe this mutation. */
	attribution?: "subject" | "requester_event";
	/** Closed Gateway attestation of the requester/event provenance binding. */
	provenance_binding?: "gateway_attested_requester_event_v1";
	[key: string]: unknown;
}

export type CealCapabilityReadiness = "ready" | "degraded" | "unavailable" | "unknown";

/**
 * A static, bounded description of one Gateway-owned capability quota.
 *
 * This is a policy shape, not a live balance: it lets a client choose a page
 * size and pacing strategy without disclosing another principal's remaining
 * quota, request history, or provider headers.
 */
export interface CealGatewayRateLimitPolicy {
	schema_version: "ceal.gateway_rate_limit_policy.v1";
	/** One validated governed capability invocation is charged, independent of result/page size. */
	counted_unit: "governed_call";
	/** The bucket belongs to the authenticated Gateway principal for this capability, not a target or returned record. */
	scope: "authenticated_principal";
	/** Calls age out individually after `window_ms`; this is not a token bucket. */
	window_model: "rolling";
	max_calls: number;
	window_ms: number;
}

export interface CealCapabilityAccessDescriptor {
	schema_version: "ceal.capability_access.v1";
	capability_id: string;
	grant_ref: string;
	grant_revision: number;
	readiness: CealCapabilityReadiness;
	/** Present only when the client negotiated the additive rate-limit policy projection. */
	rate_limit?: CealGatewayRateLimitPolicy;
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
	/** Emitted only when the client negotiated `x-ceal-route-provenance: accept`. */
	connector_route_failure?: CealGatewayConnectorRouteFailure;
	/** Emitted only when the client negotiated `x-ceal-audit-timing: accept`. */
	gateway_elapsed_ms?: number;
	grant_snapshot?: CealGatewayAuthorizationSnapshot;
	call?: CealGatewayAuditCallDetail;
	proof_level: "host_decision";
	non_claims: CealGatewayHostNonClaims;
}

/** Safe pre-provider provenance for a connector-owned route failure. */
export interface CealGatewayConnectorRouteFailure {
	schema_version: "ceal.gateway_connector_route_failure.v1";
	connector_kind: string;
	phase: "scope_observation" | "target_selection" | "route_resolution";
	/**
	 * Present only when the Gateway classified the failure; an unclassified
	 * failure omits the key rather than publishing a zero-information value.
	 * Only `provider_throttled` is cleared by the caller waiting; the others
	 * need operator or binding repair.
	 */
	cause?: "provider_throttled" | "provider_unavailable" | "binding_invalid" | "scope_limit_exceeded";
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

/** Content-free, binding-scoped projection of a Gateway-owned provider write. */
export interface CealGatewayWriteRequestReceipt {
	schema_version: "ceal.gateway_write_request_receipt.v1";
	write_request_sha256: string;
	source_kind: "authenticated_registered_client" | "agent_lease_admission" | "provider_authenticated_event";
	source_evidence_sha256: string;
	purpose_sha256?: string;
	admission_context_sha256?: string;
	idempotency_claim_sha256: string;
	normalized_mutation_sha256: string;
	provider_state: "outcome_unknown" | "verified";
	provider_readback: "outcome_unknown" | "verified";
	provider_result_sha256?: string;
}

export interface CealGatewayWriteReceiptReadbackValue {
	schema_version: "ceal.gateway_write_receipt_readback.v1";
	receipt: CealGatewayWriteRequestReceipt;
}

export type CealGatewayResponseFor<R extends CealGatewayRequest> =
	R extends CealGatewayHandshakeRequest ? CealClientSuccess<CealGatewayHandshakeValue> | CealClientFailure
		: R extends CealGatewayDiscoverRequest ? CealClientSuccess<CealGatewayDiscoveryValue> | CealClientFailure
			: R extends CealGatewayCallRequest ? CealClientSuccess<CealGatewayCallValue> | CealGatewayPolicyDenial | CealClientFailure
				: R extends CealGatewayAuditReadbackRequest ? CealClientSuccess<CealGatewayAuditReadbackValue> | CealClientFailure
					: R extends CealGatewayWriteReceiptRequest ? CealClientSuccess<CealGatewayWriteReceiptReadbackValue> | CealClientFailure
						: never;

type WithoutProtocol<T> = T extends CealGatewayRequest ? Omit<T, "protocol_version"> : never;

export type CealGatewayRequestInput = WithoutProtocol<CealGatewayRequest>;

export type CealGatewayRequestForInput<I extends CealGatewayRequestInput> =
	I extends { operation: "handshake" } ? CealGatewayHandshakeRequest
		: I extends { operation: "discover" } ? CealGatewayDiscoverRequest
			: I extends { operation: "call" } ? CealGatewayCallRequest
			: I extends { operation: "readback"; body: { request_id: string } } ? CealGatewayAuditReadbackRequest
				: I extends { operation: "readback"; body: { write_request_ref: string } } ? CealGatewayWriteReceiptRequest
					: never;
