import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { GatewayProtocolConsumerError, verifyGatewayProtocolConsumer } from "../scripts/verify-gateway-protocol-consumer.mjs";
import { makeGatewayProtocolFixture, REPO_ROOT } from "./gateway-protocol-fixture.mjs";

test("the known-bad development packet cannot satisfy the installed B1 authority boundary", (context) => {
	const fixture = makeGatewayProtocolFixture();
	context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
	assert.throws(
		() =>
			verifyGatewayProtocolConsumer({
				repoRoot: REPO_ROOT,
				protocolTarball: fixture.tarball,
				protocolProvenance: fixture.provenance,
			}),
		(error) => error instanceof GatewayProtocolConsumerError && error.code === "b1_authority_boundary_failed",
	);
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
