/**
 * Wire validation for the optional `cache_origin` label on a call value (#606b).
 * It follows the same context-injected pattern as the target-catalog validator
 * so the shared record/key/failure helpers stay owned by the protocol entry
 * module without growing it.
 */
export interface GatewayCacheOriginValidationContext {
	requireRecord(value: unknown): Record<string, unknown>;
	requireExactKeys(record: Record<string, unknown>, allowed: string[], optional?: string[]): void;
	invalidResponse(): never;
}

/** The staleness ceiling a cache serve's `age_ms` may report; a read cache must keep its TTL at or under this. */
export const CEAL_MAX_CACHE_ORIGIN_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_ORIGIN_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.]\d{3})?Z$/u;

export function validateGatewayCacheOrigin(context: GatewayCacheOriginValidationContext, value: unknown): void {
	const origin = context.requireRecord(value);
	context.requireExactKeys(origin, ["age_ms", "origin_at", "schema_version"]);
	if (origin.schema_version !== "ceal.gateway_cache_origin.v1"
		|| typeof origin.origin_at !== "string" || !CACHE_ORIGIN_ISO.test(origin.origin_at)
		|| typeof origin.age_ms !== "number" || !Number.isSafeInteger(origin.age_ms)
		|| origin.age_ms < 0 || origin.age_ms > CEAL_MAX_CACHE_ORIGIN_AGE_MS) context.invalidResponse();
}
