import { CEAL_SESSION_CLIENT_TIMEOUT_MS, resolveRequestBounds } from "./request-bounds.js";
import {
	type CealSessionResponseShape,
	decodeSessionProtocolResponse,
	exchangeSessionJson,
	resolveSessionEndpoint,
} from "./session-http-client.js";
import { CEAL_CLIENT_VERSION } from "./version.js";
import {
	CEAL_CLIENT_REFRESH_ATTEMPT_REF,
	CEAL_CLIENT_REFRESH_REQUEST_SCHEMA,
	CEAL_CLIENT_REFRESH_REQUEST_V2_SCHEMA,
	CEAL_CLIENT_REVOKE_REQUEST_SCHEMA,
	type CealClientRefreshResponse,
	type CealClientRefreshResponseV2,
	type CealClientRevokeResponse,
	decodeCealClientRefreshResponse,
	decodeCealClientRefreshResponseV2,
	decodeCealClientRevokeResponse,
} from "@corca-ai/ceal-protocol";

export interface CealPersonalClientSessionClient {
	refresh(refreshToken: string, refreshAttemptRef?: string): Promise<CealClientRefreshResponse | CealClientRefreshResponseV2>;
	revoke(refreshToken: string): Promise<CealClientRevokeResponse>;
}

export interface CreateCealPersonalClientSessionClientOptions {
	endpoint: string | URL;
	fetchFn?: typeof globalThis.fetch;
	timeoutMs?: number;
}

export type CealPersonalClientSessionResponseShape = CealSessionResponseShape;

export class CealPersonalClientSessionError extends Error {
	override readonly name = "CealPersonalClientSessionError";
	readonly code: "invalid_configuration" | "request_timeout" | "request_failed" | "invalid_response";
	readonly response_shape: CealPersonalClientSessionResponseShape | undefined;
	constructor(code: CealPersonalClientSessionError["code"], responseShape?: CealPersonalClientSessionResponseShape) {
		super(`Ceal personal-client session ${code.replaceAll("_", " ")}.`);
		this.code = code;
		this.response_shape = responseShape;
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
		refresh: (refreshToken, refreshAttemptRef) =>
			refreshSession({
				endpoint: refreshEndpoint,
				fetchFn,
				timeoutMs,
				refreshToken,
				...(refreshAttemptRef === undefined ? {} : { refreshAttemptRef }),
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

function refreshSession(input: {
	endpoint: URL;
	fetchFn: typeof globalThis.fetch;
	timeoutMs: number;
	refreshToken: string;
	refreshAttemptRef?: string;
}): Promise<CealClientRefreshResponse | CealClientRefreshResponseV2> {
	if (input.refreshAttemptRef === undefined) {
		return requestSession({
			...input,
			body: {
				schema_version: CEAL_CLIENT_REFRESH_REQUEST_SCHEMA,
				refresh_token: input.refreshToken,
				client: { name: "ceal", version: CEAL_CLIENT_VERSION },
			},
			decode: decodeCealClientRefreshResponse,
		});
	}
	return requestSession({
		...input,
		body: {
			schema_version: CEAL_CLIENT_REFRESH_REQUEST_V2_SCHEMA,
			refresh_token: input.refreshToken,
			refresh_attempt_ref: input.refreshAttemptRef,
			client: { name: "ceal", version: CEAL_CLIENT_VERSION },
		},
		decode: decodeCealClientRefreshResponseV2,
	});
}

async function requestSession<T extends { readonly ok: boolean }>(input: {
	endpoint: URL;
	fetchFn: typeof globalThis.fetch;
	timeoutMs: number;
	refreshToken: string;
	body: Record<string, unknown>;
	decode: (value: unknown) => T;
	refreshAttemptRef?: string;
}): Promise<T> {
	if (!REFRESH_TOKEN.test(input.refreshToken)) throw new CealPersonalClientSessionError("invalid_configuration");
	if (input.refreshAttemptRef !== undefined && !CEAL_CLIENT_REFRESH_ATTEMPT_REF.test(input.refreshAttemptRef))
		throw new CealPersonalClientSessionError("invalid_configuration");
	const response = await exchangeSessionJson({
		endpoint: input.endpoint,
		fetchFn: input.fetchFn,
		timeoutMs: input.timeoutMs,
		body: input.body,
		createError: (failure, responseShape) => new CealPersonalClientSessionError(failure, responseShape),
		isClientError: (error) => error instanceof CealPersonalClientSessionError,
	});
	return decodeSessionProtocolResponse(response, input.decode, (responseShape) => fail("invalid_response", responseShape));
}

function fail(code: "invalid_configuration" | "invalid_response", responseShape?: CealPersonalClientSessionResponseShape): never {
	throw new CealPersonalClientSessionError(code, responseShape);
}
