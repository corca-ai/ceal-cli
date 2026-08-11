/**
 * Read-family grammar for directory and identity projections: the ordinary
 * people-search arguments, the opaque subject-ref rule they share with the
 * ingress requester, and the per-kind optional detail a generic resource-read
 * item may carry. Split from the control module so its near-limit file does
 * not grow every time a read projection gains a bounded descriptive field.
 */
/**
 * One generic read item. `handle_index` is present only when the item minted a
 * handle; `subject_ref`/`actor_kind` are identity-only descriptive fields, and
 * `author` is message-only. Consumers program against this shape, so a field
 * the decoder admits must appear here or it is invisible to them.
 */
export interface CealLeasedConsumerResourceReadItem {
	kind: "conversation" | "identity" | "usergroup" | "message";
	display_name: string;
	handle_index?: number;
	text?: string;
	subject_ref?: string;
	actor_kind?: "human" | "bot" | "app" | "unknown";
	author?: { author_ref: string; display_name?: string; actor_kind: "human" | "bot" | "app" | "unknown" };
}

export const CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_people_search_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_MAX_QUERY_BYTES = 128;
export const CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_MAX_LIMIT = 50;

/**
 * The ordinary same-Profile people directory. Both arguments are optional
 * because listing every active member is the normal first call and a query
 * only narrows it; the limit stays inside the declared page ceiling so a
 * consumer cannot widen its own disclosure budget.
 */
export function decodeCealLeasedConsumerPeopleSearchArguments(value: unknown): void {
	const record = requireRecord(value);
	if (!allowedKeys(record, ["limit", "query", "schema_version"], ["schema_version"])
		|| record.schema_version !== CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_ARGUMENTS_SCHEMA) invalid();
	if (record.query !== undefined && (!safeText(record.query, CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_MAX_QUERY_BYTES) || (record.query as string).trim().length === 0)) invalid();
	if (record.limit !== undefined && (!Number.isSafeInteger(record.limit) || (record.limit as number) < 1 || (record.limit as number) > CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_MAX_LIMIT)) invalid();
}

/** Gateway-native subject refs stay opaque: a Slack-shaped id is never one. */
export function validCealLeasedConsumerSubjectRef(value: unknown): boolean {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)
		&& value.startsWith("subject:") && !/^subject:(?:[ABUDWGCT][A-Z0-9]{4,})$/u.test(value);
}

function requireRecord(value: unknown): Record<string, unknown> { if (!record(value)) invalid(); return value; }
function allowedKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
	return Object.keys(value).every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key));
}
function safeText(value: unknown, maximum: number): boolean {
	if (typeof value !== "string") return false;
	const bytes = new TextEncoder().encode(value).byteLength;
	return bytes > 0 && bytes <= maximum && ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127);
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function invalid(): never { throw new TypeError("Ceal leased-consumer control record is invalid"); }

/**
 * The optional detail of one generic resource-read item: each field is
 * admitted only for the item kind that owns it, so a directory read cannot
 * smuggle an author and a message cannot smuggle a subject ref or actor kind.
 */
export function validCealLeasedConsumerReadItemDetail(
	value: Record<string, unknown>,
	safeReplyText: (value: unknown) => boolean,
	validAuthor: (value: unknown) => boolean,
): boolean {
	return (value.text === undefined || safeReplyText(value.text))
		&& (value.subject_ref === undefined || (value.kind === "identity" && validCealLeasedConsumerSubjectRef(value.subject_ref)))
		&& (value.actor_kind === undefined || (value.kind === "identity" && ["human", "bot", "app", "unknown"].includes(value.actor_kind as string)))
		&& (value.author === undefined || (value.kind === "message" && validAuthor(value.author)));
}
