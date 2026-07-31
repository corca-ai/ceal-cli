import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codedErrorClass } from "./lib/coded-error.mjs";

const LOCK_FILE = "gateway-protocol-handoff-lock.json";
const LOCK_SCHEMA = "ceal.worker_gateway_protocol_handoff_lock.v1";
const PACKET_SCHEMA = "ceal.gateway_protocol_handoff.v1";
const MARKER = ".ceal-protocol-handoff-owner";
const PROVENANCE = "gateway-protocol-provenance.json";
const CONFORMANCE = "gateway-leased-consumer-control-conformance.json";
const MANIFEST = "gateway-protocol-handoff.json";
const CANONICAL_SEMVER = /^(?:0|[1-9][0-9]*)[.](?:0|[1-9][0-9]*)[.](?:0|[1-9][0-9]*)$/u;

export const WorkerGatewayProtocolHandoffArchiveError = codedErrorClass("WorkerGatewayProtocolHandoffArchiveError");

/**
 * Safely consumes one reviewed protocol-only archive after its signature and
 * immutable-origin readback have happened outside this local parser. It never
 * downloads, signs, installs, or uses a Gateway checkout/workspace fallback.
 */
export function consumeLockedGatewayProtocolHandoffArchive(options = {}, dependencies = {}) {
	const prepared = prepareLockedGatewayProtocolHandoffArchive(options, dependencies);
	try {
		if (typeof dependencies.consume !== "function") return { resolution: prepared.resolution, lock: prepared.lock };
		const result = dependencies.consume(prepared);
		if (result?.then) fail("protocol_handoff_async_consumer", "Synchronous protocol handoff consumption cannot return a promise.");
		return result;
	} finally {
		prepared.cleanup();
	}
}

export function prepareLockedGatewayProtocolHandoffArchive(options = {}, dependencies = {}) {
	const root = path.resolve(options.repoRoot);
	const archive = requireRegularAbsoluteFile(options.archiveFile, "invalid_protocol_handoff_archive");
	const lock = validateLock(
		readJson(requireRegularFile(path.join(root, LOCK_FILE), "protocol_handoff_lock_missing"), "invalid_protocol_handoff_lock"),
	);
	if (path.basename(archive) !== lock.archive.filename)
		fail("protocol_handoff_archive_mismatch", "Gateway protocol handoff archive does not match the reviewed lock.");
	const staging = mkdtempSync(path.join(tmpdir(), "ceal-worker-gateway-protocol-handoff-"));
	const copiedArchive = path.join(staging, lock.archive.filename);
	const extraction = path.join(staging, "packet");
	try {
		(dependencies.copyArchive ?? copyFileSync)(archive, copiedArchive);
		requireRegularFile(copiedArchive, "protocol_handoff_archive_copy_failed");
		if (sha256(readFileSync(copiedArchive)) !== lock.archive.sha256)
			fail("protocol_handoff_archive_mismatch", "Gateway protocol handoff archive does not match the reviewed lock.");
		assertArchiveInventory(copiedArchive, lock);
		mkdirSync(extraction, { mode: 0o700 });
		(dependencies.extract ?? extractArchive)(copiedArchive, extraction);
		assertPacket(extraction, lock);
		return {
			resolution: Object.freeze({
				protocolTarball: path.join(extraction, lock.protocol.filename),
				provenance: path.join(extraction, PROVENANCE),
				conformance: path.join(extraction, CONFORMANCE),
				manifest: path.join(extraction, MANIFEST),
			}),
			lock: Object.freeze({
				filename: LOCK_FILE,
				gateway_tag: lock.gateway.tag,
				gateway_commit: lock.gateway.commit,
				gateway_tree: lock.gateway.tree,
				protocol_tree: lock.gateway.protocol_tree,
				archive_filename: lock.archive.filename,
				archive_sha256: lock.archive.sha256,
			}),
			cleanup: () => rmSync(staging, { recursive: true, force: true }),
		};
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
}

function validateLock(value) {
	if (
		!record(value) ||
		!exactKeys(value, ["archive", "gateway", "protocol", "schema_version", "status"]) ||
		value.schema_version !== LOCK_SCHEMA ||
		value.status !== "locked"
	)
		fail("invalid_protocol_handoff_lock", "Gateway protocol handoff lock is invalid or not yet locked.");
	const gateway = value.gateway;
	const archive = value.archive;
	const protocol = value.protocol;
	if (!validGateway(gateway) || !validArchive(archive, gateway) || !validProtocol(protocol, gateway))
		fail("invalid_protocol_handoff_lock", "Gateway protocol handoff lock has an invalid immutable identity.");
	return Object.freeze({
		gateway: Object.freeze({ ...gateway }),
		archive: Object.freeze({ ...archive }),
		protocol: Object.freeze({ ...protocol }),
	});
}

function validGateway(value) {
	return (
		record(value) &&
		exactKeys(value, ["commit", "protocol_tree", "repository", "tag", "tree", "workflow_path"]) &&
		value.repository === "corca-ai/ceal" &&
		value.workflow_path === ".github/workflows/gateway-protocol-handoff-release.yml" &&
		gitObject(value.commit) &&
		gitObject(value.tree) &&
		gitObject(value.protocol_tree) &&
		canonicalTag(value.tag)
	);
}
function validArchive(value, gateway) {
	const version = gateway?.tag?.slice("gateway-protocol-handoff-v".length);
	return (
		record(value) &&
		exactKeys(value, ["filename", "manifest_sha256", "sha256"]) &&
		value.filename === `ceal-gateway-protocol-handoff-${version}.tar.gz` &&
		sha(value.sha256) &&
		sha(value.manifest_sha256)
	);
}
function validProtocol(value, gateway) {
	const version = gateway?.tag?.slice("gateway-protocol-handoff-v".length);
	return (
		record(value) &&
		exactKeys(value, ["exports", "filename", "integrity", "package", "sha256", "version"]) &&
		value.package === "@corca-ai/ceal-protocol" &&
		value.version === version &&
		CANONICAL_SEMVER.test(value.version) &&
		value.filename === `corca-ai-ceal-protocol-${value.version}.tgz` &&
		sha(value.sha256) &&
		sha512(value.integrity) &&
		sameStrings(value.exports, [".", "./conformance"])
	);
}

function assertArchiveInventory(archive, lock) {
	const expected = packetMembers(lock);
	const actual = listArchive(archive).sort();
	if (!sameStrings(actual, expected))
		fail("protocol_handoff_archive_inventory", "Gateway protocol handoff archive does not contain the exact locked packet inventory.");
	const details = listArchiveDetails(archive);
	if (details.length !== expected.length || details.some((line) => !line.startsWith("-")))
		fail("protocol_handoff_archive_unsafe", "Gateway protocol handoff archive contains a link, directory, or special entry.");
}
function assertPacket(directory, lock) {
	const expected = packetMembers(lock);
	if (
		!sameStrings(readdirSync(directory).sort(), expected) ||
		!expected.every((name) => requireRegularFile(path.join(directory, name), "protocol_handoff_archive_unsafe"))
	)
		fail("protocol_handoff_archive_inventory", "Extracted Gateway protocol handoff packet inventory is invalid.");
	if (readFileSync(path.join(directory, MARKER), "utf8") !== `${PACKET_SCHEMA}\n`)
		fail("protocol_handoff_archive_unsafe", "Gateway protocol handoff marker is invalid.");
	const manifestBytes = readFileSync(path.join(directory, MANIFEST));
	if (sha256(manifestBytes) !== lock.archive.manifest_sha256)
		fail("protocol_handoff_manifest_mismatch", "Gateway protocol handoff manifest does not match the reviewed lock.");
	const manifest = readJson(path.join(directory, MANIFEST), "protocol_handoff_manifest_invalid");
	if (!validManifest(manifest, lock, directory))
		fail("protocol_handoff_manifest_invalid", "Gateway protocol handoff manifest is not a complete locked producer record.");
	const packed = readPackedPackageManifest(path.join(directory, lock.protocol.filename));
	if (
		packed?.name !== lock.protocol.package ||
		packed?.version !== lock.protocol.version ||
		!packed?.exports?.["."] ||
		!packed?.exports?.["./conformance"]
	)
		fail("protocol_handoff_protocol_invalid", "Gateway protocol tarball package identity is invalid.");
}
function validManifest(value, lock, directory) {
	const producer = value?.producer;
	const protocol = value?.protocol;
	return (
		record(value) &&
		exactKeys(value, [
			"consumer_requirements",
			"control_conformance",
			"non_claims",
			"ok",
			"producer",
			"proof_level",
			"protocol",
			"protocol_provenance",
			"schema_version",
			"writes_external",
		]) &&
		value.schema_version === PACKET_SCHEMA &&
		value.ok === true &&
		value.proof_level === "local_state" &&
		value.writes_external === false &&
		record(producer) &&
		exactKeys(producer, ["commit", "protocol_tree", "repository", "scoped_paths_clean", "tree"]) &&
		producer.repository === lock.gateway.repository &&
		producer.commit === lock.gateway.commit &&
		producer.tree === lock.gateway.tree &&
		producer.protocol_tree === lock.gateway.protocol_tree &&
		producer.scoped_paths_clean === true &&
		record(protocol) &&
		exactKeys(protocol, ["bytes", "exports", "filename", "integrity", "package", "sha256", "version"]) &&
		protocol.package === lock.protocol.package &&
		protocol.version === lock.protocol.version &&
		protocol.filename === lock.protocol.filename &&
		protocol.sha256 === lock.protocol.sha256 &&
		protocol.integrity === lock.protocol.integrity &&
		sameStrings(protocol.exports, lock.protocol.exports) &&
		protocol.bytes === readFileSync(path.join(directory, protocol.filename)).byteLength &&
		validMemberDigest(value.protocol_provenance, PROVENANCE, directory) &&
		validMemberDigest(value.control_conformance, CONFORMANCE, directory)
	);
}
function validMemberDigest(value, filename, directory) {
	const bytes = readFileSync(path.join(directory, filename));
	return (
		record(value) &&
		exactKeys(value, ["bytes", "filename", "sha256"]) &&
		value.filename === filename &&
		value.bytes === bytes.byteLength &&
		value.sha256 === sha256(bytes)
	);
}

function packetMembers(lock) {
	return [MARKER, lock.protocol.filename, PROVENANCE, CONFORMANCE, MANIFEST].sort();
}
function extractArchive(archive, destination) {
	try {
		execFileSync("tar", ["-xzf", archive, "-C", destination, "--no-same-owner", "--no-same-permissions"], { stdio: "pipe" });
	} catch {
		fail("protocol_handoff_archive_extract_failed", "Gateway protocol handoff archive could not be safely extracted.");
	}
}
function listArchive(archive) {
	try {
		return execFileSync("tar", ["-tzf", archive], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
			.trim()
			.split("\n")
			.filter(Boolean);
	} catch {
		fail("protocol_handoff_archive_invalid", "Gateway protocol handoff archive is not readable.");
	}
}
function listArchiveDetails(archive) {
	try {
		return execFileSync("tar", ["-tvzf", archive], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
			.trim()
			.split("\n")
			.filter(Boolean);
	} catch {
		fail("protocol_handoff_archive_invalid", "Gateway protocol handoff archive cannot be safely inspected.");
	}
}
function readPackedPackageManifest(tarball) {
	try {
		return JSON.parse(
			execFileSync("tar", ["-xOzf", tarball, "package/package.json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
		);
	} catch {
		fail("protocol_handoff_protocol_invalid", "Gateway protocol tarball is not a readable package artifact.");
	}
}
function requireRegularAbsoluteFile(value, code) {
	if (typeof value !== "string" || !path.isAbsolute(value)) fail(code, "Gateway protocol handoff archive must be an absolute regular file.");
	assertNoSymlinkAncestor(value, code);
	return requireRegularFile(path.resolve(value), code);
}
function requireRegularFile(filePath, code) {
	if (!existsSync(filePath)) fail(code, "Required Gateway protocol handoff file is missing.");
	const stat = lstatSync(filePath);
	if (!stat.isFile() || stat.isSymbolicLink()) fail(code, "Required Gateway protocol handoff file must be regular and non-symlinked.");
	return filePath;
}
function assertNoSymlinkAncestor(target, code) {
	let current = path.parse(target).root;
	for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
		current = path.join(current, part);
		if (existsSync(current) && lstatSync(current).isSymbolicLink())
			fail(code, "Gateway protocol handoff archive path cannot traverse a symbolic link.");
	}
}
function readJson(filePath, code) {
	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		fail(code, "Gateway protocol handoff JSON is invalid.");
	}
}
function canonicalTag(value) {
	return (
		typeof value === "string" &&
		value.startsWith("gateway-protocol-handoff-v") &&
		CANONICAL_SEMVER.test(value.slice("gateway-protocol-handoff-v".length))
	);
}
function record(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value, expected) {
	return record(value) && sameStrings(Object.keys(value).sort(), [...expected].sort());
}
function sameStrings(left, right) {
	return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((entry, index) => entry === right[index]);
}
function gitObject(value) {
	return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}
function sha(value) {
	return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
function sha512(value) {
	return typeof value === "string" && /^sha512-[A-Za-z0-9+/]{86}==$/u.test(value);
}
function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
function fail(code, message) {
	throw new WorkerGatewayProtocolHandoffArchiveError(code, message);
}
