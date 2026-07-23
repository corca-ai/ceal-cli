import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function packedProtocolFixture(context) {
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
