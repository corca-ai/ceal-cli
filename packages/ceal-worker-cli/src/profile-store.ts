import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface CealStoredProfile {
	gatewayEndpoint: string;
	profileRef: string;
	registrationRef: string;
	clientRef: string;
	runnerRef: string;
	accessToken: string;
	expiresAt: string;
}

export class CealProfileStoreError extends Error {
	override readonly name = "CealProfileStoreError";
	constructor(readonly code: "home_unavailable" | "unsafe_store" | "invalid_store" | "profile_expired") {
		super(`Ceal profile store ${code.replaceAll("_", " ")}.`);
	}
}

export function createCealProfileStore(home: string | undefined): {
	load(): Promise<CealStoredProfile | null>;
	save(profile: CealStoredProfile): Promise<void>;
} {
	if (!home || !path.isAbsolute(home)) throw new CealProfileStoreError("home_unavailable");
	const directory = path.join(home, ".ceal");
	const file = path.join(directory, "client-profile.json");
	return {
		async load() {
			if (!existsSync(file)) return null;
			assertDirectory(directory);
			assertFile(file);
			let parsed: unknown;
			try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { throw new CealProfileStoreError("invalid_store"); }
			const profile = parseProfile(parsed);
			if (Date.parse(profile.expiresAt) <= Date.now()) throw new CealProfileStoreError("profile_expired");
			return profile;
		},
		async save(profile) {
			validateProfile(profile);
			prepareDirectory(directory);
			if (existsSync(file)) assertFile(file);
			const temporary = path.join(directory, `.client-profile.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
			try {
				writeFileSync(temporary, `${JSON.stringify(serializeProfile(profile), null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
				renameSync(temporary, file);
				chmodSync(file, 0o600);
			} finally {
				rmSync(temporary, { force: true });
			}
		},
	};
}

function prepareDirectory(directory: string): void {
	if (!existsSync(directory)) {
		try { mkdirSync(directory, { mode: 0o700 }); } catch { throw new CealProfileStoreError("unsafe_store"); }
	}
	assertDirectory(directory);
	chmodSync(directory, 0o700);
}

function assertDirectory(directory: string): void {
	const stat = lstatSync(directory);
	if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o777) !== 0o700) throw new CealProfileStoreError("unsafe_store");
}

function assertFile(file: string): void {
	const stat = lstatSync(file);
	if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new CealProfileStoreError("unsafe_store");
}

function serializeProfile(profile: CealStoredProfile): Record<string, unknown> {
	return {
		schema_version: "ceal.client_profile_store.v1",
		gateway_endpoint: profile.gatewayEndpoint,
		profile_ref: profile.profileRef,
		registration_ref: profile.registrationRef,
		client_ref: profile.clientRef,
		runner_ref: profile.runnerRef,
		access_token: profile.accessToken,
		expires_at: profile.expiresAt,
	};
}

function parseProfile(value: unknown): CealStoredProfile {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new CealProfileStoreError("invalid_store");
	const record = value as Record<string, unknown>;
	const keys = ["access_token", "client_ref", "expires_at", "gateway_endpoint", "profile_ref", "registration_ref", "runner_ref", "schema_version"];
	if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(keys.sort()) || record.schema_version !== "ceal.client_profile_store.v1") {
		throw new CealProfileStoreError("invalid_store");
	}
	const profile = {
		gatewayEndpoint: record.gateway_endpoint,
		profileRef: record.profile_ref,
		registrationRef: record.registration_ref,
		clientRef: record.client_ref,
		runnerRef: record.runner_ref,
		accessToken: record.access_token,
		expiresAt: record.expires_at,
	};
	validateProfile(profile);
	return profile as CealStoredProfile;
}

interface CandidateProfile {
	gatewayEndpoint: unknown;
	profileRef: unknown;
	registrationRef: unknown;
	clientRef: unknown;
	runnerRef: unknown;
	accessToken: unknown;
	expiresAt: unknown;
}

function validateProfile(value: CandidateProfile): void {
	if (typeof value.gatewayEndpoint !== "string" || !safeEndpoint(value.gatewayEndpoint)
		|| typeof value.accessToken !== "string" || !/^ceal_personal_[A-Za-z0-9_-]{43}$/u.test(value.accessToken)
		|| typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) {
		throw new CealProfileStoreError("invalid_store");
	}
	for (const key of ["profileRef", "registrationRef", "clientRef", "runnerRef"] as const) {
		if (typeof value[key] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value[key])) {
			throw new CealProfileStoreError("invalid_store");
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
