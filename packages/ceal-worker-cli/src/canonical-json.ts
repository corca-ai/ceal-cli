export type JsonRecord = Record<string, unknown>;

/** Accept only ordinary JSON objects when canonicalizing untrusted values. */
export function isPlainJsonRecord(value: unknown): value is JsonRecord {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/** Canonicalize object key order while preserving arrays and scalar values. */
function canonicalJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalJson);
	if (!isPlainJsonRecord(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonicalJson(value[key])]),
	);
}

/** Compare two JSON values after canonicalizing object key order. */
export function sameCanonicalJson(left: unknown, right: unknown): boolean {
	return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}
