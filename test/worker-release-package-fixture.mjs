import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensurePackageBuilt } from "./repo-build.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function packedProtocolFixture(context) {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-release-package-test-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const protocol = packPackage(root, "packages/ceal-protocol", [".", "./conformance"]);
	const client = packPackage(root, "packages/ceal-client", ["."]);
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
	writeFileSync(protocolProvenance, `${JSON.stringify(provenance)}\n`);
	const conformanceProof = path.join(root, "gateway-conformance-proof.json");
	writeFileSync(
		conformanceProof,
		`${JSON.stringify({
			schema_version: "ceal.repository_extraction_private_gateway_conformance.v1",
			ok: true,
			proof_level: "host_decision",
			writes_external: false,
			source_identity: producer,
			packages: [proofRecord(protocol), proofRecord(client)],
		})}\n`,
	);
	const sidecar = readFileSync(protocolProvenance);
	const proofBytes = readFileSync(conformanceProof);
	const handoffManifest = path.join(root, "gateway-artifact-handoff.json");
	writeFileSync(
		handoffManifest,
		`${JSON.stringify({
			schema_version: "ceal.repository_extraction_gateway_handoff.v1",
			ok: true,
			proof_level: "host_decision",
			writes_external: false,
			producer,
			packages: [record(protocol), record(client)],
			conformance_proof: { filename: path.basename(conformanceProof), bytes: proofBytes.length },
			conformance_proof_digest: { algorithm: "sha256", canonicalization: "utf8-json-pretty-v1", value: sha256(proofBytes) },
			protocol_provenance: { filename: path.basename(protocolProvenance), bytes: sidecar.length },
			protocol_provenance_digest: { algorithm: "sha256", canonicalization: "utf8-json-pretty-v1", value: sha256(sidecar) },
		})}\n`,
	);
	return {
		root,
		protocolTarball: protocol.tarball,
		clientTarball: client.tarball,
		protocolProvenance,
		conformanceProof,
		handoffManifest,
		provenance,
		expectedHandoffSha256: sha256(readFileSync(handoffManifest)),
	};
}

function packPackage(root, sourcePath, declaredExports) {
	const packageDirectory = path.join(ROOT, sourcePath);
	// `npm pack` reads `dist`, so the build has to be finished — and finished by
	// exactly one process — before this line. `ensurePackageBuilt` owns both.
	ensurePackageBuilt(sourcePath);
	const packed = JSON.parse(
		execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], {
			cwd: packageDirectory,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}),
	)[0];
	const tarball = path.join(root, packed.filename);
	const bytes = readFileSync(tarball);
	const manifestBytes = execFileSync("tar", ["-xOzf", tarball, "package/package.json"]);
	const manifest = JSON.parse(manifestBytes.toString("utf8"));
	return {
		name: manifest.name,
		version: manifest.version,
		filename: packed.filename,
		tarball,
		sha256: sha256(bytes),
		integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
		bytes: bytes.length,
		declared_exports: declaredExports,
		package_manifest_sha256: sha256(manifestBytes),
	};
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
function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
