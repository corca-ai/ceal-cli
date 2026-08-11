export interface CealLeasedConsumerMessageAuthor {
	author_ref: string;
	display_name?: string;
	actor_kind: "human" | "bot" | "app" | "unknown";
}

/** Exact public author descriptor shared by message and resource read data. */
export function validCealLeasedConsumerMessageAuthor(value: unknown): value is CealLeasedConsumerMessageAuthor {
	if (!plainRecord(value) || !exactKeys(value, ["actor_kind", "author_ref"], ["display_name"])) return false;
	return typeof value.author_ref === "string" && /^author:[a-f0-9]{64}$/u.test(value.author_ref)
		&& ["human", "bot", "app", "unknown"].includes(String(value.actor_kind))
		&& (value.display_name === undefined || safeDisplayName(value.display_name));
}

function safeDisplayName(value: unknown): boolean {
	return typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).byteLength <= 512
		&& ![...value].some((character) => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127)
		&& !/(^|[^A-Za-z0-9])[ABUDWGC][A-Z0-9]{8,}(?![A-Za-z0-9])/u.test(value);
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[]): boolean {
	const allowed = new Set([...required, ...optional]);
	return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function plainRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
