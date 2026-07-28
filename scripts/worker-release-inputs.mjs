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
const HANDOFF_SCHEMA = "ceal.repository_extraction_gateway_handoff.v1";
const CONFORMANCE_PROOF_SCHEMA = "ceal.repository_extraction_private_gateway_conformance.v1";
const PROTOCOL_PROVENANCE_SCHEMA = "ceal.gateway_protocol_artifact.v1";
const HANDOFF_MARKER = ".ceal-handoff-owner";
const GIT_OBJECT_ID = /^[a-f0-9]{40}$/u;
const PACKAGE_NAMES = ["@corca-ai/ceal-protocol", "@corca-ai/ceal"];
const RAW_HANDOFF_INPUT_KEYS = [
	"protocolTarball",
	"clientTarball",
	"protocolProvenance",
	"conformanceProof",
	"handoffManifest",
	"expectedHandoffSha256",
];

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
	const clientTarball = requireRegularAbsoluteFile(options.clientTarball, "client_tarball");
	const protocolProvenance = requireRegularAbsoluteFile(options.protocolProvenance, "protocol_provenance");
	const conformanceProof = requireRegularAbsoluteFile(options.conformanceProof, "conformance_proof");
	const handoffManifest = requireRegularAbsoluteFile(options.handoffManifest, "handoff_manifest");
	const expectedHandoffSha256 = requireSha256(options.expectedHandoffSha256, "expected_handoff_sha256");
	if (
		new Set([
			path.dirname(protocolTarball),
			path.dirname(clientTarball),
			path.dirname(protocolProvenance),
			path.dirname(conformanceProof),
			path.dirname(handoffManifest),
		]).size !== 1
	) {
		fail("handoff_layout_mismatch", "Gateway handoff inputs must come from one complete handoff directory.");
	}
	const provenance = readJson(protocolProvenance, "invalid_protocol_provenance");
	const proof = readJson(conformanceProof, "invalid_conformance_proof");
	const handoff = readJson(handoffManifest, "invalid_handoff_manifest");
	if (sha256(readFileSync(handoffManifest)) !== expectedHandoffSha256) {
		fail("handoff_trust_mismatch", "Gateway handoff manifest does not match the caller-approved digest.");
	}
	const packet = validateHandoffPacket({
		inventory,
		clientTarball,
		conformanceProof,
		handoff,
		proof,
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
		gateway_client: packet.client,
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
		clientTarball: options.clientTarball,
		protocolProvenance: options.protocolProvenance,
		conformanceProof: options.conformanceProof,
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
			artifact_name: lock.artifact_name,
			archive_filename: lock.archive_filename,
			archive_sha256: lock.archive_sha256,
		},
		non_claims: [
			...resolution.non_claims.filter((entry) => !entry.startsWith("This caller-supplied digest")),
			"The reviewed lock binds a locally supplied archive; it does not download an Actions artifact, publish a release, or prove a signature identity.",
		],
	};
}

export function assertWorkerReleaseSourcePath(inventory, candidate) {
	const normalized = normalizeRelativePath(candidate);
	if (inventory.forbidden_release_inputs.some((blocked) => normalized === blocked || normalized.startsWith(`${blocked}/`))) {
		fail("forbidden_release_input", "Gateway-owned or legacy composite material is not a worker-release input.");
	}
	const allowed = [inventory.worker.source_path, inventory.client.source_path, inventory.guide.source_path];
	if (!allowed.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`))) {
		fail("undeclared_release_input", "Worker release input is not declared by the owned-input inventory.");
	}
	return normalized;
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
		protocol.handoff_manifest_schema !== "ceal.repository_extraction_gateway_handoff.v1" ||
		!sameStrings(protocol.required_exports, [".", "./conformance"])
	) {
		fail("invalid_inventory", "Worker release inventory has an invalid Gateway Protocol requirement.");
	}
}

function validateHandoffPacket({
	inventory,
	clientTarball,
	conformanceProof,
	handoff,
	proof,
	protocolTarball,
	protocolProvenance,
	provenance,
}) {
	if (
		!isPlainObject(handoff) ||
		handoff.schema_version !== HANDOFF_SCHEMA ||
		handoff.ok !== true ||
		handoff.proof_level !== "host_decision" ||
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
		producer.scoped_paths_clean !== true
	) {
		fail("invalid_handoff_manifest", "Gateway handoff producer identity is invalid.");
	}
	const records = packageRecords(handoff.packages);
	const protocol = records.get(inventory.required_gateway_protocol.package);
	const client = records.get(inventory.client.package);
	assertHandoffMarker(path.dirname(conformanceProof));
	assertArtifactBytes({
		tarball: protocolTarball,
		record: protocol,
		code: "protocol_artifact_mismatch",
		message: "Gateway Protocol tarball does not match the complete handoff packet.",
	});
	assertArtifactBytes({
		tarball: clientTarball,
		record: client,
		code: "client_artifact_mismatch",
		message: "Gateway client tarball does not match the complete handoff packet.",
	});
	const protocolManifest = assertPackedPackage({
		tarball: protocolTarball,
		record: protocol,
		expectedName: inventory.required_gateway_protocol.package,
		code: "protocol_artifact_mismatch",
	});
	const clientManifest = assertPackedPackage({
		tarball: clientTarball,
		record: client,
		expectedName: inventory.client.package,
		code: "client_artifact_mismatch",
	});
	if (clientManifest.dependencies?.[protocol.name] !== protocolManifest.version) {
		fail("client_artifact_mismatch", "Gateway client tarball does not declare the supplied Gateway Protocol version.");
	}
	assertConformanceProof({ handoff, proof, conformanceProof, producer, records });
	assertProtocolProvenanceSidecar({ handoff, provenance, protocolProvenance, producer, protocol });
	return { protocol, client };
}

function packageRecords(value) {
	if (!Array.isArray(value) || value.length !== PACKAGE_NAMES.length || value.some((entry, index) => entry?.name !== PACKAGE_NAMES[index])) {
		fail("invalid_handoff_manifest", "Gateway handoff must contain the exact Protocol and client package pair in canonical order.");
	}
	const records = new Map(value.map((entry) => [entry.name, validatePackageRecord(entry)]));
	if (records.size !== PACKAGE_NAMES.length) fail("invalid_handoff_manifest", "Gateway handoff package records must be unique.");
	return records;
}

function validatePackageRecord(record) {
	if (
		!isPlainObject(record) ||
		typeof record.version !== "string" ||
		!/^\d+\.\d+\.\d+$/u.test(record.version) ||
		typeof record.filename !== "string" ||
		record.filename !== path.basename(record.filename) ||
		!record.filename.endsWith(".tgz") ||
		!isSha256(record.sha256) ||
		typeof record.integrity !== "string" ||
		!record.integrity.startsWith("sha512-") ||
		!Number.isSafeInteger(record.bytes) ||
		record.bytes <= 0 ||
		!sameSortedExports(record.declared_exports) ||
		!isSha256(record.package_manifest_sha256)
	) {
		fail("invalid_handoff_manifest", "Gateway handoff package record is invalid.");
	}
	return { ...record, declared_exports: [...record.declared_exports] };
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
		sha256(manifestBytes) !== record.package_manifest_sha256 ||
		!sameStrings(exportKeys(manifest.exports), record.declared_exports)
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

function assertConformanceProof({ handoff, proof, conformanceProof, producer, records }) {
	const bytes = readFileSync(conformanceProof);
	const sidecar = handoff.conformance_proof;
	const digest = handoff.conformance_proof_digest;
	if (
		!isPlainObject(sidecar) ||
		sidecar.filename !== path.basename(conformanceProof) ||
		sidecar.bytes !== bytes.length ||
		!isPlainObject(digest) ||
		digest.algorithm !== "sha256" ||
		digest.canonicalization !== "utf8-json-pretty-v1" ||
		digest.value !== sha256(bytes)
	) {
		fail("handoff_conformance_mismatch", "Gateway handoff does not bind the conformance-proof sidecar bytes.");
	}
	if (
		!isPlainObject(proof) ||
		proof.schema_version !== CONFORMANCE_PROOF_SCHEMA ||
		proof.ok !== true ||
		proof.proof_level !== "host_decision" ||
		proof.writes_external !== false ||
		!sameProducer(proof.source_identity, producer)
	) {
		fail("invalid_conformance_proof", "Gateway conformance proof does not bind the handoff producer identity.");
	}
	if (!Array.isArray(proof.packages) || proof.packages.length !== PACKAGE_NAMES.length) {
		fail("invalid_conformance_proof", "Gateway conformance proof does not contain the required package pair.");
	}
	for (const name of PACKAGE_NAMES) {
		const record = records.get(name);
		const packageProof = proof.packages.find((entry) => entry?.name === name);
		if (
			!packageProof ||
			packageProof.name !== name ||
			packageProof.version !== record.version ||
			packageProof.filename !== record.filename ||
			packageProof.sha256 !== record.sha256 ||
			packageProof.integrity !== record.integrity ||
			packageProof.bytes !== record.bytes ||
			!sameStrings(packageProof.declared_exports, record.declared_exports) ||
			packageProof.package_manifest_sha256 !== record.package_manifest_sha256 ||
			packageProof.installed_as_regular_directory !== true
		) {
			fail("handoff_conformance_mismatch", "Gateway conformance proof does not bind every supplied package record.");
		}
	}
}

function assertProtocolProvenanceSidecar({ handoff, provenance, protocolProvenance, producer, protocol }) {
	if (
		!isPlainObject(provenance) ||
		provenance.schema_version !== PROTOCOL_PROVENANCE_SCHEMA ||
		provenance.proof_level !== "host_decision" ||
		provenance.writes_external !== false ||
		!sameSourceIdentity(provenance.source, producer) ||
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
		!sameStrings(artifact.exports, protocol.declared_exports)
	) {
		fail("handoff_provenance_mismatch", "Gateway Protocol provenance does not bind the complete handoff record.");
	}
	const bytes = readFileSync(protocolProvenance);
	const sidecar = handoff.protocol_provenance;
	const digest = handoff.protocol_provenance_digest;
	if (
		!isPlainObject(sidecar) ||
		sidecar.filename !== path.basename(protocolProvenance) ||
		sidecar.bytes !== bytes.length ||
		!isPlainObject(digest) ||
		digest.algorithm !== "sha256" ||
		digest.canonicalization !== "utf8-json-pretty-v1" ||
		digest.value !== sha256(bytes)
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
		producer: { repository: source.repository, commit: source.commit, tree: source.tree },
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

function sameProducer(candidate, expected) {
	return (
		isPlainObject(candidate) &&
		candidate.repository === expected.repository &&
		candidate.commit === expected.commit &&
		candidate.tree === expected.tree &&
		candidate.scoped_paths_clean === true
	);
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
