export function normalizeCapabilitySpecificArguments(
	capabilityId: string,
	arguments_: Record<string, string | number>,
): boolean {
	if (capabilityId === "message.search") return normalizeMessageSearchArguments(arguments_);
	if (capabilityId === "message.get") return normalizeMessageGetArguments(arguments_);
	return true;
}

export function validCallPrefix(options: readonly string[]): boolean {
	return options.length >= 3 && options.length <= 67 && options[1] === "--target";
}

export function validCapabilityId(value: string | undefined): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

export function validTargetRef(value: string | undefined): boolean {
	return typeof value === "string" && /^target:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(value);
}

function normalizeMessageSearchArguments(arguments_: Record<string, string | number>): boolean {
	if (!allowsOnly(arguments_, ["query", "limit", "offset"])) return false;
	const query = arguments_.query;
	if (!isNonemptyQuery(query)) return false;
	const limit = boundedInteger(arguments_.limit, 5, 1, 10);
	const offset = boundedInteger(arguments_.offset, 0, 0, 1000);
	if (limit === null || offset === null) return false;
	arguments_.limit = limit;
	arguments_.offset = offset;
	return true;
}

function normalizeMessageGetArguments(arguments_: Record<string, string | number>): boolean {
	if (!allowsOnly(arguments_, ["ref", "offset", "limit_bytes"]) || !isMessageRef(arguments_.ref)) return false;
	const offset = boundedInteger(arguments_.offset, 0, 0, 40_000);
	const limitBytes = boundedInteger(arguments_.limit_bytes, 4096, 256, 8192);
	if (offset === null || limitBytes === null) return false;
	arguments_.offset = offset;
	arguments_.limit_bytes = limitBytes;
	return true;
}

function allowsOnly(value: Record<string, string | number>, allowed: readonly string[]): boolean {
	return Object.keys(value).every((key) => allowed.includes(key));
}

function isNonemptyQuery(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "" && new TextEncoder().encode(value).byteLength <= 512;
}

function isMessageRef(value: unknown): value is string {
	return typeof value === "string" && /^message:[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function boundedInteger(value: unknown, defaultValue: number, minimum: number, maximum: number): number | null {
	const normalized = value === undefined ? defaultValue : Number(value);
	return Number.isInteger(normalized) && normalized >= minimum && normalized <= maximum ? normalized : null;
}
