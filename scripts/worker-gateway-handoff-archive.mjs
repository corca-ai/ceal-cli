import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const LOCK_SCHEMA = "ceal.worker_gateway_handoff_lock.v1";
const HANDOFF_SCHEMA = "ceal.repository_extraction_gateway_handoff.v1";
const HANDOFF_MARKER = ".ceal-handoff-owner";
const HANDOFF_FILES = [
	HANDOFF_MARKER,
	"gateway-artifact-handoff.json",
	"gateway-conformance-proof.json",
	"gateway-protocol-provenance.json",
];

export class WorkerGatewayHandoffArchiveError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "WorkerGatewayHandoffArchiveError";
		this.code = code;
	}
}

/**
 * Verifies a source-reviewed lock and a locally supplied archive, extracts the
 * exact packet into a disposable directory, and invokes the worker input
 * resolver. This function never downloads, uploads, installs, or releases.
 */
export function resolveLockedGatewayHandoffArchive(options = {}, dependencies = {}) {
	const prepared = prepareLockedGatewayHandoffArchive(options, dependencies);
	try {
		return { resolution: prepared.resolution, lock: prepared.lock };
	} finally {
		prepared.cleanup();
	}
}

export function consumeLockedGatewayHandoffArchiveSync(options = {}, dependencies = {}) {
	const prepared = prepareLockedGatewayHandoffArchive(options, dependencies);
	try {
		if (typeof dependencies.consume !== "function") return { resolution: prepared.resolution, lock: prepared.lock };
		const result = dependencies.consume(prepared);
		if (result && typeof result.then === "function") fail("gateway_handoff_archive_async_consumer", "Synchronous Gateway handoff consumption cannot return a promise.");
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
	const lockPath = requireRegularFile(path.join(repoRoot, "gateway-handoff-lock.json"), "gateway_handoff_lock_missing");
	const lock = validateLock(readJson(lockPath, "invalid_gateway_handoff_lock"));
	if (path.basename(archive) !== lock.archive.filename) fail("gateway_handoff_archive_mismatch", "Gateway handoff archive does not match the reviewed lock.");
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
			clientTarball: path.join(extraction, lock.client.filename),
			protocolProvenance: path.join(extraction, "gateway-protocol-provenance.json"),
			conformanceProof: path.join(extraction, "gateway-conformance-proof.json"),
			handoffManifest: path.join(extraction, "gateway-artifact-handoff.json"),
			expectedHandoffSha256: lock.archive.handoff_manifest_sha256,
		};
		const resolution = dependencies.resolveInputs?.(rawInputs);
		if (!resolution || resolution.protocol?.producer?.commit !== lock.gateway.commit || resolution.protocol?.producer?.tree !== lock.gateway.tree) {
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
				artifact_name: lock.gateway.artifact_name,
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
	if (!isRecord(value) || value.schema_version !== LOCK_SCHEMA || value.status !== "locked") {
		fail("invalid_gateway_handoff_lock", "Gateway handoff lock is invalid or not yet locked.");
	}
	const gateway = value.gateway;
	const archive = value.archive;
	if (!isRecord(gateway) || gateway.repository !== "corca-ai/ceal" || gateway.workflow_path !== ".github/workflows/gateway-handoff-archive.yml"
		|| !isGitObject(gateway.commit) || !isGitObject(gateway.tree) || !Number.isSafeInteger(gateway.actions_run_id) || gateway.actions_run_id <= 0
		|| typeof gateway.tag !== "string" || !/^gateway-handoff-v\d+\.\d+\.\d+$/u.test(gateway.tag)
		|| gateway.artifact_name !== `ceal-gateway-handoff-${gateway.commit}`) {
		fail("invalid_gateway_handoff_lock", "Gateway handoff lock has an invalid immutable producer identity.");
	}
	const version = gateway.tag.slice("gateway-handoff-v".length);
	if (!isRecord(archive) || archive.filename !== `ceal-gateway-handoff-${version}.tar.gz` || !isSha256(archive.sha256) || !isSha256(archive.handoff_manifest_sha256)) {
		fail("invalid_gateway_handoff_lock", "Gateway handoff lock has an invalid archive binding.");
	}
	return {
		gateway: { ...gateway },
		archive: { ...archive },
		protocol: { filename: `corca-ai-ceal-protocol-${version}.tgz` },
		client: { filename: `corca-ai-ceal-${version}.tgz` },
	};
}

function assertArchiveLockBinding(archive, lock) {
	if (path.basename(archive) !== lock.archive.filename || sha256(readFileSync(archive)) !== lock.archive.sha256) {
		fail("gateway_handoff_archive_mismatch", "Gateway handoff archive does not match the reviewed lock.");
	}
}

function assertArchiveInventory(archive, lock) {
	const expected = packetMembers(lock);
	const members = listArchive(archive);
	if (JSON.stringify([...members].sort()) !== JSON.stringify(expected)) {
		fail("gateway_handoff_archive_inventory", "Gateway handoff archive does not contain the exact locked packet inventory.");
	}
	const details = listArchiveDetails(archive);
	if (details.length !== expected.length || details.some((line) => !line.startsWith("-"))) {
		fail("gateway_handoff_archive_unsafe", "Gateway handoff archive contains a link, directory, or special entry.");
	}
}

function extractArchive(archive, destination) {
	try {
		execFileSync("tar", ["-xzf", archive, "-C", destination, "--no-same-owner", "--no-same-permissions"], { stdio: "pipe" });
	} catch {
		fail("gateway_handoff_archive_extract_failed", "Gateway handoff archive could not be safely extracted.");
	}
}

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
	return [...HANDOFF_FILES, lock.protocol.filename, lock.client.filename].sort();
}

function listArchive(archive) {
	try {
		return execFileSync("tar", ["-tzf", archive], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean);
	} catch {
		fail("gateway_handoff_archive_invalid", "Gateway handoff archive is not readable.");
	}
}

function listArchiveDetails(archive) {
	try {
		return execFileSync("tar", ["-tvzf", archive], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean);
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
		if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail(code, "Gateway handoff archive path cannot traverse a symbolic link.");
	}
}

function readJson(filePath, code) {
	try { return JSON.parse(readFileSync(filePath, "utf8")); }
	catch { fail(code, "Gateway handoff lock JSON is invalid."); }
}

function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isGitObject(value) { return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value); }
function isSha256(value) { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function fail(code, message) { throw new WorkerGatewayHandoffArchiveError(code, message); }
