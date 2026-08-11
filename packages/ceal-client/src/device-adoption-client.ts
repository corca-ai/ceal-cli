import {
	CEAL_DEVICE_ENROLLMENT_POLL_SCHEMA,
	CEAL_DEVICE_ENROLLMENT_START_SCHEMA,
	type CealDeviceEnrollmentPollRequest,
	type CealDeviceEnrollmentPollResponse,
	type CealDeviceEnrollmentStartRequest,
	type CealDeviceEnrollmentStartResult,
	decodeCealDeviceEnrollmentPollResponse,
	decodeCealDeviceEnrollmentStartRequest,
	decodeCealDeviceEnrollmentStartResult,
} from "@corca-ai/ceal-protocol";
import { CEAL_SESSION_CLIENT_TIMEOUT_MS, resolveRequestBounds } from "./request-bounds.js";
import { exchangeSessionJson, resolveSessionEndpoint } from "./session-http-client.js";

// Transport for the two verified-email first-device adoption routes. It carries
// typed requests and hands back Gateway-decoded responses; every decision about
// what those responses mean belongs to the caller's state machine, because a
// transport that interprets `pending` or `failed` is one that can decide to
// retry something the operator never approved.
//
// The internal-product start route reports unavailable invitations explicitly.
// This transport preserves only its exact typed failure grammar; it never
// infers identity state from an arbitrary provider response.

export interface CealDeviceAdoptionClient {
	start(request: CealDeviceEnrollmentStartRequest): Promise<CealDeviceEnrollmentStartResult>;
	poll(request: CealDeviceEnrollmentPollRequest): Promise<CealDeviceEnrollmentPollResponse>;
}

export interface CreateCealDeviceAdoptionClientOptions {
	endpoint: string | URL;
	fetchFn?: typeof globalThis.fetch;
	timeoutMs?: number;
}

export class CealDeviceAdoptionClientError extends Error {
	override readonly name = "CealDeviceAdoptionClientError";
	constructor(
		readonly code:
			| "invalid_configuration"
			| "request_timeout"
			| "request_failed"
			| "invalid_response"
			| "adoption_not_available"
			| "gateway_unavailable"
			| "rate_limited",
	) {
		super(`Ceal device adoption ${code.replaceAll("_", " ")}.`);
	}
}

export function createCealDeviceAdoptionClient(options: CreateCealDeviceAdoptionClientOptions): CealDeviceAdoptionClient {
	const startEndpoint = resolveSessionEndpoint(options.endpoint, "adopt/start", () => fail("invalid_configuration"));
	const pollEndpoint = resolveSessionEndpoint(options.endpoint, "adopt/poll", () => fail("invalid_configuration"));
	const { fetchFn, timeoutMs } = resolveRequestBounds(options, CEAL_SESSION_CLIENT_TIMEOUT_MS, () => {
		throw new CealDeviceAdoptionClientError("invalid_configuration");
	});
	return {
		async start(request) {
			// Encoded through the Protocol decoder rather than sent as supplied, so
			// a malformed local request fails here instead of reaching the Gateway
			// with an email address attached to it.
			let body: CealDeviceEnrollmentStartRequest;
			try {
				body = decodeCealDeviceEnrollmentStartRequest({ ...request, schema_version: CEAL_DEVICE_ENROLLMENT_START_SCHEMA });
			} catch {
				throw new CealDeviceAdoptionClientError("invalid_configuration");
			}
			return decode(await exchange(startEndpoint, body, fetchFn, timeoutMs, true), decodeCealDeviceEnrollmentStartResult);
		},
		async poll(request) {
			if (!isPollRequest(request)) throw new CealDeviceAdoptionClientError("invalid_configuration");
			const body = { ...request, schema_version: CEAL_DEVICE_ENROLLMENT_POLL_SCHEMA };
			return decode(await exchange(pollEndpoint, body, fetchFn, timeoutMs, false), decodeCealDeviceEnrollmentPollResponse);
		},
	};
}

function isPollRequest(request: CealDeviceEnrollmentPollRequest): boolean {
	return (
		typeof request?.registration_ref === "string" &&
		typeof request?.nonce_ref === "string" &&
		typeof request?.signature === "string" &&
		request.signature.length > 0
	);
}

function decode<T>(parsed: unknown, decoder: (value: unknown) => T): T {
	try {
		return decoder(parsed);
	} catch {
		return fail("invalid_response");
	}
}

async function exchange(
	endpoint: URL,
	body: unknown,
	fetchFn: typeof globalThis.fetch,
	timeoutMs: number,
	allowStartFailure: boolean,
): Promise<unknown> {
	const response = await exchangeSessionJson({
		endpoint,
		fetchFn,
		timeoutMs,
		body,
		createError: (failure) => new CealDeviceAdoptionClientError(failure),
		isClientError: (error) => error instanceof CealDeviceAdoptionClientError,
	});
	if (!response.ok)
		throw allowStartFailure ? gatewayFailure(response.status, response.value) : new CealDeviceAdoptionClientError("invalid_response");
	return response.value;
}

function gatewayFailure(status: number, value: unknown): CealDeviceAdoptionClientError {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return new CealDeviceAdoptionClientError("invalid_response");
	const record = value as Record<string, unknown>;
	if (Object.keys(record).sort().join(",") !== "error_code,ok" || record.ok !== false)
		return new CealDeviceAdoptionClientError("invalid_response");
	if (status === 404 && record.error_code === "adoption_not_available") return new CealDeviceAdoptionClientError("adoption_not_available");
	if (status === 503 && record.error_code === "gateway_unavailable") return new CealDeviceAdoptionClientError("gateway_unavailable");
	if (status === 429 && record.error_code === "rate_limited") return new CealDeviceAdoptionClientError("rate_limited");
	return new CealDeviceAdoptionClientError("invalid_response");
}

function fail(code: "invalid_configuration" | "invalid_response"): never {
	throw new CealDeviceAdoptionClientError(code);
}
