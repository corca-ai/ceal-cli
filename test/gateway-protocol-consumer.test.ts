import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createSkillDirectoryBundle } from "../scripts/lib/skill-directory-bundle.ts";
import { GatewayProtocolConsumerError, verifyGatewayProtocolConsumer } from "../scripts/verify-gateway-protocol-consumer.ts";
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

function protocolFixture(context) {
	const fixture = makeGatewayProtocolFixture();
	context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
	return fixture;
}

function consumerWorkspaces() {
	return readdirSync(tmpdir())
		.filter((name) => name.startsWith("ceal-gateway-protocol-consumer-"))
		.sort();
}
