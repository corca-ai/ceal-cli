import {
	CEAL_GATEWAY_POLICY_DENIAL_MESSAGE,
	CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION,
	type CealGatewayCallValue,
} from "@corca-ai/ceal-protocol";
import type { CealStoredSession } from "./profile-store.js";
import { writeYaml } from "./output.js";

interface ResultIo { stdout: { write(chunk: string): unknown } }

export interface CealParsedCapabilityCall {
	ok: true;
	capabilityId: string;
	targetRef: string;
	arguments: Record<string, string | number>;
	purpose: string;
}

export function writeCallCompleted(
	value: CealGatewayCallValue, events: unknown, requestId: string, io: ResultIo,
	session: CealStoredSession, parsed: CealParsedCapabilityCall,
): number {
	const eventRefs = Array.isArray(events) ? events.flatMap((event) => event && typeof event === "object" && "event_ref" in event ? [String(event.event_ref)] : []) : [];
	return writeYaml(io.stdout, {
		schema: "ceal.result.v1", command: "ceal", ok: true, status: "ok", ...resultIdentity(session),
		request: resultRequest(parsed, requestId), authorization: { result: "allowed" },
		grant: { ref: value.grant_ref, revision: value.grant_revision },
		evidence: { requirement: "gateway_audit", reached: "gateway_journal_readback", refs: [...eventRefs] },
		claim: { allowed: true, scope: "gateway_result_and_journal_readback" }, warnings: [], data: value.data,
		audit: { state: "journaled", refs: [...eventRefs] }, redaction: value.redaction,
		usage: { state: "not_applicable", reason: "no_model_or_metered_component" },
		error: null, proof_level: "host_decision", non_claims: value.non_claims,
	});
}

export function writeCallGatewayFailure(
	response: { error: unknown; proof_ref_or_unavailable?: unknown }, io: ResultIo, session: CealStoredSession,
	parsed: CealParsedCapabilityCall, requestId: string,
): number {
	const failure = classifyGatewayFailure(response.error);
	const proofRefs = typeof response.proof_ref_or_unavailable === "string" ? [response.proof_ref_or_unavailable] : [];
	writeYaml(io.stdout, {
		schema: "ceal.result.v1", command: "ceal", ok: false, status: failure.denial ? "blocked" : "error",
		...resultIdentity(session), request: resultRequest(parsed, requestId),
		authorization: { result: failure.denial ? "denied" : "not_evaluated" },
		evidence: { requirement: "gateway_audit", reached: "host_decision", refs: proofRefs },
		claim: { allowed: false }, warnings: [], data: null,
		audit: proofRefs.length ? { state: "journaled", refs: proofRefs } : { state: "unavailable", reason: "readback_not_reached", scope: "runtime" },
		redaction: { state: "unavailable", reason: "capability_did_not_complete", scope: "runtime" },
		usage: { state: "unavailable", reason: "capability_did_not_complete", scope: "runtime" },
		error: { kind: failure.denial ? "authorization_denied" : failure.code, message: failure.message, next_action: failure.nextAction },
		proof_level: "host_decision", non_claims: ["No successful capability result or audit completion readback was reached."],
	});
	return 3;
}

export function writeCallIncomplete(
	value: CealGatewayCallValue, requestId: string, reason: string, io: ResultIo,
	session: CealStoredSession, parsed: CealParsedCapabilityCall,
): number {
	writeYaml(io.stdout, {
		schema: "ceal.result.v1", command: "ceal", ok: false, status: "error", ...resultIdentity(session),
		request: resultRequest(parsed, requestId), authorization: { result: "allowed" },
		grant: { ref: value.grant_ref, revision: value.grant_revision },
		evidence: { requirement: "gateway_audit", reached: "host_decision", refs: [] }, claim: { allowed: false }, warnings: [],
		data: value.data, audit: { state: "unavailable", reason, scope: "runtime" }, redaction: value.redaction,
		usage: { state: "unavailable", reason: "completion_unverified", scope: "runtime" }, proof_level: "host_decision",
		error: { kind: reason, message: "The Gateway returned a result but its audit event was not read back.", next_action: "Retry audit readback with the request ID before claiming verified completion." },
	});
	return 3;
}

export function writeCallUnavailable(
	reason: string, io: ResultIo, session: CealStoredSession | null, parsed: CealParsedCapabilityCall | null,
): number {
	writeYaml(io.stdout, {
		schema: "ceal.result.v1", command: "ceal", ok: false, status: "error", ...resultIdentity(session),
		request: parsed ? resultRequest(parsed, null) : null, authorization: { result: "not_evaluated" },
		evidence: { requirement: "gateway_audit", reached: "surface", refs: [] }, claim: { allowed: false }, warnings: [], data: null,
		audit: { state: "unavailable", reason: "pre_instance", scope: "local_cli" },
		redaction: { state: "not_applicable", reason: "no_instance_data_handling" },
		usage: { state: "not_applicable", reason: "no_model_or_metered_component" }, proof_level: "surface",
		error: { kind: reason, message: "The capability call could not be completed.", next_action: "Run 'ceal capabilities' and verify the client Session, Profile membership, and target Grant." },
	});
	return 3;
}

export function gatewayFailureCode(error: unknown): string | null {
	return error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
		? (error as { code: string }).code : null;
}

function resultIdentity(session: CealStoredSession | null): Record<string, string | null> {
	return {
		profile: session?.profileRef ?? null,
		membership: session?.membershipRef ?? null,
		instance: session?.instanceRef ?? null,
		subject: session?.subjectRef ?? null,
		client: session?.clientRef ?? null,
	};
}

function resultRequest(parsed: CealParsedCapabilityCall, requestId: string | null): Record<string, string | null> {
	return {
		request_id: requestId, command_family: "capability.call", capability_id: parsed.capabilityId,
		target_ref: parsed.targetRef, purpose: parsed.purpose,
	};
}

interface SafeGatewayFailure { code: string; message: string; nextAction: string; denial: boolean }

export function classifyGatewayFailure(error: unknown): SafeGatewayFailure {
	const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
	if (code === "policy_denied") return { code, message: CEAL_GATEWAY_POLICY_DENIAL_MESSAGE, nextAction: CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION, denial: true };
	if (code === "authentication_failed") return { code, message: "The Gateway rejected the client credential.", nextAction: "Obtain a current Gateway-issued client session and retry.", denial: true };
	if (code === "profile_binding_denied") return { code, message: "The Gateway rejected the requested Profile selection.", nextAction: "Use a Profile assigned to the authenticated subject and retry.", denial: true };
	if (code === "connector_unavailable") return { code, message: "The granted connector is currently unavailable.", nextAction: "Ask the Gateway operator to restore the connector; requesting another grant will not fix this state.", denial: false };
	if (code === "incompatible_protocol") return { code, message: "The Ceal client and Gateway protocol versions are incompatible.", nextAction: "Upgrade the Ceal client or Gateway to compatible releases.", denial: false };
	return { code: "gateway_request_failed", message: "The Gateway rejected the capability request.", nextAction: "Check Gateway status and audit readback, then retry with a new request ID.", denial: false };
}
