import {
	ADDITIVE_NON_AUTHORITY_RESPONSE_FIELDS,
	CEAL_GATEWAY_ADDITIVE_DECODE_GENERATION,
	CEAL_GATEWAY_DECODE_GENERATION_HEADER,
	CEAL_PROTOCOL_VERSION,
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

/** Bounded response-shape facts safe for an operator-facing diagnostic. */
export type CealHttpResponseKind =
	| "content_type_invalid"
	| "body_malformed"
	| "protocol_invalid"
	| "unexpected_success_status"
	| "response_too_large";

/** Bounded shape fact for a JSON response that failed Protocol validation. */
export type CealHttpResponseEnvelopeKind = "success" | "failure" | "unknown";

/** A known, bounded response-shape mismatch that needs Gateway-side repair. */
export type CealHttpResponseShapeIssue = "discovery_target_catalog_incomplete_without_cursor";

export interface CealHttpTransportErrorDetails {
	request_id?: string | null;
	operation?: CealGatewayRequest["operation"] | null;
	response_content_type?: string | null;
	response_kind?: CealHttpResponseKind | null;
	response_protocol_version?: string | null;
	response_schema_version?: string | null;
	response_envelope_kind?: CealHttpResponseEnvelopeKind;
	response_error_code?: string | null;
	response_shape_issue?: CealHttpResponseShapeIssue;
}

export class CealHttpTransportError extends Error {
	override readonly name = "CealHttpTransportError";
	readonly code: CealHttpTransportErrorCode;
	readonly http_status: number | null;
	readonly request_id: string | null;
	readonly operation: CealGatewayRequest["operation"] | null;
	readonly response_content_type: string | null;
	readonly response_kind: CealHttpResponseKind | null;
	readonly response_protocol_version: string | null | undefined;
	readonly response_schema_version: string | null | undefined;
	readonly response_envelope_kind: CealHttpResponseEnvelopeKind | undefined;
	readonly response_error_code: string | null | undefined;
	readonly response_shape_issue: CealHttpResponseShapeIssue | undefined;

	constructor(code: CealHttpTransportErrorCode, http_status: number | null = null, details: CealHttpTransportErrorDetails = {}) {
		super(transportErrorMessage(code));
		this.code = code;
		this.http_status = http_status;
		this.request_id = details.request_id ?? null;
		this.operation = details.operation ?? null;
		this.response_content_type = details.response_content_type ?? null;
		this.response_kind = details.response_kind ?? null;
		this.response_protocol_version = details.response_protocol_version;
		this.response_schema_version = details.response_schema_version;
		this.response_envelope_kind = details.response_envelope_kind;
		this.response_error_code = details.response_error_code;
		this.response_shape_issue = details.response_shape_issue;
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
				const responseContentType = response.headers.get("content-type");
				const bytes = await raceRequestDeadline(readBoundedResponse(response, maxResponseBytes, wireRequest, responseContentType), timeout);
				const decoded = decodeResponse<R>(bytes, responseContentType, wireRequest, response.status);
				if (!response.ok && decoded.ok)
					throw new CealHttpTransportError("invalid_response", response.status, {
						request_id: wireRequest.request_id,
						operation: wireRequest.operation,
						response_content_type: responseContentType,
						response_kind: "unexpected_success_status",
					});
				return decoded;
			} catch (error) {
				if (error instanceof CealHttpTransportError) throw error;
				if (controller.signal.aborted)
					throw new CealHttpTransportError("request_timeout", null, {
						request_id: wireRequest.request_id,
						operation: wireRequest.operation,
					});
				throw new CealHttpTransportError("request_failed", null, {
					request_id: wireRequest.request_id,
					operation: wireRequest.operation,
				});
			} finally {
				if (timeoutId !== undefined) clearTimeout(timeoutId);
			}
		},
	};
}

function readBoundedResponse(
	response: Response,
	maximum: number,
	request: CealGatewayRequest,
	contentType: string | null,
): Promise<Uint8Array> {
	return readBoundedResponseBody(
		response,
		maximum,
		"safe_integer",
		() => {
			throw new CealHttpTransportError("invalid_response", response.status, {
				request_id: request.request_id,
				operation: request.operation,
				response_content_type: contentType,
				response_kind: "body_malformed",
			});
		},
		() => {
			throw new CealHttpTransportError("response_too_large", response.status, {
				request_id: request.request_id,
				operation: request.operation,
				response_content_type: contentType,
				response_kind: "response_too_large",
			});
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
		throw new CealHttpTransportError("invalid_response", status, {
			request_id: request.request_id,
			operation: request.operation,
			response_content_type: contentType,
			response_kind: "content_type_invalid",
		});
	}
	let value: unknown;
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		value = JSON.parse(text);
	} catch {
		throw invalidResponseError(request, status, contentType, "body_malformed");
	}
	const metadata = captureResponseMetadata(value, request.operation);
	try {
		return decodeCealClientResponse<R>(value, request);
	} catch {
		throw invalidResponseError(request, status, contentType, "protocol_invalid", metadata);
	}
}

function invalidResponseError(
	request: Readonly<CealGatewayRequest>,
	status: number,
	contentType: string | null,
	responseKind: CealHttpResponseKind,
	metadata: ResponseMetadata = {},
): CealHttpTransportError {
	return new CealHttpTransportError("invalid_response", status, {
		request_id: request.request_id,
		operation: request.operation,
		response_content_type: contentType,
		response_kind: responseKind,
		...metadata,
	});
}

type ResponseMetadata = {
	response_protocol_version?: string | null;
	response_schema_version?: string | null;
	response_envelope_kind?: CealHttpResponseEnvelopeKind;
	response_error_code?: string | null;
	response_shape_issue?: CealHttpResponseShapeIssue;
};

function captureResponseMetadata(value: unknown, operation: CealGatewayRequest["operation"]): ResponseMetadata {
	const protocolVersion = safeResponseMetadata(value, ["protocol_version", "negotiated_protocol_version"]);
	const schemaVersion = safeResponseMetadata(value, ["schema_version"]);
	const nestedSchemaVersion = schemaVersion === undefined ? safeResponseMetadata(responseValue(value), ["schema_version"]) : undefined;
	const record = responseRecord(value);
	const hasError = record !== undefined && Object.hasOwn(record, "error");
	const shapeIssue = responseShapeIssue(value, operation);
	return {
		...(protocolVersion !== undefined
			? { response_protocol_version: protocolVersion }
			: record !== undefined ? { response_protocol_version: null } : {}),
		...(schemaVersion !== undefined
			? { response_schema_version: schemaVersion }
			: nestedSchemaVersion !== undefined
				? { response_schema_version: nestedSchemaVersion }
				: record !== undefined ? { response_schema_version: null } : {}),
		...(record ? { response_envelope_kind: responseEnvelopeKind(record) } : {}),
		...(hasError ? { response_error_code: safeResponseMetadata(record.error, ["code"]) ?? null } : {}),
		...(shapeIssue ? { response_shape_issue: shapeIssue } : {}),
	};
}

function safeResponseMetadata(value: unknown, keys: readonly string[]): string | null | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	for (const key of keys) {
		if (!Object.hasOwn(record, key)) continue;
		const candidate = record[key];
		return typeof candidate === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate) ? candidate : null;
	}
	return undefined;
}

function responseRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function responseValue(value: unknown): unknown {
	return responseRecord(value)?.value;
}

function responseEnvelopeKind(record: Record<string, unknown>): CealHttpResponseEnvelopeKind {
	if (record.ok === true) return "success";
	if (record.ok === false) return "failure";
	return "unknown";
}

function responseShapeIssue(value: unknown, operation: CealGatewayRequest["operation"]): CealHttpResponseShapeIssue | undefined {
	if (operation !== "discover") return undefined;
	const response = responseRecord(value);
	const discovery = response?.ok === true ? responseRecord(response.value) : undefined;
	if (
		discovery?.schema_version !== "ceal.gateway_discovery.v3" ||
		discovery?.phase === "capability_index" ||
		response?.protocol_version !== CEAL_PROTOCOL_VERSION
	)
		return undefined;
	const catalog = responseRecord(discovery?.target_catalog);
	if (
		typeof catalog?.target_count === "number"
		&& Number.isSafeInteger(catalog.target_count)
		&& catalog.target_count > 0
		&& catalog.returned_count === 0
		&& catalog.complete === false
		&& (catalog.next_cursor === undefined || catalog.next_cursor === null)
	) return "discovery_target_catalog_incomplete_without_cursor";
	return undefined;
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
