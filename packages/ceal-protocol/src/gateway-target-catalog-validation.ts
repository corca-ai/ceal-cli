import type { CealGatewayDiscoverBody, CealGatewayTargetCatalog } from "./gateway-response-types.js";

export interface GatewayTargetCatalogValidationContext {
	requireRecord(value: unknown): Record<string, unknown>;
	requireExactKeys(record: Record<string, unknown>, allowed: string[], optional?: string[]): void;
	requirePrefixedRef(value: unknown, prefix: string): void;
	invalidResponse(): never;
}

export function validateGatewayTargetCatalog(context: GatewayTargetCatalogValidationContext, value: unknown, targets: unknown, capabilityIds: ReadonlySet<string>, request: Readonly<CealGatewayDiscoverBody>): void {
	const catalog = requireTargetCatalog(context, value);
	validateTargetCatalogCounts(context, catalog, targets);
	validateTargetCatalogPaging(context, catalog);
	validateTargetCatalogRequest(context, catalog, targets, capabilityIds, requestedCapabilityIds(request), request.capability_ids !== undefined);
}

function requireTargetCatalog(context: GatewayTargetCatalogValidationContext, value: unknown): CealGatewayTargetCatalog {
	const catalog = context.requireRecord(value);
	context.requireExactKeys(catalog, ["complete", "next_cursor", "returned_count", "target_count"], ["next_cursor"]);
	const typed = catalog as unknown as CealGatewayTargetCatalog;
	if (!Number.isSafeInteger(typed.target_count) || typed.target_count < 0) context.invalidResponse();
	if (!Number.isSafeInteger(typed.returned_count) || typed.returned_count < 0) context.invalidResponse();
	if (typeof typed.complete !== "boolean") context.invalidResponse();
	if (typed.next_cursor !== undefined) context.requirePrefixedRef(typed.next_cursor, "cursor:");
	return typed;
}

function validateTargetCatalogCounts(context: GatewayTargetCatalogValidationContext, catalog: CealGatewayTargetCatalog, targets: unknown): asserts targets is Record<string, unknown>[] {
	if (!Array.isArray(targets)) context.invalidResponse();
	if (catalog.returned_count !== targets.length || catalog.returned_count > catalog.target_count) context.invalidResponse();
}

function validateTargetCatalogPaging(context: GatewayTargetCatalogValidationContext, catalog: CealGatewayTargetCatalog): void {
	if (catalog.complete) {
		if (catalog.returned_count !== catalog.target_count || catalog.next_cursor !== undefined) context.invalidResponse();
		return;
	}
	if (catalog.next_cursor === undefined) context.invalidResponse();
}

function validateTargetCatalogRequest(context: GatewayTargetCatalogValidationContext, catalog: CealGatewayTargetCatalog, targets: readonly Record<string, unknown>[], capabilityIds: ReadonlySet<string>, requestedIds: readonly string[], isPluralSelection: boolean): void {
	if (requestedIds.length === 0) return validateUnselectedTargetCatalog(context, catalog, targets);
	validateSelectedCapabilityProjection(context, capabilityIds, requestedIds, isPluralSelection);
	for (const target of targets) {
		if (!isValidSelectedTargetProjection(target.capability_ids, requestedIds, isPluralSelection)) context.invalidResponse();
	}
}

function validateSelectedCapabilityProjection(context: GatewayTargetCatalogValidationContext, actual: ReadonlySet<string>, requested: readonly string[], isPluralSelection: boolean): void {
	if (isPluralSelection ? !sameCapabilityIds(actual, requested) : requested.some((capabilityId) => !actual.has(capabilityId))) {
		context.invalidResponse();
	}
}

function isValidSelectedTargetProjection(value: unknown, requested: readonly string[], isPluralSelection: boolean): boolean {
	return Array.isArray(value) && value.some((capabilityId) => requested.includes(capabilityId))
		&& (!isPluralSelection || value.every((capabilityId) => requested.includes(capabilityId)));
}

function sameCapabilityIds(actual: ReadonlySet<string>, expected: readonly string[]): boolean {
	return actual.size === expected.length && expected.every((capabilityId) => actual.has(capabilityId));
}

function requestedCapabilityIds(request: Readonly<CealGatewayDiscoverBody>): readonly string[] {
	return request.capability_ids ?? (request.capability_id === undefined ? [] : [request.capability_id]);
}

function validateUnselectedTargetCatalog(context: GatewayTargetCatalogValidationContext, catalog: CealGatewayTargetCatalog, targets: readonly unknown[]): void {
	if (targets.length !== 0 || catalog.target_count !== 0 || catalog.returned_count !== 0 || !catalog.complete || catalog.next_cursor !== undefined) context.invalidResponse();
}
