#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SCHEMA_VERSION = "ceal.cli_release_manifest.v1";
const ARTIFACT_IDS = new Set(["ceal", "cealctl"]);

export class CealCliReleaseManifestError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "CealCliReleaseManifestError";
		this.code = code;
	}
}

export function buildCealCliReleaseManifest(options) {
	const repoRoot = path.resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
	const outputDir = requireSafeOutputDirectory(options.outputDir, repoRoot);
	const contract = readJson(path.join(repoRoot, "release-contract.json"), "release contract");
	assertReleaseContract(contract);
	const artifacts = normalizeArtifacts(options.artifacts, contract);
	mkdirSync(outputDir, { recursive: true, mode: 0o755 });
	const manifest = {
		schema_version: SCHEMA_VERSION,
		status: "local_candidate_not_published",
		repository: contract.repository,
		release_version: contract.release_version,
		protocol: contract.protocol,
		client: contract.client,
		artifacts,
		first_proof_matrix: contract.first_proof_matrix,
		rollback: contract.rollback,
		publication_blockers: contract.publication_blockers,
		non_claims: contract.non_claims,
	};
	const manifestPath = path.join(outputDir, "ceal-cli-release-manifest.json");
	const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
	writeFileSync(manifestPath, bytes, { mode: 0o644 });
	return {
		schema_version: "ceal.cli_release_manifest_build.v1",
		ok: true,
		proof_level: "local_state",
		writes_external: false,
		manifest_path: manifestPath,
		manifest_sha256: sha256(bytes),
		manifest,
	};
}

function assertReleaseContract(contract) {
	if (contract?.schema_version !== "ceal.cli_release_contract.v1" || contract.status !== "local_candidate_not_published") {
		throw new CealCliReleaseManifestError("invalid_contract", "Invalid local Ceal CLI release contract.");
	}
	assertReleaseIdentity(contract);
	assertProtocolContract(contract.protocol);
	assertRollbackContract(contract.rollback);
	if (!Array.isArray(contract.publication_blockers) || contract.publication_blockers.length === 0) {
		throw new CealCliReleaseManifestError("invalid_contract", "Local candidate must retain publication blockers.");
	}
}

function assertReleaseIdentity(contract) {
	if (contract.repository !== "corca-ai/ceal-cli" || !isVersion(contract.release_version)) {
		throw new CealCliReleaseManifestError("invalid_contract", "Release contract repository or version is invalid.");
	}
}

function assertProtocolContract(protocol) {
	const supportedRange = protocol?.supported_gateway_range;
	if (protocol?.wire_version !== "1.2.0" || !isExactProtocolRange(supportedRange)) {
		throw new CealCliReleaseManifestError("invalid_contract", "Release contract protocol compatibility is invalid.");
	}
}

function isExactProtocolRange(range) {
	return range?.minimum === "1.2.0" && range.maximum === "1.2.0";
}

function assertRollbackContract(rollback) {
	const source = rollback?.source;
	const legacy = rollback?.legacy_cealctl_distribution;
	if (source?.strategy !== "normal_additive_revert"
		|| !/^[a-f0-9]{40}$/u.test(source.immutable_commit ?? "")
		|| legacy?.scope !== "cealctl_only"
		|| legacy.tag_and_release_are_mutable_pointers !== true) {
		throw new CealCliReleaseManifestError("invalid_contract", "Release contract rollback identities are invalid.");
	}
}

function normalizeArtifacts(input, contract) {
	if (!Array.isArray(input) || input.length !== ARTIFACT_IDS.size) {
		throw new CealCliReleaseManifestError("invalid_artifacts", "Exactly one ceal and one cealctl artifact are required.");
	}
	const seen = new Set();
	const result = {};
	for (const item of input) {
		if (!ARTIFACT_IDS.has(item?.id) || seen.has(item.id)) {
			throw new CealCliReleaseManifestError("invalid_artifacts", "Artifact ids must be unique ceal and cealctl values.");
		}
		seen.add(item.id);
		const artifactPath = path.resolve(requireString(item.path, "artifact path"));
		const stat = lstatSync(artifactPath);
		if (!stat.isFile() || stat.isSymbolicLink()) {
			throw new CealCliReleaseManifestError("invalid_artifact", "Release artifacts must be regular non-symlink files.");
		}
		const bytes = readFileSync(artifactPath);
		const declared = contract.artifacts[item.id];
		assertArtifactPackageIdentity(artifactPath, declared);
		result[item.id] = {
			package: declared.package,
			package_version: declared.package_version,
			command: declared.command,
			credential_context: declared.credential_context,
			name: path.basename(artifactPath),
			bytes: bytes.length,
			sha256: sha256(bytes),
		};
	}
	return result;
}

function assertArtifactPackageIdentity(artifactPath, declared) {
	const manifest = readArtifactPackageManifest(artifactPath);
	const bin = manifest.bin;
	if (manifest.name !== declared.package
		|| manifest.version !== declared.package_version
		|| !bin
		|| typeof bin !== "object"
		|| Array.isArray(bin)
		|| Object.keys(bin).length !== 1
		|| bin[declared.command] !== "./dist/bin.js") {
		throw new CealCliReleaseManifestError("artifact_identity_mismatch", "Release artifact package identity does not match its declared command.");
	}
}

function readArtifactPackageManifest(artifactPath) {
	try {
		const output = execFileSync("tar", ["-xOzf", artifactPath, "package/package.json"], {
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return JSON.parse(output);
	} catch {
		throw new CealCliReleaseManifestError("invalid_artifact", "Release artifact is not a readable npm package tarball.");
	}
}

function requireSafeOutputDirectory(value, repoRoot) {
	const outputDir = path.resolve(requireString(value, "output directory"));
	const root = path.parse(outputDir).root;
	if (outputDir === root || outputDir === repoRoot || outputDir === path.resolve(repoRoot, "..")) {
		throw new CealCliReleaseManifestError("unsafe_output", "Refusing a broad release manifest output directory.");
	}
	return outputDir;
}

function readJson(filePath, label) {
	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		throw new CealCliReleaseManifestError("invalid_json", `Could not read ${label}.`);
	}
}

function requireString(value, label) {
	if (typeof value !== "string" || value.length === 0 || /[\r\n]/u.test(value)) {
		throw new CealCliReleaseManifestError("invalid_argument", `Invalid ${label}.`);
	}
	return value;
}

function isVersion(value) {
	return typeof value === "string" && /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/u.test(value);
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
	const options = { artifacts: [], json: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") return { help: true };
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--out") {
			options.outputDir = requireCliValue(argv, ++index);
			continue;
		}
		if (arg === "--artifact") {
			const value = requireCliValue(argv, ++index);
			const separator = value.indexOf("=");
			if (separator <= 0) throw new CealCliReleaseManifestError("invalid_argument", "Invalid artifact mapping.");
			options.artifacts.push({ id: value.slice(0, separator), path: value.slice(separator + 1) });
			continue;
		}
		throw new CealCliReleaseManifestError("invalid_argument", "Unexpected release manifest argument.");
	}
	return { options };
}

function requireCliValue(argv, index) {
	const value = argv[index];
	if (!value || value.startsWith("--")) throw new CealCliReleaseManifestError("invalid_argument", "Missing option value.");
	return value;
}

function usage() {
	return "usage: node scripts/build-release-manifest.mjs --out <dir> --artifact ceal=<path> --artifact cealctl=<path> [--json]";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	let json = process.argv.includes("--json");
	try {
		const parsed = parseArgs(process.argv.slice(2));
		if (parsed.help) {
			console.log(usage());
		} else {
			json = parsed.options.json;
			const result = buildCealCliReleaseManifest(parsed.options);
			console.log(json ? JSON.stringify(result, null, 2) : `Wrote ${result.manifest_path}`);
		}
	} catch (error) {
		const payload = {
			schema_version: "ceal.cli_release_manifest_error.v1",
			ok: false,
			error_code: error instanceof CealCliReleaseManifestError ? error.code : "release_manifest_failed",
			message: error instanceof CealCliReleaseManifestError ? error.message : "Could not build the release manifest.",
		};
		if (json) console.log(JSON.stringify(payload));
		else console.error(payload.message);
		process.exitCode = 2;
	}
}
