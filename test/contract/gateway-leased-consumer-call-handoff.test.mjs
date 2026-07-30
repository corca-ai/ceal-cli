import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	GatewayLeasedConsumerCallHandoffError,
	verifyGatewayLeasedConsumerCallHandoff,
} from "../../scripts/verify-gateway-leased-consumer-call-handoff.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LOCK_PATH = "gateway-leased-consumer-call-handoff-lock.json";
const HANDOFF_PATH = "vendor/gateway-leased-consumer-call/gateway-leased-consumer-call-conformance.json";
const digest = (value) => createHash("sha256").update(value).digest("hex");

test("leased-consumer carrier consumes only the SHA-locked Gateway handoff", async (t) => {
	const fixture = await handoffFixture(t);
	const verified = verifyGatewayLeasedConsumerCallHandoff({ repoRoot: fixture.root });
	assert.equal(verified.ok, true);
	assert.equal(verified.handoff.path, HANDOFF_PATH);
	assert.deepEqual(verified.handoff.vector_ids, [
		"admitted-owner-result-is-unavailable-external-response",
		"caller-provenance-field",
		"credential-bearing-arguments",
		"wrong-schema-version",
	]);
	const implementation = await readFile(path.join(ROOT, "scripts/verify-gateway-leased-consumer-call-handoff.mjs"), "utf8");
	assert.doesNotMatch(implementation, /\/home\/ubuntu\/ceal(?:\/|$)/u);
});

test("handoff verifier refuses changed bytes, source identity, vector semantics, and vector inventory", async (t) => {
	const fixture = await handoffFixture(t);
	await writeFile(fixture.handoffPath, "changed\n");
	assert.throws(() => verifyGatewayLeasedConsumerCallHandoff({ repoRoot: fixture.root }), handoffError("handoff_digest_mismatch"));

	const second = await handoffFixture(t);
	const sourceMismatch = await second.readHandoff();
	sourceMismatch.source.commit = "a".repeat(40);
	await second.writeHandoff(sourceMismatch);
	assert.throws(() => verifyGatewayLeasedConsumerCallHandoff({ repoRoot: second.root }), handoffError("handoff_source_mismatch"));

	const semanticDrift = await handoffFixture(t);
	const changedRequest = await semanticDrift.readHandoff();
	changedRequest.vectors[0].request_body.runner_ref = "runner:spoofed";
	await semanticDrift.writeHandoff(changedRequest);
	assert.throws(() => verifyGatewayLeasedConsumerCallHandoff({ repoRoot: semanticDrift.root }), handoffError("invalid_handoff"));

	const third = await handoffFixture(t);
	const vectorMismatch = await third.readHandoff();
	vectorMismatch.vectors = vectorMismatch.vectors.filter((vector) => vector.id !== "wrong-schema-version");
	await third.writeHandoff(vectorMismatch);
	const changedLock = await third.readLock();
	changedLock.handoff.vector_ids = changedLock.handoff.vector_ids.filter((id) => id !== "wrong-schema-version");
	await third.writeLock(changedLock);
	assert.throws(() => verifyGatewayLeasedConsumerCallHandoff({ repoRoot: third.root }), handoffError("invalid_handoff_lock"));
});

test("handoff verifier refuses symlinked lock and artifact inputs", async (t) => {
	const artifactLink = await handoffFixture(t);
	await rm(artifactLink.handoffPath);
	await symlink(path.join(ROOT, HANDOFF_PATH), artifactLink.handoffPath);
	assert.throws(() => verifyGatewayLeasedConsumerCallHandoff({ repoRoot: artifactLink.root }), handoffError("handoff_unavailable"));

	const lockLink = await handoffFixture(t);
	const lockPath = path.join(lockLink.root, LOCK_PATH);
	await rm(lockPath);
	await symlink(path.join(ROOT, LOCK_PATH), lockPath);
	assert.throws(() => verifyGatewayLeasedConsumerCallHandoff({ repoRoot: lockLink.root }), handoffError("handoff_lock_unavailable"));

	const parentLink = await handoffFixture(t);
	const vendorPath = path.join(parentLink.root, "vendor");
	const externalVendor = path.join(parentLink.root, "external-vendor");
	const externalHandoff = path.join(externalVendor, "gateway-leased-consumer-call", "gateway-leased-consumer-call-conformance.json");
	await rm(vendorPath, { recursive: true, force: true });
	await mkdir(path.dirname(externalHandoff), { recursive: true });
	await writeFile(externalHandoff, await readFile(path.join(ROOT, HANDOFF_PATH)));
	await symlink("external-vendor", vendorPath);
	assert.throws(() => verifyGatewayLeasedConsumerCallHandoff({ repoRoot: parentLink.root }), handoffError("handoff_unavailable"));
});

function handoffError(code) {
	return (error) => error instanceof GatewayLeasedConsumerCallHandoffError && error.code === code;
}

async function handoffFixture(t) {
	const root = await mkdtemp(path.join(tmpdir(), "ceal-cli-leased-handoff-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const handoffPath = path.join(root, HANDOFF_PATH);
	await mkdir(path.dirname(handoffPath), { recursive: true });
	await writeFile(path.join(root, LOCK_PATH), await readFile(path.join(ROOT, LOCK_PATH)));
	await writeFile(handoffPath, await readFile(path.join(ROOT, HANDOFF_PATH)));
	return {
		root,
		handoffPath,
		async readHandoff() {
			return JSON.parse(await readFile(handoffPath, "utf8"));
		},
		async readLock() {
			return JSON.parse(await readFile(path.join(root, LOCK_PATH), "utf8"));
		},
		async writeHandoff(value) {
			const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
			await writeFile(handoffPath, bytes);
			const lock = await this.readLock();
			lock.handoff.sha256 = digest(bytes);
			await this.writeLock(lock);
		},
		async writeLock(value) {
			await writeFile(path.join(root, LOCK_PATH), `${JSON.stringify(value, null, 2)}\n`);
		},
	};
}
