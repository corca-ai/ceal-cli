import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	consumeLockedGatewayProtocolHandoffArchive,
	WorkerGatewayProtocolHandoffArchiveError,
} from "../../scripts/worker-gateway-protocol-handoff-archive.mjs";

test("consumes only an exact reviewed protocol-only Gateway archive", (context) => {
	const fixture = archiveFixture(context);
	const result = consumeLockedGatewayProtocolHandoffArchive(
		{ repoRoot: fixture.root, archiveFile: fixture.archive },
		{ consume: ({ resolution, lock }) => ({ protocol: JSON.parse(readFileSync(resolution.provenance, "utf8")).artifact.version, lock }) },
	);
	assert.equal(result.protocol, "0.71.0");
	assert.equal(result.lock.gateway_tag, "gateway-protocol-handoff-v0.71.0");
});

test("refuses archive byte, producer, protocol, and member drift", (context) => {
	for (const mutation of ["archive", "producer", "protocol", "member"]) {
		const fixture = archiveFixture(context, mutation);
		assert.throws(
			() => consumeLockedGatewayProtocolHandoffArchive({ repoRoot: fixture.root, archiveFile: fixture.archive }),
			(error) =>
				error instanceof WorkerGatewayProtocolHandoffArchiveError &&
				["protocol_handoff_archive_mismatch", "protocol_handoff_manifest_invalid", "protocol_handoff_archive_inventory"].includes(error.code),
		);
	}
});

test("refuses an archive reached through a symbolic-link ancestor", (context) => {
	const fixture = archiveFixture(context);
	const alias = path.join(fixture.root, "packet-alias");
	symlinkSync(fixture.root, alias, "dir");
	assert.throws(
		() =>
			consumeLockedGatewayProtocolHandoffArchive({
				repoRoot: fixture.root,
				archiveFile: path.join(alias, path.basename(fixture.archive)),
			}),
		(error) => error instanceof WorkerGatewayProtocolHandoffArchiveError && error.code === "invalid_protocol_handoff_archive",
	);
});

function archiveFixture(context, mutation) {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-protocol-archive-fixture-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const packet = path.join(root, "packet");
	const packageDirectory = path.join(root, "package");
	mkdirSync(packet);
	mkdirSync(packageDirectory);
	const version = mutation === "protocol" ? "0.71.1" : "0.71.0";
	const tarball = `corca-ai-ceal-protocol-${version}.tgz`;
	writeFileSync(
		path.join(packageDirectory, "package.json"),
		JSON.stringify({ name: "@corca-ai/ceal-protocol", version, exports: { ".": "./index.js", "./conformance": "./conformance.js" } }),
	);
	execFileSync("tar", ["-czf", path.join(packet, tarball), "-C", root, "package"]);
	writeFileSync(path.join(packet, ".ceal-protocol-handoff-owner"), "ceal.gateway_protocol_handoff.v1\n");
	const commit = mutation === "producer" ? "b".repeat(40) : "a".repeat(40);
	const tree = "c".repeat(40);
	const protocolTree = "d".repeat(40);
	const tarballBytes = readFileSync(path.join(packet, tarball));
	const provenance = { schema_version: "ceal.gateway_protocol_artifact.v1", artifact: { version }, source: { commit } };
	const conformance = { schema_version: "ceal.gateway_leased_consumer_control_conformance_handoff.v1" };
	writeFileSync(path.join(packet, "gateway-protocol-provenance.json"), JSON.stringify(provenance));
	writeFileSync(path.join(packet, "gateway-leased-consumer-control-conformance.json"), JSON.stringify(conformance));
	const digest = (name) => {
		const bytes = readFileSync(path.join(packet, name));
		return { filename: name, bytes: bytes.byteLength, sha256: sha256(bytes) };
	};
	const manifest = {
		schema_version: "ceal.gateway_protocol_handoff.v1",
		ok: true,
		proof_level: "local_state",
		writes_external: false,
		producer: { repository: "corca-ai/ceal", commit, tree, protocol_tree: protocolTree, scoped_paths_clean: true },
		protocol: {
			package: "@corca-ai/ceal-protocol",
			version,
			filename: tarball,
			bytes: tarballBytes.byteLength,
			sha256: sha256(tarballBytes),
			integrity: `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`,
			exports: [".", "./conformance"],
		},
		protocol_provenance: digest("gateway-protocol-provenance.json"),
		control_conformance: digest("gateway-leased-consumer-control-conformance.json"),
		consumer_requirements: [],
		non_claims: [],
	};
	writeFileSync(path.join(packet, "gateway-protocol-handoff.json"), JSON.stringify(manifest));
	if (mutation === "member") writeFileSync(path.join(packet, "unexpected"), "no\n");
	const archive = path.join(root, "ceal-gateway-protocol-handoff-0.71.0.tar.gz");
	execFileSync("tar", ["-czf", archive, "-C", packet, ...readdirSync(packet)]);
	if (mutation === "archive") writeFileSync(archive, "changed\n");
	const lock = {
		schema_version: "ceal.worker_gateway_protocol_handoff_lock.v1",
		status: "locked",
		gateway: {
			repository: "corca-ai/ceal",
			workflow_path: ".github/workflows/gateway-protocol-handoff-release.yml",
			commit: "a".repeat(40),
			tree,
			protocol_tree: protocolTree,
			tag: "gateway-protocol-handoff-v0.71.0",
		},
		archive: {
			filename: path.basename(archive),
			sha256: mutation === "archive" ? "0".repeat(64) : sha256(readFileSync(archive)),
			manifest_sha256: sha256(Buffer.from(JSON.stringify(manifest))),
		},
		protocol: {
			package: "@corca-ai/ceal-protocol",
			version: "0.71.0",
			filename: "corca-ai-ceal-protocol-0.71.0.tgz",
			sha256: sha256(tarballBytes),
			integrity: `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`,
			exports: [".", "./conformance"],
		},
	};
	writeFileSync(path.join(root, "gateway-protocol-handoff-lock.json"), JSON.stringify(lock));
	return { root, archive };
}
function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
