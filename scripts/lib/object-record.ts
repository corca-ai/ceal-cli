/** Whether an unknown value is a non-null object, including arrays. */
export function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
