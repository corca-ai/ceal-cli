/**
 * Additive non-authority response fields (#700 server half).
 *
 * Every response decoder in this protocol is closed-world: an unknown key is a
 * decode failure, not a field to ignore. That is correct for anything that
 * carries authority, and wrong for everything else — it made each new piece of
 * descriptive guidance a breaking change, and six of them were paid for one at
 * a time with a bespoke `x-ceal-*` accept header apiece. (Per-field headers
 * were not the only route taken: `cache_origin` shipped by loosening its
 * decoder and releasing clients instead. Both routes cost a release.)
 *
 * The replacement is one negotiated decode generation. A client that declares
 * it tolerates unknown NON-AUTHORITY response keys receives every field in
 * `ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS`, and the next such KEY costs no
 * header and no client release. A client that declares nothing keeps exactly
 * the shape it has today, so this is additive for already-released workers.
 *
 * ## What `additive-v1` means, exactly
 *
 * A client sending it asserts: **unknown keys are ignored at every depth of a
 * non-authority response object** — not only at the top level. The five fields
 * below sit at four different depths, so a decoder that tolerates unknown keys
 * on the envelope but still exact-keys the `error` object or an audit event
 * would send this header in good faith and then hard-fail on `error.recovery`.
 * The generation is the durable discriminator and cannot be retired the way the
 * six per-field headers can, so its meaning is pinned here rather than left to
 * the first implementer.
 *
 * ## The two boundaries, and what actually holds each one
 *
 * - **Eligibility is about keys, never about authority.** A field qualifies
 *   only if a client that never sees it reaches the same decision it reaches
 *   today. The INCLUSION side is enforced: `additiveResponseFieldAllowed`
 *   refuses any field without a registry row, and `CealAdditiveResponseField`
 *   makes a missing row a type error. The EXCLUSION side is a declared
 *   convention — `NON_ADDITIVE_RESPONSE_FIELDS` records each excluded field
 *   with its reason, and a test holds the two registries disjoint, but no gate
 *   reaches an emission site. A field that never appears in either registry is
 *   not stopped by this module; it is stopped by whoever reviews it.
 * - **Eligibility is about keys, never about values.** Changing what an
 *   EXISTING field may contain is not additive: an old client decodes the key
 *   and then misreads it, or refuses it outright. This applies to the five
 *   eligible fields too, and that is the trap this module exists to flag —
 *   see `ADDITIVE_VALUE_VOCABULARY_WARNING`.
 */

/**
 * A client sends this header to declare that its response decoder ignores
 * unknown non-authority keys at every depth instead of failing the response.
 */
export const CEAL_GATEWAY_DECODE_GENERATION_HEADER = "x-ceal-decode-generation";

/** The only generation this Gateway understands. Matched exactly, case-sensitively. */
export const CEAL_GATEWAY_ADDITIVE_DECODE_GENERATION = "additive-v1";

/**
 * The trap a later author is most likely to fall into, stated where they will
 * be reading.
 *
 * Three of the five eligible fields carry CLOSED value vocabularies, and the
 * shipped decoder rejects the whole response on an unknown member rather than
 * degrading: `recovery.kind` against `CEAL_GATEWAY_RECOVERY_KINDS`,
 * `capability_access[].readiness`, and `connector_route_failure.phase`/`.cause`.
 * Adding a member to any of them breaks every installed tolerant client — the
 * same failure class as `announcement_policy` v2, which is excluded for it.
 *
 * So the generation makes a new KEY free. It does not make a new ENUM MEMBER
 * free, and no registry row below should be read as saying otherwise.
 */
export const ADDITIVE_VALUE_VOCABULARY_WARNING =
	"a declared-tolerant client tolerates unknown keys, not unknown values; extending a closed enum on an eligible field is still a breaking change";

/**
 * The response fields a declared-tolerant client receives without its own
 * per-field opt-in.
 *
 * The registry key is the NEGOTIATION name, which is not the wire field name —
 * `wireField` records what a client actually looks for, so the two are never
 * confused in a spec or a client implementation.
 *
 * `legacyAcceptHeader` stays honored so an installed client that only knows its
 * own opt-in keeps exactly what it has.
 */
export const ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS = Object.freeze({
	recovery: { legacyAcceptHeader: "x-ceal-recovery", wireField: "error.recovery" },
	rate_limit_policy: { legacyAcceptHeader: "x-ceal-rate-limit-policy", wireField: "value.targets[].capability_access[].rate_limit" },
	profiles: { legacyAcceptHeader: "x-ceal-profiles", wireField: "value.eligible_profiles" },
	route_provenance: { legacyAcceptHeader: "x-ceal-route-provenance", wireField: "value.events[].connector_route_failure" },
	audit_timing: { legacyAcceptHeader: "x-ceal-audit-timing", wireField: "value.events[].gateway_elapsed_ms" },
} as const);

export type CealAdditiveResponseField = keyof typeof ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS;

/**
 * Response fields that must never become additive, with the reason, so a later
 * field cannot be reclassified as guidance by whoever adds it.
 *
 * These are wire field names. `announcement_policy` is excluded not because
 * emitting it would be key-breaking today — no installed client receives it at
 * all, so on the wire it currently looks as key-additive as the five above —
 * but because its rows are a version-pinned projection a client must interpret
 * exactly, and generic unknown-key tolerance is no evidence of vocabulary
 * readiness. That distinction is the whole point of
 * `ADDITIVE_VALUE_VOCABULARY_WARNING`.
 */
export const NON_ADDITIVE_RESPONSE_FIELDS = Object.freeze({
	announcement_policy: "a version-pinned vocabulary the client must interpret exactly; key tolerance is not vocabulary readiness",
	grant_snapshot: "carries authorization state the client acts on",
	capability_access: "carries authorization state the client acts on",
} as const);

/** True when the client declared the additive decode generation. */
export function clientDeclaresAdditiveDecoding(headerValue: unknown): boolean {
	return headerValue === CEAL_GATEWAY_ADDITIVE_DECODE_GENERATION;
}

/**
 * Whether a given additive field may be emitted: the declared generation grants
 * every registered field, and the legacy per-field header still grants its own.
 */
export function additiveResponseFieldAllowed(
	field: CealAdditiveResponseField,
	options: { generationDeclared: boolean; legacyFieldAccepted: boolean },
): boolean {
	if (!Object.hasOwn(ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS, field)) return false;
	return options.generationDeclared || options.legacyFieldAccepted;
}
