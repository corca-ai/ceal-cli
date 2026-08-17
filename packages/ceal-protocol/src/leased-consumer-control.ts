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
import { isAuthorityStateKey, requireJsonByteSize } from "./gateway-validation-primitives.ts";
import { decodeResultMaterializationInput, decodeResultMaterializationResult, type CealLeasedConsumerResultMaterializationInput, type CealLeasedConsumerResultMaterializationResult } from "./result-materialization.ts";
export type { CealLeasedConsumerResultMaterializationInput, CealLeasedConsumerResultMaterializationResult } from "./result-materialization.js";
import { validCealLeasedConsumerMessageAuthor, type CealLeasedConsumerMessageAuthor } from "./leased-consumer-message-author.ts";
export type { CealLeasedConsumerMessageAuthor } from "./leased-consumer-message-author.js";
import { decodeCealLeasedConsumerCapabilityCatalog, type CealLeasedConsumerCapabilityCatalog } from "./leased-consumer-capability-catalog.ts";
import { opaqueMessageRef, opaqueResultRef, opaqueTargetRef, opaqueThreadRef, safeReplyReceiptRef, validCealLeasedConsumerCapabilityHandle, type CealLeasedConsumerCapabilityHandle } from "./leased-consumer-opaque-refs.ts";
export type { CealLeasedConsumerCapabilityHandle } from "./leased-consumer-opaque-refs.js";
import { CEAL_LEASED_CONSUMER_COMMENT_CREATE_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerCommentCreateArguments, validCealLeasedConsumerCommentCreateData, type CealLeasedConsumerCommentCreateArguments, type CealLeasedConsumerCommentCreateData } from "./leased-consumer-comment.ts";
export * from "./leased-consumer-comment.ts";
import { CEAL_LEASED_CONSUMER_DOCUMENT_CREATE_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerDocumentCreateArguments, validCealLeasedConsumerDocumentCreateData } from "./leased-consumer-document.ts"; export * from "./leased-consumer-document.ts";
import { CEAL_LEASED_CONSUMER_GITHUB_ISSUE_CREATE_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_GITHUB_ISSUE_GET_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_GITHUB_PULL_REQUEST_GET_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerGithubIssueCreateArguments, decodeCealLeasedConsumerGithubIssueGetArguments, decodeCealLeasedConsumerGithubPullRequestGetArguments, validCealLeasedConsumerGithubIssueCreateData, type CEAL_LEASED_CONSUMER_GITHUB_ISSUE_CREATE_DATA_SCHEMA, type CealLeasedConsumerGithubIssueCreateArguments, type CealLeasedConsumerGithubIssueGetArguments, type CealLeasedConsumerGithubPullRequestGetArguments } from "./leased-consumer-github.ts";
export * from "./leased-consumer-github.ts";
import { CEAL_LEASED_CONSUMER_CALENDAR_AVAILABILITY_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_CALENDAR_EVENT_GET_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_CALENDAR_EVENT_SEARCH_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_COLLECTION_SEARCH_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_GITHUB_REPOSITORY_GET_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_GITHUB_WORKFLOW_RUN_GET_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerCalendarAvailabilityArguments, decodeCealLeasedConsumerCalendarEventGetArguments, decodeCealLeasedConsumerCalendarEventSearchArguments, decodeCealLeasedConsumerCollectionSearchArguments, decodeCealLeasedConsumerGithubRepositoryGetArguments, decodeCealLeasedConsumerGithubWorkflowRunGetArguments, validCealLeasedConsumerCalendarAvailabilityData, validCealLeasedConsumerCalendarEventGetData, validCealLeasedConsumerCalendarEventSearchData, validCealLeasedConsumerCollectionSearchData, validCealLeasedConsumerGithubRepositoryReadData, validCealLeasedConsumerGithubWorkflowRunReadData, type CEAL_LEASED_CONSUMER_CALENDAR_AVAILABILITY_DATA_SCHEMA, type CEAL_LEASED_CONSUMER_CALENDAR_EVENT_GET_DATA_SCHEMA, type CEAL_LEASED_CONSUMER_CALENDAR_EVENT_SEARCH_DATA_SCHEMA, type CEAL_LEASED_CONSUMER_COLLECTION_SEARCH_DATA_SCHEMA, type CEAL_LEASED_CONSUMER_GITHUB_REPOSITORY_READ_DATA_SCHEMA, type CEAL_LEASED_CONSUMER_GITHUB_WORKFLOW_RUN_READ_DATA_SCHEMA, type CealLeasedConsumerCalendarAvailabilityArguments, type CealLeasedConsumerCalendarEventGetArguments, type CealLeasedConsumerCalendarEventSearchArguments, type CealLeasedConsumerCollectionSearchArguments, type CealLeasedConsumerGithubRepositoryGetArguments, type CealLeasedConsumerGithubWorkflowRunGetArguments } from "./leased-consumer-provider-reads.ts"; export * from "./leased-consumer-provider-reads.ts";
import { CEAL_LEASED_CONSUMER_NOTION_PAGE_GET_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_NOTION_SEARCH_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerNotionPageGetArguments, decodeCealLeasedConsumerNotionSearchArguments, validCealLeasedConsumerDocumentReadData, type CealLeasedConsumerDocumentReadData } from "./leased-consumer-notion.ts";
export { CEAL_LEASED_CONSUMER_DOCUMENT_READ_DATA_SCHEMA, CEAL_LEASED_CONSUMER_NOTION_PAGE_GET_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_NOTION_SEARCH_ARGUMENTS_SCHEMA } from "./leased-consumer-notion.ts";
import { CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerPeopleSearchArguments, validCealLeasedConsumerMessageReplyCount, validCealLeasedConsumerSubjectRef, type CealLeasedConsumerResourceReadItem } from "./leased-consumer-directory-reads.ts";
import { CEAL_LEASED_CONSUMER_FILE_SEARCH_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerFileSearchArguments, decodeCealLeasedConsumerMessageSearchArguments, type CealLeasedConsumerMessageSearchArgumentsV2, type CealLeasedConsumerSearchArguments } from "./leased-consumer-search-arguments.ts";
import { decodeCealLeasedConsumerMessageSearchData, decodeCealLeasedConsumerResourceReadData, validCealLeasedConsumerResourceReadItem } from "./leased-consumer-read-result.ts";
import { CEAL_LEASED_CONSUMER_FILE_UPLOAD_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerFileUploadArguments, validCealLeasedConsumerFileUploadData, type CealLeasedConsumerFileUploadArguments, type CealLeasedConsumerFileUploadData } from "./leased-consumer-file-upload.ts";
export * from "./leased-consumer-file-upload.ts";
import {
	CEAL_LEASED_CONSUMER_SHEETS_VALUES_CLEAR_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_SHEETS_VALUES_READ_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_SHEETS_VALUES_UPDATE_ARGUMENTS_SCHEMA,
	decodeCealLeasedConsumerSheetsClearArguments,
	decodeCealLeasedConsumerSheetsReadArguments,
	decodeCealLeasedConsumerSheetsUpdateArguments,
	validCealLeasedConsumerSheetsClearData,
	validCealLeasedConsumerSheetsReadData,
	validCealLeasedConsumerSheetsUpdateData,
	type CealLeasedConsumerSheetsClearArguments,
	type CealLeasedConsumerSheetsReadArguments,
	type CealLeasedConsumerSheetsUpdateArguments,
	type CealLeasedConsumerSheetsClearData,
	type CealLeasedConsumerSheetsReadData,
	type CealLeasedConsumerSheetsUpdateData,
} from "./leased-consumer-sheets.ts";
export * from "./leased-consumer-sheets.ts";
import {
	CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_CONTROL_LABEL_MAX_BYTES, CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_CONTROL_TOKEN_MAX_BYTES, CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_MAX_CONTROLS, CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_SCHEMA, CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_V2_SCHEMA, validCealLeasedConsumerCompletedPhaseHistory, type CealLeasedConsumerMessagePresentation,
} from "./leased-consumer-presentation.ts";
import { CEAL_LEASED_CONSUMER_ARTIFACT_CHUNK_MAX_BYTES, CEAL_LEASED_CONSUMER_ARTIFACT_STAGE_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_ARTIFACT_STAGE_DATA_SCHEMA, CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA, CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_HANDLE_LIMIT, CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES, CEAL_LEASED_CONSUMER_CONTROL_MAX_SESSION_BYTES, CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, CEAL_LEASED_CONSUMER_CONTROL_SESSION_SCHEMA, CEAL_LEASED_CONSUMER_CONVERSATION_THREAD_GET_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_MAX_BYTES, CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_SCHEMA, CEAL_LEASED_CONSUMER_DIRECT_RESOLVE_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_MESSAGE_DELETE_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_MESSAGE_DELETE_DATA_SCHEMA, CEAL_LEASED_CONSUMER_MESSAGE_GET_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_MESSAGE_REACTION_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_MESSAGE_REACTION_DATA_SCHEMA, CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA, CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA, CEAL_LEASED_CONSUMER_PRESENTATION_ACTIVITY_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_PRESENTATION_ACTIVITY_DATA_SCHEMA, CEAL_LEASED_CONSUMER_PROFILE_IMAGE_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_REPLY_CONTROL_REQUEST_SCHEMA, CEAL_LEASED_CONSUMER_REPLY_CONTROL_RESPONSE_SCHEMA, CEAL_LEASED_CONSUMER_REPLY_INTAKE_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_REPLY_INTAKE_DATA_SCHEMA, CEAL_LEASED_CONSUMER_RESOURCE_RESOLVE_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_RESULT_CONTROL_REQUEST_SCHEMA, CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA, CEAL_LEASED_CONSUMER_USERGROUPS_LIST_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_USERGROUP_MEMBERS_ARGUMENTS_SCHEMA, CEAL_LEASED_CONSUMER_WRITE_MESSAGE_HANDLE_LIMIT } from "./leased-consumer-control-schemas.ts";
import type { CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_V2_SCHEMA, CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_DATA_SCHEMA, CEAL_LEASED_CONSUMER_RESOURCE_READ_DATA_SCHEMA } from "./leased-consumer-control-schemas.ts";
export * from "./leased-consumer-control-schemas.ts";

export type CealLeasedConsumerControlOperation = "acquire" | "projection" | "recheck" | "call" | "complete";
export type CealLeasedConsumerReplyControlOperation = CealLeasedConsumerControlOperation | "reply";
export type CealLeasedConsumerCapabilityControlOperation = CealLeasedConsumerControlOperation | "materialization";
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
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA; operation: "materialization"; input: CealLeasedConsumerResultMaterializationInput }
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
	// The merged message-family read (`message.enumerate` folded in, 2026-08-12).
		// Every filter is optional: the motivating question — "everything I said in
		// this channel last week" — carries no query term at all.
		| ({ schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_SCHEMA } & CealLeasedConsumerSearchArguments)
		| CealLeasedConsumerMessageSearchArgumentsV2
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_GET_ARGUMENTS_SCHEMA; message_ref: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CONVERSATION_THREAD_GET_ARGUMENTS_SCHEMA; thread_ref: string; limit: number }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA; reply_to?: string; text: string; presentation?: CealLeasedConsumerMessagePresentation }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA; message_ref: string; text: string; presentation?: CealLeasedConsumerMessagePresentation }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_DELETE_ARGUMENTS_SCHEMA; message_ref: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_RESOURCE_RESOLVE_ARGUMENTS_SCHEMA; kind: "conversation" | "identity" | "usergroup" | "permalink"; query: string }
	| CealLeasedConsumerCommentCreateArguments | CealLeasedConsumerGithubIssueCreateArguments | CealLeasedConsumerGithubIssueGetArguments | CealLeasedConsumerGithubPullRequestGetArguments | CealLeasedConsumerGithubRepositoryGetArguments | CealLeasedConsumerGithubWorkflowRunGetArguments | CealLeasedConsumerCollectionSearchArguments | CealLeasedConsumerCalendarAvailabilityArguments | CealLeasedConsumerCalendarEventSearchArguments | CealLeasedConsumerCalendarEventGetArguments
	| { schema_version: typeof CEAL_LEASED_CONSUMER_PRESENTATION_ACTIVITY_ARGUMENTS_SCHEMA; activity: "typing" | "none" }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_REACTION_ARGUMENTS_SCHEMA; message_ref: string; name: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_USERGROUPS_LIST_ARGUMENTS_SCHEMA; include_disabled?: boolean }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_USERGROUP_MEMBERS_ARGUMENTS_SCHEMA; usergroup: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_PROFILE_IMAGE_ARGUMENTS_SCHEMA; subject_ref: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_DIRECT_RESOLVE_ARGUMENTS_SCHEMA; subject_ref: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_ARGUMENTS_SCHEMA; query?: string; limit?: number }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_FILE_SEARCH_ARGUMENTS_SCHEMA; limit: number; query?: string; filetype?: string; since?: string; until?: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_INTAKE_ARGUMENTS_SCHEMA; root_ref: string; workflow_name: string | null; skill_name?: string; routing: "normal" | "skill"; mode: "human_replies" }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_ARTIFACT_STAGE_ARGUMENTS_SCHEMA; upload_ref: string; chunk_index: number; chunk_count: number; sha256: string; bytes_base64: string }
	| CealLeasedConsumerFileUploadArguments
	| CealLeasedConsumerSheetsReadArguments
	| CealLeasedConsumerSheetsUpdateArguments
	| CealLeasedConsumerSheetsClearArguments;

export type CealLeasedConsumerCapabilityControlResponse =
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA; operation: "acquire"; result: CealLeasedConsumerControlAcquireResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA; operation: "projection"; result: CealLeasedConsumerCapabilityProjectionResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA; operation: "recheck"; result: CealLeasedConsumerCapabilityRecheckResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA; operation: "call"; result: CealLeasedConsumerCapabilityControlCallResult }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA; operation: "materialization"; result: CealLeasedConsumerResultMaterializationResult }
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
		capability_catalog: CealLeasedConsumerCapabilityCatalog;
		messenger_context?: CealLeasedConsumerMessengerContext;
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

export interface CealLeasedConsumerMessengerContext {
	conversation_ref: string;
	capability_contexts: readonly CealLeasedConsumerCapabilityContext[];
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
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA; items: readonly { text: string; reply_count?: number; author?: CealLeasedConsumerMessageAuthor }[] }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA; terminal: "readback_confirmed" | "idempotency_replayed"; text?: string }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_DELETE_DATA_SCHEMA; terminal: "readback_confirmed" | "idempotency_replayed" }
	| CealLeasedConsumerCommentCreateData
	| { schema_version: typeof CEAL_LEASED_CONSUMER_RESOURCE_READ_DATA_SCHEMA; truncated?: boolean; items: readonly CealLeasedConsumerResourceReadItem[] }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_DATA_SCHEMA; completeness: "complete" | "continuation_available"; items: readonly CealLeasedConsumerResourceReadItem[]; next_action?: { capability_id: "message.search"; target_ref: string; arguments: { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_V2_SCHEMA; continuation: string } } }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_PRESENTATION_ACTIVITY_DATA_SCHEMA; terminal: "acknowledged" | "idempotency_replayed" }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_MESSAGE_REACTION_DATA_SCHEMA; terminal: "readback_confirmed" | "idempotency_replayed" }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_REPLY_INTAKE_DATA_SCHEMA; terminal: "registered" | "idempotency_replayed" }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_ARTIFACT_STAGE_DATA_SCHEMA; terminal: "chunk_accepted" | "artifact_ready" | "idempotency_replayed" }
	| CealLeasedConsumerFileUploadData
	| CealLeasedConsumerDocumentReadData
	| CealLeasedConsumerSheetsReadData
	| CealLeasedConsumerSheetsUpdateData
	| CealLeasedConsumerSheetsClearData
	| { schema_version: typeof CEAL_LEASED_CONSUMER_GITHUB_ISSUE_CREATE_DATA_SCHEMA; terminal: "readback_confirmed" | "idempotency_replayed" }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_GITHUB_REPOSITORY_READ_DATA_SCHEMA; repository: Record<string, unknown> }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_GITHUB_WORKFLOW_RUN_READ_DATA_SCHEMA; workflow_run: Record<string, unknown> }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_COLLECTION_SEARCH_DATA_SCHEMA; query: Record<string, unknown>; offset: number; result_count: number; results: readonly Record<string, unknown>[]; coverage: Record<string, unknown> }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CALENDAR_AVAILABILITY_DATA_SCHEMA; time_min: string; time_max: string; busy_periods: readonly Record<string, string>[]; partial: boolean }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CALENDAR_EVENT_SEARCH_DATA_SCHEMA; query: Record<string, unknown>; time_min: string; time_max: string; result_count: number; results: readonly Record<string, unknown>[]; coverage: Record<string, unknown> }
	| { schema_version: typeof CEAL_LEASED_CONSUMER_CALENDAR_EVENT_GET_DATA_SCHEMA; summary: string | null; start: string | null; end: string | null; status: string | null };

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
const CAPABILITY_CONTROL_OPERATIONS = new Set<CealLeasedConsumerCapabilityControlOperation>(["acquire", "projection", "recheck", "call", "materialization", "complete"]);
const TERMINAL_STATUSES = new Set<CealLeasedConsumerControlTerminalResult["status"]>(["lease_lost", "lease_expired", "event_settled"]);
// The v4 capability ABI sets are exported so Gateway tables (handle resolver,
// context issuer, result projectors) and conformance vectors can prove
// set-equality against this single source instead of re-declaring literals.
// `message.enumerate` was REMOVED on 2026-08-12: it was the same
// `conversations.history` read as `message.search` with different arguments,
// and the merged capability carries its filters, its opaque continuation and
// its read handles. A worker that still calls the retired id now receives the
// undeclared-capability path — bounded generic argument safety and a Gateway
// authorization denial — not a decode throw, because #700 already stopped an
// unknown id from ending the frame loop.
export const CEAL_LEASED_CONSUMER_V4_READ_CAPABILITY_IDS = Object.freeze(["message.search", "message.get", "conversation.thread.get", "resource.resolve", "directory.usergroups.list", "directory.usergroups.members.list", "directory.people.search", "identity.profile_image.get", "conversation.direct.resolve", "file.search", "github.issue.get", "github.pull_request.get", "github.repository.get", "collection.search", "github.workflow_run.get", "calendar.availability", "calendar.event.search", "calendar.event.get", "notion.search", "notion.page.get", "sheets.values.read"] as const); export const CEAL_LEASED_CONSUMER_V4_WRITE_CAPABILITY_IDS = Object.freeze(["message.create", "message.update", "message.delete", "comment.create", "document.create", "github.issue.create", "presentation.activity.set", "message.reaction.add", "workflow.reply_intake.register", "artifact.stage", "file.upload", "sheets.values.update", "sheets.values.clear"] as const);
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
export const CEAL_LEASED_CONSUMER_V4_INGRESS_CONTEXT_CAPABILITY_IDS = Object.freeze(["message.search", "message.get", "conversation.thread.get", "message.create", "resource.resolve", "message.reaction.add", "conversation.direct.resolve"] as const);
const V4_READ_CAPABILITIES = new Set<string>(CEAL_LEASED_CONSUMER_V4_READ_CAPABILITY_IDS);
const V4_WRITE_CAPABILITIES = new Set<string>(CEAL_LEASED_CONSUMER_V4_WRITE_CAPABILITY_IDS);
const V4_INGRESS_CONTEXT_CAPABILITIES = new Set<string>(CEAL_LEASED_CONSUMER_V4_INGRESS_CONTEXT_CAPABILITY_IDS);
// One grammar row per capability: id, argument schema, argument decoder. The
// decoder map, declared-id list, and exported argument-schema map are all
// derived from this single table so a consumer fixture (Goal 2 S0 mirror
// repair) can be generated from — and set-equality-checked against — the same
// source the wire decoders use.
const V4_CAPABILITY_GRAMMAR: ReadonlyArray<readonly [string, string, (value: unknown) => void]> = [
	["message.search", CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerMessageSearchArguments],
	["message.get", CEAL_LEASED_CONSUMER_MESSAGE_GET_ARGUMENTS_SCHEMA, decodeMessageGetArguments], ["conversation.thread.get", CEAL_LEASED_CONSUMER_CONVERSATION_THREAD_GET_ARGUMENTS_SCHEMA, decodeConversationThreadGetArguments],
	["message.create", CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA, decodeMessageCreateArguments], ["message.update", CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, decodeMessageUpdateArguments],
	["message.delete", CEAL_LEASED_CONSUMER_MESSAGE_DELETE_ARGUMENTS_SCHEMA, decodeMessageDeleteArguments], ["resource.resolve", CEAL_LEASED_CONSUMER_RESOURCE_RESOLVE_ARGUMENTS_SCHEMA, decodeResourceResolveArguments],
	["presentation.activity.set", CEAL_LEASED_CONSUMER_PRESENTATION_ACTIVITY_ARGUMENTS_SCHEMA, decodePresentationActivityArguments], ["message.reaction.add", CEAL_LEASED_CONSUMER_MESSAGE_REACTION_ARGUMENTS_SCHEMA, decodeMessageReactionArguments],
	["directory.usergroups.list", CEAL_LEASED_CONSUMER_USERGROUPS_LIST_ARGUMENTS_SCHEMA, decodeUsergroupsListArguments], ["directory.usergroups.members.list", CEAL_LEASED_CONSUMER_USERGROUP_MEMBERS_ARGUMENTS_SCHEMA, decodeUsergroupMembersArguments],
	["directory.people.search", CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerPeopleSearchArguments], ["file.search", CEAL_LEASED_CONSUMER_FILE_SEARCH_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerFileSearchArguments],
	["identity.profile_image.get", CEAL_LEASED_CONSUMER_PROFILE_IMAGE_ARGUMENTS_SCHEMA, decodeSubjectReadArguments(CEAL_LEASED_CONSUMER_PROFILE_IMAGE_ARGUMENTS_SCHEMA)], ["conversation.direct.resolve", CEAL_LEASED_CONSUMER_DIRECT_RESOLVE_ARGUMENTS_SCHEMA, decodeSubjectReadArguments(CEAL_LEASED_CONSUMER_DIRECT_RESOLVE_ARGUMENTS_SCHEMA)],
	["workflow.reply_intake.register", CEAL_LEASED_CONSUMER_REPLY_INTAKE_ARGUMENTS_SCHEMA, decodeReplyIntakeArguments], ["artifact.stage", CEAL_LEASED_CONSUMER_ARTIFACT_STAGE_ARGUMENTS_SCHEMA, decodeArtifactStageArguments],
	["file.upload", CEAL_LEASED_CONSUMER_FILE_UPLOAD_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerFileUploadArguments],
	["comment.create", CEAL_LEASED_CONSUMER_COMMENT_CREATE_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerCommentCreateArguments], ["document.create", CEAL_LEASED_CONSUMER_DOCUMENT_CREATE_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerDocumentCreateArguments], ["github.issue.create", CEAL_LEASED_CONSUMER_GITHUB_ISSUE_CREATE_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerGithubIssueCreateArguments], ["github.issue.get", CEAL_LEASED_CONSUMER_GITHUB_ISSUE_GET_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerGithubIssueGetArguments], ["github.pull_request.get", CEAL_LEASED_CONSUMER_GITHUB_PULL_REQUEST_GET_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerGithubPullRequestGetArguments], ["github.repository.get", CEAL_LEASED_CONSUMER_GITHUB_REPOSITORY_GET_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerGithubRepositoryGetArguments], ["collection.search", CEAL_LEASED_CONSUMER_COLLECTION_SEARCH_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerCollectionSearchArguments], ["github.workflow_run.get", CEAL_LEASED_CONSUMER_GITHUB_WORKFLOW_RUN_GET_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerGithubWorkflowRunGetArguments], ["calendar.availability", CEAL_LEASED_CONSUMER_CALENDAR_AVAILABILITY_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerCalendarAvailabilityArguments], ["calendar.event.search", CEAL_LEASED_CONSUMER_CALENDAR_EVENT_SEARCH_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerCalendarEventSearchArguments], ["calendar.event.get", CEAL_LEASED_CONSUMER_CALENDAR_EVENT_GET_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerCalendarEventGetArguments],
	["notion.search", CEAL_LEASED_CONSUMER_NOTION_SEARCH_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerNotionSearchArguments],
	["notion.page.get", CEAL_LEASED_CONSUMER_NOTION_PAGE_GET_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerNotionPageGetArguments],
	["sheets.values.read", CEAL_LEASED_CONSUMER_SHEETS_VALUES_READ_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerSheetsReadArguments],
	["sheets.values.update", CEAL_LEASED_CONSUMER_SHEETS_VALUES_UPDATE_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerSheetsUpdateArguments],
	["sheets.values.clear", CEAL_LEASED_CONSUMER_SHEETS_VALUES_CLEAR_ARGUMENTS_SCHEMA, decodeCealLeasedConsumerSheetsClearArguments],
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
		case "materialization": decodeResultMaterializationResult(result); break;
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
		case "materialization": decodeResultMaterializationInput(input); break;
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
	requireExactKeys(value, ["attachments", "capability_catalog", "event_ref", "event_revision", "messenger_context", "normalized_projection_ref", "normalized_projection_revision", "projection", "requester", "status"], ["messenger_context"]);
	if (!safeRef(value.event_ref) || !positive(value.event_revision) || !safeRef(value.normalized_projection_ref) || !positive(value.normalized_projection_revision)) invalid();
	decodeProjectionRequester(value.requester);
	decodeProjectionAttachments(value.attachments);
	decodeProjection(value.projection);
	try { decodeCealLeasedConsumerCapabilityCatalog(value.capability_catalog); } catch { invalid(); }
	if (value.messenger_context !== undefined) decodeMessengerContext(value.messenger_context);
}

export function decodeCealLeasedConsumerMessengerContext(value: unknown): CealLeasedConsumerMessengerContext {
	const record = requireRecord(value);
	requireExactKeys(record, ["capability_contexts", "conversation_ref"]);
	if (typeof record.conversation_ref !== "string" || !/^conversation:[a-f0-9]{64}$/u.test(record.conversation_ref)) invalid();
	decodeCapabilityContexts(record.capability_contexts);
	return value as CealLeasedConsumerMessengerContext;
}

function decodeMessengerContext(value: unknown): void {
	decodeCealLeasedConsumerMessengerContext(value);
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
		|| !Array.isArray(record.handles) || record.handles.length > CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_HANDLE_LIMIT || !record.handles.every(capabilityHandle)) invalid();
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
function decodeReplyIntakeArguments(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["correlation_ref", "mode", "root_ref", "routing", "schema_version", "skill_name", "workflow_name"], ["correlation_ref", "skill_name"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_REPLY_INTAKE_ARGUMENTS_SCHEMA || !opaqueMessageRef(record.root_ref) || record.mode !== "human_replies" || !["normal", "skill"].includes(record.routing as string)) invalid();
	if (!nullableNonemptyText(record.workflow_name)) invalid();
	if (!optionalNonemptyText(record.skill_name)) invalid();
	if (!optionalSafeRef(record.correlation_ref)) invalid();
}
function nullableNonemptyText(value: unknown): boolean { return value === null || (safeText(value, 256) && (value as string).length > 0); }
function optionalNonemptyText(value: unknown): boolean { return value === undefined || (safeText(value, 256) && (value as string).length > 0); }
function optionalSafeRef(value: unknown): boolean { return value === undefined || safeRef(value); }
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
const resourceReadItem = (value: unknown, handleCount: number): boolean => validCealLeasedConsumerResourceReadItem(value, handleCount, safeReplyText, safeText);
const RESOURCE_READ_RESULT_RULE: CapabilityResultRule = (effect, handles, data) => effect === "read" && decodeCealLeasedConsumerResourceReadData(data, handles, resourceReadItem);
const MESSAGE_SEARCH_RESULT_RULE: CapabilityResultRule = (effect, handles, data) => effect === "read" && (decodeCealLeasedConsumerMessageSearchData(data, handles, resourceReadItem) || decodeCealLeasedConsumerResourceReadData(data, handles, resourceReadItem));
const DOCUMENT_READ_RESULT_RULE: CapabilityResultRule = (effect, handles, data) => effect === "read" && handles.length <= 1 && handles.every((handle) => capabilityHandleKind(handle, "document")) && validCealLeasedConsumerDocumentReadData(data);
const MESSAGE_READ_RESULT_RULE: CapabilityResultRule = (effect, _handles, data) => effect === "read" && decodeMessageReadData(data);
const MESSAGE_WRITE_RESULT_RULE: CapabilityResultRule = (effect, handles, data) => effect === "write" && mutationHandleGroup(handles) && decodeMessageWriteData(data);
const MESSAGE_DELETE_RECEIPT_RESULT_RULE: CapabilityResultRule = (effect, handles, data) => effect === "write" && handles.length === 1 && capabilityHandleKind(handles[0], "message") && decodeMessageDeleteData(data); const MESSAGE_REACTION_RECEIPT_RESULT_RULE: CapabilityResultRule = (effect, handles, data) => effect === "write" && handles.length === 1 && capabilityHandleKind(handles[0], "message") && decodeMessageReactionData(data);
const SHEETS_READ_RESULT_RULE: CapabilityResultRule = (effect, handles, data) => effect === "read" && handles.length === 0 && validCealLeasedConsumerSheetsReadData(data);
const SHEETS_UPDATE_RESULT_RULE: CapabilityResultRule = (effect, handles, data) => effect === "write" && handles.length === 0 && validCealLeasedConsumerSheetsUpdateData(data);
const SHEETS_CLEAR_RESULT_RULE: CapabilityResultRule = (effect, handles, data) => effect === "write" && handles.length === 0 && validCealLeasedConsumerSheetsClearData(data);
const FILE_UPLOAD_RESULT_RULE: CapabilityResultRule = (effect, handles, data) => effect === "write" && handles.length === 0 && validCealLeasedConsumerFileUploadData(data);
const V4_CAPABILITY_RESULT_RULES = new Map<string, CapabilityResultRule>([
	// The merged read moved to the resource-read family: a row now carries a
	// handle index, because enumerate's per-row `message.get` handle is exactly
	// what made it worth keeping over the text-only search projection.
	["message.search", MESSAGE_SEARCH_RESULT_RULE],
	["message.get", MESSAGE_READ_RESULT_RULE],
	["conversation.thread.get", MESSAGE_READ_RESULT_RULE],
	["resource.resolve", RESOURCE_READ_RESULT_RULE],
	["directory.usergroups.list", RESOURCE_READ_RESULT_RULE],
	["directory.usergroups.members.list", RESOURCE_READ_RESULT_RULE],
	["directory.people.search", RESOURCE_READ_RESULT_RULE],
	["file.search", RESOURCE_READ_RESULT_RULE],
	["identity.profile_image.get", RESOURCE_READ_RESULT_RULE],
	["conversation.direct.resolve", RESOURCE_READ_RESULT_RULE],
	["message.create", MESSAGE_WRITE_RESULT_RULE],
	["message.update", MESSAGE_WRITE_RESULT_RULE],
	["message.delete", MESSAGE_DELETE_RECEIPT_RESULT_RULE],
	["comment.create", (effect, handles, data) => effect === "write" && handles.length === 0 && validCealLeasedConsumerCommentCreateData(data)], ["document.create", (effect, handles, data) => effect === "write" && handles.length === 1 && capabilityHandleKind(handles[0], "document") && validCealLeasedConsumerDocumentCreateData(data)], ["github.issue.create", (effect, handles, data) => effect === "write" && handles.length === 0 && validCealLeasedConsumerGithubIssueCreateData(data)],
	["presentation.activity.set", (effect, handles, data) => effect === "write" && handles.length === 0 && decodePresentationActivityData(data)],
	["message.reaction.add", MESSAGE_REACTION_RECEIPT_RESULT_RULE], ["workflow.reply_intake.register", (effect, handles, data) => effect === "write" && handles.length === 0 && decodeReplyIntakeData(data)],
	// A chunk ack carries no handle; the final chunk carries exactly the one
	// digest-verified artifact handle.
	["artifact.stage", (effect, handles, data) => effect === "write" && artifactStageHandles(handles, data) && decodeArtifactStageData(data)],
	// Placement is target-owned; no provider file locator or message mutation
	// handle crosses the leased result boundary.
	["file.upload", FILE_UPLOAD_RESULT_RULE],
	["github.issue.get", RESOURCE_READ_RESULT_RULE], ["github.pull_request.get", RESOURCE_READ_RESULT_RULE], ["github.repository.get", (effect, handles, data) => effect === "read" && handles.length === 0 && validCealLeasedConsumerGithubRepositoryReadData(data)], ["collection.search", (effect, handles, data) => effect === "read" && handles.length <= 32 && validCealLeasedConsumerCollectionSearchData(data)], ["github.workflow_run.get", (effect, handles, data) => effect === "read" && handles.length === 0 && validCealLeasedConsumerGithubWorkflowRunReadData(data)], ["calendar.availability", (effect, handles, data) => effect === "read" && handles.length === 0 && validCealLeasedConsumerCalendarAvailabilityData(data)], ["calendar.event.search", (effect, handles, data) => effect === "read" && handles.length <= 25 && validCealLeasedConsumerCalendarEventSearchData(data)], ["calendar.event.get", (effect, handles, data) => effect === "read" && handles.length === 0 && validCealLeasedConsumerCalendarEventGetData(data)],
	["notion.search", RESOURCE_READ_RESULT_RULE],
	["notion.page.get", DOCUMENT_READ_RESULT_RULE],
	["sheets.values.read", SHEETS_READ_RESULT_RULE],
	["sheets.values.update", SHEETS_UPDATE_RESULT_RULE],
	["sheets.values.clear", SHEETS_CLEAR_RESULT_RULE],
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
	return handles.filter((handle) => capabilityHandleKind(handle, "target")).length === 1 && messages >= 1
		&& messages <= CEAL_LEASED_CONSUMER_WRITE_MESSAGE_HANDLE_LIMIT && handles.length === messages + 1;
}
function decodeMessageReadData(value: unknown): boolean {
	if (!plainRecord(value)) return false;
	requireExactKeys(value, ["items", "schema_version"]);
	return value.schema_version === CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA && Array.isArray(value.items) && value.items.length <= 64 && value.items.every(messageReadItem);
}
function messageReadItem(value: unknown): boolean {
	if (!plainRecord(value)) return false;
	requireExactKeys(value, ["author", "reply_count", "text"], ["author", "reply_count"]);
	return safeReplyText(value.text) && validCealLeasedConsumerMessageReplyCount(value.reply_count) && (value.author === undefined || validCealLeasedConsumerMessageAuthor(value.author));
}
function decodeMessageWriteData(value: unknown): boolean {
	if (!plainRecord(value)) return false;
	requireExactKeys(value, ["schema_version", "terminal", "text"], ["text"]);
	return value.schema_version === CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA && ["readback_confirmed", "idempotency_replayed"].includes(value.terminal as string) && (value.text === undefined || safeReplyText(value.text));
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
function capabilityHandle(value: unknown): boolean { return validCealLeasedConsumerCapabilityHandle(value); }
function capabilityHandleKind(value: unknown, kind: CealLeasedConsumerCapabilityHandle["kind"]): boolean { return plainRecord(value) && value.kind === kind && capabilityHandle(value); }
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
import { isSafeUnixSocketPath } from "./unix-socket-path-safety.ts";
