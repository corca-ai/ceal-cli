export const CEAL_CLIENT_REFRESH_REQUEST_SCHEMA = "ceal.client_refresh_request.v1" as const;
export const CEAL_CLIENT_REFRESH_RESULT_SCHEMA = "ceal.client_refresh_result.v1" as const;
export const CEAL_CLIENT_REVOKE_REQUEST_SCHEMA = "ceal.client_revoke_request.v1" as const;
export const CEAL_CLIENT_REVOKE_RESULT_SCHEMA = "ceal.client_revoke_result.v1" as const;

export interface CealClientRefreshRequest {
	schema_version: typeof CEAL_CLIENT_REFRESH_REQUEST_SCHEMA;
	refresh_token: string;
	client: { name: "ceal"; version: string };
}

export interface CealClientRefreshResult {
	schema_version: typeof CEAL_CLIENT_REFRESH_RESULT_SCHEMA;
	ok: true;
	profile_ref: string;
	membership_ref: string;
	registration_ref: string;
	client_ref: string;
	subject_ref: string;
	instance_ref: string;
	access_token: string;
	expires_at: string;
	refresh_token: string;
	refresh_token_idle_expires_at: string;
	refresh_token_absolute_expires_at: string;
}

export interface CealClientSessionFailure {
	schema_version: typeof CEAL_CLIENT_REFRESH_RESULT_SCHEMA | typeof CEAL_CLIENT_REVOKE_RESULT_SCHEMA;
	ok: false;
	error: {
		code: "refresh_invalid" | "refresh_expired" | "refresh_replayed" | "refresh_revoked";
		message: string;
		next_action: string;
	};
}

export interface CealClientRevokeRequest {
	schema_version: typeof CEAL_CLIENT_REVOKE_REQUEST_SCHEMA;
	refresh_token: string;
}

export interface CealClientRevokeResult {
	schema_version: typeof CEAL_CLIENT_REVOKE_RESULT_SCHEMA;
	ok: true;
	revoked: true;
}

export type CealClientRefreshResponse = CealClientRefreshResult | CealClientSessionFailure;
export type CealClientRevokeResponse = CealClientRevokeResult | CealClientSessionFailure;

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ACCESS_TOKEN = /^ceal_personal_[A-Za-z0-9_-]{43}$/u;
const REFRESH_TOKEN = /^ceal_refresh_[A-Za-z0-9_-]{43}$/u;
const VERSION = /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/u;
const FAILURE_CODES = new Set(["refresh_invalid", "refresh_expired", "refresh_replayed", "refresh_revoked"]);

export function decodeCealClientRefreshRequest(value: unknown): CealClientRefreshRequest {
	const record = requireRecord(value);
	requireExactKeys(record, ["client", "refresh_token", "schema_version"]);
	const client = requireRecord(record.client);
	requireExactKeys(client, ["name", "version"]);
	if (record.schema_version !== CEAL_CLIENT_REFRESH_REQUEST_SCHEMA
		|| typeof record.refresh_token !== "string" || !REFRESH_TOKEN.test(record.refresh_token)
		|| client.name !== "ceal" || typeof client.version !== "string" || !VERSION.test(client.version)) invalid();
	return record as unknown as CealClientRefreshRequest;
}

export function decodeCealClientRefreshResponse(value: unknown): CealClientRefreshResponse {
	const record = requireRecord(value);
	if (record.schema_version !== CEAL_CLIENT_REFRESH_RESULT_SCHEMA || typeof record.ok !== "boolean") invalid();
	if (record.ok === false) return decodeFailure(record, CEAL_CLIENT_REFRESH_RESULT_SCHEMA);
	requireExactKeys(record, [
		"access_token", "client_ref", "expires_at", "instance_ref", "membership_ref", "ok", "profile_ref", "refresh_token",
		"refresh_token_absolute_expires_at", "refresh_token_idle_expires_at", "registration_ref",
		"schema_version", "subject_ref",
	]);
	if (!validRefreshBinding(record) || !validRefreshTokens(record) || !validRefreshTimestamps(record)) invalid();
	return record as unknown as CealClientRefreshResult;
}

function validRefreshBinding(record: Record<string, unknown>): boolean {
	return ["profile_ref", "membership_ref", "registration_ref", "client_ref", "subject_ref", "instance_ref"]
		.every((key) => typeof record[key] === "string" && SAFE_REF.test(record[key]));
}
function validRefreshTokens(record: Record<string, unknown>): boolean {
	return typeof record.access_token === "string" && ACCESS_TOKEN.test(record.access_token)
		&& typeof record.refresh_token === "string" && REFRESH_TOKEN.test(record.refresh_token);
}
function validRefreshTimestamps(record: Record<string, unknown>): boolean {
	return ["expires_at", "refresh_token_idle_expires_at", "refresh_token_absolute_expires_at"]
		.every((key) => typeof record[key] === "string" && validTimestamp(record[key]));
}

export function decodeCealClientRevokeRequest(value: unknown): CealClientRevokeRequest {
	const record = requireRecord(value);
	requireExactKeys(record, ["refresh_token", "schema_version"]);
	if (record.schema_version !== CEAL_CLIENT_REVOKE_REQUEST_SCHEMA
		|| typeof record.refresh_token !== "string" || !REFRESH_TOKEN.test(record.refresh_token)) invalid();
	return record as unknown as CealClientRevokeRequest;
}

export function decodeCealClientRevokeResponse(value: unknown): CealClientRevokeResponse {
	const record = requireRecord(value);
	if (record.schema_version !== CEAL_CLIENT_REVOKE_RESULT_SCHEMA || typeof record.ok !== "boolean") invalid();
	if (record.ok === false) return decodeFailure(record, CEAL_CLIENT_REVOKE_RESULT_SCHEMA);
	requireExactKeys(record, ["ok", "revoked", "schema_version"]);
	if (record.revoked !== true) invalid();
	return record as unknown as CealClientRevokeResult;
}

function decodeFailure(
	record: Record<string, unknown>,
	schema: typeof CEAL_CLIENT_REFRESH_RESULT_SCHEMA | typeof CEAL_CLIENT_REVOKE_RESULT_SCHEMA,
): CealClientSessionFailure {
	requireExactKeys(record, ["error", "ok", "schema_version"]);
	const error = requireRecord(record.error);
	requireExactKeys(error, ["code", "message", "next_action"]);
	if (record.schema_version !== schema || !FAILURE_CODES.has(String(error.code))
		|| typeof error.message !== "string" || error.message.length === 0 || error.message.length > 256
		|| typeof error.next_action !== "string" || error.next_action.length === 0 || error.next_action.length > 256) invalid();
	return record as unknown as CealClientSessionFailure;
}

function validTimestamp(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value));
}

function requireRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
	return value as Record<string, unknown>;
}

function requireExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
	if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...expected].sort())) invalid();
}

function invalid(): never {
	throw new TypeError("Invalid Ceal personal-client session message.");
}
