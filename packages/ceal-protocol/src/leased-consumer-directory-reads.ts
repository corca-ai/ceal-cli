/**
 * Read-family grammar for directory and identity projections: the ordinary
 * people-search arguments, the opaque subject-ref rule they share with the
 * ingress requester, and the per-kind optional detail a generic resource-read
 * item may carry. Split from the control module so its near-limit file does
 * not grow every time a read projection gains a bounded descriptive field.
 */
/**
 * One generic read item. `handle_index` is present only when the item minted a
 * handle; `subject_ref`/`actor_kind` are identity-only descriptive fields,
 * `author` and `reply_count` are message-only, and `filename`/`mimetype`/`size_bytes` are
 * file-only. Consumers program against this shape, so a field the decoder
 * admits must appear here or it is invisible to them.
 *
 * `file` is the first noun added under the one-vocabulary/per-connector-
 * contract decision (docs/implementation/66, "The nouns"). Its three fields are
 * exactly the decided read shape — filename, mimetype, size — and they exist
 * because a bare `attachment_count` cannot tell an uploaded PDF from a link
 * unfurl: the count ADDS `files` and `attachments`
 * (`scripts/agent-runtime/gateway-slack-target-search.mjs:713-723`).
 * `display_name` stays the human title; `filename` is the upload name, which is
 * the field a "find the PDFs in this channel" query actually matches on.
 *
 * A file item carries no provider file id, no download URL and no permalink.
 * Enumeration and metadata are the whole noun; a caller that could rebuild a
 * provider address from a listing would hold the working address the
 * substitution rule exists to keep behind the Gateway.
 */
export interface CealLeasedConsumerResourceReadItem {
	kind: "conversation" | "identity" | "usergroup" | "message" | "file" | "document";
	display_name: string;
	handle_index?: number;
	text?: string;
	reply_count?: number;
	subject_ref?: string;
	actor_kind?: "human" | "bot" | "app" | "unknown";
	author?: { author_ref: string; display_name?: string; actor_kind: "human" | "bot" | "app" | "unknown"; subject_ref?: string };
	filename?: string;
	mimetype?: string;
	size_bytes?: number;
}

/** The admitted `kind` values, exported so the decoder cannot drift from the type. */
export const CEAL_LEASED_CONSUMER_READ_ITEM_KINDS = Object.freeze(["conversation", "identity", "usergroup", "message", "file", "document"] as const);

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

export const CEAL_LEASED_CONSUMER_READ_ITEM_FILENAME_MAX_BYTES = 512;
export const CEAL_LEASED_CONSUMER_READ_ITEM_MIMETYPE_MAX_BYTES = 255;
// RFC 6838 restricted-name shape, lowercased: exactly one `/`, no parameters,
// no wildcard. A caller routes on this, so `application/pdf; charset=x` and
// `*/*` are refusals rather than values it has to re-parse.
const READ_ITEM_MIMETYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/u;

/**
 * The optional detail of one generic resource-read item: each field is
 * admitted only for the item kind that owns it, so a directory read cannot
 * smuggle an author, a message cannot smuggle a subject ref or actor kind, and
 * nothing but a `file` item can smuggle a filename, mimetype or size.
 *
 * `handle_index` lives here too because it is the same class of rule — an
 * optional field of one read item — and validating it beside the interface it
 * belongs to is what keeps the admitted set and the published type together.
 */
export function validCealLeasedConsumerReadItemDetail(
	value: Record<string, unknown>,
	handleCount: number,
	safeReplyText: (value: unknown) => boolean,
	validAuthor: (value: unknown) => boolean,
): boolean {
	return (value.text === undefined || safeReplyText(value.text))
		&& (value.reply_count === undefined || value.kind === "message")
		&& validCealLeasedConsumerMessageReplyCount(value.reply_count)
		&& validCealLeasedConsumerReadItemHandleIndex(value.handle_index, handleCount)
		&& validCealLeasedConsumerIdentityDetail(value)
		&& (value.author === undefined || (value.kind === "message" && validAuthor(value.author)))
		&& validCealLeasedConsumerFileDetail(value);
}

/** A reply count is descriptive message metadata, never a provider locator. */
export function validCealLeasedConsumerMessageReplyCount(value: unknown): boolean {
	return value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);
}

const READ_ITEM_ACTOR_KINDS: readonly string[] = ["human", "bot", "app", "unknown"];

/**
 * Identity-only detail. Both fields describe a person, so a `message`,
 * `conversation`, `usergroup` or `file` item carrying either one is refused
 * rather than silently projected as an identity.
 */
function validCealLeasedConsumerIdentityDetail(value: Record<string, unknown>): boolean {
	const identityOnly = value.kind === "identity";
	return (value.subject_ref === undefined || (identityOnly && validCealLeasedConsumerSubjectRef(value.subject_ref)))
		&& (value.actor_kind === undefined || (identityOnly && READ_ITEM_ACTOR_KINDS.includes(value.actor_kind as string)));
}

/** Present only when the item minted a handle, and then it must index into the typed handles array. */
export function validCealLeasedConsumerReadItemHandleIndex(value: unknown, handleCount: number): boolean {
	return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < handleCount);
}

function validCealLeasedConsumerFileDetail(value: Record<string, unknown>): boolean {
	const fileOnly = value.kind === "file";
	return (value.filename === undefined || (fileOnly && safeText(value.filename, CEAL_LEASED_CONSUMER_READ_ITEM_FILENAME_MAX_BYTES)))
		&& (value.mimetype === undefined || (fileOnly && safeText(value.mimetype, CEAL_LEASED_CONSUMER_READ_ITEM_MIMETYPE_MAX_BYTES) && READ_ITEM_MIMETYPE.test(value.mimetype as string)))
		&& (value.size_bytes === undefined || (fileOnly && Number.isSafeInteger(value.size_bytes) && (value.size_bytes as number) >= 0));
}
