export type JsonRecord = Record<string, unknown>;

/** Convert a non-array object into an own-property JSON record. */
export function asJsonRecord(value: unknown): JsonRecord | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}
