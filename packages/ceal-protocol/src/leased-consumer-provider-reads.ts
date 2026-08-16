import { opaqueDocumentRef } from "./leased-consumer-opaque-refs.ts";

export const CEAL_LEASED_CONSUMER_GITHUB_REPOSITORY_GET_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_github_repository_get_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_GITHUB_WORKFLOW_RUN_GET_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_github_workflow_run_get_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_COLLECTION_SEARCH_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_collection_search_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_CALENDAR_AVAILABILITY_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_calendar_availability_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_CALENDAR_EVENT_SEARCH_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_calendar_event_search_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_CALENDAR_EVENT_GET_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_calendar_event_get_arguments.v1" as const;

export const CEAL_LEASED_CONSUMER_GITHUB_REPOSITORY_READ_DATA_SCHEMA = "ceal.gateway_leased_agent_github_repository_read_data.v1" as const;
export const CEAL_LEASED_CONSUMER_GITHUB_WORKFLOW_RUN_READ_DATA_SCHEMA = "ceal.gateway_leased_agent_github_workflow_run_read_data.v1" as const;
export const CEAL_LEASED_CONSUMER_COLLECTION_SEARCH_DATA_SCHEMA = "ceal.gateway_leased_agent_collection_search_data.v1" as const;
export const CEAL_LEASED_CONSUMER_CALENDAR_AVAILABILITY_DATA_SCHEMA = "ceal.gateway_leased_agent_calendar_availability_data.v1" as const;
export const CEAL_LEASED_CONSUMER_CALENDAR_EVENT_SEARCH_DATA_SCHEMA = "ceal.gateway_leased_agent_calendar_event_search_data.v1" as const;
export const CEAL_LEASED_CONSUMER_CALENDAR_EVENT_GET_DATA_SCHEMA = "ceal.gateway_leased_agent_calendar_event_get_data.v1" as const;

export type CealLeasedConsumerGithubRepositoryGetArguments = { schema_version: typeof CEAL_LEASED_CONSUMER_GITHUB_REPOSITORY_GET_ARGUMENTS_SCHEMA; ref: string };
export type CealLeasedConsumerGithubWorkflowRunGetArguments = { schema_version: typeof CEAL_LEASED_CONSUMER_GITHUB_WORKFLOW_RUN_GET_ARGUMENTS_SCHEMA; run_id: number };
export type CealLeasedConsumerCollectionSearchArguments = { schema_version: typeof CEAL_LEASED_CONSUMER_COLLECTION_SEARCH_ARGUMENTS_SCHEMA; query: string; limit: number; offset: number };
export type CealLeasedConsumerCalendarAvailabilityArguments = { schema_version: typeof CEAL_LEASED_CONSUMER_CALENDAR_AVAILABILITY_ARGUMENTS_SCHEMA; time_min: string; time_max: string; time_zone?: string };
export type CealLeasedConsumerCalendarEventSearchArguments = { schema_version: typeof CEAL_LEASED_CONSUMER_CALENDAR_EVENT_SEARCH_ARGUMENTS_SCHEMA; time_min: string; time_max: string; query?: string; limit?: number; time_zone?: string };
export type CealLeasedConsumerCalendarEventGetArguments = { schema_version: typeof CEAL_LEASED_CONSUMER_CALENDAR_EVENT_GET_ARGUMENTS_SCHEMA; ref: string };

export function decodeCealLeasedConsumerGithubRepositoryGetArguments(value: unknown): void {
	decodeOpaqueRefArguments(value, CEAL_LEASED_CONSUMER_GITHUB_REPOSITORY_GET_ARGUMENTS_SCHEMA);
}
export function decodeCealLeasedConsumerGithubWorkflowRunGetArguments(value: unknown): void {
	const record = exactRecord(value, ["run_id", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_GITHUB_WORKFLOW_RUN_GET_ARGUMENTS_SCHEMA || !positive(record.run_id)) invalid();
}
export function decodeCealLeasedConsumerCollectionSearchArguments(value: unknown): void {
	const record = exactRecord(value, ["limit", "offset", "query", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_COLLECTION_SEARCH_ARGUMENTS_SCHEMA || !safeText(record.query, 512) || !record.query.trim()
		|| !positive(record.limit) || record.limit > 32 || !nonnegative(record.offset) || record.offset > 90) invalid();
}
export function decodeCealLeasedConsumerCalendarAvailabilityArguments(value: unknown): void {
	const record = exactRecord(value, ["time_min", "time_max", "schema_version"], ["time_zone"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_CALENDAR_AVAILABILITY_ARGUMENTS_SCHEMA || !validWindow(record) || !validTimeZone(record.time_zone)) invalid();
}
export function decodeCealLeasedConsumerCalendarEventSearchArguments(value: unknown): void {
	const record = exactRecord(value, ["time_min", "time_max", "schema_version"], ["limit", "query", "time_zone"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_CALENDAR_EVENT_SEARCH_ARGUMENTS_SCHEMA || !validWindow(record) || !validTimeZone(record.time_zone)
		|| (record.query !== undefined && !safeText(record.query, 512)) || (record.limit !== undefined && (!positive(record.limit) || record.limit > 25))) invalid();
}
export function decodeCealLeasedConsumerCalendarEventGetArguments(value: unknown): void {
	decodeOpaqueRefArguments(value, CEAL_LEASED_CONSUMER_CALENDAR_EVENT_GET_ARGUMENTS_SCHEMA);
}

export function validCealLeasedConsumerGithubRepositoryReadData(value: unknown): boolean {
	if (!plainRecord(value) || !exactKeys(value, ["repository", "schema_version"]) || value.schema_version !== CEAL_LEASED_CONSUMER_GITHUB_REPOSITORY_READ_DATA_SCHEMA || !plainRecord(value.repository)) return false;
	return validGithubRepository(value.repository);
}
export function validCealLeasedConsumerGithubWorkflowRunReadData(value: unknown): boolean {
	if (!plainRecord(value) || !exactKeys(value, ["schema_version", "workflow_run"]) || value.schema_version !== CEAL_LEASED_CONSUMER_GITHUB_WORKFLOW_RUN_READ_DATA_SCHEMA || !plainRecord(value.workflow_run)) return false;
	return validWorkflowRun(value.workflow_run);
}
export function validCealLeasedConsumerCollectionSearchData(value: unknown): boolean {
	if (!plainRecord(value) || !exactKeys(value, ["coverage", "offset", "query", "result_count", "results", "schema_version"]) || value.schema_version !== CEAL_LEASED_CONSUMER_COLLECTION_SEARCH_DATA_SCHEMA) return false;
	return plainRecord(value.query) && plainRecord(value.coverage) && validCollectionQuery(value.query) && validCoverage(value.coverage)
		&& validCollectionPage(value);
}
export function validCealLeasedConsumerCalendarAvailabilityData(value: unknown): boolean {
	if (!plainRecord(value) || !exactKeys(value, ["busy_periods", "partial", "schema_version", "time_max", "time_min"])
		|| value.schema_version !== CEAL_LEASED_CONSUMER_CALENDAR_AVAILABILITY_DATA_SCHEMA || !validRfc3339(value.time_min) || !validRfc3339(value.time_max) || typeof value.partial !== "boolean" || !Array.isArray(value.busy_periods) || value.busy_periods.length > 100) return false;
	return value.busy_periods.every((period) => plainRecord(period) && exactKeys(period, ["end", "start"]) && validRfc3339(period.start) && validRfc3339(period.end) && Date.parse(period.end as string) > Date.parse(period.start as string));
}
export function validCealLeasedConsumerCalendarEventSearchData(value: unknown): boolean {
	if (!plainRecord(value) || !exactKeys(value, ["coverage", "query", "result_count", "results", "schema_version", "time_max", "time_min"]) || value.schema_version !== CEAL_LEASED_CONSUMER_CALENDAR_EVENT_SEARCH_DATA_SCHEMA) return false;
	return validWindowResult(value) && plainRecord(value.query) && plainRecord(value.coverage) && validCollectionQuery(value.query) && validCoverage(value.coverage) && validCalendarPage(value);
}
export function validCealLeasedConsumerCalendarEventGetData(value: unknown): boolean {
	return plainRecord(value) && exactKeys(value, ["end", "schema_version", "start", "status", "summary"])
		&& value.schema_version === CEAL_LEASED_CONSUMER_CALENDAR_EVENT_GET_DATA_SCHEMA && optionalText(value.summary, 512) && optionalDate(value.start) && optionalDate(value.end) && optionalText(value.status, 80);
}

function validCollectionItem(value: unknown): boolean {
	return plainRecord(value) && exactKeys(value, ["display_name", "handle_index"], ["description_preview", "updated_at", "visibility"])
		&& safeText(value.display_name, 512) && nonnegative(value.handle_index) && value.handle_index <= 31
		&& (value.description_preview === undefined || safeText(value.description_preview, 512)) && optionalTimestamp(value.updated_at)
		&& (value.visibility === undefined || ["public", "private", "internal"].includes(String(value.visibility)));
}
function validGithubRepository(value: Record<string, unknown>): boolean {
	if (!exactKeys(value, ["archived", "fork", "name", "topics"], ["default_branch", "description", "visibility"]) || !safeText(value.name, 512)
		|| typeof value.archived !== "boolean" || typeof value.fork !== "boolean") return false;
	return (value.description === undefined || safeText(value.description, 1_024)) && (value.default_branch === undefined || safeAtom(value.default_branch, 255))
		&& (value.visibility === undefined || ["public", "private", "internal"].includes(String(value.visibility))) && validTopics(value.topics);
}
function validTopics(value: unknown): boolean { return Array.isArray(value) && value.length <= 20 && value.every((topic) => safeAtom(topic, 80)); }
function validWorkflowRun(value: Record<string, unknown>): boolean {
	if (!exactKeys(value, ["run_id"], ["conclusion", "created_at", "display_title", "event", "head_branch", "head_sha_short", "name", "run_attempt", "run_number", "status", "updated_at"]) || !positive(value.run_id)) return false;
	return [optionalAtom(value.name, 512), optionalAtom(value.display_title, 512), optionalAtom(value.event, 80), optionalAtom(value.status, 80), optionalAtom(value.conclusion, 80), optionalAtom(value.head_branch, 255), optionalAtom(value.head_sha_short, 12), optionalPositive(value.run_number), optionalPositive(value.run_attempt), optionalTimestamp(value.created_at), optionalTimestamp(value.updated_at)].every(Boolean);
}
function validCollectionQuery(value: Record<string, unknown>): boolean { return exactKeys(value, ["redacted", "utf8_bytes"]) && value.redacted === true && nonnegative(value.utf8_bytes) && value.utf8_bytes <= 512; }
function validCoverage(value: Record<string, unknown>): boolean { return exactKeys(value, ["completeness", "truncated"]) && ["complete", "incomplete"].includes(String(value.completeness)) && typeof value.truncated === "boolean"; }
function validCollectionPage(value: Record<string, unknown>): boolean { return nonnegative(value.offset) && value.offset <= 90 && nonnegative(value.result_count) && value.result_count <= 32 && Array.isArray(value.results) && value.results.length === value.result_count && value.results.every(validCollectionItem); }
function validWindowResult(value: Record<string, unknown>): boolean { return validRfc3339(value.time_min) && validRfc3339(value.time_max); }
function validCalendarPage(value: Record<string, unknown>): boolean { return nonnegative(value.result_count) && value.result_count <= 25 && Array.isArray(value.results) && value.results.length === value.result_count && value.results.every(validCalendarItem); }
function validCalendarItem(value: unknown): boolean {
	return plainRecord(value) && exactKeys(value, ["display_name", "end", "handle_index", "start", "status", "summary"])
		&& safeText(value.display_name, 512) && nonnegative(value.handle_index) && value.handle_index <= 24 && optionalText(value.summary, 512)
		&& optionalDate(value.start) && optionalDate(value.end) && optionalText(value.status, 80);
}
function decodeOpaqueRefArguments(value: unknown, expectedSchema: string): void {
	const record = exactRecord(value, ["ref", "schema_version"]);
	if (record.schema_version !== expectedSchema || !opaqueDocumentRef(record.ref)) invalid();
}
function validWindow(value: Record<string, unknown>): boolean { return validRfc3339(value.time_min) && validRfc3339(value.time_max) && Date.parse(value.time_max as string) > Date.parse(value.time_min as string) && Date.parse(value.time_max as string) - Date.parse(value.time_min as string) <= 31 * 24 * 60 * 60_000; }
function validTimeZone(value: unknown): boolean { return value === undefined || value === null || typeof value === "string" && value.length <= 128 && isTimeZone(value); }
function isTimeZone(value: string): boolean { try { Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; } }
function validRfc3339(value: unknown): value is string { return typeof value === "string" && value.length <= 64 && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(value) && Number.isFinite(Date.parse(value)); }
function optionalDate(value: unknown): boolean { return value === null || validRfc3339(value) || typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value); }
function optionalTimestamp(value: unknown): boolean { return value === undefined || value === null || validRfc3339(value); }
function optionalText(value: unknown, maximum: number): boolean { return value === null || value === undefined || safeText(value, maximum); }
function optionalAtom(value: unknown, maximum: number): boolean { return value === null || value === undefined || safeAtom(value, maximum); }
function optionalPositive(value: unknown): boolean { return value === null || value === undefined || positive(value); }
function safeAtom(value: unknown, maximum: number): value is string { return safeText(value, maximum) && !String(value).includes("\n"); }
function safeText(value: unknown, maximum: number): value is string { return typeof value === "string" && Buffer.byteLength(value, "utf8") > 0 && Buffer.byteLength(value, "utf8") <= maximum && ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127); }
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 1; }
function nonnegative(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> { if (!plainRecord(value) || !exactKeys(value, required, optional)) invalid(); return value; }
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean { const keys = Object.keys(value); const allowed = new Set([...required, ...optional]); return keys.every((key) => allowed.has(key)) && required.every((key) => Object.hasOwn(value, key)); }
function plainRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function invalid(): never { throw new TypeError("Ceal leased-consumer provider-read record is invalid"); }
