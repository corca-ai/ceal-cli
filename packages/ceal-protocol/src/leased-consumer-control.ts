/**
 * Canonical private control-session records for a Gateway-owned leased
 * consumer. These records never carry a personal session, provider identity,
 * endpoint selector, or Agent-supplied service authority.
 */
import { requireJsonByteSize } from "./gateway-validation-primitives.js";
export const CEAL_LEASED_CONSUMER_CONTROL_SESSION_SCHEMA = "ceal.leased_consumer_control_session.v1" as const;
export const CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA = "ceal.leased_consumer_control_request.v1" as const;
export const CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA = "ceal.leased_consumer_control_response.v1" as const;
export const CEAL_LEASED_CONSUMER_RESULT_CONTROL_REQUEST_SCHEMA = "ceal.leased_consumer_result_control_request.v2" as const;
export const CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA = "ceal.leased_consumer_result_control_response.v2" as const;
export const CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_SCHEMA = "ceal.gateway_leased_agent_delegated_read_result.v1" as const;
export const CEAL_LEASED_CONSUMER_CONTROL_MAX_SESSION_BYTES = 8 * 1024;
export const CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES = 32 * 1024;
export const CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_MAX_BYTES = 24 * 1024;

export type CealLeasedConsumerControlOperation = "acquire" | "projection" | "recheck" | "call" | "complete";
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
	context?: { conversation_kind: "channel" | "dm" | "group"; is_thread_reply: boolean };
}

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const CONTROL_OPERATIONS = new Set<CealLeasedConsumerControlOperation>(["acquire", "projection", "recheck", "call", "complete"]);
const TERMINAL_STATUSES = new Set<CealLeasedConsumerControlTerminalResult["status"]>(["lease_lost", "lease_expired", "event_settled"]);

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
function decodeCompleteInput(value: Record<string, unknown>): void {
	requireExactKeys(value, ["agent_run_ref", "disposition", "event_ref", "lease_fence", "lease_ref"], ["agent_run_ref"]);
	if (!safeRef(value.event_ref) || !safeRef(value.lease_ref) || !positive(value.lease_fence) || !["completed", "failed", "cancelled", "deferred"].includes(value.disposition as string) || (value.agent_run_ref !== undefined && !safeRef(value.agent_run_ref))) invalid();
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
function decodeDelegatedReadResult(value: unknown): void {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_MAX_BYTES, invalid);
	const record = requireRecord(value); requireExactKeys(record, ["capability_id", "data", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_SCHEMA || !safeRef(record.capability_id) || !safeResultJson(record.data)) invalid();
}
function decodeCompleteResult(value: Record<string, unknown>): void { if (value.status === "authentication_failed" || value.status === "control_unavailable") { requireExactKeys(value, ["status"]); } else if (value.status === "completed") { requireExactKeys(value, ["replayed", "status"]); if (typeof value.replayed !== "boolean") invalid(); } else decodeTerminal(value); }
function decodeTerminal(value: Record<string, unknown>): void { requireExactKeys(value, ["status"]); if (!TERMINAL_STATUSES.has(value.status as CealLeasedConsumerControlTerminalResult["status"])) invalid(); }
function decodeLease(value: unknown): void { const record = requireRecord(value); requireExactKeys(record, ["delivery_attempt", "event_ref", "expires_at", "lease_fence", "lease_ref"]); if (!safeRef(record.event_ref) || !safeRef(record.lease_ref) || !positive(record.lease_fence) || !positive(record.delivery_attempt) || !timestamp(record.expires_at)) invalid(); }
function decodeProjection(value: unknown): void { const record = requireRecord(value); requireExactKeys(record, Object.hasOwn(record, "context") ? ["context", "schema_version", "text"] : ["schema_version", "text"]); if (record.schema_version !== "ceal.gateway_normalized_projection.v1" || !safeText(record.text, 16_384) || (record.context !== undefined && !projectionContext(record.context))) invalid(); }
function projectionContext(value: unknown): boolean { if (!record(value)) return false; const context = value as Record<string, unknown>; return exactKeys(context, ["conversation_kind", "is_thread_reply"]) && ["channel", "dm", "group"].includes(context.conversation_kind as string) && typeof context.is_thread_reply === "boolean"; }
function socketPath(value: unknown): boolean { return typeof value === "string" && value.startsWith("/") && value.length <= 1024 && !/[\r\n\0]/u.test(value) && !value.endsWith("/admin-gateway.sock"); }
function credential(value: unknown): boolean { return typeof value === "string" && Buffer.byteLength(value, "utf8") > 0 && Buffer.byteLength(value, "utf8") <= 4096 && /^[\x21-\x7e]+$/u.test(value); }
function safeRef(value: unknown): value is string { return typeof value === "string" && SAFE_REF.test(value); }
function positive(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 1; }
function timestamp(value: unknown): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function safeText(value: unknown, maximum: number): value is string { return typeof value === "string" && Buffer.byteLength(value, "utf8") <= maximum && ![...value].some((character) => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127); }
function safeJson(value: unknown, depth = 0): boolean { if (depth > 16) return false; if (value === null || typeof value === "boolean") return true; if (typeof value === "number") return Number.isFinite(value); if (typeof value === "string") return safeText(value, 8 * 1024); if (Array.isArray(value)) return value.length <= 128 && value.every((entry) => safeJson(entry, depth + 1)); if (!record(value) || Object.keys(value).length > 128) return false; return Object.entries(value).every(([key, entry]) => safeText(key, 128) && !/(?:token|secret|password|authorization|credential|provenance|runner|consumer|requester|source_kind)/iu.test(key) && safeJson(entry, depth + 1)); }
function safeResultJson(value: unknown, depth = 0): boolean { if (depth > 8) return false; if (value === null || typeof value === "boolean") return true; if (typeof value === "number") return Number.isFinite(value); if (typeof value === "string") return safeText(value, 4 * 1024); if (Array.isArray(value)) return value.length <= 64 && value.every((entry) => safeResultJson(entry, depth + 1)); if (!plainRecord(value) || Object.keys(value).length > 64) return false; return Object.entries(value).every(([key, entry]) => safeResultKey(key) && safeResultJson(entry, depth + 1)); }
function safeResultKey(value: string): boolean { return safeText(value, 128) && !/(?:token|secret|password|authorization|credential|provenance|runner|consumer|requester|source_kind|attachment|binary|body|header|url|uri|link|path|locator|acl|permission|__proto__|constructor|prototype)/iu.test(value); }
function requireRecord(value: unknown): Record<string, unknown> { if (!record(value)) invalid(); return value; }
function requireExactKeys(value: Record<string, unknown>, expected: readonly string[], optional: readonly string[] = []): void { const keys = Object.keys(value).sort(); const allowed = [...expected].sort(); const required = allowed.filter((key) => !optional.includes(key)); if (keys.length < required.length || keys.length > allowed.length || !keys.every((key) => allowed.includes(key)) || !required.every((key) => Object.hasOwn(value, key))) invalid(); }
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean { const keys = Object.keys(value).sort(); return keys.length === expected.length && keys.every((key, index) => key === expected[index]); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function plainRecord(value: unknown): value is Record<string, unknown> { return record(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function invalid(): never { throw new TypeError("Ceal leased-consumer control record is invalid"); }
