import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeCealLocalStoreFile } from "./local-store-file.js";
import { assertDirectoryIfPresent, assertFile, prepareDirectory, removeOwnedFile } from "./local-store-guards.js";
import { withLocalStoreLock } from "./local-store-lock.js";
import { isCealSafeEndpoint } from "./safe-endpoint.js";
import { CEAL_SAFE_REF } from "./safe-ref.js";

const STATE_LOCK_DIRECTORY = "client-session.lock";
const STATE_LOCK_MAX_WAIT_MS = 30_000;

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
	/** A v1 rotation is blocked locally; never resend its one-time credential. */
	renewalBlockedReason?: "outcome_unknown" | "refresh_invalid" | "refresh_expired" | "refresh_replayed" | "refresh_revoked";
}

export class CealSessionStoreError extends Error {
	override readonly name = "CealSessionStoreError";
	constructor(readonly code: "home_unavailable" | "refresh_busy" | "unsafe_store" | "invalid_store") {
		super(`Ceal session store ${code.replaceAll("_", " ")}.`);
	}
}

interface CealLockedSessionStore {
	load(): Promise<CealStoredSession | null>;
	// Unconditional write, for the enrollment paths that decide what may replace
	// what by comparing identities rather than by matching a refresh token. A
	// rotation still uses `replace`, whose compare-and-set is what stops two
	// renewals from committing the same one-time credential twice.
	save(session: CealStoredSession): Promise<void>;
	replace(expectedRefreshToken: string, session: CealStoredSession): Promise<void>;
	remove(): Promise<void>;
}

export interface CealSessionStore {
	load(): Promise<CealStoredSession | null>;
	save(session: CealStoredSession, onLockAcquired?: (waitedMs: number) => void): Promise<void>;
	remove(onLockAcquired?: (waitedMs: number) => void): Promise<void>;
	withStateLock<T>(action: (store: CealLockedSessionStore) => Promise<T>, onLockAcquired?: (waitedMs: number) => void): Promise<T>;
}

export function createCealSessionStore(home: string | undefined): CealSessionStore {
	if (!home || !path.isAbsolute(home)) throw new CealSessionStoreError("home_unavailable");
	const directory = path.join(home, ".ceal");
	const file = path.join(directory, "client-session.json");
	return {
		async load() {
			return readSessionFile(directory, file);
		},
		async save(session, onLockAcquired) {
			return withStateLock(
				directory,
				async () => {
					writeSessionFile(directory, file, session);
				},
				onLockAcquired,
			);
		},
		async remove(onLockAcquired) {
			return withStateLock(
				directory,
				async () => {
					removeSessionFile(directory, file);
				},
				onLockAcquired,
			);
		},
		async withStateLock(action, onLockAcquired) {
			return withStateLock(
				directory,
				async () =>
					action({
						load: async () => readSessionFile(directory, file),
						save: async (session) => writeSessionFile(directory, file, session),
						replace: async (expectedRefreshToken, session) => replaceSessionFile(directory, file, expectedRefreshToken, session),
						remove: async () => removeSessionFile(directory, file),
					}),
				onLockAcquired,
			);
		},
	};
}

function readSessionFile(directory: string, file: string): CealStoredSession | null {
	if (!assertDirectoryIfPresent(directory, unsafeSessionStore, true)) return null;
	if (!existsSync(file)) return null;
	assertFile(file, unsafeSessionStore, true);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		throw new CealSessionStoreError("invalid_store");
	}
	return parseSession(parsed);
}

function writeSessionFile(directory: string, file: string, session: CealStoredSession): void {
	validateSession(session);
	prepareDirectory(directory, unsafeSessionStore, true);
	writeCealLocalStoreFile({
		directory,
		file,
		prefix: "client-session",
		contents: `${JSON.stringify(serializeSession(session), null, 2)}\n`,
		unsafe: unsafeSessionStore,
		requireMode: true,
	});
}

function replaceSessionFile(directory: string, file: string, expectedRefreshToken: string, session: CealStoredSession): void {
	const current = readSessionFile(directory, file);
	if (!current || current.refreshToken !== expectedRefreshToken) throw new CealSessionStoreError("invalid_store");
	writeSessionFile(directory, file, session);
}

function removeSessionFile(directory: string, file: string): void {
	removeOwnedFile(directory, file, unsafeSessionStore);
}

async function withStateLock<T>(directory: string, action: () => Promise<T>, onAcquired?: (waitedMs: number) => void): Promise<T> {
	prepareDirectory(directory, unsafeSessionStore, true);
	// The refresh this guards is a Gateway roundtrip, so a contending process
	// waits far longer than a local-file writer would before calling it busy.
	return withLocalStoreLock(
		{
			lockPath: path.join(directory, STATE_LOCK_DIRECTORY),
			maxWaitMs: STATE_LOCK_MAX_WAIT_MS,
			onUnsafe: unsafeSessionStore,
			onBusy: () => {
				throw new CealSessionStoreError("refresh_busy");
			},
			onAcquired,
		},
		action,
	);
}

/**
 * The store's two schema versions, named once. The sibling stores in this
 * directory each hold theirs at one constant (`CACHE_SCHEMA_VERSION`,
 * `SPOOL_SCHEMA_VERSION`); this one spelled its two as bare literals at five
 * sites, so a third version would have five places to find and nothing to catch
 * the one that was missed.
 *
 * `V2` is not a replacement for `V1`. A record carries V2 exactly when it holds a
 * renewal-blocked reason, so both remain current and the read path must keep
 * accepting either.
 */
const SESSION_STORE_SCHEMA_V1 = "ceal.client_session_store.v1";
const SESSION_STORE_SCHEMA_V2 = "ceal.client_session_store.v2";

function serializeSession(session: CealStoredSession): Record<string, unknown> {
	const blockedReason = session.renewalBlockedReason;
	return {
		schema_version: blockedReason ? SESSION_STORE_SCHEMA_V2 : SESSION_STORE_SCHEMA_V1,
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
		...(blockedReason ? { renewal_blocked_reason: blockedReason } : {}),
	};
}

function parseSession(value: unknown): CealStoredSession {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new CealSessionStoreError("invalid_store");
	const record = value as Record<string, unknown>;
	const baseKeys = [
		"access_token",
		"client_ref",
		"expires_at",
		"gateway_endpoint",
		"instance_ref",
		"membership_ref",
		"profile_ref",
		"refresh_token",
		"refresh_token_absolute_expires_at",
		"refresh_token_idle_expires_at",
		"registration_ref",
		"schema_version",
		"subject_ref",
	];
	const expectedKeys = record.schema_version === SESSION_STORE_SCHEMA_V2 ? [...baseKeys, "renewal_blocked_reason"] : baseKeys;
	if (record.schema_version !== SESSION_STORE_SCHEMA_V1 && record.schema_version !== SESSION_STORE_SCHEMA_V2)
		throw new CealSessionStoreError("invalid_store");
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
		...(record.schema_version === SESSION_STORE_SCHEMA_V2 ? { renewalBlockedReason: record.renewal_blocked_reason } : {}),
	};
	if (record.schema_version === SESSION_STORE_SCHEMA_V2 && !validBlockedReason(record.renewal_blocked_reason))
		throw new CealSessionStoreError("invalid_store");
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
	const valid =
		typeof value.gatewayEndpoint === "string" &&
		isCealSafeEndpoint(value.gatewayEndpoint) &&
		typeof value.accessToken === "string" &&
		/^ceal_personal_[A-Za-z0-9_-]{43}$/u.test(value.accessToken) &&
		typeof value.expiresAt === "string" &&
		Number.isFinite(Date.parse(value.expiresAt));
	if (!valid) throw new CealSessionStoreError("invalid_store");
}

function validateRefreshSession(value: CandidateSession): void {
	const valid =
		typeof value.refreshToken === "string" &&
		/^ceal_refresh_[A-Za-z0-9_-]{43}$/u.test(value.refreshToken) &&
		typeof value.refreshTokenIdleExpiresAt === "string" &&
		Number.isFinite(Date.parse(value.refreshTokenIdleExpiresAt)) &&
		typeof value.refreshTokenAbsoluteExpiresAt === "string" &&
		Number.isFinite(Date.parse(value.refreshTokenAbsoluteExpiresAt));
	if (!valid) throw new CealSessionStoreError("invalid_store");
}

function validateSessionReferences(value: CandidateSession): void {
	for (const key of ["profileRef", "membershipRef", "registrationRef", "clientRef", "subjectRef", "instanceRef"] as const) {
		if (typeof value[key] !== "string" || !CEAL_SAFE_REF.test(value[key])) {
			throw new CealSessionStoreError("invalid_store");
		}
	}
}

function validBlockedReason(value: unknown): value is NonNullable<CealStoredSession["renewalBlockedReason"]> {
	return (
		value === "outcome_unknown" ||
		value === "refresh_invalid" ||
		value === "refresh_expired" ||
		value === "refresh_replayed" ||
		value === "refresh_revoked"
	);
}

// Names this store's refusal once so the shared guards can raise it without
// knowing which store called them.
function unsafeSessionStore(): never {
	throw new CealSessionStoreError("unsafe_store");
}
