/**
 * Lane: leased Agent control carrier. This is neither the Worker-facing
 * `ceal capabilities`/`ceal call` protocol nor the legacy instance runtime.
 * Owner: docs/specs/gateway-leased-consumer-control.spec.md.
 *
 * These canonical private records never carry a personal session, provider
 * credential or locator, endpoint selector, or Agent-supplied service
 * authority. Selected v5 may disclose one bounded requester account identity
 * beside an opaque subject ref; that context is neither a locator nor
 * authority.
 */
import { isAuthorityStateKey, requireJsonByteSize } from "./gateway-validation-primitives.js";
import { validCealLeasedConsumerMessageAuthor, type CealLeasedConsumerMessageAuthor } from "./leased-consumer-message-author.js";
export type { CealLeasedConsumerMessageAuthor } from "./leased-consumer-message-author.js";
import { CEAL_LEASED_CONSUMER_SURVEY_DISPATCH_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerSurveyDispatchArguments, decodeCealLeasedConsumerSurveyDispatchData } from "./leased-consumer-survey-dispatch.js";
import { opaqueArtifactRef, opaqueMessageRef, opaqueResultRef, opaqueTargetRef, opaqueThreadRef, safeReplyReceiptRef } from "./leased-consumer-opaque-refs.js";
import { CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerPeopleSearchArguments, validCealLeasedConsumerReadItemDetail, validCealLeasedConsumerSubjectRef, type CealLeasedConsumerResourceReadItem } from "./leased-consumer-directory-reads.js";
export { CEAL_LEASED_CONSUMER_SURVEY_DISPATCH_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_SURVEY_DISPATCH_DATA_SCHEMA } from "./leased-consumer-survey-dispatch.js";
import {
	CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_CONTROL_LABEL_MAX_BYTES, CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_CONTROL_TOKEN_MAX_BYTES, CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_MAX_CONTROLS, CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_SCHEMA, CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_V2_SCHEMA, validCealLeasedConsumerCompletedPhaseHistory, type CealLeasedConsumerMessagePresentation,
} from "./leased-consumer-presentation.js";
export const CEAL_LEASED_CONSUMER_CONTROL_SESSION_SCHEMA = "ceal.leased_consumer_control_session.v1" as const;
export const CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA = "ceal.leased_consumer_control_request.v1" as const;
export const CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA = "ceal.leased_consumer_control_response.v1" as const;
export const CEAL_LEASED_CONSUMER_RESULT_CONTROL_REQUEST_SCHEMA = "ceal.leased_consumer_result_control_request.v2" as const;
export const CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA = "ceal.leased_consumer_result_control_response.v2" as const;
/**
 * v3 adds the terminal Gateway-owned reply operation.  It must not reuse v2:
 * a signed older worker must reject the new operation before it can mistake a
 * reply acknowledgement for any existing control result.
 */
export const CEAL_LEASED_CONSUMER_REPLY_CONTROL_REQUEST_SCHEMA = "ceal.leased_consumer_reply_control_request.v3" as const;
export const CEAL_LEASED_CONSUMER_REPLY_CONTROL_RESPONSE_SCHEMA = "ceal.leased_consumer_reply_control_response.v3" as const;
export const CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_SCHEMA = "ceal.gateway_leased_agent_delegated_read_result.v1" as const;
/**
 * v4 replaces the read-named result carrier with a generic capability result.
 * It is intentionally distinct from v3: a selected v4 generation must reject
 * v3 terminal reply frames rather than silently narrowing Runner behavior.
 */
export const CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA = "ceal.leased_consumer_capability_control_request.v4" as const;
export const CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA = "ceal.leased_consumer_capability_control_response.v4" as const;
export const CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA = "ceal.gateway_leased_agent_capability_result.v1" as const;
export const CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_message_search_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_MESSAGE_GET_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_message_get_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_CONVERSATION_THREAD_GET_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_conversation_thread_get_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_message_create_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_message_update_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_MESSAGE_DELETE_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_message_delete_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_MESSAGE_ENUMERATE_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_message_enumerate_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_RESOURCE_RESOLVE_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_resource_resolve_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_PRESENTATION_ACTIVITY_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_presentation_activity_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_RESOURCE_READ_DATA_SCHEMA = "ceal.gateway_leased_agent_resource_read_data.v2" as const;
export const CEAL_LEASED_CONSUMER_PRESENTATION_ACTIVITY_DATA_SCHEMA = "ceal.gateway_leased_agent_presentation_activity_data.v1" as const;
export const CEAL_LEASED_CONSUMER_MESSAGE_REACTION_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_message_reaction_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_MESSAGE_REACTION_DATA_SCHEMA = "ceal.gateway_leased_agent_message_reaction_data.v1" as const;
export const CEAL_LEASED_CONSUMER_USERGROUPS_LIST_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_usergroups_list_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_USERGROUP_MEMBERS_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_usergroup_members_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_PROFILE_IMAGE_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_profile_image_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_DIRECT_RESOLVE_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_direct_resolve_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_REPLY_INTAKE_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_reply_intake_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_REPLY_INTAKE_DATA_SCHEMA = "ceal.gateway_leased_agent_reply_intake_data.v1" as const;
export const CEAL_LEASED_CONSUMER_ARTIFACT_STAGE_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_artifact_stage_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_ARTIFACT_STAGE_DATA_SCHEMA = "ceal.gateway_leased_agent_artifact_stage_data.v1" as const;
export const CEAL_LEASED_CONSUMER_FILE_UPLOAD_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_file_upload_arguments.v1" as const;
/** Raw bytes per staging chunk; base64 expansion stays inside the 32KiB frame. */
export const CEAL_LEASED_CONSUMER_ARTIFACT_CHUNK_MAX_BYTES = 12 * 1024;
export const CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA = "ceal.gateway_leased_agent_message_read_data.v2" as const;
export const CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA = "ceal.gateway_leased_agent_message_write_data.v1" as const;
/** Upper bound of ordered continuation message handles one write may return. */
export const CEAL_LEASED_CONSUMER_WRITE_MESSAGE_HANDLE_LIMIT = 16;
export const CEAL_LEASED_CONSUMER_MESSAGE_DELETE_DATA_SCHEMA = "ceal.gateway_leased_agent_message_delete_data.v1" as const;
export const CEAL_LEASED_CONSUMER_CONTROL_MAX_SESSION_BYTES = 8 * 1024;
export const CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES = 32 * 1024;
export const CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_MAX_BYTES = 24 * 1024;

export type CealLeasedConsumerControlOperation = "acquire" | "projection" | "recheck" | "call" | "complete";
export type CealLeasedConsumerReplyControlOperation = CealLeasedConsumerControlOperation | "reply";
export type CealLeasedConsumerCapabilityControlOperation = CealLeasedConsumerControlOperation;
export type CealLeasedConsumerControlDisposition = "completed" | "failed" | "cancelled" | "deferred";

export interface CealLeasedConsumerControlSession {
	schema_version: typeof CEAL_LEASED_CONSUMER_CONTROL_SESSION_SCHEMA;
	transport: "unix_socket";
	socket_path: string;
	service_credential: string;
}

export interface CealLeasedConsumerControlLease {
	event_ref: string;
	lease_ref: string;
	lease_fence: number;
	delivery_attempt: number;
	expires_at: string;
}

export type CealLeasedConsumerControlRequest =
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA; operation: "acquire"; input: Record<string, never> }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA; operation: "projection" | "recheck"; input: CealLeasedConsumerControlLeaseInput }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA; operation: "call"; input: CealLeasedConsumerCallInput }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA; operation: "complete"; input: CealLeasedConsumerControlCompleteInput };

export interface CealLeasedConsumerControlLeaseInput {
	event_ref: string;
	lease_ref: string;
	lease_fence: number;
}

export interface CealLeasedConsumerCallInput extends CealLeasedConsumerControlLeaseInput {
	schema_version: "ceal.gateway_leased_consumer_call_request.v1";
	capability_id: string;
	target_ref: string;
	purpose: string;
	arguments: unknown;
	idempotency_key?: string;
}

export interface CealLeasedConsumerControlCompleteInput extends CealLeasedConsumerControlLeaseInput {
	disposition: CealLeasedConsumerControlDisposition;
	agent_run_ref?: string;
}

export type CealLeasedConsumerControlResponse =
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA; operation: "acquire"; result: CealLeasedConsumerControlAcquireResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA; operation: "projection"; result: CealLeasedConsumerControlProjectionResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA; operation: "recheck"; result: CealLeasedConsumerControlRecheckResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA; operation: "call"; result: CealLeasedConsumerControlCallResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA; operation: "complete"; result: CealLeasedConsumerControlCompleteResult };

type CealLeasedConsumerControlAuthenticationFailure = { status: "authentication_failed" };
type CealLeasedConsumerControlUnavailable = { status: "control_unavailable" };

export type CealLeasedConsumerControlAcquireResult =
	| { status: "leased" | "consumer_busy"; lease: CealLeasedConsumerControlLease }
	| { status: "idle" | "consumer_conflict" | "stale_generation" }
	| CealLeasedConsumerControlAuthenticationFailure
	| CealLeasedConsumerControlUnavailable;
export type CealLeasedConsumerControlProjectionResult =
	| { status: "available"; event_ref: string; event_revision: number; normalized_projection_ref: string; normalized_projection_revision: number; projection: CealLeasedConsumerNormalizedProjection }
	| CealLeasedConsumerControlTerminalResult
	| CealLeasedConsumerControlAuthenticationFailure
	| CealLeasedConsumerControlUnavailable;
export type CealLeasedConsumerControlRecheckResult =
	| { status: "active"; lease: CealLeasedConsumerControlLease }
	| CealLeasedConsumerControlTerminalResult
	| CealLeasedConsumerControlAuthenticationFailure
	| CealLeasedConsumerControlUnavailable;
export type CealLeasedConsumerControlCallResult =
	| { status: "lease_lost" | "lease_expired" | "action_scope_unavailable" | "action_scope_mismatch" | "leased_consumer_call_unavailable" }
	| CealLeasedConsumerControlAuthenticationFailure;
export type CealLeasedConsumerControlCompleteResult =
	| { status: "completed"; replayed: boolean }
	| CealLeasedConsumerControlTerminalResult
	| CealLeasedConsumerControlAuthenticationFailure
	| CealLeasedConsumerControlUnavailable;
export type CealLeasedConsumerControlTerminalResult = { status: "lease_lost" | "lease_expired" | "event_settled" };

/**
 * The result carrier is intentionally a separate protocol revision. v1 remains
 * status-only so an installed older worker rejects a result-bearing frame
 * rather than treating it as a successful but malformed call.
 */
export type CealLeasedConsumerResultControlRequest =
	| { schema_version: typeof CEAL_LEASED_CONSUMER_RESULT_CONTROL_REQUEST_SCHEMA; operation: "acquire"; input: Record<string, never> }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_RESULT_CONTROL_REQUEST_SCHEMA; operation: "projection" | "recheck"; input: CealLeasedConsumerControlLeaseInput }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_RESULT_CONTROL_REQUEST_SCHEMA; operation: "call"; input: CealLeasedConsumerCallInput }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_RESULT_CONTROL_REQUEST_SCHEMA; operation: "complete"; input: CealLeasedConsumerControlCompleteInput };

export type CealLeasedConsumerResultControlResponse =
	| { schema_version: typeof CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA; operation: "acquire"; result: CealLeasedConsumerControlAcquireResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA; operation: "projection"; result: CealLeasedConsumerControlProjectionResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA; operation: "recheck"; result: CealLeasedConsumerControlRecheckResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA; operation: "call"; result: CealLeasedConsumerResultControlCallResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA; operation: "complete"; result: CealLeasedConsumerControlCompleteResult };

/** The v3 reply carrier retains all v2 operation meanings and adds one terminal reply. */
export type CealLeasedConsumerReplyControlRequest =
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_CONTROL_REQUEST_SCHEMA; operation: "acquire"; input: Record<string, never> }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_CONTROL_REQUEST_SCHEMA; operation: "projection" | "recheck"; input: CealLeasedConsumerControlLeaseInput }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_CONTROL_REQUEST_SCHEMA; operation: "call"; input: CealLeasedConsumerCallInput }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_CONTROL_REQUEST_SCHEMA; operation: "complete"; input: CealLeasedConsumerControlCompleteInput }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_CONTROL_REQUEST_SCHEMA; operation: "reply"; input: CealLeasedConsumerReplyInput };

export interface CealLeasedConsumerReplyInput extends CealLeasedConsumerControlLeaseInput {
	text: string;
}

export type CealLeasedConsumerReplyControlResponse =
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_CONTROL_RESPONSE_SCHEMA; operation: "acquire"; result: CealLeasedConsumerControlAcquireResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_CONTROL_RESPONSE_SCHEMA; operation: "projection"; result: CealLeasedConsumerControlProjectionResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_CONTROL_RESPONSE_SCHEMA; operation: "recheck"; result: CealLeasedConsumerControlRecheckResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_CONTROL_RESPONSE_SCHEMA; operation: "call"; result: CealLeasedConsumerResultControlCallResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_CONTROL_RESPONSE_SCHEMA; operation: "complete"; result: CealLeasedConsumerControlCompleteResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_CONTROL_RESPONSE_SCHEMA; operation: "reply"; result: CealLeasedConsumerReplyResult };

export type CealLeasedConsumerReplyResult =
	| { status: "replied"; receipt_ref: string; replayed: boolean }
	| { status: "lease_lost" | "lease_expired" | "event_settled" | "reply_not_eligible" | "reply_unavailable" | "authentication_failed" };

/**
 * v4 has no special-case Agent method. Each call retains the same generic
 * capability id/target/arguments shape and returns typed opaque handles. A
 * provider identifier must never appear in `data` or as a handle reference.
 */
export type CealLeasedConsumerCapabilityControlRequest =
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA; operation: "acquire"; input: Record<string, never> }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA; operation: "projection" | "recheck"; input: CealLeasedConsumerControlLeaseInput }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA; operation: "call"; input: CealLeasedConsumerCapabilityCallInput }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA; operation: "complete"; input: CealLeasedConsumerControlCompleteInput };

/**
 * The v4 boundary receives a Gateway-issued target handle, never a provider
 * target.  The Gateway binds that handle to capability, route, generation and
 * the active lease before it invokes a provider.
 */
export interface CealLeasedConsumerCapabilityCallInput extends CealLeasedConsumerControlLeaseInput {
	schema_version: "ceal.gateway_leased_consumer_call_request.v1";
	capability_id: string;
	target_ref: string;
	purpose: string;
	arguments: CealLeasedConsumerCapabilityArguments;
	idempotency_key?: string;
}

/** Only installed v4 capabilities get a closed request DTO in this revision. */
export type CealLeasedConsumerCapabilityArguments =
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_SCHEMA; query: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_GET_ARGUMENTS_SCHEMA; message_ref: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CONVERSATION_THREAD_GET_ARGUMENTS_SCHEMA; thread_ref: string; limit: number }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA; reply_to?: string; text: string; presentation?: CealLeasedConsumerMessagePresentation }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA; message_ref: string; text: string; presentation?: CealLeasedConsumerMessagePresentation }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_DELETE_ARGUMENTS_SCHEMA; message_ref: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_ENUMERATE_ARGUMENTS_SCHEMA; limit: number }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_RESOURCE_RESOLVE_ARGUMENTS_SCHEMA; kind: "conversation" | "identity" | "usergroup" | "permalink"; query: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_PRESENTATION_ACTIVITY_ARGUMENTS_SCHEMA; activity: "typing" | "none" }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_REACTION_ARGUMENTS_SCHEMA; message_ref: string; name: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_USERGROUPS_LIST_ARGUMENTS_SCHEMA; include_disabled?: boolean }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_USERGROUP_MEMBERS_ARGUMENTS_SCHEMA; usergroup: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_PROFILE_IMAGE_ARGUMENTS_SCHEMA; subject_ref: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_DIRECT_RESOLVE_ARGUMENTS_SCHEMA; subject_ref: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_ARGUMENTS_SCHEMA; query?: string; limit?: number }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_INTAKE_ARGUMENTS_SCHEMA; root_ref: string; workflow_name: string | null; skill_name?: string; routing: "normal" | "skill"; mode: "human_replies" }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_ARTIFACT_STAGE_ARGUMENTS_SCHEMA; upload_ref: string; chunk_index: number; chunk_count: number; sha256: string; bytes_base64: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_FILE_UPLOAD_ARGUMENTS_SCHEMA; artifact_ref: string; title?: string; reply_to?: string };

export type CealLeasedConsumerCapabilityControlResponse =
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA; operation: "acquire"; result: CealLeasedConsumerControlAcquireResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA; operation: "projection"; result: CealLeasedConsumerCapabilityProjectionResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA; operation: "recheck"; result: CealLeasedConsumerCapabilityRecheckResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA; operation: "call"; result: CealLeasedConsumerCapabilityControlCallResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA; operation: "complete"; result: CealLeasedConsumerControlCompleteResult };

/**
 * A projection is the sole v4 bootstrap for Runner compatibility handles.
 * These values are opaque Gateway-issued references, bound again at call time;
 * the Agent receives neither a provider locator nor a general handle minting
 * operation.
 */
export type CealLeasedConsumerCapabilityProjectionResult =
	| {
		status: "available";
		event_ref: string;
		event_revision: number;
		normalized_projection_ref: string;
		normalized_projection_revision: number;
		/**
		 * Stable opaque conversation identity (S1 decision, 2026-08-04): a
		 * Gateway-keyed digest of the provider conversation coordinates that
		 * stays identical across turns, leases, and generations for the same
		 * conversation, so the Agent can key its thread state without ever
		 * seeing a provider identifier. It is not a handle and resolves to
		 * nothing.
		 */
		conversation_ref: string;
		/**
		 * Requester identity for turn construction (S2, 2026-08-04): the
		 * Gateway-native subject ref (never a provider identifier) plus an
		 * optional human-readable display name. Absence of the display name is
		 * typed, so the Agent falls back explicitly instead of degrading
		 * silently.
		 */
		requester: { subject_ref: string; display_name?: string; provider_identity?: { provider: string; account_id: string } };
		/**
		 * Inbound attachment boundary (S2, 2026-08-04): the projection states
		 * how many verified inbound attachments the event carries and the
		 * Gateway-native set ref (null when none). Materialization is a later
		 * capability; carrying the presence here keeps an attachment-bearing
		 * turn a typed decision instead of a silent drop.
		 */
		attachments: { count: number; set_ref: string | null };
		projection: CealLeasedConsumerNormalizedProjection;
		capability_contexts: readonly CealLeasedConsumerCapabilityContext[];
	}
	| CealLeasedConsumerControlTerminalResult
	| CealLeasedConsumerControlAuthenticationFailure
	| { status: "control_unavailable" };

export interface CealLeasedConsumerCapabilityContext {
	capability_id: string;
	target_ref: string;
	message_ref: string;
	thread_ref: string;
}

/**
 * v4 recheck is also the abort transport (S1 decision, 2026-08-04): Gateway
 * core owns interaction custody, and the Agent learns a human abort request
 * mid-turn from the required `abort_requested` flag on its ordinary lease
 * recheck instead of a second signalling channel. An abort click is a control
 * signal on the current turn, never a new turn.
 */
export type CealLeasedConsumerCapabilityRecheckResult =
	| { status: "active"; lease: CealLeasedConsumerControlLease; abort_requested: boolean }
	| CealLeasedConsumerControlTerminalResult
	| CealLeasedConsumerControlAuthenticationFailure
	| { status: "control_unavailable" };

export interface CealLeasedConsumerCapabilityResult {
	schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA;
	capability_id: string;
	effect: "read" | "write";
	result_ref: string;
	handles: readonly CealLeasedConsumerCapabilityHandle[];
	data: CealLeasedConsumerCapabilityData;
}

/**
 * Result content is a selected capability projection, never a provider
 * response. Message authors are Profile-keyed opaque descriptors; actionable
 * resource identities remain exclusively in `handles`.
 */
export type CealLeasedConsumerCapabilityData =
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA; items: readonly { text: string; author?: CealLeasedConsumerMessageAuthor }[] }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA; terminal: "readback_confirmed" | "idempotency_replayed"; text?: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_DELETE_DATA_SCHEMA; terminal: "readback_confirmed" | "idempotency_replayed" }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_RESOURCE_READ_DATA_SCHEMA; truncated?: boolean; items: readonly CealLeasedConsumerResourceReadItem[] }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_PRESENTATION_ACTIVITY_DATA_SCHEMA; terminal: "acknowledged" | "idempotency_replayed" }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_REACTION_DATA_SCHEMA; terminal: "readback_confirmed" | "idempotency_replayed" }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_INTAKE_DATA_SCHEMA; terminal: "registered" | "idempotency_replayed" }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_ARTIFACT_STAGE_DATA_SCHEMA; terminal: "chunk_accepted" | "artifact_ready" | "idempotency_replayed" };

export interface CealLeasedConsumerCapabilityHandle {
	kind: "target" | "message" | "thread" | "artifact";
	ref: string;
}

export type CealLeasedConsumerCapabilityControlCallResult =
	| { status: "result"; result: CealLeasedConsumerCapabilityResult }
	| { status: "lease_lost" | "lease_expired" | "action_scope_unavailable" | "action_scope_mismatch" | "capability_unavailable" | "capability_result_unavailable" | "write_unknown" | "result_not_replayable" }
	| CealLeasedConsumerControlAuthenticationFailure;

export interface CealLeasedConsumerDelegatedReadResult {
	schema_version: typeof CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_SCHEMA;
	capability_id: string;
	data: unknown;
}

export type CealLeasedConsumerResultControlCallResult =
	| { status: "result"; result: CealLeasedConsumerDelegatedReadResult }
	| { status: "lease_lost" | "lease_expired" | "action_scope_unavailable" | "action_scope_mismatch" | "delegated_read_unavailable" | "result_not_replayable" }
	| CealLeasedConsumerControlAuthenticationFailure;

export interface CealLeasedConsumerNormalizedProjection {
	schema_version: "ceal.gateway_normalized_projection.v1";
	text: string;
	context?: { conversation_kind: "channel" | "dm" | "group"; is_thread_reply: boolean; trigger?: "scheduled" };
}

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const CONTROL_OPERATIONS = new Set<CealLeasedConsumerControlOperation>(["acquire", "projection", "recheck", "call", "complete"]);
const REPLY_CONTROL_OPERATIONS = new Set<CealLeasedConsumerReplyControlOperation>(["acquire", "projection", "recheck", "call", "complete", "reply"]);
const CAPABILITY_CONTROL_OPERATIONS = new Set<CealLeasedConsumerCapabilityControlOperation>(["acquire", "projection", "recheck", "call", "complete"]);
const TERMINAL_STATUSES = new Set<CealLeasedConsumerControlTerminalResult["status"]>(["lease_lost", "lease_expired", "event_settled"]);
// The v4 capability ABI sets are exported so Gateway tables (handle resolver,
// context issuer, result projectors) and conformance vectors can prove
// set-equality against this single source instead of re-declaring literals.
export const CEAL_LEASED_CONSUMER_V4_READ_CAPABILITY_IDS = Object.freeze(["message.search", "message.get", "conversation.thread.get", "message.enumerate", "resource.resolve", "directory.usergroups.list", "directory.usergroups.members.list", "directory.people.search", "identity.profile_image.get", "conversation.direct.resolve"] as const);
export const CEAL_LEASED_CONSUMER_V4_WRITE_CAPABILITY_IDS = Object.freeze(["message.create", "message.update", "message.delete", "presentation.activity.set", "message.reaction.add", "workflow.reply_intake.register", "workflow.survey_dispatch.send", "artifact.stage", "file.upload"] as const);
// Delete and update intentionally have no ingress bootstrap context. The
// ingress message is normally user-authored, and the continuation store is
// deny-default for updateability: a mutation handle exists only after a
// Gateway-owned `message.create` readback (or an already-authorized update)
// records `updateable: true`. Update reachability therefore bootstraps from
// minted mutation handles, never from the ingress projection.
// `message.reaction.add` joined the ingress set in Goal 2 S3: the legacy
// ack-reaction on the trigger message is a cutover-blocking behavior, a
// reaction never mutates content (deny-default updateability is untouched),
// and the reaction-bound handle still resolves only for that one message.
export const CEAL_LEASED_CONSUMER_V4_INGRESS_CONTEXT_CAPABILITY_IDS = Object.freeze(["message.search", "message.get", "conversation.thread.get", "message.create", "message.enumerate", "resource.resolve", "message.reaction.add", "workflow.survey_dispatch.send"] as const);
const V4_READ_CAPABILITIES = new Set<string>(CEAL_LEASED_CONSUMER_V4_READ_CAPABILITY_IDS);
const V4_WRITE_CAPABILITIES = new Set<string>(CEAL_LEASED_CONSUMER_V4_WRITE_CAPABILITY_IDS);
const V4_INGRESS_CONTEXT_CAPABILITIES = new Set<string>(CEAL_LEASED_CONSUMER_V4_INGRESS_CONTEXT_CAPABILITY_IDS);
// One grammar row per capability: id, argument schema, argument decoder. The
// decoder map, declared-id list, and exported argument-schema map are all
// derived from this single table so a consumer fixture (Goal 2 S0 mirror
// repair) can be generated from — and set-equality-checked against — the same
// source the wire decoders use.
const V4_CAPABILITY_GRAMMAR: ReadonlyArray<readonly [string, string, (value: unknown) => void]> = [
	["message.search", CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_SCHEMA, decodeMessageSearchArguments],
	["message.get", CEAL_LEASED_CONSUMER_MESSAGE_GET_ARGUMENTS_SCHEMA, decodeMessageGetArguments],
	["conversation.thread.get", CEAL_LEASED_CONSUMER_CONVERSATION_THREAD_GET_ARGUMENTS_SCHEMA, decodeConversationThreadGetArguments],
	["message.create", CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA, decodeMessageCreateArguments],
	["message.update", CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, decodeMessageUpdateArguments],
	["message.delete", CEAL_LEASED_CONSUMER_MESSAGE_DELETE_ARGUMENTS_SCHEMA, decodeMessageDeleteArguments],
	["message.enumerate", CEAL_LEASED_CONSUMER_MESSAGE_ENUMERATE_ARGUMENTS_SCHEMA, decodeMessageEnumerateArguments],
	["resource.resolve", CEAL_LEASED_CONSUMER_RESOURCE_RESOLVE_ARGUMENTS_SCHEMA, decodeResourceResolveArguments],
	["presentation.activity.set", CEAL_LEASED_CONSUMER_PRESENTATION_ACTIVITY_ARGUMENTS_SCHEMA, decodePresentationActivityArguments],
	["message.reaction.add", CEAL_LEASED_CONSUMER_MESSAGE_REACTION_ARGUMENTS_SCHEMA, decodeMessageReactionArguments],
	["directory.usergroups.list", CEAL_LEASED_CONSUMER_USERGROUPS_LIST_ARGUMENTS_SCHEMA, decodeUsergroupsListArguments],
	["directory.usergroups.members.list", CEAL_LEASED_CONSUMER_USERGROUP_MEMBERS_ARGUMENTS_SCHEMA, decodeUsergroupMembersArguments],
	["directory.people.search", CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerPeopleSearchArguments],
	["identity.profile_image.get", CEAL_LEASED_CONSUMER_PROFILE_IMAGE_ARGUMENTS_SCHEMA, decodeSubjectReadArguments(CEAL_LEASED_CONSUMER_PROFILE_IMAGE_ARGUMENTS_SCHEMA)],
	["conversation.direct.resolve", CEAL_LEASED_CONSUMER_DIRECT_RESOLVE_ARGUMENTS_SCHEMA, decodeSubjectReadArguments(CEAL_LEASED_CONSUMER_DIRECT_RESOLVE_ARGUMENTS_SCHEMA)],
	["workflow.reply_intake.register", CEAL_LEASED_CONSUMER_REPLY_INTAKE_ARGUMENTS_SCHEMA, decodeReplyIntakeArguments],
	["workflow.survey_dispatch.send", CEAL_LEASED_CONSUMER_SURVEY_DISPATCH_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerSurveyDispatchArguments],
	["artifact.stage", CEAL_LEASED_CONSUMER_ARTIFACT_STAGE_ARGUMENTS_SCHEMA, decodeArtifactStageArguments],
	["file.upload", CEAL_LEASED_CONSUMER_FILE_UPLOAD_ARGUMENTS_SCHEMA, decodeFileUploadArguments],
];
const V4_CAPABILITY_ARGUMENT_DECODERS = new Map<string, (value: unknown) => void>(V4_CAPABILITY_GRAMMAR.map(([id, , decoder]) => [id, decoder]));
/** Derived from the grammar table so tests can prove the internal maps never
 * drift from the exported read/write ABI sets (S1 critique F3). */
export const CEAL_LEASED_CONSUMER_V4_DECLARED_CAPABILITY_IDS = Object.freeze([...V4_CAPABILITY_ARGUMENT_DECODERS.keys()]);
/** Ingress contexts admitted per frame; independent of how many capabilities are declared. */
export const CEAL_LEASED_CONSUMER_INGRESS_CONTEXT_LIMIT = 32; /** Framing shape for any relayed capability id, declared or not. */
function safeCapabilityId(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9_]{0,31}(?:\.[a-z][a-z0-9_]{0,31}){1,4}$/u.test(value); }
/** Capability id -> argument schema_version, derived from the same grammar
 * table as the wire decoders. Consumers (Agent adapter, test harnesses,
 * generated fixtures) must source their argument-schema maps from this export
 * instead of re-declaring literals. */
export const CEAL_LEASED_CONSUMER_V4_CAPABILITY_ARGUMENT_SCHEMAS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(V4_CAPABILITY_GRAMMAR.map(([id, schema]) => [id, schema])));

export function decodeCealLeasedConsumerControlSession(value: unknown): CealLeasedConsumerControlSession {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_CONTROL_MAX_SESSION_BYTES, invalid);
	const record = requireRecord(value);
	requireExactKeys(record, ["schema_version", "service_credential", "socket_path", "transport"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_CONTROL_SESSION_SCHEMA || record.transport !== "unix_socket" || !socketPath(record.socket_path) || !credential(record.service_credential)) invalid();
	return record as unknown as CealLeasedConsumerControlSession;
}

export function decodeCealLeasedConsumerControlRequest(value: unknown): CealLeasedConsumerControlRequest {
	return decodeControlRequest(value, CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA) as CealLeasedConsumerControlRequest;
}

export function decodeCealLeasedConsumerResultControlRequest(value: unknown): CealLeasedConsumerResultControlRequest {
	return decodeControlRequest(value, CEAL_LEASED_CONSUMER_RESULT_CONTROL_REQUEST_SCHEMA) as CealLeasedConsumerResultControlRequest;
}

export function decodeCealLeasedConsumerReplyControlRequest(value: unknown): CealLeasedConsumerReplyControlRequest {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES, invalid);
	const record = requireRecord(value);
	requireExactKeys(record, ["input", "operation", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_REPLY_CONTROL_REQUEST_SCHEMA || typeof record.operation !== "string" || !REPLY_CONTROL_OPERATIONS.has(record.operation as CealLeasedConsumerReplyControlOperation)) invalid();
	const input = requireRecord(record.input);
	switch (record.operation as CealLeasedConsumerReplyControlOperation) {
		case "acquire": requireExactKeys(input, []); break;
		case "projection": case "recheck": decodeLeaseInput(input); break;
		case "call": decodeCallInput(input); break;
		case "complete": decodeCompleteInput(input); break;
		case "reply": decodeReplyInput(input); break;
	}
	return record as unknown as CealLeasedConsumerReplyControlRequest;
}

export function decodeCealLeasedConsumerCapabilityControlRequest(value: unknown): CealLeasedConsumerCapabilityControlRequest {
	return decodeCapabilityControlRequest(value) as CealLeasedConsumerCapabilityControlRequest;
}

function decodeControlRequest(value: unknown, schema: string): Record<string, unknown> {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES, invalid);
	const record = requireRecord(value);
	requireExactKeys(record, ["input", "operation", "schema_version"]);
	if (record.schema_version !== schema || typeof record.operation !== "string" || !CONTROL_OPERATIONS.has(record.operation as CealLeasedConsumerControlOperation)) invalid();
	const input = requireRecord(record.input);
	switch (record.operation as CealLeasedConsumerControlOperation) {
		case "acquire": requireExactKeys(input, []); break;
		case "projection": case "recheck": decodeLeaseInput(input); break;
		case "call": decodeCallInput(input); break;
		case "complete": decodeCompleteInput(input); break;
	}
	return record;
}

export function decodeCealLeasedConsumerControlResponse(value: unknown): CealLeasedConsumerControlResponse {
	return decodeControlResponse(value, CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, decodeCallResult) as CealLeasedConsumerControlResponse;
}

export function decodeCealLeasedConsumerResultControlResponse(value: unknown): CealLeasedConsumerResultControlResponse {
	return decodeControlResponse(value, CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA, decodeResultControlCallResult) as CealLeasedConsumerResultControlResponse;
}

export function decodeCealLeasedConsumerReplyControlResponse(value: unknown): CealLeasedConsumerReplyControlResponse {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES, invalid);
	const record = requireRecord(value);
	requireExactKeys(record, ["operation", "result", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_REPLY_CONTROL_RESPONSE_SCHEMA || typeof record.operation !== "string" || !REPLY_CONTROL_OPERATIONS.has(record.operation as CealLeasedConsumerReplyControlOperation)) invalid();
	const result = requireRecord(record.result);
	switch (record.operation as CealLeasedConsumerReplyControlOperation) {
		case "acquire": decodeAcquireResult(result); break;
		case "projection": decodeProjectionResult(result); break;
		case "recheck": decodeRecheckResult(result); break;
		case "call": decodeResultControlCallResult(result); break;
		case "complete": decodeCompleteResult(result); break;
		case "reply": decodeReplyResult(result); break;
	}
	return record as unknown as CealLeasedConsumerReplyControlResponse;
}

export function decodeCealLeasedConsumerCapabilityControlResponse(value: unknown): CealLeasedConsumerCapabilityControlResponse {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES, invalid);
	const record = requireRecord(value);
	requireExactKeys(record, ["operation", "result", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA || typeof record.operation !== "string" || !CAPABILITY_CONTROL_OPERATIONS.has(record.operation as CealLeasedConsumerCapabilityControlOperation)) invalid();
	const result = requireRecord(record.result);
	switch (record.operation as CealLeasedConsumerCapabilityControlOperation) {
		case "acquire": decodeAcquireResult(result); break;
		case "projection": decodeCapabilityProjectionResult(result); break;
		case "recheck": decodeCapabilityRecheckResult(result); break;
		case "call": decodeCapabilityControlCallResult(result); break;
		case "complete": decodeCompleteResult(result); break;
	}
	return record as unknown as CealLeasedConsumerCapabilityControlResponse;
}

function decodeCapabilityControlRequest(value: unknown): Record<string, unknown> {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES, invalid);
	const record = requireRecord(value);
	requireExactKeys(record, ["input", "operation", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA || typeof record.operation !== "string" || !CAPABILITY_CONTROL_OPERATIONS.has(record.operation as CealLeasedConsumerCapabilityControlOperation)) invalid();
	const input = requireRecord(record.input);
	switch (record.operation as CealLeasedConsumerCapabilityControlOperation) {
		case "acquire": requireExactKeys(input, []); break;
		case "projection": case "recheck": decodeLeaseInput(input); break;
		case "call": decodeCapabilityCallInput(input); break;
		case "complete": decodeCompleteInput(input); break;
	}
	return record;
}

function decodeControlResponse(value: unknown, schema: string, decodeCall: (result: Record<string, unknown>) => void): Record<string, unknown> {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES, invalid);
	const record = requireRecord(value);
	requireExactKeys(record, ["operation", "result", "schema_version"]);
	if (record.schema_version !== schema || typeof record.operation !== "string" || !CONTROL_OPERATIONS.has(record.operation as CealLeasedConsumerControlOperation)) invalid();
	const result = requireRecord(record.result);
	switch (record.operation as CealLeasedConsumerControlOperation) {
		case "acquire": decodeAcquireResult(result); break;
		case "projection": decodeProjectionResult(result); break;
		case "recheck": decodeRecheckResult(result); break;
		case "call": decodeCall(result); break;
		case "complete": decodeCompleteResult(result); break;
	}
	return record;
}

function decodeLeaseInput(value: Record<string, unknown>): void {
	requireExactKeys(value, ["event_ref", "lease_fence", "lease_ref"]);
	if (!safeRef(value.event_ref) || !safeRef(value.lease_ref) || !positive(value.lease_fence)) invalid();
}
function decodeCallInput(value: Record<string, unknown>): void {
	requireExactKeys(value, ["arguments", "capability_id", "event_ref", "idempotency_key", "lease_fence", "lease_ref", "purpose", "schema_version", "target_ref"], ["idempotency_key"]);
	if (value.schema_version !== "ceal.gateway_leased_consumer_call_request.v1" || !safeRef(value.event_ref) || !safeRef(value.lease_ref) || !positive(value.lease_fence) || !safeRef(value.capability_id) || !safeRef(value.target_ref) || !safeText(value.purpose, 512) || (value.idempotency_key !== undefined && !safeText(value.idempotency_key, 512)) || !safeJson(value.arguments)) invalid();
}
function decodeCapabilityCallInput(value: Record<string, unknown>): void {
	requireExactKeys(value, ["arguments", "capability_id", "event_ref", "idempotency_key", "lease_fence", "lease_ref", "purpose", "schema_version", "target_ref"], ["idempotency_key"]);
	if (!validCapabilityCallEnvelope(value)) invalid();
	decodeCapabilityArguments(value.capability_id, value.arguments);
}
function validCapabilityCallEnvelope(value: Record<string, unknown>): boolean {
	return validCapabilityCallLease(value) && validCapabilityCallSelection(value) && validCapabilityCallIdempotency(value);
}
function validCapabilityCallLease(value: Record<string, unknown>): boolean {
	return value.schema_version === "ceal.gateway_leased_consumer_call_request.v1" && safeRef(value.event_ref) && safeRef(value.lease_ref) && positive(value.lease_fence);
}
function validCapabilityCallSelection(value: Record<string, unknown>): boolean {
	return safeCapabilityId(value.capability_id) && opaqueTargetRef(value.target_ref) && safeText(value.purpose, 512);
}
function validCapabilityCallIdempotency(value: Record<string, unknown>): boolean {
	if (value.idempotency_key !== undefined && !safeText(value.idempotency_key, 512)) return false;
	// Write semantics belong to the Gateway, which both issues and authorizes the
	// call. For a capability this relay knows, the declared write set is kept as
	// defence in depth; for one it does not, the relay does not guess -- guessing
	// would either reject a new read or invent a requirement the authority never
	// stated. #700: the relay must not revalidate a contract it does not own.
	return !V4_WRITE_CAPABILITIES.has(value.capability_id as string) || safeText(value.idempotency_key, 512);
}
function decodeCompleteInput(value: Record<string, unknown>): void {
	requireExactKeys(value, ["agent_run_ref", "disposition", "event_ref", "lease_fence", "lease_ref"], ["agent_run_ref"]);
	if (!safeRef(value.event_ref) || !safeRef(value.lease_ref) || !positive(value.lease_fence) || !["completed", "failed", "cancelled", "deferred"].includes(value.disposition as string) || (value.agent_run_ref !== undefined && !safeRef(value.agent_run_ref))) invalid();
}
function decodeReplyInput(value: Record<string, unknown>): void {
	requireExactKeys(value, ["event_ref", "lease_fence", "lease_ref", "text"]);
	if (!safeRef(value.event_ref) || !safeRef(value.lease_ref) || !positive(value.lease_fence) || !safeReplyText(value.text)) invalid();
}
function decodeAcquireResult(value: Record<string, unknown>): void {
	if (value.status === "authentication_failed") { requireExactKeys(value, ["status"]); return; }
	if (value.status === "leased" || value.status === "consumer_busy") { requireExactKeys(value, ["lease", "status"]); decodeLease(value.lease); return; }
	requireExactKeys(value, ["status"]); if (!["idle", "consumer_conflict", "stale_generation", "control_unavailable"].includes(value.status as string)) invalid();
}
function decodeProjectionResult(value: Record<string, unknown>): void {
	if (value.status === "authentication_failed" || value.status === "control_unavailable") { requireExactKeys(value, ["status"]); return; }
	if (value.status !== "available") { decodeTerminal(value); return; }
	requireExactKeys(value, ["event_ref", "event_revision", "normalized_projection_ref", "normalized_projection_revision", "projection", "status"]);
	if (!safeRef(value.event_ref) || !positive(value.event_revision) || !safeRef(value.normalized_projection_ref) || !positive(value.normalized_projection_revision)) invalid();
	decodeProjection(value.projection);
}
function decodeCapabilityProjectionResult(value: Record<string, unknown>): void {
	if (value.status === "authentication_failed" || value.status === "control_unavailable") { requireExactKeys(value, ["status"]); return; }
	if (value.status !== "available") { decodeTerminal(value); return; }
	requireExactKeys(value, ["attachments", "capability_contexts", "conversation_ref", "event_ref", "event_revision", "normalized_projection_ref", "normalized_projection_revision", "projection", "requester", "status"]);
	if (!safeRef(value.event_ref) || !positive(value.event_revision) || !safeRef(value.normalized_projection_ref) || !positive(value.normalized_projection_revision)) invalid();
	if (typeof value.conversation_ref !== "string" || !/^conversation:[a-f0-9]{64}$/u.test(value.conversation_ref)) invalid();
	decodeProjectionRequester(value.requester);
	decodeProjectionAttachments(value.attachments);
	decodeProjection(value.projection);
	decodeCapabilityContexts(value.capability_contexts);
}
function decodeProjectionRequester(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["display_name", "provider_identity", "subject_ref"], ["display_name", "provider_identity"]);
	// Slack-shaped requester identifiers must never ride the subject ref.
	if (!validCealLeasedConsumerSubjectRef(record.subject_ref)) invalid();
	if (record.display_name !== undefined && (!safeText(record.display_name, 512) || (record.display_name as string).length === 0)) invalid();
	if (record.provider_identity !== undefined) decodeProviderIdentity(record.provider_identity);
}
function decodeProviderIdentity(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["account_id", "provider"]);
	if (typeof record.provider !== "string" || !/^[a-z][a-z0-9_-]{1,39}$/u.test(record.provider)
		|| !safeText(record.account_id, 128) || (record.account_id as string).length === 0) invalid();
}
function decodeProjectionAttachments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["count", "set_ref"]);
	if (typeof record.count !== "number" || !Number.isSafeInteger(record.count) || record.count < 0) invalid();
	if (record.count === 0 ? record.set_ref !== null : !safeRef(record.set_ref)) invalid();
}
function decodeCapabilityContexts(value: unknown): void {
	// Bounded by its own constant, not by the size of the declared table: tying
	// the ingress-context limit to the capability count made adding a capability
	// silently widen an unrelated bound.
	if (!Array.isArray(value) || value.length < 1 || value.length > CEAL_LEASED_CONSUMER_INGRESS_CONTEXT_LIMIT) invalid();
	const capabilityIds = new Set<string>();
	for (const context of value) {
		const capabilityId = decodeCapabilityContext(context);
		if (capabilityIds.has(capabilityId)) invalid();
		capabilityIds.add(capabilityId);
	}
}
function decodeCapabilityContext(value: unknown): string {
	if (!plainRecord(value)) invalid();
	requireExactKeys(value, ["capability_id", "message_ref", "target_ref", "thread_ref"]);
	if (typeof value.capability_id !== "string" || !V4_INGRESS_CONTEXT_CAPABILITIES.has(value.capability_id)) invalid();
	if (!opaqueTargetRef(value.target_ref) || !opaqueMessageRef(value.message_ref) || !opaqueThreadRef(value.thread_ref)) invalid();
	return value.capability_id;
}
function decodeCapabilityRecheckResult(value: Record<string, unknown>): void {
	if (value.status === "active") {
		requireExactKeys(value, ["abort_requested", "lease", "status"]);
		if (typeof value.abort_requested !== "boolean") invalid();
		decodeLease(value.lease);
		return;
	}
	decodeRecheckResult(value);
}
function decodeRecheckResult(value: Record<string, unknown>): void { if (value.status === "authentication_failed" || value.status === "control_unavailable") { requireExactKeys(value, ["status"]); } else if (value.status === "active") { requireExactKeys(value, ["lease", "status"]); decodeLease(value.lease); } else decodeTerminal(value); }
function decodeCallResult(value: Record<string, unknown>): void {
	if (value.status === "authentication_failed") { requireExactKeys(value, ["status"]); return; }
	requireExactKeys(value, ["status"]); if (!["lease_lost", "lease_expired", "action_scope_unavailable", "action_scope_mismatch", "leased_consumer_call_unavailable"].includes(value.status as string)) invalid();
}
function decodeResultControlCallResult(value: Record<string, unknown>): void {
	if (value.status === "authentication_failed") { requireExactKeys(value, ["status"]); return; }
	if (value.status === "result") { requireExactKeys(value, ["result", "status"]); decodeDelegatedReadResult(value.result); return; }
	requireExactKeys(value, ["status"]); if (!["lease_lost", "lease_expired", "action_scope_unavailable", "action_scope_mismatch", "delegated_read_unavailable", "result_not_replayable"].includes(value.status as string)) invalid();
}
function decodeCapabilityControlCallResult(value: Record<string, unknown>): void {
	if (value.status === "authentication_failed") { requireExactKeys(value, ["status"]); return; }
	if (value.status === "result") { requireExactKeys(value, ["result", "status"]); decodeCapabilityResult(value.result); return; }
	requireExactKeys(value, ["status"]);
	if (!["lease_lost", "lease_expired", "action_scope_unavailable", "action_scope_mismatch", "capability_unavailable", "capability_result_unavailable", "write_unknown", "result_not_replayable"].includes(value.status as string)) invalid();
}
function decodeDelegatedReadResult(value: unknown): void {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_MAX_BYTES, invalid);
	const record = requireRecord(value); requireExactKeys(record, ["capability_id", "data", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_SCHEMA || !safeRef(record.capability_id) || !safeResultJson(record.data)) invalid();
}
function decodeCapabilityResult(value: unknown): void {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_MAX_BYTES, invalid);
	const record = requireRecord(value);
	requireExactKeys(record, ["capability_id", "data", "effect", "handles", "result_ref", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA || !safeCapabilityId(record.capability_id)
		|| !["read", "write"].includes(record.effect as string) || !opaqueResultRef(record.result_ref)
		|| !Array.isArray(record.handles) || record.handles.length > 32 || !record.handles.every(capabilityHandle)) invalid();
	// A declared capability keeps its exact result rule; an undeclared one keeps
	// every generic guard above plus credential/locator-free result JSON, and the
	// Gateway owns the shape. `safeResultJson` is what `requireExactKeys` on the
	// envelope never covered anyway: it is the check that matters for a relay.
	if (knownV4Capability(record.capability_id)) {
		if (!capabilityResultMatches(record.capability_id, record.effect, record.handles, record.data)) invalid();
	} else if (!safeResultJson(record.data)) invalid();
}
/**
 * Per-capability argument grammar for the capabilities this relay declares, and
 * generic safety for the ones it does not (#700).
 *
 * The worker is a relay: it reads an Agent frame, forwards it over a Unix
 * socket, and returns the answer. It neither executes nor authorizes the
 * capability, so a fixed 17-entry table gating that relay meant a Gateway could
 * not add a capability without a worker release — and the failure was not a
 * skew message but a dead session, because a decode throw ends the frame loop.
 *
 * An undeclared capability now passes the safety this relay DOES own: bounded,
 * credential-free, locator-free JSON. What it no longer does is claim to know
 * the shape.
 *
 * That claim was prose only until the ceal-cli consumer reproduced it against
 * the built 0.72.14 decoder: `safeJson` bars credential-shaped keys but admits
 * `locator`, `provider_locator`, `permissions`, `grant_revision`, and
 * `policy_version`, and it accepts a non-plain prototype. The undeclared
 * ARGUMENT boundary and the undeclared RESULT boundary are the same question in
 * two directions, so they now share one predicate rather than drifting again.
 * The declared per-capability decoders are unchanged and keep their own exact
 * grammar, including the locators a declared capability legitimately names.
 */
function decodeCapabilityArguments(capabilityId: unknown, value: unknown): void {
	const decode = V4_CAPABILITY_ARGUMENT_DECODERS.get(capabilityId as string);
	if (decode) { decode(value); return; }
	if (!safeCapabilityId(capabilityId) || !safeUndeclaredArgumentJson(value)) invalid();
}
function decodeMessageSearchArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["query", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_SCHEMA || !safeText(record.query, 4096)) invalid();
}
function decodeMessageGetArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["message_ref", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_MESSAGE_GET_ARGUMENTS_SCHEMA || !opaqueMessageRef(record.message_ref)) invalid();
}
function decodeConversationThreadGetArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["limit", "schema_version", "thread_ref"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_CONVERSATION_THREAD_GET_ARGUMENTS_SCHEMA || !opaqueThreadRef(record.thread_ref) || !positive(record.limit) || record.limit > 128) invalid();
}
function decodeMessageCreateArguments(value: unknown): void {
	const record = requireRecord(value);
	// reply_to is optional (S4): its absence is an explicit channel-root post;
	// rootless-suppression policy for scheduled turns is owned at admission.
	requireExactKeys(record, ["presentation", "reply_to", "schema_version", "text"], ["presentation", "reply_to"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA || (record.reply_to !== undefined && !opaqueMessageRef(record.reply_to)) || !safeReplyText(record.text)) invalid();
	if (record.presentation !== undefined) decodeMessagePresentation(record.presentation);
}
function decodeMessageUpdateArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["message_ref", "presentation", "schema_version", "text"], ["presentation"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA || !opaqueMessageRef(record.message_ref) || !safeReplyText(record.text)) invalid();
	if (record.presentation !== undefined) decodeMessagePresentation(record.presentation);
}
function decodeMessageDeleteArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["message_ref", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_MESSAGE_DELETE_ARGUMENTS_SCHEMA || !opaqueMessageRef(record.message_ref)) invalid();
}
function decodeMessageEnumerateArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["limit", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_MESSAGE_ENUMERATE_ARGUMENTS_SCHEMA || !positive(record.limit) || record.limit > 128) invalid();
}
function decodeResourceResolveArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["kind", "query", "schema_version"]);
	// `permalink` (S1, 2026-08-04): the query is a user-supplied provider
	// message link; Gateway parses it privately, authorizes the scope, and the
	// result mints opaque target/message/thread handles. The link never enters
	// a typed handle field, and no provider identifier returns to the Agent.
	if (record.schema_version !== CEAL_LEASED_CONSUMER_RESOURCE_RESOLVE_ARGUMENTS_SCHEMA || !["conversation", "identity", "usergroup", "permalink"].includes(record.kind as string) || !safeText(record.query, 1024) || (record.query as string).length === 0) invalid();
}
function decodeArtifactStageArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["bytes_base64", "chunk_count", "chunk_index", "schema_version", "sha256", "upload_ref"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_ARTIFACT_STAGE_ARGUMENTS_SCHEMA || !safeRef(record.upload_ref)
		|| !validChunkPosition(record.chunk_index, record.chunk_count)
		|| typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(record.sha256)
		|| !validChunkBytes(record.bytes_base64)) invalid();
}
function validChunkPosition(index: unknown, count: unknown): boolean {
	return typeof index === "number" && Number.isSafeInteger(index) && index >= 0
		&& positive(count) && count <= 4096 && index < count;
}
function validChunkBytes(value: unknown): boolean {
	const chunkLimit = Math.ceil((CEAL_LEASED_CONSUMER_ARTIFACT_CHUNK_MAX_BYTES * 4) / 3) + 4;
	return typeof value === "string" && value.length >= 1 && value.length <= chunkLimit && /^[A-Za-z0-9+/]+={0,2}$/u.test(value);
}
function decodeFileUploadArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["artifact_ref", "reply_to", "schema_version", "title"], ["reply_to", "title"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_FILE_UPLOAD_ARGUMENTS_SCHEMA || !opaqueArtifactRef(record.artifact_ref)
		|| (record.title !== undefined && (!safeText(record.title, 256) || (record.title as string).length === 0))
		|| (record.reply_to !== undefined && !opaqueMessageRef(record.reply_to))) invalid();
}
function decodeReplyIntakeArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["mode", "root_ref", "routing", "schema_version", "skill_name", "workflow_name"], ["skill_name"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_REPLY_INTAKE_ARGUMENTS_SCHEMA || !opaqueMessageRef(record.root_ref) || record.mode !== "human_replies" || !["normal", "skill"].includes(record.routing as string)) invalid();
	if (record.workflow_name !== null && (!safeText(record.workflow_name, 256) || (record.workflow_name as string).length === 0)) invalid();
	if (record.skill_name !== undefined && (!safeText(record.skill_name, 256) || (record.skill_name as string).length === 0)) invalid();
}
function decodeUsergroupsListArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["include_disabled", "schema_version"], ["include_disabled"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_USERGROUPS_LIST_ARGUMENTS_SCHEMA || (record.include_disabled !== undefined && typeof record.include_disabled !== "boolean")) invalid();
}
function decodeUsergroupMembersArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["schema_version", "usergroup"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_USERGROUP_MEMBERS_ARGUMENTS_SCHEMA || !safeText(record.usergroup, 256) || (record.usergroup as string).length === 0) invalid();
}
function decodeSubjectReadArguments(schema: string): (value: unknown) => void {
	return (value: unknown): void => {
		const record = requireRecord(value);
		requireExactKeys(record, ["schema_version", "subject_ref"]);
		if (record.schema_version !== schema || !safeRef(record.subject_ref) || !(record.subject_ref as string).startsWith("subject:")) invalid();
	};
}
function decodeMessageReactionArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["message_ref", "name", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_MESSAGE_REACTION_ARGUMENTS_SCHEMA || !opaqueMessageRef(record.message_ref) || typeof record.name !== "string" || !/^[a-z0-9_+-]{1,64}$/u.test(record.name)) invalid();
}
function decodePresentationActivityArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["activity", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_PRESENTATION_ACTIVITY_ARGUMENTS_SCHEMA || !["typing", "none"].includes(record.activity as string)) invalid();
}
function decodeMessagePresentation(value: unknown): void {
	const record = requireRecord(value);
	const v2 = record.schema_version === CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_V2_SCHEMA;
	if (v2) requireExactKeys(record, ["abortable", "completed_phases", "controls", "intent", "phase", "plan", "schema_version"], ["completed_phases", "phase", "plan"]);
	else requireExactKeys(record, ["abortable", "intent", "phase", "plan", "schema_version"], ["phase", "plan"]);
	if ((!v2 && record.schema_version !== CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_SCHEMA) || !["progress", "final", "stop", "transient_notice"].includes(record.intent as string) || typeof record.abortable !== "boolean") invalid();
	if (record.phase !== undefined && (!safeText(record.phase, 256) || (record.phase as string).length === 0)) invalid();
	if (record.plan !== undefined) decodePresentationPlan(record.plan); if (v2) decodePresentationV2(record);
}
function decodePresentationV2(record: Record<string, unknown>): void { decodePresentationControls(record.controls); if (!validCealLeasedConsumerCompletedPhaseHistory(record)) invalid(); }
function decodePresentationPlan(value: unknown): void {
	if (!Array.isArray(value) || value.length > 16) invalid();
	for (const item of value) {
		const record = requireRecord(item);
		requireExactKeys(record, ["status", "text"]);
		if (!safeText(record.text, 512) || (record.text as string).length === 0 || !["pending", "active", "completed"].includes(record.status as string)) invalid();
	}
}
function decodePresentationControls(value: unknown): void {
	if (!Array.isArray(value) || value.length > CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_MAX_CONTROLS) invalid();
	for (const item of value) {
		const record = requireRecord(item);
		requireExactKeys(record, ["label", "token"]);
		if (!safeText(record.token, CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_CONTROL_TOKEN_MAX_BYTES) || (record.token as string).length === 0
			|| !safeText(record.label, CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_CONTROL_LABEL_MAX_BYTES) || (record.label as string).length === 0) invalid();
	}
}
type CapabilityResultRule = (effect: unknown, handles: readonly unknown[], data: unknown) => boolean;
const RESOURCE_READ_RESULT_RULE: CapabilityResultRule = (effect, handles, data) => effect === "read" && decodeResourceReadData(data, handles);
const MESSAGE_READ_RESULT_RULE: CapabilityResultRule = (effect, _handles, data) => effect === "read" && decodeMessageReadData(data);
const MESSAGE_WRITE_RESULT_RULE: CapabilityResultRule = (effect, handles, data) => effect === "write" && mutationHandleGroup(handles) && decodeMessageWriteData(data);
const V4_CAPABILITY_RESULT_RULES = new Map<string, CapabilityResultRule>([
	["message.search", MESSAGE_READ_RESULT_RULE],
	["message.get", MESSAGE_READ_RESULT_RULE],
	["conversation.thread.get", MESSAGE_READ_RESULT_RULE],
	["message.enumerate", RESOURCE_READ_RESULT_RULE],
	["resource.resolve", RESOURCE_READ_RESULT_RULE],
	["directory.usergroups.list", RESOURCE_READ_RESULT_RULE],
	["directory.usergroups.members.list", RESOURCE_READ_RESULT_RULE],
	["directory.people.search", RESOURCE_READ_RESULT_RULE],
	["identity.profile_image.get", RESOURCE_READ_RESULT_RULE],
	["conversation.direct.resolve", RESOURCE_READ_RESULT_RULE],
	["message.create", MESSAGE_WRITE_RESULT_RULE],
	["message.update", MESSAGE_WRITE_RESULT_RULE],
	["message.delete", (effect, handles, data) => effect === "write" && handles.length === 0 && decodeMessageDeleteData(data)],
	["presentation.activity.set", (effect, handles, data) => effect === "write" && handles.length === 0 && decodePresentationActivityData(data)],
	["message.reaction.add", (effect, handles, data) => effect === "write" && handles.length === 0 && decodeMessageReactionData(data)],
	["workflow.reply_intake.register", (effect, handles, data) => effect === "write" && handles.length === 0 && decodeReplyIntakeData(data)],
	["workflow.survey_dispatch.send", (effect, handles, data) => effect === "write" && handles.length === 0 && decodeCealLeasedConsumerSurveyDispatchData(data)],
	// A chunk ack carries no handle; the final chunk carries exactly the one
	// digest-verified artifact handle.
	["artifact.stage", (effect, handles, data) => effect === "write" && artifactStageHandles(handles, data) && decodeArtifactStageData(data)],
	// A file upload renders a message: its result is the ordinary mutation
	// group over the message write data.
	["file.upload", MESSAGE_WRITE_RESULT_RULE],
]);
function capabilityResultMatches(capabilityId: unknown, effect: unknown, handles: readonly unknown[], data: unknown): boolean {
	return V4_CAPABILITY_RESULT_RULES.get(capabilityId as string)?.(effect, handles, data) ?? false;
}
/**
 * Reply splitting is connector-owned (S1 decision, 2026-08-04): one write may
 * deliver an ordered continuation group. The result carries exactly one
 * `target` handle plus 1..CEAL_LEASED_CONSUMER_WRITE_MESSAGE_HANDLE_LIMIT
 * `message` handles in provider delivery order; the first message handle is
 * the primary surface for later update/delete, and a governed delete revokes
 * the whole mutation group.
 */
function mutationHandleGroup(handles: readonly unknown[]): boolean {
	const messages = handles.filter((handle) => capabilityHandleKind(handle, "message")).length;
	return handles.filter((handle) => capabilityHandleKind(handle, "target")).length === 1
		&& messages >= 1 && messages <= CEAL_LEASED_CONSUMER_WRITE_MESSAGE_HANDLE_LIMIT
		&& handles.length === messages + 1;
}
function decodeMessageReadData(value: unknown): boolean {
	if (!plainRecord(value)) return false;
	requireExactKeys(value, ["items", "schema_version"]);
	return value.schema_version === CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA && Array.isArray(value.items) && value.items.length <= 64 && value.items.every(messageReadItem);
}
function messageReadItem(value: unknown): boolean {
	if (!plainRecord(value)) return false;
	requireExactKeys(value, ["author", "text"], ["author"]);
	return safeReplyText(value.text) && (value.author === undefined || validCealLeasedConsumerMessageAuthor(value.author));
}
function decodeMessageWriteData(value: unknown): boolean {
	if (!plainRecord(value)) return false;
	requireExactKeys(value, ["schema_version", "terminal", "text"], ["text"]);
	return value.schema_version === CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA && ["readback_confirmed", "idempotency_replayed"].includes(value.terminal as string) && (value.text === undefined || safeReplyText(value.text));
}
/**
 * Resolve-family reads carry human-readable display names (destination
 * disclosure, S1 decision) while every ref stays a typed opaque handle: an
 * item points at its handle via `handle_index`, never an inline ref string.
 */
function decodeResourceReadData(value: unknown, handles: readonly unknown[]): boolean {
	if (!plainRecord(value)) return false;
	// `truncated` is optional and generic: a bounded read states that its page
	// ended early instead of letting the consumer read a short list as the
	// whole set. Absent means the projection carried everything it found.
	requireExactKeys(value, ["items", "schema_version", "truncated"], ["truncated"]);
	if (value.schema_version !== CEAL_LEASED_CONSUMER_RESOURCE_READ_DATA_SCHEMA || !Array.isArray(value.items) || value.items.length > 64 || (value.truncated !== undefined && typeof value.truncated !== "boolean")) return false;
	return value.items.every((item) => resourceReadItem(item, handles.length));
}
function resourceReadItem(value: unknown, handleCount: number): boolean {
	if (!plainRecord(value)) return false;
	// handle_index is optional (S5): display-only items (e.g. usergroups) mint
	// no handle; when present it must point inside the typed handles array.
	// subject_ref is optional and identity-only: a directory read projects the
	// addressable Gateway-native subject so an ordinary skill can reach
	// `conversation.direct.resolve` without a provider locator. It is a
	// descriptive ref, never authority by itself.
	requireExactKeys(value, ["actor_kind", "author", "display_name", "handle_index", "kind", "subject_ref", "text"], ["actor_kind", "author", "handle_index", "subject_ref", "text"]);
	return ["conversation", "identity", "usergroup", "message"].includes(value.kind as string)
		&& typeof value.display_name === "string" && value.display_name.length >= 1 && safeText(value.display_name, 512)
		&& validOptionalHandleIndex(value.handle_index, handleCount)
		&& validCealLeasedConsumerReadItemDetail(value, safeReplyText, validCealLeasedConsumerMessageAuthor);
}
function validOptionalHandleIndex(value: unknown, handleCount: number): boolean {
	if (value === undefined) return true;
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < handleCount;
}
function artifactStageHandles(handles: readonly unknown[], data: unknown): boolean {
	const terminal = plainRecord(data) ? data.terminal : undefined;
	if (terminal === "artifact_ready") return handles.length === 1 && capabilityHandleKind(handles[0], "artifact");
	return handles.length === 0;
}
function decodeArtifactStageData(value: unknown): boolean {
	if (!plainRecord(value)) return false;
	requireExactKeys(value, ["schema_version", "terminal"]);
	return value.schema_version === CEAL_LEASED_CONSUMER_ARTIFACT_STAGE_DATA_SCHEMA && ["chunk_accepted", "artifact_ready", "idempotency_replayed"].includes(value.terminal as string);
}
function decodeReplyIntakeData(value: unknown): boolean {
	if (!plainRecord(value)) return false;
	requireExactKeys(value, ["schema_version", "terminal"]);
	return value.schema_version === CEAL_LEASED_CONSUMER_REPLY_INTAKE_DATA_SCHEMA && ["registered", "idempotency_replayed"].includes(value.terminal as string);
}
function decodeMessageReactionData(value: unknown): boolean { if (!plainRecord(value)) return false; requireExactKeys(value, ["schema_version", "terminal"]); return value.schema_version === CEAL_LEASED_CONSUMER_MESSAGE_REACTION_DATA_SCHEMA && ["readback_confirmed", "idempotency_replayed"].includes(value.terminal as string); }
function decodePresentationActivityData(value: unknown): boolean { if (!plainRecord(value)) return false; requireExactKeys(value, ["schema_version", "terminal"]); return value.schema_version === CEAL_LEASED_CONSUMER_PRESENTATION_ACTIVITY_DATA_SCHEMA && ["acknowledged", "idempotency_replayed"].includes(value.terminal as string); }
function decodeMessageDeleteData(value: unknown): boolean { if (!plainRecord(value)) return false; requireExactKeys(value, ["schema_version", "terminal"]); return value.schema_version === CEAL_LEASED_CONSUMER_MESSAGE_DELETE_DATA_SCHEMA && ["readback_confirmed", "idempotency_replayed"].includes(value.terminal as string); }
function capabilityHandle(value: unknown): boolean {
	if (!plainRecord(value)) return false;
	requireExactKeys(value, ["kind", "ref"]);
	return (value.kind === "target" && opaqueTargetRef(value.ref))
		|| (value.kind === "message" && opaqueMessageRef(value.ref))
		|| (value.kind === "thread" && opaqueThreadRef(value.ref))
		|| (value.kind === "artifact" && opaqueArtifactRef(value.ref));
}
function capabilityHandleKind(value: unknown, kind: CealLeasedConsumerCapabilityHandle["kind"]): boolean {
	return plainRecord(value) && value.kind === kind && capabilityHandle(value);
}
function decodeCompleteResult(value: Record<string, unknown>): void { if (value.status === "authentication_failed" || value.status === "control_unavailable") { requireExactKeys(value, ["status"]); } else if (value.status === "completed") { requireExactKeys(value, ["replayed", "status"]); if (typeof value.replayed !== "boolean") invalid(); } else decodeTerminal(value); }
function decodeReplyResult(value: Record<string, unknown>): void {
	if (value.status === "replied") {
		requireExactKeys(value, ["receipt_ref", "replayed", "status"]);
		if (!safeReplyReceiptRef(value.receipt_ref) || typeof value.replayed !== "boolean") invalid();
		return;
	}
	requireExactKeys(value, ["status"]);
	if (!["lease_lost", "lease_expired", "event_settled", "reply_not_eligible", "reply_unavailable", "authentication_failed"].includes(value.status as string)) invalid();
}
function decodeTerminal(value: Record<string, unknown>): void { requireExactKeys(value, ["status"]); if (!TERMINAL_STATUSES.has(value.status as CealLeasedConsumerControlTerminalResult["status"])) invalid(); }
function decodeLease(value: unknown): void { const record = requireRecord(value); requireExactKeys(record, ["delivery_attempt", "event_ref", "expires_at", "lease_fence", "lease_ref"]); if (!safeRef(record.event_ref) || !safeRef(record.lease_ref) || !positive(record.lease_fence) || !positive(record.delivery_attempt) || !timestamp(record.expires_at)) invalid(); }
function decodeProjection(value: unknown): void { const record = requireRecord(value); requireExactKeys(record, Object.hasOwn(record, "context") ? ["context", "schema_version", "text"] : ["schema_version", "text"]); if (record.schema_version !== "ceal.gateway_normalized_projection.v1" || !safeText(record.text, 16_384) || (record.context !== undefined && !projectionContext(record.context))) invalid(); }
// `trigger` is the optional scheduled-tick marker (Goal 6 S3). It must stay in
// lockstep with the projection store and the consumer-side projection resolver:
// a decoder that rejects a stored key collapses the serving response into a
// silent `control_unavailable` halt (ceal-dev rehearsal, 2026-08-06).
function projectionContext(value: unknown): boolean { if (!record(value)) return false; const context = value as Record<string, unknown>; const keys = Object.hasOwn(context, "trigger") ? ["conversation_kind", "is_thread_reply", "trigger"] : ["conversation_kind", "is_thread_reply"]; if (Object.hasOwn(context, "trigger") && context.trigger !== "scheduled") return false; return exactKeys(context, keys) && ["channel", "dm", "group"].includes(context.conversation_kind as string) && typeof context.is_thread_reply === "boolean"; }
// A protected session is the sole socket authority. Keep the permitted value
// portable and incapable of targeting the Gateway administration listener;
// consumers must not substitute an ambient or contract-literal path.
function socketPath(value: unknown): boolean { return isSafeUnixSocketPath(value) && !value.endsWith("/admin-gateway.sock"); }
function credential(value: unknown): boolean { return typeof value === "string" && Buffer.byteLength(value, "utf8") > 0 && Buffer.byteLength(value, "utf8") <= 4096 && /^[\x21-\x7e]+$/u.test(value); }
function safeRef(value: unknown): value is string { return typeof value === "string" && SAFE_REF.test(value); }
function positive(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 1; }
function timestamp(value: unknown): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
/** Reply text is a visible message body, so line breaks are intentional. */
function safeReplyText(value: unknown): value is string { return typeof value === "string" && Buffer.byteLength(value, "utf8") > 0 && Buffer.byteLength(value, "utf8") <= 16_384 && ![...value].some((character) => character.codePointAt(0)! < 32 && character !== "\t" && character !== "\n" && character !== "\r" || character.codePointAt(0) === 127); }
function safeText(value: unknown, maximum: number): value is string { return typeof value === "string" && Buffer.byteLength(value, "utf8") <= maximum && ![...value].some((character) => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127); }
function safeJson(value: unknown, depth = 0): boolean { if (depth > 16) return false; if (value === null || typeof value === "boolean") return true; if (typeof value === "number") return Number.isFinite(value); if (typeof value === "string") return safeText(value, 8 * 1024); if (Array.isArray(value)) return value.length <= 128 && value.every((entry) => safeJson(entry, depth + 1)); if (!record(value) || Object.keys(value).length > 128) return false; return Object.entries(value).every(([key, entry]) => safeText(key, 128) && !/(?:token|secret|password|authorization|credential|provenance|runner|consumer|requester|source_kind)/iu.test(key) && safeJson(entry, depth + 1)); }
/**
 * One traversal owner for both undeclared relay boundaries, with the key policy
 * as the only difference between them.
 *
 * Undeclared ARGUMENTS additionally refuse authority STATE keys
 * (`grant_revision`, `policy_version`, `credential_version`), because an
 * argument is the direction a consumer could push authority INTO. They do NOT
 * refuse the bare `*_ref` handle idiom — see `isAuthorityStateKey` for why
 * refusing it would re-create #700's dead session for the next capability that
 * takes a Gateway-minted handle.
 *
 * Undeclared RESULTS keep the result key policy unchanged, deliberately: `data`
 * is capability-owned, and a test pins that asymmetry so a later "unify these"
 * cleanup fails loudly instead of refusing working responses.
 *
 * The argument path also inherits the RESULT bounds — depth 8, 64 entries,
 * 4 KiB strings, plain prototypes — rather than the looser ones `safeJson`
 * applied. That is a deliberate tightening with one known edge: a declared
 * message body may reach 16 KiB through `safeReplyText`, so an undeclared
 * messaging-shaped capability is capped lower than its declared sibling. The
 * declared capability is the one that needs the room; an undeclared relay does
 * not get to assume it.
 */
function safeRelayJson(value: unknown, isSafeKey: (key: string) => boolean, depth = 0): boolean { if (depth > 8) return false; if (value === null || typeof value === "boolean") return true; if (typeof value === "number") return Number.isFinite(value); if (typeof value === "string") return safeText(value, 4 * 1024); if (Array.isArray(value)) return value.length <= 64 && value.every((entry) => safeRelayJson(entry, isSafeKey, depth + 1)); if (!plainRecord(value) || Object.keys(value).length > 64) return false; return Object.entries(value).every(([key, entry]) => isSafeKey(key) && safeRelayJson(entry, isSafeKey, depth + 1)); }
function safeResultJson(value: unknown): boolean { return safeRelayJson(value, safeResultKey); }
function safeUndeclaredArgumentJson(value: unknown): boolean { return safeRelayJson(value, (key) => safeResultKey(key) && !isAuthorityStateKey(key)); }
function safeResultKey(value: string): boolean { return safeText(value, 128) && !/(?:token|secret|password|authorization|credential|provenance|runner|consumer|requester|source_kind|attachment|binary|body|header|url|uri|link|path|locator|acl|permission|__proto__|constructor|prototype)/iu.test(value); }
function knownV4Capability(value: unknown): value is string { return typeof value === "string" && (V4_READ_CAPABILITIES.has(value) || V4_WRITE_CAPABILITIES.has(value)); }
function requireRecord(value: unknown): Record<string, unknown> { if (!record(value)) invalid(); return value; }
function requireExactKeys(value: Record<string, unknown>, expected: readonly string[], optional: readonly string[] = []): void { const keys = Object.keys(value).sort(); const allowed = [...expected].sort(); const required = allowed.filter((key) => !optional.includes(key)); if (keys.length < required.length || keys.length > allowed.length || !keys.every((key) => allowed.includes(key)) || !required.every((key) => Object.hasOwn(value, key))) invalid(); }
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean { const keys = Object.keys(value).sort(); return keys.length === expected.length && keys.every((key, index) => key === expected[index]); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function plainRecord(value: unknown): value is Record<string, unknown> { return record(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function invalid(): never { throw new TypeError("Ceal leased-consumer control record is invalid"); }
import { isSafeUnixSocketPath } from "./unix-socket-path-safety.js";
