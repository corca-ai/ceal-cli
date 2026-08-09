import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveWorkerReleaseDevelopmentInputs, runCli, WorkerReleaseInputError } from "../../scripts/worker-release-inputs.mjs";
import { scratchDir } from "../scratch-dir.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The synthetic handoff below stands in for a real Gateway artifact, and the
// resolver rejects it unless the worker packages declare the supplied protocol
// version exactly (`protocol_version_mismatch`). So the fixture has to speak the
// vendored copy's version rather than a literal: hard-coding one makes every
// future artifact consumption fail here for a reason that has nothing to do with
// the code under test.
const VENDORED_PROTOCOL_VERSION = JSON.parse(readFileSync(path.join(ROOT, "packages/ceal-protocol/package.json"), "utf8")).version;
const MARKER_NAME = ".ceal-protocol-handoff-owner";
const MARKER_CONTENTS = "ceal.gateway_protocol_handoff.v1\n";

test("worker release inventory accepts one exact complete Gateway protocol handoff", (context) => {
	const fixture = handoffFixture(context);
	const resolution = resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture });
	assert.equal(resolution.ok, true);
	assert.equal(resolution.protocol.package, "@corca-ai/ceal-protocol");
	assert.equal(resolution.protocol.producer.repository, "corca-ai/ceal");
	assert.equal(resolution.protocol.producer.protocol_tree, fixture.producer.protocol_tree);
	assert.deepEqual(resolution.protocol.exports, [".", "./conformance"]);
	assert.equal(resolution.control_conformance.filename, "gateway-leased-consumer-control-conformance.json");
	assert.equal(resolution.forbidden_release_inputs.includes("packages/ceal-protocol"), true);
	// The packet carries no client tarball, so the resolution must not pretend to
	// witness one. The client is packed from this repository's own source.
	assert.equal(resolution.gateway_client, undefined);
});

test("worker release inventory accepts the v3 through v5 Gateway control conformances while still binding their producer", (context) => {
	const fixture = handoffFixture(context);
	for (const schemaVersion of [
		"ceal.gateway_leased_consumer_control_conformance_handoff.v3",
		"ceal.gateway_leased_consumer_control_conformance_handoff.v4",
		"ceal.gateway_leased_consumer_control_conformance_handoff.v5",
	]) {
		writeControlConformance(fixture, schemaVersion);
		writeHandoffManifest(fixture);
		const resolution = resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture });
		assert.equal(resolution.ok, true);
	}

	writeControlConformance(fixture, "ceal.gateway_leased_consumer_control_conformance_handoff.v2");
	writeHandoffManifest(fixture);
	assert.throws(() => resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture }), hasCode("invalid_control_conformance"));
});

test("worker release inventory rejects stale sidecars, an unbound control conformance, and source fallback", (context) => {
	const fixture = handoffFixture(context);
	const marker = path.join(fixture.root, MARKER_NAME);
	writeFileSync(marker, "unexpected\n");
	assert.throws(() => resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture }), hasCode("handoff_marker_mismatch"));
	writeFileSync(marker, MARKER_CONTENTS);

	// The control conformance is a Gateway-owned member this repository does not
	// interpret. Not interpreting it is not the same as not binding it: bytes the
	// signed manifest does not name have no business riding in the packet.
	writeFileSync(fixture.controlConformance, `${JSON.stringify({ ...fixture.control, extra: true })}\n`);
	assert.throws(() => resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture }), hasCode("handoff_conformance_mismatch"));
	writeControlConformance(fixture);
	writeHandoffManifest(fixture);

	const foreignControl = JSON.parse(JSON.stringify(fixture.control));
	foreignControl.source.commit = "c".repeat(40);
	writeFileSync(fixture.controlConformance, `${JSON.stringify(foreignControl)}\n`);
	writeHandoffManifest(fixture);
	assert.throws(() => resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture }), hasCode("invalid_control_conformance"));
	writeControlConformance(fixture);
	writeHandoffManifest(fixture);

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

	// A protocol subtree the provenance and the manifest disagree about is the one
	// identity the vendored copy is pinned against, so it cannot be waved through.
	const driftedSubtree = JSON.parse(JSON.stringify(fixture.provenance));
	driftedSubtree.source.protocol_tree = "d".repeat(40);
	writeFileSync(fixture.protocolProvenance, `${JSON.stringify(driftedSubtree)}\n`);
	writeHandoffManifest(fixture);
	assert.throws(() => resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture }), hasCode("invalid_protocol_provenance"));
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
	const scattered = path.join(fixture.root, "different", path.basename(fixture.controlConformance));
	mkdirSync(path.dirname(scattered), { recursive: true });
	writeFileSync(scattered, readFileSync(fixture.controlConformance));
	assert.throws(
		() => resolveWorkerReleaseDevelopmentInputs({ repoRoot: ROOT, ...fixture, controlConformance: scattered }),
		hasCode("handoff_layout_mismatch"),
	);
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
// compose step -- left `repo-gates.test.mjs` green, because the regex still
// matched the call inside the error-translating wrapper that nothing then called.
test("the release chokepoint reaches the protocol pin guard before it reads any argument", (context) => {
	const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-pin-chokepoint-")));
	context.after(() => rmSync(scratch, { recursive: true, force: true }));
	for (const file of ["worker-release-inputs.json", "gateway-protocol-handoff-lock.json", "protocol-vendor-pin.json", "install-ceal.sh"]) {
		cpSync(path.join(ROOT, file), path.join(scratch, file));
	}
	for (const owned of ["packages/ceal-client", "packages/ceal-worker-cli", "skills/ceal-guide"]) {
		mkdirSync(path.join(scratch, owned), { recursive: true });
	}
	cpSync(path.join(ROOT, "packages/ceal-client/package.json"), path.join(scratch, "packages/ceal-client/package.json"));
	cpSync(path.join(ROOT, "packages/ceal-worker-cli/package.json"), path.join(scratch, "packages/ceal-worker-cli/package.json"));
	cpSync(path.join(ROOT, "skills/ceal-guide/SKILL.md"), path.join(scratch, "skills/ceal-guide/SKILL.md"));

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
		code = error.code;
	}
	assert.notEqual(code, null, "the chokepoint must refuse this input, not resolve it");
	assert.notEqual(
		code,
		"protocol_tarball",
		"the chokepoint read its arguments before asserting protocol shippability; the pin guard call is gone or moved",
	);
	// The scratch tree is not a git checkout, so the guard cannot establish the
	// vendored identity — which is a guard verdict, and the point. The divergence
	// verdicts themselves belong to protocol-vendor-pin.test.mjs; this asserts only
	// that a release path cannot get past the guard without one.
	assert.match(
		code,
		/^(?:git_identity_failed|proof_shipment_protocol_divergence|invalid_protocol_vendor_pin|shipped_lock_mismatch|stale_divergence_record)$/u,
	);
	// Re-raised as this module's error type, so a caller catching
	// WorkerReleaseInputError sees the refusal instead of an escaping exception.
	assert.throws(() => resolveWorkerReleaseDevelopmentInputs({ repoRoot: scratch, ...absent }), WorkerReleaseInputError);
});

test("worker release inventory rejects Gateway and legacy composite paths", () => {
	const inventory = JSON.parse(readFileSync(path.join(ROOT, "worker-release-inputs.json"), "utf8"));
	// The loop below iterates whatever the file happens to contain, so on its own
	// it would stay green if someone emptied the list. `verify-worker-release-inputs.mjs`
	// used to pin the contents against a frozen constant; that script is gone, so
	// the pin lives here. Both entries are load-bearing: the protocol is
	// Gateway-owned source that must arrive as a signed artifact, and the npm
	// staging lane is a different lane with a different tag.
	assert.deepEqual([...inventory.forbidden_release_inputs].sort(), [".github/workflows/npm-package-stage.yml", "packages/ceal-protocol"]);
	// What the list still does, now that `assertWorkerReleaseSourcePath` is gone: it
	// constrains the inventory *file*, not any copy. The composer takes every path
	// it stages straight from this inventory, so a per-path admission check there
	// could only ever compare a value against itself. The overlap rule below is the
	// enforcement that survives — declaring a path both owned and forbidden fails.
	const tampered = path.join(mkdtempSync(path.join(tmpdir(), "ceal-forbidden-overlap-")), "worker-release-inputs.json");
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

test("release CLI rejects raw handoff arguments and requires the reviewed archive lane", () => {
	const messages = [];
	const io = { log: (message) => messages.push(message), error: (message) => messages.push(message) };
	assert.equal(runCli(["--protocol-tarball", "/tmp/protocol.tgz", "--json"], io), 2);
	assert.equal(JSON.parse(messages.pop()).error_code, "invalid_argument");
	assert.equal(runCli(["--json"], io), 2);
	assert.equal(JSON.parse(messages.pop()).error_code, "gateway_handoff_archive_required");
});

function handoffFixture(context) {
	const root = scratchDir(context, "ceal-worker-release-inputs-");
	const protocol = packedPackage(root, {
		name: "@corca-ai/ceal-protocol",
		exports: { ".": "./dist/index.js", "./conformance": "./dist/conformance.js" },
		files: { "dist/index.js": "export const protocol = '1.3.0';\n", "dist/conformance.js": "export const conformance = true;\n" },
	});
	const producer = {
		repository: "corca-ai/ceal",
		commit: "a".repeat(40),
		tree: "b".repeat(40),
		protocol_tree: "e".repeat(40),
		scoped_paths_clean: true,
	};
	writeFileSync(path.join(root, MARKER_NAME), MARKER_CONTENTS);
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
	const controlConformance = path.join(root, "gateway-leased-consumer-control-conformance.json");
	const handoffManifest = path.join(root, "gateway-protocol-handoff.json");
	const fixture = {
		root,
		protocolTarball: protocol.tarball,
		protocolProvenance,
		controlConformance,
		handoffManifest,
		protocol,
		producer,
		provenance,
	};
	writeFileSync(protocolProvenance, `${JSON.stringify(provenance)}\n`);
	writeControlConformance(fixture);
	writeHandoffManifest(fixture);
	return fixture;
}

function packedPackage(root, { name, exports, dependencies = {}, files }) {
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

function writeControlConformance(fixture, schemaVersion = "ceal.gateway_leased_consumer_control_conformance_handoff.v1") {
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

function writeHandoffManifest(fixture) {
	const sidecar = readFileSync(fixture.protocolProvenance);
	const control = readFileSync(fixture.controlConformance);
	const manifest = {
		schema_version: "ceal.gateway_protocol_handoff.v1",
		ok: true,
		proof_level: "local_state",
		writes_external: false,
		producer: fixture.producer,
		protocol: record(fixture.protocol),
		protocol_provenance: { filename: path.basename(fixture.protocolProvenance), bytes: sidecar.length, sha256: sha256(sidecar) },
		control_conformance: { filename: path.basename(fixture.controlConformance), bytes: control.length, sha256: sha256(control) },
	};
	writeFileSync(fixture.handoffManifest, `${JSON.stringify(manifest)}\n`);
	fixture.expectedHandoffSha256 = sha256(readFileSync(fixture.handoffManifest));
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

function rest({ protocolTarball: _protocolTarball, ...fixture }) {
	return fixture;
}
function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
function hasCode(code) {
	return (error) => error instanceof WorkerReleaseInputError && error.code === code;
}
