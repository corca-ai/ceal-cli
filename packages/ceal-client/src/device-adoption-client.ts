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
import {
	CEAL_SESSION_CLIENT_MAX_RESPONSE_BYTES,
	CEAL_SESSION_CLIENT_TIMEOUT_MS,
	declaresJsonContentType,
	readBoundedResponseBody,
	resolveRequestBounds,
} from "./request-bounds.js";

// Transport for the two verified-email first-device adoption routes. It carries
// typed requests and hands back Gateway-decoded responses; every decision about
// what those responses mean belongs to the caller's state machine, because a
// transport that interprets `pending` or `failed` is one that can decide to
// retry something the operator never approved.
//
// The routes are non-enumerating by design: `start` answers the same pending
// shape whether or not the mailbox or invitation exists, so nothing here may
// turn a response into a claim about which accounts are real.

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
	constructor(readonly code: "invalid_configuration" | "request_timeout" | "request_failed" | "invalid_response") {
		super(`Ceal device adoption ${code.replaceAll("_", " ")}.`);
	}
}

export function createCealDeviceAdoptionClient(options: CreateCealDeviceAdoptionClientOptions): CealDeviceAdoptionClient {
	const startEndpoint = routeEndpoint(options.endpoint, "adopt/start");
	const pollEndpoint = routeEndpoint(options.endpoint, "adopt/poll");
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
			return decode(await exchange(startEndpoint, body, fetchFn, timeoutMs), decodeCealDeviceEnrollmentStartResult);
		},
		async poll(request) {
			if (!isPollRequest(request)) throw new CealDeviceAdoptionClientError("invalid_configuration");
			const body = { ...request, schema_version: CEAL_DEVICE_ENROLLMENT_POLL_SCHEMA };
			return decode(await exchange(pollEndpoint, body, fetchFn, timeoutMs), decodeCealDeviceEnrollmentPollResponse);
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
		throw new CealDeviceAdoptionClientError("invalid_response");
	}
}

async function exchange(endpoint: URL, body: unknown, fetchFn: typeof globalThis.fetch, timeoutMs: number): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchFn(endpoint, {
			method: "POST",
			headers: { accept: "application/json", "content-type": "application/json" },
			body: JSON.stringify(body),
			// A redirect on an adoption route would move a request carrying an
			// email address or a proof signature to an origin the caller never
			// pinned, so it is an error rather than something to follow.
			redirect: "error",
			signal: controller.signal,
		});
		const bytes = await readBoundedResponseBody(response, CEAL_SESSION_CLIENT_MAX_RESPONSE_BYTES, "digits", invalidResponse);
		if (!declaresJsonContentType(response)) invalidResponse();
		try {
			return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
		} catch {
			return invalidResponse();
		}
	} catch (error) {
		if (error instanceof CealDeviceAdoptionClientError) throw error;
		if (controller.signal.aborted) throw new CealDeviceAdoptionClientError("request_timeout");
		throw new CealDeviceAdoptionClientError("request_failed");
	} finally {
		clearTimeout(timer);
	}
}

// Same endpoint rules the enrollment client applies: no credentials in the URL,
// no query or fragment, and plaintext HTTP only against loopback, which is what
// keeps a test server usable without opening a downgrade for a real Gateway.
function routeEndpoint(value: string | URL, route: string): URL {
	let endpoint: URL;
	try {
		endpoint = new URL(value);
	} catch {
		throw new CealDeviceAdoptionClientError("invalid_configuration");
	}
	if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
		throw new CealDeviceAdoptionClientError("invalid_configuration");
	}
	const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
	if (endpoint.protocol === "http:" && host !== "127.0.0.1" && host !== "::1") {
		throw new CealDeviceAdoptionClientError("invalid_configuration");
	}
	if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
		throw new CealDeviceAdoptionClientError("invalid_configuration");
	}
	endpoint.pathname = `${endpoint.pathname.replace(/\/$/u, "")}/${route}`;
	return endpoint;
}

function invalidResponse(): never {
	throw new CealDeviceAdoptionClientError("invalid_response");
}
