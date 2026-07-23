import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildWorkerReleasePackage } from "../scripts/build-worker-release-package.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("worker package build consumes a manifest-bound packed Protocol and emits no operator material", (context) => {
	const fixture = protocolFixture(context);
	const output = path.join(fixture.root, "worker-package");
	const result = buildWorkerReleasePackage({ repoRoot: ROOT, outputDirectory: output, ...fixture });
	assert.equal(result.ok, true);
	assert.deepEqual(result.consumer_smoke, {
		command: "ceal", installed_from_packed_archives: true, source_or_workspace_fallback_used: false,
	});
	assert.equal(result.artifact.path, undefined);
	const files = readdirSync(output).sort();
	assert.deepEqual(files, [
		".ceal-worker-release-package", "SHA256SUMS", "THIRD_PARTY_NOTICES.txt", "ceal-guide-SKILL.md",
		"ceal-worker-release-package-manifest.json", result.artifact.name,
	].sort());
	assert.equal(files.some((name) => name.includes("cealctl")), false);
	const manifest = JSON.parse(readFileSync(path.join(output, "ceal-worker-release-package-manifest.json"), "utf8"));
	assert.equal(manifest.artifact.sha256, result.artifact.sha256);
	assert.equal(manifest.protocol.sha256, fixture.provenance.artifact.sha256);
	const sums = readFileSync(path.join(output, "SHA256SUMS"), "utf8");
	for (const name of files.filter((name) => name !== ".ceal-worker-release-package" && name !== "SHA256SUMS")) {
		assert.equal(sums.split("\n").some((line) => /^[a-f0-9]{64}  /u.test(line) && line.endsWith(`  ${name}`)), true);
	}
	const packedPaths = execFileSync("tar", ["-tzf", path.join(output, result.artifact.name)], { encoding: "utf8" });
	assert.match(packedPaths, /^package\/dist\/bin[.]js$/mu);
	assert.doesNotMatch(packedPaths, /(?:^|\/)src\//u);
	assert.doesNotMatch(packedPaths, /cealctl|operator/u);
});

function protocolFixture(context) {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-worker-release-package-test-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const protocolSource = path.join(ROOT, "packages", "ceal-protocol");
	execFileSync("npm", ["run", "build"], { cwd: protocolSource, stdio: "pipe" });
	const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], {
		cwd: protocolSource, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
	}))[0];
	const protocolTarball = path.join(root, packed.filename);
	const bytes = readFileSync(protocolTarball);
	// This fixture intentionally proves only packed-consumer mechanics. The
	// caller-supplied manifest digest is the trust anchor; it is not evidence
	// that this test's synthetic bytes came from a live Gateway host.
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
	writeFileSync(protocolProvenance, `${JSON.stringify(provenance)}\n`);
	const sidecar = readFileSync(protocolProvenance);
	const handoffManifest = path.join(root, "gateway-artifact-handoff.json");
	writeFileSync(handoffManifest, `${JSON.stringify({
		schema_version: "ceal.repository_extraction_gateway_handoff.v1", ok: true, proof_level: "host_decision", writes_external: false,
		producer: { repository: provenance.source.repository, commit: provenance.source.commit, tree: provenance.source.tree, scoped_paths_clean: true },
		packages: [{ name: provenance.artifact.package, version: provenance.artifact.version, filename: provenance.artifact.filename, sha256: provenance.artifact.sha256, integrity: provenance.artifact.npm_integrity, declared_exports: provenance.artifact.exports }],
		protocol_provenance: { filename: path.basename(protocolProvenance), bytes: sidecar.length },
		protocol_provenance_digest: { algorithm: "sha256", canonicalization: "utf8-json-pretty-v1", value: createHash("sha256").update(sidecar).digest("hex") },
	})}\n`);
	return {
		root, protocolTarball, protocolProvenance, handoffManifest, provenance,
		expectedHandoffSha256: createHash("sha256").update(readFileSync(handoffManifest)).digest("hex"),
	};
}
