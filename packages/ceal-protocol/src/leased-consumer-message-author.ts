import { isCealPublicSafeDisplayName } from "./gateway-validation-primitives.ts";

export interface CealLeasedConsumerMessageAuthor {
	author_ref: string;
	display_name?: string;
	actor_kind: "human" | "bot" | "app" | "unknown";
	/**
	 * The addressable substitute. `author_ref` is a CORRELATION handle — it
	 * answers "same person as that other message" and nothing else — so a
	 * consumer that wanted to reply directly had to name the author and then
	 * discover it could not reach them. `subject_ref` is what
	 * `conversation.direct.resolve` consumes, and it is present only when the
	 * author is an addressable account: a bot or an unattributed message mints
	 * no handle rather than a dead one.
	 */
	subject_ref?: string;
}

/** Exact public author descriptor shared by message and resource read data. */
export function validCealLeasedConsumerMessageAuthor(value: unknown): value is CealLeasedConsumerMessageAuthor {
	if (!plainRecord(value) || !exactKeys(value, ["actor_kind", "author_ref"], ["display_name", "subject_ref"])) return false;
	return typeof value.author_ref === "string" && /^author:[a-f0-9]{64}$/u.test(value.author_ref)
		&& ["human", "bot", "app", "unknown"].includes(String(value.actor_kind))
		&& (value.display_name === undefined || safeDisplayName(value.display_name))
		&& (value.subject_ref === undefined || /^subject:[a-f0-9]{64}$/u.test(String(value.subject_ref)));
}

/**
 * ONE rule for a human-facing name, shared with message text.
 *
 * This used to carry its own token shape — `[ABUDWGC][A-Z0-9]{8,}` — while
 * message text used `RAW_PROVIDER_REF`'s `[CDGUW][A-Z0-9]{8,}`, so "clean enough
 * to ship as a sentence" and "clean enough to ship as a name" were two different
 * questions with two different answers. The wider set has a live false-positive
 * class an all-caps name falls into: `ALEXANDER` and `GONGJIHYUN` were refused
 * while `ALEX`, `BENJAMIN` and `CHARLIE` passed, so romanized names in caps lost
 * their display name for no gain (verified by running the shipped projection,
 * 2026-08-12; owner doc `docs/implementation/66-*.md` §2).
 *
 * `isCealPublicSafeText` is also STRICTLY STRONGER on everything that is
 * actually dangerous: the old rule tested no secret material at all, so a
 * display name carrying a `xox…` token was admitted verbatim.
 *
 * The cost, stated rather than discovered later: an `A…`/`B…` Slack app or bot
 * id in a display name is no longer refused here. Under the owner doc's
 * principle — a provider id is a working ADDRESS, not a secret — that is already
 * the accepted posture for message text, which is the far larger surface.
 */
const safeDisplayName = isCealPublicSafeDisplayName;

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[]): boolean {
	const allowed = new Set([...required, ...optional]);
	return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function plainRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
