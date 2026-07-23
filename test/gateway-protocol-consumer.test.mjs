import assert from "node:assert/strict";
import test from "node:test";
import { GatewayProtocolConsumerError, verifyGatewayProtocolConsumer } from "../scripts/verify-gateway-protocol-consumer.mjs";
import { makeGatewayProtocolFixture, REPO_ROOT } from "./gateway-protocol-fixture.mjs";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

test("worker and client build only against a supplied packed Gateway protocol artifact", (context) => {
	const fixture = makeGatewayProtocolFixture();
	context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
	const result = verifyGatewayProtocolConsumer({
		repoRoot: REPO_ROOT,
		protocolTarball: fixture.tarball,
		protocolProvenance: fixture.provenance,
	});
	assert.equal(result.ok, true);
	assert.equal(result.gateway_protocol.source.repository, "corca-ai/ceal");
	assert.equal(result.gateway_protocol.artifact.package, "@corca-ai/ceal-protocol");
	assert.equal(result.consumer.protocol_tarball_sha256, fixture.proof.artifact.sha256);
	assert.match(result.consumer.protocol_lock.resolved, /^file:/u);
	assert.match(result.consumer.protocol_resolution, /node_modules\/@corca-ai\/ceal-protocol\/dist\/index[.]js$/u);
	assert.equal(result.consumer.worker_commands_schema, "ceal.commands.v1");
	assert.deepEqual(result.worker_release_inputs.packages, {
		client: { path: "packages/ceal-client", name: "@corca-ai/ceal" },
		worker: { path: "packages/ceal-worker-cli", name: "@corca-ai/ceal-worker-cli" },
	});
	assert.equal(result.worker_release_inputs.protocol.input, "gateway_artifact_only");
	assert.match(result.worker_release_inputs.guide_sha256, /^[a-f0-9]{64}$/u);
});

test("consumer rejects a protocol artifact whose bytes are not bound by Gateway provenance", (context) => {
	const fixture = makeGatewayProtocolFixture();
	context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
	const provenance = JSON.parse(readFileSync(fixture.provenance, "utf8"));
	provenance.artifact.sha256 = "0".repeat(64);
	writeFileSync(fixture.provenance, `${JSON.stringify(provenance)}\n`);
	assert.throws(
		() => verifyGatewayProtocolConsumer({ repoRoot: REPO_ROOT, protocolTarball: fixture.tarball, protocolProvenance: fixture.provenance }),
		(error) => error instanceof GatewayProtocolConsumerError && error.code === "invalid_protocol_provenance",
	);
});
