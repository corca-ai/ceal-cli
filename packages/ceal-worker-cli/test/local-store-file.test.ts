import { createCealDiscoveryCacheStore } from "../dist/discovery-cache.js";
import { writeCealLocalStoreFile } from "../dist/local-store-file.js";
import { createCealSessionStore } from "../dist/profile-store.js";
import { createCealReceiptSpoolStore } from "../dist/receipt-spool.js";
import type { CealReceiptSpoolEntry } from "../src/receipt-spool.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

const HOUR_MS = 60 * 60 * 1000;

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

const SPOOL_ENTRY: CealReceiptSpoolEntry = {
	recordedAt: Date.parse("2026-07-27T00:00:00.000Z"),
	requestRef: "request:probe",
	status: "completed",
	evidence: "readback_verified",
	auditRefs: ["audit:one"],
};

function withHome(context: TestContext): string {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-store-file-"));
	context.after(() => rmSync(home, { recursive: true, force: true }));
	mkdirSync(path.join(home, ".ceal"), { mode: 0o700, recursive: true });
	return home;
}

/** Plant an orphan of `prefix` and age it past the sweep threshold. */
function plantStaleTemporary(directory: string, prefix: string, contents = "orphaned\n"): string {
	const orphan = path.join(directory, `.${prefix}.999999.deadbeefdeadbeef.tmp`);
	writeFileSync(orphan, contents, { mode: 0o600 });
	const aged = (Date.now() - 2 * HOUR_MS) / 1000;
	utimesSync(orphan, aged, aged);
	return orphan;
}

function temporaries(directory: string): string[] {
	return readdirSync(directory).filter((name) => name.endsWith(".tmp"));
}

// The defect this closes: only the spool swept, so a crash during `ceal session
// enroll` left a 0o600 file holding an access token and a refresh token in
// `~/.ceal` forever — the one store where it matters most.
test("the credential store sweeps a stale temporary its own crash left behind", async (context) => {
	const home = withHome(context);
	const directory = path.join(home, ".ceal");
	const orphan = plantStaleTemporary(directory, "client-session", JSON.stringify({ access_token: SESSION.accessToken }));
	assert.equal(existsSync(orphan), true);
	await createCealSessionStore(home).save(SESSION);
	assert.equal(existsSync(orphan), false);
	assert.deepEqual(temporaries(directory), []);
	assert.equal(statSync(path.join(directory, "client-session.json")).mode & 0o777, 0o600);
});

test("the discovery cache sweeps its own stale temporary", async (context) => {
	const home = withHome(context);
	const directory = path.join(home, ".ceal");
	const orphan = plantStaleTemporary(directory, "client-discovery-cache");
	await createCealDiscoveryCacheStore(home).save(cacheEntry());
	assert.equal(existsSync(orphan), false);
	assert.deepEqual(temporaries(directory), []);
});

test("the receipt spool keeps the sweep it already had", async (context) => {
	const home = withHome(context);
	const directory = path.join(home, ".ceal");
	const orphan = plantStaleTemporary(directory, "receipt-spool");
	await createCealReceiptSpoolStore(home).append("a".repeat(64), SPOOL_ENTRY);
	assert.equal(existsSync(orphan), false);
});

// The three stores share one directory, so a sweep that matched loosely would
// delete a sibling's in-flight temporary and corrupt a write it knows nothing
// about. Each sweeps only the prefix it writes.
test("a store never sweeps a sibling store's temporary", async (context) => {
	const home = withHome(context);
	const directory = path.join(home, ".ceal");
	const foreign = plantStaleTemporary(directory, "client-discovery-cache");
	const unrelated = plantStaleTemporary(directory, "something-else");
	await createCealSessionStore(home).save(SESSION);
	assert.equal(existsSync(foreign), true);
	assert.equal(existsSync(unrelated), true);
});

// A temporary young enough to belong to a live writer is left alone: the sweep
// runs outside any cross-process coordination, so age is the only thing telling
// an orphan apart from a concurrent write in progress.
test("a fresh temporary is left alone", async (context) => {
	const home = withHome(context);
	const directory = path.join(home, ".ceal");
	const fresh = path.join(directory, ".client-session.424242.abcdefabcdefabcd.tmp");
	writeFileSync(fresh, "in flight\n", { mode: 0o600 });
	await createCealSessionStore(home).save(SESSION);
	assert.equal(existsSync(fresh), true);
});

// The proof the card asks for, with a real dead process rather than a simulated
// one: a writer is SIGKILLed after its temporary exists and before any rename,
// which is exactly the window that used to orphan token material. What the kill
// cannot cover is the store's own rename step, so the child reproduces the
// window by writing the temporary the store would have written.
test("a SIGKILLed writer's temporary is swept by the next save", async (context) => {
	const home = withHome(context);
	const directory = path.join(home, ".ceal");
	const source = `
		import { writeFileSync } from "node:fs";
		import path from "node:path";
		const temporary = path.join(process.env.STORE_DIRECTORY, \`.client-session.\${process.pid}.0123456789abcdef.tmp\`);
		writeFileSync(temporary, ${JSON.stringify(JSON.stringify({ refresh_token: SESSION.refreshToken }))}, { flag: "wx", mode: 0o600 });
		process.stdout.write(temporary);
		process.kill(process.pid, "SIGKILL");
	`;
	const { stdout, signal } = await runKilledWriter(source, { STORE_DIRECTORY: directory });
	assert.equal(signal, "SIGKILL");
	const orphan = stdout.trim();
	assert.equal(existsSync(orphan), true, "the crash must leave the temporary behind");
	// Nothing sweeps on a timer, so the file is still there a save later — until
	// it is aged past the window a live writer could still be inside.
	await createCealSessionStore(home).save(SESSION);
	assert.equal(existsSync(orphan), true);
	const aged = (Date.now() - 2 * HOUR_MS) / 1000;
	utimesSync(orphan, aged, aged);
	await createCealSessionStore(home).save(SESSION);
	assert.equal(existsSync(orphan), false);
});

// The sweep decides what gets deleted, and it matches the prefix as literal text
// delimited by dots. A prefix carrying a dot would prefix-match a sibling store's
// temporaries; one carrying a slash would place the temporary outside the
// directory the sweep scans. Neither is a shape any caller should be able to ask
// for by accident.
test("an unsafe temp prefix is refused rather than swept with", async (context) => {
	const home = withHome(context);
	const directory = path.join(home, ".ceal");
	class Refused extends Error {}
	const unsafe = () => {
		throw new Refused("unsafe_store");
	};
	for (const prefix of ["client-session.v2", "../escape", "client/session", "Client-Session", ""]) {
		assert.throws(
			() =>
				writeCealLocalStoreFile({
					directory,
					file: path.join(directory, "target.json"),
					prefix,
					contents: "{}\n",
					unsafe,
				}),
			Refused,
			prefix,
		);
	}
	assert.deepEqual(readdirSync(directory), []);
});

function runKilledWriter(
	source: string,
	environment: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; signal: NodeJS.Signals | null }> {
	const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
		env: { ...process.env, ...environment },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	child.stdout.on("data", (chunk) => {
		stdout += String(chunk);
	});
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code, signal) => resolve({ code, signal, stdout }));
	});
}

function cacheEntry() {
	const key = {
		gatewayEndpoint: "https://gateway.example.test/api/ceal/v1",
		profileRef: "profile:narnia",
		membershipRef: "membership:narnia",
		negotiatedProtocolVersion: "1.3.0",
	};
	return {
		key,
		cachedAt: Date.parse("2026-07-27T00:00:00.000Z"),
		discovery: {
			schema_version: "ceal.gateway_discovery.v2",
			profile_ref: key.profileRef,
			membership_ref: key.membershipRef,
			capabilities: [],
			targets: [],
			target_catalog: { target_count: 0, returned_count: 0, complete: true },
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		},
	};
}
