#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codedErrorClass } from "./lib/coded-error.mjs";
import { parseScriptArgs } from "./lib/parse-script-args.mjs";
import { assertShippableProtocolVendorPin, ProtocolVendorPinError } from "./verify-protocol-vendor-pin.mjs";
import {
	consumeLockedGatewayHandoffArchive,
	consumeLockedGatewayHandoffArchiveSync,
	WorkerGatewayHandoffArchiveError,
} from "./worker-gateway-handoff-archive.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INPUTS_FILENAME = "worker-release-inputs.json";
const SCHEMA_VERSION = "ceal.worker_release_inputs.v1";
const HANDOFF_SCHEMA = "ceal.gateway_protocol_handoff.v1";
// The Gateway owns the control conformance.  This consumer only binds its
// declared producer identity and bytes; it must therefore accept every
// published handoff schema whose identity envelope stays unchanged.  v3 adds
// the reply-control vectors and v4 the capability-control vectors without
// changing that envelope.
const CONTROL_CONFORMANCE_SCHEMAS = new Set([
	"ceal.gateway_leased_consumer_control_conformance_handoff.v1",
	"ceal.gateway_leased_consumer_control_conformance_handoff.v3",
	"ceal.gateway_leased_consumer_control_conformance_handoff.v4",
]);
const PROTOCOL_PROVENANCE_SCHEMA = "ceal.gateway_protocol_artifact.v1";
const HANDOFF_MARKER = ".ceal-protocol-handoff-owner";
const GIT_OBJECT_ID = /^[a-f0-9]{40}$/u;
const PROTOCOL_PACKAGE = "@corca-ai/ceal-protocol";
const RAW_HANDOFF_INPUT_KEYS = ["protocolTarball", "protocolProvenance", "controlConformance", "handoffManifest", "expectedHandoffSha256"];

export const WorkerReleaseInputError = codedErrorClass("WorkerReleaseInputError");

// Re-raised as this module's error type so a caller catching WorkerReleaseInputError
// sees the refusal rather than an unrelated exception escaping the release lane.
// The code is carried through unchanged: `proof_shipment_protocol_divergence` is
// the stable name the Gateway owner decision asked for.
function assertShippableProtocolVendorPinFor(repoRoot) {
	try {
		return assertShippableProtocolVendorPin({ repoRoot });
	} catch (error) {
		if (error instanceof ProtocolVendorPinError) throw new WorkerReleaseInputError(error.code, error.message);
		throw error;
	}
}

export function resolveWorkerReleaseDevelopmentInputs(options = {}) {
	assertDevelopmentRawInputs(options);
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	const inventory = readInventory(options.inventoryPath ?? path.join(repoRoot, INPUTS_FILENAME));
	assertInventory(inventory, repoRoot);
	// Every worker release, packing, and native-artifact path funnels through
	// here — the locked-archive variants and the development ones alike — so this
	// is where the proof/ship divergence stops being someone else's test result.
	// The owner decision requires these paths to reject a divergent state
	// independently of which test command ran, and a guard that only reddened
	// `npm run check` would leave a release able to build from bytes the lock
	// does not bind. The development variants are covered deliberately: building
	// a release package is packing, not the development-only protocol proof the
	// decision carves out.
	assertShippableProtocolVendorPinFor(repoRoot);
	const protocolTarball = requireRegularAbsoluteFile(options.protocolTarball, "protocol_tarball");
	const protocolProvenance = requireRegularAbsoluteFile(options.protocolProvenance, "protocol_provenance");
	const controlConformance = requireRegularAbsoluteFile(options.controlConformance, "control_conformance");
	const handoffManifest = requireRegularAbsoluteFile(options.handoffManifest, "handoff_manifest");
	const expectedHandoffSha256 = requireSha256(options.expectedHandoffSha256, "expected_handoff_sha256");
	if (
		new Set([
			path.dirname(protocolTarball),
			path.dirname(protocolProvenance),
			path.dirname(controlConformance),
			path.dirname(handoffManifest),
		]).size !== 1
	) {
		fail("handoff_layout_mismatch", "Gateway handoff inputs must come from one complete handoff directory.");
	}
	const provenance = readJson(protocolProvenance, "invalid_protocol_provenance");
	const control = readJson(controlConformance, "invalid_control_conformance");
	const handoff = readJson(handoffManifest, "invalid_handoff_manifest");
	if (sha256(readFileSync(handoffManifest)) !== expectedHandoffSha256) {
		fail("handoff_trust_mismatch", "Gateway handoff manifest does not match the caller-approved digest.");
	}
	const packet = validateHandoffPacket({
		inventory,
		control,
		controlConformance,
		handoff,
		protocolTarball,
		protocolProvenance,
		provenance,
	});
	const protocol = validateProtocolArtifact({ inventory, repoRoot, protocolTarball, provenance, protocolRecord: packet.protocol });
	return {
		schema_version: "ceal.worker_release_input_resolution.v1",
		ok: true,
		proof_level: "local_state",
		writes_external: false,
		worker: { ...inventory.worker },
		client: { ...inventory.client },
		guide: { ...inventory.guide },
		protocol,
		control_conformance: packet.control_conformance,
		handoff: { filename: path.basename(handoffManifest), sha256: expectedHandoffSha256 },
		trust_anchor: { kind: "caller_supplied_manifest_sha256", value: expectedHandoffSha256 },
		forbidden_release_inputs: [...inventory.forbidden_release_inputs],
		non_claims: [
			...inventory.non_claims,
			"This caller-supplied digest binds exact local input bytes; it does not authenticate who supplied that digest or packet.",
		],
	};
}

export function resolveWorkerReleaseInputsFromLockedGatewayArchive(options = {}, dependencies = {}) {
	return withWorkerReleaseInputs(options, ({ inputs }) => inputs, dependencies);
}

export function withWorkerReleaseInputs(options, consume, dependencies = {}) {
	assertReleaseArchiveInput(options);
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	try {
		return (dependencies.consumeArchive ?? consumeLockedGatewayHandoffArchiveSync)(
			{
				repoRoot,
				archiveFile: options.gatewayHandoffArchive,
			},
			{
				resolveInputs: (rawInputs) => resolveWorkerReleaseDevelopmentInputs(rawInputs),
				consume: ({ resolution, rawInputs, lock }) => consume({ inputs: lockBoundResolution(resolution, lock), rawInputs }),
			},
		);
	} catch (error) {
		if (error instanceof WorkerGatewayHandoffArchiveError) throw new WorkerReleaseInputError(error.code, error.message);
		throw error;
	}
}

export async function withWorkerReleaseInputsAsync(options, consume, dependencies = {}) {
	assertReleaseArchiveInput(options);
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	try {
		return await (dependencies.consumeArchive ?? consumeLockedGatewayHandoffArchive)(
			{
				repoRoot,
				archiveFile: options.gatewayHandoffArchive,
			},
			{
				resolveInputs: (rawInputs) => resolveWorkerReleaseDevelopmentInputs(rawInputs),
				consume: async ({ resolution, rawInputs, lock }) => consume({ inputs: lockBoundResolution(resolution, lock), rawInputs }),
			},
		);
	} catch (error) {
		if (error instanceof WorkerGatewayHandoffArchiveError) throw new WorkerReleaseInputError(error.code, error.message);
		throw error;
	}
}

export function withWorkerReleaseDevelopmentInputs(options, consume) {
	assertDevelopmentRawInputs(options);
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	const rawInputs = rawInputOptions(repoRoot, options);
	return consume({ inputs: resolveWorkerReleaseDevelopmentInputs(rawInputs), rawInputs });
}

export async function withWorkerReleaseDevelopmentInputsAsync(options, consume) {
	assertDevelopmentRawInputs(options);
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	const rawInputs = rawInputOptions(repoRoot, options);
	return await consume({ inputs: resolveWorkerReleaseDevelopmentInputs(rawInputs), rawInputs });
}

function rawInputOptions(repoRoot, options) {
	return {
		repoRoot,
		protocolTarball: options.protocolTarball,
		protocolProvenance: options.protocolProvenance,
		controlConformance: options.controlConformance,
		handoffManifest: options.handoffManifest,
		expectedHandoffSha256: options.expectedHandoffSha256,
	};
}

function assertReleaseArchiveInput(options) {
	if (!options.gatewayHandoffArchive)
		fail("gateway_handoff_archive_required", "Worker release commands require one lock-bound Gateway handoff archive.");
	if (RAW_HANDOFF_INPUT_KEYS.some((key) => options[key] !== undefined)) {
		fail("input_mode_conflict", "Gateway handoff archive input cannot be combined with raw handoff files or digests.");
	}
}

function assertDevelopmentRawInputs(options) {
	if (options.gatewayHandoffArchive) fail("development_input_mode", "Development input resolution accepts raw local handoff files only.");
}

function lockBoundResolution(resolution, lock) {
	return {
		...resolution,
		trust_anchor: {
			kind: "reviewed_gateway_handoff_lock",
			lock_filename: lock.filename,
			gateway_repository: lock.gateway_repository,
			gateway_commit: lock.gateway_commit,
			gateway_tag: lock.gateway_tag,
			actions_run_id: lock.actions_run_id,
			origin: lock.origin,
			archive_filename: lock.archive_filename,
			archive_sha256: lock.archive_sha256,
		},
		non_claims: [
			...resolution.non_claims.filter((entry) => !entry.startsWith("This caller-supplied digest")),
			"The reviewed lock binds a locally supplied archive; it does not download an Actions artifact, publish a release, or prove a signature identity.",
		],
	};
}

function readInventory(filePath) {
	return readJson(requireRegularFile(path.resolve(filePath), "invalid_inventory"), "invalid_inventory");
}

function assertInventory(inventory, repoRoot) {
	if (!isPlainObject(inventory) || inventory.schema_version !== SCHEMA_VERSION || inventory.status !== "local_candidate_not_published") {
		fail("invalid_inventory", "Worker release input inventory is invalid.");
	}
	assertWorker(inventory.worker, repoRoot);
	assertClient(inventory.client, repoRoot);
	assertGuide(inventory.guide, repoRoot);
	assertProtocolRequirement(inventory.required_gateway_protocol);
	if (
		!Array.isArray(inventory.forbidden_release_inputs) ||
		inventory.forbidden_release_inputs.length === 0 ||
		new Set(inventory.forbidden_release_inputs).size !== inventory.forbidden_release_inputs.length ||
		inventory.forbidden_release_inputs.some((entry) => typeof entry !== "string" || normalizeRelativePath(entry) !== entry)
	) {
		fail("invalid_inventory", "Worker release inventory must declare unique forbidden composite inputs.");
	}
	if (
		inventory.forbidden_release_inputs.some((entry) =>
			[inventory.worker.source_path, inventory.client.source_path, inventory.guide.source_path].some(
				(allowed) => allowed === entry || allowed.startsWith(`${entry}/`),
			),
		)
	) {
		fail("invalid_inventory", "Worker release inventory overlaps an owned input with a forbidden input.");
	}
	if (
		!Array.isArray(inventory.non_claims) ||
		inventory.non_claims.length === 0 ||
		inventory.non_claims.some((entry) => typeof entry !== "string" || entry.length === 0)
	) {
		fail("invalid_inventory", "Worker release inventory must retain explicit non-claims.");
	}
}

function assertWorker(worker, repoRoot) {
	if (!isPlainObject(worker) || worker.package !== "@corca-ai/ceal-worker-cli" || worker.command !== "ceal")
		fail("invalid_inventory", "Worker release inventory has an invalid worker identity.");
	assertPackageSource(repoRoot, worker.source_path, worker.package, worker.command);
}

function assertClient(client, repoRoot) {
	if (!isPlainObject(client) || client.package !== "@corca-ai/ceal")
		fail("invalid_inventory", "Worker release inventory has an invalid client identity.");
	assertPackageSource(repoRoot, client.source_path, client.package);
}

function assertGuide(guide, repoRoot) {
	if (!isPlainObject(guide) || guide.asset !== "ceal-guide-SKILL.md" || guide.source_path !== "skills/ceal-guide/SKILL.md")
		fail("invalid_inventory", "Worker release inventory has an invalid guide identity.");
	requireRegularFile(path.join(repoRoot, guide.source_path), "invalid_inventory");
}

function assertPackageSource(repoRoot, sourcePath, expectedName, command) {
	if (normalizeRelativePath(sourcePath) !== sourcePath) fail("invalid_inventory", "Worker release package path is invalid.");
	const manifest = readJson(path.join(repoRoot, sourcePath, "package.json"), "invalid_inventory");
	if (manifest?.name !== expectedName || (command && manifest?.bin?.[command] !== "./dist/bin.js")) {
		fail("invalid_inventory", "Worker release package identity is invalid.");
	}
}

function assertProtocolRequirement(protocol) {
	if (
		!isPlainObject(protocol) ||
		protocol.package !== "@corca-ai/ceal-protocol" ||
		protocol.source_repository !== "corca-ai/ceal" ||
		protocol.source_path !== "packages/ceal-protocol" ||
		protocol.provenance_schema !== PROTOCOL_PROVENANCE_SCHEMA ||
		protocol.handoff_manifest_schema !== HANDOFF_SCHEMA ||
		!sameStrings(protocol.required_exports, [".", "./conformance"])
	) {
		fail("invalid_inventory", "Worker release inventory has an invalid Gateway Protocol requirement.");
	}
}

function validateHandoffPacket({ inventory, control, controlConformance, handoff, protocolTarball, protocolProvenance, provenance }) {
	if (
		!isPlainObject(handoff) ||
		handoff.schema_version !== HANDOFF_SCHEMA ||
		handoff.ok !== true ||
		handoff.proof_level !== "local_state" ||
		handoff.writes_external !== false
	) {
		fail("invalid_handoff_manifest", "Gateway handoff manifest is not a self-consistent producer record.");
	}
	const producer = handoff.producer;
	if (
		!isPlainObject(producer) ||
		producer.repository !== inventory.required_gateway_protocol.source_repository ||
		!GIT_OBJECT_ID.test(producer.commit ?? "") ||
		!GIT_OBJECT_ID.test(producer.tree ?? "") ||
		!GIT_OBJECT_ID.test(producer.protocol_tree ?? "") ||
		producer.scoped_paths_clean !== true
	) {
		fail("invalid_handoff_manifest", "Gateway handoff producer identity is invalid.");
	}
	const protocol = validateProtocolRecord(handoff.protocol);
	assertHandoffMarker(path.dirname(protocolProvenance));
	assertArtifactBytes({
		tarball: protocolTarball,
		record: protocol,
		code: "protocol_artifact_mismatch",
		message: "Gateway Protocol tarball does not match the complete handoff packet.",
	});
	assertPackedPackage({
		tarball: protocolTarball,
		record: protocol,
		expectedName: inventory.required_gateway_protocol.package,
		code: "protocol_artifact_mismatch",
	});
	const controlRecord = assertControlConformanceSidecar({ handoff, control, controlConformance, producer });
	assertProtocolProvenanceSidecar({ handoff, provenance, protocolProvenance, producer, protocol });
	return { protocol, control_conformance: controlRecord };
}

// One record, not a pair. The handoff used to carry this repository's own client
// tarball alongside the Protocol, so the manifest declared an ordered two-package
// array and the resolver checked that the client named the right Protocol
// version. The client is packed here now, from the source this repository owns,
// and `validateProtocolArtifact` already asserts that the owned client and worker
// manifests name the supplied Protocol version — so nothing that check covered
// was lost with the second record, only the redundant external witness for it.
function validateProtocolRecord(record) {
	if (
		!isPlainObject(record) ||
		record.package !== PROTOCOL_PACKAGE ||
		typeof record.version !== "string" ||
		!/^\d+\.\d+\.\d+$/u.test(record.version) ||
		record.filename !== `corca-ai-ceal-protocol-${record.version}.tgz` ||
		!isSha256(record.sha256) ||
		typeof record.integrity !== "string" ||
		!record.integrity.startsWith("sha512-") ||
		!Number.isSafeInteger(record.bytes) ||
		record.bytes <= 0 ||
		!sameSortedExports(record.exports)
	) {
		fail("invalid_handoff_manifest", "Gateway handoff Protocol record is invalid.");
	}
	return { name: record.package, ...record, exports: [...record.exports] };
}

function assertArtifactBytes({ tarball, record, code, message }) {
	const bytes = readFileSync(tarball);
	const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
	if (
		path.basename(tarball) !== record.filename ||
		bytes.length !== record.bytes ||
		sha256(bytes) !== record.sha256 ||
		integrity !== record.integrity
	) {
		fail(code, message);
	}
}

function assertPackedPackage({ tarball, record, expectedName, code }) {
	const manifestBytes = readPackedManifestBytes(tarball, code);
	let manifest;
	try {
		manifest = JSON.parse(manifestBytes);
	} catch {
		fail(code, "Gateway package tarball has an invalid package manifest.");
	}
	if (
		manifest?.name !== expectedName ||
		manifest?.version !== record.version ||
		!sameStrings(exportKeys(manifest.exports), record.exports)
	) {
		fail(code, "Gateway package tarball does not match its complete handoff record.");
	}
	return manifest;
}

function assertHandoffMarker(directory) {
	const marker = requireRegularFile(path.join(directory, HANDOFF_MARKER), "handoff_marker_missing");
	if (readFileSync(marker, "utf8") !== `${HANDOFF_SCHEMA}\n`) {
		fail("handoff_marker_mismatch", "Gateway handoff ownership marker is invalid.");
	}
}

// The Gateway ships its leased-consumer control conformance in the same packet
// now. This repository does not implement that control surface, so nothing here
// interprets the vectors — but an unbound member is an unbound member, and the
// manifest already binds its bytes. What is checked is that the file the archive
// carries is the file the signed manifest names, and that it describes the same
// Gateway commit as everything else in the packet. Reading it further belongs to
// whoever implements the surface, not to the release-input resolver.
function assertControlConformanceSidecar({ handoff, control, controlConformance, producer }) {
	const bytes = readFileSync(controlConformance);
	const sidecar = handoff.control_conformance;
	if (
		!isPlainObject(sidecar) ||
		sidecar.filename !== path.basename(controlConformance) ||
		sidecar.bytes !== bytes.length ||
		sidecar.sha256 !== sha256(bytes)
	) {
		fail("handoff_conformance_mismatch", "Gateway handoff does not bind the control-conformance sidecar bytes.");
	}
	if (
		!isPlainObject(control) ||
		!CONTROL_CONFORMANCE_SCHEMAS.has(control.schema_version) ||
		control.proof_level !== "local_state" ||
		control.writes_external !== false ||
		!sameSourceIdentity(control.source, producer) ||
		control.source.protocol_tree !== producer.protocol_tree
	) {
		fail("invalid_control_conformance", "Gateway control conformance does not bind the handoff producer identity.");
	}
	return { filename: sidecar.filename, sha256: sidecar.sha256, bytes: sidecar.bytes };
}

function assertProtocolProvenanceSidecar({ handoff, provenance, protocolProvenance, producer, protocol }) {
	if (
		!isPlainObject(provenance) ||
		provenance.schema_version !== PROTOCOL_PROVENANCE_SCHEMA ||
		provenance.proof_level !== "local_state" ||
		provenance.writes_external !== false ||
		!sameSourceIdentity(provenance.source, producer) ||
		provenance.source.protocol_tree !== producer.protocol_tree ||
		provenance.source.package_path !== "packages/ceal-protocol"
	) {
		fail("invalid_protocol_provenance", "Gateway Protocol provenance is not a verified handoff record.");
	}
	const artifact = provenance.artifact;
	if (
		!isPlainObject(artifact) ||
		artifact.package !== protocol.name ||
		artifact.version !== protocol.version ||
		artifact.filename !== protocol.filename ||
		artifact.sha256 !== protocol.sha256 ||
		artifact.npm_integrity !== protocol.integrity ||
		!sameStrings(artifact.exports, protocol.exports)
	) {
		fail("handoff_provenance_mismatch", "Gateway Protocol provenance does not bind the complete handoff record.");
	}
	const bytes = readFileSync(protocolProvenance);
	const sidecar = handoff.protocol_provenance;
	if (
		!isPlainObject(sidecar) ||
		sidecar.filename !== path.basename(protocolProvenance) ||
		sidecar.bytes !== bytes.length ||
		sidecar.sha256 !== sha256(bytes)
	) {
		fail("handoff_provenance_mismatch", "Gateway handoff does not bind the Protocol provenance sidecar bytes.");
	}
}

function validateProtocolArtifact({ inventory, repoRoot, protocolTarball, provenance, protocolRecord }) {
	const requirement = inventory.required_gateway_protocol;
	const source = provenance.source;
	const artifact = provenance.artifact;
	if (
		source.repository !== requirement.source_repository ||
		source.package_path !== requirement.source_path ||
		artifact.package !== requirement.package ||
		!sameStrings(artifact.exports, requirement.required_exports) ||
		protocolRecord.name !== requirement.package
	) {
		fail("protocol_artifact_mismatch", "Gateway Protocol tarball does not match its provenance record.");
	}
	const packageManifest = readPackedManifest(protocolTarball);
	if (
		packageManifest?.name !== requirement.package ||
		packageManifest?.version !== artifact.version ||
		!sameStrings(Object.keys(packageManifest?.exports ?? {}).sort(), requirement.required_exports)
	) {
		fail("protocol_artifact_mismatch", "Gateway Protocol tarball does not expose the declared package surface.");
	}
	for (const sourcePath of [inventory.client.source_path, inventory.worker.source_path]) {
		const manifest = readJson(path.join(repoRoot, sourcePath, "package.json"), "invalid_inventory");
		if (manifest?.dependencies?.[requirement.package] !== artifact.version) {
			fail("protocol_version_mismatch", "Worker-owned package dependency does not match the supplied Gateway Protocol artifact.");
		}
	}
	return {
		package: artifact.package,
		version: artifact.version,
		filename: artifact.filename,
		sha256: artifact.sha256,
		npm_integrity: artifact.npm_integrity,
		exports: [...artifact.exports],
		producer: { repository: source.repository, commit: source.commit, tree: source.tree, protocol_tree: source.protocol_tree },
	};
}

function readPackedManifest(tarball) {
	const bytes = readPackedManifestBytes(tarball, "invalid_protocol_tarball");
	try {
		return JSON.parse(bytes);
	} catch {
		fail("invalid_protocol_tarball", "Gateway Protocol input is not a readable package tarball.");
	}
}

function readPackedManifestBytes(tarball, code) {
	try {
		return execFileSync("tar", ["-xOzf", tarball, "package/package.json"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 1024 * 1024,
		});
	} catch {
		fail(code, "Gateway package input is not a readable package tarball.");
	}
}

function requireRegularAbsoluteFile(value, code) {
	if (typeof value !== "string" || !path.isAbsolute(value)) fail(code, "Worker release input must be an absolute regular file.");
	return requireRegularFile(path.resolve(value), code);
}

function requireRegularFile(filePath, code) {
	if (!existsSync(filePath)) fail(code, "Worker release input is missing.");
	const stat = lstatSync(filePath);
	if (!stat.isFile() || stat.isSymbolicLink()) fail(code, "Worker release input must be a regular non-symlink file.");
	return filePath;
}

function requireSha256(value, code) {
	if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
		fail(code, "Worker release trust anchor must be one lowercase SHA-256 value.");
	return value;
}

function readJson(filePath, code) {
	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		fail(code, "Worker release input JSON is invalid.");
	}
}

function normalizeRelativePath(value) {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		path.isAbsolute(value) ||
		value.includes("\\\\") ||
		value.split("/").some((part) => part.length === 0 || part === "." || part === "..")
	) {
		fail("invalid_release_input_path", "Worker release input path must be a normalized relative path.");
	}
	return value;
}

function sameStrings(value, expected) {
	return Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index]);
}

function sameSortedExports(value) {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every((entry) => typeof entry === "string" && (entry === "." || entry.startsWith("./"))) &&
		new Set(value).size === value.length &&
		sameStrings([...value].sort(), value)
	);
}

function exportKeys(exportsField) {
	if (typeof exportsField === "string" || Array.isArray(exportsField)) return ["."];
	if (!isPlainObject(exportsField)) return [];
	return Object.keys(exportsField)
		.filter((key) => key === "." || key.startsWith("./"))
		.sort();
}

function sameSourceIdentity(candidate, expected) {
	return (
		isPlainObject(candidate) &&
		candidate.repository === expected.repository &&
		candidate.commit === expected.commit &&
		candidate.tree === expected.tree
	);
}

function isSha256(value) {
	return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isPlainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
function fail(code, message) {
	throw new WorkerReleaseInputError(code, message);
}

function parseArgs(argv) {
	const parsed = parseScriptArgs(argv, {
		fail,
		values: { "--gateway-handoff-archive": "gatewayHandoffArchive" },
		valueMessage: "Worker release input option requires a value.",
		unknownMessage: "Unexpected worker release input argument.",
	});
	if (!parsed.help) assertReleaseArchiveInput(parsed.options);
	return parsed;
}

export function runCli(argv, io = console) {
	const json = argv.includes("--json");
	try {
		const parsed = parseArgs(argv);
		if (parsed.help) {
			io.log("usage: node scripts/worker-release-inputs.mjs --gateway-handoff-archive <absolute-tar.gz> [--json]");
			return 0;
		}
		const result = resolveWorkerReleaseInputsFromLockedGatewayArchive(parsed.options);
		io.log(parsed.json ? JSON.stringify(result, null, 2) : "Worker release inputs are verified.");
		return 0;
	} catch (error) {
		const known = error instanceof WorkerReleaseInputError;
		const payload = {
			schema_version: "ceal.worker_release_input_error.v1",
			ok: false,
			error_code: known ? error.code : "worker_release_input_failed",
			message: known ? error.message : "Worker release inputs could not be verified.",
		};
		if (json) io.log(JSON.stringify(payload));
		else io.error(payload.message);
		return 2;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
