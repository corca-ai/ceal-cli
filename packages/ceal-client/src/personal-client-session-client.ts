import {
	CEAL_CLIENT_REFRESH_REQUEST_SCHEMA,
	CEAL_CLIENT_REVOKE_REQUEST_SCHEMA,
	decodeCealClientRefreshResponse,
	decodeCealClientRevokeResponse,
	type CealClientRefreshResponse,
	type CealClientRevokeResponse,
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
	constructor(readonly code: "invalid_configuration" | "request_timeout" | "request_failed" | "invalid_response") {
		super(`Ceal personal-client session ${code.replaceAll("_", " ")}.`);
	}
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const REFRESH_TOKEN = /^ceal_refresh_[A-Za-z0-9_-]{43}$/u;

export function createCealPersonalClientSessionClient(
	options: CreateCealPersonalClientSessionClientOptions,
): CealPersonalClientSessionClient {
	const endpoint = safeEndpoint(options.endpoint);
	const fetchFn = options.fetchFn ?? globalThis.fetch;
	if (typeof fetchFn !== "function") throw new CealPersonalClientSessionError("invalid_configuration");
	const timeoutMs = options.timeoutMs ?? 10_000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
		throw new CealPersonalClientSessionError("invalid_configuration");
	}
	return {
		refresh: (refreshToken) => requestSession({
			endpoint: childEndpoint(endpoint, "refresh"), fetchFn, timeoutMs, refreshToken,
			body: {
				schema_version: CEAL_CLIENT_REFRESH_REQUEST_SCHEMA,
				refresh_token: refreshToken,
				client: { name: "ceal", version: "0.65.6" },
			},
			decode: decodeCealClientRefreshResponse,
		}),
		revoke: (refreshToken) => requestSession({
			endpoint: childEndpoint(endpoint, "revoke"), fetchFn, timeoutMs, refreshToken,
			body: { schema_version: CEAL_CLIENT_REVOKE_REQUEST_SCHEMA, refresh_token: refreshToken },
			decode: decodeCealClientRevokeResponse,
		}),
	};
}

async function requestSession<T>(input: {
	endpoint: URL;
	fetchFn: typeof globalThis.fetch;
	timeoutMs: number;
	refreshToken: string;
	body: Record<string, unknown>;
	decode: (value: unknown) => T;
}): Promise<T> {
	if (!REFRESH_TOKEN.test(input.refreshToken)) throw new CealPersonalClientSessionError("invalid_configuration");
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), input.timeoutMs);
	try {
		const response = await input.fetchFn(input.endpoint, {
			method: "POST",
			headers: { accept: "application/json", "content-type": "application/json" },
			body: JSON.stringify(input.body),
			redirect: "error",
			signal: controller.signal,
		});
		const bytes = await readBounded(response);
		if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) invalidResponse();
		let parsed: unknown;
		try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { invalidResponse(); }
		try { return input.decode(parsed); } catch { invalidResponse(); }
	} catch (error) {
		if (error instanceof CealPersonalClientSessionError) throw error;
		if (controller.signal.aborted) throw new CealPersonalClientSessionError("request_timeout");
		throw new CealPersonalClientSessionError("request_failed");
	} finally {
		clearTimeout(timer);
	}
}

function safeEndpoint(value: string | URL): URL {
	let endpoint: URL;
	try { endpoint = new URL(value); } catch { throw new CealPersonalClientSessionError("invalid_configuration"); }
	const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
	if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
		|| (endpoint.protocol === "http:" && host !== "127.0.0.1" && host !== "::1")
		|| (endpoint.protocol !== "http:" && endpoint.protocol !== "https:")) {
		throw new CealPersonalClientSessionError("invalid_configuration");
	}
	return endpoint;
}

function childEndpoint(endpoint: URL, action: "refresh" | "revoke"): URL {
	const result = new URL(endpoint);
	result.pathname = `${result.pathname.replace(/\/$/u, "")}/${action}`;
	return result;
}

async function readBounded(response: Response): Promise<Uint8Array> {
	const declared = response.headers.get("content-length");
	if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) invalidResponse();
	if (!response.body) invalidResponse();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); invalidResponse(); }
		chunks.push(value);
	}
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
	return result;
}

function invalidResponse(): never {
	throw new CealPersonalClientSessionError("invalid_response");
}
