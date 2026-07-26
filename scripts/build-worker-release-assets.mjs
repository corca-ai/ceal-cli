#!/usr/bin/env node

// Composes the installer-facing worker release asset set for one platform from
// the locked Gateway handoff archive lane, and merges per-platform sets into
// the one signed release inventory that install-ceal.sh consumes.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codedErrorClass } from "./lib/coded-error.mjs";
import { assertNoSymlinkComponents } from "./lib/safe-output-path.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = ".ceal-worker-release-assets";
const INSTALLER_NAME = "install-ceal.sh";
const GUIDE_ASSET = "ceal-guide-SKILL.md";
const NOTICE_NAME = "THIRD_PARTY_NOTICES.txt";
const SHARED_ASSETS = Object.freeze([GUIDE_ASSET, NOTICE_NAME, INSTALLER_NAME]);
const PLATFORM_PATTERN = /^(?:linux|darwin)-(?:arm64|amd64)$/u;

export const WorkerReleaseAssetsError = codedErrorClass("WorkerReleaseAssetsError");

export async function composeWorkerReleaseAssets(options = {}, dependencies = {}) {
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	const output = inspectOutput(options.outputDirectory, repoRoot, options.force === true);
	// Canonicalize the stage so the native builder's no-symlink output guard
	// accepts it on hosts whose temp root sits behind a symlink (macOS /var).
	const stage = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-release-assets-")));
	// The native builder needs build-time dependencies (esbuild/postject);
	// loading it lazily keeps `merge` runnable on a dependency-free host.
	let nativeErrorClass = null;
	try {
		let buildNative = dependencies.buildNative;
		if (!buildNative) {
			const nativeModule = await import("./build-worker-native-artifact.mjs");
			buildNative = nativeModule.buildWorkerNativeArtifact;
			nativeErrorClass = nativeModule.WorkerNativeArtifactError;
		}
		const nativeOut = path.join(stage, "native");
		const native = await buildNative({
			outputDirectory: nativeOut,
			gatewayHandoffArchive: options.gatewayHandoffArchive,
			platform: options.platform,
			repoRoot: options.repoRoot,
		});
		if (native?.ok !== true || !PLATFORM_PATTERN.test(native.platform ?? ""))
			fail("native_build_failed", "Worker release assets require a successful native artifact build.");
		if (options.version !== undefined && options.version !== native.version)
			fail("version_mismatch", "Worker release assets version does not match the built worker artifact.");
		const binaryName = `ceal-${native.platform}`;
		const binary = readStagedFile(path.join(nativeOut, binaryName), "native_output_incomplete");
		if (sha256(binary) !== native.artifact.sha256) fail("native_output_incomplete", "Native worker artifact bytes drifted after its build.");
		const guide = readStagedFile(path.join(nativeOut, GUIDE_ASSET), "native_output_incomplete");
		const notices = readStagedFile(path.join(nativeOut, NOTICE_NAME), "native_output_incomplete");
		const installer = readStagedFile(path.join(repoRoot, INSTALLER_NAME), "installer_unavailable");
		const manifest = {
			schema_version: "ceal.worker_release_manifest.v1",
			artifact_state: "unsigned_build_candidate",
			version: native.version,
			platform: native.platform,
			command: "ceal",
			artifact: { name: binaryName, bytes: binary.length, sha256: native.artifact.sha256 },
			guide: { name: GUIDE_ASSET, bytes: guide.length, sha256: sha256(guide) },
			installer: { name: INSTALLER_NAME, bytes: installer.length, sha256: sha256(installer) },
			third_party_notices: { name: NOTICE_NAME, bytes: notices.length, sha256: sha256(notices) },
			protocol: native.protocol,
			native_smoke: native.native_smoke,
			non_claims: [
				"This asset set is unsigned until the worker release workflow signs and publishes it.",
				"This does not prove a Gateway host, policy, connector, provider, audit, or installed-client action.",
			],
		};
		const manifestName = `ceal-worker-release-manifest-${native.platform}.json`;
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
		const staging = mkdtempSync(path.join(path.dirname(output.directory), `.${path.basename(output.directory)}.ceal-worker-assets-`));
		try {
			writeFileSync(path.join(staging, MARKER), "ceal worker release assets output\n", { mode: 0o644 });
			writeFileSync(path.join(staging, binaryName), binary, { mode: 0o755 });
			writeFileSync(path.join(staging, GUIDE_ASSET), guide, { mode: 0o644 });
			writeFileSync(path.join(staging, NOTICE_NAME), notices, { mode: 0o644 });
			writeFileSync(path.join(staging, INSTALLER_NAME), installer, { mode: 0o755 });
			writeFileSync(path.join(staging, manifestName), manifestBytes, { mode: 0o644 });
			writeChecksumInventory(staging);
			publishOutput(staging, output);
		} catch (error) {
			rmSync(staging, { recursive: true, force: true });
			throw error;
		}
		return {
			schema_version: "ceal.worker_release_assets_build.v1",
			ok: true,
			proof_level: "local_state",
			writes_external: false,
			output_dir: output.directory,
			version: native.version,
			platform: native.platform,
			assets: {
				binary: { name: binaryName, sha256: native.artifact.sha256 },
				manifest: { name: manifestName, sha256: sha256(manifestBytes) },
				guide: { name: GUIDE_ASSET, sha256: sha256(guide) },
				installer: { name: INSTALLER_NAME, sha256: sha256(installer) },
				third_party_notices: { name: NOTICE_NAME, sha256: sha256(notices) },
			},
			non_claims: manifest.non_claims,
		};
	} catch (error) {
		if (error instanceof WorkerReleaseAssetsError) throw error;
		if (nativeErrorClass && error instanceof nativeErrorClass) throw new WorkerReleaseAssetsError(error.code, error.message);
		throw new WorkerReleaseAssetsError("worker_release_assets_failed", "Could not compose worker release assets.");
	} finally {
		rmSync(stage, { recursive: true, force: true });
	}
}

export function mergeWorkerReleaseAssetSets(options = {}) {
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	const output = inspectOutput(options.outputDirectory, repoRoot, options.force === true);
	const inputs = Array.isArray(options.inputs) ? options.inputs.map((value) => requireAssetDirectory(value)) : [];
	if (inputs.length === 0) fail("merge_inputs_required", "Merging worker release assets requires at least one composed input set.");
	const platforms = new Map();
	const shared = new Map();
	for (const input of inputs) {
		const inventory = readInventory(input);
		for (const [name, digest] of inventory) {
			const bytes = readStagedFile(path.join(input, name), "merge_input_incomplete");
			if (sha256(bytes) !== digest) fail("merge_input_incomplete", "Composed worker asset does not match its checksum inventory.");
			if (SHARED_ASSETS.includes(name)) {
				if (shared.has(name) && shared.get(name).digest !== digest)
					fail("merge_shared_drift", `Shared worker release asset ${name} differs between platform sets.`);
				shared.set(name, { bytes, digest, mode: name === INSTALLER_NAME ? 0o755 : 0o644 });
				continue;
			}
			const platform = platformOfAsset(name);
			if (platform === null) fail("merge_unexpected_asset", `Composed worker asset ${name} is not a worker release asset.`);
			if (!platforms.has(platform)) platforms.set(platform, new Map());
			if (platforms.get(platform).has(name)) fail("merge_duplicate_asset", `Worker release asset ${name} appears in more than one input set.`);
			platforms.get(platform).set(name, { bytes, digest, mode: name.startsWith("ceal-worker-release-manifest-") ? 0o644 : 0o755 });
		}
	}
	for (const shortName of SHARED_ASSETS)
		if (!shared.has(shortName)) fail("merge_input_incomplete", `Merged worker release set is missing ${shortName}.`);
	for (const [platform, entries] of platforms) {
		if (entries.size !== 2) fail("merge_input_incomplete", `Merged worker release set has an incomplete pair for ${platform}.`);
	}
	if (platforms.size === 0) fail("merge_input_incomplete", "Merged worker release set names no platform.");
	const staging = mkdtempSync(path.join(path.dirname(output.directory), `.${path.basename(output.directory)}.ceal-worker-merge-`));
	try {
		writeFileSync(path.join(staging, MARKER), "ceal worker release assets output\n", { mode: 0o644 });
		for (const [name, entry] of shared) writeFileSync(path.join(staging, name), entry.bytes, { mode: entry.mode });
		for (const entries of platforms.values())
			for (const [name, entry] of entries) writeFileSync(path.join(staging, name), entry.bytes, { mode: entry.mode });
		writeChecksumInventory(staging);
		publishOutput(staging, output);
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
	return {
		schema_version: "ceal.worker_release_assets_merge.v1",
		ok: true,
		proof_level: "local_state",
		writes_external: false,
		output_dir: output.directory,
		platforms: [...platforms.keys()].sort(),
		entry_count: 3 + 2 * platforms.size,
	};
}

function platformOfAsset(name) {
	const binary = /^ceal-((?:linux|darwin)-(?:arm64|amd64))$/u.exec(name);
	if (binary) return binary[1];
	const manifest = /^ceal-worker-release-manifest-((?:linux|darwin)-(?:arm64|amd64))[.]json$/u.exec(name);
	return manifest ? manifest[1] : null;
}

function readInventory(directory) {
	const bytes = readStagedFile(path.join(directory, "SHA256SUMS"), "merge_input_incomplete").toString("utf8");
	const lines = bytes.split("\n").filter(Boolean);
	const entries = lines.map((line) => /^([a-f0-9]{64}) {2}(\S+)$/u.exec(line));
	if (lines.length === 0 || entries.some((entry) => entry === null))
		fail("merge_input_incomplete", "Composed worker asset inventory is malformed.");
	return entries.map((entry) => [entry[2], entry[1]]);
}

function writeChecksumInventory(directory) {
	const names = readdirSync(directory)
		.filter((name) => name !== MARKER && name !== "SHA256SUMS")
		.sort();
	const lines = names.map((name) => `${sha256(readFileSync(path.join(directory, name)))}  ${name}`);
	writeFileSync(path.join(directory, "SHA256SUMS"), `${lines.join("\n")}\n`, { mode: 0o644 });
}

function requireAssetDirectory(value) {
	if (typeof value !== "string" || !path.isAbsolute(value))
		fail("merge_inputs_required", "Merged worker asset inputs must be absolute directories.");
	const directory = path.resolve(value);
	if (!existsSync(directory) || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
		fail("merge_inputs_required", "Merged worker asset input is not a regular directory.");
	if (!existsSync(path.join(directory, MARKER)))
		fail("merge_inputs_required", "Merged worker asset input is not a marked composed asset set.");
	return directory;
}

function readStagedFile(file, code) {
	if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
		fail(code, `Worker release asset input ${path.basename(file)} is unavailable.`);
	return readFileSync(file);
}

function inspectOutput(value, repoRoot, force) {
	if (typeof value !== "string" || !path.isAbsolute(value))
		fail("invalid_output", "Worker release assets output must be an absolute directory.");
	const directory = path.resolve(value);
	if ([path.parse(directory).root, repoRoot, path.resolve(repoRoot, "..")].includes(directory))
		fail("unsafe_output", "Worker release assets output is too broad.");
	assertNoSymlinkComponents(directory, fail, "Worker release assets output");
	if (!existsSync(directory)) return { directory, force: false };
	if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
		fail("unsafe_output", "Worker release assets output must be a regular directory.");
	if (!force || !existsSync(path.join(directory, MARKER)) || lstatSync(path.join(directory, MARKER)).isSymbolicLink())
		fail("output_not_replaceable", "Use --force only with a marked worker release assets output.");
	return { directory, force: true };
}

function publishOutput(staging, output) {
	if (!output.force) {
		renameSync(staging, output.directory);
		return;
	}
	rmSync(output.directory, { recursive: true, force: true });
	renameSync(staging, output.directory);
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
function fail(code, message) {
	throw new WorkerReleaseAssetsError(code, message);
}

function parseArgs(argv) {
	const [mode, ...rest] = argv;
	const options = { force: false, inputs: [] };
	let json = false;
	for (let index = 0; index < rest.length; index += 1) {
		const arg = rest[index];
		if (arg === "--help" || arg === "-h") return { help: true, json, mode, options };
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--force") {
			options.force = true;
			continue;
		}
		if (arg === "--input") {
			const value = rest[++index];
			if (typeof value !== "string") fail("invalid_argument", "Worker release assets option requires a value.");
			options.inputs.push(value);
			continue;
		}
		if (["--out", "--platform", "--version", "--gateway-handoff-archive"].includes(arg)) {
			const value = rest[++index];
			if (typeof value !== "string") fail("invalid_argument", "Worker release assets option requires a value.");
			const name = arg === "--out" ? "outputDirectory" : arg === "--gateway-handoff-archive" ? "gatewayHandoffArchive" : arg.slice(2);
			options[name] = value;
			continue;
		}
		fail("invalid_argument", "Unexpected worker release assets argument.");
	}
	return { help: false, json, mode, options };
}

export async function runCli(argv, io = console) {
	const json = argv.includes("--json");
	try {
		const parsed = parseArgs(argv);
		if (parsed.help || (parsed.mode !== "compose" && parsed.mode !== "merge")) {
			io.log(
				"usage: node scripts/build-worker-release-assets.mjs compose --out <absolute-dir> --gateway-handoff-archive <absolute-tar.gz> [--version <semver>] [--platform <current-platform>] [--force] [--json]\n       node scripts/build-worker-release-assets.mjs merge --out <absolute-dir> --input <composed-dir> [--input <composed-dir> ...] [--force] [--json]",
			);
			return parsed.help ? 0 : 2;
		}
		const result = parsed.mode === "compose" ? await composeWorkerReleaseAssets(parsed.options) : mergeWorkerReleaseAssetSets(parsed.options);
		io.log(json ? JSON.stringify(result, null, 2) : `Prepared worker release assets in ${result.output_dir}.`);
		return 0;
	} catch (error) {
		const known = error instanceof WorkerReleaseAssetsError;
		const payload = {
			schema_version: "ceal.worker_release_assets_error.v1",
			ok: false,
			error_code: known ? error.code : "worker_release_assets_failed",
			message: known ? error.message : "Could not prepare worker release assets.",
		};
		if (json) io.log(JSON.stringify(payload));
		else io.error(payload.message);
		return 2;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	process.exitCode = await runCli(process.argv.slice(2));
