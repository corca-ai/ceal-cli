import { CEAL_ENROLLMENT_EXCHANGE_SCHEMA, type CealEnrollmentResponse, decodeCealEnrollmentResponse } from "@corca-ai/ceal-protocol";
import {
	CEAL_SESSION_CLIENT_MAX_RESPONSE_BYTES,
	CEAL_SESSION_CLIENT_TIMEOUT_MS,
	declaresJsonContentType,
	readBoundedResponseBody,
	resolveRequestBounds,
} from "./request-bounds.js";
import { CEAL_CLIENT_VERSION } from "./version.js";

export interface CealEnrollmentClient {
	exchange(code: string): Promise<CealEnrollmentResponse>;
}

export interface CreateCealEnrollmentClientOptions {
	endpoint: string | URL;
	fetchFn?: typeof globalThis.fetch;
	timeoutMs?: number;
}

export class CealEnrollmentClientError extends Error {
	override readonly name = "CealEnrollmentClientError";
	constructor(readonly code: "invalid_configuration" | "request_timeout" | "request_failed" | "invalid_response") {
		super(`Ceal enrollment ${code.replaceAll("_", " ")}.`);
	}
}

export function createCealEnrollmentClient(options: CreateCealEnrollmentClientOptions): CealEnrollmentClient {
	const endpoint = enrollmentEndpoint(options.endpoint);
	const { fetchFn, timeoutMs } = resolveRequestBounds(options, CEAL_SESSION_CLIENT_TIMEOUT_MS, () => {
		throw new CealEnrollmentClientError("invalid_configuration");
	});
	return {
		async exchange(code) {
			if (!/^[A-Za-z0-9_-]{32,256}$/u.test(code)) throw new CealEnrollmentClientError("invalid_configuration");
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await fetchFn(endpoint, {
					method: "POST",
					headers: { accept: "application/json", "content-type": "application/json" },
					body: JSON.stringify({
						schema_version: CEAL_ENROLLMENT_EXCHANGE_SCHEMA,
						code,
						client: { name: "ceal", version: CEAL_CLIENT_VERSION },
					}),
					redirect: "error",
					signal: controller.signal,
				});
				const bytes = await readBoundedResponseBody(response, CEAL_SESSION_CLIENT_MAX_RESPONSE_BYTES, invalidResponse);
				if (!declaresJsonContentType(response)) invalidResponse();
				let parsed: unknown;
				try {
					parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
				} catch {
					invalidResponse();
				}
				try {
					return decodeCealEnrollmentResponse(parsed);
				} catch {
					invalidResponse();
				}
			} catch (error) {
				if (error instanceof CealEnrollmentClientError) throw error;
				if (controller.signal.aborted) throw new CealEnrollmentClientError("request_timeout");
				throw new CealEnrollmentClientError("request_failed");
			} finally {
				clearTimeout(timer);
			}
		},
	};
}

function enrollmentEndpoint(value: string | URL): URL {
	let endpoint: URL;
	try {
		endpoint = new URL(value);
	} catch {
		throw new CealEnrollmentClientError("invalid_configuration");
	}
	if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
		throw new CealEnrollmentClientError("invalid_configuration");
	}
	const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
	if (endpoint.protocol === "http:" && host !== "127.0.0.1" && host !== "::1") {
		throw new CealEnrollmentClientError("invalid_configuration");
	}
	if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
		throw new CealEnrollmentClientError("invalid_configuration");
	}
	endpoint.pathname = `${endpoint.pathname.replace(/\/$/u, "")}/enroll`;
	return endpoint;
}

function invalidResponse(): never {
	throw new CealEnrollmentClientError("invalid_response");
}
