import { CEAL_SESSION_CLIENT_TIMEOUT_MS, resolveRequestBounds } from "./request-bounds.js";
import { decodeSessionProtocolResponse, exchangeSessionJson, resolveSessionEndpoint } from "./session-http-client.js";
import { CEAL_CLIENT_VERSION } from "./version.js";
import {
	CEAL_CLIENT_REFRESH_REQUEST_SCHEMA,
	CEAL_CLIENT_REVOKE_REQUEST_SCHEMA,
	type CealClientRefreshResponse,
	type CealClientRevokeResponse,
	decodeCealClientRefreshResponse,
	decodeCealClientRevokeResponse,
} from "@corca-ai/ceal-protocol";

export interface CealPersonalClientSessionClient {
	refresh(refreshToken: string): Promise<CealClientRefreshResponse>;
	revoke(refreshToken: string): Promise<CealClientRevokeResponse>;
}

export interface CreateCealPersonalClientSessionClientOptions {
	endpoint: string | URL;
	fetchFn?: typeof globalThis.fetch;
	timeoutMs?: number;
}

export class CealPersonalClientSessionError extends Error {
	override readonly name = "CealPersonalClientSessionError";
	readonly code: "invalid_configuration" | "request_timeout" | "request_failed" | "invalid_response";
	constructor(code: CealPersonalClientSessionError["code"]) {
		super(`Ceal personal-client session ${code.replaceAll("_", " ")}.`);
		this.code = code;
	}
}

const REFRESH_TOKEN = /^ceal_refresh_[A-Za-z0-9_-]{43}$/u;

export function createCealPersonalClientSessionClient(
	options: CreateCealPersonalClientSessionClientOptions,
): CealPersonalClientSessionClient {
	const refreshEndpoint = resolveSessionEndpoint(options.endpoint, "refresh", () => fail("invalid_configuration"));
	const revokeEndpoint = resolveSessionEndpoint(options.endpoint, "revoke", () => fail("invalid_configuration"));
	const { fetchFn, timeoutMs } = resolveRequestBounds(options, CEAL_SESSION_CLIENT_TIMEOUT_MS, () => {
		throw new CealPersonalClientSessionError("invalid_configuration");
	});
	return {
		refresh: (refreshToken) =>
			requestSession({
				endpoint: refreshEndpoint,
				fetchFn,
				timeoutMs,
				refreshToken,
				body: {
					schema_version: CEAL_CLIENT_REFRESH_REQUEST_SCHEMA,
					refresh_token: refreshToken,
					client: { name: "ceal", version: CEAL_CLIENT_VERSION },
				},
				decode: decodeCealClientRefreshResponse,
			}),
		revoke: (refreshToken) =>
			requestSession({
				endpoint: revokeEndpoint,
				fetchFn,
				timeoutMs,
				refreshToken,
				body: { schema_version: CEAL_CLIENT_REVOKE_REQUEST_SCHEMA, refresh_token: refreshToken },
				decode: decodeCealClientRevokeResponse,
			}),
	};
}

async function requestSession<T extends { readonly ok: boolean }>(input: {
	endpoint: URL;
	fetchFn: typeof globalThis.fetch;
	timeoutMs: number;
	refreshToken: string;
	body: Record<string, unknown>;
	decode: (value: unknown) => T;
}): Promise<T> {
	if (!REFRESH_TOKEN.test(input.refreshToken)) throw new CealPersonalClientSessionError("invalid_configuration");
	const response = await exchangeSessionJson({
		endpoint: input.endpoint,
		fetchFn: input.fetchFn,
		timeoutMs: input.timeoutMs,
		body: input.body,
		createError: (failure) => new CealPersonalClientSessionError(failure),
		isClientError: (error) => error instanceof CealPersonalClientSessionError,
	});
	return decodeSessionProtocolResponse(response, input.decode, () => fail("invalid_response"));
}

function fail(code: "invalid_configuration" | "invalid_response"): never {
	throw new CealPersonalClientSessionError(code);
}
