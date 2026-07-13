import { stringify } from "yaml";

export function renderPlainYamlDocument(value: unknown): string {
	assertPlainValue(value, new WeakSet<object>());
	return stringify(value, { aliasDuplicateObjects: false, lineWidth: 0 });
}

function assertPlainValue(value: unknown, seen: WeakSet<object>): void {
	if (isPlainScalar(value)) return;
	if (typeof value !== "object" || value === null) throw new TypeError("YAML results require JSON-compatible values.");
	assertPlainObject(value, seen);
}

function isPlainScalar(value: unknown): boolean {
	return value === null || typeof value === "string" || typeof value === "boolean"
		|| (typeof value === "number" && Number.isFinite(value));
}

function assertPlainObject(value: object, seen: WeakSet<object>): void {
	if (seen.has(value)) throw new TypeError("YAML results cannot contain cycles or shared object references.");
	seen.add(value);
	if (Array.isArray(value)) {
		for (const item of value) assertPlainValue(item, seen);
		return;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError("YAML results require plain mappings.");
	for (const item of Object.values(value)) assertPlainValue(item, seen);
}
