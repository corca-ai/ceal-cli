/**
 * Three facts a governed write receipt carries that a reader keeps confusing,
 * named apart here so the protocol states the difference instead of shipping
 * three interchangeable 64-hex strings.
 *
 * They are all SHA-256 digests, all opaque, all the same shape on the wire. That
 * is exactly why nothing stops a producer from deriving one of them from
 * another, and why the confusion is silent when it happens.
 *
 * ## 1. The semantic REPLAY IDENTITY — `idempotency_claim_sha256`
 *
 * The tuple that decides whether two attempts are the SAME mutation: instance,
 * profile, capability, opaque target, and the idempotency-key digest
 * (`docs/specs/gateway-write-request-provenance.spec.md`, "Two identities remain
 * distinct"). It is deliberately STABLE across a transport retry that arrives
 * with a fresh `request_id`, and it excludes mutable provider state and the
 * request body. It is the only one of the three that answers "have I already
 * done this?".
 *
 * ## 2. The public LOOKUP HANDLE — `write_request_ref` / `write_request_sha256`
 *
 * An opaque per-attempt address (`gateway-write-request:<uuid>`) for reading one
 * receipt back. `write_request_sha256` is its digest, which is what the receipt
 * projects so the readback token itself never returns.
 *
 * **The handle must never become a second replay identity.** It is minted per
 * attempt, so a producer that derived the replay claim from it would give every
 * retry a fresh claim and idempotency would stop working silently: no error, no
 * refusal, just duplicate provider mutations. A deferred receipt later REUSES
 * the identity and returns a fresh handle — that asymmetry is the design, and it
 * only holds while the two are derived from different inputs.
 *
 * ## 3. SAME-KEY COLLISION EVIDENCE — `normalized_mutation_sha256`
 *
 * Binds the replay claim to the canonical arguments, precondition, and resolved
 * authority facts. Its whole job is to DISAGREE with a stored value under an
 * identical replay identity, which is how a reused idempotency key carrying a
 * different mutation is caught before provider I/O. Evidence that can never
 * contradict the claim it guards is not evidence.
 *
 * ## The guard
 *
 * The three must be PAIRWISE DISTINCT. Three domain-separated SHA-256 digests
 * over different inputs collide with negligible probability, so an equality here
 * is not chance — it is a producer that reused one derivation for two roles, and
 * that is precisely the failure each paragraph above describes.
 */

export type CealGatewayWriteIdentityRole = "replay_identity" | "lookup_handle" | "collision_evidence";

/**
 * Role -> the receipt field that carries it. Exported so a producer, a consumer,
 * and a test read one table instead of three restatements.
 */
export const CEAL_GATEWAY_WRITE_IDENTITY_FIELDS = Object.freeze({
	replay_identity: "idempotency_claim_sha256",
	lookup_handle: "write_request_sha256",
	collision_evidence: "normalized_mutation_sha256",
} as const);

export const CEAL_GATEWAY_WRITE_IDENTITY_ROLES = Object.freeze(["replay_identity", "lookup_handle", "collision_evidence"] as const);

/**
 * True when the three facts are present, digest-shaped, and pairwise distinct.
 *
 * Distinctness is checked as a SET SIZE rather than three comparisons so that
 * adding a fourth role to the table extends the guard automatically instead of
 * needing a fourth comparison nobody remembers to write.
 */
export function isValidCealGatewayWriteIdentitySeparation(receipt: Readonly<Record<string, unknown>>): boolean {
	const digests = CEAL_GATEWAY_WRITE_IDENTITY_ROLES.map((role) => receipt[CEAL_GATEWAY_WRITE_IDENTITY_FIELDS[role]]);
	if (!digests.every((digest) => typeof digest === "string" && /^[a-f0-9]{64}$/u.test(digest))) return false;
	return new Set(digests).size === digests.length;
}
