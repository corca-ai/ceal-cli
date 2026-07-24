#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { parse } from "yaml";
import { prepareWorkerReleaseConsumer, WorkerReleasePackageError } from "./build-worker-release-package.mjs";
import {
	withWorkerReleaseDevelopmentInputsAsync,
	withWorkerReleaseInputsAsync,
	WorkerReleaseInputError,
} from "./worker-release-inputs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRE = createRequire(import.meta.url);
const MARKER = ".ceal-worker-native-artifact";
const MANIFEST_FILENAME = "ceal-worker-native-artifact-manifest.json";
const NOTICE_FILENAME = "THIRD_PARTY_NOTICES.txt";
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const REQUIRED_COMMANDS = Object.freeze(["update", "session", "guide", "capabilities", "call", "receipt"]);

export class WorkerNativeArtifactError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "WorkerNativeArtifactError";
		this.code = code;
	}
}

export async function buildWorkerNativeArtifact(options = {}, dependencies = {}) {
	return await buildWorkerNativeArtifactWithInputs(options, dependencies, withWorkerReleaseInputsAsync);
}

export async function buildWorkerNativeArtifactFromDevelopmentInputs(options = {}, dependencies = {}) {
	return await buildWorkerNativeArtifactWithInputs(options, dependencies, withWorkerReleaseDevelopmentInputsAsync);
}

async function buildWorkerNativeArtifactWithInputs(options, dependencies, resolveInputs) {
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	const output = inspectOutput(options.outputDirectory, repoRoot, options.force === true);
	const platform = resolvePlatform(options.platform, dependencies);
	try {
		return await resolveInputs({ ...options, repoRoot }, async ({ inputs, rawInputs }) => {
			let stage;
			try {
				stage = mkdtempSync(path.join(tmpdir(), "ceal-worker-native-artifact-"));
				const packed = prepareWorkerReleaseConsumer({
					repoRoot,
					stage,
					inputs,
					protocolTarball: rawInputs.protocolTarball,
					dependencies,
				});
				const version = resolveVersion(repoRoot, inputs);
				const artifact = await buildNativeArtifact({ stage, packed, platform, version, dependencies });
				materializeOutput({ output, repoRoot, inputs, version, platform, artifact });
				return {
					schema_version: "ceal.worker_native_artifact_build.v1",
					ok: true,
					proof_level: "local_state",
					writes_external: false,
					output_dir: output.directory,
					version,
					platform,
					artifact: { name: artifact.name, bytes: artifact.bytes, sha256: artifact.sha256 },
					consumer_smoke: packed.consumerSmoke,
					native_smoke: artifact.smoke,
					protocol: inputs.protocol,
					non_claims: [
						"This is a local unsigned native worker-artifact proof, not a signature, tag, upload, installation, or Gateway action.",
						"No operator CLI, operator guide, Gateway protocol source, legacy installer, or composite release workflow was used as a worker-release input.",
					],
				};
			} finally {
				if (stage) rmSync(stage, { recursive: true, force: true });
			}
		}, dependencies);
	} catch (error) {
		if (error instanceof WorkerNativeArtifactError) throw error;
		if (error instanceof WorkerReleasePackageError || error instanceof WorkerReleaseInputError) throw new WorkerNativeArtifactError(error.code, error.message);
		throw new WorkerNativeArtifactError("worker_native_artifact_build_failed", "Could not build the isolated native worker artifact.");
	}
}

async function buildNativeArtifact({ stage, packed, platform, version, dependencies }) {
	const work = path.join(stage, "native");
	mkdirSync(work, { recursive: true, mode: 0o755 });
	const bundlePath = path.join(work, "ceal.cjs");
	const blobPath = path.join(work, "ceal.blob");
	const artifactPath = path.join(work, `ceal-${platform}`);
	try {
		await (dependencies.bundle ?? bundleInstalledWorker)({ workerBin: packed.consumer.workerBin, bundlePath, consumerDirectory: packed.consumer.directory });
		(dependencies.createBlob ?? createBlob)({ bundlePath, blobPath, work });
		(dependencies.copyRuntime ?? copyRuntime)({ artifactPath });
		chmodSync(artifactPath, 0o755);
		if (platform.startsWith("darwin-")) (dependencies.removeMachoSignature ?? removeMachoSignature)({ artifactPath });
		(dependencies.injectBlob ?? injectBlob)({ artifactPath, blobPath, platform, postjectCli: dependencies.resolvePostjectCli?.() ?? resolvePostjectCli() });
		if (platform.startsWith("darwin-")) (dependencies.signMachoAdhoc ?? signMachoAdhoc)({ artifactPath });
		const smoke = (dependencies.smoke ?? smokeArtifact)({ artifactPath, version });
		const bytes = readFileSync(artifactPath);
		return { name: path.basename(artifactPath), path: artifactPath, bytes: bytes.length, sha256: sha256(bytes), smoke };
	} catch (error) {
		if (error instanceof WorkerNativeArtifactError) throw error;
		throw new WorkerNativeArtifactError("worker_native_artifact_build_failed", "Could not build the isolated native worker artifact.");
	}
}

async function bundleInstalledWorker({ workerBin, bundlePath, consumerDirectory }) {
	if (!existsSync(workerBin) || lstatSync(workerBin).isSymbolicLink()) fail("worker_native_bundle_failed", "Packed worker consumer entrypoint is unavailable.");
	try {
		await esbuild.build({
			// Pin the bundler's working directory to the staged consumer so its
			// emitted module-path comments are stage-independent; the SEA blob,
			// and therefore the whole artifact, must be byte-reproducible.
			absWorkingDir: consumerDirectory,
			bundle: true,
			entryPoints: [workerBin],
			format: "cjs",
			logLevel: "silent",
			outfile: bundlePath,
			platform: "node",
			target: "node22",
		});
	} catch {
		fail("worker_native_bundle_failed", "Packed worker command could not be bundled.");
	}
}

function createBlob({ bundlePath, blobPath, work }) {
	const config = path.join(work, "ceal.sea.json");
	writeFileSync(config, `${JSON.stringify({
		main: path.basename(bundlePath),
		output: path.basename(blobPath),
		executable: process.execPath,
		disableExperimentalSEAWarning: true,
		useCodeCache: false,
		useSnapshot: false,
		execArgvExtension: "none",
	}, null, 2)}\n`, { mode: 0o644 });
	try {
		execFileSync(process.execPath, ["--experimental-sea-config", path.basename(config)], { cwd: work, stdio: "pipe" });
	} catch {
		fail("worker_native_blob_failed", "Native worker SEA blob could not be created.");
	}
}

function copyRuntime({ artifactPath }) {
	copyFileSync(process.execPath, artifactPath);
}

function injectBlob({ artifactPath, blobPath, platform, postjectCli }) {
	const machoArguments = platform.startsWith("darwin-") ? ["--macho-segment-name", "NODE_SEA"] : [];
	try {
		execFileSync(process.execPath, [postjectCli, artifactPath, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", SEA_FUSE, "--overwrite", ...machoArguments], { stdio: "pipe" });
	} catch {
		fail("worker_native_injection_failed", "Native worker SEA blob could not be injected.");
	}
}

// Mach-O binaries must drop the runtime's original signature before postject
// injection and carry at least an ad-hoc signature to execute on arm64 macOS.
function removeMachoSignature({ artifactPath }) {
	try {
		execFileSync("codesign", ["--remove-signature", artifactPath], { stdio: "pipe" });
	} catch {
		fail("worker_native_signature_failed", "Native worker artifact signature could not be removed before injection.");
	}
}

function signMachoAdhoc({ artifactPath }) {
	try {
		execFileSync("codesign", ["--force", "--sign", "-", artifactPath], { stdio: "pipe" });
	} catch {
		fail("worker_native_signature_failed", "Native worker artifact could not be ad-hoc signed.");
	}
}

function smokeArtifact({ artifactPath, version }) {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-worker-native-smoke-home-"));
	const run = (args) => execFileSync(artifactPath, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, HOME: home },
	});
	try {
		const identity = parse(run(["version"]));
		const commands = parse(run(["commands"]));
		const help = run(["--help"]);
		const names = Array.isArray(commands?.commands) ? commands.commands.map((entry) => entry?.name).filter((entry) => typeof entry === "string") : [];
		if (identity?.command !== "ceal" || identity?.version !== version || !help.includes("Usage: ceal <command> [options]")
			|| REQUIRED_COMMANDS.some((name) => !names.includes(name)) || names.includes("cealctl")) {
			fail("worker_native_smoke_failed", "Native worker artifact did not expose the expected worker-only command surface.");
		}
		return { command: "ceal", version, help: true, required_commands: [...REQUIRED_COMMANDS], operator_surface_absent: true };
	} catch (error) {
		if (error instanceof WorkerNativeArtifactError) throw error;
		fail("worker_native_smoke_failed", "Native worker artifact could not run its worker-only smoke checks.");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

function materializeOutput({ output, repoRoot, inputs, version, platform, artifact }) {
	const staging = mkdtempSync(path.join(path.dirname(output.directory), `.${path.basename(output.directory)}.ceal-worker-native-`));
	try {
		writeFileSync(path.join(staging, MARKER), "ceal worker native artifact output\n", { mode: 0o644 });
		copyFileSync(artifact.path, path.join(staging, artifact.name));
		chmodSync(path.join(staging, artifact.name), 0o755);
		const guide = readFileSync(path.join(repoRoot, inputs.guide.source_path));
		const notice = readFileSync(path.join(repoRoot, NOTICE_FILENAME));
		writeFileSync(path.join(staging, inputs.guide.asset), guide, { mode: 0o644 });
		writeFileSync(path.join(staging, NOTICE_FILENAME), notice, { mode: 0o644 });
		const manifest = {
			schema_version: "ceal.worker_native_artifact_manifest.v1",
			status: "local_candidate_not_published",
			version,
			platform,
			artifact: { name: artifact.name, bytes: artifact.bytes, sha256: artifact.sha256 },
			guide: { name: inputs.guide.asset, bytes: guide.length, sha256: sha256(guide) },
			third_party_notices: { name: NOTICE_FILENAME, bytes: notice.length, sha256: sha256(notice) },
			protocol: inputs.protocol,
			handoff: inputs.handoff,
			consumer_smoke: { installed_from_packed_archives: true, source_or_workspace_fallback_used: false },
			native_smoke: artifact.smoke,
			non_claims: ["This is a local unsigned native worker artifact candidate, not a signed release or installation."],
		};
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
		writeFileSync(path.join(staging, MANIFEST_FILENAME), manifestBytes, { mode: 0o644 });
		const entries = [
			{ name: artifact.name, sha256: artifact.sha256 },
			{ name: inputs.guide.asset, sha256: sha256(guide) },
			{ name: NOTICE_FILENAME, sha256: sha256(notice) },
			{ name: MANIFEST_FILENAME, sha256: sha256(manifestBytes) },
		].sort((left, right) => left.name.localeCompare(right.name));
		writeFileSync(path.join(staging, "SHA256SUMS"), entries.map((entry) => `${entry.sha256}  ${entry.name}`).join("\n") + "\n", { mode: 0o644 });
		publishOutput(staging, output);
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
}

function resolveVersion(repoRoot, inputs) {
	// Worker and client version together; the exact protocol pin against the
	// supplied artifact is enforced by the release-input resolver.
	const versions = [inputs.worker, inputs.client].map((entry) => readJson(path.join(repoRoot, entry.source_path, "package.json"), "invalid_inventory").version);
	if (versions.some((value) => typeof value !== "string") || new Set(versions).size !== 1) {
		fail("version_mismatch", "Worker and client package versions must match exactly.");
	}
	return versions[0];
}

function resolvePlatform(value, dependencies) {
	const current = (dependencies.currentPlatform ?? currentPlatform)();
	if (!/^(?:linux|darwin)-(?:arm64|amd64)$/u.test(current)) fail("unsupported_platform", "Native worker artifacts require a supported Linux or macOS host platform.");
	if (value !== undefined && value !== current) fail("platform_mismatch", "Native worker artifacts must be built on their target platform.");
	return current;
}

function currentPlatform() {
	const architecture = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : process.arch;
	return `${process.platform}-${architecture}`;
}

function inspectOutput(value, repoRoot, force) {
	if (typeof value !== "string" || !path.isAbsolute(value)) fail("invalid_output", "Native worker artifact output must be an absolute directory.");
	const directory = path.resolve(value);
	if ([path.parse(directory).root, repoRoot, path.resolve(repoRoot, "..")].includes(directory)) fail("unsafe_output", "Native worker artifact output is too broad.");
	assertNoSymlinkComponents(directory);
	if (!existsSync(directory)) return { directory, force: false };
	if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) fail("unsafe_output", "Native worker artifact output must be a regular directory.");
	if (!force || !existsSync(path.join(directory, MARKER)) || lstatSync(path.join(directory, MARKER)).isSymbolicLink()) fail("output_not_replaceable", "Use --force only with a marked native worker artifact output.");
	return { directory, force: true };
}

function publishOutput(staging, output) {
	if (!output.force) { renameSync(staging, output.directory); return; }
	rmSync(output.directory, { recursive: true, force: true });
	renameSync(staging, output.directory);
}

function assertNoSymlinkComponents(value) {
	let current = path.parse(value).root;
	for (const part of value.slice(current.length).split(path.sep).filter(Boolean)) {
		current = path.join(current, part);
		if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail("unsafe_output", "Native worker artifact output cannot traverse a symbolic link.");
	}
}

function resolvePostjectCli() {
	try {
		const candidate = path.join(path.dirname(REQUIRE.resolve("postject/package.json")), "dist", "cli.js");
		if (existsSync(candidate)) return candidate;
	} catch {
		// Normalize below.
	}
	fail("postject_unavailable", "postject is required to build native worker artifacts.");
}

function readJson(filePath, code) {
	try { return JSON.parse(readFileSync(filePath, "utf8")); }
	catch { fail(code, "Worker native artifact input JSON is invalid."); }
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function fail(code, message) { throw new WorkerNativeArtifactError(code, message); }

function parseArgs(argv) {
	const options = { force: false };
	let json = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") return { help: true, json, options };
		if (arg === "--json") { json = true; continue; }
		if (arg === "--force") { options.force = true; continue; }
		if (["--out", "--platform", "--gateway-handoff-archive"].includes(arg)) {
			const value = argv[++index];
			if (typeof value !== "string") fail("invalid_argument", "Native worker artifact option requires a value.");
			const name = arg === "--out" ? "outputDirectory" : arg === "--platform" ? "platform" : "gatewayHandoffArchive";
			options[name] = value;
			continue;
		}
		fail("invalid_argument", "Unexpected native worker artifact argument.");
	}
	return { help: false, json, options };
}

export async function runCli(argv, io = console) {
	const json = argv.includes("--json");
	try {
		const parsed = parseArgs(argv);
		if (parsed.help) {
			io.log("usage: node scripts/build-worker-native-artifact.mjs --out <absolute-dir> --gateway-handoff-archive <absolute-tar.gz> [--platform <current-platform>] [--force] [--json]");
			return 0;
		}
		const result = await buildWorkerNativeArtifact(parsed.options);
		io.log(parsed.json ? JSON.stringify(result, null, 2) : `Built native worker artifact ${result.version} for ${result.platform}.`);
		return 0;
	} catch (error) {
		const known = error instanceof WorkerNativeArtifactError;
		const payload = { schema_version: "ceal.worker_native_artifact_build_error.v1", ok: false, error_code: known ? error.code : "worker_native_artifact_build_failed", message: known ? error.message : "Could not build native worker artifact." };
		if (json) io.log(JSON.stringify(payload)); else io.error(payload.message);
		return 2;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runCli(process.argv.slice(2));
