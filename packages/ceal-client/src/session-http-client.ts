import {
	CEAL_SESSION_CLIENT_MAX_RESPONSE_BYTES,
	declaresJsonContentType,
	readBoundedResponseBody,
	resolveSafeHttpEndpoint,
} from "./request-bounds.js";

type SessionHttpFailureCode = "invalid_response" | "request_failed" | "request_timeout";

interface SessionJsonExchangeOptions {
	endpoint: URL;
	fetchFn: typeof globalThis.fetch;
	timeoutMs: number;
	body: unknown;
	createError: (code: SessionHttpFailureCode) => Error;
	isClientError: (error: unknown) => boolean;
}

export interface SessionJsonResponse {
	readonly ok: boolean;
	readonly status: number;
	readonly value: unknown;
}

/**
 * One transport seam for the three public session-lifecycle clients. It owns
 * only their shared bounded JSON exchange; each caller keeps its protocol
 * decoder and any route-specific non-2xx meaning.
 */
export async function exchangeSessionJson(options: SessionJsonExchangeOptions): Promise<SessionJsonResponse> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs);
	const invalidResponse = (): never => {
		throw options.createError("invalid_response");
	};
	try {
		const response = await options.fetchFn(options.endpoint, {
			method: "POST",
			headers: { accept: "application/json", "content-type": "application/json" },
			body: JSON.stringify(options.body),
			redirect: "error",
			signal: controller.signal,
		});
		const bytes = await readBoundedResponseBody(response, CEAL_SESSION_CLIENT_MAX_RESPONSE_BYTES, "digits", invalidResponse);
		if (!declaresJsonContentType(response)) invalidResponse();
		let value: unknown;
		try {
			value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
		} catch {
			return invalidResponse();
		}
		return { ok: response.ok, status: response.status, value };
	} catch (error) {
		if (options.isClientError(error)) throw error;
		if (controller.signal.aborted) throw options.createError("request_timeout");
		throw options.createError("request_failed");
	} finally {
		clearTimeout(timer);
	}
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
