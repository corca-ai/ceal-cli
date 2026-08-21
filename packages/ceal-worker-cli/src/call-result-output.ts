import { isPlainJsonRecord as isPlainRecord } from "./canonical-json.js";
import { classifyClientSessionFailure, isClassifiedClientSessionFailure } from "./client-session.js";
import { SESSION_SETUP_NEXT_ACTION } from "./command-definitions.js";
import { hasExactObjectKeys as hasExactOwnKeys } from "./object-keys.js";
import { writeYaml } from "./output.js";
import type { CealStoredSession } from "./profile-store.js";
import { CEAL_SAFE_GATEWAY_CODE, containsCealCredential, isSafeGatewayProofRef } from "./safe-ref.js";
import { sameStringArray as hasExactStringValues } from "./string-array.js";
import {
	CEAL_GATEWAY_POLICY_DENIAL_MESSAGE,
	CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION,
	CEAL_GATEWAY_RECOVERY_KINDS,
	CEAL_PROTOCOL_VERSION,
	type CealGatewayCallValue,
	isCealPublicSafeText,
} from "@corca-ai/ceal-protocol";

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

export type CealGatewayAuditReadbackState = "verified" | "not_read_back" | "unavailable";

/**
 * Exact observation point for one Worker receipt.
 *
 * `receipt.evidence` predates the distinction and remains as a compatibility
 * token. A Gateway journal read proves only that the Gateway event was read; it
 * never upgrades the result to provider-state readback on its own.
 */
export function gatewayAuditVerification(gatewayAuditReadback: CealGatewayAuditReadbackState): {
	verification: { gateway_audit_readback: CealGatewayAuditReadbackState; provider_state_readback: "not_established" };
} {
	return {
		verification: {
			gateway_audit_readback: gatewayAuditReadback,
			provider_state_readback: "not_established",
		},
	};
}

type CealCallReceiptEvidence = "readback_verified" | "not_read_back" | "readback_unavailable" | "outcome_unknown";

function callReceipt(
	evidence: CealCallReceiptEvidence,
	gatewayAuditReadback: CealGatewayAuditReadbackState,
	requestRef: string,
	auditRefs: readonly string[],
): Record<string, unknown> {
	return {
		evidence,
		...gatewayAuditVerification(gatewayAuditReadback),
		request_ref: requestRef,
		audit_refs: auditRefs,
	};
}

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

// The Gateway's read cache replays the original serve's `non_claims` verbatim,
// because the data really was provider-fetched once. `cache_origin` is therefore
// the SOLE live-vs-replay discriminator the Protocol offers, and it says so at
// `gateway-response-types.ts` — a decoder that must tell a fresh serve from a
// replay MUST branch on its presence. Dropping it here handed an agent an
// hour-old replay under `evidence: readback_verified`, with nothing left in the
// document to notice it by. `redaction` travels for the same reason at one
// remove: a class the Gateway withheld otherwise reads as one the provider does
// not have.
function servedResultProvenance(value: CealGatewayCallValue): Record<string, unknown> {
	return {
		...(value.cache_origin ? { cache_origin: value.cache_origin } : {}),
		...(value.redaction?.omitted_classes?.length ? { redaction: value.redaction } : {}),
	};
}

/**
 * Everything a served result says regardless of whether its audit readback
 * landed. Both writers below build it from here rather than each spelling it
 * out, because the two spellings had already drifted once: `cache_origin` and
 * `redaction` were missing from both, and a fix applied to one of them would
 * have left the other silently answering with less.
 */
function servedResultHead(
	value: CealGatewayCallValue,
	session: CealStoredSession | null,
	parsed: CealParsedCapabilityCall,
): Record<string, unknown> {
	return {
		schema_version: "ceal.result.v2",
		capability: parsed.capabilityId,
		target: parsed.targetRef,
		...gatewayResultIdentity(session, parsed.profileRef),
		data: value.data,
		...servedResultProvenance(value),
	};
}

export function writeCallCompleted(
	value: CealGatewayCallValue,
	events: unknown,
	requestId: string,
	io: ResultIo,
	session: CealStoredSession | null,
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
			ok: true,
			status: "completed",
			...servedResultHead(value, session, parsed),
			receipt: callReceipt("readback_verified", "verified", requestId, eventRefs),
		},
		record,
	);
}

export function writeCallGatewayFailure(
	response: { error: unknown; proof_ref_or_unavailable?: unknown; ok?: unknown; protocol_version?: unknown; request_id?: unknown },
	io: ResultIo,
	session: CealStoredSession,
	parsed: CealParsedCapabilityCall,
	requestId: string,
	record?: CealCallResultRecorder,
): number {
	const failure = classifyGatewayFailure(response.error, parsed.capabilityId);
	const denial = failure.denial || isSafeGatewayPolicyDenial(response, parsed, requestId);
	const proofRefs = isSafeGatewayProofRef(response.proof_ref_or_unavailable) ? [response.proof_ref_or_unavailable] : [];
	emitCallResult(
		io,
		{
			schema_version: "ceal.result.v2",
			ok: false,
			status: denial ? "blocked" : "error",
			capability: parsed.capabilityId,
			target: parsed.targetRef,
			...gatewayResultIdentity(session, parsed.profileRef),
			receipt: callReceipt("not_read_back", "not_read_back", requestId, proofRefs),
			error: {
				kind: denial ? "authorization_denied" : failure.code,
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
	session: CealStoredSession | null,
	parsed: CealParsedCapabilityCall,
	record?: CealCallResultRecorder,
): number {
	emitCallResult(
		io,
		{
			ok: false,
			status: "error",
			...servedResultHead(value, session, parsed),
			receipt: callReceipt("readback_unavailable", "unavailable", requestId, []),
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
	const sessionUnavailable = reason === "session_unavailable";
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
			...(requestWasIssued
				? {
						receipt: callReceipt("outcome_unknown", "not_read_back", requestId, []),
					}
				: {}),
			error: {
				kind: reason,
				...(sessionFailure
					? { retryable: sessionFailure.retryable, message: sessionFailure.message, next_action: sessionFailure.nextAction }
					: sessionUnavailable
						? {
								message: "No Gateway-issued client session is configured for this client.",
								next_action: SESSION_SETUP_NEXT_ACTION,
							}
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
	const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
	return typeof code === "string" && CEAL_SAFE_GATEWAY_CODE.test(code) && isCealPublicSafeText(code, 64) && !containsCealCredential(code)
		? code
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

const GATEWAY_DENIAL_CODES = new Set([
	"authentication_failed",
	"profile_binding_denied",
	"profile_access_denied",
	"target_catalog_capability_not_granted",
]);
const GATEWAY_NON_DENIAL_CODES = new Set([
	"resource_not_available",
	"continuation_not_available",
	"invalid_arguments",
	"audit_event_not_found",
	"target_catalog_selection_invalid",
	"invalid_readback_request",
	"connector_unavailable",
	"rate_limited",
	"idempotency_conflict",
	"incompatible_protocol",
]);
const GATEWAY_DENIAL_RECOVERY_KINDS = new Set(["re_authenticate", "select_granted_scope", "request_approval"]);
const GATEWAY_FALLBACK_NEXT_ACTION = "Check Gateway status and audit readback before deciding whether to retry.";

/**
 * Per-code local fallback text for the two target-catalog refusals.
 *
 * corca-ai/ceal-cli#14 item 4: a Gateway refusal that carries no text of its own
 * degraded to ONE generic pair for every code, and for these two that generic
 * pair is actively wrong. Neither refusal is fixed by checking Gateway status
 * and retrying — the call named a target the catalog does not offer, or one it
 * offers without this capability — so the generic action sends an agent to
 * re-run an unchanged call instead of to the route that answers the question.
 *
 * Only these two are listed, because only these two name an operand the CLIENT
 * can act on locally: which target to pick. Every other code stays generic
 * rather than acquiring invented local advice about server-side state.
 *
 * The Gateway's own text still wins whenever it supplies safe text; this is
 * only what to say when it supplied none.
 */
function gatewayCatalogFallback(code: string, capabilityId: string | null): { message: string; nextAction: string } | null {
	// Named `<capability-id>` rather than dropped when the id is unknown, so the
	// emitted line is always a command an agent can complete, never one that
	// silently means something else if pasted as-is.
	const capability = capabilityId ?? "<capability-id>";
	if (code === "target_catalog_selection_invalid")
		return {
			message: "The Gateway refused the call because the named target is not a valid selection for this capability.",
			nextAction: `Run 'ceal capabilities targets --capability ${capability}' to select a bounded target, then call again with one it lists.`,
		};
	if (code === "target_catalog_capability_not_granted")
		return {
			message: "The Gateway refused the call because this capability is not granted for the named target.",
			nextAction: `Run 'ceal capabilities --capability ${capability}' to see which targets grant this capability, then call a granted target or request a grant for this one.`,
		};
	return null;
}
const MAX_GATEWAY_RETRY_AFTER_MS = 60 * 60 * 1000;
// The Protocol decoder admits only bounded public-safe text here. A Gateway
// recovery can name an opaque ref that is different for every write, so a local
// hint cannot safely reconstruct it. The only local fallback is for a missing
// or unsafe individual field.
function gatewayFailureText(error: unknown, field: "message" | "next_action"): string | null {
	if (error === null || typeof error !== "object") return null;
	const value = (error as { message?: unknown; next_action?: unknown })[field];
	return typeof value === "string" && isCealPublicSafeText(value, 512) && !containsCealCredential(value) ? value : null;
}

interface SafeGatewayRecovery {
	kind: string;
	retryAfterMs?: number;
}

function gatewayFailureRecovery(error: unknown): SafeGatewayRecovery | null {
	if (!error || typeof error !== "object" || !("recovery" in error)) return null;
	const recovery = (error as { recovery?: unknown }).recovery;
	if (!isPlainRecord(recovery) || !Object.hasOwn(recovery, "kind")) return null;
	const keys = Object.keys(recovery);
	if (keys.some((key) => key !== "kind" && key !== "retry_after_ms")) return null;
	const kind = (recovery as { kind?: unknown }).kind;
	if (typeof kind !== "string" || !(CEAL_GATEWAY_RECOVERY_KINDS as readonly string[]).includes(kind)) return null;
	if (!Object.hasOwn(recovery, "retry_after_ms")) return { kind };
	const wait = (recovery as { retry_after_ms?: unknown }).retry_after_ms;
	return typeof wait === "number" && Number.isSafeInteger(wait) && wait >= 0 && wait <= MAX_GATEWAY_RETRY_AFTER_MS
		? { kind, retryAfterMs: wait }
		: null;
}

function isSafeGatewayPolicyDenial(
	response: { error: unknown; proof_ref_or_unavailable?: unknown; ok?: unknown; protocol_version?: unknown; request_id?: unknown },
	parsed: CealParsedCapabilityCall,
	requestId: string,
): boolean {
	if (
		!hasExactOwnKeys(response, ["error", "ok", "proof_ref_or_unavailable", "protocol_version", "request_id"]) ||
		response.ok !== false ||
		response.request_id !== requestId ||
		response.protocol_version !== CEAL_PROTOCOL_VERSION ||
		!isSafeGatewayProofRef(response.proof_ref_or_unavailable) ||
		!hasExactOwnKeys(response.error, ["code", "decision", "message", "next_action"])
	)
		return false;
	const { error } = response;
	if (
		error.code !== "policy_denied" ||
		error.message !== CEAL_GATEWAY_POLICY_DENIAL_MESSAGE ||
		error.next_action !== CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION ||
		!hasExactOwnKeys(error.decision, ["capability_id", "host_decision", "non_claims", "proof_level", "schema_version", "target_ref"])
	)
		return false;
	const decision = error.decision;
	return (
		decision.schema_version === "ceal.gateway_policy_denial.v1" &&
		decision.capability_id === parsed.capabilityId &&
		decision.target_ref === parsed.targetRef &&
		decision.host_decision === "denied" &&
		decision.proof_level === "host_decision" &&
		hasExactStringValues(decision.non_claims, ["provider_execution_not_reached", "production_audit_not_reached"])
	);
}

function gatewayFailureDenial(recovery: SafeGatewayRecovery | null, code: string): boolean {
	if (GATEWAY_DENIAL_CODES.has(code)) return true;
	if (GATEWAY_NON_DENIAL_CODES.has(code)) return false;
	return recovery !== null && GATEWAY_DENIAL_RECOVERY_KINDS.has(recovery.kind);
}

export function classifyGatewayFailure(error: unknown, capabilityId?: string): SafeGatewayFailure {
	const safeError = isPlainRecord(error) ? error : null;
	const code = gatewayFailureCode(safeError) ?? "gateway_request_failed";
	const recovery = gatewayFailureRecovery(safeError);
	const wait = recovery?.retryAfterMs === undefined ? {} : { retryAfterMs: recovery.retryAfterMs };
	// The id is interpolated into rendered text, so it passes the same
	// public-safe gate the Gateway's own text does before it is echoed.
	const safeCapabilityId =
		typeof capabilityId === "string" && isCealPublicSafeText(capabilityId, 128) && !containsCealCredential(capabilityId)
			? capabilityId
			: null;
	const fallback = gatewayCatalogFallback(code, safeCapabilityId);
	return {
		code,
		message: gatewayFailureText(safeError, "message") ?? fallback?.message ?? "The Gateway rejected the capability request.",
		nextAction: gatewayFailureText(safeError, "next_action") ?? fallback?.nextAction ?? GATEWAY_FALLBACK_NEXT_ACTION,
		denial: gatewayFailureDenial(recovery, code),
		...wait,
	};
}
