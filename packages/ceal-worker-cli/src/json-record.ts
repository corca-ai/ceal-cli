/** Whether an unknown value is a non-array JSON object. */
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
