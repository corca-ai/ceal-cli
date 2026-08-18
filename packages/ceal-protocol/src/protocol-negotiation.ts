import { CEAL_PROTOCOL_VERSION } from "./gateway-response-types.ts";

export const CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE = Object.freeze({
	minimum: CEAL_PROTOCOL_VERSION,
	maximum: CEAL_PROTOCOL_VERSION,
});

export interface CealProtocolNegotiationSuccess {
	schema_version: "ceal.protocol_negotiation.v1";
	ok: true;
	protocol_version: typeof CEAL_PROTOCOL_VERSION;
}

export interface CealProtocolNegotiationFailure {
	schema_version: "ceal.protocol_negotiation.v1";
	ok: false;
	error: {
		code: "invalid_gateway_protocol_range" | "incompatible_protocol";
		message: string;
		next_action: string;
	};
}

export type CealProtocolNegotiation = CealProtocolNegotiationSuccess | CealProtocolNegotiationFailure;
type ParsedProtocolVersion = readonly [number, number, number];

export function negotiateCealProtocol(gatewayRange: unknown): CealProtocolNegotiation {
	const parsedRange = parseProtocolRange(gatewayRange);
	if (!parsedRange || compareProtocolVersions(parsedRange.minimum, parsedRange.maximum) > 0) {
		return failure(
			"invalid_gateway_protocol_range",
			"The Gateway advertised an invalid Ceal protocol range.",
			"Inspect the Gateway release metadata and retry with a valid minimum and maximum protocol version.",
		);
	}
	const current = parseProtocolVersion(CEAL_PROTOCOL_VERSION);
	if (!current || compareProtocolVersions(parsedRange.minimum, current) > 0 || compareProtocolVersions(current, parsedRange.maximum) > 0) {
		return failure(
			"incompatible_protocol",
			"The Ceal client and Gateway do not share an implemented protocol version.",
			"Upgrade the Ceal client or Gateway to releases with overlapping protocol support.",
		);
	}
	return { schema_version: "ceal.protocol_negotiation.v1", ok: true, protocol_version: CEAL_PROTOCOL_VERSION };
}

function parseProtocolRange(value: unknown): { minimum: ParsedProtocolVersion; maximum: ParsedProtocolVersion } | null {
	if (!value || typeof value !== "object") return null;
	const range = value as Record<string, unknown>;
	const minimum = parseProtocolVersion(range.minimum);
	const maximum = parseProtocolVersion(range.maximum);
	return minimum && maximum ? { minimum, maximum } : null;
}

export function parseProtocolVersion(value: unknown): ParsedProtocolVersion | null {
	if (typeof value !== "string") return null;
	const match = /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/u.exec(value);
	if (!match) return null;
	const parsed = match.slice(1).map(Number);
	return parsed.some((part) => !Number.isSafeInteger(part)) ? null : parsed as unknown as ParsedProtocolVersion;
}

function compareProtocolVersions(left: ParsedProtocolVersion, right: ParsedProtocolVersion): number {
	for (let index = 0; index < left.length; index += 1) {
		const leftPart = left[index];
		const rightPart = right[index];
		if (leftPart === undefined || rightPart === undefined) return 0;
		if (leftPart !== rightPart) return leftPart - rightPart;
	}
	return 0;
}

function failure(
	code: CealProtocolNegotiationFailure["error"]["code"], message: string, nextAction: string,
): CealProtocolNegotiationFailure {
	return { schema_version: "ceal.protocol_negotiation.v1", ok: false, error: { code, message, next_action: nextAction } };
}
