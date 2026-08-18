/** Compare an unknown value with one ordered, contract-owned string array. */
export function sameStringArray(value: unknown, expected: readonly string[]): value is string[] {
	return Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index]);
}
