// The safe-ref grammar, in one home.
//
// This character class is the Protocol's, declared as `SAFE_REF` in that
// package's `gateway-validation-primitives` module. The path is deliberately not
// spelled here: `verify-gateway-protocol-consumer.mjs` refuses worker source
// containing it, and that guard reads text, so it cannot tell a prose reference
// from a real path fallback. Erring toward refusal is the right direction for a
// release guard; naming the module rather than the path is this file's half.
// That package is a frozen vendored copy this lane may not edit, and it does not
// re-export `SAFE_REF` from its public index — so the owned packages cannot
// import the owner's declaration even in principle. A second home is therefore
// unavoidable, and `AGENTS.md` `## One Fact, One Home` says what to do about
// that: bind the two with a gate rather than a note.
// `test/contract/duplicate-literal.test.mjs` is that binding; it reads the
// Protocol's declaration and this one and fails when they stop agreeing.
//
// Before this file the grammar was spelled as its own literal at five worker
// sites and one client site, and nothing compared them. The 2026-08-09
// structural re-sweep found that, and `npm run lint:duplicate-literal` is what
// keeps a seventh copy from being written.

// The class itself. Everything below is this plus a length budget, so a change
// to what characters a ref may carry has exactly one place to be made.
const LEAD = "[A-Za-z0-9]";
const TAIL = "[A-Za-z0-9._:-]";

/**
 * A safe-ref matcher: an optional literal prefix, one leading character from the
 * class, then up to `tailBudget` more.
 *
 * The budget is the tail repetition, not the total length, because that is what
 * every call site was already spelling and preserving it exactly is what makes
 * this refactor behaviour-free. The suite pins each constructed pattern's
 * `source` against the literal it replaced.
 */
function safeRef(prefix: string, tailBudget: number): RegExp {
	return new RegExp(`^${prefix}${LEAD}${TAIL}{0,${tailBudget}}$`, "u");
}

/** References, codes and identifiers that cross the store or the CLI surface. */
export const CEAL_SAFE_REF = safeRef("", 127);

/**
 * Request and audit references, which the Gateway issues longer than a local
 * ref. A separate budget rather than a separate grammar.
 */
export const CEAL_SAFE_REQUEST_REF = safeRef("", 255);

/** A target reference, which carries its kind in a literal prefix. */
export const CEAL_SAFE_TARGET_REF = safeRef("target:", 119);

/** A profile reference, same shape with its own prefix. */
export const CEAL_SAFE_PROFILE_REF = safeRef("profile:", 119);

/** A pagination cursor. */
export const CEAL_SAFE_CURSOR = safeRef("cursor:", 120);

/**
 * A client-generated request id. Its budget is the tightest of the set because
 * the Gateway appends to it; the number is preserved from the literal this
 * replaced rather than re-derived, so this refactor changes no behaviour.
 */
export const CEAL_SAFE_REQUEST_ID = safeRef("", 117);
