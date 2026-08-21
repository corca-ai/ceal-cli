import {
	CEAL_SESSION_CLIENT_MAX_RESPONSE_BYTES,
	declaresJsonContentType,
	raceRequestDeadline,
	readBoundedResponseBody,
	resolveSafeHttpEndpoint,
} from "./request-bounds.js";
import { CEAL_SAFE_REF } from "./safe-ref.js";

type SessionHttpFailureCode = "invalid_response" | "request_failed" | "request_timeout";

const MAX_RESPONSE_BODY_KEYS = 32;
const SAFE_RESPONSE_BODY_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const CREDENTIAL_REF = /ceal_(?:personal|refresh|refresh_attempt)_[A-Za-z0-9_-]{43}/u;

type CealSessionResponseBodyKind =
	| "json_object"
	| "json_array"
	| "json_scalar"
	| "malformed_json"
	| "non_json"
	| "too_large";

export interface CealSessionResponseShape {
	readonly http_status: number;
	readonly content_type: string | null;
	readonly body_bytes: number | null;
	readonly body_kind: CealSessionResponseBodyKind;
	readonly body_keys: readonly string[];
	readonly body_keys_truncated: boolean;
	readonly schema_version: string | null;
	readonly ok: boolean | null;
	readonly error_code: string | null;
}

interface SessionJsonExchangeOptions {
	endpoint: URL;
	fetchFn: typeof globalThis.fetch;
	timeoutMs: number;
	body: unknown;
	createError: (code: SessionHttpFailureCode, responseShape?: CealSessionResponseShape) => Error;
	isClientError: (error: unknown) => boolean;
}

export interface SessionJsonResponse {
	readonly ok: boolean;
	readonly status: number;
	readonly value: unknown;
	readonly response_shape: CealSessionResponseShape;
}

/**
 * One transport seam for the three public session-lifecycle clients. It owns
 * only their shared bounded JSON exchange; each caller keeps its protocol
 * decoder and any route-specific non-2xx meaning.
 */
export async function exchangeSessionJson(options: SessionJsonExchangeOptions): Promise<SessionJsonResponse> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(options.createError("request_timeout"));
		}, options.timeoutMs);
	});
	const invalidResponse = (responseShape?: CealSessionResponseShape): never => {
		throw options.createError("invalid_response", responseShape);
	};
	try {
		const pendingResponse = options.fetchFn(options.endpoint, {
			method: "POST",
			headers: { accept: "application/json", "content-type": "application/json" },
			body: JSON.stringify(options.body),
			redirect: "error",
			signal: controller.signal,
		});
		const response = await raceRequestDeadline(pendingResponse, timeout);
		if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) invalidResponse();
		const baseShape = baseResponseShape(response);
		const pendingBody = readBoundedResponseBody(
			response,
			CEAL_SESSION_CLIENT_MAX_RESPONSE_BYTES,
			"digits",
			() => invalidResponse({ ...baseShape, body_kind: "malformed_json" }),
			() => invalidResponse({ ...baseShape, body_kind: "too_large" }),
		);
		const bytes = await raceRequestDeadline(pendingBody, timeout);
		if (!declaresJsonContentType(response)) invalidResponse(responseShape(baseShape, "non_json", bytes.byteLength));
		let value: unknown;
		try {
			value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
		} catch {
			return invalidResponse(responseShape(baseShape, "malformed_json", bytes.byteLength));
		}
		const shape = responseShape(baseShape, bodyKind(value), bytes.byteLength, value);
		return { ok: response.ok, status: response.status, value, response_shape: shape };
	} catch (error) {
		if (options.isClientError(error)) throw error;
		if (controller.signal.aborted) throw options.createError("request_timeout");
		throw options.createError("request_failed");
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

/** Decodes one lifecycle response while refusing a success body carried on a non-success HTTP status. */
export function decodeSessionProtocolResponse<T extends { readonly ok: boolean }>(
	response: SessionJsonResponse,
	decoder: (value: unknown) => T,
	invalidResponse: (responseShape: CealSessionResponseShape) => never,
): T {
	let decoded: T;
	try {
		decoded = decoder(response.value);
	} catch {
		return invalidResponse(response.response_shape);
	}
	if (!response.ok && decoded.ok) return invalidResponse(response.response_shape);
	return decoded;
}

function baseResponseShape(response: Response): CealSessionResponseShape {
	return {
		http_status: response.status,
		content_type: safeContentType(response.headers.get("content-type")),
		body_bytes: null,
		body_kind: "too_large",
		body_keys: [],
		body_keys_truncated: false,
		schema_version: null,
		ok: null,
		error_code: null,
	};
}

function responseShape(
	base: CealSessionResponseShape,
	kind: CealSessionResponseBodyKind,
	bodyBytes: number,
	value?: unknown,
): CealSessionResponseShape {
	const record = value !== undefined && isJsonRecord(value) ? value : undefined;
	const rawKeys = record ? Object.keys(record) : [];
	return {
		...base,
		body_bytes: bodyBytes,
		body_kind: kind,
		body_keys: rawKeys
			.slice(0, MAX_RESPONSE_BODY_KEYS)
			.filter((key) => SAFE_RESPONSE_BODY_KEY.test(key) && !CREDENTIAL_REF.test(key)),
		body_keys_truncated: rawKeys.length > MAX_RESPONSE_BODY_KEYS,
		schema_version: record ? safeResponseMetadata(record.schema_version) : null,
		ok: record && typeof record.ok === "boolean" ? record.ok : null,
		error_code: record ? safeResponseMetadata(record.error_code) : null,
	};
}

function bodyKind(value: unknown): CealSessionResponseBodyKind {
	if (Array.isArray(value)) return "json_array";
	if (value !== null && typeof value === "object") return "json_object";
	return "json_scalar";
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeResponseMetadata(value: unknown): string | null {
	return typeof value === "string" && CEAL_SAFE_REF.test(value) && !CREDENTIAL_REF.test(value) ? value : null;
}

function safeContentType(value: string | null): string | null {
	if (value === null) return null;
	// @separateGrammar: the session diagnostic contract emits null when the header is unavailable.
	return /^[\u0020-\u007e]{1,128}$/u.test(value) && !CREDENTIAL_REF.test(value) ? value.toLowerCase() : null;
}

/**
 * The shared URL authority boundary for session-lifecycle routes. A route is
 * appended only after the origin is proven credential-free and HTTPS (or
 * loopback HTTP for local verification).
 */
export function resolveSessionEndpoint(value: string | URL, route: string, invalidConfiguration: () => never): URL {
	const endpoint = resolveSafeHttpEndpoint(value, invalidConfiguration);
	endpoint.pathname = `${endpoint.pathname.replace(/\/$/u, "")}/${route}`;
	return endpoint;
}
