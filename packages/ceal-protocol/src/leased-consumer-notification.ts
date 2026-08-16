import { requireJsonByteSize } from "./gateway-validation-primitives.ts";

/**
 * Gateway-parent → signed-worker → Agent notification for one exact leased
 * execution. It carries no provider locator, requester fact, message payload,
 * credential, or caller-selected endpoint.
 */
export const CEAL_LEASED_CONSUMER_CAPABILITY_NOTIFICATION_SCHEMA = "ceal.leased_consumer_capability_notification.v5" as const;
export const CEAL_LEASED_CONSUMER_CAPABILITY_NOTIFICATION_MAX_BYTES = 4 * 1024;

export interface CealLeasedConsumerCapabilityNotificationBinding {
	kind: "abort_requested";
	notification_sequence: number;
	event_ref: string;
	event_revision: number;
	runner_ref: string;
	consumer_ref: string;
	consumer_generation: number;
	lease_ref: string;
	lease_fence: number;
}

export interface CealLeasedConsumerCapabilityNotification extends CealLeasedConsumerCapabilityNotificationBinding {
	schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_NOTIFICATION_SCHEMA;
}

export type CealLeasedConsumerCapabilityNotificationReceiptResult =
	| { status: "receipt_recorded" | "receipt_replayed" | "notification_stale" }
	| { status: "authentication_failed" | "control_unavailable" };

export function decodeCealLeasedConsumerCapabilityNotification(value: unknown): CealLeasedConsumerCapabilityNotification {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_CAPABILITY_NOTIFICATION_MAX_BYTES, invalid);
	const notification = requireRecord(value);
	requireExactKeys(notification, ["consumer_generation", "consumer_ref", "event_ref", "event_revision", "kind", "lease_fence", "lease_ref", "notification_sequence", "runner_ref", "schema_version"]);
	if (notification.schema_version !== CEAL_LEASED_CONSUMER_CAPABILITY_NOTIFICATION_SCHEMA) invalid();
	const { schema_version: _schemaVersion, ...binding } = notification;
	decodeCealLeasedConsumerCapabilityNotificationBinding(binding);
	return notification as unknown as CealLeasedConsumerCapabilityNotification;
}

export function decodeCealLeasedConsumerCapabilityNotificationBinding(value: unknown): CealLeasedConsumerCapabilityNotificationBinding {
	const binding = requireRecord(value);
	requireExactKeys(binding, ["consumer_generation", "consumer_ref", "event_ref", "event_revision", "kind", "lease_fence", "lease_ref", "notification_sequence", "runner_ref"]);
	if (binding.kind !== "abort_requested"
		|| !prefixedRef(binding.event_ref, "event:") || !prefixedRef(binding.runner_ref, "runner:")
		|| !prefixedRef(binding.consumer_ref, "consumer:") || !prefixedRef(binding.lease_ref, "lease:")
		|| ![binding.notification_sequence, binding.event_revision, binding.consumer_generation, binding.lease_fence].every(positive)) invalid();
	return binding as unknown as CealLeasedConsumerCapabilityNotificationBinding;
}

export function decodeCealLeasedConsumerCapabilityNotificationReceiptResult(value: unknown): CealLeasedConsumerCapabilityNotificationReceiptResult {
	const result = requireRecord(value);
	requireExactKeys(result, ["status"]);
	if (!["receipt_recorded", "receipt_replayed", "notification_stale", "authentication_failed", "control_unavailable"].includes(result.status as string)) invalid();
	return result as CealLeasedConsumerCapabilityNotificationReceiptResult;
}

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
function prefixedRef(value: unknown, prefix: string): value is string { return typeof value === "string" && value.startsWith(prefix) && SAFE_REF.test(value); }
function positive(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 1; }
function requireRecord(value: unknown): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void { const keys = Object.keys(value).sort(); const allowed = [...expected].sort(); if (keys.length !== allowed.length || !keys.every((key, index) => key === allowed[index])) invalid(); }
function invalid(): never { throw new TypeError("Ceal leased-consumer notification record is invalid"); }
