import { sha256 } from "../packages/ceal-worker-cli/src/sha256.ts";
import { createProtocolRepoFixture } from "./converged-protocol-repo-fixture.ts";
import { createProtocolArtifactFixture, type ProtocolArtifactFixture } from "./protocol-artifact-provenance.ts";
import { releasePackageRecord,type ReleasePackageRecordInput } from "./release-package-record.ts";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
	// The Protocol is neither built nor packed here any more: it arrives as the
	// signed archive the handoff lock binds, so the fixture adopts those exact
	// bytes. That is what makes this fixture describe a real release rather than a
	// local recompilation that merely resembles one, and it is why the workspace
	// build lock this used to need is gone with it.
	const fixtureRepo = createProtocolRepoFixture({ releaseBuild: true });
	context.after(fixtureRepo.cleanup);
	const { producer, protocol, provenance, protocolProvenance } = createProtocolArtifactFixture(root, fixtureRepo.gateway, () =>
		adoptVendoredProtocolArchive(root, fixtureRepo.root),
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

/**
 * Describe the vendored signed Protocol archive as a packed package, by copying it
 * rather than producing it. Every field below is derived from the real bytes, so a
 * fixture built on this cannot pass against an archive a release would not consume.
 */
function adoptVendoredProtocolArchive(root: string, repoRoot: string): PackedPackage {
	const lock = JSON.parse(readFileSync(path.join(repoRoot, "gateway-protocol-handoff-lock.json"), "utf8"));
	const tarball = path.join(root, lock.protocol.filename);
	copyFileSync(path.join(repoRoot, "vendor", "ceal-protocol", lock.protocol.filename), tarball);
	const bytes = readFileSync(tarball);
	const manifest = JSON.parse(execFileSync("tar", ["-xOzf", tarball, "package/package.json"]).toString("utf8"));
	return {
		name: manifest.name,
		version: manifest.version,
		filename: lock.protocol.filename,
		tarball,
		sha256: sha256(bytes),
		integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
		shasum: createHash("sha1").update(bytes).digest("hex"),
		bytes: bytes.length,
		declared_exports: [".", "./conformance"],
	};
}

