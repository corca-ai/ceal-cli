import {
	CEAL_GATEWAY_POLICY_DENIAL_MESSAGE,
	CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION,
	type CealGatewayCallValue,
} from "@corca-ai/ceal-protocol";
import { classifyClientSessionFailure, isClassifiedClientSessionFailure } from "./client-session.js";
import { writeYaml } from "./output.js";
import type { CealStoredSession } from "./profile-store.js";

interface ResultIo {
	stdout: { write(chunk: string): unknown };
}

/**
 * Optional receipt-spool hook: receives the exact emitted result envelope so
 * the spooled projection can only ever be a subset of what the caller already
 * saw. The recorder must swallow its own failures (see index.ts wiring); a
 * spool problem never changes a call's output or exit code.
 */
export type CealCallResultRecorder = (envelope: Record<string, unknown>) => void;

/** The failing capability's declared effect, when discovery is known locally. */
export type CealCapabilityEffect = "read" | "write";

// An unknown outcome only warrants replay caution for a capability that can
// change provider state. Attaching "do not repeat a write" to a declared read
// makes an agent apply write-grade discipline to an idempotent call, and makes
// the operator reading the transcript later see a write that never existed
// (corca-ai/ceal-cli#2). An unknown effect keeps the caution: silence would be
// the unsafe default.
function unknownOutcomeCaution(effect: CealCapabilityEffect | undefined): string {
	return effect === "read" ? "" : "Do not repeat this call yet; its provider outcome is unknown. ";
}

export interface CealParsedCapabilityCall {
	ok: true;
	capabilityId: string;
	targetRef: string;
	arguments: Record<string, string | number>;
	purpose: string;
	profileRef?: string;
}

function emitCallResult(io: ResultIo, envelope: Record<string, unknown>, record: CealCallResultRecorder | undefined): number {
	const exitCode = writeYaml(io.stdout, envelope);
	record?.(envelope);
	return exitCode;
}

/**
 * The issuing Gateway identity for one result, in the same `gateway:` shape the
 * discovery surfaces already emit. A result that omits it cannot be attributed
 * later: two instances answer with the same profile name, the same client, and
 * cross-stable target refs, so an archived response is indistinguishable from
 * one produced by the other instance (corca-ai/ceal-cli#3). The profile stamped
 * is the one the call actually used, which is the per-call `--profile` override
 * when present, not the session default.
 */
export function gatewayResultIdentity(
	session: CealStoredSession | null,
	profileRef?: string,
): { gateway: { instance_ref: string; profile_ref: string } } | Record<string, never> {
	if (!session) return {};
	return { gateway: { instance_ref: session.instanceRef, profile_ref: profileRef ?? session.profileRef } };
}

export function writeCallCompleted(
	value: CealGatewayCallValue,
	events: unknown,
	requestId: string,
	io: ResultIo,
	session: CealStoredSession,
	parsed: CealParsedCapabilityCall,
	record?: CealCallResultRecorder,
): number {
	const eventRefs = Array.isArray(events)
		? events.flatMap((event) => (event && typeof event === "object" && "event_ref" in event ? [String(event.event_ref)] : []))
		: [];
	if (eventRefs.length === 0) return writeCallIncomplete(value, requestId, "audit_readback_missing", io, session, parsed, record);
	return emitCallResult(
		io,
		{
			schema_version: "ceal.result.v2",
			ok: true,
			status: "completed",
			capability: parsed.capabilityId,
			target: parsed.targetRef,
			...gatewayResultIdentity(session, parsed.profileRef),
			data: value.data,
			receipt: { evidence: "readback_verified", request_ref: requestId, audit_refs: eventRefs },
		},
		record,
	);
}

export function writeCallGatewayFailure(
	response: { error: unknown; proof_ref_or_unavailable?: unknown },
	io: ResultIo,
	session: CealStoredSession,
	parsed: CealParsedCapabilityCall,
	requestId: string,
	record?: CealCallResultRecorder,
): number {
	const failure = classifyGatewayFailure(response.error);
	const proofRefs = typeof response.proof_ref_or_unavailable === "string" ? [response.proof_ref_or_unavailable] : [];
	emitCallResult(
		io,
		{
			schema_version: "ceal.result.v2",
			ok: false,
			status: failure.denial ? "blocked" : "error",
			capability: parsed.capabilityId,
			target: parsed.targetRef,
			...gatewayResultIdentity(session, parsed.profileRef),
			receipt: { evidence: "not_read_back", request_ref: requestId, audit_refs: proofRefs },
			error: {
				kind: failure.denial ? "authorization_denied" : failure.code,
				message: failure.message,
				next_action: failure.nextAction,
				// Present only when the Gateway supplied it, so absence stays a
				// readable "the Gateway named no wait" rather than a zero an agent
				// would pace against.
				...(failure.retryAfterMs === undefined ? {} : { retry_after_ms: failure.retryAfterMs }),
			},
		},
		record,
	);
	return 3;
}

export function writeCallIncomplete(
	value: CealGatewayCallValue,
	requestId: string,
	reason: string,
	io: ResultIo,
	session: CealStoredSession,
	parsed: CealParsedCapabilityCall,
	record?: CealCallResultRecorder,
): number {
	emitCallResult(
		io,
		{
			schema_version: "ceal.result.v2",
			ok: false,
			status: "error",
			capability: parsed.capabilityId,
			target: parsed.targetRef,
			...gatewayResultIdentity(session, parsed.profileRef),
			data: value.data,
			receipt: { evidence: "readback_unavailable", request_ref: requestId, audit_refs: [] },
			error: {
				kind: reason,
				message: "The Gateway returned a result but its audit event was not read back.",
				next_action: "Retry audit readback with the request ID before claiming verified completion.",
			},
		},
		record,
	);
	return 3;
}

export function writeCallUnavailable(
	reason: string,
	io: ResultIo,
	session: CealStoredSession | null,
	parsed: CealParsedCapabilityCall | null,
	requestId?: string,
	record?: CealCallResultRecorder,
	capabilityEffect?: CealCapabilityEffect,
): number {
	const requestWasIssued = typeof requestId === "string";
	const sessionFailure = isClassifiedClientSessionFailure(reason) ? classifyClientSessionFailure(reason) : null;
	emitCallResult(
		io,
		{
			schema_version: "ceal.result.v2",
			ok: false,
			status: "error",
			...(parsed ? { capability: parsed.capabilityId, target: parsed.targetRef } : {}),
			...gatewayResultIdentity(session, parsed?.profileRef),
			// A transport failure after the worker has allocated the Gateway request
			// reference has an unknown outcome: the Gateway may have completed and
			// audited the call after the client stopped waiting. Preserve that safe
			// correlation key so an agent can inspect it instead of repeating a write.
			...(requestWasIssued ? { receipt: { evidence: "outcome_unknown", request_ref: requestId, audit_refs: [] } } : {}),
			error: {
				kind: reason,
				...(sessionFailure
					? { retryable: sessionFailure.retryable, message: sessionFailure.message, next_action: sessionFailure.nextAction }
					: {
							message: "The capability call could not be completed.",
							next_action: requestWasIssued
								? `${unknownOutcomeCaution(capabilityEffect)}Run 'ceal receipt show ${requestId}' after a short wait to read the Gateway outcome; while that reference has no audited outcome the Gateway answers 'audit_event_not_found'.`
								: "Run 'ceal capabilities' and verify the client Session, Profile membership, and target Grant.",
						}),
			},
		},
		record,
	);
	return 3;
}

export function gatewayFailureCode(error: unknown): string | null {
	return error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
		? (error as { code: string }).code
		: null;
}

interface SafeGatewayFailure {
	code: string;
	message: string;
	nextAction: string;
	denial: boolean;
	/**
	 * The Gateway's own wait, in milliseconds, when it supplied one.
	 *
	 * corca-ai/ceal#642: a throttled caller had no way to learn a safe pace, so
	 * agents binary-searched it — three calls, throttle, guess, repeat. The
	 * protocol has carried `recovery.retry_after_ms` all along and this renderer
	 * dropped it, so even a Gateway that answered the question precisely came out
	 * as the prose "wait briefly". Absent stays absent: this is the Gateway's
	 * number or nothing, never a locally invented backoff.
	 */
	retryAfterMs?: number;
}

const GATEWAY_FAILURE_HINTS: Readonly<Record<string, Omit<SafeGatewayFailure, "code">>> = Object.freeze({
	policy_denied: { message: CEAL_GATEWAY_POLICY_DENIAL_MESSAGE, nextAction: CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION, denial: true },
	authentication_failed: {
		message: "The Gateway rejected the client credential.",
		nextAction: "Obtain a current Gateway-issued client session and retry.",
		denial: true,
	},
	profile_binding_denied: {
		message: "The Gateway rejected the requested Profile selection.",
		nextAction: "Use a Profile assigned to the authenticated subject and retry.",
		denial: true,
	},
	profile_access_denied: {
		message: "The Gateway rejected the requested Profile selection.",
		nextAction: "Use a Profile assigned to the authenticated subject and retry.",
		denial: true,
	},
	// Deliberately not a denial: the Gateway's opaque contract does not disclose
	// whether policy or absence made the resource unavailable, so the call
	// surface must not claim an authorization decision. The receipt readback is
	// the authoritative audited disposition.
	resource_not_available: {
		message: "The Gateway reported the requested resource as not available to this client.",
		nextAction:
			"Run fresh capability discovery, then search or resolve the resource again; repeating the same reference will not make it available.",
		denial: false,
	},
	continuation_not_available: {
		message: "The approved continuation is no longer available.",
		nextAction: "Run fresh capability discovery, then search or resolve the governed resource again and use its new reference.",
		denial: false,
	},
	invalid_arguments: {
		message: "The capability arguments do not satisfy the published input contract.",
		nextAction: "Correct the capability arguments, then retry the call with a new request ID.",
		denial: false,
	},
	// The Gateway answers a readback for an unknown or not-yet-audited request
	// reference with its own 404 code. Rendering that as the generic failure is
	// what made an unknown outcome unresolvable: the caller was told to consult a
	// receipt route that had, in fact, answered precisely — no audited outcome
	// exists for this reference (corca-ai/ceal-cli#2).
	audit_event_not_found: {
		message: "The Gateway has no audited outcome for that request reference.",
		nextAction:
			"If the reference came from a call whose outcome was unknown, retry this readback after a short wait; a reference that never gains an audited outcome is one the Gateway never recorded, so the call did not reach provider execution.",
		denial: false,
	},
	invalid_readback_request: {
		message: "The request reference is not a readable Gateway request id.",
		nextAction: "Use the exact 'receipt.request_ref' string a 'ceal call' returned; do not construct or truncate it.",
		denial: false,
	},
	connector_unavailable: {
		message: "The granted connector is currently unavailable.",
		nextAction: "Ask the Gateway operator to restore the connector; requesting another grant will not fix this state.",
		denial: false,
	},
	rate_limited: {
		message: "The Gateway rate quota for this client is temporarily exhausted.",
		nextAction: "Wait briefly and retry the same call; the connector does not need operator restoration.",
		denial: false,
	},
	idempotency_conflict: {
		message: "The idempotency key names a different governed write.",
		nextAction: "Reuse the exact original request, or choose a new idempotency key for a new intended write.",
		denial: false,
	},
	incompatible_protocol: {
		message: "The Ceal client and Gateway protocol versions are incompatible.",
		nextAction: "Upgrade the Ceal client or Gateway to compatible releases.",
		denial: false,
	},
});

// Locally-owned rendering for the Gateway's closed recovery vocabulary. The
// known code table wins on disagreement; a recovery class only rescues codes
// this CLI does not know, so a new failure code degrades by class instead of
// to the generic hint. Non-member kinds are never echoed into agent context.
const GATEWAY_RECOVERY_HINTS: Readonly<Record<string, Omit<SafeGatewayFailure, "code">>> = Object.freeze({
	retry: {
		message: "The Gateway declined the request with a retryable rejection.",
		nextAction: "Wait briefly and retry the same call; the connector does not need operator restoration.",
		denial: false,
	},
	re_authenticate: {
		message: "The Gateway rejected the client credential.",
		nextAction: "Obtain a current Gateway-issued client session and retry.",
		denial: true,
	},
	select_granted_scope: {
		message: "The Gateway rejected the requested Profile or target selection.",
		nextAction: "Use a Profile and target granted to the authenticated subject and retry.",
		denial: true,
	},
	request_approval: {
		message: "The Gateway declined the request pending policy approval.",
		nextAction: "Request policy approval for this capability and target.",
		denial: true,
	},
	operator_restore: {
		message: "The Gateway reported the backing connector as unavailable.",
		nextAction: "Ask the Gateway operator to restore the connector; requesting another grant will not fix this state.",
		denial: false,
	},
	upgrade_client: {
		message: "The Ceal client and Gateway protocol versions are incompatible.",
		nextAction: "Upgrade the Ceal client or Gateway to compatible releases.",
		denial: false,
	},
});

function gatewayRecoveryKind(error: unknown): string | null {
	if (!error || typeof error !== "object" || !("recovery" in error)) return null;
	const recovery = (error as { recovery?: unknown }).recovery;
	if (!recovery || typeof recovery !== "object" || !("kind" in recovery)) return null;
	const kind = (recovery as { kind?: unknown }).kind;
	return typeof kind === "string" && Object.hasOwn(GATEWAY_RECOVERY_HINTS, kind) ? kind : null;
}

// Read independently of the recovery *kind*. The known-code table wins over a
// disagreeing recovery class, so a `rate_limited` code takes its message from
// the table and would otherwise discard the wait that arrived beside it — which
// is the exact case #642 reports. The protocol validator already bounds this
// value; anything it would have rejected never reaches here.
function gatewayRetryAfterMs(error: unknown): number | undefined {
	if (!error || typeof error !== "object" || !("recovery" in error)) return undefined;
	const recovery = (error as { recovery?: unknown }).recovery;
	if (!recovery || typeof recovery !== "object" || !("retry_after_ms" in recovery)) return undefined;
	const wait = (recovery as { retry_after_ms?: unknown }).retry_after_ms;
	return typeof wait === "number" && Number.isSafeInteger(wait) && wait >= 0 ? wait : undefined;
}

export function classifyGatewayFailure(error: unknown): SafeGatewayFailure {
	const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
	const hint = typeof code === "string" && Object.hasOwn(GATEWAY_FAILURE_HINTS, code) ? GATEWAY_FAILURE_HINTS[code] : undefined;
	const retryAfterMs = gatewayRetryAfterMs(error);
	const wait = retryAfterMs === undefined ? {} : { retryAfterMs };
	if (typeof code === "string" && hint) return { code, ...hint, ...wait };
	const kind = gatewayRecoveryKind(error);
	if (typeof code === "string" && kind) return { code, ...GATEWAY_RECOVERY_HINTS[kind], ...wait };
	return {
		...wait,
		code: "gateway_request_failed",
		message: "The Gateway rejected the capability request.",
		nextAction: "Check Gateway status and audit readback, then retry with a new request ID.",
		denial: false,
	};
}
