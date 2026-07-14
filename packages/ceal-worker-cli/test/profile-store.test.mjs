import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCealSessionStore, CealSessionStoreError } from "../dist/profile-store.js";

const SESSION = {
	gatewayEndpoint: "https://gateway.example.test/api/ceal/v1",
	profileRef: "profile:narnia",
	membershipRef: "membership:narnia",
	registrationRef: "registration:narnia",
	clientRef: "client:narnia",
	subjectRef: "subject:hwidong",
	instanceRef: "instance:corca",
	accessToken: `ceal_personal_${"B".repeat(43)}`,
	expiresAt: "2099-07-14T00:00:00.000Z",
	refreshToken: `ceal_refresh_${"R".repeat(43)}`,
	refreshTokenIdleExpiresAt: "2099-08-14T00:00:00.000Z",
	refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
};

test("session store writes owner-only issued material and reads it back", async () => {
	await withHome(async (home) => {
		const store = createCealSessionStore(home);
		assert.equal(await store.load(), null);
		await store.save(SESSION);
		assert.deepEqual(await store.load(), SESSION);
		const file = path.join(home, ".ceal", "client-session.json");
		assert.equal(readFileSync(file, "utf8").includes(SESSION.accessToken), true);
		assert.equal(readFileSync(file, "utf8").includes(SESSION.refreshToken), true);
		assert.match(readFileSync(file, "utf8"), /ceal[.]client_session_store[.]v1/u);
		assert.equal((await import("node:fs")).statSync(file).mode & 0o777, 0o600);
		await store.remove();
		assert.equal(await store.load(), null);
	});
});

test("session store fails closed when renewable material is incomplete", async () => {
	await withHome(async (home) => {
		const store = createCealSessionStore(home);
		const incomplete = { ...SESSION };
		delete incomplete.refreshToken;
		await assert.rejects(store.save(incomplete), hasCode("invalid_store"));
	});
});

test("session store fails closed on unsafe permissions and symlinks", async () => {
	await withHome(async (home) => {
		const store = createCealSessionStore(home);
		await store.save(SESSION);
		chmodSync(path.join(home, ".ceal", "client-session.json"), 0o644);
		await assert.rejects(store.load(), hasCode("unsafe_store"));
	});
	await withHome(async (home) => {
		const target = path.join(home, "outside");
		symlinkSync(target, path.join(home, ".ceal"));
		await assert.rejects(createCealSessionStore(home).save(SESSION), hasCode("unsafe_store"));
	});
});

function hasCode(code) {
	return (error) => error instanceof CealSessionStoreError && error.code === code;
}

async function withHome(callback) {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-profile-store-"));
	try { await callback(home); } finally { rmSync(home, { recursive: true, force: true }); }
}
