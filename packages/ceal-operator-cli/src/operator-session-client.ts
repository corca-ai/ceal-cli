import {
	adminRequestUrl,
	currentOperatorSession,
	normalizeAdminOrigin,
	removeOperatorSessionWhileLocked,
	replaceOperatorSessionWhileLocked,
	withOperatorSessionStateLock,
} from "./operator-session-store.js";
import type { OperatorSession } from "./operator-session-store.js";
import { requireCompatibleAdminApiContract } from "./admin-api-contract-client.js";

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_RESPONSE_BYTES = 64 * 1024;

export class OperatorSessionClientError extends Error {
	override readonly name = "OperatorSessionClientError";
	constructor(readonly code: string) {
		super(`Ceal operator session ${code.replaceAll("_", " ")}.`);
	}
}

export async function refreshOperatorSession(input: {
	session: OperatorSession;
	homeDir?: string;
	fetchFn?: typeof globalThis.fetch;
}): Promise<{ session: OperatorSession; accessToken: string }> {
	return withOperatorSessionStateLock(input.homeDir, async () => {
		const session = currentOperatorSession(input.homeDir, input.session.name);
		assertStableSessionIdentity(session, input.session);
		await requireCompatibleAdminApiContract({
			adminOrigin: session.admin_api_origin,
			expectedDeploymentId: session.deployment_id,
			fetchFn: input.fetchFn,
		});
		const body = await postJson(
			adminRequestUrl(session.admin_api_origin, "/api/cealctl/token/refresh"),
			{
				schema_version: "cealctl.token_refresh_request.v1",
				profile: session.name,
				deployment_id: session.deployment_id,
				refresh_token: session.refresh_token,
			},
			input.fetchFn ?? globalThis.fetch,
		);
		if (body.schema_version !== "cealctl.token_refresh.v1") throw new OperatorSessionClientError("invalid_refresh_response");
		const next = decodeBoundSession(body, session);
		const accessToken = requireSecret(body.access_token);
		replaceOperatorSessionWhileLocked(session.refresh_token, next, input.homeDir);
		return { session: next, accessToken };
	});
}

export async function revokeAndRemoveOperatorSession(input: {
	session: OperatorSession;
	homeDir?: string;
	fetchFn?: typeof globalThis.fetch;
}): Promise<OperatorSession> {
	return withOperatorSessionStateLock(input.homeDir, async () => {
		const session = currentOperatorSession(input.homeDir, input.session.name);
		assertStableSessionIdentity(session, input.session);
		await requireCompatibleAdminApiContract({
			adminOrigin: session.admin_api_origin,
			expectedDeploymentId: session.deployment_id,
			fetchFn: input.fetchFn,
		});
		const body = await postJson(
			adminRequestUrl(session.admin_api_origin, "/api/cealctl/token/revoke"),
			{
				schema_version: "cealctl.token_revoke_request.v1",
				profile: session.name,
				deployment_id: session.deployment_id,
				refresh_token: session.refresh_token,
			},
			input.fetchFn ?? globalThis.fetch,
		);
		if (body.schema_version !== "cealctl.token_revoke.v1" || body.revoked !== true) {
			throw new OperatorSessionClientError("invalid_revoke_response");
		}
		assertBinding(body, session);
		removeOperatorSessionWhileLocked(input.homeDir, session.name);
		return session;
	});
}

function decodeBoundSession(body: Record<string, unknown>, expected: OperatorSession): OperatorSession {
	const session: OperatorSession = {
		name: requirePattern(body.profile, SAFE_NAME, 64),
		admin_api_origin: normalizeAdminOrigin(requireString(body.admin_api_origin, 2048)),
		deployment_id: requirePattern(body.deployment_id, SAFE_ID),
		auth_issuer_origin: normalizeAdminOrigin(requireString(body.auth_issuer_origin, 2048)),
		auth_issuing_deployment_id: requirePattern(body.auth_issuing_deployment_id, SAFE_ID),
		access_token_expires_at: requireDate(body.access_token_expires_at),
		refresh_token: requireSecret(body.refresh_token),
		refresh_token_idle_expires_at: requireDate(body.refresh_token_idle_expires_at),
		refresh_token_absolute_expires_at: requireDate(body.refresh_token_absolute_expires_at),
	};
	assertBinding(session as unknown as Record<string, unknown>, expected);
	return session;
}

function assertBinding(value: Record<string, unknown>, expected: OperatorSession): void {
	if (value.profile !== undefined && value.profile !== expected.name) throw new OperatorSessionClientError("origin_mismatch");
	const origin = value.admin_api_origin === undefined ? expected.admin_api_origin : normalizeAdminOrigin(requireString(value.admin_api_origin, 2048));
	const deployment = value.deployment_id === undefined ? expected.deployment_id : requirePattern(value.deployment_id, SAFE_ID);
	const issuer = value.auth_issuer_origin === undefined ? expected.auth_issuer_origin : normalizeAdminOrigin(requireString(value.auth_issuer_origin, 2048));
	const issuingDeployment = value.auth_issuing_deployment_id === undefined
		? expected.auth_issuing_deployment_id : requirePattern(value.auth_issuing_deployment_id, SAFE_ID);
	if (origin !== expected.admin_api_origin || deployment !== expected.deployment_id
		|| issuer !== expected.auth_issuer_origin || issuingDeployment !== expected.auth_issuing_deployment_id) {
		throw new OperatorSessionClientError("origin_mismatch");
	}
}

function assertStableSessionIdentity(current: OperatorSession, expected: OperatorSession): void {
	if (current.name !== expected.name || current.admin_api_origin !== expected.admin_api_origin
		|| current.deployment_id !== expected.deployment_id || current.auth_issuer_origin !== expected.auth_issuer_origin
		|| current.auth_issuing_deployment_id !== expected.auth_issuing_deployment_id) {
		throw new OperatorSessionClientError("origin_mismatch");
	}
}

async function postJson(url: string, body: Record<string, unknown>, fetchFn: typeof globalThis.fetch): Promise<Record<string, unknown>> {
	if (typeof fetchFn !== "function") throw new OperatorSessionClientError("fetch_unavailable");
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const request = (async () => {
			const response = await fetchFn(url, {
				method: "POST",
				headers: { accept: "application/json", "content-type": "application/json" },
				body: JSON.stringify(body),
				redirect: "error",
				signal: controller.signal,
			});
			const value = await readBoundedJson(response);
			if (!response.ok) {
				const code = typeof value.error_code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value.error_code)
					? value.error_code : "request_denied";
				throw new OperatorSessionClientError(code);
			}
			return value;
		})();
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				controller.abort();
				reject(new OperatorSessionClientError("request_timeout"));
			}, 10_000);
		});
		return await Promise.race([request, timeout]);
	} catch (error) {
		if (error instanceof OperatorSessionClientError) throw error;
		throw new OperatorSessionClientError(controller.signal.aborted ? "request_timeout" : "request_failed");
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
	validateJsonResponseHeaders(response);
	const bytes = await readBoundedBody(response);
	return decodeJsonRecord(bytes);
}

function validateJsonResponseHeaders(response: Response): void {
	if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) invalidResponse();
	const declared = response.headers.get("content-length");
	if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) invalidResponse();
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
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
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return bytes;
}

function decodeJsonRecord(bytes: Uint8Array): Record<string, unknown> {
	let value: unknown;
	try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { invalidResponse(); }
	if (typeof value !== "object" || value === null || Array.isArray(value)) invalidResponse();
	return value as Record<string, unknown>;
}

function invalidResponse(): never {
	throw new OperatorSessionClientError("invalid_response");
}

function requireString(value: unknown, max: number): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max || /[\r\n]/u.test(value)) throw new OperatorSessionClientError("invalid_response");
	return value;
}

function requirePattern(value: unknown, pattern: RegExp, max = 128): string {
	const result = requireString(value, max);
	if (!pattern.test(result)) throw new OperatorSessionClientError("invalid_response");
	return result;
}

function requireDate(value: unknown): string {
	const parsed = Date.parse(requireString(value, 64));
	if (!Number.isFinite(parsed)) throw new OperatorSessionClientError("invalid_response");
	return new Date(parsed).toISOString();
}

function requireSecret(value: unknown): string {
	return requireString(value, 8192);
}
