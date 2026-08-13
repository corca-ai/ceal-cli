import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codedErrorClass } from "./lib/coded-error.mjs";

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
export function consumeLockedGatewayHandoffArchiveSync(options = {}, dependencies = {}) {
	const prepared = prepareLockedGatewayHandoffArchive(options, dependencies);
	try {
		if (typeof dependencies.consume !== "function") return { resolution: prepared.resolution, lock: prepared.lock };
		const result = dependencies.consume(prepared);
		if (result && typeof result.then === "function")
			fail("gateway_handoff_archive_async_consumer", "Synchronous Gateway handoff consumption cannot return a promise.");
		return result;
	} finally {
		prepared.cleanup();
	}
}

export async function consumeLockedGatewayHandoffArchive(options = {}, dependencies = {}) {
	const prepared = prepareLockedGatewayHandoffArchive(options, dependencies);
	try {
		if (typeof dependencies.consume !== "function") return { resolution: prepared.resolution, lock: prepared.lock };
		return await dependencies.consume(prepared);
	} finally {
		prepared.cleanup();
	}
}

function prepareLockedGatewayHandoffArchive(options, dependencies) {
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

function validateLock(value) {
	if (!isRecord(value) || ![LOCK_SCHEMA_V1, LOCK_SCHEMA_V2].includes(value.schema_version) || value.status !== "locked") {
		fail("invalid_gateway_handoff_lock", "Gateway handoff lock is invalid or not yet locked.");
	}
	const gateway = value.gateway;
	const archive = value.archive;
	if (
		!isRecord(gateway) ||
		gateway.repository !== "corca-ai/ceal" ||
		gateway.workflow_path !== ".github/workflows/gateway-protocol-handoff-release.yml" ||
		!isGitObject(gateway.commit) ||
		!isGitObject(gateway.tree) ||
		!isGitObject(gateway.protocol_tree) ||
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
		!isRecord(archive) ||
		archive.filename !== `ceal-gateway-protocol-handoff-${version}.tar.gz` ||
		!isSha256(archive.sha256) ||
		!isSha256(archive.handoff_manifest_sha256) ||
		(archive.control_routes_sha256 !== undefined && !isSha256(archive.control_routes_sha256))
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
		!isRecord(signature) ||
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
	return { gateway: { ...gateway }, archive: { ...archive }, protocol };
}

function requireProtocolBinding(value) {
	if (
		!isRecord(value) ||
		value.package !== "@corca-ai/ceal-protocol" ||
		typeof value.version !== "string" ||
		!/^\d+\.\d+\.\d+$/u.test(value.version) ||
		value.filename !== `corca-ai-ceal-protocol-${value.version}.tgz` ||
		!isSha256(value.sha256)
	) {
		fail(
			"invalid_gateway_handoff_lock",
			"Gateway handoff lock does not bind @corca-ai/ceal-protocol to an exact package version, tarball, and digest.",
		);
	}
	return { package: value.package, version: value.version, filename: value.filename, sha256: value.sha256 };
}

function assertArchiveLockBinding(archive, lock) {
	if (path.basename(archive) !== lock.archive.filename || sha256(readFileSync(archive)) !== lock.archive.sha256) {
		fail("gateway_handoff_archive_mismatch", "Gateway handoff archive does not match the reviewed lock.");
	}
}

function assertArchiveInventory(archive, lock) {
	assertGatewayHandoffArchiveInventory(archive, lock.protocol.filename);
}

/** Shared exact-member and regular-file check for pre-lock and locked consumers. */
export function assertGatewayHandoffArchiveInventory(archive, protocolFilename) {
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

export function extractGatewayHandoffArchive(archive, destination) {
	try {
		execFileSync("tar", ["-xzf", archive, "-C", destination, "--no-same-owner", "--no-same-permissions"], { stdio: "pipe" });
	} catch {
		fail("gateway_handoff_archive_extract_failed", "Gateway handoff archive could not be safely extracted.");
	}
}

const extractArchive = extractGatewayHandoffArchive;

function assertExtractedPacket(directory, lock) {
	const expected = packetMembers(lock);
	if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(expected)) {
		fail("gateway_handoff_archive_inventory", "Extracted Gateway handoff packet inventory is invalid.");
	}
	for (const name of expected) requireRegularFile(path.join(directory, name), "gateway_handoff_archive_unsafe");
	const marker = readFileSync(path.join(directory, HANDOFF_MARKER), "utf8");
	if (marker !== `${HANDOFF_SCHEMA}\n`) fail("gateway_handoff_archive_unsafe", "Gateway handoff archive marker is invalid.");
}

function packetMembers(lock) {
	return packetMembersForProtocol(lock.protocol.filename);
}

function packetMembersForProtocol(protocolFilename) {
	if (typeof protocolFilename !== "string" || !/^corca-ai-ceal-protocol-\d+\.\d+\.\d+\.tgz$/u.test(protocolFilename)) {
		fail("gateway_handoff_archive_inventory", "Gateway handoff Protocol filename is invalid.");
	}
	return [...HANDOFF_FILES, protocolFilename].sort();
}

function listArchive(archive) {
	try {
		return execFileSync("tar", ["-tzf", archive], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
			.trim()
			.split("\n")
			.filter(Boolean);
	} catch {
		fail("gateway_handoff_archive_invalid", "Gateway handoff archive is not readable.");
	}
}

function listArchiveDetails(archive) {
	try {
		return execFileSync("tar", ["-tvzf", archive], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
			.trim()
			.split("\n")
			.filter(Boolean);
	} catch {
		fail("gateway_handoff_archive_invalid", "Gateway handoff archive cannot be safely inspected.");
	}
}

function requireRegularAbsoluteFile(value, code) {
	if (typeof value !== "string" || !path.isAbsolute(value)) fail(code, "Gateway handoff archive must be an absolute regular file.");
	assertNoSymlinkAncestor(value, code);
	return requireRegularFile(path.resolve(value), code);
}

function requireRegularFile(filePath, code) {
	if (!existsSync(filePath)) fail(code, "Required Gateway handoff file is missing.");
	const stat = lstatSync(filePath);
	if (!stat.isFile() || stat.isSymbolicLink()) fail(code, "Required Gateway handoff file must be regular and non-symlinked.");
	return filePath;
}

function assertNoSymlinkAncestor(target, code) {
	let current = path.parse(target).root;
	for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
		current = path.join(current, part);
		if (existsSync(current) && lstatSync(current).isSymbolicLink())
			fail(code, "Gateway handoff archive path cannot traverse a symbolic link.");
	}
}

function readJson(filePath, code) {
	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		fail(code, "Gateway handoff lock JSON is invalid.");
	}
}

function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isGitObject(value) {
	return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}
function isSha256(value) {
	return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
function fail(code, message) {
	throw new WorkerGatewayHandoffArchiveError(code, message);
}
