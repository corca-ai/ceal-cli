import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assertWorkerReleaseSourcePath,
	resolveWorkerReleaseInputs,
	WorkerReleaseInputError,
} from "../scripts/worker-release-inputs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("worker release inventory accepts only an exact Gateway Protocol handoff", (context) => {
	const fixture = protocolFixture(context);
	const resolution = resolveWorkerReleaseInputs({ repoRoot: ROOT, ...fixture });
	assert.equal(resolution.ok, true);
	assert.equal(resolution.protocol.package, "@corca-ai/ceal-protocol");
	assert.equal(resolution.protocol.producer.repository, "corca-ai/ceal");
	assert.deepEqual(resolution.protocol.exports, [".", "./conformance"]);
	assert.equal(resolution.forbidden_release_inputs.includes("packages/ceal-operator-cli"), true);
});

test("worker release inventory rejects stale provenance, unapproved exports, and source fallback", (context) => {
	const fixture = protocolFixture(context);
	const stale = JSON.parse(JSON.stringify(fixture.provenance));
	stale.artifact.sha256 = "0".repeat(64);
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(stale)}\n`);
	assert.throws(() => resolveWorkerReleaseInputs({ repoRoot: ROOT, ...fixture }), hasCode("handoff_provenance_mismatch"));
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(fixture.provenance)}\n`);
	fixture.provenance.artifact.exports = ["."];
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(fixture.provenance)}\n`);
	writeHandoffManifest(fixture);
	assert.throws(() => resolveWorkerReleaseInputs({ repoRoot: ROOT, ...fixture }), hasCode("protocol_artifact_mismatch"));
	assert.throws(() => resolveWorkerReleaseInputs({ repoRoot: ROOT, protocolTarball: path.relative(ROOT, fixture.protocolTarball), protocolProvenance: fixture.protocolProvenance, handoffManifest: fixture.handoffManifest, expectedHandoffSha256: fixture.expectedHandoffSha256 }), hasCode("protocol_tarball"));
	assert.throws(() => resolveWorkerReleaseInputs({ repoRoot: ROOT, protocolTarball: fixture.protocolTarball, protocolProvenance: fixture.protocolProvenance, handoffManifest: path.join(ROOT, "worker-release-inputs.json"), expectedHandoffSha256: fixture.expectedHandoffSha256 }), hasCode("handoff_layout_mismatch"));
	assert.throws(() => resolveWorkerReleaseInputs({ repoRoot: ROOT, protocolTarball: fixture.protocolTarball, protocolProvenance: fixture.protocolProvenance, handoffManifest: fixture.handoffManifest, expectedHandoffSha256: "0".repeat(64) }), hasCode("handoff_trust_mismatch"));
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

function protocolFixture(context) {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-worker-release-inputs-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const staging = path.join(root, "staging", "package");
	mkdirSync(path.join(staging, "dist"), { recursive: true });
	const packageManifest = {
		name: "@corca-ai/ceal-protocol", version: "0.65.0", type: "module",
		exports: { ".": "./dist/index.js", "./conformance": "./dist/conformance.js" },
	};
	writeFileSync(path.join(staging, "package.json"), `${JSON.stringify(packageManifest)}\n`);
	writeFileSync(path.join(staging, "dist", "index.js"), "export const protocol = '1.3.0';\n");
	writeFileSync(path.join(staging, "dist", "conformance.js"), "export const conformance = true;\n");
	const protocolTarball = path.join(root, "corca-ai-ceal-protocol-0.65.0.tgz");
	execFileSync("tar", ["-czf", protocolTarball, "-C", path.join(root, "staging"), "package"]);
	const bytes = readFileSync(protocolTarball);
	const provenance = {
		schema_version: "ceal.gateway_protocol_artifact.v1", proof_level: "host_decision", writes_external: false,
		source: { repository: "corca-ai/ceal", commit: "a".repeat(40), tree: "b".repeat(40), package_path: "packages/ceal-protocol" },
		artifact: {
			package: "@corca-ai/ceal-protocol", version: "0.65.0", filename: path.basename(protocolTarball),
			sha256: createHash("sha256").update(bytes).digest("hex"),
			npm_integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
			exports: [".", "./conformance"],
		},
	};
	const protocolProvenance = path.join(root, "gateway-protocol-provenance.json");
	const handoffManifest = path.join(root, "gateway-artifact-handoff.json");
	const fixture = { protocolTarball, protocolProvenance, handoffManifest, provenance };
	writeFileSync(protocolProvenance, `${JSON.stringify(provenance)}\n`);
	writeHandoffManifest(fixture);
	return fixture;
}

function writeHandoffManifest(fixture) {
	const sidecar = readFileSync(fixture.protocolProvenance);
	const artifact = fixture.provenance.artifact;
	const manifest = {
		schema_version: "ceal.repository_extraction_gateway_handoff.v1", ok: true, proof_level: "host_decision", writes_external: false,
		producer: { repository: fixture.provenance.source.repository, commit: fixture.provenance.source.commit, tree: fixture.provenance.source.tree, scoped_paths_clean: true },
		packages: [{
			name: artifact.package, version: artifact.version, filename: artifact.filename, sha256: artifact.sha256,
			integrity: artifact.npm_integrity, declared_exports: artifact.exports,
		}],
		protocol_provenance: { filename: path.basename(fixture.protocolProvenance), bytes: sidecar.length },
		protocol_provenance_digest: { algorithm: "sha256", canonicalization: "utf8-json-pretty-v1", value: createHash("sha256").update(sidecar).digest("hex") },
	};
	writeFileSync(fixture.handoffManifest, `${JSON.stringify(manifest)}\n`);
	fixture.expectedHandoffSha256 = createHash("sha256").update(readFileSync(fixture.handoffManifest)).digest("hex");
}

function hasCode(code) {
	return (error) => error instanceof WorkerReleaseInputError && error.code === code;
}
