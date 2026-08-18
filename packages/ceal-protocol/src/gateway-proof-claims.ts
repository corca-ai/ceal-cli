/**
 * What a Gateway response claims to have PROVEN, stated as a contract instead of
 * left implicit in two hard-coded array literals.
 *
 * ## The three meanings `proof_level` collapsed
 *
 * Every accepted response carries `proof_level: "host_decision"` and a
 * `non_claims` array. `proof_level` reads like an ORDINAL — the highest rung
 * reached on a ladder — and that framing is wrong, because the three facts it
 * ran together are INDEPENDENT:
 *
 * 1. **`host_decision`** — the Gateway authenticated, authorized, and RECORDED a
 *    decision for this request. This is the one meaning `proof_level` actually
 *    names. It is reached on every accepted response, which is exactly why a
 *    field whose only value is `"host_decision"` cannot distinguish anything.
 * 2. **`provider_execution`** — the external provider was actually reached. Only
 *    `non_claims` carries this, and only NEGATIVELY.
 * 3. **`production_audit`** — the durable production audit ledger recorded the
 *    call. Only `non_claims` carries this, and only NEGATIVELY.
 *
 * They are not a ladder. A write may reach the provider and then fail its audit
 * append — `gateway-write-request-provenance.spec.md` states that an append
 * failure leaves the write record authoritative with no audit proof — so
 * `{provider_execution: reached, production_audit: not_reached}` is a real
 * state, and no single ordinal can express it. That combination is precisely the
 * one `non_claims: ["production_audit_not_reached"]` already encodes.
 *
 * ## What `non_claims` MEANS
 *
 * A non-claim is a NEGATIVE assertion about one axis: "this axis was not
 * reached". It follows, and this is the half that was never written down:
 *
 * - **The absence of a non-claim is the POSITIVE claim for that axis.** A reader
 *   must not treat a short array as "the Gateway said less"; it is the Gateway
 *   saying more.
 * - **Therefore an empty `non_claims` is not permissive, it is maximal**, and it
 *   is refused. `production_audit_not_reached` is mandatory in every accepted
 *   combination below: no response on this boundary may claim the production
 *   audit ledger was reached, because nothing on this path can prove it.
 * - The array is a SET, but a canonically ORDERED one, so two responses that
 *   claim the same thing are byte-identical for consumers that log or compare
 *   them verbatim.
 *
 * This module replaces a pair of `JSON.stringify` comparisons against literal
 * arrays. Those enforced the same combinations and named none of them, so every
 * rule above was reconstructible only by reading the two literals side by side.
 *
 * No new evidence enum is introduced: the wire vocabulary is unchanged, and this
 * is the vocabulary's contract rather than an extension of it.
 */

/** The three independent facts a response may or may not have established. */
export const CEAL_GATEWAY_PROOF_AXES = Object.freeze(["host_decision", "provider_execution", "production_audit"] as const);

export type CealGatewayProofAxis = (typeof CEAL_GATEWAY_PROOF_AXES)[number];

/**
 * The non-claim token that denies each axis, in the canonical `non_claims`
 * order. `host_decision` has no token on purpose: an accepted response has
 * always reached it, so a token denying it would only ever be a contradiction.
 */
export const CEAL_GATEWAY_PROOF_AXIS_NON_CLAIMS = Object.freeze({
	host_decision: null,
	provider_execution: "provider_execution_not_reached",
	production_audit: "production_audit_not_reached",
} as const);

/** Canonical emission order. `non_claims` is a set; this is how it is written. */
export const CEAL_GATEWAY_HOST_NON_CLAIM_ORDER = Object.freeze(["provider_execution_not_reached", "target_authorization_not_observed", "production_audit_not_reached"] as const);

/**
 * The axis no accepted response on this boundary may claim. Kept as a named
 * constant because it is the invariant a future "just relax the check" edit is
 * most likely to drop.
 */
export const CEAL_GATEWAY_MANDATORY_NON_CLAIM = "production_audit_not_reached" as const;

export type CealGatewayProofAxisState = Readonly<Record<CealGatewayProofAxis, "reached" | "not_reached">>;

/**
 * How far the provider boundary may be described, decided by the CALLER of the
 * validator from facts it holds (operation, outcome, error code) — never by the
 * response itself, which must not get to widen its own permission.
 */
export interface CealGatewayProviderReachDisposition {
	/** The response MAY claim provider execution; it may also deny it. */
	mayBeReached?: boolean;
	/** The provider WAS reached, so denying it would be a false non-claim. */
	wasReached?: boolean;
}

/**
 * Reads the per-axis truth out of a validated `non_claims` array.
 *
 * This is the projection a consumer should use instead of matching the array
 * against a literal, so "did this reach the provider" stops being a question
 * about array contents.
 */
export function cealGatewayProofAxisState(nonClaims: readonly string[]): CealGatewayProofAxisState {
	const denied = new Set(nonClaims);
	return Object.freeze({
		host_decision: "reached",
		provider_execution: denied.has("provider_execution_not_reached") ? "not_reached" : "reached",
		production_audit: denied.has("production_audit_not_reached") ? "not_reached" : "reached",
	});
}

/**
 * Fail-closed validation of one `non_claims` array against the disposition its
 * caller established.
 *
 * The rules, in the order they are applied: the array is a canonically ordered
 * set of known tokens; the mandatory non-claim is present; a response may deny
 * provider execution unless its caller established the provider WAS reached; and
 * it may claim provider execution only when its caller allowed it.
 */
export function isValidCealGatewayHostNonClaims(value: unknown, disposition: CealGatewayProviderReachDisposition = {}): value is readonly string[] {
	if (!isCanonicalNonClaimSet(value)) return false;
	const axes = cealGatewayProofAxisState(value);
	if (axes.production_audit !== "not_reached") return false;
	if (disposition.wasReached === true) return axes.provider_execution === "reached";
	return axes.provider_execution === "not_reached" || disposition.mayBeReached === true;
}

function isCanonicalNonClaimSet(value: unknown): value is readonly string[] {
	if (!Array.isArray(value)) return false;
	const canonical = CEAL_GATEWAY_HOST_NON_CLAIM_ORDER.filter((token) => value.includes(token));
	return canonical.length === value.length && canonical.every((token, index) => token === value[index]);
}
