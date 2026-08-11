import { requireJsonByteSize } from "./gateway-validation-primitives.js";
import {
	CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
	CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA,
	CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES,
	decodeCealLeasedConsumerCapabilityControlRequest,
	decodeCealLeasedConsumerCapabilityControlResponse,
	type CealLeasedConsumerCapabilityControlRequest,
	type CealLeasedConsumerCapabilityControlResponse,
} from "./leased-consumer-control.js";
import {
	decodeCealLeasedConsumerAgentControlProjectionResult,
	decodeCealLeasedConsumerControlEffectCompleteInput,
	isCealLeasedConsumerAgentControlProjectionResultCandidate,
	isCealLeasedConsumerControlEffectCompleteCandidate,
	type CealLeasedConsumerControlEffectCompleteInput,
	type CealLeasedConsumerV5CapabilityProjectionResult,
} from "./leased-consumer-agent-control.js";
import {
	decodeCealLeasedConsumerCapabilityNotificationBinding,
	decodeCealLeasedConsumerCapabilityNotificationReceiptResult,
	type CealLeasedConsumerCapabilityNotificationBinding,
	type CealLeasedConsumerCapabilityNotificationReceiptResult,
} from "./leased-consumer-notification.js";

export * from "./leased-consumer-control.js";
export * from "./leased-consumer-directory-reads.js";
export * from "./leased-consumer-agent-control.js";
export * from "./leased-consumer-presentation.js";
export * from "./leased-consumer-notification.js";

/**
 * Candidate-only v5 frame family. The currently selected serving ABI remains
 * v4 until a signed worker consumes an issued immutable conformance handoff.
 */
export const CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_REQUEST_SCHEMA = "ceal.leased_consumer_capability_control_request.v5" as const;
export const CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_RESPONSE_SCHEMA = "ceal.leased_consumer_capability_control_response.v5" as const;

type WithNotificationSchema<T, Schema extends string> = T extends { schema_version: string }
	? Omit<T, "schema_version"> & { schema_version: Schema }
	: never;

export type CealLeasedConsumerNotificationControlRequest =
	| WithNotificationSchema<CealLeasedConsumerCapabilityControlRequest, typeof CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_REQUEST_SCHEMA>
	| { schema_version: typeof CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_REQUEST_SCHEMA; operation: "complete"; input: CealLeasedConsumerControlEffectCompleteInput }
	| {
		schema_version: typeof CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_REQUEST_SCHEMA;
		operation: "notification_receipt";
		input: CealLeasedConsumerCapabilityNotificationBinding;
	};

export type CealLeasedConsumerNotificationControlResponse =
	| WithNotificationSchema<Exclude<CealLeasedConsumerCapabilityControlResponse, { operation: "projection" }>, typeof CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_RESPONSE_SCHEMA>
	| { schema_version: typeof CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_RESPONSE_SCHEMA; operation: "projection"; result: CealLeasedConsumerV5CapabilityProjectionResult }
	| {
		schema_version: typeof CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_RESPONSE_SCHEMA;
		operation: "notification_receipt";
		result: CealLeasedConsumerCapabilityNotificationReceiptResult;
	};

export function decodeCealLeasedConsumerNotificationControlRequest(value: unknown): CealLeasedConsumerNotificationControlRequest {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES, invalid);
	const record = requireRecord(value);
	requireExactKeys(record, ["input", "operation", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_REQUEST_SCHEMA || typeof record.operation !== "string") invalid();
	if (record.operation === "notification_receipt") {
		decodeCealLeasedConsumerCapabilityNotificationBinding(record.input);
	} else if (record.operation === "complete" && isCealLeasedConsumerControlEffectCompleteCandidate(record.input)) {
		decodeCealLeasedConsumerControlEffectCompleteInput(record.input);
	} else {
		decodeCealLeasedConsumerCapabilityControlRequest({
			...record,
			schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
		});
	}
	return record as unknown as CealLeasedConsumerNotificationControlRequest;
}

export function decodeCealLeasedConsumerNotificationControlResponse(value: unknown): CealLeasedConsumerNotificationControlResponse {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES, invalid);
	const record = requireRecord(value);
	requireExactKeys(record, ["operation", "result", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_RESPONSE_SCHEMA || typeof record.operation !== "string") invalid();
	if (record.operation === "notification_receipt") {
		decodeCealLeasedConsumerCapabilityNotificationReceiptResult(record.result);
	} else if (record.operation === "projection" && isCealLeasedConsumerAgentControlProjectionResultCandidate(record.result)) {
		decodeCealLeasedConsumerAgentControlProjectionResult(record.result);
	} else {
		decodeCealLeasedConsumerCapabilityControlResponse({
			...record,
			schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA,
		});
	}
	return record as unknown as CealLeasedConsumerNotificationControlResponse;
}

function requireRecord(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
	return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
	const keys = Object.keys(value).sort();
	const allowed = [...expected].sort();
	if (keys.length !== allowed.length || !keys.every((key, index) => key === allowed[index])) invalid();
}

function invalid(): never {
	throw new TypeError("Ceal leased-consumer notification control record is invalid");
}
