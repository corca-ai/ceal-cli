import { CEAL_RESULT_MATERIALIZATION_MAX_FILES, CEAL_RESULT_MATERIALIZATION_MAX_PREVIEW_BYTES } from "./result-materialization.js";
import { opaqueDocumentRef } from "./leased-consumer-opaque-refs.js";

export const CEAL_LEASED_CONSUMER_NOTION_SEARCH_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_notion_search_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_NOTION_PAGE_GET_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_notion_page_get_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_DOCUMENT_READ_DATA_SCHEMA = "ceal.gateway_leased_agent_document_read_data.v1" as const;

export interface CealLeasedConsumerDocumentReadData {
	schema_version: typeof CEAL_LEASED_CONSUMER_DOCUMENT_READ_DATA_SCHEMA;
	format: "enhanced_markdown";
	preview: string;
	complete: boolean;
	file_count: number;
}

export function decodeCealLeasedConsumerNotionSearchArguments(value: unknown): void {
	const record = exactRecord(value, ["query", "schema_version"], ["limit", "offset"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_NOTION_SEARCH_ARGUMENTS_SCHEMA || !safeText(record.query, 512)
		|| (record.limit !== undefined && (!positive(record.limit) || record.limit > 10))
		|| (record.offset !== undefined && (!Number.isSafeInteger(record.offset) || (record.offset as number) < 0 || (record.offset as number) > 90))) invalid();
}

export function decodeCealLeasedConsumerNotionPageGetArguments(value: unknown): void {
	const record = exactRecord(value, ["ref", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_NOTION_PAGE_GET_ARGUMENTS_SCHEMA || !opaqueDocumentRef(record.ref)) invalid();
}

export function validCealLeasedConsumerDocumentReadData(value: unknown): value is CealLeasedConsumerDocumentReadData {
	if (!plainRecord(value) || !hasExactKeys(value, ["complete", "file_count", "format", "preview", "schema_version"])) return false;
	return value.schema_version === CEAL_LEASED_CONSUMER_DOCUMENT_READ_DATA_SCHEMA && value.format === "enhanced_markdown"
		&& safePreview(value.preview) && positive(value.file_count) && value.file_count <= CEAL_RESULT_MATERIALIZATION_MAX_FILES
		&& typeof value.complete === "boolean";
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
	if (!plainRecord(value) || !hasExactKeys(value, required, optional)) invalid();
	return value;
}
function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
	const keys = Object.keys(value); const allowed = new Set([...required, ...optional]);
	return keys.every((key) => allowed.has(key)) && required.every((key) => Object.hasOwn(value, key));
}
function safeText(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).byteLength <= maximum && ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127); }
function safePreview(value: unknown): value is string { return typeof value === "string" && new TextEncoder().encode(value).byteLength <= CEAL_RESULT_MATERIALIZATION_MAX_PREVIEW_BYTES && ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32 && !["\t", "\n", "\r"].includes(character) || character.codePointAt(0) === 127); }
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 1; }
function plainRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function invalid(): never { throw new TypeError("Ceal leased-consumer control record is invalid"); }
