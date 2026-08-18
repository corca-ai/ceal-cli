/** Whether an unknown JSON value is a map whose values are all strings. */
export function isStringMap(value: unknown): value is Record<string, string> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	for (const key of Object.keys(value)) {
		if (typeof Reflect.get(value, key) !== "string") return false;
	}
	return true;
}
