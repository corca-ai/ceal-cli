#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { parse } from "yaml";
import { sha256 } from "../packages/ceal-worker-cli/src/sha256.ts";
import { prepareWorkerReleaseConsumer, WorkerReleasePackageError } from "./build-worker-release-package.ts";
import {
	verifyEmbeddedCarrierContractSource,
	verifyEmbeddedControlSessionContractSource,
	verifyEmbeddedGatewayLeasedConsumerHandoffSource,
} from "./generate-leased-consumer-handoff-runtime.ts";
import { codedErrorClass } from "./lib/coded-error.ts";
import { asJsonRecord } from "./lib/json-record.ts";
import { inspectOutputDirectory, publishOutputDirectory } from "./lib/output-directory.ts";
import { parseScriptArgs } from "./lib/parse-script-args.ts";
import { createJsonReader } from "./lib/read-json.ts";
import { resolveMatchingWorkerClientVersion } from "./lib/release-version.ts";
import { createSkillDirectoryBundle } from "./lib/skill-directory-bundle.ts";
import type { ArchiveLock } from "./worker-gateway-handoff-archive.ts";
import { WorkerReleaseInputError, withWorkerReleaseDevelopmentInputsAsync, withWorkerReleaseInputsAsync } from "./worker-release-inputs.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRE = createRequire(import.meta.url);
const MARKER = ".ceal-worker-native-artifact";
const MANIFEST_FILENAME = "ceal-worker-native-artifact-manifest.json";
const NOTICE_FILENAME = "THIRD_PARTY_NOTICES.txt";
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const REQUIRED_COMMANDS = Object.freeze(["update", "session", "guide", "capabilities", "call", "receipt"]);

type JsonRecord = Record<string, unknown>;
type NativeOptions = {
	repoRoot?: string;
	inventoryPath?: string;
	outputDirectory?: string;
	force?: boolean;
	platform?: string;
	gatewayHandoffArchive?: string;
	protocolTarball?: string;
	protocolProvenance?: string;
	controlConformance?: string;
	handoffManifest?: string;
	expectedHandoffSha256?: string;
};
type ResolverInput = Parameters<typeof withWorkerReleaseInputsAsync>[1] extends (value: infer Value) => unknown ? Value : never;
type NativeInputValue = ResolverInput;
type NativeInputs = NativeInputValue extends { inputs: infer Inputs } ? Inputs : never;
type RawInputs = NativeInputValue extends { rawInputs: infer Inputs } ? Inputs : never;
type GuideFile = { path: string; bytes: number; sha256: string; mode: number };
type GuideBundle = { bytes: Buffer; files: GuideFile[]; sha256: string };
type NativeSmoke = {
	command: string;
	version: string;
	help: true;
	required_commands: string[];
	operator_surface_absent: true;
	embedded_guide_sha256?: string;
	guide_registration?: true;
	[key: string]: unknown;
};
type PackedConsumer = {
	worker: { name: string; bytes: number; sha256: string; path: string };
	client: { package: string; version: string; filename: string; bytes: number; sha256: string };
	consumerSmoke: JsonRecord;
	consumer: { directory: string; workerBin: string };
	controlSessionContract?: unknown;
};
type NativeDependencies = {
	consumeArchive?: (
		options: { repoRoot: string; archiveFile?: string },
		dependencies: {
			resolveInputs: (raw: RawInputs) => NativeInputs;
			consume: (value: { resolution: NativeInputs; rawInputs: RawInputs; lock: ArchiveLock }) => NativeResult | PromiseLike<NativeResult>;
		},
	) => NativeResult | PromiseLike<NativeResult>;
	currentPlatform?: () => string;
	prepareConsumer?: (value: {
		repoRoot: string;
		stage: string;
		inputs: NativeInputs;
		protocolTarball: string;
		controlConformance: string;
		dependencies: NativeDependencies;
	}) => PackedConsumer;
	bundle?: (value: { workerBin: string; bundlePath: string; consumerDirectory: string }) => void | Promise<void>;
	createBlob?: (value: { bundlePath: string; blobPath: string; work: string; guideBundlePath: string; guideAsset: string }) => void;
	copyRuntime?: (value: { artifactPath: string }) => void;
	removeMachoSignature?: (value: { artifactPath: string }) => void;
	injectBlob?: (value: { artifactPath: string; blobPath: string; platform: string; postjectCli: string }) => void;
	signMachoAdhoc?: (value: { artifactPath: string }) => void;
	resolvePostjectCli?: () => string;
	smoke?: (value: { artifactPath: string; version: string; guide: GuideBundle }) => NativeSmoke;
};
type NativeResult = {
	schema_version: string;
	ok: true;
	proof_level: "local_state";
	writes_external: false;
	output_dir: string;
	version: string;
	platform: string;
	artifact: { name: string; bytes: number; sha256: string };
	client: PackedConsumer["client"];
	guide: JsonRecord;
	compatibility_guide: JsonRecord;
	consumer_smoke: JsonRecord;
	native_smoke: NativeSmoke;
	protocol: JsonRecord;
	private_leased_consumer_carrier: unknown;
	private_leased_consumer_control_session: unknown;
	private_leased_consumer_handoff: unknown;
	non_claims: string[];
};
type NativeOutput = { directory: string; force: boolean };
type NativeArtifact = { name: string; path: string; bytes: number; sha256: string; smoke: NativeSmoke };
type InputResolver = (
	options: NativeOptions,
	consume: (value: NativeInputValue) => NativeResult | PromiseLike<NativeResult>,
	dependencies?: NativeDependencies,
) => Promise<NativeResult>;
type OutputManifest = {
	embedded: JsonRecord;
	compatibility: JsonRecord;
};

export const WorkerNativeArtifactError = codedErrorClass("WorkerNativeArtifactError");

export async function buildWorkerNativeArtifact(options: NativeOptions = {}, dependencies: NativeDependencies = {}): Promise<NativeResult> {
	return await buildWorkerNativeArtifactWithInputs(options, dependencies, withWorkerReleaseInputsAsync);
}

/**
 * The development-input twin of the function above, for suites that must build a
 * native artifact without the real release inventory. No lane calls it; that is
 * the point, and the reason it is declared rather than left to read as a guard
 * production forgot to wire.
 *
 * @testOnly
 */
export async function buildWorkerNativeArtifactFromDevelopmentInputs(
	options: NativeOptions = {},
	dependencies: NativeDependencies = {},
): Promise<NativeResult> {
	return await buildWorkerNativeArtifactWithInputs(options, dependencies, withWorkerReleaseDevelopmentInputsAsync);
}

async function buildWorkerNativeArtifactWithInputs(
	options: NativeOptions,
	dependencies: NativeDependencies,
	resolveInputs: InputResolver,
): Promise<NativeResult> {
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	const output = inspectOutputDirectory(options.outputDirectory, {
		repoRoot,
		force: options.force === true,
		subject: "Native worker artifact output",
		marker: MARKER,
		fail,
	});
	const platform = resolvePlatform(options.platform, dependencies);
	try {
		return await resolveInputs(
			{ ...options, repoRoot },
			async ({ inputs, rawInputs }: NativeInputValue): Promise<NativeResult> => {
				let stage: string | undefined;
				try {
					stage = mkdtempSync(path.join(tmpdir(), "ceal-worker-native-artifact-"));
					let privateCarrierContract: unknown;
					let privateControlSessionContract: unknown;
					let privateCarrierHandoff: unknown;
					try {
						privateCarrierContract = verifyEmbeddedCarrierContractSource({ repoRoot });
					} catch {
						fail(
							"embedded_carrier_contract_drift",
							"Worker native artifacts require generated carrier contract bytes to match the source contract.",
						);
					}
					try {
						privateControlSessionContract = verifyEmbeddedControlSessionContractSource({ repoRoot });
					} catch {
						fail(
							"embedded_control_session_contract_drift",
							"Worker native artifacts require generated control-session contract bytes to match the source contract.",
						);
					}
					try {
						privateCarrierHandoff = verifyEmbeddedGatewayLeasedConsumerHandoffSource({ repoRoot });
					} catch {
						fail(
							"embedded_gateway_leased_consumer_handoff_drift",
							"Worker native artifacts require generated Gateway handoff bytes to match the SHA-locked source handoff.",
						);
					}
					// Reached through `dependencies` like every other step, so a test
					// about step order, platform propagation or artifact naming can
					// stub it the way it already stubs bundle, blob, runtime copy,
					// injection, signing and smoke. The real staging is proven by the
					// test that exercises this path unstubbed; the darwin ordering test
					// was paying seven seconds for a fixture it asserts nothing about.
					const packed = (dependencies.prepareConsumer ?? prepareWorkerReleaseConsumer)({
						repoRoot,
						stage,
						inputs,
						protocolTarball: rawInputs.protocolTarball,
						controlConformance: rawInputs.controlConformance,
						dependencies,
					});
					if (packed.controlSessionContract) privateControlSessionContract = packed.controlSessionContract;
					const version = resolveMatchingWorkerClientVersion(repoRoot, [inputs.worker, inputs.client], readJson, fail);
					const guide = createSkillDirectoryBundle(path.join(repoRoot, inputs.guide.source_path));
					const artifact = await buildNativeArtifact({
						stage,
						packed,
						platform,
						version,
						guide,
						guideAsset: inputs.guide.embedded_asset,
						dependencies,
					});
					const guideOutput = materializeOutput({
						output,
						repoRoot,
						inputs,
						guide,
						version,
						platform,
						artifact,
						client: packed.client,
						privateCarrierContract,
						privateControlSessionContract,
						privateCarrierHandoff,
					});
					return {
						schema_version: "ceal.worker_native_artifact_build.v1",
						ok: true,
						proof_level: "local_state",
						writes_external: false,
						output_dir: output.directory,
						version,
						platform,
						artifact: { name: artifact.name, bytes: artifact.bytes, sha256: artifact.sha256 },
						client: packed.client,
						guide: guideOutput.embedded,
						compatibility_guide: guideOutput.compatibility,
						consumer_smoke: packed.consumerSmoke,
						native_smoke: artifact.smoke,
						protocol: inputs.protocol,
						private_leased_consumer_carrier: privateCarrierContract,
						private_leased_consumer_control_session: privateControlSessionContract,
						private_leased_consumer_handoff: privateCarrierHandoff,
						non_claims: [
							"This is a local unsigned native worker-artifact proof, not a signature, tag, upload, installation, or Gateway action.",
							"No operator CLI, operator guide, Gateway protocol source, legacy installer, or composite release workflow was used as a worker-release input.",
						],
					};
				} finally {
					if (stage) rmSync(stage, { recursive: true, force: true });
				}
			},
			dependencies,
		);
	} catch (error) {
		if (error instanceof WorkerNativeArtifactError) throw error;
		if (error instanceof WorkerReleasePackageError || error instanceof WorkerReleaseInputError)
			throw new WorkerNativeArtifactError(error.code, error.message);
		throw new WorkerNativeArtifactError("worker_native_artifact_build_failed", "Could not build the isolated native worker artifact.");
	}
}

async function buildNativeArtifact({
	stage,
	packed,
	platform,
	version,
	guide,
	guideAsset,
	dependencies,
}: {
	stage: string;
	packed: PackedConsumer;
	platform: string;
	version: string;
	guide: GuideBundle;
	guideAsset: string;
	dependencies: NativeDependencies;
}): Promise<NativeArtifact> {
	const work = path.join(stage, "native");
	mkdirSync(work, { recursive: true, mode: 0o755 });
	const bundlePath = path.join(work, "ceal.cjs");
	const blobPath = path.join(work, "ceal.blob");
	const guideBundlePath = path.join(work, guideAsset);
	const artifactPath = path.join(work, `ceal-${platform}`);
	try {
		writeFileSync(guideBundlePath, guide.bytes, { mode: 0o644 });
		await (dependencies.bundle ?? bundleInstalledWorker)({
			workerBin: packed.consumer.workerBin,
			bundlePath,
			consumerDirectory: packed.consumer.directory,
		});
		(dependencies.createBlob ?? createBlob)({ bundlePath, blobPath, work, guideBundlePath, guideAsset });
		(dependencies.copyRuntime ?? copyRuntime)({ artifactPath });
		chmodSync(artifactPath, 0o755);
		if (platform.startsWith("darwin-")) (dependencies.removeMachoSignature ?? removeMachoSignature)({ artifactPath });
		(dependencies.injectBlob ?? injectBlob)({
			artifactPath,
			blobPath,
			platform,
			postjectCli: dependencies.resolvePostjectCli?.() ?? resolvePostjectCli(),
		});
		if (platform.startsWith("darwin-")) (dependencies.signMachoAdhoc ?? signMachoAdhoc)({ artifactPath });
		const smoke = (dependencies.smoke ?? smokeArtifact)({ artifactPath, version, guide });
		const bytes = readFileSync(artifactPath);
		return { name: path.basename(artifactPath), path: artifactPath, bytes: bytes.length, sha256: sha256(bytes), smoke };
	} catch (error) {
		if (error instanceof WorkerNativeArtifactError) throw error;
		throw new WorkerNativeArtifactError("worker_native_artifact_build_failed", "Could not build the isolated native worker artifact.");
	}
}

async function bundleInstalledWorker({
	workerBin,
	bundlePath,
	consumerDirectory,
}: {
	workerBin: string;
	bundlePath: string;
	consumerDirectory: string;
}): Promise<void> {
	if (!existsSync(workerBin) || lstatSync(workerBin).isSymbolicLink())
		fail("worker_native_bundle_failed", "Packed worker consumer entrypoint is unavailable.");
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

function createBlob({
	bundlePath,
	blobPath,
	work,
	guideBundlePath,
	guideAsset,
}: {
	bundlePath: string;
	blobPath: string;
	work: string;
	guideBundlePath: string;
	guideAsset: string;
}): void {
	const config = path.join(work, "ceal.sea.json");
	writeFileSync(
		config,
		`${JSON.stringify(
			{
				main: path.basename(bundlePath),
				output: path.basename(blobPath),
				executable: process.execPath,
				assets: { [guideAsset]: path.basename(guideBundlePath) },
				disableExperimentalSEAWarning: true,
				useCodeCache: false,
				useSnapshot: false,
				execArgvExtension: "none",
			},
			null,
			2,
		)}\n`,
		{ mode: 0o644 },
	);
	try {
		execFileSync(process.execPath, ["--experimental-sea-config", path.basename(config)], { cwd: work, stdio: "pipe" });
	} catch {
		fail("worker_native_blob_failed", "Native worker SEA blob could not be created.");
	}
}

function copyRuntime({ artifactPath }: { artifactPath: string }): void {
	copyFileSync(process.execPath, artifactPath);
}

function injectBlob({
	artifactPath,
	blobPath,
	platform,
	postjectCli,
}: {
	artifactPath: string;
	blobPath: string;
	platform: string;
	postjectCli: string;
}): void {
	const machoArguments = platform.startsWith("darwin-") ? ["--macho-segment-name", "NODE_SEA"] : [];
	try {
		execFileSync(
			process.execPath,
			[postjectCli, artifactPath, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", SEA_FUSE, "--overwrite", ...machoArguments],
			{ stdio: "pipe" },
		);
	} catch {
		fail("worker_native_injection_failed", "Native worker SEA blob could not be injected.");
	}
}

// Mach-O binaries must drop the runtime's original signature before postject
// injection and carry at least an ad-hoc signature to execute on arm64 macOS.
function removeMachoSignature({ artifactPath }: { artifactPath: string }): void {
	try {
		execFileSync("codesign", ["--remove-signature", artifactPath], { stdio: "pipe" });
	} catch {
		fail("worker_native_signature_failed", "Native worker artifact signature could not be removed before injection.");
	}
}

function signMachoAdhoc({ artifactPath }: { artifactPath: string }): void {
	try {
		execFileSync("codesign", ["--force", "--sign", "-", artifactPath], { stdio: "pipe" });
	} catch {
		fail("worker_native_signature_failed", "Native worker artifact could not be ad-hoc signed.");
	}
}

function smokeArtifact({ artifactPath, version, guide }: { artifactPath: string; version: string; guide: GuideBundle }): NativeSmoke {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-worker-native-smoke-home-"));
	const installedCommand = prepareManagedSmokeInstall(artifactPath, home, version);
	const run = (args: readonly string[]): string =>
		execFileSync(installedCommand, args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				HOME: home,
				CODEX_HOME: path.join(home, ".codex"),
				CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
			},
		});
	try {
		const identity = asJsonRecord(parse(run(["version"])));
		const commands = asJsonRecord(parse(run(["commands"])));
		const help = run(["--help"]);
		const guideStatus = asJsonRecord(parse(run(["guide", "status"])));
		const guideRegistration = asJsonRecord(parse(run(["guide", "register", "codex"])));
		const names = Array.isArray(commands?.commands)
			? commands.commands.map((entry) => asJsonRecord(entry)?.name).filter((entry): entry is string => typeof entry === "string")
			: [];
		if (
			identity?.command !== "ceal" ||
			identity?.version !== version ||
			guideStatus?.status !== "available" ||
			guideRegistration?.status !== "available" ||
			!findRegisteredCodexHost(guideRegistration) ||
			!/^Usage: ceal (?:\[[^\]\n]+\] )*<command> \[options\]$/mu.test(help) ||
			REQUIRED_COMMANDS.some((name) => !names.includes(name)) ||
			names.includes("cealctl")
		) {
			fail("worker_native_smoke_failed", "Native worker artifact did not expose the expected worker-only command surface.");
		}
		const guidePath = guideRegistration?.guide_path;
		if (typeof guidePath !== "string") fail("worker_native_smoke_failed", "Native worker artifact did not expose its registered guide path.");
		for (const file of guide.files) {
			const materialized = path.join(guidePath, ...file.path.split("/"));
			if (!existsSync(materialized) || sha256(readFileSync(materialized)) !== file.sha256)
				fail("worker_native_smoke_failed", "Native worker artifact did not materialize its complete signed guide directory.");
		}
		return {
			command: "ceal",
			version,
			help: true,
			required_commands: [...REQUIRED_COMMANDS],
			operator_surface_absent: true,
			embedded_guide_sha256: guide.sha256,
			guide_registration: true,
		};
	} catch (error) {
		if (error instanceof WorkerNativeArtifactError) throw error;
		fail("worker_native_smoke_failed", "Native worker artifact could not run its worker-only smoke checks.");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

function prepareManagedSmokeInstall(artifactPath: string, home: string, version: string): string {
	const platform = /^ceal-((?:linux|darwin)-(?:arm64|amd64))$/u.exec(path.basename(artifactPath))?.[1];
	if (!platform) fail("worker_native_smoke_failed", "Native worker artifact has an invalid platform name.");
	const install = path.join(home, "install");
	const worker = path.join(install, ".ceal-cli", "worker");
	const installer = Buffer.from("#!/bin/sh\nexit 0\n");
	const artifact = readFileSync(artifactPath);
	const commandName = path.basename(artifactPath);
	const inventory = Buffer.from(`${sha256(artifact)}  ${commandName}\n${sha256(installer)}  install-ceal.sh\n`);
	const generationId = `${version}-${platform}-${sha256(inventory)}`;
	const generation = path.join(worker, "releases", generationId);
	mkdirSync(generation, { recursive: true, mode: 0o700 });
	writeFileSync(path.join(generation, commandName), artifact, { mode: 0o755 });
	writeFileSync(path.join(generation, "install-ceal.sh"), installer, { mode: 0o755 });
	writeFileSync(path.join(generation, "SHA256SUMS"), inventory, { mode: 0o644 });
	symlinkSync(path.join("releases", generationId), path.join(worker, "current"));
	symlinkSync(path.join(".ceal-cli", "worker", "current", commandName), path.join(install, "ceal"));
	return path.join(install, "ceal");
}

function findRegisteredCodexHost(value: JsonRecord | undefined): boolean {
	const hosts = value?.hosts;
	if (!Array.isArray(hosts)) return false;
	return hosts.some((host) => {
		const record = asJsonRecord(host);
		return record?.agent === "codex" && record.registered === true;
	});
}

function materializeOutput({
	output,
	repoRoot,
	inputs,
	guide,
	version,
	platform,
	artifact,
	client,
	privateCarrierContract,
	privateControlSessionContract,
	privateCarrierHandoff,
}: {
	output: NativeOutput;
	repoRoot: string;
	inputs: NativeInputs;
	guide: GuideBundle;
	version: string;
	platform: string;
	artifact: NativeArtifact;
	client: PackedConsumer["client"];
	privateCarrierContract: unknown;
	privateControlSessionContract: unknown;
	privateCarrierHandoff: unknown;
}): OutputManifest {
	const staging = mkdtempSync(path.join(path.dirname(output.directory), `.${path.basename(output.directory)}.ceal-worker-native-`));
	try {
		writeFileSync(path.join(staging, MARKER), "ceal worker native artifact output\n", { mode: 0o644 });
		copyFileSync(artifact.path, path.join(staging, artifact.name));
		chmodSync(path.join(staging, artifact.name), 0o755);
		const compatibilityGuide = readFileSync(path.join(repoRoot, inputs.guide.compatibility_source_path));
		const notice = readFileSync(path.join(repoRoot, NOTICE_FILENAME));
		writeFileSync(path.join(staging, inputs.guide.compatibility_asset), compatibilityGuide, { mode: 0o644 });
		writeFileSync(path.join(staging, NOTICE_FILENAME), notice, { mode: 0o644 });
		const manifest = {
			schema_version: "ceal.worker_native_artifact_manifest.v1",
			status: "local_candidate_not_published",
			version,
			platform,
			artifact: { name: artifact.name, bytes: artifact.bytes, sha256: artifact.sha256 },
			client,
			guide: {
				name: inputs.guide.embedded_asset,
				format: inputs.guide.format,
				bytes: guide.bytes.length,
				sha256: guide.sha256,
				files: guide.files,
			},
			compatibility_guide: {
				name: inputs.guide.compatibility_asset,
				bytes: compatibilityGuide.length,
				sha256: sha256(compatibilityGuide),
			},
			third_party_notices: { name: NOTICE_FILENAME, bytes: notice.length, sha256: sha256(notice) },
			protocol: inputs.protocol,
			private_leased_consumer_carrier: privateCarrierContract,
			private_leased_consumer_control_session: privateControlSessionContract,
			private_leased_consumer_handoff: privateCarrierHandoff,
			handoff: inputs.handoff,
			consumer_smoke: { installed_from_packed_archives: true, source_or_workspace_fallback_used: false },
			native_smoke: artifact.smoke,
			non_claims: ["This is a local unsigned native worker artifact candidate, not a signed release or installation."],
		};
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
		writeFileSync(path.join(staging, MANIFEST_FILENAME), manifestBytes, { mode: 0o644 });
		const entries = [
			{ name: artifact.name, sha256: artifact.sha256 },
			{ name: inputs.guide.compatibility_asset, sha256: sha256(compatibilityGuide) },
			{ name: NOTICE_FILENAME, sha256: sha256(notice) },
			{ name: MANIFEST_FILENAME, sha256: sha256(manifestBytes) },
		].sort((left, right) => left.name.localeCompare(right.name));
		writeFileSync(path.join(staging, "SHA256SUMS"), entries.map((entry) => `${entry.sha256}  ${entry.name}`).join("\n") + "\n", {
			mode: 0o644,
		});
		publishOutputDirectory(staging, output);
		return { embedded: manifest.guide, compatibility: manifest.compatibility_guide };
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
}

function resolvePlatform(value: string | undefined, dependencies: NativeDependencies): string {
	const current = (dependencies.currentPlatform ?? currentPlatform)();
	if (!/^(?:linux|darwin)-(?:arm64|amd64)$/u.test(current))
		fail("unsupported_platform", "Native worker artifacts require a supported Linux or macOS host platform.");
	if (value !== undefined && value !== current) fail("platform_mismatch", "Native worker artifacts must be built on their target platform.");
	return current;
}

function currentPlatform() {
	const architecture = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : process.arch;
	return `${process.platform}-${architecture}`;
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

function fail(code: string, message: string): never {
	throw new WorkerNativeArtifactError(code, message);
}

const readJson = createJsonReader(fail, "Worker native artifact input JSON is invalid.");

function parseArgs(argv: readonly string[]): { help: boolean; json: boolean; options: NativeOptions } {
	const parsed = parseScriptArgs(argv, {
		fail,
		defaults: { force: false },
		flags: { "--force": "force" },
		values: { "--out": "outputDirectory", "--platform": "platform", "--gateway-handoff-archive": "gatewayHandoffArchive" },
		valueMessage: "Native worker artifact option requires a value.",
		unknownMessage: "Unexpected native worker artifact argument.",
	});
	const options: NativeOptions = { force: parsed.options.force === true };
	for (const [key, value] of Object.entries(parsed.options)) {
		if (key === "force") continue;
		if (
			key === "repoRoot" ||
			key === "inventoryPath" ||
			key === "outputDirectory" ||
			key === "platform" ||
			key === "gatewayHandoffArchive" ||
			key === "protocolTarball" ||
			key === "protocolProvenance" ||
			key === "controlConformance" ||
			key === "handoffManifest" ||
			key === "expectedHandoffSha256"
		) {
			if (typeof value === "string") options[key] = value;
		}
	}
	return { help: parsed.help, json: parsed.json, options };
}

export async function runCli(argv: readonly string[], io: Pick<Console, "log" | "error"> = console): Promise<number> {
	const json = argv.includes("--json");
	try {
		const parsed = parseArgs(argv);
		if (parsed.help) {
			io.log(
				"usage: node scripts/build-worker-native-artifact.ts --out <absolute-dir> --gateway-handoff-archive <absolute-tar.gz> [--platform <current-platform>] [--force] [--json]",
			);
			return 0;
		}
		const result = await buildWorkerNativeArtifact(parsed.options);
		io.log(parsed.json ? JSON.stringify(result, null, 2) : `Built native worker artifact ${result.version} for ${result.platform}.`);
		return 0;
	} catch (error) {
		const known = error instanceof WorkerNativeArtifactError;
		const payload = {
			schema_version: "ceal.worker_native_artifact_build_error.v1",
			ok: false,
			error_code: known ? error.code : "worker_native_artifact_build_failed",
			message: known ? error.message : "Could not build native worker artifact.",
		};
		if (json) io.log(JSON.stringify(payload));
		else io.error(payload.message);
		return 2;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	process.exitCode = await runCli(process.argv.slice(2));
