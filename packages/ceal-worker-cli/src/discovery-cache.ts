import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { CEAL_PROTOCOL_VERSION, decodeCealClientResponse } from "@corca-ai/ceal-protocol";
import { writeCealLocalStoreFile } from "./local-store-file.js";
import { prepareDirectory, removableFile, safeExistingFile } from "./local-store-guards.js";

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

// Default freshness for a served discovery-catalog entry. It lives HERE, beside
// the freshness predicate, rather than in a caller: it was previously declared
// in `index.ts` and shadowed by a second literal in `observer.ts`, so the CLI and
// the observer projection could disagree about the same entry's `within_ttl`.
//
// 30 minutes is an OPERATOR MEASUREMENT (2026-08-07), not a derived value. The
// catalog is advisory and every `ceal call` re-validates live, so the window
// trades staleness for eliding the ~4.3s probe. What the window is NOT free of:
// `cachedCapabilityEffect` classifies a capability's write-effect from this same
// entry, so a capability reclassified read -> write by a policy or connector
// change keeps its stale `read` classification for up to the TTL, and the
// unknown-outcome write caution is suppressed for that window. Accepted because
// the Gateway is authoritative at call time; recorded because it is not zero.
//
// `--fresh` forces a live probe and `CEAL_DISCOVERY_CACHE_TTL_MS` overrides this.
export const DEFAULT_DISCOVERY_CACHE_TTL_MS = 1_800_000;

const CACHE_FILE = "client-discovery-cache.json";
const CACHE_SCHEMA_VERSION = "ceal.client_discovery_cache.v1";
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CACHED_DISCOVERY_REQUEST_ID = "cache:discovery";
const CACHED_DISCOVERY_PROOF_REF = "cache:local";

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
		async load() {
			return readCacheEntry(directory, file);
		},
		async save(entry) {
			writeCacheEntry(directory, file, entry);
		},
		async remove() {
			removeCacheEntry(file);
		},
	};
}

/**
 * Determine whether a cached entry may serve the current request: its key must
 * match the live handshake's identity and it must be within the freshness window.
 */
export function discoveryCacheEntryUsable(entry: CealDiscoveryCacheEntry, key: CealDiscoveryCacheKey, now: number, ttlMs: number): boolean {
	return (
		isValidCacheKey(entry.key) &&
		isValidCacheKey(key) &&
		isValidCachedDiscovery(entry.discovery, entry.key) &&
		keysMatch(entry.key, key) &&
		discoveryCacheFreshness(entry.cachedAt, now, ttlMs).withinTtl
	);
}

/**
 * The single owner of "is this cached entry still fresh", and of the age an
 * operator is shown for it.
 *
 * `observer.ts` renders the same judgement, and while the two were separate
 * copies they drifted: this one grew the `cachedAt <= now` guard and the
 * observer's did not, so after a backward clock step an entry stamped in the
 * future was reported `within_ttl: true` while `capabilities` treated it as a
 * miss and re-probed the Gateway on every call. An operator asking why the cache
 * never serves was told, by the tool built to answer that, that it was fresh.
 */
export function discoveryCacheFreshness(cachedAt: number, now: number, ttlMs: number): { ageMs: number; withinTtl: boolean } {
	const sane = Number.isFinite(cachedAt) && Number.isFinite(now) && Number.isSafeInteger(ttlMs) && ttlMs >= 0;
	return {
		// Clamped, because a negative age is not a thing to render at an operator.
		// `withinTtl` is what carries the anomaly, and it refuses the entry.
		ageMs: sane ? Math.max(0, now - cachedAt) : 0,
		withinTtl: sane && cachedAt <= now && now - cachedAt < ttlMs,
	};
}

function keysMatch(a: CealDiscoveryCacheKey, b: CealDiscoveryCacheKey): boolean {
	return (
		a.gatewayEndpoint === b.gatewayEndpoint &&
		a.profileRef === b.profileRef &&
		a.membershipRef === b.membershipRef &&
		a.negotiatedProtocolVersion === b.negotiatedProtocolVersion
	);
}

function readCacheEntry(directory: string, file: string): CealDiscoveryCacheEntry | null {
	if (!existsSync(file)) return null;
	if (!safeExistingFile(directory, file)) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return null;
	}
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
	const key = { gatewayEndpoint: endpoint, profileRef: profile, membershipRef: membership, negotiatedProtocolVersion: protocol };
	if (!isValidCacheKey(key)) return null;
	if (typeof cachedAtRaw !== "string") return null;
	const cachedAt = Date.parse(cachedAtRaw);
	if (!Number.isFinite(cachedAt)) return null;
	if (!isValidCachedDiscovery(discovery, key)) return null;
	return {
		key,
		cachedAt,
		discovery,
	};
}

function writeCacheEntry(directory: string, file: string, entry: CealDiscoveryCacheEntry): void {
	validateEntry(entry);
	prepareDirectory(directory, unsafeDiscoveryCache);
	writeCealLocalStoreFile({
		directory,
		file,
		prefix: "client-discovery-cache",
		contents: `${JSON.stringify(serializeEntry(entry), null, 2)}\n`,
		unsafe: unsafeDiscoveryCache,
	});
}

function removeCacheEntry(file: string): void {
	// removableFile refuses anything that is not a plain file we own, so a
	// symlink or directory left in the store is never deleted by cleanup.
	if (removableFile(file)) rmSync(file, { force: true });
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
	const usable = isValidCacheKey(entry.key) && Number.isFinite(entry.cachedAt) && isValidCachedDiscovery(entry.discovery, entry.key);
	if (!usable) throw new CealDiscoveryCacheStoreError("unsafe_store");
}

function isValidCacheKey(value: unknown): value is CealDiscoveryCacheKey {
	if (!isRecord(value)) return false;
	return (
		safeEndpoint(value.gatewayEndpoint) &&
		safeRef(value.profileRef) &&
		safeRef(value.membershipRef) &&
		safeRef(value.negotiatedProtocolVersion)
	);
}

// A cache entry crosses the same untyped disk boundary as a Gateway response.
// Re-use the protocol decoder instead of trusting its top-level schema tag or
// maintaining a weaker second discovery validator here.
function isValidCachedDiscovery(value: unknown, key: CealDiscoveryCacheKey): value is Record<string, unknown> {
	try {
		const request = {
			request_id: CACHED_DISCOVERY_REQUEST_ID,
			protocol_version: CEAL_PROTOCOL_VERSION,
			operation: "discover" as const,
			profile_ref: key.profileRef,
			body: {},
		};
		const response = decodeCealClientResponse(
			{
				ok: true,
				request_id: CACHED_DISCOVERY_REQUEST_ID,
				protocol_version: CEAL_PROTOCOL_VERSION,
				proof_ref_or_unavailable: CACHED_DISCOVERY_PROOF_REF,
				value,
			},
			request,
		);
		return response.ok && response.value.membership_ref === key.membershipRef;
	} catch {
		return false;
	}
}

function safeRef(value: unknown): value is string {
	return typeof value === "string" && SAFE_REF.test(value);
}

function safeEndpoint(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		const endpoint = new URL(value);
		const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
		return (
			!endpoint.username &&
			!endpoint.password &&
			!endpoint.search &&
			!endpoint.hash &&
			(endpoint.protocol === "https:" || (endpoint.protocol === "http:" && (host === "127.0.0.1" || host === "::1")))
		);
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Names this store's refusal once so the shared guards can raise it without
// knowing which store called them.
function unsafeDiscoveryCache(): never {
	throw new CealDiscoveryCacheStoreError("unsafe_store");
}
