#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INPUTS_FILENAME = "worker-release-inputs.json";
const SCHEMA_VERSION = "ceal.worker_release_inputs.v1";
const PROTOCOL_PROVENANCE_SCHEMA = "ceal.gateway_protocol_artifact.v1";
const GIT_OBJECT_ID = /^[a-f0-9]{40}$/u;

export class WorkerReleaseInputError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "WorkerReleaseInputError";
		this.code = code;
	}
}

export function resolveWorkerReleaseInputs(options = {}) {
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	const inventory = readInventory(options.inventoryPath ?? path.join(repoRoot, INPUTS_FILENAME));
	assertInventory(inventory, repoRoot);
	const protocolTarball = requireRegularAbsoluteFile(options.protocolTarball, "protocol_tarball");
	const protocolProvenance = requireRegularAbsoluteFile(options.protocolProvenance, "protocol_provenance");
	const handoffManifest = requireRegularAbsoluteFile(options.handoffManifest, "handoff_manifest");
	const expectedHandoffSha256 = requireSha256(options.expectedHandoffSha256, "expected_handoff_sha256");
	if (new Set([path.dirname(protocolTarball), path.dirname(protocolProvenance), path.dirname(handoffManifest)]).size !== 1) {
		fail("handoff_layout_mismatch", "Gateway Protocol tarball, provenance, and handoff manifest must come from one handoff directory.");
	}
	const provenance = readJson(protocolProvenance, "invalid_protocol_provenance");
	const handoff = readJson(handoffManifest, "invalid_handoff_manifest");
	if (sha256(readFileSync(handoffManifest)) !== expectedHandoffSha256) {
		fail("handoff_trust_mismatch", "Gateway handoff manifest does not match the caller-approved digest.");
	}
	const protocol = validateProtocolArtifact({ inventory, repoRoot, protocolTarball, protocolProvenance, provenance, handoff });
	return {
		schema_version: "ceal.worker_release_input_resolution.v1",
		ok: true,
		proof_level: "local_state",
		writes_external: false,
		worker: { ...inventory.worker },
		client: { ...inventory.client },
		guide: { ...inventory.guide },
		protocol,
		handoff: { filename: path.basename(handoffManifest), sha256: expectedHandoffSha256 },
		trust_anchor: { kind: "caller_supplied_manifest_sha256", value: expectedHandoffSha256 },
		forbidden_release_inputs: [...inventory.forbidden_release_inputs],
		non_claims: [...inventory.non_claims, "This caller-supplied digest binds exact local input bytes; it does not authenticate who supplied that digest or packet."],
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
	if (!Array.isArray(inventory.forbidden_release_inputs) || inventory.forbidden_release_inputs.length === 0
		|| new Set(inventory.forbidden_release_inputs).size !== inventory.forbidden_release_inputs.length
		|| inventory.forbidden_release_inputs.some((entry) => typeof entry !== "string" || normalizeRelativePath(entry) !== entry)) {
		fail("invalid_inventory", "Worker release inventory must declare unique forbidden composite inputs.");
	}
	if (inventory.forbidden_release_inputs.some((entry) => [inventory.worker.source_path, inventory.client.source_path, inventory.guide.source_path].some((allowed) => allowed === entry || allowed.startsWith(`${entry}/`)))) {
		fail("invalid_inventory", "Worker release inventory overlaps an owned input with a forbidden input.");
	}
	if (!Array.isArray(inventory.non_claims) || inventory.non_claims.length === 0 || inventory.non_claims.some((entry) => typeof entry !== "string" || entry.length === 0)) {
		fail("invalid_inventory", "Worker release inventory must retain explicit non-claims.");
	}
}

function assertWorker(worker, repoRoot) {
	if (!isPlainObject(worker) || worker.package !== "@corca-ai/ceal-worker-cli" || worker.command !== "ceal") fail("invalid_inventory", "Worker release inventory has an invalid worker identity.");
	assertPackageSource(repoRoot, worker.source_path, worker.package, worker.command);
}

function assertClient(client, repoRoot) {
	if (!isPlainObject(client) || client.package !== "@corca-ai/ceal") fail("invalid_inventory", "Worker release inventory has an invalid client identity.");
	assertPackageSource(repoRoot, client.source_path, client.package);
}

function assertGuide(guide, repoRoot) {
	if (!isPlainObject(guide) || guide.asset !== "ceal-guide-SKILL.md" || guide.source_path !== "skills/ceal-guide/SKILL.md") fail("invalid_inventory", "Worker release inventory has an invalid guide identity.");
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
	if (!isPlainObject(protocol) || protocol.package !== "@corca-ai/ceal-protocol" || protocol.source_repository !== "corca-ai/ceal"
		|| protocol.source_path !== "packages/ceal-protocol" || protocol.provenance_schema !== PROTOCOL_PROVENANCE_SCHEMA
		|| protocol.handoff_manifest_schema !== "ceal.repository_extraction_gateway_handoff.v1"
		|| !sameStrings(protocol.required_exports, [".", "./conformance"])) {
		fail("invalid_inventory", "Worker release inventory has an invalid Gateway Protocol requirement.");
	}
}

function validateProtocolArtifact({ inventory, repoRoot, protocolTarball, protocolProvenance, provenance, handoff }) {
	const requirement = inventory.required_gateway_protocol;
	if (!isPlainObject(provenance) || provenance.schema_version !== requirement.provenance_schema || provenance.proof_level !== "host_decision" || provenance.writes_external !== false) {
		fail("invalid_protocol_provenance", "Gateway Protocol provenance is not a verified handoff record.");
	}
	const source = provenance.source;
	if (!isPlainObject(source) || source.repository !== requirement.source_repository || source.package_path !== requirement.source_path
		|| !GIT_OBJECT_ID.test(source.commit ?? "") || !GIT_OBJECT_ID.test(source.tree ?? "")) {
		fail("invalid_protocol_provenance", "Gateway Protocol provenance has an invalid producer identity.");
	}
	const artifact = provenance.artifact;
	assertHandoffBinding({ handoff, provenance, protocolProvenance, artifact, requirement });
	const bytes = readFileSync(protocolTarball);
	const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
	if (!isPlainObject(artifact) || artifact.package !== requirement.package || artifact.filename !== path.basename(protocolTarball)
		|| artifact.sha256 !== sha256(bytes) || artifact.npm_integrity !== integrity || !sameStrings(artifact.exports, requirement.required_exports)) {
		fail("protocol_artifact_mismatch", "Gateway Protocol tarball does not match its provenance record.");
	}
	const packageManifest = readPackedManifest(protocolTarball);
	if (packageManifest?.name !== requirement.package || packageManifest?.version !== artifact.version || !sameStrings(Object.keys(packageManifest?.exports ?? {}).sort(), requirement.required_exports)) {
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

function assertHandoffBinding({ handoff, provenance, protocolProvenance, artifact, requirement }) {
	if (!isPlainObject(handoff) || handoff.schema_version !== requirement.handoff_manifest_schema || handoff.ok !== true
		|| handoff.proof_level !== "host_decision" || handoff.writes_external !== false) {
		fail("invalid_handoff_manifest", "Gateway handoff manifest is not a self-consistent producer record.");
	}
	const producer = handoff.producer;
	if (!isPlainObject(producer) || producer.repository !== provenance.source.repository || producer.commit !== provenance.source.commit
		|| producer.tree !== provenance.source.tree || producer.scoped_paths_clean !== true) {
		fail("handoff_provenance_mismatch", "Gateway handoff producer identity does not bind Protocol provenance.");
	}
	const protocolRecord = Array.isArray(handoff.packages) ? handoff.packages.find((entry) => entry?.name === requirement.package) : null;
	if (!isPlainObject(protocolRecord) || protocolRecord.version !== artifact.version || protocolRecord.filename !== artifact.filename
		|| protocolRecord.sha256 !== artifact.sha256 || protocolRecord.integrity !== artifact.npm_integrity
		|| !sameStrings(protocolRecord.declared_exports, artifact.exports)) {
		fail("handoff_provenance_mismatch", "Gateway handoff manifest does not bind the supplied Protocol artifact.");
	}
	const sidecar = handoff.protocol_provenance;
	const digest = handoff.protocol_provenance_digest;
	const bytes = readFileSync(protocolProvenance);
	if (!isPlainObject(sidecar) || sidecar.filename !== path.basename(protocolProvenance) || sidecar.bytes !== bytes.length
		|| !isPlainObject(digest) || digest.algorithm !== "sha256" || digest.canonicalization !== "utf8-json-pretty-v1" || digest.value !== sha256(bytes)) {
		fail("handoff_provenance_mismatch", "Gateway handoff manifest does not bind the Protocol provenance sidecar bytes.");
	}
}

function readPackedManifest(tarball) {
	try {
		return JSON.parse(execFileSync("tar", ["-xOzf", tarball, "package/package.json"], {
			encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1024 * 1024,
		}));
	} catch {
		fail("invalid_protocol_tarball", "Gateway Protocol input is not a readable package tarball.");
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
	if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) fail(code, "Worker release trust anchor must be one lowercase SHA-256 value.");
	return value;
}

function readJson(filePath, code) {
	try { return JSON.parse(readFileSync(filePath, "utf8")); }
	catch { fail(code, "Worker release input JSON is invalid."); }
}

function normalizeRelativePath(value) {
	if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value) || value.includes("\\\\") || value.split("/").some((part) => part.length === 0 || part === "." || part === "..")) {
		fail("invalid_release_input_path", "Worker release input path must be a normalized relative path.");
	}
	return value;
}

function sameStrings(value, expected) {
	return Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index]);
}

function isPlainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function fail(code, message) { throw new WorkerReleaseInputError(code, message); }

function parseArgs(argv) {
	const options = {};
	let json = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") return { help: true, json, options };
		if (arg === "--json") { json = true; continue; }
		if (["--protocol-tarball", "--protocol-provenance", "--handoff-manifest", "--expected-handoff-sha256"].includes(arg)) {
			const value = argv[++index];
			if (typeof value !== "string") fail("invalid_argument", "Worker release input option requires a value.");
			options[arg === "--protocol-tarball" ? "protocolTarball" : arg === "--protocol-provenance" ? "protocolProvenance" : arg === "--handoff-manifest" ? "handoffManifest" : "expectedHandoffSha256"] = value;
			continue;
		}
		fail("invalid_argument", "Unexpected worker release input argument.");
	}
	return { help: false, json, options };
}

export function runCli(argv, io = console) {
	const json = argv.includes("--json");
	try {
		const parsed = parseArgs(argv);
		if (parsed.help) {
			io.log("usage: node scripts/worker-release-inputs.mjs --protocol-tarball <absolute-tgz> --protocol-provenance <absolute-json> --handoff-manifest <absolute-json> --expected-handoff-sha256 <sha256> [--json]");
			return 0;
		}
		const result = resolveWorkerReleaseInputs(parsed.options);
		io.log(parsed.json ? JSON.stringify(result, null, 2) : "Worker release inputs are verified.");
		return 0;
	} catch (error) {
		const known = error instanceof WorkerReleaseInputError;
		const payload = { schema_version: "ceal.worker_release_input_error.v1", ok: false, error_code: known ? error.code : "worker_release_input_failed", message: known ? error.message : "Worker release inputs could not be verified." };
		if (json) io.log(JSON.stringify(payload)); else io.error(payload.message);
		return 2;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
