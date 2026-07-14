import { randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STATE_SCHEMA = "cealctl.operator_sessions.v1";
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface OperatorSession {
	name: string;
	admin_api_origin: string;
	deployment_id: string;
	auth_issuer_origin: string;
	auth_issuing_deployment_id: string;
	access_token_expires_at: string;
	refresh_token: string;
	refresh_token_idle_expires_at: string;
	refresh_token_absolute_expires_at: string;
}

interface OperatorSessionState {
	schema_version: typeof STATE_SCHEMA;
	current_profile: string | null;
	profiles: Record<string, OperatorSession>;
}

export class OperatorSessionStoreError extends Error {
	override readonly name = "OperatorSessionStoreError";
	constructor(readonly code: "home_unavailable" | "invalid_profile" | "profile_missing" | "state_invalid" | "unsafe_state_path") {
		super(`Ceal operator session ${code.replaceAll("_", " ")}.`);
	}
}

export function operatorSessionPath(home = homedir()): string {
	if (!home) throw new OperatorSessionStoreError("home_unavailable");
	return join(home, ".ceal", "cealctl", "sessions.json");
}

export function readOperatorSessions(home?: string): OperatorSessionState {
	const path = operatorSessionPath(home);
	if (!existsSync(path)) return emptyState();
	assertSafeStateDirectories(path);
	assertSafeFile(path);
	try {
		return decodeState(JSON.parse(readFileSync(path, "utf8")));
	} catch (error) {
		if (error instanceof OperatorSessionStoreError) throw error;
		throw new OperatorSessionStoreError("state_invalid");
	}
}

export function saveOperatorSession(session: OperatorSession, home?: string): void {
	const normalized = decodeSession(session, session.name);
	const state = readOperatorSessions(home);
	state.profiles[normalized.name] = normalized;
	state.current_profile = normalized.name;
	writeState(state, home);
}

export function replaceOperatorSession(expectedRefreshToken: string, session: OperatorSession, home?: string): void {
	const state = readOperatorSessions(home);
	const current = state.profiles[session.name];
	if (!current || current.refresh_token !== expectedRefreshToken) throw new OperatorSessionStoreError("state_invalid");
	state.profiles[session.name] = decodeSession(session, session.name);
	writeState(state, home);
}

export function currentOperatorSession(home?: string, profileName?: string): OperatorSession {
	const state = readOperatorSessions(home);
	const name = profileName ?? state.current_profile;
	if (!name || !SAFE_NAME.test(name)) throw new OperatorSessionStoreError("profile_missing");
	const session = state.profiles[name];
	if (!session) throw new OperatorSessionStoreError("profile_missing");
	return session;
}

export function selectOperatorSession(name: string, home?: string): OperatorSession {
	if (!SAFE_NAME.test(name)) throw new OperatorSessionStoreError("invalid_profile");
	const state = readOperatorSessions(home);
	const session = state.profiles[name];
	if (!session) throw new OperatorSessionStoreError("profile_missing");
	state.current_profile = name;
	writeState(state, home);
	return session;
}

export function removeOperatorSession(home?: string, profileName?: string): { name: string; removed: boolean } {
	const state = readOperatorSessions(home);
	const name = profileName ?? state.current_profile;
	if (!name || !SAFE_NAME.test(name) || !state.profiles[name]) throw new OperatorSessionStoreError("profile_missing");
	delete state.profiles[name];
	state.current_profile = state.current_profile === name ? Object.keys(state.profiles).sort()[0] ?? null : state.current_profile;
	writeState(state, home);
	return { name, removed: true };
}

export function operatorProfilesPayload(home?: string): Record<string, unknown> {
	const state = readOperatorSessions(home);
	return {
		schema_version: "cealctl.sessions.v1",
		command: "cealctl",
		status: state.current_profile ? "configured" : "unconfigured",
		current_session: state.current_profile,
		sessions: Object.keys(state.profiles).sort().map((name) => redactSession(state.profiles[name])),
		raw_token_visible: false,
		proof_level: "local_state",
	};
}

export function redactSession(session: OperatorSession): Record<string, unknown> {
	return {
		name: session.name,
		admin_api_origin: session.admin_api_origin,
		deployment_id: session.deployment_id,
		auth_issuer_origin: session.auth_issuer_origin,
		auth_issuing_deployment_id: session.auth_issuing_deployment_id,
		access_token_expires_at: session.access_token_expires_at,
		refresh_token_idle_expires_at: session.refresh_token_idle_expires_at,
		refresh_token_absolute_expires_at: session.refresh_token_absolute_expires_at,
		token_storage_backend: "owner_only_file",
	};
}

export function normalizeAdminOrigin(value: string): string {
	let url: URL;
	try { url = new URL(value); } catch { throw new OperatorSessionStoreError("invalid_profile"); }
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
	const loopback = host === "127.0.0.1" || host === "::1";
	if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
		throw new OperatorSessionStoreError("invalid_profile");
	}
	url.pathname = url.pathname.replace(/\/+$/u, "");
	return url.toString().replace(/\/$/u, "");
}

export function adminRequestUrl(origin: string, pathname: string): string {
	return `${normalizeAdminOrigin(origin)}${pathname}`;
}

function emptyState(): OperatorSessionState {
	return { schema_version: STATE_SCHEMA, current_profile: null, profiles: {} };
}

function decodeState(value: unknown): OperatorSessionState {
	if (!isRecord(value) || value.schema_version !== STATE_SCHEMA || !isRecord(value.profiles)) {
		throw new OperatorSessionStoreError("state_invalid");
	}
	const profiles: Record<string, OperatorSession> = {};
	for (const [name, session] of Object.entries(value.profiles)) profiles[name] = decodeSession(session, name);
	const current = value.current_profile;
	if (current !== null && (typeof current !== "string" || !profiles[current])) throw new OperatorSessionStoreError("state_invalid");
	return { schema_version: STATE_SCHEMA, current_profile: current, profiles };
}

function decodeSession(value: unknown, name: string): OperatorSession {
	if (!SAFE_NAME.test(name) || !isRecord(value)) throw new OperatorSessionStoreError("state_invalid");
	const origin = normalizeAdminOrigin(requireString(value.admin_api_origin, 2048));
	const issuer = normalizeAdminOrigin(requireString(value.auth_issuer_origin, 2048));
	const deployment = requirePattern(value.deployment_id, SAFE_ID);
	const issuingDeployment = requirePattern(value.auth_issuing_deployment_id, SAFE_ID);
	if (origin !== issuer || deployment !== issuingDeployment) throw new OperatorSessionStoreError("state_invalid");
	return {
		name,
		admin_api_origin: origin,
		deployment_id: deployment,
		auth_issuer_origin: issuer,
		auth_issuing_deployment_id: issuingDeployment,
		access_token_expires_at: requireDate(value.access_token_expires_at),
		refresh_token: requireSecret(value.refresh_token),
		refresh_token_idle_expires_at: requireDate(value.refresh_token_idle_expires_at),
		refresh_token_absolute_expires_at: requireDate(value.refresh_token_absolute_expires_at),
	};
}

function writeState(state: OperatorSessionState, home?: string): void {
	const path = operatorSessionPath(home);
	const directory = dirname(path);
	ensureSafeStateDirectories(path);
	if (existsSync(path)) assertSafeFile(path);
	const temporary = join(directory, `.sessions.${process.pid}.${randomUUID()}.tmp`);
	writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
	renameSync(temporary, path);
}

function ensureSafeStateDirectories(statePath: string): void {
	const cealctlDir = dirname(statePath);
	const cealDir = dirname(cealctlDir);
	for (const directory of [cealDir, cealctlDir]) {
		if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
		assertSafeDirectory(directory);
		chmodSync(directory, 0o700);
	}
}

function assertSafeStateDirectories(statePath: string): void {
	for (const directory of [dirname(dirname(statePath)), dirname(statePath)]) assertSafeDirectory(directory);
}

function assertSafeDirectory(path: string): void {
	const stat = lstatSync(path);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
		throw new OperatorSessionStoreError("unsafe_state_path");
	}
}

function assertSafeFile(path: string): void {
	const stat = lstatSync(path);
	if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new OperatorSessionStoreError("unsafe_state_path");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, max: number): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max || /[\r\n]/u.test(value)) throw new OperatorSessionStoreError("state_invalid");
	return value;
}

function requirePattern(value: unknown, pattern: RegExp): string {
	const result = requireString(value, 128);
	if (!pattern.test(result)) throw new OperatorSessionStoreError("state_invalid");
	return result;
}

function requireDate(value: unknown): string {
	const parsed = Date.parse(requireString(value, 64));
	if (!Number.isFinite(parsed)) throw new OperatorSessionStoreError("state_invalid");
	return new Date(parsed).toISOString();
}

function requireSecret(value: unknown): string {
	return requireString(value, 8192);
}
