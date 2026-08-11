import { requireJsonByteSize } from "./gateway-validation-primitives.js";
import {
	CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES,
	type CealLeasedConsumerCapabilityResult,
} from "./leased-consumer-control.js";
import {
	CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_REQUEST_SCHEMA,
	CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_RESPONSE_SCHEMA,
	decodeCealLeasedConsumerNotificationControlRequest,
	decodeCealLeasedConsumerNotificationControlResponse,
	type CealLeasedConsumerNotificationControlRequest,
	type CealLeasedConsumerNotificationControlResponse,
} from "./leased-consumer-notification-control.js";

export * from "./leased-consumer-notification-control.js";

/** Candidate-only v6: v5 grammar plus an exact public capability disposition. */
export const CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_REQUEST_SCHEMA = "ceal.leased_consumer_capability_control_request.v6" as const;
export const CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_RESPONSE_SCHEMA = "ceal.leased_consumer_capability_control_response.v6" as const;

export type CealLeasedConsumerProviderOutcome = "not_attempted" | "outcome_unknown" | "verified";
export type CealLeasedConsumerResultDelivery = "unavailable" | "pending" | "offered" | "transport_lost";

type WithDispositionSchema<T, Schema extends string> = T extends { schema_version: string }
	? Omit<T, "schema_version"> & { schema_version: Schema }
	: never;

export type CealLeasedConsumerDispositionControlRequest = WithDispositionSchema<CealLeasedConsumerNotificationControlRequest, typeof CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_REQUEST_SCHEMA>;
export type CealLeasedConsumerCapabilityDispositionResult =
	| { status: "result"; result: CealLeasedConsumerCapabilityResult; provider_outcome: "verified"; result_delivery: "pending" }
	| { status: "capability_unavailable"; provider_outcome: "not_attempted" | "outcome_unknown"; result_delivery: "unavailable" }
	| { status: "capability_result_unavailable"; provider_outcome: "verified"; result_delivery: "unavailable" | "pending" | "transport_lost" }
	| { status: "write_unknown"; provider_outcome: "outcome_unknown"; result_delivery: "unavailable" }
	| { status: "result_not_replayable"; provider_outcome: "verified"; result_delivery: "offered" };
export type CealLeasedConsumerDispositionPreCallFailure = { status: "lease_lost" | "lease_expired" | "action_scope_unavailable" | "action_scope_mismatch" | "capability_unavailable" | "authentication_failed" };
export type CealLeasedConsumerDispositionControlResponse =
	| WithDispositionSchema<Exclude<CealLeasedConsumerNotificationControlResponse, { operation: "call" }>, typeof CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_RESPONSE_SCHEMA>
	| { schema_version: typeof CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_RESPONSE_SCHEMA; operation: "call"; result: CealLeasedConsumerCapabilityDispositionResult | CealLeasedConsumerDispositionPreCallFailure };

export function decodeCealLeasedConsumerDispositionControlRequest(value: unknown): CealLeasedConsumerDispositionControlRequest {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES, invalid);
	const record = requireRecord(value); requireExactKeys(record, ["input", "operation", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_REQUEST_SCHEMA) invalid();
	decodeCealLeasedConsumerNotificationControlRequest({ ...record, schema_version: CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_REQUEST_SCHEMA });
	return record as unknown as CealLeasedConsumerDispositionControlRequest;
}

export function decodeCealLeasedConsumerDispositionControlResponse(value: unknown): CealLeasedConsumerDispositionControlResponse {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES, invalid);
	const record = requireRecord(value); requireExactKeys(record, ["operation", "result", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_DISPOSITION_CONTROL_RESPONSE_SCHEMA || typeof record.operation !== "string") invalid();
	if (record.operation === "call") decodeCallResult(record.result);
	else decodeCealLeasedConsumerNotificationControlResponse({ ...record, schema_version: CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_RESPONSE_SCHEMA });
	return record as unknown as CealLeasedConsumerDispositionControlResponse;
}

function decodeCallResult(value: unknown): void {
	const result = requireRecord(value);
	if (!hasDisposition(result)) return decodeLegacyCallResult(result);
	if (result.status === "result") return decodePendingResult(result);
	decodeDispositionFailure(result);
}
function decodeLegacyCallResult(result: Record<string, unknown>): void {
	requireExactKeys(result, ["status"]);
	if (!["lease_lost", "lease_expired", "action_scope_unavailable", "action_scope_mismatch", "capability_unavailable", "authentication_failed"].includes(String(result.status))) invalid();
}
function decodePendingResult(result: Record<string, unknown>): void {
	requireExactKeys(result, ["provider_outcome", "result", "result_delivery", "status"]);
	if (result.provider_outcome !== "verified" || result.result_delivery !== "pending") invalid();
	decodeCealLeasedConsumerNotificationControlResponse({ schema_version: CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: result.result } });
}
function decodeDispositionFailure(result: Record<string, unknown>): void {
	requireExactKeys(result, ["provider_outcome", "result_delivery", "status"]);
	if (!legalDisposition(result.provider_outcome, result.result_delivery) || !legalFailureStatus(result)) invalid();
}
function hasDisposition(value: Record<string, unknown>): boolean { return Object.hasOwn(value, "provider_outcome") || Object.hasOwn(value, "result_delivery"); }

function legalFailureStatus(result: Record<string, unknown>): boolean {
	if (result.status === "capability_unavailable") return ["not_attempted", "outcome_unknown"].includes(String(result.provider_outcome)) && result.result_delivery === "unavailable";
	if (result.status === "write_unknown") return result.provider_outcome === "outcome_unknown" && result.result_delivery === "unavailable";
	if (result.status === "capability_result_unavailable") return result.provider_outcome === "verified" && ["unavailable", "pending", "transport_lost"].includes(String(result.result_delivery));
	return result.status === "result_not_replayable" && result.provider_outcome === "verified" && result.result_delivery === "offered";
}

function legalDisposition(providerOutcome: unknown, resultDelivery: unknown): boolean {
	return providerOutcome === "verified"
		? ["unavailable", "pending", "offered", "transport_lost"].includes(String(resultDelivery))
		: ["not_attempted", "outcome_unknown"].includes(String(providerOutcome)) && resultDelivery === "unavailable";
}
function requireRecord(value: unknown): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void { const keys = Object.keys(value).sort(); const allowed = [...expected].sort(); if (keys.length !== allowed.length || !keys.every((key, index) => key === allowed[index])) invalid(); }
function invalid(): never { throw new TypeError("Ceal leased-consumer disposition control record is invalid"); }
