import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createSkillDirectoryBundle } from "../scripts/lib/skill-directory-bundle.ts";
import {
	decodeB1Result,
	GatewayProtocolConsumerError,
	verifyGatewayProtocolConsumer,
} from "../scripts/verify-gateway-protocol-consumer.ts";
import { makeGatewayProtocolFixture, REPO_ROOT } from "./gateway-protocol-fixture.ts";

test("the corrected development packet satisfies the installed B1 boundary", (context) => {
	const fixture = protocolFixture(context);
	const before = consumerWorkspaces();
	const result = verifyGatewayProtocolConsumer({
		repoRoot: REPO_ROOT,
		protocolTarball: fixture.tarball,
		protocolProvenance: fixture.provenance,
	});
	assert.equal(result.ok, true);
	assert.equal(result.proof_level, "local_integration");
	assert.equal(result.worker_release_inputs.guide_sha256, createSkillDirectoryBundle(path.join(REPO_ROOT, "skills", "ceal-guide")).sha256);
	assert.deepEqual(result.consumer.b1, {
		decode_generation: "additive-v1",
		unknown_response_keys: "removed",
		authority_keys: "refused",
		closed_enums: "refused",
		undeclared_authority_refs: "refused",
		undeclared_capability_sequence: "relayed_then_known",
	});
	assert.deepEqual(consumerWorkspaces(), before, "a successful packed proof must not retain its installed workspace");
});

test("consumer rejects a protocol artifact whose bytes are not bound by Gateway provenance", (context) => {
	const fixture = protocolFixture(context);
	const provenance = JSON.parse(readFileSync(fixture.provenance, "utf8"));
	provenance.artifact.sha256 = "0".repeat(64);
	writeFileSync(fixture.provenance, `${JSON.stringify(provenance)}\n`);
	assert.throws(
		() => verifyGatewayProtocolConsumer({ repoRoot: REPO_ROOT, protocolTarball: fixture.tarball, protocolProvenance: fixture.provenance }),
		(error) => error instanceof GatewayProtocolConsumerError && error.code === "invalid_protocol_provenance",
	);
});

test("consumer rejects malformed B1 boundary output", () => {
	for (const value of [
		null,
		{},
		{ decode_generation: "additive-v1" },
		{
			decode_generation: "additive-v1",
			unknown_response_keys: "retained",
			authority_keys: "refused",
			closed_enums: "refused",
			undeclared_authority_refs: "refused",
			undeclared_capability_sequence: "relayed_then_known",
		},
		{
			decode_generation: "additive-v1",
			unknown_response_keys: "removed",
			authority_keys: "refused",
			closed_enums: "refused",
			undeclared_authority_refs: "refused",
			undeclared_capability_sequence: "relayed_then_known",
			extra: "rejected",
		},
	]) {
		assert.throws(
			() => decodeB1Result(value),
			(error) => error instanceof GatewayProtocolConsumerError && error.code === "worker_smoke_failed",
		);
	}
});

test("consumer preserves invalid artifact input taxonomy for API defaults", (context) => {
	assert.throws(
		() => verifyGatewayProtocolConsumer(),
		(error) => error instanceof GatewayProtocolConsumerError && error.code === "invalid_protocol_tarball",
	);
	const fixture = protocolFixture(context);
	assert.throws(
		() => verifyGatewayProtocolConsumer({ protocolTarball: fixture.tarball }),
		(error) => error instanceof GatewayProtocolConsumerError && error.code === "invalid_protocol_provenance",
	);
});

test("consumer rejects mismatched client and worker release versions before packing", (context) => {
	const fixture = protocolFixture(context);
	const root = mkdtempSync(path.join(tmpdir(), "ceal-gateway-release-inputs-test-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	cpSync(path.join(REPO_ROOT, "worker-release-inputs.json"), path.join(root, "worker-release-inputs.json"));
	for (const packagePath of ["packages/ceal-client", "packages/ceal-worker-cli"]) {
		const destination = path.join(root, packagePath);
		mkdirSync(destination, { recursive: true });
		const parsed: unknown = JSON.parse(readFileSync(path.join(REPO_ROOT, packagePath, "package.json"), "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new TypeError("Fixture manifest must be an object.");
		const manifest = packagePath.endsWith("ceal-worker-cli") ? { ...parsed, version: "0.77.1" } : parsed;
		writeFileSync(path.join(destination, "package.json"), `${JSON.stringify(manifest)}\n`);
	}
	assert.throws(
		() => verifyGatewayProtocolConsumer({ repoRoot: root, protocolTarball: fixture.tarball, protocolProvenance: fixture.provenance }),
		(error) => error instanceof GatewayProtocolConsumerError && error.code === "invalid_worker_release_inputs",
	);
});

function protocolFixture(context: TestContext) {
	const fixture = makeGatewayProtocolFixture();
	context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
	return fixture;
}

function consumerWorkspaces() {
	return readdirSync(tmpdir())
		.filter((name) => name.startsWith("ceal-gateway-protocol-consumer-"))
		.sort();
}
