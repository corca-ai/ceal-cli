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
	validateTargetCatalogRequest(context, catalog, targets, capabilityIds, request.capability_id);
}

function requireTargetCatalog(context: GatewayTargetCatalogValidationContext, value: unknown): CealGatewayTargetCatalog {
	const catalog = context.requireRecord(value);
	context.requireExactKeys(catalog, ["complete", "next_cursor", "returned_count", "selection_required", "target_count"], ["next_cursor"]);
	const typed = catalog as unknown as CealGatewayTargetCatalog;
	if (!Number.isSafeInteger(typed.target_count) || typed.target_count < 0) context.invalidResponse();
	if (!Number.isSafeInteger(typed.returned_count) || typed.returned_count < 0) context.invalidResponse();
	if (typeof typed.complete !== "boolean" || typeof typed.selection_required !== "boolean") context.invalidResponse();
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
	if (catalog.selection_required) {
		if (catalog.returned_count !== 0 || catalog.next_cursor !== undefined) context.invalidResponse();
		return;
	}
	if (catalog.next_cursor === undefined) context.invalidResponse();
}

function validateTargetCatalogRequest(context: GatewayTargetCatalogValidationContext, catalog: CealGatewayTargetCatalog, targets: readonly Record<string, unknown>[], capabilityIds: ReadonlySet<string>, capabilityId: string | undefined): void {
	if (!capabilityId) return validateUnselectedTargetCatalog(context, catalog, targets);
	if (!capabilityIds.has(capabilityId)) context.invalidResponse();
	if (catalog.selection_required) return;
	for (const target of targets) {
		if (!Array.isArray(target.capability_ids) || !target.capability_ids.includes(capabilityId)) context.invalidResponse();
	}
}

function validateUnselectedTargetCatalog(context: GatewayTargetCatalogValidationContext, catalog: CealGatewayTargetCatalog, targets: readonly unknown[]): void {
	if (targets.length !== 0) context.invalidResponse();
	if (catalog.selection_required !== (catalog.target_count > 0)) context.invalidResponse();
	if (catalog.complete !== (catalog.target_count === 0)) context.invalidResponse();
	if (catalog.next_cursor !== undefined) context.invalidResponse();
}
