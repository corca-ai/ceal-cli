/**
 * The governed-mutation boundary a discovered write capability declares, and the
 * stricter form an announcement policy may describe.
 *
 * Split out of the validator entry (which is at its length budget) because it is
 * one coherent question — what may a write contract say, and who owns each
 * answer — rather than a slice of the response walk.
 *
 * The split that matters is OWNERSHIP, not taste:
 *
 * - `side_effect_class` and `compensation` name what a CONNECTOR does. Their
 *   vocabulary grows with the connectors, so they are validated for GRAMMAR and
 *   never for membership. Closing them would make the next connector's honest
 *   description a decode failure — the failure class #700 recorded, where a
 *   relay refused a contract it does not own.
 * - `idempotency`, `provider_readback`, `dry_run`, `attribution`, and
 *   `provenance_binding` name what the GATEWAY guarantees, and a caller branches
 *   on each of them before it calls. A value it cannot interpret is worse than a
 *   refusal, so these stay CLOSED and a new member stays a release event
 *   (`ADDITIVE_VALUE_VOCABULARY_WARNING`).
 *
 * Before this module, `compensation` and `dry_run` crossed the boundary carried
 * only by the write contract's index signature: no type, no member check, and no
 * grammar beyond generic safe-JSON.
 */
import { assertSafeJsonValue, invalidResponse, requireRecord, requireSafeRef } from "./gateway-validation-primitives.js";

/** Gateway-guaranteed members. Adding one is a release event, not a free field. */
export const CEAL_GATEWAY_WRITE_CONTRACT_CLOSED_VOCABULARIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
	idempotency: Object.freeze(["required", "optional", "not_required"]),
	provider_readback: Object.freeze(["required", "best_effort", "not_available"]),
	dry_run: Object.freeze(["supported", "unsupported"]),
	attribution: Object.freeze(["subject", "requester_event", "connector_integration"]),
	provenance_binding: Object.freeze(["gateway_attested_requester_event_v1"]),
});

const REQUIRED_KEYS = ["side_effect_class", "idempotency", "provider_readback"] as const;
/** Connector-owned vocabularies: safe-ref grammar, open membership. */
const OPEN_REF_KEYS = ["side_effect_class", "compensation"] as const;

export function validateCealGatewayWriteContract(value: unknown): void {
	const contract = requireRecord(value);
	assertSafeJsonValue(contract, { forbidAuthorityKeys: false });
	for (const key of REQUIRED_KEYS) if (contract[key] === undefined) invalidResponse();
	for (const key of OPEN_REF_KEYS) if (contract[key] !== undefined) requireSafeRef(contract[key]);
	for (const [key, members] of Object.entries(CEAL_GATEWAY_WRITE_CONTRACT_CLOSED_VOCABULARIES)) {
		if (contract[key] !== undefined && !members.includes(String(contract[key]))) invalidResponse();
	}
	// A provenance binding is an attested statement about a REQUESTER EVENT, so
	// it cannot ride a subject- or connector-attributed mutation: there is no
	// requester event there to attest, and a caller reading the binding alone
	// would credit the mutation to a person who never asked for it.
	if (contract.provenance_binding !== undefined && contract.attribution !== "requester_event") invalidResponse();
}

/**
 * The announcement-policy form is strictly narrower: a policy may describe a
 * mutation only when every guarantee it rests on is the strongest member.
 */
export function validateCealGatewayAnnouncementWriteContract(value: unknown): void {
	const contract = requireRecord(value);
	if (contract.idempotency !== "required" || contract.provider_readback !== "required"
		|| contract.attribution !== "requester_event" || contract.provenance_binding !== "gateway_attested_requester_event_v1") invalidResponse();
}
