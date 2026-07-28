import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveLockedGatewayHandoffArchive, WorkerGatewayHandoffArchiveError } from "../../scripts/worker-gateway-handoff-archive.mjs";
import { resolveWorkerReleaseInputsFromLockedGatewayArchive, WorkerReleaseInputError } from "../../scripts/worker-release-inputs.mjs";

test("resolves only a lock-bound exact Gateway archive through a disposable packet", (context) => {
	const fixture = archiveFixture(context);
	let packetDirectory;
	const result = resolveLockedGatewayHandoffArchive(
		{ repoRoot: fixture.repoRoot, archiveFile: fixture.archive },
		{
			resolveInputs: (inputs) => {
				packetDirectory = path.dirname(inputs.protocolTarball);
				assert.equal(existsSync(packetDirectory), true);
				assert.equal(readFileSync(inputs.protocolTarball, "utf8"), "protocol\n");
				assert.equal(readFileSync(inputs.clientTarball, "utf8"), "client\n");
				assert.equal(inputs.expectedHandoffSha256, fixture.manifestSha256);
				return { protocol: { producer: { commit: fixture.commit, tree: fixture.tree } } };
			},
		},
	);
	assert.equal(existsSync(packetDirectory), false);
	assert.deepEqual(result.lock, {
		filename: "gateway-handoff-lock.json",
		gateway_repository: "corca-ai/ceal",
		gateway_commit: fixture.commit,
		gateway_tag: "gateway-handoff-v0.65.0",
		actions_run_id: 42,
		artifact_name: `ceal-gateway-handoff-${fixture.commit}`,
		archive_filename: "ceal-gateway-handoff-0.65.0.tar.gz",
		archive_sha256: sha256(readFileSync(fixture.archive)),
	});
});

test("refuses a changed archive or unsafe archive inventory before the input resolver", (context) => {
	const fixture = archiveFixture(context);
	writeFileSync(fixture.archive, "changed bytes\n");
	assert.throws(
		() =>
			resolveLockedGatewayHandoffArchive(
				{ repoRoot: fixture.repoRoot, archiveFile: fixture.archive },
				{
					resolveInputs: () => assert.fail("changed archive must not reach input resolver"),
				},
			),
		hasArchiveCode("gateway_handoff_archive_mismatch"),
	);
	const unsafe = archiveFixture(context, { extraFile: "unexpected" });
	assert.throws(
		() =>
			resolveLockedGatewayHandoffArchive(
				{ repoRoot: unsafe.repoRoot, archiveFile: unsafe.archive },
				{
					resolveInputs: () => assert.fail("unsafe inventory must not reach input resolver"),
				},
			),
		hasArchiveCode("gateway_handoff_archive_inventory"),
	);
});

test("verifies and extracts the private copied archive when the supplied path changes after copy", (context) => {
	const fixture = archiveFixture(context);
	const result = resolveLockedGatewayHandoffArchive(
		{ repoRoot: fixture.repoRoot, archiveFile: fixture.archive },
		{
			copyArchive: (source, destination) => {
				copyFileSync(source, destination);
				writeFileSync(source, "attacker replaced the supplied path after copy\n");
			},
			resolveInputs: (inputs) => {
				assert.equal(readFileSync(inputs.protocolTarball, "utf8"), "protocol\n");
				return { protocol: { producer: { commit: fixture.commit, tree: fixture.tree } } };
			},
		},
	);
	assert.equal(result.lock.archive_sha256, fixture.archiveSha256);
});

// The tarball names used to be computed from the handoff tag, which silently
// assumed the tag version, the Protocol version, and the Client version were one
// number. A real pair archive — Protocol 0.67.0 with Client 0.69.0 — was
// therefore unconsumable: the consumer looked for a Client tarball named after
// the tag and failed the inventory check. Every fixture agreed with the guess,
// so nothing caught it until an actual archive arrived.
test("the lock declares the package pair instead of deriving both names from the tag", (context) => {
	const fixture = archiveFixture(context);
	const lockPath = path.join(fixture.repoRoot, "gateway-handoff-lock.json");
	const lock = JSON.parse(readFileSync(lockPath, "utf8"));

	// A lock that omits the pair is refused rather than falling back to the tag.
	for (const missing of ["protocol", "client"]) {
		const partial = JSON.parse(JSON.stringify(lock));
		delete partial[missing];
		writeFileSync(lockPath, `${JSON.stringify(partial)}\n`);
		assert.throws(
			() => resolveLockedGatewayHandoffArchive({ repoRoot: fixture.repoRoot, archiveFile: fixture.archive }),
			hasArchiveCode("invalid_gateway_handoff_lock"),
			`a lock without ${missing} must not be resolved`,
		);
	}

	// The filename must agree with the declared version, so a lock cannot name one
	// version and point at another tarball.
	const inconsistent = JSON.parse(JSON.stringify(lock));
	inconsistent.client.filename = "corca-ai-ceal-0.65.0.tgz";
	writeFileSync(lockPath, `${JSON.stringify(inconsistent)}\n`);
	assert.throws(
		() => resolveLockedGatewayHandoffArchive({ repoRoot: fixture.repoRoot, archiveFile: fixture.archive }),
		hasArchiveCode("invalid_gateway_handoff_lock"),
	);

	// The tag still names the Protocol release, and that one is checked rather
	// than assumed: a Protocol version disagreeing with the tag is a lock error.
	const driftedProtocol = JSON.parse(JSON.stringify(lock));
	driftedProtocol.protocol.version = "0.66.0";
	driftedProtocol.protocol.filename = "corca-ai-ceal-protocol-0.66.0.tgz";
	writeFileSync(lockPath, `${JSON.stringify(driftedProtocol)}\n`);
	assert.throws(
		() => resolveLockedGatewayHandoffArchive({ repoRoot: fixture.repoRoot, archiveFile: fixture.archive }),
		hasArchiveCode("invalid_gateway_handoff_lock"),
	);
});

test("worker input facade preserves the reviewed lock trust anchor and maps archive failures", () => {
	const lock = {
		filename: "gateway-handoff-lock.json",
		gateway_repository: "corca-ai/ceal",
		gateway_commit: "a".repeat(40),
		gateway_tag: "gateway-handoff-v0.65.0",
		actions_run_id: 42,
		artifact_name: `ceal-gateway-handoff-${"a".repeat(40)}`,
		archive_filename: "ceal-gateway-handoff-0.65.0.tar.gz",
		archive_sha256: "b".repeat(64),
	};
	const result = resolveWorkerReleaseInputsFromLockedGatewayArchive(
		{ repoRoot: "/tmp/ceal-cli-test", gatewayHandoffArchive: "/tmp/ceal-gateway-handoff-0.65.0.tar.gz" },
		{
			consumeArchive: (_options, handlers) =>
				handlers.consume({
					lock,
					rawInputs: { protocolTarball: "/tmp/protocol.tgz" },
					resolution: {
						protocol: { producer: { commit: lock.gateway_commit } },
						non_claims: [
							"This caller-supplied digest binds exact local input bytes; it does not authenticate who supplied that digest or packet.",
						],
					},
				}),
		},
	);
	assert.equal(result.trust_anchor.kind, "reviewed_gateway_handoff_lock");
	assert.equal(result.trust_anchor.gateway_commit, lock.gateway_commit);
	assert.equal(
		result.non_claims.some((entry) => entry.startsWith("This caller-supplied digest")),
		false,
	);
	assert.throws(
		() =>
			resolveWorkerReleaseInputsFromLockedGatewayArchive(
				{ repoRoot: "/tmp", gatewayHandoffArchive: "/tmp/archive.tar.gz" },
				{
					consumeArchive: () => {
						throw new WorkerGatewayHandoffArchiveError("gateway_handoff_lock_missing", "missing");
					},
				},
			),
		hasInputCode("gateway_handoff_lock_missing"),
	);
});

function archiveFixture(context, { extraFile = null } = {}) {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-gateway-handoff-test-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const repoRoot = path.join(root, "repo");
	const handoff = path.join(root, "handoff");
	mkdirSync(repoRoot);
	mkdirSync(handoff);
	const commit = "a".repeat(40);
	const tree = "b".repeat(40);
	const manifest = '{"safe":true}\n';
	writeFileSync(path.join(handoff, ".ceal-handoff-owner"), "ceal.repository_extraction_gateway_handoff.v1\n");
	writeFileSync(path.join(handoff, "corca-ai-ceal-protocol-0.65.0.tgz"), "protocol\n");
	// Deliberately NOT the tag version. The handoff tag names the Protocol
	// release; the Client versions independently, and a fixture that used one
	// number for both would reproduce the coupling this lock shape exists to
	// remove — and would have passed while a real pair archive could not be
	// consumed at all.
	writeFileSync(path.join(handoff, "corca-ai-ceal-0.71.0.tgz"), "client\n");
	writeFileSync(path.join(handoff, "gateway-artifact-handoff.json"), manifest);
	writeFileSync(path.join(handoff, "gateway-conformance-proof.json"), '{"proof":true}\n');
	writeFileSync(path.join(handoff, "gateway-protocol-provenance.json"), '{"provenance":true}\n');
	if (extraFile) writeFileSync(path.join(handoff, extraFile), "unexpected\n");
	const archive = path.join(root, "ceal-gateway-handoff-0.65.0.tar.gz");
	execFileSync("tar", ["-czf", archive, "-C", handoff, ...readFileNames(handoff)]);
	const lock = {
		schema_version: "ceal.worker_gateway_handoff_lock.v1",
		status: "locked",
		gateway: {
			repository: "corca-ai/ceal",
			workflow_path: ".github/workflows/gateway-handoff-archive.yml",
			commit,
			tree,
			tag: "gateway-handoff-v0.65.0",
			actions_run_id: 42,
			artifact_name: `ceal-gateway-handoff-${commit}`,
		},
		protocol: { package: "@corca-ai/ceal-protocol", version: "0.65.0", filename: "corca-ai-ceal-protocol-0.65.0.tgz" },
		client: { package: "@corca-ai/ceal", version: "0.71.0", filename: "corca-ai-ceal-0.71.0.tgz" },
		archive: {
			filename: path.basename(archive),
			sha256: sha256(readFileSync(archive)),
			handoff_manifest_sha256: sha256(Buffer.from(manifest)),
		},
	};
	writeFileSync(path.join(repoRoot, "gateway-handoff-lock.json"), `${JSON.stringify(lock)}\n`);
	return { repoRoot, archive, archiveSha256: lock.archive.sha256, commit, tree, manifestSha256: lock.archive.handoff_manifest_sha256 };
}

function readFileNames(directory) {
	return readdirSync(directory).sort();
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}
function hasArchiveCode(code) {
	return (error) => error instanceof WorkerGatewayHandoffArchiveError && error.code === code;
}
function hasInputCode(code) {
	return (error) => error instanceof WorkerReleaseInputError && error.code === code;
}
