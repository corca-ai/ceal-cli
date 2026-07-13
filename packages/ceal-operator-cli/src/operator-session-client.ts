import {
	adminRequestUrl,
	normalizeAdminOrigin,
	replaceOperatorSession,
} from "./operator-session-store.js";
import type { OperatorSession } from "./operator-session-store.js";

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_CODE = /^[A-Z0-9][A-Z0-9-]{2,63}$/u;
const MAX_RESPONSE_BYTES = 64 * 1024;

export class OperatorSessionClientError extends Error {
	override readonly name = "OperatorSessionClientError";
	constructor(readonly code: string) {
		super(`Ceal operator session ${code.replaceAll("_", " ")}.`);
	}
}

export interface LoginChallenge {
	profile: string;
	verification_url: string;
	user_code: string;
	expires_at: string;
}

interface LoginStart {
	profile: string;
	adminOrigin: string;
	deploymentId: string;
	loginId: string;
	verificationUrl: string;
	userCode: string;
	expiresAt: string;
	pollIntervalMs: number;
}

export async function loginOperator(input: {
	adminOrigin: string;
	profile: string;
	fetchFn?: typeof globalThis.fetch;
	sleepFn?: (milliseconds: number) => Promise<void>;
	onChallenge?: (challenge: LoginChallenge) => void;
	now?: () => number;
}): Promise<OperatorSession> {
	if (!SAFE_NAME.test(input.profile)) throw new OperatorSessionClientError("invalid_profile");
	const fetchFn = input.fetchFn ?? globalThis.fetch;
	if (typeof fetchFn !== "function") throw new OperatorSessionClientError("fetch_unavailable");
	const start = await startLogin(normalizeAdminOrigin(input.adminOrigin), input.profile, fetchFn);
	input.onChallenge?.({
		profile: start.profile,
		verification_url: start.verificationUrl,
		user_code: start.userCode,
		expires_at: start.expiresAt,
	});
	return pollLogin(start, fetchFn, input.sleepFn ?? sleep, input.now ?? Date.now);
}

export async function refreshOperatorSession(input: {
	session: OperatorSession;
	homeDir?: string;
	fetchFn?: typeof globalThis.fetch;
}): Promise<{ session: OperatorSession; accessToken: string }> {
	const body = await postJson(
		adminRequestUrl(input.session.admin_api_origin, "/api/cealctl/token/refresh"),
		{
			schema_version: "cealctl.token_refresh_request.v1",
			profile: input.session.name,
			deployment_id: input.session.deployment_id,
			refresh_token: input.session.refresh_token,
		},
		input.fetchFn ?? globalThis.fetch,
	);
	if (body.schema_version !== "cealctl.token_refresh.v1") throw new OperatorSessionClientError("invalid_refresh_response");
	const next = decodeBoundSession(body, input.session);
	const accessToken = requireSecret(body.access_token);
	replaceOperatorSession(input.session.refresh_token, next, input.homeDir);
	return { session: next, accessToken };
}

export async function revokeOperatorSession(input: {
	session: OperatorSession;
	fetchFn?: typeof globalThis.fetch;
}): Promise<void> {
	const body = await postJson(
		adminRequestUrl(input.session.admin_api_origin, "/api/cealctl/token/revoke"),
		{
			schema_version: "cealctl.token_revoke_request.v1",
			profile: input.session.name,
			deployment_id: input.session.deployment_id,
			refresh_token: input.session.refresh_token,
		},
		input.fetchFn ?? globalThis.fetch,
	);
	if (body.schema_version !== "cealctl.token_revoke.v1" || body.revoked !== true) {
		throw new OperatorSessionClientError("invalid_revoke_response");
	}
	assertBinding(body, input.session);
}

async function startLogin(adminOrigin: string, profile: string, fetchFn: typeof globalThis.fetch): Promise<LoginStart> {
	const body = await postJson(adminRequestUrl(adminOrigin, "/api/cealctl/login/start"), {
		schema_version: "cealctl.login_start_request.v1",
		profile,
	}, fetchFn);
	if (body.schema_version !== "cealctl.login_start.v1") throw new OperatorSessionClientError("invalid_login_start_response");
	const userCode = requirePattern(body.user_code, SAFE_CODE, 64);
	const verificationUrl = requireVerificationUrl(body.verification_url, adminOrigin, userCode);
	return {
		profile,
		adminOrigin,
		deploymentId: requirePattern(body.deployment_id, SAFE_ID),
		loginId: requirePattern(body.login_id, SAFE_ID),
		verificationUrl,
		userCode,
		expiresAt: requireDate(body.expires_at),
		pollIntervalMs: normalizePollInterval(body.poll_interval_seconds),
	};
}

async function pollLogin(
	start: LoginStart,
	fetchFn: typeof globalThis.fetch,
	sleepFn: (milliseconds: number) => Promise<void>,
	now: () => number,
): Promise<OperatorSession> {
	while (now() < Date.parse(start.expiresAt)) {
		const body = await postJson(adminRequestUrl(start.adminOrigin, "/api/cealctl/login/poll"), {
			schema_version: "cealctl.login_poll_request.v1",
			profile: start.profile,
			login_id: start.loginId,
		}, fetchFn);
		if (body.schema_version !== "cealctl.login_poll.v1") throw new OperatorSessionClientError("invalid_login_poll_response");
		if (body.status === "complete") return decodeLoginComplete(body, start);
		if (body.status !== "pending") throw new OperatorSessionClientError("invalid_login_poll_response");
		await sleepFn(normalizePollInterval(body.poll_interval_seconds, start.pollIntervalMs));
	}
	throw new OperatorSessionClientError("login_expired");
}

function decodeLoginComplete(body: Record<string, unknown>, start: LoginStart): OperatorSession {
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
	if (session.name !== start.profile || session.admin_api_origin !== start.adminOrigin || session.deployment_id !== start.deploymentId
		|| session.auth_issuer_origin !== start.adminOrigin || session.auth_issuing_deployment_id !== start.deploymentId) {
		throw new OperatorSessionClientError("origin_mismatch");
	}
	return session;
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

function requireVerificationUrl(value: unknown, adminOrigin: string, userCode: string): string {
	const raw = requireString(value, 2048);
	let url: URL;
	try { url = new URL(raw); } catch { throw new OperatorSessionClientError("invalid_login_start_response"); }
	const base = new URL(adminOrigin);
	const basePath = base.pathname.replace(/\/$/u, "");
	if (url.origin !== base.origin || (basePath && !url.pathname.startsWith(`${basePath}/`))) {
		throw new OperatorSessionClientError("origin_mismatch");
	}
	if (url.searchParams.has("user-code") && url.searchParams.get("user-code") !== userCode) {
		throw new OperatorSessionClientError("origin_mismatch");
	}
	for (const key of url.searchParams.keys()) if (key !== "user-code") throw new OperatorSessionClientError("invalid_login_start_response");
	return url.toString();
}

function normalizePollInterval(value: unknown, fallback = 5000): number {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 30) throw new OperatorSessionClientError("invalid_response");
	return Math.min(value as number, 5) * 1000;
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

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
