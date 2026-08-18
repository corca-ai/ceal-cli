#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isJsonRecord } from "../packages/ceal-worker-cli/src/json-record.ts";
import { sha256 } from "../packages/ceal-worker-cli/src/sha256.ts";
import { sameStringArray as sameStrings } from "../packages/ceal-worker-cli/src/string-array.ts";
import { codedErrorClass } from "./lib/coded-error.ts";
import { isGitObject } from "./lib/git-object.ts";
import { isLowercaseHexDigest } from "./lib/hex-digest.ts";
import { parseScriptArgs } from "./lib/parse-script-args.ts";
import { isPromiseLike } from "./lib/promise-like.ts";
import { createJsonReader } from "./lib/read-json.ts";
import { isRegularNonSymlinkDirectory } from "./lib/regular-directory.ts";
import { assertShippableProtocolVendorPin, ProtocolVendorPinError } from "./verify-protocol-vendor-pin.ts";
import {
	type ArchiveLock,
	consumeLockedGatewayHandoffArchive,
	consumeLockedGatewayHandoffArchiveSync,
	WorkerGatewayHandoffArchiveError,
} from "./worker-gateway-handoff-archive.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INPUTS_FILENAME = "worker-release-inputs.json";
const SCHEMA_VERSION = "ceal.worker_release_inputs.v1";
const HANDOFF_SCHEMA = "ceal.gateway_protocol_handoff.v1";
// The Gateway owns the control conformance.  This consumer only binds its
// declared producer identity and bytes; it must therefore accept every
// published handoff schema whose identity envelope stays unchanged. Later
// schemas add control vectors and operations without changing that envelope;
// the explicit set still makes an unknown schema a refusal.
const CONTROL_CONFORMANCE_SCHEMAS = new Set([
	"ceal.gateway_leased_consumer_control_conformance_handoff.v1",
	"ceal.gateway_leased_consumer_control_conformance_handoff.v3",
	"ceal.gateway_leased_consumer_control_conformance_handoff.v4",
	"ceal.gateway_leased_consumer_control_conformance_handoff.v5",
	"ceal.gateway_leased_consumer_control_conformance_handoff.v6",
]);
const PROTOCOL_PROVENANCE_SCHEMA = "ceal.gateway_protocol_artifact.v1";
const HANDOFF_MARKER = ".ceal-protocol-handoff-owner";
const PROTOCOL_PACKAGE = "@corca-ai/ceal-protocol";
const RAW_HANDOFF_INPUT_KEYS = [
	"protocolTarball",
	"protocolProvenance",
	"controlConformance",
	"handoffManifest",
	"expectedHandoffSha256",
] as const;

export const WorkerReleaseInputError = codedErrorClass("WorkerReleaseInputError");

const GATEWAY_PROTOCOL_REQUIREMENT = Object.freeze({
	package: PROTOCOL_PACKAGE,
	source_repository: "corca-ai/ceal",
	source_path: "packages/ceal-protocol",
	provenance_schema: PROTOCOL_PROVENANCE_SCHEMA,
	handoff_manifest_schema: HANDOFF_SCHEMA,
	required_exports: Object.freeze([".", "./conformance"]),
});

type JsonRecord = Record<string, unknown>;
type PathInputOptions = {
	repoRoot?: string;
	inventoryPath?: string;
	protocolTarball?: string;
	protocolProvenance?: string;
	controlConformance?: string;
	handoffManifest?: string;
	expectedHandoffSha256?: string;
	gatewayHandoffArchive?: string;
};
type RawInputs = {
	repoRoot: string;
	protocolTarball: string;
	protocolProvenance: string;
	controlConformance: string;
	handoffManifest: string;
	expectedHandoffSha256: string;
};
type SourceIdentity = { repository: string; commit: string; tree: string; protocol_tree: string };
type ProvenanceSource = SourceIdentity & { package_path: string };
type PackageIdentity = { package: string; source_path: string; command?: string };
type GuideIdentity = {
	compatibility_asset: string;
	compatibility_source_path: string;
	embedded_asset: string;
	source_path: string;
	format: string;
};
type ProtocolRequirement = {
	package: string;
	source_repository: string;
	source_path: string;
	provenance_schema: string;
	handoff_manifest_schema: string;
	required_exports: readonly string[];
};
type Inventory = {
	schema_version: string;
	status: string;
	worker: PackageIdentity;
	client: PackageIdentity;
	guide: GuideIdentity;
	required_gateway_protocol: ProtocolRequirement;
	forbidden_release_inputs: string[];
	non_claims: string[];
};
type ProtocolRecord = {
	name: string;
	package: string;
	version: string;
	filename: string;
	sha256: string;
	integrity: string;
	bytes: number;
	exports: string[];
};
type ProtocolResolution = {
	package: string;
	version: string;
	filename: string;
	sha256: string;
	npm_integrity: string;
	exports: string[];
	producer: SourceIdentity;
};
type ControlConformanceRecord = { filename: string; sha256: string; bytes: number };
type TrustAnchor =
	| { kind: "caller_supplied_manifest_sha256"; value: string }
	| {
			kind: "reviewed_gateway_handoff_lock";
			lock_filename: string;
			gateway_repository: string;
			gateway_commit: string;
			gateway_tag: string;
			actions_run_id: number;
			origin: string;
			archive_filename: string;
			archive_sha256: string;
	  };
type Resolution = {
	schema_version: string;
	ok: true;
	proof_level: "local_state";
	writes_external: false;
	worker: PackageIdentity;
	client: PackageIdentity;
	guide: GuideIdentity;
	protocol: ProtocolResolution;
	control_conformance: ControlConformanceRecord;
	handoff: { filename: string; sha256: string };
	trust_anchor: TrustAnchor;
	forbidden_release_inputs: string[];
	non_claims: string[];
};
type ArchiveResult = { resolution: Resolution; rawInputs: RawInputs; lock: ArchiveLock };
type SyncInputValue = { inputs: Resolution; rawInputs: RawInputs };
type AsyncInputValue = SyncInputValue;
export type NonThenable<T> = T extends PromiseLike<unknown> ? never : T extends object ? T & { readonly then?: never } : T;
export type SyncArchiveConsumer<T> = (value: SyncInputValue) => NonThenable<T>;
export type AsyncArchiveConsumer<T> = (value: AsyncInputValue) => T | PromiseLike<T>;
type ArchiveDependencies<T> = {
	consumeArchive?: (
		options: { repoRoot: string; archiveFile?: string },
		dependencies: { resolveInputs: (raw: RawInputs) => Resolution; consume: (value: ArchiveResult) => NonThenable<T> },
	) => NonThenable<T>;
};
type AsyncArchiveDependencies<T> = {
	consumeArchive?: (
		options: { repoRoot: string; archiveFile?: string },
		dependencies: { resolveInputs: (raw: RawInputs) => Resolution; consume: (value: ArchiveResult) => T | PromiseLike<T> },
	) => T | PromiseLike<T>;
};
type PacketOptions = PathInputOptions & { requirement?: ProtocolRequirement };
type ProducerRecord = SourceIdentity & { readonly [key: string]: unknown };
type Packet = { producer: ProducerRecord; protocol: ProtocolRecord; control_conformance: ControlConformanceRecord };
type ConsoleLike = Pick<Console, "log" | "error">;

export function resolveWorkerReleaseGuideInput(options: PathInputOptions = {}): GuideIdentity {
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	const inventory = readInventory(options.inventoryPath ?? path.join(repoRoot, INPUTS_FILENAME));
	if (!isJsonRecord(inventory) || inventory.schema_version !== SCHEMA_VERSION || inventory.status !== "local_candidate_not_published")
		fail("invalid_inventory", "Worker release input inventory is invalid.");
	assertGuide(inventory.guide, repoRoot);
	return { ...inventory.guide };
}

// Re-raised as this module's error type so a caller catching WorkerReleaseInputError
// sees the refusal rather than an unrelated exception escaping the release lane.
// The code is carried through unchanged: `proof_shipment_protocol_divergence` is
// the stable name the Gateway owner decision asked for.
function assertShippableProtocolVendorPinFor(repoRoot: string): void {
	try {
		assertShippableProtocolVendorPin({ repoRoot });
	} catch (error) {
		if (error instanceof ProtocolVendorPinError) throw new WorkerReleaseInputError(error.code, error.message);
		throw error;
	}
}

export function resolveWorkerReleaseDevelopmentInputs(options: PathInputOptions = {}): Resolution {
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
	const rawInputs = rawInputOptions(repoRoot, options);
	const { protocolTarball, protocolProvenance, controlConformance, handoffManifest, expectedHandoffSha256 } = rawInputs;
	const packet = validateGatewayHandoffPacketFiles({
		controlConformance,
		handoffManifest,
		protocolTarball,
		protocolProvenance,
		expectedHandoffSha256,
		requirement: inventory.required_gateway_protocol,
	});
	const provenance = readJson(protocolProvenance, "invalid_protocol_provenance");
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

/**
 * Validates the signed packet's extracted files without consulting the worker's
 * current lock, vendored tree, or package dependency versions. The public
 * bootstrap and the locked release-input resolver therefore share one packet
 * grammar while keeping authentication separate from package consumption.
 */
export function validateGatewayHandoffPacketFiles(options: PacketOptions = {}): Packet {
	const { protocolTarball, protocolProvenance, controlConformance, handoffManifest, expectedHandoffSha256 } =
		requireGatewayHandoffPacketPaths(options);
	const provenance = readJson(protocolProvenance, "invalid_protocol_provenance");
	const control = readJson(controlConformance, "invalid_control_conformance");
	const handoff = readJson(handoffManifest, "invalid_handoff_manifest");
	if (sha256(readFileSync(handoffManifest)) !== expectedHandoffSha256) {
		fail("handoff_trust_mismatch", "Gateway handoff manifest does not match the caller-approved digest.");
	}
	const packet = validateHandoffPacket({
		requirement: options.requirement ?? GATEWAY_PROTOCOL_REQUIREMENT,
		control,
		controlConformance,
		handoff,
		protocolTarball,
		protocolProvenance,
		provenance,
	});
	return {
		producer: packet.producer,
		protocol: packet.protocol,
		control_conformance: packet.control_conformance,
	};
}

function requireGatewayHandoffPacketPaths(options: PathInputOptions): RawInputs {
	return rawInputOptions(path.resolve(options.repoRoot ?? ROOT), options);
}

export function resolveWorkerReleaseInputsFromLockedGatewayArchive(
	options: PathInputOptions = {},
	dependencies: ArchiveDependencies<Resolution> = {},
): Resolution {
	return withWorkerReleaseInputs(options, ({ inputs }) => inputs, dependencies);
}

export function withWorkerReleaseInputs<T>(
	options: PathInputOptions,
	consume: SyncArchiveConsumer<T>,
	dependencies: ArchiveDependencies<T> = {},
): T {
	assertReleaseArchiveInput(options);
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	try {
		const result = (dependencies.consumeArchive ?? consumeLockedGatewayHandoffArchiveSync)(
			{
				repoRoot,
				archiveFile: options.gatewayHandoffArchive,
			},
			{
				resolveInputs: (rawInputs) => resolveWorkerReleaseDevelopmentInputs(rawInputs),
				consume: ({ resolution, rawInputs, lock }) => consume({ inputs: lockBoundResolution(resolution, lock), rawInputs }),
			},
		);
		return assertSyncResult(result);
	} catch (error) {
		if (error instanceof WorkerGatewayHandoffArchiveError) throw new WorkerReleaseInputError(error.code, error.message);
		throw error;
	}
}

export async function withWorkerReleaseInputsAsync<T>(
	options: PathInputOptions,
	consume: AsyncArchiveConsumer<T>,
	dependencies: AsyncArchiveDependencies<T> = {},
): Promise<T> {
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

export function withWorkerReleaseDevelopmentInputs<T>(options: PathInputOptions, consume: SyncArchiveConsumer<T>): T {
	assertDevelopmentRawInputs(options);
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	assertShippableProtocolVendorPinFor(repoRoot);
	const rawInputs = rawInputOptions(repoRoot, options);
	return assertSyncResult(consume({ inputs: resolveWorkerReleaseDevelopmentInputs(rawInputs), rawInputs }));
}

export async function withWorkerReleaseDevelopmentInputsAsync<T>(options: PathInputOptions, consume: AsyncArchiveConsumer<T>): Promise<T> {
	assertDevelopmentRawInputs(options);
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	assertShippableProtocolVendorPinFor(repoRoot);
	const rawInputs = rawInputOptions(repoRoot, options);
	return await consume({ inputs: resolveWorkerReleaseDevelopmentInputs(rawInputs), rawInputs });
}

function assertSyncResult<T>(value: NonThenable<T>): T {
	if (isPromiseLike(value))
		fail("gateway_handoff_archive_async_consumer", "Synchronous Gateway handoff consumption cannot return a promise.");
	return value;
}

function rawInputOptions(repoRoot: string, options: PathInputOptions): RawInputs {
	const rawInputs = {
		repoRoot,
		protocolTarball: requireRegularAbsoluteFile(options.protocolTarball, "protocol_tarball"),
		protocolProvenance: requireRegularAbsoluteFile(options.protocolProvenance, "protocol_provenance"),
		controlConformance: requireRegularAbsoluteFile(options.controlConformance, "control_conformance"),
		handoffManifest: requireRegularAbsoluteFile(options.handoffManifest, "handoff_manifest"),
		expectedHandoffSha256: requireSha256(options.expectedHandoffSha256, "expected_handoff_sha256"),
	};
	if (
		new Set(
			[rawInputs.protocolTarball, rawInputs.protocolProvenance, rawInputs.controlConformance, rawInputs.handoffManifest].map(path.dirname),
		).size !== 1
	)
		fail("handoff_layout_mismatch", "Gateway handoff inputs must come from one complete handoff directory.");
	return rawInputs;
}

function assertReleaseArchiveInput(options: PathInputOptions): asserts options is PathInputOptions & { gatewayHandoffArchive: string } {
	if (!options.gatewayHandoffArchive)
		fail("gateway_handoff_archive_required", "Worker release commands require one lock-bound Gateway handoff archive.");
	if (RAW_HANDOFF_INPUT_KEYS.some((key) => options[key] !== undefined)) {
		fail("input_mode_conflict", "Gateway handoff archive input cannot be combined with raw handoff files or digests.");
	}
}

function assertDevelopmentRawInputs(options: PathInputOptions): void {
	if (options.gatewayHandoffArchive) fail("development_input_mode", "Development input resolution accepts raw local handoff files only.");
}

function lockBoundResolution(resolution: Resolution, lock: ArchiveLock): Resolution {
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

function readInventory(filePath: string): unknown {
	return readJson(requireRegularFile(path.resolve(filePath), "invalid_inventory"), "invalid_inventory");
}

function assertInventory(inventory: unknown, repoRoot: string): asserts inventory is Inventory {
	if (!isJsonRecord(inventory) || inventory.schema_version !== SCHEMA_VERSION || inventory.status !== "local_candidate_not_published") {
		fail("invalid_inventory", "Worker release input inventory is invalid.");
	}
	const worker = inventory.worker;
	const client = inventory.client;
	const guide = inventory.guide;
	assertWorker(worker, repoRoot);
	assertClient(client, repoRoot);
	assertGuide(guide, repoRoot);
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
			[worker.source_path, client.source_path, guide.source_path].some((allowed) => allowed === entry || allowed.startsWith(`${entry}/`)),
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

function assertWorker(worker: unknown, repoRoot: string): asserts worker is PackageIdentity {
	if (!isJsonRecord(worker) || worker.package !== "@corca-ai/ceal-worker-cli" || worker.command !== "ceal")
		fail("invalid_inventory", "Worker release inventory has an invalid worker identity.");
	assertPackageSource(repoRoot, worker.source_path, "@corca-ai/ceal-worker-cli", "ceal");
}

function assertClient(client: unknown, repoRoot: string): asserts client is PackageIdentity {
	if (!isJsonRecord(client) || client.package !== "@corca-ai/ceal")
		fail("invalid_inventory", "Worker release inventory has an invalid client identity.");
	assertPackageSource(repoRoot, client.source_path, "@corca-ai/ceal");
}

function assertGuide(guide: unknown, repoRoot: string): asserts guide is GuideIdentity {
	if (
		!isJsonRecord(guide) ||
		typeof guide.compatibility_asset !== "string" ||
		typeof guide.compatibility_source_path !== "string" ||
		typeof guide.embedded_asset !== "string" ||
		typeof guide.source_path !== "string" ||
		typeof guide.format !== "string" ||
		guide.compatibility_asset !== "ceal-guide-SKILL.md" ||
		guide.compatibility_source_path !== "scripts/assets/ceal-guide-compatibility-SKILL.md" ||
		guide.embedded_asset !== "ceal-guide.tar" ||
		guide.source_path !== "skills/ceal-guide" ||
		guide.format !== "ustar"
	)
		fail("invalid_inventory", "Worker release inventory has an invalid guide identity.");
	const directory = path.join(repoRoot, guide.source_path);
	if (!isRegularNonSymlinkDirectory(directory))
		fail("invalid_inventory", "Worker release guide input must be a regular non-symlink directory.");
	requireRegularFile(path.join(directory, "SKILL.md"), "invalid_inventory");
	requireRegularFile(path.join(repoRoot, guide.compatibility_source_path), "invalid_inventory");
}

function assertPackageSource(repoRoot: string, sourcePath: unknown, expectedName: string, command?: string): asserts sourcePath is string {
	const normalizedSourcePath = normalizeRelativePath(sourcePath);
	const manifest = readJson(path.join(repoRoot, normalizedSourcePath, "package.json"), "invalid_inventory");
	if (!isJsonRecord(manifest)) fail("invalid_inventory", "Worker release package identity is invalid.");
	const bin = manifest.bin;
	if (manifest.name !== expectedName || (command && (!isJsonRecord(bin) || bin[command] !== "./dist/bin.js"))) {
		fail("invalid_inventory", "Worker release package identity is invalid.");
	}
}

function assertProtocolRequirement(protocol: unknown): asserts protocol is ProtocolRequirement {
	if (
		!isJsonRecord(protocol) ||
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

function validateHandoffPacket({
	requirement,
	control,
	controlConformance,
	handoff,
	protocolTarball,
	protocolProvenance,
	provenance,
}: {
	requirement: ProtocolRequirement;
	control: unknown;
	controlConformance: string;
	handoff: unknown;
	protocolTarball: string;
	protocolProvenance: string;
	provenance: unknown;
}): { producer: ProducerRecord; protocol: ProtocolRecord; control_conformance: ControlConformanceRecord } {
	if (
		!isJsonRecord(handoff) ||
		handoff.schema_version !== HANDOFF_SCHEMA ||
		handoff.ok !== true ||
		handoff.proof_level !== "local_state" ||
		handoff.writes_external !== false
	) {
		fail("invalid_handoff_manifest", "Gateway handoff manifest is not a self-consistent producer record.");
	}
	const producer = requireProducerRecord(handoff.producer);
	if (producer.scoped_paths_clean !== true) {
		fail("invalid_handoff_manifest", "Gateway handoff producer identity is invalid.");
	}
	const verifiedProducer = requireSourceIdentity(producer);
	if (
		verifiedProducer.repository !== requirement.source_repository ||
		!isGitObject(verifiedProducer.commit) ||
		!isGitObject(verifiedProducer.tree) ||
		!isGitObject(verifiedProducer.protocol_tree)
	)
		fail("invalid_handoff_manifest", "Gateway handoff producer identity is invalid.");
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
		expectedName: requirement.package,
		code: "protocol_artifact_mismatch",
	});
	const controlRecord = assertControlConformanceSidecar({ handoff, control, controlConformance, producer: verifiedProducer });
	assertProtocolProvenanceSidecar({ handoff, provenance, protocolProvenance, producer: verifiedProducer, protocol });
	return { producer, protocol, control_conformance: controlRecord };
}

// One record, not a pair. The handoff used to carry this repository's own client
// tarball alongside the Protocol, so the manifest declared an ordered two-package
// array and the resolver checked that the client named the right Protocol
// version. The client is packed here now, from the source this repository owns,
// and `validateProtocolArtifact` already asserts that the owned client and worker
// manifests name the supplied Protocol version — so nothing that check covered
// was lost with the second record, only the redundant external witness for it.
function validateProtocolRecord(record: unknown): ProtocolRecord {
	if (
		!isJsonRecord(record) ||
		record.package !== PROTOCOL_PACKAGE ||
		typeof record.version !== "string" ||
		!/^\d+\.\d+\.\d+$/u.test(record.version) ||
		record.filename !== `corca-ai-ceal-protocol-${record.version}.tgz` ||
		!isLowercaseHexDigest(record.sha256, 64) ||
		typeof record.integrity !== "string" ||
		!record.integrity.startsWith("sha512-") ||
		typeof record.bytes !== "number" ||
		!Number.isSafeInteger(record.bytes) ||
		record.bytes <= 0 ||
		!sameSortedExports(record.exports)
	) {
		fail("invalid_handoff_manifest", "Gateway handoff Protocol record is invalid.");
	}
	return {
		name: record.package,
		package: record.package,
		version: record.version,
		filename: record.filename,
		sha256: record.sha256,
		integrity: record.integrity,
		bytes: record.bytes,
		exports: [...record.exports],
	};
}

function assertArtifactBytes({
	tarball,
	record,
	code,
	message,
}: {
	tarball: string;
	record: ProtocolRecord;
	code: string;
	message: string;
}): void {
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

function assertPackedPackage({
	tarball,
	record,
	expectedName,
	code,
}: {
	tarball: string;
	record: ProtocolRecord;
	expectedName: string;
	code: string;
}): JsonRecord {
	const manifestBytes = readPackedManifestBytes(tarball, code);
	let manifest: unknown;
	try {
		manifest = JSON.parse(manifestBytes);
	} catch {
		fail(code, "Gateway package tarball has an invalid package manifest.");
	}
	if (!isJsonRecord(manifest)) fail(code, "Gateway package tarball has an invalid package manifest.");
	if (
		manifest?.name !== expectedName ||
		manifest?.version !== record.version ||
		!sameStrings(exportKeys(manifest.exports), record.exports)
	) {
		fail(code, "Gateway package tarball does not match its complete handoff record.");
	}
	return manifest;
}

function assertHandoffMarker(directory: string): void {
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
function assertControlConformanceSidecar({
	handoff,
	control,
	controlConformance,
	producer,
}: {
	handoff: JsonRecord;
	control: unknown;
	controlConformance: string;
	producer: SourceIdentity;
}): ControlConformanceRecord {
	const bytes = readFileSync(controlConformance);
	const sidecar = handoff.control_conformance;
	const controlSource = isJsonRecord(control) ? requireSourceIdentity(control.source, "invalid_control_conformance") : null;
	if (
		!isJsonRecord(sidecar) ||
		sidecar.filename !== path.basename(controlConformance) ||
		sidecar.bytes !== bytes.length ||
		sidecar.sha256 !== sha256(bytes)
	) {
		fail("handoff_conformance_mismatch", "Gateway handoff does not bind the control-conformance sidecar bytes.");
	}
	if (
		!isJsonRecord(control) ||
		typeof control.schema_version !== "string" ||
		!CONTROL_CONFORMANCE_SCHEMAS.has(control.schema_version) ||
		control.proof_level !== "local_state" ||
		control.writes_external !== false ||
		!controlSource ||
		!sameSourceIdentity(controlSource, producer) ||
		controlSource.protocol_tree !== producer.protocol_tree
	) {
		fail("invalid_control_conformance", "Gateway control conformance does not bind the handoff producer identity.");
	}
	return { filename: sidecar.filename, sha256: sidecar.sha256, bytes: sidecar.bytes };
}

function assertProtocolProvenanceSidecar({
	handoff,
	provenance,
	protocolProvenance,
	producer,
	protocol,
}: {
	handoff: JsonRecord;
	provenance: unknown;
	protocolProvenance: string;
	producer: SourceIdentity;
	protocol: ProtocolRecord;
}): void {
	const provenanceSource = isJsonRecord(provenance) ? requireProvenanceSource(provenance.source, "invalid_protocol_provenance") : null;
	if (
		!isJsonRecord(provenance) ||
		provenance.schema_version !== PROTOCOL_PROVENANCE_SCHEMA ||
		provenance.proof_level !== "local_state" ||
		provenance.writes_external !== false ||
		!provenanceSource ||
		!sameSourceIdentity(provenanceSource, producer) ||
		provenanceSource.protocol_tree !== producer.protocol_tree ||
		provenanceSource.package_path !== "packages/ceal-protocol"
	) {
		fail("invalid_protocol_provenance", "Gateway Protocol provenance is not a verified handoff record.");
	}
	const artifact = provenance.artifact;
	if (
		!isJsonRecord(artifact) ||
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
		!isJsonRecord(sidecar) ||
		sidecar.filename !== path.basename(protocolProvenance) ||
		sidecar.bytes !== bytes.length ||
		sidecar.sha256 !== sha256(bytes)
	) {
		fail("handoff_provenance_mismatch", "Gateway handoff does not bind the Protocol provenance sidecar bytes.");
	}
}

function validateProtocolArtifact({
	inventory,
	repoRoot,
	protocolTarball,
	provenance,
	protocolRecord,
}: {
	inventory: Inventory;
	repoRoot: string;
	protocolTarball: string;
	provenance: unknown;
	protocolRecord: ProtocolRecord;
}): ProtocolResolution {
	const requirement = inventory.required_gateway_protocol;
	if (!isJsonRecord(provenance) || !isJsonRecord(provenance.artifact))
		fail("invalid_protocol_provenance", "Gateway Protocol provenance is invalid.");
	const source = requireProvenanceSource(provenance.source);
	const artifact = provenance.artifact;
	if (
		typeof artifact.package !== "string" ||
		typeof artifact.version !== "string" ||
		typeof artifact.filename !== "string" ||
		typeof artifact.sha256 !== "string" ||
		typeof artifact.npm_integrity !== "string" ||
		!sameSortedExports(artifact.exports)
	)
		fail("invalid_protocol_provenance", "Gateway Protocol provenance is invalid.");
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
	if (!isJsonRecord(packageManifest))
		fail("protocol_artifact_mismatch", "Gateway Protocol tarball does not expose the declared package surface.");
	if (
		packageManifest?.name !== requirement.package ||
		packageManifest?.version !== artifact.version ||
		!sameStrings(Object.keys(packageManifest?.exports ?? {}).sort(), requirement.required_exports)
	) {
		fail("protocol_artifact_mismatch", "Gateway Protocol tarball does not expose the declared package surface.");
	}
	for (const sourcePath of [inventory.client.source_path, inventory.worker.source_path]) {
		const manifest = readJson(path.join(repoRoot, sourcePath, "package.json"), "invalid_inventory");
		if (!isJsonRecord(manifest) || !isJsonRecord(manifest.dependencies) || manifest.dependencies[requirement.package] !== artifact.version) {
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

function readPackedManifest(tarball: string): unknown {
	const bytes = readPackedManifestBytes(tarball, "invalid_protocol_tarball");
	try {
		return JSON.parse(bytes);
	} catch {
		fail("invalid_protocol_tarball", "Gateway Protocol input is not a readable package tarball.");
	}
}

function readPackedManifestBytes(tarball: string, code: string): string {
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

function requireRegularAbsoluteFile(value: unknown, code: string): string {
	if (typeof value !== "string" || !path.isAbsolute(value)) fail(code, "Worker release input must be an absolute regular file.");
	return requireRegularFile(path.resolve(value), code);
}

function requireRegularFile(filePath: string, code: string): string {
	if (!existsSync(filePath)) fail(code, "Worker release input is missing.");
	const stat = lstatSync(filePath);
	if (!stat.isFile() || stat.isSymbolicLink()) fail(code, "Worker release input must be a regular non-symlink file.");
	return filePath;
}

function requireSha256(value: unknown, code: string): string {
	if (!isLowercaseHexDigest(value, 64)) fail(code, "Worker release trust anchor must be one lowercase SHA-256 value.");
	return value;
}

function normalizeRelativePath(value: unknown): string {
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

function sameSortedExports(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every((entry) => typeof entry === "string" && (entry === "." || entry.startsWith("./"))) &&
		new Set(value).size === value.length &&
		sameStrings([...value].sort(), value)
	);
}

function exportKeys(exportsField: unknown): string[] {
	if (typeof exportsField === "string" || Array.isArray(exportsField)) return ["."];
	if (!isJsonRecord(exportsField)) return [];
	return Object.keys(exportsField)
		.filter((key) => key === "." || key.startsWith("./"))
		.sort();
}

function sameSourceIdentity(candidate: unknown, expected: SourceIdentity): candidate is SourceIdentity {
	return (
		isJsonRecord(candidate) &&
		candidate.repository === expected.repository &&
		candidate.commit === expected.commit &&
		candidate.tree === expected.tree
	);
}

function requireSourceIdentity(value: unknown, code = "invalid_handoff_manifest"): SourceIdentity {
	if (
		!isJsonRecord(value) ||
		typeof value.repository !== "string" ||
		typeof value.commit !== "string" ||
		typeof value.tree !== "string" ||
		typeof value.protocol_tree !== "string"
	) {
		fail(code, "Gateway handoff producer identity is invalid.");
	}
	return { repository: value.repository, commit: value.commit, tree: value.tree, protocol_tree: value.protocol_tree };
}

function requireProducerRecord(value: unknown, code = "invalid_handoff_manifest"): ProducerRecord {
	if (!isJsonRecord(value)) fail(code, "Gateway handoff producer identity is invalid.");
	const source = requireSourceIdentity(value, code);
	return { ...value, ...source };
}

function requireProvenanceSource(value: unknown, code = "invalid_protocol_provenance"): ProvenanceSource {
	const source = requireSourceIdentity(value, code);
	if (!isJsonRecord(value) || typeof value.package_path !== "string") fail(code, "Gateway Protocol provenance source is invalid.");
	return { ...source, package_path: value.package_path };
}

function fail(code: string, message: string): never {
	throw new WorkerReleaseInputError(code, message);
}

const readJson = createJsonReader(fail, "Worker release input JSON is invalid.");

function parseArgs(argv: readonly string[]): { help: boolean; json: boolean; options: PathInputOptions } {
	const parsed = parseScriptArgs(argv, {
		fail,
		values: { "--gateway-handoff-archive": "gatewayHandoffArchive" },
		valueMessage: "Worker release input option requires a value.",
		unknownMessage: "Unexpected worker release input argument.",
	});
	if (!parsed.help) assertReleaseArchiveInput(parsed.options);
	return parsed;
}

export function runCli(argv: readonly string[], io: ConsoleLike = console): number {
	const json = argv.includes("--json");
	try {
		const parsed = parseArgs(argv);
		if (parsed.help) {
			io.log("usage: node scripts/worker-release-inputs.ts --gateway-handoff-archive <absolute-tar.gz> [--json]");
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
