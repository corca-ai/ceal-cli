import { opaqueDocumentRef } from "./leased-consumer-opaque-refs.ts";

export const CEAL_LEASED_CONSUMER_DOCUMENT_CREATE_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_document_create_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_DOCUMENT_CREATE_DATA_SCHEMA = "ceal.gateway_leased_agent_document_create_data.v1" as const;
export const CEAL_LEASED_CONSUMER_DOCUMENT_TITLE_MAX_BYTES = 512;
export const CEAL_LEASED_CONSUMER_DOCUMENT_BODY_MAX_BYTES = 8_192;
export const CEAL_LEASED_CONSUMER_DOCUMENT_IDEMPOTENCY_KEY_MAX_BYTES = 128;

export interface CealLeasedConsumerDocumentCreateArguments {
	schema_version: typeof CEAL_LEASED_CONSUMER_DOCUMENT_CREATE_ARGUMENTS_SCHEMA;
	parent_ref: string;
	title: string;
	idempotency_key: string;
	body?: string;
}

export interface CealLeasedConsumerDocumentCreateData {
	schema_version: typeof CEAL_LEASED_CONSUMER_DOCUMENT_CREATE_DATA_SCHEMA;
	terminal: "readback_confirmed" | "idempotency_replayed";
}

export function decodeCealLeasedConsumerDocumentCreateArguments(value: unknown): void {
	const record = exactRecord(value, ["idempotency_key", "parent_ref", "schema_version", "title"], ["body"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_DOCUMENT_CREATE_ARGUMENTS_SCHEMA
		|| !opaqueDocumentRef(record.parent_ref)
		|| !safeText(record.title, CEAL_LEASED_CONSUMER_DOCUMENT_TITLE_MAX_BYTES)
		|| !safeIdempotencyKey(record.idempotency_key)
		|| (record.body !== undefined && !safeText(record.body, CEAL_LEASED_CONSUMER_DOCUMENT_BODY_MAX_BYTES))) invalid();
}

export function validCealLeasedConsumerDocumentCreateData(value: unknown): value is CealLeasedConsumerDocumentCreateData {
	return plainRecord(value) && exactKeys(value, ["schema_version", "terminal"])
		&& value.schema_version === CEAL_LEASED_CONSUMER_DOCUMENT_CREATE_DATA_SCHEMA
		&& ["readback_confirmed", "idempotency_replayed"].includes(value.terminal as string);
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
	if (!plainRecord(value) || !exactKeys(value, required, optional)) invalid();
	return value;
}
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
	const allowed = new Set([...required, ...optional]);
	return Object.keys(value).every((key) => allowed.has(key)) && required.every((key) => Object.hasOwn(value, key));
}
function safeIdempotencyKey(value: unknown): value is string {
	return typeof value === "string" && Buffer.byteLength(value, "utf8") >= 1
		&& Buffer.byteLength(value, "utf8") <= CEAL_LEASED_CONSUMER_DOCUMENT_IDEMPOTENCY_KEY_MAX_BYTES
		&& /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}
function safeText(value: unknown, maximum: number): value is string {
	return typeof value === "string" && Buffer.byteLength(value, "utf8") >= 1
		&& Buffer.byteLength(value, "utf8") <= maximum
		&& ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127);
}
function plainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function invalid(): never { throw new TypeError("Ceal leased-consumer document record is invalid"); }
