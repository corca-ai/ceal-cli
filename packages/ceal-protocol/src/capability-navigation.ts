export interface CealCapabilityNavigation {
	target_selector: "opaque_catalog_target";
	url_target_selector: "unsupported";
	required_argument_source: {
		argument: string;
		handle_kind: string;
		issued_by: readonly string[];
	};
}

const SAFE_NAME = /^[a-z][a-z0-9_-]{0,63}$/u;
const SAFE_CAPABILITY_ID = /^[a-z][a-z0-9_.-]{0,127}$/u;

/**
 * Provider-neutral navigation metadata for capabilities whose target catalog
 * and call argument are intentionally different selection steps.
 */
export function decodeCealCapabilityNavigation(value: unknown): CealCapabilityNavigation {
	const navigation = record(value);
	exactKeys(navigation, ["required_argument_source", "target_selector", "url_target_selector"]);
	if (navigation.target_selector !== "opaque_catalog_target" || navigation.url_target_selector !== "unsupported") invalid();
	const source = record(navigation.required_argument_source);
	exactKeys(source, ["argument", "handle_kind", "issued_by"]);
	if (!safeName(source.argument) || !safeName(source.handle_kind) || !safeIssuers(source.issued_by)) invalid();
	return value as CealCapabilityNavigation;
}

function safeName(value: unknown): value is string { return typeof value === "string" && SAFE_NAME.test(value); }
function safeIssuers(value: unknown): value is string[] {
	return Array.isArray(value) && value.length > 0 && value.length <= 16
		&& value.every((capabilityId) => typeof capabilityId === "string" && SAFE_CAPABILITY_ID.test(capabilityId))
		&& new Set(value).size === value.length;
}

function record(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
	return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
	const actual = Object.keys(value).sort(); const ordered = [...expected].sort();
	if (actual.length !== ordered.length || actual.some((key, index) => key !== ordered[index])) invalid();
}
function invalid(): never { throw new TypeError("Ceal capability navigation is invalid"); }
