import { sha256 } from "../packages/ceal-worker-cli/src/sha256.ts";
import { parseNpmPackMetadata } from "../scripts/lib/npm-pack-metadata.ts";
import { toolchainEnv } from "../scripts/lib/toolchain-env.ts";
import { createProtocolRepoFixture } from "./converged-protocol-repo-fixture.ts";
import { createProtocolArtifactFixture, type ProtocolArtifactFixture } from "./protocol-artifact-provenance.ts";
import { releasePackageRecord,type ReleasePackageRecordInput } from "./release-package-record.ts";
import { withBuiltPackages } from "./repo-build.ts";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SuiteContext, TestContext } from "node:test";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type PackedPackage = ReleasePackageRecordInput & { tarball: string; shasum: string };
type PackedProtocolFixture = Pick<ProtocolArtifactFixture<PackedPackage>, "provenance"> & {
	root: string;
	repoRoot: string;
	protocolTarball: string;
	protocolProvenance: string;
	controlConformance: string;
	handoffManifest: string;
	expectedHandoffSha256: string;
};

type FixtureCleanupContext = TestContext | SuiteContext;

export function packedProtocolFixture(context: FixtureCleanupContext): PackedProtocolFixture {
	if (!("after" in context)) throw new TypeError("packed protocol fixtures require a test context");
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-release-package-test-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	// Snapshot the shared Protocol `dist` into the converged fixture while the
	// build lock owns it — see `test/repo-build.ts`. Packing can then happen
	// outside the lock because it reads only that immutable fixture snapshot.
	// The Gateway packet carries no client tarball; the builders pack the client
	// from the fixture's owned `packages/ceal-client` source themselves.
	const fixtureRepo = withBuiltPackages(["packages/ceal-protocol"], () => createProtocolRepoFixture({ releaseBuild: true }));
	context.after(fixtureRepo.cleanup);
	const { producer, protocol, provenance, protocolProvenance } = createProtocolArtifactFixture(root, fixtureRepo.gateway, () =>
		packPackage(root, fixtureRepo.root, "packages/ceal-protocol", [".", "./conformance"]),
	);
	const controlConformance = path.join(root, "gateway-leased-consumer-control-conformance.json");
	writeFileSync(
		controlConformance,
		`${JSON.stringify({
			schema_version: "ceal.gateway_leased_consumer_control_conformance_handoff.v1",
			proof_level: "local_state",
			writes_external: false,
			source: { repository: producer.repository, commit: producer.commit, tree: producer.tree, protocol_tree: producer.protocol_tree },
			operations: ["acquire", "projection", "recheck", "call", "materialization", "complete", "notification_receipt"].map((operation) => ({
				operation,
				path: operation === "call" ? "/api/ceal/agent/v1/call" : `/api/ceal/agent/v1/control/${operation.replaceAll("_", "-")}`,
			})),
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
			protocol: releasePackageRecord(protocol),
			protocol_provenance: { filename: path.basename(protocolProvenance), bytes: sidecar.length, sha256: sha256(sidecar) },
			control_conformance: { filename: path.basename(controlConformance), bytes: controlBytes.length, sha256: sha256(controlBytes) },
		})}\n`,
	);
	return {
		root,
		repoRoot: fixtureRepo.root,
		protocolTarball: protocol.tarball,
		protocolProvenance,
		controlConformance,
		handoffManifest,
		provenance,
		expectedHandoffSha256: sha256(readFileSync(handoffManifest)),
	};
}

function packPackage(root: string, repoRoot: string, sourcePath: string, declaredExports: string[]): PackedPackage {
	const packageDirectory = path.join(repoRoot, sourcePath);
	// This reads only the fixture-owned `dist` snapshot. Its caller copied that
	// snapshot while holding the workspace build lock.
	// `--ignore-scripts` is not optional here — this package's `prepack` is
	// `rm -rf dist && tsc`, so without it a pack deletes the shared tree every
	// other process is reading. `repo-build.test.mjs` gates that flag.
	const packed = parseNpmPackMetadata(
		JSON.parse(
			execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], {
				cwd: packageDirectory,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				env: toolchainEnv(),
			}),
		),
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
		shasum: createHash("sha1").update(bytes).digest("hex"),
		bytes: bytes.length,
		declared_exports: declaredExports,
	};
}
