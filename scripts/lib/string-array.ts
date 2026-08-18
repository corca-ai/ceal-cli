/** Whether an unknown value is an array whose entries are all strings. */
export function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry): entry is string => typeof entry === "string");
}
