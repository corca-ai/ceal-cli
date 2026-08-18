import { isPlainJsonRecord } from "./canonical-json.js";

/** Compare an object's own string keys with one contract-owned key list. */
export function sameObjectKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const required = [...expected].sort();
	return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

/** Validate exact own keys on an ordinary JSON object. */
export function hasExactObjectKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
	return isPlainJsonRecord(value) && Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
