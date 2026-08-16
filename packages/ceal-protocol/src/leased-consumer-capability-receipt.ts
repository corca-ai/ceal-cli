import { isCealPublicSafeDisplayName } from "./gateway-validation-primitives.ts";
import { opaqueCapabilityReceiptRef, opaqueMessageRef } from "./leased-consumer-opaque-refs.ts";

export const CEAL_LEASED_CONSUMER_CAPABILITY_RECEIPT_SCHEMA = "ceal.leased_consumer_capability_receipt.v1" as const;

export type CealLeasedConsumerCapabilityReceipt = {
	schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_RECEIPT_SCHEMA;
	receipt_ref: string;
	capability_id: "message.create" | "message.update" | "message.delete" | "message.reaction.add";
	effect: "write";
	object: { kind: "message"; ref: string };
	requester: { subject_ref: string };
	provider_outcome: "verified";
	result_delivery: "pending" | "offered" | "transport_lost";
	content: { bytes: number; sha256: string; preview?: string };
	author:
		| { status: "present"; author_ref: string; display_name?: string; actor_kind: "human" | "bot" | "app" | "unknown" }
		| { status: "absent"; reason: "not_available_without_provider_fetch" };
};

export function decodeCealLeasedConsumerCapabilityReceipt(value: unknown): CealLeasedConsumerCapabilityReceipt {
	const record = requireRecord(value);
	requireExactKeys(record, ["author", "capability_id", "content", "effect", "object", "provider_outcome", "receipt_ref", "requester", "result_delivery", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_CAPABILITY_RECEIPT_SCHEMA
		|| !opaqueCapabilityReceiptRef(record.receipt_ref)
		|| !["message.create", "message.update", "message.delete", "message.reaction.add"].includes(String(record.capability_id))
		|| record.effect !== "write" || record.provider_outcome !== "verified"
		|| !["pending", "offered", "transport_lost"].includes(String(record.result_delivery))) invalid();
	decodeObject(record.object);
	decodeRequester(record.requester);
	decodeContent(record.content);
	decodeAuthor(record.author);
	return record as unknown as CealLeasedConsumerCapabilityReceipt;
}

function decodeObject(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["kind", "ref"]);
	if (record.kind !== "message" || !opaqueMessageRef(record.ref)) invalid();
}

function decodeRequester(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["subject_ref"]);
	if (typeof record.subject_ref !== "string" || !/^subject:[a-f0-9]{64}$/u.test(record.subject_ref)) invalid();
}

function decodeContent(value: unknown): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["bytes", "sha256"], ["preview"]);
	if (!nonnegative(record.bytes) || !sha256(record.sha256) || (record.preview !== undefined && !safePreview(record.preview))) invalid();
}

function decodeAuthor(value: unknown): void {
	const record = requireRecord(value);
	if (record.status === "absent") {
		requireExactKeys(record, ["reason", "status"]);
		if (record.reason !== "not_available_without_provider_fetch") invalid();
		return;
	}
	if (record.status !== "present") invalid();
	requireExactKeys(record, ["actor_kind", "author_ref", "status"], ["display_name"]);
	if (typeof record.author_ref !== "string" || !/^author:[a-f0-9]{64}$/u.test(record.author_ref)
		|| !["human", "bot", "app", "unknown"].includes(String(record.actor_kind))
		|| (record.display_name !== undefined && !isCealPublicSafeDisplayName(record.display_name))) invalid();
}

function safePreview(value: unknown): value is string {
	return typeof value === "string" && Buffer.byteLength(value, "utf8") <= 512
		&& ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32 && !["\t", "\n", "\r"].includes(character) || character.codePointAt(0) === 127);
}
function nonnegative(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function sha256(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function requireRecord(value: unknown): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function requireExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
	const allowed = new Set([...required, ...optional]);
	if (!required.every((key) => Object.hasOwn(value, key)) || Object.keys(value).some((key) => !allowed.has(key))) invalid();
}
function invalid(): never { throw new TypeError("Ceal leased-consumer capability receipt is invalid"); }
