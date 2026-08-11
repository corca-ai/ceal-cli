import {
	ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS,
	CEAL_GATEWAY_ADDITIVE_DECODE_GENERATION,
	CEAL_GATEWAY_DECODE_GENERATION_HEADER,
	type CealGatewayRequest,
	type CealGatewayResponseFor,
	decodeCealClientResponse,
	decodeCealGatewayRequest,
} from "@corca-ai/ceal-protocol";
import {
	acceptsJsonMediaType,
	CEAL_MAX_CONFIGURED_TIMEOUT_MS,
	raceRequestDeadline,
	readBoundedResponseBody,
	resolveSafeHttpEndpoint,
} from "./request-bounds.js";

export type CealHttpTransportErrorCode =
	| "invalid_configuration"
	| "invalid_request"
	| "request_timeout"
	| "request_failed"
	| "response_too_large"
	| "invalid_response";

export class CealHttpTransportError extends Error {
	override readonly name = "CealHttpTransportError";

	constructor(
		readonly code: CealHttpTransportErrorCode,
		readonly http_status: number | null = null,
	) {
		super(transportErrorMessage(code));
	}
}

export interface CreateCealHttpTransportOptions {
	endpoint: string | URL;
	accessToken: string;
	fetchFn?: typeof globalThis.fetch;
	timeoutMs?: number;
	maxResponseBytes?: number;
}

export interface CealClientTransport {
	send<R extends CealGatewayRequest>(request: Readonly<R>): Promise<CealGatewayResponseFor<R>>;
}

/**
 * @deprecated The generic transport now declares the Protocol-owned additive
 * decode generation. Kept as a compatibility export for callers that inspect
 * the former per-field negotiation surface.
 */
export const CEAL_GATEWAY_PROFILES_ACCEPT_HEADER = ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS.profiles.legacyAcceptHeader;

/** @deprecated Use the additive decode generation negotiated by the generic transport. */
export const CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER = ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS.route_provenance.legacyAcceptHeader;

/** @deprecated Use the additive decode generation negotiated by the generic transport. */
export const CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER = ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS.audit_timing.legacyAcceptHeader;

const CEAL_GATEWAY_RECOVERY_ACCEPT_HEADER = ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS.recovery.legacyAcceptHeader;
const CEAL_GATEWAY_RATE_LIMIT_POLICY_ACCEPT_HEADER = ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS.rate_limit_policy.legacyAcceptHeader;

const TRANSITIONAL_LEGACY_ACCEPT_HEADERS = Object.freeze({
	[CEAL_GATEWAY_RECOVERY_ACCEPT_HEADER]: "accept",
	[CEAL_GATEWAY_RATE_LIMIT_POLICY_ACCEPT_HEADER]: "accept",
	[CEAL_GATEWAY_PROFILES_ACCEPT_HEADER]: "accept",
	[CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER]: "accept",
});

// Capability calls can legitimately traverse a bounded provider page before
// the Gateway serializes its minimized result. Ten seconds cut off a completed
// Gateway call just before its response reached an agent, so keep the default
// below the shared two-minute hard cap while leaving room for that bounded
// read path and ordinary cold-start latency.
export const CEAL_DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

const MAX_CONFIGURED_RESPONSE_BYTES = 1024 * 1024;

export function createCealHttpTransport(options: CreateCealHttpTransportOptions): CealClientTransport {
	const endpoint = resolveSafeHttpEndpoint(options.endpoint, () => {
		throw new CealHttpTransportError("invalid_configuration");
	});
	const accessToken = validateAccessToken(options.accessToken);
	const fetchFn = options.fetchFn ?? globalThis.fetch;
	if (typeof fetchFn !== "function") throw new CealHttpTransportError("invalid_configuration");
	const timeoutMs = boundedInteger(options.timeoutMs ?? CEAL_DEFAULT_HTTP_TIMEOUT_MS, 1, CEAL_MAX_CONFIGURED_TIMEOUT_MS);
	const maxResponseBytes = boundedInteger(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 1, MAX_CONFIGURED_RESPONSE_BYTES);

	return {
		async send<R extends CealGatewayRequest>(request: Readonly<R>): Promise<CealGatewayResponseFor<R>> {
			let wireRequest: R;
			try {
				wireRequest = decodeCealGatewayRequest(request) as R;
			} catch {
				throw new CealHttpTransportError("invalid_request");
			}
			const controller = new AbortController();
			let timeoutId: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<never>((_resolve, reject) => {
				timeoutId = setTimeout(() => {
					controller.abort();
					reject(new CealHttpTransportError("request_timeout"));
				}, timeoutMs);
			});
			try {
				const pendingResponse = fetchFn(endpoint, {
					method: "POST",
					headers: {
						accept: "application/json",
						authorization: `Bearer ${accessToken}`,
						"content-type": "application/json",
						[CEAL_GATEWAY_DECODE_GENERATION_HEADER]: CEAL_GATEWAY_ADDITIVE_DECODE_GENERATION,
						// Keep the former per-field opt-ins for rolling operation with
						// Gateways that predate the decode-generation contract. Their
						// literals derive from the Protocol registry above.
						...TRANSITIONAL_LEGACY_ACCEPT_HEADERS,
						// Audit event timing is an additive strict-decoder field. It only
						// has meaning on readback, so keep the wire negotiation scoped to
						// that operation rather than expanding every Gateway request.
						...(wireRequest.operation === "readback" ? { [CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER]: "accept" } : {}),
					},
					body: JSON.stringify(wireRequest),
					redirect: "error",
					signal: controller.signal,
				});
				const response = await raceRequestDeadline(pendingResponse, timeout);
				const bytes = await raceRequestDeadline(readBoundedResponse(response, maxResponseBytes), timeout);
				const decoded = decodeResponse<R>(bytes, response.headers.get("content-type"), wireRequest, response.status);
				if (!response.ok && decoded.ok) throw new CealHttpTransportError("invalid_response", response.status);
				return decoded;
			} catch (error) {
				if (error instanceof CealHttpTransportError) throw error;
				throw new CealHttpTransportError("request_failed");
			} finally {
				if (timeoutId !== undefined) clearTimeout(timeoutId);
			}
		},
	};
}

function readBoundedResponse(response: Response, maximum: number): Promise<Uint8Array> {
	return readBoundedResponseBody(
		response,
		maximum,
		"safe_integer",
		() => {
			throw new CealHttpTransportError("invalid_response", response.status);
		},
		() => {
			throw new CealHttpTransportError("response_too_large", response.status);
		},
	);
}

function decodeResponse<R extends CealGatewayRequest>(
	bytes: Uint8Array,
	contentType: string | null,
	request: Readonly<R>,
	status: number,
): CealGatewayResponseFor<R> {
	if (!acceptsJsonMediaType(contentType, true)) {
		throw new CealHttpTransportError("invalid_response", status);
	}
	let value: unknown;
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		value = JSON.parse(text);
		return decodeCealClientResponse<R>(value, request);
	} catch {
		throw new CealHttpTransportError("invalid_response", status);
	}
}

function validateAccessToken(value: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 4096 || hasTokenWhitespace(value)) {
		throw new CealHttpTransportError("invalid_configuration");
	}
	return value;
}

function hasTokenWhitespace(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code <= 32 || code === 127;
	});
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new CealHttpTransportError("invalid_configuration");
	return value;
}

function transportErrorMessage(code: CealHttpTransportErrorCode): string {
	switch (code) {
		case "invalid_configuration":
			return "Ceal HTTP transport configuration is invalid.";
		case "invalid_request":
			return "Ceal HTTP transport request is invalid.";
		case "request_timeout":
			return "Ceal HTTP transport request timed out.";
		case "request_failed":
			return "Ceal HTTP transport request failed.";
		case "response_too_large":
			return "Ceal HTTP transport response exceeded the configured limit.";
		case "invalid_response":
			return "Ceal HTTP transport received an invalid response.";
	}
}
