import type { CealGatewayCallRequest, CealGatewayMessageSearchCoverage } from "./gateway-response-types.js";
import { isCealSlackPermalinkInput, isCealSlackPermalinkSource } from "./slack-permalink.js";

export interface GatewayMessageContractContext {
	invalid(): never;
	record(value: unknown): Record<string, unknown>;
	exact(record: Record<string, unknown>, keys: string[], optional?: string[]): void;
	prefixed(value: unknown, prefix: string): void;
	safeText(value: unknown, maxBytes: number): void;
	byteLength(value: string): number;
	assertCoverage(value: unknown): asserts value is CealGatewayMessageSearchCoverage;
}

export function validateMessageSearchInputContract(value: unknown, context: GatewayMessageContractContext): void {
	const contract = context.record(value);
	context.exact(contract, ["limit", "offset", "query", "required", "schema_version"], ["offset"]);
	assertSearchContractIdentity(contract, context);
	assertSearchQueryContract(contract.query, context);
	assertSearchLimitContract(contract.limit, context);
	if (contract.offset !== undefined) assertSearchOffsetContract(contract.offset, context);
}

export function validateMessageSearchResult(
	value: unknown,
	expectedRequest: Readonly<CealGatewayCallRequest>,
	context: GatewayMessageContractContext,
): void {
	const result = context.record(value);
	context.exact(result, ["coverage", "minimization", "offset", "query", "result_count", "results", "schema_version"], ["next_offset", "offset"]);
	if (result.schema_version !== "ceal.message_search_result.v1") context.invalid();
	const input = decodeMessageSearchInput(expectedRequest.body.arguments, context);
	assertRedactedQuery(result.query, input.queryUtf8Bytes, context);
	assertSearchResultPage(result, input, expectedRequest.body.target_ref, context);
	context.assertCoverage(result.coverage);
	assertSearchMinimization(result.minimization, result.results, context);
}

export function validateMessageGetResult(
	value: unknown,
	expectedRequest: Readonly<CealGatewayCallRequest>,
	context: GatewayMessageContractContext,
): void {
	const result = context.record(value);
	context.exact(result, ["offset", "ref", "schema_version", "source", "source_label", "text"], ["next_offset", "source"]);
	if (result.schema_version !== "ceal.message_get_result.v1") context.invalid();
	const input = decodeMessageGetInput(expectedRequest.body.arguments, context);
	context.prefixed(result.ref, "message:");
	assertMessageGetMatch(result, input, context);
	context.safeText(result.source_label, 128);
	if (result.source !== undefined) assertSlackSource(result.source, context);
	assertMessageGetPage(result, input, context);
}

export function validateResourceResolveInputContract(value: unknown, context: GatewayMessageContractContext): void {
	const contract = context.record(value);
	context.exact(contract, ["required", "schema_version", "url"]);
	if (contract.schema_version !== "ceal.resource_resolve_input.v1" || !Array.isArray(contract.required)
		|| contract.required.length !== 1 || contract.required[0] !== "url") context.invalid();
	const url = context.record(contract.url);
	context.exact(url, ["format", "max_bytes", "type"]);
	if (url.type !== "string" || url.format !== "https_url" || url.max_bytes !== 2048) context.invalid();
}

export function validateResourceResolveResult(
	value: unknown,
	expectedRequest: Readonly<CealGatewayCallRequest>,
	context: GatewayMessageContractContext,
): void {
	const result = context.record(value);
	context.exact(result, ["resource", "schema_version"]);
	if (result.schema_version !== "ceal.resource_resolve_result.v1") context.invalid();
	const input = context.record(expectedRequest.body.arguments);
	context.exact(input, ["url"]);
	if (!isCealSlackPermalinkInput(input.url)) context.invalid();
	const resource = context.record(result.resource);
	context.exact(resource, ["kind", "ref", "source"]);
	if (resource.kind !== "message") context.invalid();
	context.prefixed(resource.ref, "message:");
	assertSlackSource(resource.source, context);
}

export function expectedCealGatewayCallRedactionOmissions(capabilityId: unknown, data: unknown): readonly string[] | null {
	if (capabilityId === "message.search") {
		return messageSearchSourceReturned(data) ? ["query_text", "raw_messages"] : ["query_text", "raw_provider_ids", "raw_messages"];
	}
	if (capabilityId === "message.get") {
		return sourceReturned(data) ? ["credential_material"] : ["credential_material", "provider_locator"];
	}
	return capabilityId === "resource.resolve" ? ["credential_material"] : null;
}

function assertSearchContractIdentity(contract: Record<string, unknown>, context: GatewayMessageContractContext): void {
	if (contract.schema_version !== "ceal.message_search_input.v1" || !Array.isArray(contract.required)
		|| contract.required.length !== 1 || contract.required[0] !== "query") context.invalid();
}

function assertSearchQueryContract(value: unknown, context: GatewayMessageContractContext): void {
	const query = context.record(value);
	context.exact(query, ["max_bytes", "type"]);
	if (query.type !== "string" || query.max_bytes !== 512) context.invalid();
}

function assertSearchLimitContract(value: unknown, context: GatewayMessageContractContext): void {
	assertIntegerContract(value, 1, 10, 5, context);
}

function assertSearchOffsetContract(value: unknown, context: GatewayMessageContractContext): void {
	assertIntegerContract(value, 0, 1000, 0, context);
}

function assertIntegerContract(value: unknown, minimum: number, maximum: number, defaultValue: number, context: GatewayMessageContractContext): void {
	const field = context.record(value);
	context.exact(field, ["default", "maximum", "minimum", "type"]);
	if (field.type !== "integer" || field.minimum !== minimum || field.maximum !== maximum || field.default !== defaultValue) context.invalid();
}

function decodeMessageSearchInput(value: unknown, context: GatewayMessageContractContext): { queryUtf8Bytes: number; limit: number; offset: number } {
	const input = context.record(value);
	context.exact(input, ["limit", "offset", "query"], ["limit", "offset"]);
	if (typeof input.query !== "string" || input.query.trim() === "") context.invalid();
	const queryUtf8Bytes = context.byteLength(input.query);
	if (queryUtf8Bytes > 512) context.invalid();
	return { queryUtf8Bytes, limit: optionalInteger(input.limit, 5, 1, 10, context), offset: optionalInteger(input.offset, 0, 0, 1000, context) };
}

function decodeMessageGetInput(value: unknown, context: GatewayMessageContractContext): { ref: string; offset: number; limitBytes: number } {
	const input = context.record(value);
	context.exact(input, ["limit_bytes", "offset", "ref"], ["limit_bytes", "offset"]);
	context.prefixed(input.ref, "message:");
	return {
		ref: input.ref as string,
		offset: optionalInteger(input.offset, 0, 0, 40_000, context),
		limitBytes: optionalInteger(input.limit_bytes, 4096, 256, 8192, context),
	};
}

function optionalInteger(value: unknown, defaultValue: number, minimum: number, maximum: number, context: GatewayMessageContractContext): number {
	const normalized = value === undefined ? defaultValue : value;
	if (!Number.isInteger(normalized) || (normalized as number) < minimum || (normalized as number) > maximum) context.invalid();
	return normalized as number;
}

function assertRedactedQuery(value: unknown, expectedUtf8Bytes: number, context: GatewayMessageContractContext): void {
	const query = context.record(value);
	context.exact(query, ["empty", "redacted", "utf8_bytes"]);
	if (query.redacted !== true || query.utf8_bytes !== expectedUtf8Bytes || query.empty !== false) context.invalid();
}

function assertSearchResultPage(
	result: Record<string, unknown>,
	input: { queryUtf8Bytes: number; limit: number; offset: number },
	targetRef: string,
	context: GatewayMessageContractContext,
): void {
	const offset = result.offset === undefined ? 0 : result.offset;
	if (!Number.isInteger(offset) || offset !== input.offset || (offset as number) < 0 || (offset as number) > 1000) context.invalid();
	if (result.next_offset !== undefined) assertNextOffset(result.next_offset, offset as number, 1000, context);
	if (!Array.isArray(result.results) || result.results.length > input.limit || result.result_count !== result.results.length) context.invalid();
	const seen = new Set<string>();
	for (const item of result.results) assertSearchResultItem(item, targetRef, seen, context);
}

function assertNextOffset(value: unknown, offset: number, maximum: number, context: GatewayMessageContractContext): void {
	if (!Number.isInteger(value) || typeof value !== "number" || value <= offset || value > maximum) context.invalid();
}

function assertSearchResultItem(value: unknown, targetRef: string, seen: Set<string>, context: GatewayMessageContractContext): void {
	const item = context.record(value);
	context.exact(item, ["created_at", "ref", "source", "source_label", "target_ref", "text_preview", "thread_ref"], ["source", "thread_ref"]);
	context.prefixed(item.ref, "message:");
	if (seen.has(item.ref as string) || item.target_ref !== targetRef) context.invalid();
	seen.add(item.ref as string);
	if (item.thread_ref !== undefined) context.prefixed(item.thread_ref, "thread:");
	if (typeof item.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$/u.test(item.created_at)) context.invalid();
	context.safeText(item.source_label, 128);
	context.safeText(item.text_preview, 1024);
	if (item.source !== undefined) assertSlackSource(item.source, context);
}

function assertSearchMinimization(value: unknown, results: unknown, context: GatewayMessageContractContext): void {
	const minimization = context.record(value);
	context.exact(minimization, ["credential_material_included", "raw_messages_included", "raw_provider_ids_included"]);
	const sourceReturned = Array.isArray(results) && results.some((item) => isSourceBearingSearchItem(item));
	if (minimization.credential_material_included !== false || minimization.raw_messages_included !== false
		|| minimization.raw_provider_ids_included !== sourceReturned) context.invalid();
}

function isSourceBearingSearchItem(value: unknown): boolean {
	return sourceReturned(value);
}

function messageSearchSourceReturned(value: unknown): boolean {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const results = (value as Record<string, unknown>).results;
	return Array.isArray(results) && results.some(isSourceBearingSearchItem);
}

function sourceReturned(value: unknown): boolean {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		&& "source" in value && (value as Record<string, unknown>).source !== undefined;
}

function assertMessageGetMatch(result: Record<string, unknown>, input: { ref: string; offset: number; limitBytes: number }, context: GatewayMessageContractContext): void {
	if (result.ref !== input.ref || result.offset !== input.offset || typeof result.text !== "string"
		|| context.byteLength(result.text) > input.limitBytes || !Number.isInteger(result.offset)) context.invalid();
}

function assertMessageGetPage(result: Record<string, unknown>, input: { offset: number }, context: GatewayMessageContractContext): void {
	if (result.next_offset !== undefined) assertNextOffset(result.next_offset, input.offset, 40_000, context);
}

function assertSlackSource(value: unknown, context: GatewayMessageContractContext): void {
	const source = context.record(value);
	context.exact(source, ["provider", "url"]);
	if (source.provider !== "slack" || !isCealSlackPermalinkSource(source.url)) context.invalid();
}
