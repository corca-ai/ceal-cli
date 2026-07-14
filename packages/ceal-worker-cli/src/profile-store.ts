import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface CealStoredSession {
	gatewayEndpoint: string;
	profileRef: string;
	membershipRef: string;
	registrationRef: string;
	clientRef: string;
	subjectRef: string;
	instanceRef: string;
	accessToken: string;
	expiresAt: string;
	refreshToken: string;
	refreshTokenIdleExpiresAt: string;
	refreshTokenAbsoluteExpiresAt: string;
}

export class CealSessionStoreError extends Error {
	override readonly name = "CealSessionStoreError";
	constructor(readonly code: "home_unavailable" | "unsafe_store" | "invalid_store") {
		super(`Ceal session store ${code.replaceAll("_", " ")}.`);
	}
}

export function createCealSessionStore(home: string | undefined): {
	load(): Promise<CealStoredSession | null>;
	save(session: CealStoredSession): Promise<void>;
	remove(): Promise<void>;
} {
	if (!home || !path.isAbsolute(home)) throw new CealSessionStoreError("home_unavailable");
	const directory = path.join(home, ".ceal");
	const file = path.join(directory, "client-session.json");
	return {
		async load() {
			if (!existsSync(file)) return null;
			assertDirectory(directory);
			assertFile(file);
			let parsed: unknown;
			try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { throw new CealSessionStoreError("invalid_store"); }
			return parseSession(parsed);
		},
		async save(session) {
			validateSession(session);
			prepareDirectory(directory);
			if (existsSync(file)) assertFile(file);
			const temporary = path.join(directory, `.client-session.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
			try {
				writeFileSync(temporary, `${JSON.stringify(serializeSession(session), null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
				renameSync(temporary, file);
				chmodSync(file, 0o600);
			} finally {
				rmSync(temporary, { force: true });
			}
		},
		async remove() {
			if (!existsSync(file)) return;
			assertDirectory(directory);
			assertFile(file);
			rmSync(file);
		},
	};
}

function prepareDirectory(directory: string): void {
	if (!existsSync(directory)) {
		try { mkdirSync(directory, { mode: 0o700 }); } catch { throw new CealSessionStoreError("unsafe_store"); }
	}
	assertDirectory(directory);
	chmodSync(directory, 0o700);
}

function assertDirectory(directory: string): void {
	const stat = lstatSync(directory);
	if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o777) !== 0o700) throw new CealSessionStoreError("unsafe_store");
}

function assertFile(file: string): void {
	const stat = lstatSync(file);
	if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new CealSessionStoreError("unsafe_store");
}

function serializeSession(session: CealStoredSession): Record<string, unknown> {
	return {
		schema_version: "ceal.client_session_store.v1",
		gateway_endpoint: session.gatewayEndpoint,
		profile_ref: session.profileRef,
		membership_ref: session.membershipRef,
		registration_ref: session.registrationRef,
		client_ref: session.clientRef,
		subject_ref: session.subjectRef,
		instance_ref: session.instanceRef,
		access_token: session.accessToken,
		expires_at: session.expiresAt,
		refresh_token: session.refreshToken,
		refresh_token_idle_expires_at: session.refreshTokenIdleExpiresAt,
		refresh_token_absolute_expires_at: session.refreshTokenAbsoluteExpiresAt,
	};
}

function parseSession(value: unknown): CealStoredSession {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new CealSessionStoreError("invalid_store");
	const record = value as Record<string, unknown>;
	const expectedKeys = [
		"access_token", "client_ref", "expires_at", "gateway_endpoint", "instance_ref", "membership_ref", "profile_ref",
		"refresh_token", "refresh_token_absolute_expires_at", "refresh_token_idle_expires_at", "registration_ref",
		"schema_version", "subject_ref",
	];
	if (record.schema_version !== "ceal.client_session_store.v1") throw new CealSessionStoreError("invalid_store");
	if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...expectedKeys].sort())) {
		throw new CealSessionStoreError("invalid_store");
	}
	const session = {
		gatewayEndpoint: record.gateway_endpoint,
		profileRef: record.profile_ref,
		membershipRef: record.membership_ref,
		registrationRef: record.registration_ref,
		clientRef: record.client_ref,
		subjectRef: record.subject_ref,
		instanceRef: record.instance_ref,
		accessToken: record.access_token,
		expiresAt: record.expires_at,
		refreshToken: record.refresh_token,
		refreshTokenIdleExpiresAt: record.refresh_token_idle_expires_at,
		refreshTokenAbsoluteExpiresAt: record.refresh_token_absolute_expires_at,
	};
	validateSession(session);
	return session as CealStoredSession;
}

interface CandidateSession {
	gatewayEndpoint: unknown;
	profileRef: unknown;
	membershipRef: unknown;
	registrationRef: unknown;
	clientRef: unknown;
	subjectRef: unknown;
	instanceRef: unknown;
	accessToken: unknown;
	expiresAt: unknown;
	refreshToken: unknown;
	refreshTokenIdleExpiresAt: unknown;
	refreshTokenAbsoluteExpiresAt: unknown;
}

function validateSession(value: CandidateSession): void {
	validateBaseSession(value);
	validateRefreshSession(value);
	validateSessionReferences(value);
}

function validateBaseSession(value: CandidateSession): void {
	const valid = typeof value.gatewayEndpoint === "string" && safeEndpoint(value.gatewayEndpoint)
		&& typeof value.accessToken === "string" && /^ceal_personal_[A-Za-z0-9_-]{43}$/u.test(value.accessToken)
		&& typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt));
	if (!valid) throw new CealSessionStoreError("invalid_store");
}

function validateRefreshSession(value: CandidateSession): void {
	const valid = typeof value.refreshToken === "string" && /^ceal_refresh_[A-Za-z0-9_-]{43}$/u.test(value.refreshToken)
		&& typeof value.refreshTokenIdleExpiresAt === "string" && Number.isFinite(Date.parse(value.refreshTokenIdleExpiresAt))
		&& typeof value.refreshTokenAbsoluteExpiresAt === "string" && Number.isFinite(Date.parse(value.refreshTokenAbsoluteExpiresAt));
	if (!valid) throw new CealSessionStoreError("invalid_store");
}

function validateSessionReferences(value: CandidateSession): void {
	for (const key of ["profileRef", "membershipRef", "registrationRef", "clientRef", "subjectRef", "instanceRef"] as const) {
		if (typeof value[key] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value[key])) {
			throw new CealSessionStoreError("invalid_store");
		}
	}
}

function safeEndpoint(value: string): boolean {
	try {
		const endpoint = new URL(value);
		const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
		return !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash
			&& (endpoint.protocol === "https:" || (endpoint.protocol === "http:" && (host === "127.0.0.1" || host === "::1")));
	} catch { return false; }
}
