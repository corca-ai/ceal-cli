import { CEAL_ENROLLMENT_EXCHANGE_SCHEMA, type CealEnrollmentResponse, decodeCealEnrollmentResponse } from "@corca-ai/ceal-protocol";
import { CEAL_SESSION_CLIENT_TIMEOUT_MS, resolveRequestBounds } from "./request-bounds.js";
import { decodeSessionProtocolResponse, exchangeSessionJson, resolveSessionEndpoint } from "./session-http-client.js";
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
	readonly code: "invalid_configuration" | "request_timeout" | "request_failed" | "invalid_response";
	constructor(code: CealEnrollmentClientError["code"]) {
		super(`Ceal enrollment ${code.replaceAll("_", " ")}.`);
		this.code = code;
	}
}

export function createCealEnrollmentClient(options: CreateCealEnrollmentClientOptions): CealEnrollmentClient {
	const endpoint = resolveSessionEndpoint(options.endpoint, "enroll", () => fail("invalid_configuration"));
	const { fetchFn, timeoutMs } = resolveRequestBounds(options, CEAL_SESSION_CLIENT_TIMEOUT_MS, () => {
		throw new CealEnrollmentClientError("invalid_configuration");
	});
	return {
		async exchange(code) {
			if (!/^[A-Za-z0-9_-]{32,256}$/u.test(code)) throw new CealEnrollmentClientError("invalid_configuration");
			const response = await exchangeSessionJson({
				endpoint,
				fetchFn,
				timeoutMs,
				body: {
					schema_version: CEAL_ENROLLMENT_EXCHANGE_SCHEMA,
					code,
					client: { name: "ceal", version: CEAL_CLIENT_VERSION },
				},
				createError: (failure) => new CealEnrollmentClientError(failure),
				isClientError: (error) => error instanceof CealEnrollmentClientError,
			});
			return decodeSessionProtocolResponse(response, decodeCealEnrollmentResponse, () => fail("invalid_response"));
		},
	};
}

function fail(code: "invalid_configuration" | "invalid_response"): never {
	throw new CealEnrollmentClientError(code);
}
