export interface CealEnrollmentCreateInput {
	adminEndpoint: string;
	adminToken: string;
	profileRef: string;
	registrationRef: string;
	clientRef: string;
	runnerRef: string;
	subjectRef: string;
	instanceRef: string;
}

export interface CealEnrollmentCreateResult {
	code: string;
	gatewayEndpoint: string;
	expiresAt: string;
}

export class CealEnrollmentAdminClientError extends Error {
	override readonly name = "CealEnrollmentAdminClientError";
	constructor(readonly code: "invalid_configuration" | "request_timeout" | "request_failed" | "invalid_response" | "request_denied") {
		super(`Ceal enrollment administration ${code.replaceAll("_", " ")}.`);
	}
}

const MAX_RESPONSE_BYTES = 64 * 1024;

export async function createCealEnrollment(
	input: CealEnrollmentCreateInput,
	options: { fetchFn?: typeof globalThis.fetch; timeoutMs?: number } = {},
): Promise<CealEnrollmentCreateResult> {
	const endpoint = safeEndpoint(input.adminEndpoint);
	if (!/^[A-Za-z0-9._~+/-]+=*$/u.test(input.adminToken) || input.adminToken.length < 16 || input.adminToken.length > 8192) {
		throw new CealEnrollmentAdminClientError("invalid_configuration");
	}
	const fetchFn = options.fetchFn ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? 10_000;
	if (typeof fetchFn !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
		throw new CealEnrollmentAdminClientError("invalid_configuration");
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchFn(endpoint, {
			method: "POST",
			headers: { accept: "application/json", authorization: `Bearer ${input.adminToken}`, "content-type": "application/json" },
			body: JSON.stringify({
				schema_version: CEAL_ENROLLMENT_CREATE_SCHEMA,
				profile_ref: input.profileRef,
				registration_ref: input.registrationRef,
				client_ref: input.clientRef,
				runner_ref: input.runnerRef,
				subject_ref: input.subjectRef,
				instance_ref: input.instanceRef,
			}),
			redirect: "error",
			signal: controller.signal,
		});
		const bytes = await readBounded(response);
		if (!response.ok) throw new CealEnrollmentAdminClientError("request_denied");
		if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) invalidResponse();
		let value: unknown;
		try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { invalidResponse(); }
		return decodeResult(value);
	} catch (error) {
		if (error instanceof CealEnrollmentAdminClientError) throw error;
		if (controller.signal.aborted) throw new CealEnrollmentAdminClientError("request_timeout");
		throw new CealEnrollmentAdminClientError("request_failed");
	} finally { clearTimeout(timer); }
}

function safeEndpoint(value: string): URL {
	let endpoint: URL;
	try { endpoint = new URL(value); } catch { throw new CealEnrollmentAdminClientError("invalid_configuration"); }
	const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
	if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
		|| (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && (host === "127.0.0.1" || host === "::1")))) {
		throw new CealEnrollmentAdminClientError("invalid_configuration");
	}
	return endpoint;
}

function decodeResult(value: unknown): CealEnrollmentCreateResult {
	try {
		const record = decodeCealEnrollmentCreateResult(value);
		return { code: record.code, gatewayEndpoint: record.gateway_endpoint, expiresAt: record.expires_at };
	} catch { invalidResponse(); }
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
	throw new CealEnrollmentAdminClientError("invalid_response");
}
import {
	CEAL_ENROLLMENT_CREATE_SCHEMA,
	decodeCealEnrollmentCreateResult,
} from "@corca-ai/ceal-protocol";
