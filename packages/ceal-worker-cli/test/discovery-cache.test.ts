import "../../../test/require-source-lane.ts";
import type { CealDiscoveryCacheEntry, CealDiscoveryCacheKey } from "../dist/discovery-cache.js";
import { CealDiscoveryCacheStoreError, createCealDiscoveryCacheStore, discoveryCacheEntryUsable } from "../dist/discovery-cache.js";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const KEY: CealDiscoveryCacheKey = {
	gatewayEndpoint: "https://gateway.example.test/api/ceal/v1",
	profileRef: "profile:narnia",
	membershipRef: "membership:narnia",
	negotiatedProtocolVersion: "1.4.0",
};

function entry(overrides: Partial<CealDiscoveryCacheEntry> = {}): CealDiscoveryCacheEntry {
	return {
		key: KEY,
		cachedAt: Date.parse("2026-07-18T12:00:00.000Z"),
		discovery: {
			schema_version: "ceal.gateway_discovery.v3",
			phase: "target_page",
			profile_ref: KEY.profileRef,
			membership_ref: KEY.membershipRef,
			capabilities: [],
			targets: [],
			target_catalog: { target_count: 0, returned_count: 0, complete: true },
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		},
		...overrides,
	};
}

test("discovery cache writes owner-only and reads the entry back", async () => {
	await withHome(async (home) => {
		const store = createCealDiscoveryCacheStore(home);
		assert.equal(await store.load(), null);
		await store.remove();
		await store.save(entry());
		assert.deepEqual(await store.load(), entry());
		const file = path.join(home, ".ceal", "client-discovery-cache.json");
		assert.equal(statSync(file).mode & 0o777, 0o600);
		await store.remove();
		assert.equal(await store.load(), null);
	});
});

test("discovery cache read degrades to a miss on any anomaly instead of throwing", async () => {
	// Corrupt JSON, wrong schema, wrong discovery schema, and unsafe mode all
	// return null so an advisory cache can never break a command.
	await withHome(async (home) => {
		const file = cacheFile(home);
		writeFileSync(file, "{ not json", { mode: 0o600 });
		assert.equal(await createCealDiscoveryCacheStore(home).load(), null);
	});
	await withHome(async (home) => {
		writeFileSync(cacheFile(home), JSON.stringify({ schema_version: "wrong" }), { mode: 0o600 });
		assert.equal(await createCealDiscoveryCacheStore(home).load(), null);
	});
	await withHome(async (home) => {
		const store = createCealDiscoveryCacheStore(home);
		await store.save(entry());
		chmodSync(cacheFile(home), 0o644);
		assert.equal(await store.load(), null);
	});
	// A wider-mode `.ceal` directory soft-fails the read (matches the session
	// store's 0o700 guarantee; reachable via the explicit-gateway path).
	await withHome(async (home) => {
		const store = createCealDiscoveryCacheStore(home);
		await store.save(entry());
		chmodSync(path.join(home, ".ceal"), 0o755);
		assert.equal(await store.load(), null);
	});
});

test("discovery cache read rejects a foreign discovery schema as a miss", async () => {
	await withHome(async (home) => {
		writeFileSync(
			cacheFile(home),
			JSON.stringify({
				schema_version: "ceal.client_discovery_cache.v1",
				gateway_endpoint: KEY.gatewayEndpoint,
				profile_ref: KEY.profileRef,
				membership_ref: KEY.membershipRef,
				negotiated_protocol_version: KEY.negotiatedProtocolVersion,
				cached_at: "2026-07-18T12:00:00.000Z",
				discovery: { schema_version: "ceal.gateway_discovery.v1" },
			}),
			{ mode: 0o600 },
		);
		assert.equal(await createCealDiscoveryCacheStore(home).load(), null);
	});
});

test("discovery cache read rejects a partial current-schema discovery value as a miss", async () => {
	await withHome(async (home) => {
		writeFileSync(
			cacheFile(home),
			JSON.stringify({
				schema_version: "ceal.client_discovery_cache.v1",
				gateway_endpoint: KEY.gatewayEndpoint,
				profile_ref: KEY.profileRef,
				membership_ref: KEY.membershipRef,
				negotiated_protocol_version: KEY.negotiatedProtocolVersion,
				cached_at: "2026-07-18T12:00:00.000Z",
				discovery: { schema_version: "ceal.gateway_discovery.v3", phase: "target_page" },
			}),
			{ mode: 0o600 },
		);
		assert.equal(await createCealDiscoveryCacheStore(home).load(), null);
	});
});

test("discovery cache save fails closed on an invalid entry", async () => {
	await withHome(async (home) => {
		const store = createCealDiscoveryCacheStore(home);
		await assert.rejects(store.save(entry({ discovery: { schema_version: "nope" } })), hasCode("unsafe_store"));
		await assert.rejects(store.save(entry({ key: { ...KEY, profileRef: "bad ref" } })), hasCode("unsafe_store"));
	});
});

test("discovery cache save leaves a symlinked store untouched", async () => {
	await withHome(async (home) => {
		symlinkSync(path.join(home, "outside"), path.join(home, ".ceal"));
		await assert.rejects(createCealDiscoveryCacheStore(home).save(entry()), hasCode("unsafe_store"));
	});
});

test("discovery cache cleanup never follows a substituted store parent", async () => {
	await withHome(async (home) => {
		const outside = path.join(home, "outside");
		mkdirSync(outside, { mode: 0o700 });
		const externalCache = path.join(outside, "client-discovery-cache.json");
		writeFileSync(externalCache, "external\n", { mode: 0o600 });
		symlinkSync(outside, path.join(home, ".ceal"));
		await assert.rejects(createCealDiscoveryCacheStore(home).remove(), CealDiscoveryCacheStoreError);
		assert.equal(existsSync(externalCache), true);
	});
});

test("discovery cache cleanup refuses a store parent whose permissions widened", async () => {
	await withHome(async (home) => {
		const store = createCealDiscoveryCacheStore(home);
		await store.save(entry());
		chmodSync(path.join(home, ".ceal"), 0o755);
		await assert.rejects(store.remove(), CealDiscoveryCacheStoreError);
		assert.equal(existsSync(path.join(home, ".ceal", "client-discovery-cache.json")), true);
	});
});

test("discoveryCacheEntryUsable enforces key match and freshness", () => {
	const now = Date.parse("2026-07-18T12:00:00.000Z");
	const fresh = entry({ cachedAt: now - 1_000 });
	assert.equal(discoveryCacheEntryUsable(fresh, KEY, now, 5_000), true);
	assert.equal(discoveryCacheEntryUsable(fresh, KEY, now, 500), false, "past TTL is stale");
	assert.equal(discoveryCacheEntryUsable(entry({ cachedAt: now + 10_000 }), KEY, now, 5_000), false, "future stamp is not usable");
	assert.equal(discoveryCacheEntryUsable(fresh, { ...KEY, profileRef: "profile:other" }, now, 5_000), false, "key mismatch");
	assert.equal(discoveryCacheEntryUsable(fresh, { ...KEY, negotiatedProtocolVersion: "1.2.0" }, now, 5_000), false, "protocol mismatch");
	assert.equal(
		discoveryCacheEntryUsable(
			entry({
				cachedAt: now - 1_000,
				discovery: { ...entry().discovery, membership_ref: "membership:other" },
			}),
			KEY,
			now,
			5_000,
		),
		false,
		"discovery membership mismatch",
	);
});

function cacheFile(home: string): string {
	mkdirSync(path.join(home, ".ceal"), { recursive: true, mode: 0o700 });
	return path.join(home, ".ceal", "client-discovery-cache.json");
}

function hasCode(code: CealDiscoveryCacheStoreError["code"]): (error: unknown) => boolean {
	return (error: unknown) => error instanceof CealDiscoveryCacheStoreError && error.code === code;
}

async function withHome(callback: (home: string) => void | Promise<void>): Promise<void> {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-discovery-cache-"));
	try {
		await callback(home);
	} finally {
		(await import("node:fs")).rmSync(home, { recursive: true, force: true });
	}
}
