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
	profileRef?: string;
}

export function writeCallCompleted(
	value: CealGatewayCallValue, events: unknown, requestId: string, io: ResultIo,
	session: CealStoredSession, parsed: CealParsedCapabilityCall,
): number {
	const eventRefs = Array.isArray(events) ? events.flatMap((event) => event && typeof event === "object" && "event_ref" in event ? [String(event.event_ref)] : []) : [];
	if (eventRefs.length === 0) return writeCallIncomplete(value, requestId, "audit_readback_missing", io, session, parsed);
	return writeYaml(io.stdout, {
		schema_version: "ceal.result.v2", status: "completed", capability: parsed.capabilityId,
		target: parsed.targetRef, data: value.data,
		receipt: { evidence: "readback_verified", request_ref: requestId, audit_refs: eventRefs },
	});
}

export function writeCallGatewayFailure(
	response: { error: unknown; proof_ref_or_unavailable?: unknown }, io: ResultIo, session: CealStoredSession,
	parsed: CealParsedCapabilityCall, requestId: string,
): number {
	const failure = classifyGatewayFailure(response.error);
	const proofRefs = typeof response.proof_ref_or_unavailable === "string" ? [response.proof_ref_or_unavailable] : [];
	writeYaml(io.stdout, {
		schema_version: "ceal.result.v2", status: failure.denial ? "blocked" : "error",
		capability: parsed.capabilityId, target: parsed.targetRef,
		...(proofRefs.length ? { receipt: { evidence: "not_read_back", request_ref: requestId, audit_refs: proofRefs } } : {}),
		error: { kind: failure.denial ? "authorization_denied" : failure.code, message: failure.message, next_action: failure.nextAction },
	});
	return 3;
}

export function writeCallIncomplete(
	value: CealGatewayCallValue, requestId: string, reason: string, io: ResultIo,
	session: CealStoredSession, parsed: CealParsedCapabilityCall,
): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.result.v2", status: "error", capability: parsed.capabilityId, target: parsed.targetRef,
		data: value.data, receipt: { evidence: "readback_unavailable", request_ref: requestId, audit_refs: [] },
		error: { kind: reason, message: "The Gateway returned a result but its audit event was not read back.", next_action: "Retry audit readback with the request ID before claiming verified completion." },
	});
	return 3;
}

export function writeCallUnavailable(
	reason: string, io: ResultIo, session: CealStoredSession | null, parsed: CealParsedCapabilityCall | null,
): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.result.v2", status: "error",
		...(parsed ? { capability: parsed.capabilityId, target: parsed.targetRef } : {}),
		error: { kind: reason, message: "The capability call could not be completed.", next_action: "Run 'ceal capabilities' and verify the client Session, Profile membership, and target Grant." },
	});
	return 3;
}

export function gatewayFailureCode(error: unknown): string | null {
	return error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
		? (error as { code: string }).code : null;
}

interface SafeGatewayFailure { code: string; message: string; nextAction: string; denial: boolean }

export function classifyGatewayFailure(error: unknown): SafeGatewayFailure {
	const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
	if (code === "policy_denied") return { code, message: CEAL_GATEWAY_POLICY_DENIAL_MESSAGE, nextAction: CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION, denial: true };
	if (code === "authentication_failed") return { code, message: "The Gateway rejected the client credential.", nextAction: "Obtain a current Gateway-issued client session and retry.", denial: true };
	if (code === "profile_binding_denied" || code === "profile_access_denied") {
		return { code, message: "The Gateway rejected the requested Profile selection.", nextAction: "Use a Profile assigned to the authenticated subject and retry.", denial: true };
	}
	if (code === "connector_unavailable") return { code, message: "The granted connector is currently unavailable.", nextAction: "Ask the Gateway operator to restore the connector; requesting another grant will not fix this state.", denial: false };
	if (code === "idempotency_conflict") return { code, message: "The idempotency key names a different governed write.", nextAction: "Reuse the exact original request, or choose a new idempotency key for a new intended write.", denial: false };
	if (code === "incompatible_protocol") return { code, message: "The Ceal client and Gateway protocol versions are incompatible.", nextAction: "Upgrade the Ceal client or Gateway to compatible releases.", denial: false };
	return { code: "gateway_request_failed", message: "The Gateway rejected the capability request.", nextAction: "Check Gateway status and audit readback, then retry with a new request ID.", denial: false };
}
