import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// Client-local cache of the Gateway discovery catalog. This is the demand-side
// half of the reconciling-store design: `ceal capabilities` costs ~6.3s almost
// entirely in the Gateway discovery probe (~4.3s, MEASURED 2026-07-18), while the
// handshake is ~0.13s. A warm session therefore re-runs the cheap live handshake
// (the auth gate) but serves the catalog from here, skipping the probe.
//
// The cache is ADVISORY, not authoritative: every `ceal call` re-validates live
// at the Gateway (verify-before-act), so a stale entry can only omit a
// newly-appeared resource (re-fetched on TTL/`--fresh`) or name one since revoked
// (which fails closed at call time). Consequently every read failure — missing,
// corrupt, unsafe-mode, schema drift — degrades to a MISS (never throws), so the
// cache can never break a command; the caller simply probes live and repopulates.

const CACHE_FILE = "client-discovery-cache.json";
const CACHE_SCHEMA_VERSION = "ceal.client_discovery_cache.v1";
const DISCOVERY_SCHEMA_VERSION = "ceal.gateway_discovery.v2";
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface CealDiscoveryCacheKey {
	gatewayEndpoint: string;
	profileRef: string;
	membershipRef: string;
	negotiatedProtocolVersion: string;
}

export interface CealDiscoveryCacheEntry {
	key: CealDiscoveryCacheKey;
	/** Epoch milliseconds when the live discovery that produced this entry ran. */
	cachedAt: number;
	/** The Gateway discovery value, stored opaquely and re-emitted verbatim. */
	discovery: Record<string, unknown>;
}

export class CealDiscoveryCacheStoreError extends Error {
	override readonly name = "CealDiscoveryCacheStoreError";
	constructor(readonly code: "home_unavailable" | "unsafe_store") {
		super(`Ceal discovery cache store ${code.replaceAll("_", " ")}.`);
	}
}

export interface CealDiscoveryCacheStore {
	/** Load the single cached entry, or null on any absence/anomaly (soft miss). */
	load(): Promise<CealDiscoveryCacheEntry | null>;
	save(entry: CealDiscoveryCacheEntry): Promise<void>;
	remove(): Promise<void>;
}

export function createCealDiscoveryCacheStore(home: string | undefined): CealDiscoveryCacheStore {
	if (!home || !path.isAbsolute(home)) throw new CealDiscoveryCacheStoreError("home_unavailable");
	const directory = path.join(home, ".ceal");
	const file = path.join(directory, CACHE_FILE);
	return {
		async load() { return readCacheEntry(directory, file); },
		async save(entry) { writeCacheEntry(directory, file, entry); },
		async remove() { removeCacheEntry(file); },
	};
}

/**
 * Determine whether a cached entry may serve the current request: its key must
 * match the live handshake's identity and it must be within the freshness window.
 */
export function discoveryCacheEntryUsable(
	entry: CealDiscoveryCacheEntry, key: CealDiscoveryCacheKey, now: number, ttlMs: number,
): boolean {
	return keysMatch(entry.key, key) && entry.cachedAt <= now && now - entry.cachedAt < ttlMs;
}

function keysMatch(a: CealDiscoveryCacheKey, b: CealDiscoveryCacheKey): boolean {
	return a.gatewayEndpoint === b.gatewayEndpoint
		&& a.profileRef === b.profileRef
		&& a.membershipRef === b.membershipRef
		&& a.negotiatedProtocolVersion === b.negotiatedProtocolVersion;
}

function readCacheEntry(directory: string, file: string): CealDiscoveryCacheEntry | null {
	if (!existsSync(file)) return null;
	if (!safeExistingFile(directory, file)) return null;
	let parsed: unknown;
	try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
	return parseCacheEntry(parsed);
}

function parseCacheEntry(value: unknown): CealDiscoveryCacheEntry | null {
	if (!isRecord(value) || value.schema_version !== CACHE_SCHEMA_VERSION) return null;
	const endpoint = value.gateway_endpoint;
	const profile = value.profile_ref;
	const membership = value.membership_ref;
	const protocol = value.negotiated_protocol_version;
	const cachedAtRaw = value.cached_at;
	const discovery = value.discovery;
	if (!safeEndpoint(endpoint) || !safeRef(profile) || !safeRef(membership) || !safeRef(protocol)) return null;
	if (typeof cachedAtRaw !== "string") return null;
	const cachedAt = Date.parse(cachedAtRaw);
	if (!Number.isFinite(cachedAt)) return null;
	if (!isRecord(discovery) || discovery.schema_version !== DISCOVERY_SCHEMA_VERSION) return null;
	return {
		key: { gatewayEndpoint: endpoint, profileRef: profile, membershipRef: membership, negotiatedProtocolVersion: protocol },
		cachedAt,
		discovery,
	};
}

function writeCacheEntry(directory: string, file: string, entry: CealDiscoveryCacheEntry): void {
	validateEntry(entry);
	prepareDirectory(directory);
	if (existsSync(file)) assertFile(file);
	const temporary = path.join(directory, `.client-discovery-cache.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
	try {
		writeFileSync(temporary, `${JSON.stringify(serializeEntry(entry), null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
		renameSync(temporary, file);
		chmodSync(file, 0o600);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function removeCacheEntry(file: string): void {
	if (!existsSync(file)) return;
	const stat = lstatSync(file);
	// Only remove a plain file we own; leave anything unexpected untouched.
	if (stat.isSymbolicLink() || !stat.isFile()) return;
	rmSync(file, { force: true });
}

function serializeEntry(entry: CealDiscoveryCacheEntry): Record<string, unknown> {
	return {
		schema_version: CACHE_SCHEMA_VERSION,
		gateway_endpoint: entry.key.gatewayEndpoint,
		profile_ref: entry.key.profileRef,
		membership_ref: entry.key.membershipRef,
		negotiated_protocol_version: entry.key.negotiatedProtocolVersion,
		cached_at: new Date(entry.cachedAt).toISOString(),
		discovery: entry.discovery,
	};
}

function validateEntry(entry: CealDiscoveryCacheEntry): void {
	const usable = safeEndpoint(entry.key.gatewayEndpoint) && safeRef(entry.key.profileRef)
		&& safeRef(entry.key.membershipRef) && safeRef(entry.key.negotiatedProtocolVersion)
		&& Number.isFinite(entry.cachedAt) && isRecord(entry.discovery)
		&& entry.discovery.schema_version === DISCOVERY_SCHEMA_VERSION;
	if (!usable) throw new CealDiscoveryCacheStoreError("unsafe_store");
}

function safeExistingFile(directory: string, file: string): boolean {
	try {
		const dir = lstatSync(directory);
		// Match the session store's directory guarantee (0o700, no symlink): reached
		// via the explicit-gateway path too, which never runs the session store's
		// assertDirectory first. A wider-mode dir soft-fails to a live probe.
		if (dir.isSymbolicLink() || !dir.isDirectory() || (dir.mode & 0o777) !== 0o700) return false;
		const stat = lstatSync(file);
		return !stat.isSymbolicLink() && stat.isFile() && (stat.mode & 0o777) === 0o600;
	} catch { return false; }
}

function prepareDirectory(directory: string): void {
	if (!existsSync(directory)) {
		try { mkdirSync(directory, { mode: 0o700 }); } catch { throw new CealDiscoveryCacheStoreError("unsafe_store"); }
	}
	const stat = lstatSync(directory);
	if (stat.isSymbolicLink() || !stat.isDirectory()) throw new CealDiscoveryCacheStoreError("unsafe_store");
	chmodSync(directory, 0o700);
}

function assertFile(file: string): void {
	const stat = lstatSync(file);
	if (stat.isSymbolicLink() || !stat.isFile()) throw new CealDiscoveryCacheStoreError("unsafe_store");
}

function safeRef(value: unknown): value is string {
	return typeof value === "string" && SAFE_REF.test(value);
}

function safeEndpoint(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		const endpoint = new URL(value);
		const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
		return !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash
			&& (endpoint.protocol === "https:" || (endpoint.protocol === "http:" && (host === "127.0.0.1" || host === "::1")));
	} catch { return false; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
