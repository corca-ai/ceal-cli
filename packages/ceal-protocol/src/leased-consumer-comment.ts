import { opaqueDocumentRef } from "./leased-consumer-opaque-refs.ts";

export const CEAL_LEASED_CONSUMER_COMMENT_CREATE_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_comment_create_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_COMMENT_CREATE_DATA_SCHEMA = "ceal.gateway_leased_agent_comment_create_data.v1" as const;
export const CEAL_LEASED_CONSUMER_COMMENT_TEXT_MAX_BYTES = 8_192;

export interface CealLeasedConsumerCommentCreateArguments {
	schema_version: typeof CEAL_LEASED_CONSUMER_COMMENT_CREATE_ARGUMENTS_SCHEMA;
	ref: string;
	text: string;
}

export interface CealLeasedConsumerCommentCreateData {
	schema_version: typeof CEAL_LEASED_CONSUMER_COMMENT_CREATE_DATA_SCHEMA;
	terminal: "readback_confirmed" | "idempotency_replayed";
}

export function decodeCealLeasedConsumerCommentCreateArguments(value: unknown): void {
	const record = exactRecord(value, ["ref", "schema_version", "text"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_COMMENT_CREATE_ARGUMENTS_SCHEMA
		|| !opaqueDocumentRef(record.ref) || !safeText(record.text, CEAL_LEASED_CONSUMER_COMMENT_TEXT_MAX_BYTES)) invalid();
}

export function validCealLeasedConsumerCommentCreateData(value: unknown): value is CealLeasedConsumerCommentCreateData {
	return plainRecord(value) && exactKeys(value, ["schema_version", "terminal"])
		&& value.schema_version === CEAL_LEASED_CONSUMER_COMMENT_CREATE_DATA_SCHEMA
		&& ["readback_confirmed", "idempotency_replayed"].includes(value.terminal as string);
}

function exactRecord(value: unknown, expected: readonly string[]): Record<string, unknown> {
	if (!plainRecord(value) || !exactKeys(value, expected)) invalid();
	return value;
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort(); const ordered = [...expected].sort();
	return actual.length === ordered.length && actual.every((key, index) => key === ordered[index]);
}
function safeText(value: unknown, maximum: number): value is string {
	return typeof value === "string" && new TextEncoder().encode(value).byteLength > 0
		&& new TextEncoder().encode(value).byteLength <= maximum
		&& ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127);
}
function plainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function invalid(): never { throw new TypeError("Ceal leased-consumer comment record is invalid"); }
