import { opaqueDocumentRef } from "./leased-consumer-opaque-refs.ts";

export const CEAL_LEASED_CONSUMER_GITHUB_ISSUE_GET_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_github_issue_get_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_GITHUB_PULL_REQUEST_GET_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_github_pull_request_get_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_GITHUB_ISSUE_CREATE_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_github_issue_create_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_GITHUB_ISSUE_CREATE_DATA_SCHEMA = "ceal.gateway_leased_agent_github_issue_create_data.v1" as const;

export interface CealLeasedConsumerGithubIssueGetArguments {
	schema_version: typeof CEAL_LEASED_CONSUMER_GITHUB_ISSUE_GET_ARGUMENTS_SCHEMA;
	ref: string;
}

export interface CealLeasedConsumerGithubPullRequestGetArguments {
	schema_version: typeof CEAL_LEASED_CONSUMER_GITHUB_PULL_REQUEST_GET_ARGUMENTS_SCHEMA;
	ref: string;
}
export interface CealLeasedConsumerGithubIssueCreateArguments {
	schema_version: typeof CEAL_LEASED_CONSUMER_GITHUB_ISSUE_CREATE_ARGUMENTS_SCHEMA;
	title: string;
	body: string;
	labels: readonly string[];
	idempotency_key: string;
}

export function decodeCealLeasedConsumerGithubIssueGetArguments(value: unknown): void {
	decode(value, CEAL_LEASED_CONSUMER_GITHUB_ISSUE_GET_ARGUMENTS_SCHEMA);
}

export function decodeCealLeasedConsumerGithubPullRequestGetArguments(value: unknown): void {
	decode(value, CEAL_LEASED_CONSUMER_GITHUB_PULL_REQUEST_GET_ARGUMENTS_SCHEMA);
}
export function decodeCealLeasedConsumerGithubIssueCreateArguments(value: unknown): void {
	if (!plainRecord(value) || !exactKeys(value, ["body", "idempotency_key", "labels", "schema_version", "title"])
		|| value.schema_version !== CEAL_LEASED_CONSUMER_GITHUB_ISSUE_CREATE_ARGUMENTS_SCHEMA || !safeText(value.title, 512) || !safeText(value.body, 8_192)
		|| Buffer.byteLength(value.title, "utf8") + Buffer.byteLength(value.body, "utf8") > 8_192 || !safeKey(value.idempotency_key)
		|| !validIssueCreateLabels(value.labels)) invalid();
}
export function validCealLeasedConsumerGithubIssueCreateData(value: unknown): boolean {
	return plainRecord(value) && exactKeys(value, ["schema_version", "terminal"]) && value.schema_version === CEAL_LEASED_CONSUMER_GITHUB_ISSUE_CREATE_DATA_SCHEMA
		&& ["readback_confirmed", "idempotency_replayed"].includes(String(value.terminal));
}

function decode(value: unknown, schema: string): void {
	if (!plainRecord(value) || !exactKeys(value, ["ref", "schema_version"])
		|| value.schema_version !== schema || !opaqueDocumentRef(value.ref)) invalid();
}
function validIssueCreateLabels(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.length <= 20 && value.every((label) => safeText(label, 128))
		&& new Set(value.map((label) => label.toLocaleLowerCase("en-US"))).size === value.length;
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort(); const ordered = [...expected].sort();
	return actual.length === ordered.length && actual.every((key, index) => key === ordered[index]);
}
function plainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function safeText(value: unknown, maximum: number): value is string { return typeof value === "string" && Buffer.byteLength(value, "utf8") > 0 && Buffer.byteLength(value, "utf8") <= maximum && ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127); }
function safeKey(value: unknown): value is string { return safeText(value, 128) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value); }
function invalid(): never { throw new TypeError("Ceal leased-consumer GitHub record is invalid"); }
