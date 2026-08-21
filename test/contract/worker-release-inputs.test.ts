import { sha256 } from "../../packages/ceal-worker-cli/src/sha256.ts";
import { materializeSignedGatewayProtocolSource } from "../../scripts/materialize-signed-gateway-protocol-source.ts";
import {
	type AsyncArchiveConsumer,
	resolveWorkerReleaseDevelopmentInputs,
	runCli,
	type SyncArchiveConsumer,
	validateGatewayHandoffPacketFiles,
	withWorkerReleaseDevelopmentInputs,
	withWorkerReleaseDevelopmentInputsAsync,
	WorkerReleaseInputError,
} from "../../scripts/worker-release-inputs.ts";
import { assertCliFailureChannels } from "../cli-failure-channels.ts";
import { createProtocolRepoFixture } from "../converged-protocol-repo-fixture.ts";
import {
	createProtocolArtifactFixture,
	PROTOCOL_HANDOFF_MARKER_CONTENTS,
	PROTOCOL_HANDOFF_MARKER_NAME,
	type ProtocolArtifactProvenance,
} from "../protocol-artifact-provenance.ts";
import { releasePackageRecord,type ReleasePackageRecordInput } from "../release-package-record.ts";
import { scratchDir } from "../scratch-dir.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT_REPO = createProtocolRepoFixture();
test.after(() => CONTRACT_REPO.cleanup());

type ContractInputOptions = Parameters<typeof resolveWorkerReleaseDevelopmentInputs>[0];
type GitCall = string[];
type Producer = { repository: string; commit: string; tree: string; protocol_tree: string; scoped_paths_clean: true };
type PackedPackage = ReleasePackageRecordInput & { tarball: string };
type ControlConformance = {
	schema_version: string;
	proof_level: "local_state";
	writes_external: false;
	source: Omit<Producer, "scoped_paths_clean">;
};
type HandoffFixture = {
	root: string;
	protocolTarball: string;
	protocolProvenance: string;
	controlConformance: string;
	handoffManifest: string;
	protocol: PackedPackage;
	producer: Producer;
	provenance: ProtocolArtifactProvenance;
	control: ControlConformance;
	expectedHandoffSha256?: string;
};
type InventoryDocument = { worker: { source_path: string | null }; forbidden_release_inputs: string[] } & Record<string, unknown>;
type SyncCallbackInput = Parameters<SyncArchiveConsumer<number>>[0];
type SyncPromiseCallback = (value: SyncCallbackInput) => Promise<number>;
type SyncPromiseIsRejected = SyncPromiseCallback extends SyncArchiveConsumer<number> ? false : true;
type AsyncCallbackInput = Parameters<AsyncArchiveConsumer<number>>[0];
type AsyncPromiseCallback = (value: AsyncCallbackInput) => Promise<number>;
type AsyncPromiseIsAccepted = AsyncPromiseCallback extends AsyncArchiveConsumer<number> ? true : false;
const syncPromiseIsRejected: SyncPromiseIsRejected = true;
const asyncPromiseIsAccepted: AsyncPromiseIsAccepted = true;

test("sync and async callback contracts distinguish promise returns", () => {
	assert.equal(syncPromiseIsRejected, true);
	assert.equal(asyncPromiseIsAccepted, true);
});

function resolveContractInputs(options: ContractInputOptions) {
	return resolveWorkerReleaseDevelopmentInputs({ ...options, repoRoot: CONTRACT_REPO.root });
}

// The synthetic handoff below stands in for a real Gateway artifact, and the
// resolver rejects it unless the worker packages declare the supplied protocol
// version exactly (`protocol_version_mismatch`). So the fixture has to speak the
// vendored copy's version rather than a literal: hard-coding one makes every
// future artifact consumption fail here for a reason that has nothing to do with
// the code under test.
const VENDORED_PROTOCOL_VERSION = JSON.parse(readFileSync(path.join(ROOT, "gateway-protocol-handoff-lock.json"), "utf8")).protocol.version;
test("signed Protocol source acquisition writes nothing before exact commit and tree verification", (context: TestContext) => {
	const scratch = scratchDir(context, "ceal-signed-protocol-source-mutation-");
	const outputDirectory = path.join(scratch, "published", "ceal-protocol");
	const expectedCommit = "a".repeat(40);
	const expectedTree = "b".repeat(40);
	for (const mutation of [
		{
			commit: "c".repeat(40),
			tree: null,
			error: /signed_protocol_source_commit_mismatch/u,
			operations: ["init", "fetch", "rev-list"],
			message: "tree lookup and archive materialization must not run after a commit mismatch",
		},
		{
			commit: expectedCommit,
			tree: "d".repeat(40),
			error: /signed_protocol_source_tree_mismatch/u,
			operations: ["init", "fetch", "rev-list", "rev-parse"],
			message: "inventory and archive materialization must not run after a tree mismatch",
		},
	]) {
		const calls: GitCall[] = [];
		const git = (_command: string, args: string[]) => {
			calls.push(args);
			if (args[0] === "init" || args[0] === "fetch") return Buffer.alloc(0);
			if (args[0] === "rev-list") return `${mutation.commit}\n`;
			if (args[0] === "rev-parse" && mutation.tree) return `${mutation.tree}\n`;
			throw new Error(`unexpected_git_call:${args[0]}`);
		};
		assert.throws(
			() =>
				materializeSignedGatewayProtocolSource(
					{
						tag: "gateway-protocol-handoff-v0.72.21",
						commit: expectedCommit,
						protocolTree: expectedTree,
						outputDirectory,
					},
					{ git },
				),
			mutation.error,
		);
		assert.equal(existsSync(outputDirectory), false);
		assert.deepEqual(
			calls.map(([operation]) => operation),
			mutation.operations,
			mutation.message,
		);
	}
});

test("omitted handoff options retain their coded refusals", () => {
	assert.throws(() => resolveWorkerReleaseDevelopmentInputs(), WorkerReleaseInputError);
	assert.throws(() => validateGatewayHandoffPacketFiles(), hasCode("protocol_tarball"));
});

test("worker release inventory accepts one exact complete Gateway protocol handoff", (context: TestContext) => {
	const fixture = handoffFixture(context);
	const resolution = resolveContractInputs(fixture);
	const packet = validateGatewayHandoffPacketFiles(fixture);
	assert.equal(resolution.ok, true);
	assert.equal(resolution.protocol.package, "@corca-ai/ceal-protocol");
	assert.equal(resolution.protocol.producer.repository, "corca-ai/ceal");
	assert.equal(resolution.protocol.producer.protocol_tree, fixture.producer.protocol_tree);
	assert.equal(packet.producer.scoped_paths_clean, true);
	assert.deepEqual(resolution.protocol.exports, [".", "./conformance"]);
	assert.equal(resolution.control_conformance.filename, "gateway-leased-consumer-control-conformance.json");
	assert.equal(resolution.forbidden_release_inputs.includes("packages/ceal-protocol"), true);
	// The packet carries no client tarball, so the resolution must not pretend to
	// witness one. The client is packed from this repository's own source.
	assert.equal("gateway_client" in resolution, false);
});

test("async development input facade flattens a promise callback", async (context: TestContext) => {
	const fixture = handoffFixture(context);
	const output = await withWorkerReleaseDevelopmentInputsAsync({ ...fixture, repoRoot: CONTRACT_REPO.root }, ({ inputs }) =>
		Promise.resolve(inputs.protocol.version.length).then((value) => value.toFixed()),
	);
	assert.equal(output, String(VENDORED_PROTOCOL_VERSION.length));
});

test("worker release inventory accepts the v3 through v6 Gateway control conformances while still binding their producer", (context: TestContext) => {
	const fixture = handoffFixture(context);
	for (const schemaVersion of [
		"ceal.gateway_leased_consumer_control_conformance_handoff.v3",
		"ceal.gateway_leased_consumer_control_conformance_handoff.v4",
		"ceal.gateway_leased_consumer_control_conformance_handoff.v5",
		"ceal.gateway_leased_consumer_control_conformance_handoff.v6",
	]) {
		writeControlConformance(fixture, schemaVersion);
		writeHandoffManifest(fixture);
		const resolution = resolveContractInputs(fixture);
		assert.equal(resolution.ok, true);
	}

	writeControlConformance(fixture, "ceal.gateway_leased_consumer_control_conformance_handoff.v2");
	writeHandoffManifest(fixture);
	assert.throws(() => resolveContractInputs(fixture), hasCode("invalid_control_conformance"));
	writeControlConformance(fixture, "ceal.gateway_leased_consumer_control_conformance_handoff.v7");
	writeHandoffManifest(fixture);
	assert.throws(() => resolveContractInputs(fixture), hasCode("invalid_control_conformance"));
});

test("worker release inventory rejects stale sidecars, an unbound control conformance, and source fallback", (context: TestContext) => {
	const fixture = handoffFixture(context);
	const marker = path.join(fixture.root, PROTOCOL_HANDOFF_MARKER_NAME);
	writeFileSync(marker, "unexpected\n");
	assert.throws(() => resolveContractInputs(fixture), hasCode("handoff_marker_mismatch"));
	writeFileSync(marker, PROTOCOL_HANDOFF_MARKER_CONTENTS);

	// The control conformance is a Gateway-owned member this repository does not
	// interpret. Not interpreting it is not the same as not binding it: bytes the
	// signed manifest does not name have no business riding in the packet.
	writeFileSync(fixture.controlConformance, `${JSON.stringify({ ...fixture.control, extra: true })}\n`);
	assert.throws(() => resolveContractInputs(fixture), hasCode("handoff_conformance_mismatch"));
	writeControlConformance(fixture);
	writeHandoffManifest(fixture);

	const foreignControl = JSON.parse(JSON.stringify(fixture.control));
	foreignControl.source.commit = "c".repeat(40);
	writeFileSync(fixture.controlConformance, `${JSON.stringify(foreignControl)}\n`);
	writeHandoffManifest(fixture);
	assert.throws(() => resolveContractInputs(fixture), hasCode("invalid_control_conformance"));
	writeControlConformance(fixture);
	writeHandoffManifest(fixture);
	writeFileSync(fixture.controlConformance, `${JSON.stringify({ ...fixture.control, source: null })}\n`);
	writeHandoffManifest(fixture);
	assert.throws(() => resolveContractInputs(fixture), hasCode("invalid_control_conformance"));
	writeControlConformance(fixture);
	writeHandoffManifest(fixture);

	const stale = JSON.parse(JSON.stringify(fixture.provenance));
	stale.artifact.sha256 = "0".repeat(64);
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(stale)}\n`);
	writeHandoffManifest(fixture);
	assert.throws(() => resolveContractInputs(fixture), hasCode("handoff_provenance_mismatch"));
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(fixture.provenance)}\n`);
	fixture.provenance.artifact.exports = ["."];
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(fixture.provenance)}\n`);
	writeHandoffManifest(fixture);
	assert.throws(() => resolveContractInputs(fixture), hasCode("handoff_provenance_mismatch"));
	fixture.provenance.artifact.exports = [".", "./conformance"];
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(fixture.provenance)}\n`);
	writeHandoffManifest(fixture);
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify({ ...fixture.provenance, source: null })}\n`);
	writeHandoffManifest(fixture);
	assert.throws(() => resolveContractInputs(fixture), hasCode("invalid_protocol_provenance"));
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(fixture.provenance)}\n`);
	writeHandoffManifest(fixture);

	// A protocol subtree the provenance and the manifest disagree about is the one
	// identity the vendored copy is pinned against, so it cannot be waved through.
	const driftedSubtree = JSON.parse(JSON.stringify(fixture.provenance));
	driftedSubtree.source.protocol_tree = "d".repeat(40);
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(driftedSubtree)}\n`);
	writeHandoffManifest(fixture);
	assert.throws(() => resolveContractInputs(fixture), hasCode("invalid_protocol_provenance"));
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(fixture.provenance)}\n`);
	writeHandoffManifest(fixture);

	assert.throws(
		() => resolveContractInputs({ protocolTarball: path.relative(CONTRACT_REPO.root, fixture.protocolTarball), ...rest(fixture) }),
		hasCode("protocol_tarball"),
	);
	assert.throws(
		() => resolveContractInputs({ ...fixture, handoffManifest: path.join(CONTRACT_REPO.root, "worker-release-inputs.json") }),
		hasCode("handoff_layout_mismatch"),
	);
	assert.throws(() => resolveContractInputs({ ...fixture, expectedHandoffSha256: "0".repeat(64) }), hasCode("handoff_trust_mismatch"));
	const scattered = path.join(fixture.root, "different", path.basename(fixture.controlConformance));
	mkdirSync(path.dirname(scattered), { recursive: true });
	writeFileSync(scattered, readFileSync(fixture.controlConformance));
	assert.throws(() => resolveContractInputs({ ...fixture, controlConformance: scattered }), hasCode("handoff_layout_mismatch"));
});

// docs/gates.md pinned this call site by source shape, on the reasoning that a
// converged live pin cannot falsify it behaviourally. That reasoning was right
// about the *verdict* and wrong about the *call*: a scratch repoRoot reaches the
// guard and fails for a pin reason, and with the call removed the same input
// walks past it and fails on the next argument check instead. Two distinguishable
// outcomes are all a falsification needs.
//
// It matters because the shape gate could not see the difference. Deleting the
// one invocation in `resolveWorkerReleaseDevelopmentInputs` -- which disarms
// release-input resolution, packing, the native build, and the workflow's own
// compose step -- left `repo-gates.test.ts` green, because the regex still
// matched the call inside the error-translating wrapper that nothing then called.
test("the release chokepoint reaches the protocol pin guard before it reads any argument", async (context: TestContext) => {
	const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-pin-chokepoint-")));
	context.after(() => rmSync(scratch, { recursive: true, force: true }));
	for (const file of ["worker-release-inputs.json", "gateway-protocol-handoff-lock.json", "install-ceal.sh"]) {
		cpSync(path.join(ROOT, file), path.join(scratch, file));
	}
	// The vendored archive is deliberately NOT staged. That is what makes this
	// scratch tree unshippable, and an unshippable Protocol is what the guard has to
	// refuse before any argument is read.
	for (const owned of ["packages/ceal-client", "packages/ceal-worker-cli", "skills/ceal-guide"]) {
		mkdirSync(path.join(scratch, owned), { recursive: true });
	}
	cpSync(path.join(ROOT, "packages/ceal-client/package.json"), path.join(scratch, "packages/ceal-client/package.json"));
	cpSync(path.join(ROOT, "packages/ceal-worker-cli/package.json"), path.join(scratch, "packages/ceal-worker-cli/package.json"));
	cpSync(path.join(ROOT, "skills/ceal-guide"), path.join(scratch, "skills/ceal-guide"), { recursive: true });
	mkdirSync(path.join(scratch, "scripts", "assets"), { recursive: true });
	cpSync(
		path.join(ROOT, "scripts", "assets", "ceal-guide-compatibility-SKILL.md"),
		path.join(scratch, "scripts", "assets", "ceal-guide-compatibility-SKILL.md"),
	);

	// Absolute paths that do not exist. If the guard runs, it refuses first and
	// these are never read; if it does not, `protocol_tarball` is the next failure.
	const absent = {
		protocolTarball: path.join(scratch, "absent.tgz"),
		protocolProvenance: path.join(scratch, "absent-provenance.json"),
		controlConformance: path.join(scratch, "absent-conformance.json"),
		handoffManifest: path.join(scratch, "absent-handoff.json"),
	};
	let code = null;
	try {
		resolveWorkerReleaseDevelopmentInputs({ repoRoot: scratch, ...absent });
	} catch (error) {
		if (error instanceof WorkerReleaseInputError) code = error.code;
	}
	if (code === null) throw new Error("the chokepoint must refuse this input, not resolve it");
	assert.notEqual(
		code,
		"protocol_tarball",
		"the chokepoint read its arguments before asserting protocol shippability; the pin guard call is gone or moved",
	);
	// The scratch tree carries the lock but not the archive it binds, so the guard
	// cannot establish the vendored identity — which is a guard verdict, and the
	// point. The artifact verdicts themselves belong to protocol-vendor-pin.test.ts;
	// this asserts only that a release path cannot get past the guard without one.
	// The retired codes this used to admit (git_identity_failed,
	// proof_shipment_protocol_divergence, invalid_protocol_vendor_pin,
	// shipped_lock_mismatch, stale_divergence_record) had preconditions that no longer
	// exist. What a scratch tree can still produce is a missing or wrong archive, or a
	// lock that cannot be read.
	assert.match(code, /^(?:vendored_artifact_missing|vendored_artifact_mismatch|invalid_gateway_handoff_lock)$/u);
	// Re-raised as this module's error type, so a caller catching
	// WorkerReleaseInputError sees the refusal instead of an escaping exception.
	assert.throws(() => resolveWorkerReleaseDevelopmentInputs({ repoRoot: scratch, ...absent }), WorkerReleaseInputError);
	assert.throws(
		() => withWorkerReleaseDevelopmentInputs({ repoRoot: scratch, ...absent }, () => undefined),
		(error) => error instanceof WorkerReleaseInputError && code !== "protocol_tarball" && error.code === code,
	);
	await assert.rejects(
		() => withWorkerReleaseDevelopmentInputsAsync({ repoRoot: scratch, ...absent }, async () => undefined),
		(error) => error instanceof WorkerReleaseInputError && code !== "protocol_tarball" && error.code === code,
	);
});

test("malformed owned source paths preserve the normalized-path refusal", (context: TestContext) => {
	const fixture = handoffFixture(context);
	const inventory: InventoryDocument = JSON.parse(readFileSync(path.join(ROOT, "worker-release-inputs.json"), "utf8"));
	const inventoryPath = path.join(fixture.root, "worker-release-inputs.json");
	for (const malformedSourcePath of ["../packages/ceal-worker-cli", null]) {
		inventory.worker.source_path = malformedSourcePath;
		writeFileSync(inventoryPath, `${JSON.stringify(inventory)}\n`);
		assert.throws(() => resolveContractInputs({ ...fixture, inventoryPath }), hasCode("invalid_release_input_path"));
	}
});

test("worker release inventory rejects Gateway and legacy composite paths", (context: TestContext) => {
	const inventory: InventoryDocument = JSON.parse(readFileSync(path.join(ROOT, "worker-release-inputs.json"), "utf8"));
	// The loop below iterates whatever the file happens to contain, so on its own
	// it would stay green if someone emptied the list. `verify-worker-release-inputs.mjs`
	// used to pin the contents against a frozen constant; that script is gone, so
	// the pin lives here. The Protocol is Gateway-owned source that must arrive
	// as a signed artifact, never a worker release input copied from this tree.
	assert.deepEqual([...inventory.forbidden_release_inputs].sort(), ["packages/ceal-protocol"]);
	// What the list still does, now that `assertWorkerReleaseSourcePath` is gone: it
	// constrains the inventory *file*, not any copy. The composer takes every path
	// it stages straight from this inventory, so a per-path admission check there
	// could only ever compare a value against itself. The overlap rule below is the
	// enforcement that survives — declaring a path both owned and forbidden fails.
	const scratch = mkdtempSync(path.join(tmpdir(), "ceal-forbidden-overlap-"));
	context.after(() => rmSync(scratch, { recursive: true, force: true }));
	const tampered = path.join(scratch, "worker-release-inputs.json");
	writeFileSync(
		tampered,
		JSON.stringify({ ...inventory, forbidden_release_inputs: [...inventory.forbidden_release_inputs, inventory.worker.source_path] }),
	);
	assert.throws(
		() =>
			resolveWorkerReleaseDevelopmentInputs({
				repoRoot: ROOT,
				inventoryPath: tampered,
				protocolTarball: path.join(ROOT, "absent.tgz"),
				protocolProvenance: path.join(ROOT, "absent-provenance.json"),
				controlConformance: path.join(ROOT, "absent-conformance.json"),
				handoffManifest: path.join(ROOT, "absent-handoff.json"),
			}),
		hasCode("invalid_inventory"),
	);
});

test("release CLI rejects raw handoff arguments and requires the reviewed archive lane", async () => {
	await assertCliFailureChannels(runCli, ["--protocol-tarball", "/tmp/protocol.tgz"], "invalid_argument");
	await assertCliFailureChannels(runCli, [], "gateway_handoff_archive_required");
});

function handoffFixture(context: TestContext): HandoffFixture {
	const root = scratchDir(context, "ceal-worker-release-inputs-");
	const { producer, protocol, provenance, protocolProvenance } = createProtocolArtifactFixture(root, CONTRACT_REPO.gateway, () =>
		packedPackage(root, {
			name: "@corca-ai/ceal-protocol",
			exports: { ".": "./dist/index.js", "./conformance": "./dist/conformance.js" },
			files: { "dist/index.js": "export const protocol = '1.3.0';\n", "dist/conformance.js": "export const conformance = true;\n" },
		}),
	);
	const controlConformance = path.join(root, "gateway-leased-consumer-control-conformance.json");
	const handoffManifest = path.join(root, "gateway-protocol-handoff.json");
	const fixture: HandoffFixture = {
		root,
		protocolTarball: protocol.tarball,
		protocolProvenance,
		controlConformance,
		handoffManifest,
		protocol,
		producer,
		provenance,
		control: {
			schema_version: "ceal.gateway_leased_consumer_control_conformance_handoff.v1",
			proof_level: "local_state",
			writes_external: false,
			source: {
				repository: producer.repository,
				commit: producer.commit,
				tree: producer.tree,
				protocol_tree: producer.protocol_tree,
			},
		},
	};
	writeFileSync(protocolProvenance, `${JSON.stringify(provenance)}\n`);
	writeControlConformance(fixture);
	writeHandoffManifest(fixture);
	return fixture;
}

function packedPackage(
	root: string,
	{
		name,
		exports,
		dependencies = {},
		files,
	}: { name: string; exports: Record<string, string>; dependencies?: Record<string, string>; files: Record<string, string> },
): PackedPackage {
	const staging = path.join(root, `staging-${name.replaceAll("/", "-").replaceAll("@", "")}`, "package");
	mkdirSync(path.join(staging, "dist"), { recursive: true });
	const manifest = { name, version: VENDORED_PROTOCOL_VERSION, type: "module", exports, dependencies };
	writeFileSync(path.join(staging, "package.json"), `${JSON.stringify(manifest)}\n`);
	for (const [relativePath, contents] of Object.entries(files)) writeFileSync(path.join(staging, relativePath), contents);
	const filename = `corca-ai-ceal-protocol-${VENDORED_PROTOCOL_VERSION}.tgz`;
	const tarball = path.join(root, filename);
	execFileSync("tar", ["-czf", tarball, "-C", path.dirname(staging), "package"]);
	const bytes = readFileSync(tarball);
	return {
		name,
		version: manifest.version,
		filename,
		tarball,
		sha256: sha256(bytes),
		integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
		bytes: bytes.length,
		declared_exports: Object.keys(exports).sort(),
	};
}

function writeControlConformance(
	fixture: HandoffFixture,
	schemaVersion = "ceal.gateway_leased_consumer_control_conformance_handoff.v1",
): void {
	fixture.control = {
		schema_version: schemaVersion,
		proof_level: "local_state",
		writes_external: false,
		source: {
			repository: fixture.producer.repository,
			commit: fixture.producer.commit,
			tree: fixture.producer.tree,
			protocol_tree: fixture.producer.protocol_tree,
		},
	};
	writeFileSync(fixture.controlConformance, `${JSON.stringify(fixture.control)}\n`);
}

function writeHandoffManifest(fixture: HandoffFixture): void {
	const sidecar = readFileSync(fixture.protocolProvenance);
	const control = readFileSync(fixture.controlConformance);
	const manifest = {
		schema_version: "ceal.gateway_protocol_handoff.v1",
		ok: true,
		proof_level: "local_state",
		writes_external: false,
		producer: fixture.producer,
		protocol: releasePackageRecord(fixture.protocol),
		protocol_provenance: { filename: path.basename(fixture.protocolProvenance), bytes: sidecar.length, sha256: sha256(sidecar) },
		control_conformance: { filename: path.basename(fixture.controlConformance), bytes: control.length, sha256: sha256(control) },
	};
	writeFileSync(fixture.handoffManifest, `${JSON.stringify(manifest)}\n`);
	fixture.expectedHandoffSha256 = sha256(readFileSync(fixture.handoffManifest));
}

function rest({ protocolTarball: _protocolTarball, ...fixture }: HandoffFixture): Omit<HandoffFixture, "protocolTarball"> {
	return fixture;
}
function hasCode(code: string): (error: unknown) => boolean {
	return (error: unknown) => error instanceof WorkerReleaseInputError && error.code === code;
}
