import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isJsonRecord } from "../packages/ceal-worker-cli/src/json-record.ts";
import { sha256 } from "../packages/ceal-worker-cli/src/sha256.ts";
import { codedErrorClass } from "./lib/coded-error.ts";
import { isGitObject } from "./lib/git-object.ts";
import { isLowercaseHexDigest } from "./lib/hex-digest.ts";
import { isPromiseLike } from "./lib/promise-like.ts";
import { createJsonReader } from "./lib/read-json.ts";

const LOCK_FILENAME = "gateway-protocol-handoff-lock.json";
const LOCK_SCHEMA_V1 = "ceal.worker_gateway_protocol_handoff_lock.v1";
const LOCK_SCHEMA_V2 = "ceal.worker_gateway_protocol_handoff_lock.v2";
const HANDOFF_SCHEMA = "ceal.gateway_protocol_handoff.v1";
const HANDOFF_MARKER = ".ceal-protocol-handoff-owner";
// The Gateway handoff used to carry the Protocol and this repository's own
// client tarball in one packet, plus a private conformance proof about the pair.
// The protocol-only handoff carries neither: the client is packed here, from the
// source this repository owns, and the Gateway ships the control conformance it
// owns instead. A member list is the whole security surface of an archive, so it
// is spelled out rather than derived.
const HANDOFF_FILES = [
	HANDOFF_MARKER,
	"gateway-leased-consumer-control-conformance.json",
	"gateway-protocol-handoff.json",
	"gateway-protocol-provenance.json",
];

const ORIGIN = "https://ceal.borca.ai/releases/gateway-protocol-handoff";

type JsonRecord = Record<string, unknown>;
export type ArchiveOptions = { repoRoot: string; archiveFile?: string };
export type RawInputs = {
	repoRoot: string;
	protocolTarball: string;
	protocolProvenance: string;
	controlConformance: string;
	handoffManifest: string;
	expectedHandoffSha256: string;
	clientTarball?: never;
};
export type ProducerIdentity = { repository: string; commit: string; tree: string; protocol_tree: string };
export type ArchiveResolution = {
	protocol?: { sha256?: string; producer?: Partial<ProducerIdentity> };
	[key: string]: unknown;
};
type GatewayLock = {
	repository: string;
	workflow_path: string;
	commit: string;
	tree: string;
	protocol_tree: string;
	tag: string;
	actions_run_id: number;
	origin: string;
};
type ProtocolBinding = { package: string; version: string; filename: string; sha256: string };
type ArchiveBinding = { filename: string; sha256: string; handoff_manifest_sha256: string; control_routes_sha256?: string };
type ValidatedLock = { gateway: GatewayLock; archive: ArchiveBinding; protocol: ProtocolBinding };
export type ArchiveLock = {
	filename: string;
	gateway_repository: string;
	gateway_commit: string;
	gateway_tag: string;
	actions_run_id: number;
	origin: string;
	archive_filename: string;
	archive_sha256: string;
};
export type PreparedArchive<R extends ArchiveResolution = ArchiveResolution> = {
	resolution: R;
	rawInputs: RawInputs;
	lock: ArchiveLock;
	cleanup: () => void;
};
export type SyncArchiveDependencies<R extends ArchiveResolution = ArchiveResolution, T = R> = {
	consume?: (prepared: PreparedArchive<R>) => T;
	resolveInputs?: (rawInputs: RawInputs) => R;
	copyArchive?: (source: string, destination: string) => void;
	extract?: (archive: string, destination: string) => void;
};
type AsyncArchiveDependencies<R extends ArchiveResolution = ArchiveResolution, T = R> = Omit<SyncArchiveDependencies<R, T>, "consume"> & {
	consume?: (prepared: PreparedArchive<R>) => T | PromiseLike<T>;
};

export const WorkerGatewayHandoffArchiveError = codedErrorClass("WorkerGatewayHandoffArchiveError");

// `resolveLockedGatewayHandoffArchive` stood here from 2026-07-23 (437332a) and
// never had a production caller — checked at every commit that touched it. It was
// also not a distinct capability: both `consume*` variants below return exactly
// `{ resolution, lock }` when no `consume` dependency is supplied, which is all it
// did. Its tests exercised the unused wrapper, so the consumed path could have
// drifted from the proven one with nothing noticing; they call the sync variant
// now. Verifies a source-reviewed lock and a locally supplied archive, extracts
// the exact packet into a disposable directory, and invokes the worker input
// resolver. Neither variant downloads, uploads, installs, or releases.
export function consumeLockedGatewayHandoffArchiveSync<R extends ArchiveResolution, T>(
	options: ArchiveOptions,
	dependencies: SyncArchiveDependencies<R, T> & { consume: (prepared: PreparedArchive<R>) => T },
): T;
export function consumeLockedGatewayHandoffArchiveSync<R extends ArchiveResolution = ArchiveResolution>(
	options: ArchiveOptions,
	dependencies?: SyncArchiveDependencies<R>,
): { resolution: R; lock: ArchiveLock };
export function consumeLockedGatewayHandoffArchiveSync<R extends ArchiveResolution, T>(
	options: ArchiveOptions,
	dependencies: SyncArchiveDependencies<R, T> = {},
): { resolution: R; lock: ArchiveLock } | T {
	const prepared = prepareLockedGatewayHandoffArchive(options, dependencies);
	try {
		if (typeof dependencies.consume !== "function") return { resolution: prepared.resolution, lock: prepared.lock };
		const result = dependencies.consume(prepared);
		if (isPromiseLike(result))
			fail("gateway_handoff_archive_async_consumer", "Synchronous Gateway handoff consumption cannot return a promise.");
		return result;
	} finally {
		prepared.cleanup();
	}
}

export function consumeLockedGatewayHandoffArchive<R extends ArchiveResolution, T>(
	options: ArchiveOptions,
	dependencies: AsyncArchiveDependencies<R, T> & { consume: (prepared: PreparedArchive<R>) => T | PromiseLike<T> },
): Promise<T>;
export function consumeLockedGatewayHandoffArchive<R extends ArchiveResolution = ArchiveResolution>(
	options: ArchiveOptions,
	dependencies?: AsyncArchiveDependencies<R>,
): Promise<{ resolution: R; lock: ArchiveLock }>;
export async function consumeLockedGatewayHandoffArchive<R extends ArchiveResolution, T>(
	options: ArchiveOptions,
	dependencies: AsyncArchiveDependencies<R, T> = {},
): Promise<{ resolution: R; lock: ArchiveLock } | T> {
	const prepared = prepareLockedGatewayHandoffArchive(options, dependencies);
	try {
		if (typeof dependencies.consume !== "function") return { resolution: prepared.resolution, lock: prepared.lock };
		return await dependencies.consume(prepared);
	} finally {
		prepared.cleanup();
	}
}

function prepareLockedGatewayHandoffArchive<R extends ArchiveResolution>(
	options: ArchiveOptions,
	dependencies: Pick<SyncArchiveDependencies<R>, "resolveInputs" | "copyArchive" | "extract">,
): PreparedArchive<R> {
	const repoRoot = path.resolve(options.repoRoot);
	const archive = requireRegularAbsoluteFile(options.archiveFile, "invalid_gateway_handoff_archive");
	const lockPath = requireRegularFile(path.join(repoRoot, LOCK_FILENAME), "gateway_handoff_lock_missing");
	const lock = validateLock(readJson(lockPath, "invalid_gateway_handoff_lock"));
	if (path.basename(archive) !== lock.archive.filename)
		fail("gateway_handoff_archive_mismatch", "Gateway handoff archive does not match the reviewed lock.");
	const staging = mkdtempSync(path.join(tmpdir(), "ceal-worker-gateway-handoff-"));
	const copiedArchive = path.join(staging, lock.archive.filename);
	const extraction = path.join(staging, "packet");
	try {
		(dependencies.copyArchive ?? copyFileSync)(archive, copiedArchive);
		requireRegularFile(copiedArchive, "gateway_handoff_archive_copy_failed");
		assertArchiveLockBinding(copiedArchive, lock);
		assertArchiveInventory(copiedArchive, lock);
		mkdirSync(extraction, { mode: 0o700 });
		(dependencies.extract ?? extractArchive)(copiedArchive, extraction);
		assertExtractedPacket(extraction, lock);
		const rawInputs = {
			repoRoot,
			protocolTarball: path.join(extraction, lock.protocol.filename),
			protocolProvenance: path.join(extraction, "gateway-protocol-provenance.json"),
			controlConformance: path.join(extraction, "gateway-leased-consumer-control-conformance.json"),
			handoffManifest: path.join(extraction, "gateway-protocol-handoff.json"),
			expectedHandoffSha256: lock.archive.handoff_manifest_sha256,
		};
		const resolution = dependencies.resolveInputs?.(rawInputs);
		if (
			!resolution ||
			resolution.protocol?.producer?.commit !== lock.gateway.commit ||
			resolution.protocol?.producer?.tree !== lock.gateway.tree ||
			resolution.protocol?.producer?.protocol_tree !== lock.gateway.protocol_tree ||
			resolution.protocol?.sha256 !== lock.protocol.sha256
		) {
			fail("gateway_handoff_lock_mismatch", "Gateway handoff archive does not resolve to the locked Gateway producer identity.");
		}
		return {
			resolution,
			rawInputs,
			lock: {
				filename: path.basename(lockPath),
				gateway_repository: lock.gateway.repository,
				gateway_commit: lock.gateway.commit,
				gateway_tag: lock.gateway.tag,
				actions_run_id: lock.gateway.actions_run_id,
				origin: lock.gateway.origin,
				archive_filename: lock.archive.filename,
				archive_sha256: lock.archive.sha256,
			},
			cleanup: () => rmSync(staging, { recursive: true, force: true }),
		};
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
}

function validateLock(value: unknown): ValidatedLock {
	if (
		!isJsonRecord(value) ||
		typeof value.schema_version !== "string" ||
		![LOCK_SCHEMA_V1, LOCK_SCHEMA_V2].includes(value.schema_version) ||
		value.status !== "locked"
	) {
		fail("invalid_gateway_handoff_lock", "Gateway handoff lock is invalid or not yet locked.");
	}
	const gateway = value.gateway;
	const archive = value.archive;
	if (!isJsonRecord(gateway) || !isJsonRecord(archive))
		fail("invalid_gateway_handoff_lock", "Gateway handoff lock has an invalid immutable producer identity.");
	if (
		!isJsonRecord(gateway) ||
		gateway.repository !== "corca-ai/ceal" ||
		gateway.workflow_path !== ".github/workflows/gateway-protocol-handoff-release.yml" ||
		!isGitObject(gateway.commit) ||
		!isGitObject(gateway.tree) ||
		!isGitObject(gateway.protocol_tree) ||
		typeof gateway.actions_run_id !== "number" ||
		!Number.isSafeInteger(gateway.actions_run_id) ||
		gateway.actions_run_id <= 0 ||
		typeof gateway.tag !== "string" ||
		!/^gateway-protocol-handoff-v\d+\.\d+\.\d+$/u.test(gateway.tag) ||
		gateway.origin !== ORIGIN
	) {
		fail("invalid_gateway_handoff_lock", "Gateway handoff lock has an invalid immutable producer identity.");
	}
	const version = gateway.tag.slice("gateway-protocol-handoff-v".length);
	if (
		!isJsonRecord(archive) ||
		archive.filename !== `ceal-gateway-protocol-handoff-${version}.tar.gz` ||
		!isLowercaseHexDigest(archive.sha256, 64) ||
		!isLowercaseHexDigest(archive.handoff_manifest_sha256, 64) ||
		(archive.control_routes_sha256 !== undefined && !isLowercaseHexDigest(archive.control_routes_sha256, 64))
	) {
		fail("invalid_gateway_handoff_lock", "Gateway handoff lock has an invalid archive binding.");
	}
	// This asserts formatting, not a signature. Every field is derived from the
	// same lock's tag, workflow path, and run id, so the block cannot fail a lock
	// that passed the producer check above — say plainly what it is for rather
	// than letting it read as a binding. It keeps the recorded identity from
	// drifting away from the tag it belongs to, so a maintainer re-running cosign
	// from this lock verifies against the archive the lock actually binds. The
	// digest in `archive.sha256` is the anchor that touches bytes.
	const signature = value.reviewed_signature;
	if (
		!isJsonRecord(signature) ||
		signature.certificate_identity !== `https://github.com/corca-ai/ceal/${gateway.workflow_path}@refs/tags/${gateway.tag}` ||
		signature.oidc_issuer !== "https://token.actions.githubusercontent.com" ||
		(value.schema_version === LOCK_SCHEMA_V2 && signature.workflow_sha !== gateway.commit) ||
		signature.run_invocation_uri !== `https://github.com/corca-ai/ceal/actions/runs/${gateway.actions_run_id}/attempts/1`
	) {
		fail("invalid_gateway_handoff_lock", "Gateway handoff lock does not record the reviewed Sigstore signing identity.");
	}
	// The tag names the Protocol version, because the handoff is cut per Protocol
	// release. That is checked rather than assumed, and the tarball bytes are
	// bound here too: the packet no longer carries a second package whose version
	// could disagree with the tag, so the Protocol binding is the whole of it.
	const protocol = requireProtocolBinding(value.protocol);
	if (protocol.version !== version) {
		fail("invalid_gateway_handoff_lock", "Gateway handoff lock's Protocol version does not match the handoff tag it was cut from.");
	}
	const validatedGateway: GatewayLock = {
		repository: requireStringField(gateway, "repository"),
		workflow_path: requireStringField(gateway, "workflow_path"),
		commit: requireStringField(gateway, "commit"),
		tree: requireStringField(gateway, "tree"),
		protocol_tree: requireStringField(gateway, "protocol_tree"),
		tag: requireStringField(gateway, "tag"),
		actions_run_id: requireNumberField(gateway, "actions_run_id"),
		origin: requireStringField(gateway, "origin"),
	};
	const validatedArchive: ArchiveBinding = {
		filename: requireStringField(archive, "filename"),
		sha256: requireStringField(archive, "sha256"),
		handoff_manifest_sha256: requireStringField(archive, "handoff_manifest_sha256"),
		...(typeof archive.control_routes_sha256 === "string" ? { control_routes_sha256: archive.control_routes_sha256 } : {}),
	};
	return { gateway: validatedGateway, archive: validatedArchive, protocol };
}

function requireProtocolBinding(value: unknown): ProtocolBinding {
	if (
		!isJsonRecord(value) ||
		value.package !== "@corca-ai/ceal-protocol" ||
		typeof value.version !== "string" ||
		!/^\d+\.\d+\.\d+$/u.test(value.version) ||
		value.filename !== `corca-ai-ceal-protocol-${value.version}.tgz` ||
		!isLowercaseHexDigest(value.sha256, 64)
	) {
		fail(
			"invalid_gateway_handoff_lock",
			"Gateway handoff lock does not bind @corca-ai/ceal-protocol to an exact package version, tarball, and digest.",
		);
	}
	return { package: value.package, version: value.version, filename: value.filename, sha256: value.sha256 };
}

function assertArchiveLockBinding(archive: string, lock: ValidatedLock): void {
	if (path.basename(archive) !== lock.archive.filename || sha256(readFileSync(archive)) !== lock.archive.sha256) {
		fail("gateway_handoff_archive_mismatch", "Gateway handoff archive does not match the reviewed lock.");
	}
}

function assertArchiveInventory(archive: string, lock: ValidatedLock): void {
	assertGatewayHandoffArchiveInventory(archive, lock.protocol.filename);
}

/** Shared exact-member and regular-file check for pre-lock and locked consumers. */
export function assertGatewayHandoffArchiveInventory(archive: string, protocolFilename: string): void {
	const expected = packetMembersForProtocol(protocolFilename);
	const members = listArchive(archive);
	if (JSON.stringify([...members].sort()) !== JSON.stringify(expected)) {
		fail("gateway_handoff_archive_inventory", "Gateway handoff archive does not contain the exact locked packet inventory.");
	}
	const details = listArchiveDetails(archive);
	if (details.length !== expected.length || details.some((line) => !line.startsWith("-"))) {
		fail("gateway_handoff_archive_unsafe", "Gateway handoff archive contains a link, directory, or special entry.");
	}
}

export function extractGatewayHandoffArchive(archive: string, destination: string): void {
	try {
		execFileSync("tar", ["-xzf", archive, "-C", destination, "--no-same-owner", "--no-same-permissions"], { stdio: "pipe" });
	} catch {
		fail("gateway_handoff_archive_extract_failed", "Gateway handoff archive could not be safely extracted.");
	}
}

const extractArchive = extractGatewayHandoffArchive;

function assertExtractedPacket(directory: string, lock: ValidatedLock): void {
	const expected = packetMembers(lock);
	if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(expected)) {
		fail("gateway_handoff_archive_inventory", "Extracted Gateway handoff packet inventory is invalid.");
	}
	for (const name of expected) requireRegularFile(path.join(directory, name), "gateway_handoff_archive_unsafe");
	const marker = readFileSync(path.join(directory, HANDOFF_MARKER), "utf8");
	if (marker !== `${HANDOFF_SCHEMA}\n`) fail("gateway_handoff_archive_unsafe", "Gateway handoff archive marker is invalid.");
}

function packetMembers(lock: ValidatedLock): string[] {
	return packetMembersForProtocol(lock.protocol.filename);
}

function packetMembersForProtocol(protocolFilename: unknown): string[] {
	if (typeof protocolFilename !== "string" || !/^corca-ai-ceal-protocol-\d+\.\d+\.\d+\.tgz$/u.test(protocolFilename)) {
		fail("gateway_handoff_archive_inventory", "Gateway handoff Protocol filename is invalid.");
	}
	return [...HANDOFF_FILES, protocolFilename].sort();
}

function listArchive(archive: string): string[] {
	try {
		return execFileSync("tar", ["-tzf", archive], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
			.trim()
			.split("\n")
			.filter(Boolean);
	} catch {
		fail("gateway_handoff_archive_invalid", "Gateway handoff archive is not readable.");
	}
}

function listArchiveDetails(archive: string): string[] {
	try {
		return execFileSync("tar", ["-tvzf", archive], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
			.trim()
			.split("\n")
			.filter(Boolean);
	} catch {
		fail("gateway_handoff_archive_invalid", "Gateway handoff archive cannot be safely inspected.");
	}
}

function requireRegularAbsoluteFile(value: unknown, code: string): string {
	if (typeof value !== "string" || !path.isAbsolute(value)) fail(code, "Gateway handoff archive must be an absolute regular file.");
	assertNoSymlinkAncestor(value, code);
	return requireRegularFile(path.resolve(value), code);
}

function requireRegularFile(filePath: string, code: string): string {
	if (!existsSync(filePath)) fail(code, "Required Gateway handoff file is missing.");
	const stat = lstatSync(filePath);
	if (!stat.isFile() || stat.isSymbolicLink()) fail(code, "Required Gateway handoff file must be regular and non-symlinked.");
	return filePath;
}

function assertNoSymlinkAncestor(target: string, code: string): void {
	let current = path.parse(target).root;
	for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
		current = path.join(current, part);
		if (existsSync(current) && lstatSync(current).isSymbolicLink())
			fail(code, "Gateway handoff archive path cannot traverse a symbolic link.");
	}
}

function requireStringField(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string") fail("invalid_gateway_handoff_lock", "Gateway handoff lock contains an invalid text field.");
	return value;
}
function requireNumberField(record: JsonRecord, key: string): number {
	const value = record[key];
	if (typeof value !== "number") fail("invalid_gateway_handoff_lock", "Gateway handoff lock contains an invalid numeric field.");
	return value;
}
function fail(code: string, message: string): never {
	throw new WorkerGatewayHandoffArchiveError(code, message);
}

const readJson = createJsonReader(fail, "Gateway handoff lock JSON is invalid.");
