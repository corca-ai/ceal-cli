import http from "node:http";
import process from "node:process";
import { join } from "node:path";
import { normalizeAdminOrigin } from "./operator-session-store.js";
import type { OperatorSession } from "./operator-session-store.js";

const REQUEST_SCHEMA = "cealctl.local_owner_login_request.v1";
const RESPONSE_SCHEMA = "cealctl.local_owner_login.v1";
const REQUEST_PATH = "/v1/operator/login";
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MINIMUM_LOCAL_OWNER_CONTRACT_REVISION = 2;

export class LocalGatewayOwnerLoginError extends Error {
	override readonly name = "LocalGatewayOwnerLoginError";
	constructor(readonly code: "control_plane_upgrade_required" | "local_authorization_unavailable" | "local_authorization_rejected" | "request_timeout" | "invalid_response") {
		super(`Ceal local Gateway owner login ${code.replaceAll("_", " ")}.`);
	}
}

export function defaultLocalGatewayOwnerSocketPath(): string {
	const configured = process.env.XDG_RUNTIME_DIR;
	const runtimeDirectory = configured && configured.startsWith("/") ? configured : defaultRuntimeDirectory();
	return join(runtimeDirectory, "ceal", "admin-gateway.sock");
}

export async function loginLocalGatewayOwner(input: {
	adminOrigin: string;
	profile: string;
	socketPath?: string;
}): Promise<OperatorSession> {
	if (!SAFE_NAME.test(input.profile)) throw new LocalGatewayOwnerLoginError("local_authorization_rejected");
	const adminOrigin = normalizeAdminOrigin(input.adminOrigin);
	const socketPath = input.socketPath ?? defaultLocalGatewayOwnerSocketPath();
	if (!isAbsoluteSocketPath(socketPath)) throw new LocalGatewayOwnerLoginError("local_authorization_unavailable");
	const body = await postLocalJson(socketPath, {
		schema_version: REQUEST_SCHEMA,
		admin_api_origin: adminOrigin,
		profile: input.profile,
	});
	if (body.schema_version !== RESPONSE_SCHEMA || body.status !== "authenticated") {
		throw new LocalGatewayOwnerLoginError("invalid_response");
	}
	return decodeSession(body, { adminOrigin, profile: input.profile });
}

function defaultRuntimeDirectory(): string {
	if (typeof process.getuid !== "function") throw new LocalGatewayOwnerLoginError("local_authorization_unavailable");
	return `/run/user/${process.getuid()}`;
}

function isAbsoluteSocketPath(value: string): boolean {
	return value.startsWith("/") && value.length <= 1024 && !/[\r\n]/u.test(value);
}

async function postLocalJson(socketPath: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
	const encoded = Buffer.from(JSON.stringify(body), "utf8");
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			callback();
		};
		const request = http.request({
			socketPath,
			path: REQUEST_PATH,
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				"content-length": String(encoded.byteLength),
			},
		}, (response) => {
			const chunks: Buffer[] = [];
			let received = 0;
			response.on("data", (chunk: Buffer) => {
				received += chunk.byteLength;
				if (received > MAX_RESPONSE_BYTES) {
					request.destroy();
					finish(() => reject(new LocalGatewayOwnerLoginError("invalid_response")));
					return;
				}
				chunks.push(chunk);
			});
			response.once("error", () => finish(() => reject(new LocalGatewayOwnerLoginError("local_authorization_unavailable"))));
			response.once("end", () => {
				if (response.statusCode !== 200 || !response.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
					finish(() => reject(new LocalGatewayOwnerLoginError("local_authorization_rejected")));
					return;
				}
				try {
					const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
					if (!isRecord(parsed)) throw new Error("invalid response");
					finish(() => resolve(parsed));
				} catch {
					finish(() => reject(new LocalGatewayOwnerLoginError("invalid_response")));
				}
			});
		});
		request.setTimeout(REQUEST_TIMEOUT_MS, () => {
			request.destroy();
			finish(() => reject(new LocalGatewayOwnerLoginError("request_timeout")));
		});
		request.once("error", () => finish(() => reject(new LocalGatewayOwnerLoginError("local_authorization_unavailable"))));
		request.end(encoded);
	});
}

function decodeSession(body: Record<string, unknown>, expected: { adminOrigin: string; profile: string }): OperatorSession {
	if (!Number.isSafeInteger(body.contract_revision)) throw new LocalGatewayOwnerLoginError("invalid_response");
	if (Number(body.contract_revision) < MINIMUM_LOCAL_OWNER_CONTRACT_REVISION) throw new LocalGatewayOwnerLoginError("control_plane_upgrade_required");
	const session: OperatorSession = {
		name: requirePattern(body.profile, SAFE_NAME),
		admin_api_origin: normalizeAdminOrigin(requireString(body.admin_api_origin, 2048)),
		deployment_id: requirePattern(body.deployment_id, SAFE_ID),
		auth_issuer_origin: normalizeAdminOrigin(requireString(body.auth_issuer_origin, 2048)),
		auth_issuing_deployment_id: requirePattern(body.auth_issuing_deployment_id, SAFE_ID),
		access_token_expires_at: requireDate(body.access_token_expires_at),
		refresh_token: requireString(body.refresh_token, 8192),
		refresh_token_idle_expires_at: requireDate(body.refresh_token_idle_expires_at),
		refresh_token_absolute_expires_at: requireDate(body.refresh_token_absolute_expires_at),
	};
	if (session.name !== expected.profile || session.admin_api_origin !== expected.adminOrigin
		|| session.auth_issuer_origin !== expected.adminOrigin || session.auth_issuing_deployment_id !== session.deployment_id) {
		throw new LocalGatewayOwnerLoginError("invalid_response");
	}
	return session;
}

function requireString(value: unknown, max: number): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max || /[\r\n]/u.test(value)) {
		throw new LocalGatewayOwnerLoginError("invalid_response");
	}
	return value;
}

function requirePattern(value: unknown, pattern: RegExp): string {
	const result = requireString(value, 128);
	if (!pattern.test(result)) throw new LocalGatewayOwnerLoginError("invalid_response");
	return result;
}

function requireDate(value: unknown): string {
	const parsed = Date.parse(requireString(value, 64));
	if (!Number.isFinite(parsed)) throw new LocalGatewayOwnerLoginError("invalid_response");
	return new Date(parsed).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
