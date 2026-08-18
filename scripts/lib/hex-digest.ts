const LOWERCASE_HEX = /^[a-f0-9]+$/u;

/** Validate a lowercase hexadecimal value with an exact character budget. */
export function isLowercaseHexDigest(value: unknown, length: number): value is string {
	if (typeof value !== "string" || value.length !== length) return false;
	return LOWERCASE_HEX.test(value);
}
