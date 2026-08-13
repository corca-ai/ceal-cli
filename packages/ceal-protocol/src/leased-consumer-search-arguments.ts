/**
 * The shared leased SEARCH filter vocabulary.
 *
 * Every read that narrows a corpus wants the same handful of filters — a term,
 * a page ceiling, and time bounds — and the repo has already paid for the
 * alternative once: a second copy of shared logic drifted from the first
 * (`cb0293b1d`). So the filters are declared ONCE here as a table of
 * name -> validator, and each capability declares which subset its contract
 * admits. A capability adds a filter by naming it, never by restating its rule.
 *
 * `file.search` is the first consumer. The `message.search`/`message.enumerate`
 * merge is the second, and it extended this table in place rather than beside
 * it: the author filter (`author_ref`) and the opt-in expansion
 * (`include_replies`) are one row each here plus one name in that capability's
 * admitted list.
 *
 * `include_replies` EXPANDS rather than narrows, and it is here on purpose. The
 * thing a caller needs told about it is the thing every other row tells them —
 * what the argument costs. A Slack reply walk is one `conversations.replies`
 * per thread root, so the same question can be answered in 2 round trips or 19
 * with nothing in the grammar to distinguish them. A declared, off-by-default
 * row is what puts that in front of the caller.
 *
 * Deliberately absent: a provider page/cursor argument. Continuation is the
 * carrier's own concern and each capability owns whether it issues an opaque
 * Ceal continuation or an ordinal, so putting it in the FILTER vocabulary would
 * conflate narrowing with paging.
 */
export const CEAL_LEASED_CONSUMER_SEARCH_MAX_QUERY_BYTES = 512;
/**
 * `message.search` keeps the 4096-byte ceiling it had BEFORE the merge.
 *
 * Nobody decided to narrow it. This shared vocabulary was minted for
 * `file.search` with 512 as ITS ceiling (`c2c097c6c`), and folding
 * `message.search` onto the vocabulary inherited that number as a side effect
 * (`1a84b2290`). Narrowing what an existing field may contain under an
 * UNCHANGED schema name is the trap `ADDITIVE_VALUE_VOCABULARY_WARNING` names:
 * a frame that was valid `.v1` before would be refused by `.v1` after, and for
 * a declared capability a decode throw ends the frame loop. Restoring the
 * ceiling leaves the rest of the merge purely additive, so no `.v2` is needed.
 */
export const CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_MAX_QUERY_BYTES = 4096;
export const CEAL_LEASED_CONSUMER_SEARCH_MAX_LIMIT = 50;
export const CEAL_LEASED_CONSUMER_FILE_TYPE_FAMILIES = Object.freeze(["all", "image", "pdf"] as const);

/** The admitted filter names. A capability may declare only these. */
export type CealLeasedConsumerSearchFilter = "query" | "limit" | "since" | "until" | "filetype" | "author_ref" | "include_replies";

export interface CealLeasedConsumerSearchArguments {
	query?: string;
	limit?: number;
	since?: string;
	until?: string;
	filetype?: string;
	author_ref?: string;
	include_replies?: boolean;
}

/** The opaque Gateway author handle a message read already emits on its rows. */
export function validCealLeasedConsumerAuthorRef(value: unknown): boolean {
	return typeof value === "string" && /^author:[a-f0-9]{64}$/u.test(value);
}

/** One provider-neutral file family that every `file.search` target accepts. */
export function validCealLeasedConsumerFileType(value: unknown): boolean {
	return typeof value === "string" && (CEAL_LEASED_CONSUMER_FILE_TYPE_FAMILIES as readonly string[]).includes(value);
}

/**
 * An RFC 3339 instant. The bound crosses to the provider as a time filter, so a
 * value that only LOOKS like a date (`2026-02-31T00:00:00Z`) is refused here
 * rather than silently widening the read at the connector.
 */
export function validCealLeasedConsumerSearchInstant(value: unknown): boolean {
	if (typeof value !== "string") return false;
	const match = /^(\d{4})-(\d{2})-(\d{2})[Tt]([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.exec(value);
	if (match === null) return false;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	return day >= 1 && day <= daysInMonth(year, month) && Number.isFinite(Date.parse(value));
}

function validQuery(value: unknown, maxBytes: number): boolean {
	return typeof value === "string" && safeText(value, maxBytes) && value.trim().length > 0;
}

const SEARCH_FILTER_VALIDATORS: Readonly<Record<CealLeasedConsumerSearchFilter, (value: unknown) => boolean>> = Object.freeze({
	query: (value) => validQuery(value, CEAL_LEASED_CONSUMER_SEARCH_MAX_QUERY_BYTES),
	limit: (value) => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= CEAL_LEASED_CONSUMER_SEARCH_MAX_LIMIT,
	since: validCealLeasedConsumerSearchInstant,
	until: validCealLeasedConsumerSearchInstant,
	filetype: validCealLeasedConsumerFileType,
	author_ref: validCealLeasedConsumerAuthorRef,
	include_replies: (value) => typeof value === "boolean",
});

/** Exported so a drift test can prove the table and the declared type agree. */
export const CEAL_LEASED_CONSUMER_SEARCH_FILTERS = Object.freeze(Object.keys(SEARCH_FILTER_VALIDATORS) as CealLeasedConsumerSearchFilter[]);

/**
 * Builds one capability's argument decoder from the shared vocabulary.
 *
 * The admitted names are checked against the table at MODULE LOAD, so a
 * capability that names a filter this vocabulary does not own fails when the
 * package is imported rather than on the first call that happens to use it.
 */
/**
 * One filter's validity. `query` is the only filter a capability may re-bound,
 * because it is the only one whose pre-merge ceiling differed per capability.
 */
function validFilter(name: CealLeasedConsumerSearchFilter, value: unknown, maxQueryBytes: number | undefined): boolean {
	if (name === "query" && maxQueryBytes !== undefined) return validQuery(value, maxQueryBytes);
	return SEARCH_FILTER_VALIDATORS[name](value);
}

export function cealLeasedConsumerSearchArgumentsDecoder(
	schemaVersion: string,
	{ required = [], optional = [], maxQueryBytes }: { required?: readonly CealLeasedConsumerSearchFilter[]; optional?: readonly CealLeasedConsumerSearchFilter[]; maxQueryBytes?: number },
): (value: unknown) => void {
	const admitted = [...required, ...optional];
	for (const name of admitted) {
		if (!Object.hasOwn(SEARCH_FILTER_VALIDATORS, name)) throw new TypeError("Ceal leased-consumer search filter is not in the shared vocabulary");
	}
	const allowed = ["schema_version", ...admitted];
	return (value: unknown): void => {
		if (!record(value)) invalid();
		const candidate = value as Record<string, unknown>;
		if (candidate.schema_version !== schemaVersion) invalid();
		if (!Object.keys(candidate).every((key) => allowed.includes(key))) invalid();
		if (!required.every((key) => Object.hasOwn(candidate, key))) invalid();
		for (const name of admitted) {
			if (candidate[name] !== undefined && !validFilter(name, candidate[name], maxQueryBytes)) invalid();
		}
		// A reversed window is not a narrow read, it is an empty one that looks
		// like a provider fault; refuse it where the grammar is decided.
		if (candidate.since !== undefined && candidate.until !== undefined
			&& Date.parse(String(candidate.since)) >= Date.parse(String(candidate.until))) invalid();
	};
}

export const CEAL_LEASED_CONSUMER_FILE_SEARCH_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_file_search_arguments.v1" as const;

/**
 * The file-family read. `limit` is required here because a page ceiling is what
 * keeps the projection inside the carrier; the merged message read defaults its
 * own instead, and publishes the ceiling it actually served.
 *
 * `filetype` is the filter that makes this capability worth having: the
 * motivating query ("every PDF in this channel") carries no query term at all,
 * so applying the family at the provider is one call instead of a whole-history
 * scan. It is a bounded lowercase family token, never a mimetype and never a
 * glob. The three values are the honest cross-provider intersection; each
 * connector maps this one public vocabulary to its private provider grammar.
 */
export const decodeCealLeasedConsumerFileSearchArguments: (value: unknown) => void = cealLeasedConsumerSearchArgumentsDecoder(
	CEAL_LEASED_CONSUMER_FILE_SEARCH_ARGUMENTS_SCHEMA,
	{ required: ["limit"], optional: ["query", "filetype", "since", "until"] },
);

/**
 * The merged message-family read (`message.enumerate` folded into
 * `message.search`, 2026-08-12). EVERY filter is optional, and that asymmetry
 * with `file.search` is the merge's whole point: the motivating question
 * ("everything I said in this channel last week") carries no query term at all
 * — it is a window plus an author. Requiring `query` is what made a caller
 * reach for the other capability and pay a whole-history scan for a filter.
 *
 * `limit` is optional rather than required because the capability declares its
 * own default page; the effective ceiling is smaller still and the result says
 * so, since the real bound is the carrier's byte budget and not the row count
 * (corca-ai/ceal#702).
 *
 * ## OPEN — does this argument set deserve a `.v2`? (recorded 2026-08-12)
 *
 * Left as a record rather than a chat log, because the answer turns on a fact
 * the question as usually asked does not mention.
 *
 * The merge (`1a84b2290`) changed the value domain of the UNCHANGED name
 * `…message_search_arguments.v1` in BOTH directions. Before it, the decoder was
 * `requireExactKeys(record, ["query", "schema_version"])` with
 * `safeText(record.query, 4096)`:
 *
 * - **Widened** — five keys are admitted where one was, and `query` became
 *   optional. This half needs NO version bump. An older peer exact-keys its
 *   admitted list (see the decoder above), so it REFUSES an unknown filter; it
 *   cannot misread one. A schema version exists to stop MISINTERPRETATION, and
 *   a bump would turn one fail-closed refusal into a different fail-closed
 *   refusal at the same cost. Announcing new filters is discovery's job, and the
 *   generated capability-grammar fixture already carries it.
 * - **Narrowed** — this was the half that argued for a bump, and it is CLOSED
 *   rather than versioned. The merge had silently dropped `query` from 4096
 *   bytes to this vocabulary's own 512, inherited from `file.search` which
 *   minted it; nobody decided that `message.search` should shrink. The 4096
 *   ceiling is restored per capability
 *   (`CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_MAX_QUERY_BYTES`), which leaves the
 *   remaining change purely additive and needs no new name.
 *
 * Operator decision, 2026-08-12: restore the ceiling rather than mint `.v2`. A
 * `.v2` the Gateway serves ALONE re-creates the refusal it was minted to avoid,
 * so the only version scheme that buys anything is one accepting both names
 * during transition — a cost with no remaining benefit once the ceiling is back.
 *
 * ONE narrowing deliberately survives: an all-whitespace `query` is refused
 * where `.v1` once accepted it. `query` is now OPTIONAL, so the way to express
 * "no query term" is to omit it, and a blank string buys a whole-history scan
 * that returns the same rows. It is recorded here rather than left for someone
 * to rediscover.
 */
export const CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_FILTERS = Object.freeze({
	optional: Object.freeze(["query", "limit", "since", "until", "author_ref", "include_replies"]) as readonly CealLeasedConsumerSearchFilter[],
	maxQueryBytes: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_MAX_QUERY_BYTES,
});

function daysInMonth(year: number, month: number): number {
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}
function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }
function safeText(value: string, maximum: number): boolean {
	const bytes = byteLength(value);
	return bytes > 0 && bytes <= maximum && ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127);
}
function record(value: unknown): boolean { return value !== null && typeof value === "object" && !Array.isArray(value); }
function invalid(): never { throw new TypeError("Ceal leased-consumer control record is invalid"); }
