import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assertWorkerReleaseSourcePath,
	resolveWorkerReleaseDevelopmentInputs,
	runCli,
	WorkerReleaseInputError,
} from "../../scripts/worker-release-inputs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("worker release inventory accepts one exact complete Gateway handoff", (context) => {
	const fixture = handoffFixture(context);
	const resolution = resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture });
	assert.equal(resolution.ok, true);
	assert.equal(resolution.protocol.package, "@corca-ai/ceal-protocol");
	assert.equal(resolution.gateway_client.name, "@corca-ai/ceal");
	assert.equal(resolution.protocol.producer.repository, "corca-ai/ceal");
	assert.deepEqual(resolution.protocol.exports, [".", "./conformance"]);
	assert.equal(resolution.forbidden_release_inputs.includes("packages/ceal-operator-cli"), true);
});

test("worker release inventory rejects stale sidecars, missing package pair, and source fallback", (context) => {
	const fixture = handoffFixture(context);
	const marker = path.join(fixture.root, ".ceal-handoff-owner");
	writeFileSync(marker, "unexpected\n");
	assert.throws(() => resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture }), hasCode("handoff_marker_mismatch"));
	writeFileSync(marker, "ceal.repository_extraction_gateway_handoff.v1\n");
	writeFileSync(fixture.conformanceProof, "{}\n");
	assert.throws(() => resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture }), hasCode("handoff_conformance_mismatch"));
	writeConformanceProof(fixture);
	const stale = JSON.parse(JSON.stringify(fixture.provenance));
	stale.artifact.sha256 = "0".repeat(64);
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(stale)}\n`);
	writeHandoffManifest(fixture);
	assert.throws(() => resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture }), hasCode("handoff_provenance_mismatch"));
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(fixture.provenance)}\n`);
	fixture.provenance.artifact.exports = ["."];
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(fixture.provenance)}\n`);
	writeHandoffManifest(fixture);
	assert.throws(() => resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture }), hasCode("handoff_provenance_mismatch"));
	fixture.provenance.artifact.exports = [".", "./conformance"];
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(fixture.provenance)}\n`);
	writeHandoffManifest(fixture);
	assert.throws(
		() =>
			resolveWorkerReleaseDevelopmentInputs({
				repoRoot: ROOT,
				protocolTarball: path.relative(ROOT, fixture.protocolTarball),
				...rest(fixture),
			}),
		hasCode("protocol_tarball"),
	);
	assert.throws(
		() =>
			resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture, handoffManifest: path.join(ROOT, "worker-release-inputs.json") }),
		hasCode("handoff_layout_mismatch"),
	);
	assert.throws(
		() => resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture, expectedHandoffSha256: "0".repeat(64) }),
		hasCode("handoff_trust_mismatch"),
	);
	const missingClient = path.join(fixture.root, "different", path.basename(fixture.clientTarball));
	mkdirSync(path.dirname(missingClient), { recursive: true });
	writeFileSync(missingClient, readFileSync(fixture.clientTarball));
	assert.throws(
		() => resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture, clientTarball: missingClient }),
		hasCode("handoff_layout_mismatch"),
	);
});

test("worker release inventory rejects Gateway and legacy composite paths", () => {
	const inventory = JSON.parse(readFileSync(path.join(ROOT, "worker-release-inputs.json"), "utf8"));
	for (const blocked of inventory.forbidden_release_inputs) {
		assert.throws(() => assertWorkerReleaseSourcePath(inventory, blocked), hasCode("forbidden_release_input"));
	}
	assert.equal(assertWorkerReleaseSourcePath(inventory, "packages/ceal-worker-cli/src/index.ts"), "packages/ceal-worker-cli/src/index.ts");
	assert.equal(assertWorkerReleaseSourcePath(inventory, "packages/ceal-client/src/index.ts"), "packages/ceal-client/src/index.ts");
	assert.throws(() => assertWorkerReleaseSourcePath(inventory, "README.md"), hasCode("undeclared_release_input"));
});

test("release CLI rejects raw handoff arguments and requires the reviewed archive lane", () => {
	const messages = [];
	const io = { log: (message) => messages.push(message), error: (message) => messages.push(message) };
	assert.equal(runCli(["--protocol-tarball", "/tmp/protocol.tgz", "--json"], io), 2);
	assert.equal(JSON.parse(messages.pop()).error_code, "invalid_argument");
	assert.equal(runCli(["--json"], io), 2);
	assert.equal(JSON.parse(messages.pop()).error_code, "gateway_handoff_archive_required");
});

function handoffFixture(context) {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-release-inputs-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const protocol = packedPackage(root, {
		name: "@corca-ai/ceal-protocol",
		exports: { ".": "./dist/index.js", "./conformance": "./dist/conformance.js" },
		files: { "dist/index.js": "export const protocol = '1.3.0';\n", "dist/conformance.js": "export const conformance = true;\n" },
	});
	const client = packedPackage(root, {
		name: "@corca-ai/ceal",
		exports: { ".": "./dist/index.js" },
		dependencies: { "@corca-ai/ceal-protocol": "0.65.0" },
		files: { "dist/index.js": "export const client = true;\n" },
	});
	const producer = { repository: "corca-ai/ceal", commit: "a".repeat(40), tree: "b".repeat(40), scoped_paths_clean: true };
	writeFileSync(path.join(root, ".ceal-handoff-owner"), "ceal.repository_extraction_gateway_handoff.v1\n");
	const provenance = {
		schema_version: "ceal.gateway_protocol_artifact.v1",
		proof_level: "host_decision",
		writes_external: false,
		source: { repository: producer.repository, commit: producer.commit, tree: producer.tree, package_path: "packages/ceal-protocol" },
		artifact: {
			package: protocol.name,
			version: protocol.version,
			filename: protocol.filename,
			sha256: protocol.sha256,
			npm_integrity: protocol.integrity,
			exports: protocol.declared_exports,
		},
	};
	const protocolProvenance = path.join(root, "gateway-protocol-provenance.json");
	const conformanceProof = path.join(root, "gateway-conformance-proof.json");
	const handoffManifest = path.join(root, "gateway-artifact-handoff.json");
	const fixture = {
		root,
		protocolTarball: protocol.tarball,
		clientTarball: client.tarball,
		protocolProvenance,
		conformanceProof,
		handoffManifest,
		protocol,
		client,
		producer,
		provenance,
	};
	writeFileSync(protocolProvenance, `${JSON.stringify(provenance)}\n`);
	writeConformanceProof(fixture);
	writeHandoffManifest(fixture);
	return fixture;
}

function packedPackage(root, { name, exports, dependencies = {}, files }) {
	const staging = path.join(root, `staging-${name.replaceAll("/", "-").replaceAll("@", "")}`, "package");
	mkdirSync(path.join(staging, "dist"), { recursive: true });
	const manifest = { name, version: "0.65.0", type: "module", exports, dependencies };
	writeFileSync(path.join(staging, "package.json"), `${JSON.stringify(manifest)}\n`);
	for (const [relativePath, contents] of Object.entries(files)) writeFileSync(path.join(staging, relativePath), contents);
	const filename = name === "@corca-ai/ceal" ? "corca-ai-ceal-0.65.0.tgz" : "corca-ai-ceal-protocol-0.65.0.tgz";
	const tarball = path.join(root, filename);
	execFileSync("tar", ["-czf", tarball, "-C", path.dirname(staging), "package"]);
	const bytes = readFileSync(tarball);
	const packageManifest = readFileSync(path.join(staging, "package.json"));
	return {
		name,
		version: manifest.version,
		filename,
		tarball,
		sha256: sha256(bytes),
		integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
		bytes: bytes.length,
		declared_exports: Object.keys(exports).sort(),
		package_manifest_sha256: sha256(packageManifest),
	};
}

function writeConformanceProof(fixture) {
	writeFileSync(
		fixture.conformanceProof,
		`${JSON.stringify({
			schema_version: "ceal.repository_extraction_private_gateway_conformance.v1",
			ok: true,
			proof_level: "host_decision",
			writes_external: false,
			source_identity: fixture.producer,
			packages: [proofRecord(fixture.protocol), proofRecord(fixture.client)],
		})}\n`,
	);
}

function writeHandoffManifest(fixture) {
	const sidecar = readFileSync(fixture.protocolProvenance);
	const proofBytes = readFileSync(fixture.conformanceProof);
	const manifest = {
		schema_version: "ceal.repository_extraction_gateway_handoff.v1",
		ok: true,
		proof_level: "host_decision",
		writes_external: false,
		producer: fixture.producer,
		packages: [record(fixture.protocol), record(fixture.client)],
		conformance_proof: { filename: path.basename(fixture.conformanceProof), bytes: proofBytes.length },
		conformance_proof_digest: { algorithm: "sha256", canonicalization: "utf8-json-pretty-v1", value: sha256(proofBytes) },
		protocol_provenance: { filename: path.basename(fixture.protocolProvenance), bytes: sidecar.length },
		protocol_provenance_digest: { algorithm: "sha256", canonicalization: "utf8-json-pretty-v1", value: sha256(sidecar) },
	};
	writeFileSync(fixture.handoffManifest, `${JSON.stringify(manifest)}\n`);
	fixture.expectedHandoffSha256 = sha256(readFileSync(fixture.handoffManifest));
}

function record(item) {
	return {
		name: item.name,
		version: item.version,
		filename: item.filename,
		sha256: item.sha256,
		integrity: item.integrity,
		bytes: item.bytes,
		declared_exports: item.declared_exports,
		package_manifest_sha256: item.package_manifest_sha256,
	};
}

function proofRecord(item) {
	return { ...record(item), installed_as_regular_directory: true };
}
function rest({ protocolTarball: _protocolTarball, ...fixture }) {
	return fixture;
}
function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
function hasCode(code) {
	return (error) => error instanceof WorkerReleaseInputError && error.code === code;
}
