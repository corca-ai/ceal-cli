import { CEAL_SAFE_REQUEST_ID } from "./safe-ref.js";
import { type CealHttpResponseKind, CealHttpTransportError } from "@corca-ai/ceal";

export type CealGatewayObservationPhase = "handshake" | "discovery";
export type CealGatewayObservationOperation = "handshake" | "discover";
type CealGatewayObservationResponseKind = CealHttpResponseKind | "typed_gateway_error";

/**
 * Safe phase facts for a capability failure. This is deliberately additive to
 * the older `live_gateway_checked` flag: the old flag has one bit, while an
 * operator needs to distinguish HTTP reachability, protocol handshake, and
 * discovery proof.
 */
export interface CealGatewayObservation {
	phase: CealGatewayObservationPhase;
	operation: CealGatewayObservationOperation;
	network_reached: boolean;
	http_response_received: boolean;
	protocol_handshake_verified: boolean;
	discovery_verified: boolean;
	request_id?: string;
	http_status?: number;
	response_content_type?: string | null;
	response_kind?: CealGatewayObservationResponseKind;
}

export function gatewayTransportObservation(
	error: unknown,
	input: {
		phase: CealGatewayObservationPhase;
		operation: CealGatewayObservationOperation;
		requestId?: string;
	},
): CealGatewayObservation {
	const transport = error instanceof CealHttpTransportError ? error : undefined;
	const responseReceived = transport?.http_status !== null && transport?.http_status !== undefined;
	const requestId = safeRequestId(transport?.request_id ?? input.requestId);
	const status = safeHttpStatus(transport?.http_status);
	return {
		phase: input.phase,
		operation: input.operation,
		network_reached: responseReceived,
		http_response_received: responseReceived,
		protocol_handshake_verified: input.phase === "discovery",
		discovery_verified: false,
		...(requestId ? { request_id: requestId } : {}),
		...(status === undefined ? {} : { http_status: status }),
		...(responseReceived
			? { response_content_type: transport?.response_content_type == null ? null : safeContentType(transport.response_content_type) }
			: {}),
		...(transport?.response_kind ? { response_kind: transport.response_kind } : {}),
	};
}

export function typedGatewayObservation(phase: CealGatewayObservationPhase, response: { request_id?: unknown }): CealGatewayObservation {
	const requestId = safeRequestId(response.request_id);
	return {
		phase,
		operation: phase === "handshake" ? "handshake" : "discover",
		network_reached: true,
		http_response_received: true,
		protocol_handshake_verified: phase === "discovery",
		discovery_verified: false,
		...(requestId ? { request_id: requestId } : {}),
		response_kind: "typed_gateway_error",
	};
}

function safeRequestId(value: unknown): string | undefined {
	return typeof value === "string" && CEAL_SAFE_REQUEST_ID.test(value) ? value : undefined;
}

function safeHttpStatus(value: number | null | undefined): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

function safeContentType(value: string): string {
	return /^[\u0020-\u007e]{1,128}$/u.test(value) ? value.toLowerCase() : "unavailable";
}
