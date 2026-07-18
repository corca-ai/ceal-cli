import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	CealDiscoveryCacheStoreError,
	createCealDiscoveryCacheStore,
	discoveryCacheEntryUsable,
} from "../dist/discovery-cache.js";

const KEY = {
	gatewayEndpoint: "https://gateway.example.test/api/ceal/v1",
	profileRef: "profile:narnia",
	membershipRef: "membership:narnia",
	negotiatedProtocolVersion: "1.3.0",
};

function entry(overrides = {}) {
	return {
		key: KEY,
		cachedAt: Date.parse("2026-07-18T12:00:00.000Z"),
		discovery: { schema_version: "ceal.gateway_discovery.v2", capabilities: [], targets: [], target_catalog: { target_count: 0 } },
		...overrides,
	};
}

test("discovery cache writes owner-only and reads the entry back", async () => {
	await withHome(async (home) => {
		const store = createCealDiscoveryCacheStore(home);
		assert.equal(await store.load(), null);
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
		writeFileSync(cacheFile(home), JSON.stringify({
			schema_version: "ceal.client_discovery_cache.v1",
			gateway_endpoint: KEY.gatewayEndpoint, profile_ref: KEY.profileRef, membership_ref: KEY.membershipRef,
			negotiated_protocol_version: KEY.negotiatedProtocolVersion, cached_at: "2026-07-18T12:00:00.000Z",
			discovery: { schema_version: "ceal.gateway_discovery.v1" },
		}), { mode: 0o600 });
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

test("discoveryCacheEntryUsable enforces key match and freshness", () => {
	const now = Date.parse("2026-07-18T12:00:00.000Z");
	const fresh = entry({ cachedAt: now - 1_000 });
	assert.equal(discoveryCacheEntryUsable(fresh, KEY, now, 5_000), true);
	assert.equal(discoveryCacheEntryUsable(fresh, KEY, now, 500), false, "past TTL is stale");
	assert.equal(discoveryCacheEntryUsable(entry({ cachedAt: now + 10_000 }), KEY, now, 5_000), false, "future stamp is not usable");
	assert.equal(discoveryCacheEntryUsable(fresh, { ...KEY, profileRef: "profile:other" }, now, 5_000), false, "key mismatch");
	assert.equal(discoveryCacheEntryUsable(fresh, { ...KEY, negotiatedProtocolVersion: "1.2.0" }, now, 5_000), false, "protocol mismatch");
});

function cacheFile(home) {
	mkdirSync(path.join(home, ".ceal"), { recursive: true, mode: 0o700 });
	return path.join(home, ".ceal", "client-discovery-cache.json");
}

function hasCode(code) {
	return (error) => error instanceof CealDiscoveryCacheStoreError && error.code === code;
}

async function withHome(callback) {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-discovery-cache-"));
	try { await callback(home); } finally { (await import("node:fs")).rmSync(home, { recursive: true, force: true }); }
}
