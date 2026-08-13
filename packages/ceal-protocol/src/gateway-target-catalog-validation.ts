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
	validateTargetCatalogPaging(context, catalog, request);
	validateTargetCatalogMatchDisclosure(context, catalog, request);
	validateTargetCatalogRequest(context, catalog, targets, capabilityIds, requestedCapabilityIds(request), request.capability_ids !== undefined);
}

/**
 * A Gateway may not claim a filter it was never asked to apply.
 *
 * `match_applied: true` is truthful only when this request carried a selector,
 * or continues a snapshot that did. The request grammar admits `cursor` and
 * `match` only exclusively, so a continuation page reports the selector its
 * snapshot was built with while carrying no `match` of its own. The `false`
 * direction is deliberately unconstrained: a supplied selector that normalizes
 * to nothing is honestly reported as not applied.
 */
function validateTargetCatalogMatchDisclosure(context: GatewayTargetCatalogValidationContext, catalog: CealGatewayTargetCatalog, request: Readonly<CealGatewayDiscoverBody>): void {
	if (catalog.match_applied !== true) return;
	if (request.match === undefined && request.cursor === undefined) context.invalidResponse();
}

function requireTargetCatalog(context: GatewayTargetCatalogValidationContext, value: unknown): CealGatewayTargetCatalog {
	const catalog = context.requireRecord(value);
	context.requireExactKeys(
		catalog,
		["complete", "match_applied", "next_cursor", "returned_count", "target_count"],
		["match_applied", "next_cursor"],
	);
	const typed = catalog as unknown as CealGatewayTargetCatalog;
	if (!Number.isSafeInteger(typed.target_count) || typed.target_count < 0) context.invalidResponse();
	if (!Number.isSafeInteger(typed.returned_count) || typed.returned_count < 0) context.invalidResponse();
	if (typeof typed.complete !== "boolean") context.invalidResponse();
	if (typed.match_applied !== undefined && typeof typed.match_applied !== "boolean") context.invalidResponse();
	if (typed.next_cursor !== undefined) context.requirePrefixedRef(typed.next_cursor, "cursor:");
	return typed;
}

function validateTargetCatalogCounts(context: GatewayTargetCatalogValidationContext, catalog: CealGatewayTargetCatalog, targets: unknown): asserts targets is Record<string, unknown>[] {
	if (!Array.isArray(targets)) context.invalidResponse();
	if (catalog.returned_count !== targets.length || catalog.returned_count > catalog.target_count) context.invalidResponse();
}

function validateTargetCatalogPaging(context: GatewayTargetCatalogValidationContext, catalog: CealGatewayTargetCatalog, request: Readonly<CealGatewayDiscoverBody>): void {
	// A bare discovery now carries the current granted target page. A non-empty
	// catalog must either complete or expose a continuation cursor.
	if (catalog.complete) {
		if (catalog.next_cursor !== undefined) context.invalidResponse();
		// A first page starts at zero, so a terminal first page must contain the
		// whole selection. A cursor page may be the shorter terminal suffix.
		if (request.cursor === undefined && catalog.returned_count !== catalog.target_count) context.invalidResponse();
		return;
	}
	if (catalog.returned_count === 0 || catalog.next_cursor === undefined) context.invalidResponse();
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
	if (catalog.returned_count !== targets.length) context.invalidResponse();
	if (catalog.complete ? catalog.next_cursor !== undefined : catalog.next_cursor === undefined) context.invalidResponse();
}
