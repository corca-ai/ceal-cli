import {
	CEAL_ENROLLMENT_EXCHANGE_SCHEMA,
	decodeCealEnrollmentResponse,
	type CealEnrollmentResponse,
} from "@corca-ai/ceal-protocol";

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

const MAX_RESPONSE_BYTES = 64 * 1024;

export function createCealEnrollmentClient(options: CreateCealEnrollmentClientOptions): CealEnrollmentClient {
	const endpoint = enrollmentEndpoint(options.endpoint);
	const fetchFn = options.fetchFn ?? globalThis.fetch;
	if (typeof fetchFn !== "function") throw new CealEnrollmentClientError("invalid_configuration");
	const timeoutMs = options.timeoutMs ?? 10_000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
		throw new CealEnrollmentClientError("invalid_configuration");
	}
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
						client: { name: "ceal", version: "0.65.2" },
					}),
					redirect: "error",
					signal: controller.signal,
				});
				const bytes = await readBounded(response);
				if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) invalidResponse();
				let parsed: unknown;
				try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { invalidResponse(); }
				try { return decodeCealEnrollmentResponse(parsed); } catch { invalidResponse(); }
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
	try { endpoint = new URL(value); } catch { throw new CealEnrollmentClientError("invalid_configuration"); }
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
		if (total > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			invalidResponse();
		}
		chunks.push(value);
	}
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
	return result;
}

function invalidResponse(): never {
	throw new CealEnrollmentClientError("invalid_response");
}
