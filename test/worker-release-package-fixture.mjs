import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { npmPackArgs, parseNpmPackMetadata } from "../scripts/lib/npm-pack-metadata.mjs";
import { toolchainEnv } from "../scripts/lib/toolchain-env.mjs";
import { withBuiltPackages } from "./repo-build.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function packedProtocolFixture(context) {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-release-package-test-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	// The pack reads the shared workspace `dist`, so it happens inside one hold of
	// the lock that also owns building it — see `test/repo-build.mjs`. Only the
	// Protocol is packed here: the Gateway packet carries no client tarball, and
	// the builders pack the client from `packages/ceal-client` themselves.
	const [protocol] = withBuiltPackages(["packages/ceal-protocol"], () => [
		packPackage(root, "packages/ceal-protocol", [".", "./conformance"]),
	]);
	const producer = {
		repository: "corca-ai/ceal",
		commit: "a".repeat(40),
		tree: "b".repeat(40),
		protocol_tree: "e".repeat(40),
		scoped_paths_clean: true,
	};
	writeFileSync(path.join(root, ".ceal-protocol-handoff-owner"), "ceal.gateway_protocol_handoff.v1\n");
	const provenance = {
		schema_version: "ceal.gateway_protocol_artifact.v1",
		proof_level: "local_state",
		writes_external: false,
		source: {
			repository: producer.repository,
			commit: producer.commit,
			tree: producer.tree,
			protocol_tree: producer.protocol_tree,
			package_path: "packages/ceal-protocol",
		},
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
	const controlConformance = path.join(root, "gateway-leased-consumer-control-conformance.json");
	writeFileSync(
		controlConformance,
		`${JSON.stringify({
			schema_version: "ceal.gateway_leased_consumer_control_conformance_handoff.v1",
			proof_level: "local_state",
			writes_external: false,
			source: { repository: producer.repository, commit: producer.commit, tree: producer.tree, protocol_tree: producer.protocol_tree },
		})}\n`,
	);
	const sidecar = readFileSync(protocolProvenance);
	const controlBytes = readFileSync(controlConformance);
	const handoffManifest = path.join(root, "gateway-protocol-handoff.json");
	writeFileSync(
		handoffManifest,
		`${JSON.stringify({
			schema_version: "ceal.gateway_protocol_handoff.v1",
			ok: true,
			proof_level: "local_state",
			writes_external: false,
			producer,
			protocol: record(protocol),
			protocol_provenance: { filename: path.basename(protocolProvenance), bytes: sidecar.length, sha256: sha256(sidecar) },
			control_conformance: { filename: path.basename(controlConformance), bytes: controlBytes.length, sha256: sha256(controlBytes) },
		})}\n`,
	);
	return {
		root,
		protocolTarball: protocol.tarball,
		protocolProvenance,
		controlConformance,
		handoffManifest,
		provenance,
		expectedHandoffSha256: sha256(readFileSync(handoffManifest)),
	};
}

function packPackage(root, sourcePath, declaredExports) {
	const packageDirectory = path.join(ROOT, sourcePath);
	const expectedName = JSON.parse(readFileSync(path.join(packageDirectory, "package.json"), "utf8")).name;
	// Callers must already hold the workspace dist lock: this reads `dist`.
	// `--ignore-scripts` is not optional here — this package's `prepack` is
	// `rm -rf dist && tsc`, so without it a pack deletes the shared tree every
	// other process is reading. `repo-build.test.mjs` gates that flag.
	const packed = parseNpmPackMetadata(
		execFileSync("npm", npmPackArgs("--ignore-scripts", "--pack-destination", root), {
			cwd: packageDirectory,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: toolchainEnv(),
		}),
		expectedName,
	);
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
	};
}

function record(item) {
	return {
		package: item.name,
		version: item.version,
		filename: item.filename,
		bytes: item.bytes,
		sha256: item.sha256,
		integrity: item.integrity,
		exports: item.declared_exports,
	};
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
