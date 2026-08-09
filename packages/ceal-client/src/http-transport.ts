import {
	type CealGatewayRequest,
	type CealGatewayResponseFor,
	decodeCealClientResponse,
	decodeCealGatewayRequest,
} from "@corca-ai/ceal-protocol";
import { CEAL_MAX_CONFIGURED_TIMEOUT_MS, readBoundedResponseBody } from "./request-bounds.js";

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
 * Negotiation header declaring that this client tolerates the optional
 * eligible-Profile catalog on the handshake. The Gateway emits the catalog only
 * when it reads exactly `accept` here, because the 1.3.0 handshake decoder is
 * exact-keys strict. The literal is the wire contract owned by the server; a
 * client cannot import it, so a golden-value test pins this constant to it.
 */
export const CEAL_GATEWAY_PROFILES_ACCEPT_HEADER = "x-ceal-profiles";

/** Negotiates the optional safe connector-route failure audit projection. */
export const CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER = "x-ceal-route-provenance";

/** Negotiates the optional bounded Gateway handling time on audit readback. */
export const CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER = "x-ceal-audit-timing";

// Capability calls can legitimately traverse a bounded provider page before
// the Gateway serializes its minimized result. Ten seconds cut off a completed
// Gateway call just before its response reached an agent, so keep the default
// below the shared two-minute hard cap while leaving room for that bounded
// read path and ordinary cold-start latency.
export const CEAL_DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

const MAX_CONFIGURED_RESPONSE_BYTES = 1024 * 1024;

export function createCealHttpTransport(options: CreateCealHttpTransportOptions): CealClientTransport {
	const endpoint = validateEndpoint(options.endpoint);
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
						// This transport ships with the recovery-tolerant failure
						// decoder, so it may declare acceptance of typed
						// `error.recovery`; the Gateway never sends the field to a
						// client that does not.
						"x-ceal-recovery": "accept",
						// The handshake decoder now tolerates the optional
						// eligible-Profile catalog, so negotiate for it here; the
						// Gateway omits the field for a client that does not.
						[CEAL_GATEWAY_PROFILES_ACCEPT_HEADER]: "accept",
						[CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER]: "accept",
						// Audit event timing is an additive strict-decoder field. It only
						// has meaning on readback, so keep the wire negotiation scoped to
						// that operation rather than expanding every Gateway request.
						...(wireRequest.operation === "readback" ? { [CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER]: "accept" } : {}),
					},
					body: JSON.stringify(wireRequest),
					redirect: "error",
					signal: controller.signal,
				});
				pendingResponse.catch(() => undefined);
				const response = await Promise.race([pendingResponse, timeout]);
				const bytes = await Promise.race([readBoundedResponse(response, maxResponseBytes), timeout]);
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
	if (!contentType || !/(?:^|\s|;)application\/(?:[a-z0-9.+-]+[+]json|json)(?:\s*;|\s*$)/iu.test(contentType)) {
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

function validateEndpoint(value: string | URL): URL {
	let endpoint: URL;
	try {
		endpoint = new URL(value);
	} catch {
		throw new CealHttpTransportError("invalid_configuration");
	}
	if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new CealHttpTransportError("invalid_configuration");
	if (endpoint.protocol === "http:" && !isLoopbackHost(endpoint.hostname)) throw new CealHttpTransportError("invalid_configuration");
	if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") throw new CealHttpTransportError("invalid_configuration");
	return endpoint;
}

function isLoopbackHost(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
	return normalized === "127.0.0.1" || normalized === "::1";
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
