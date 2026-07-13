import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCealProfileStore, CealProfileStoreError } from "../dist/profile-store.js";

const PROFILE = {
	gatewayEndpoint: "https://gateway.example.test/api/ceal/v1",
	profileRef: "profile:narnia",
	registrationRef: "registration:narnia",
	clientRef: "client:narnia",
	runnerRef: "runner:narnia",
	subjectRef: "subject:hwidong",
	instanceRef: "instance:corca",
	accessToken: `ceal_personal_${"B".repeat(43)}`,
	expiresAt: "2099-07-14T00:00:00.000Z",
	refreshToken: `ceal_refresh_${"R".repeat(43)}`,
	refreshTokenIdleExpiresAt: "2099-08-14T00:00:00.000Z",
	refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
};

test("profile store writes owner-only issued material and reads it back", async () => {
	await withHome(async (home) => {
		const store = createCealProfileStore(home);
		assert.equal(await store.load(), null);
		await store.save(PROFILE);
		assert.deepEqual(await store.load(), PROFILE);
		const file = path.join(home, ".ceal", "client-profile.json");
		assert.equal(readFileSync(file, "utf8").includes(PROFILE.accessToken), true);
		assert.equal(readFileSync(file, "utf8").includes(PROFILE.refreshToken), true);
		assert.match(readFileSync(file, "utf8"), /ceal[.]client_profile_store[.]v2/u);
		assert.equal((await import("node:fs")).statSync(file).mode & 0o777, 0o600);
		await store.remove();
		assert.equal(await store.load(), null);
	});
});

test("profile store reads legacy expired access credentials so the caller can recover or re-enroll", async () => {
	await withHome(async (home) => {
		const store = createCealProfileStore(home);
		const legacy = { ...PROFILE, expiresAt: "2020-01-01T00:00:00.000Z" };
		delete legacy.refreshToken;
		delete legacy.refreshTokenIdleExpiresAt;
		delete legacy.refreshTokenAbsoluteExpiresAt;
		await store.save(legacy);
		assert.deepEqual(await store.load(), legacy);
		assert.match(readFileSync(path.join(home, ".ceal", "client-profile.json"), "utf8"), /ceal[.]client_profile_store[.]v1/u);
	});
});

test("profile store fails closed on unsafe permissions and symlinks", async () => {
	await withHome(async (home) => {
		const store = createCealProfileStore(home);
		await store.save(PROFILE);
		chmodSync(path.join(home, ".ceal", "client-profile.json"), 0o644);
		await assert.rejects(store.load(), hasCode("unsafe_store"));
	});
	await withHome(async (home) => {
		const target = path.join(home, "outside");
		symlinkSync(target, path.join(home, ".ceal"));
		await assert.rejects(createCealProfileStore(home).save(PROFILE), hasCode("unsafe_store"));
	});
});

function hasCode(code) {
	return (error) => error instanceof CealProfileStoreError && error.code === code;
}

async function withHome(callback) {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-profile-store-"));
	try { await callback(home); } finally { rmSync(home, { recursive: true, force: true }); }
}
