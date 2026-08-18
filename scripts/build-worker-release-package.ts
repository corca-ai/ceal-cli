#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "../packages/ceal-worker-cli/src/sha256.ts";
import { codedErrorClass } from "./lib/coded-error.ts";
import { asJsonRecord } from "./lib/json-record.ts";
import { parseNpmPackMetadata } from "./lib/npm-pack-metadata.ts";
import { inspectOutputDirectory, publishOutputDirectory } from "./lib/output-directory.ts";
import { resolvePackageBin } from "./lib/package-bin.ts";
import { parseScriptArgs } from "./lib/parse-script-args.ts";
import { isRegularNonSymlinkDirectory } from "./lib/regular-directory.ts";
import { resolveMatchingWorkerClientVersion } from "./lib/release-version.ts";
import { createSkillDirectoryBundle } from "./lib/skill-directory-bundle.ts";
import { toolchainEnv } from "./lib/toolchain-env.ts";
import { PROJECT_STAGED_WORKER_CONTROL_SESSION_PATH } from "./project-staged-worker-control-session.ts";
import { WorkerReleaseInputError, withWorkerReleaseDevelopmentInputs, withWorkerReleaseInputs } from "./worker-release-inputs.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = ".ceal-worker-release-package";
const MANIFEST_FILENAME = "ceal-worker-release-package-manifest.json";
const NOTICE_FILENAME = "THIRD_PARTY_NOTICES.txt";
// These trees are deliberately omitted by `stageOwnedPackage`. Validate the
// bytes that can enter the staged package, while allowing npm's workspace
// `.bin` links to exist in the checkout that supplies them.
const OMITTED_OWNED_PACKAGE_DIRECTORIES = Object.freeze(["dist", "node_modules"]);
type ReleaseOptions = {
	repoRoot?: string;
	outputDirectory?: string;
	force?: boolean;
	gatewayHandoffArchive?: string;
	protocolTarball?: string;
};
type PackageIdentity = { package: string; source_path: string; command?: string };
type ReleaseInputs = {
	worker: PackageIdentity;
	client: PackageIdentity;
	guide: { source_path: string; embedded_asset: string; format: string };
	protocol: { package: string; producer: { protocol_tree: string }; [key: string]: unknown };
	trust_anchor?: { kind: string; gateway_tag?: string; gateway_commit?: string; archive_sha256?: string };
};
type RawInputs = { protocolTarball: string; controlConformance: string };
type PackResult = { status: number | null; stdout: string | Buffer };
type ReleaseDependencies = {
	runCompiler?: (file: string, args: readonly string[], options: { cwd: string; stdio: "pipe"; env: NodeJS.ProcessEnv }) => void;
	projectControlSession?: (file: string, args: readonly string[], options: { stdio: "pipe" }) => void;
	pack?: (
		command: string,
		args: readonly string[],
		options: { cwd: string; encoding: "utf8"; stdio?: "pipe"; maxBuffer: number; env: NodeJS.ProcessEnv },
	) => PackResult;
	runConsumer?: (
		file: string,
		args: readonly string[],
		options: { cwd: string; encoding: "utf8"; stdio: readonly ["ignore", "pipe", "pipe"]; env: NodeJS.ProcessEnv },
	) => string;
};
type PackedPackage = { path: string; filename: string; bytes: number; sha256: string; package: string; version: string };
type Consumer = { directory: string; workerBin: string };
type OutputDirectory = { directory: string; force: boolean };
type ResolveInputs = typeof withWorkerReleaseInputs;

export const WorkerReleasePackageError = codedErrorClass("WorkerReleasePackageError");

export function buildWorkerReleasePackage(options: ReleaseOptions = {}, dependencies: ReleaseDependencies = {}) {
	return buildWorkerReleasePackageWithInputs(options, dependencies, withWorkerReleaseInputs);
}

/**
 * The development-input twin of the function above, for suites that must build a
 * release package without the real release inventory. No lane calls it.
 *
 * @testOnly
 */
export function buildWorkerReleasePackageFromDevelopmentInputs(options: ReleaseOptions = {}, dependencies: ReleaseDependencies = {}) {
	return buildWorkerReleasePackageWithInputs(options, dependencies, withWorkerReleaseDevelopmentInputs);
}

function buildWorkerReleasePackageWithInputs(options: ReleaseOptions, dependencies: ReleaseDependencies, resolveInputs: ResolveInputs) {
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	const output = inspectOutputDirectory(options.outputDirectory, {
		repoRoot,
		force: options.force === true,
		subject: "Worker package output",
		marker: MARKER,
		fail,
	});
	try {
		return Reflect.apply(resolveInputs, undefined, [
			{ ...options, repoRoot },
			({ inputs, rawInputs }: { inputs: ReleaseInputs; rawInputs: RawInputs }) => {
				const stage = mkdtempSync(path.join(tmpdir(), "ceal-worker-release-package-"));
				try {
					const packed = prepareWorkerReleaseConsumer({
						repoRoot,
						stage,
						inputs,
						protocolTarball: rawInputs.protocolTarball,
						controlConformance: rawInputs.controlConformance,
						dependencies,
					});
					const version = resolveMatchingWorkerClientVersion(repoRoot, [inputs.worker, inputs.client], readJson, fail);
					materializeOutput({ output, repoRoot, inputs, version, packed });
					return {
						schema_version: "ceal.worker_release_package_build.v1",
						ok: true,
						proof_level: "local_state",
						writes_external: false,
						output_dir: output.directory,
						version,
						artifact: { name: packed.worker.name, bytes: packed.worker.bytes, sha256: packed.worker.sha256 },
						client: packed.client,
						consumer_smoke: packed.consumerSmoke,
						protocol: inputs.protocol,
						non_claims: [
							"This is a local packed worker-package proof, not a native binary, signature, tag, upload, installation, or Gateway action.",
							"No operator CLI, operator guide, Gateway protocol source, legacy installer, or composite release workflow was used as a worker-release input.",
						],
					};
				} finally {
					if (stage) rmSync(stage, { recursive: true, force: true });
				}
			},
			dependencies,
		]);
	} catch (error) {
		if (error instanceof WorkerReleasePackageError) throw error;
		if (error instanceof WorkerReleaseInputError) throw new WorkerReleasePackageError(error.code, error.message);
		throw new WorkerReleasePackageError("worker_package_build_failed", "Could not build the isolated worker package.");
	}
}

export function prepareWorkerReleaseConsumer({
	repoRoot,
	stage,
	inputs,
	protocolTarball,
	controlConformance,
	dependencies = {},
}: {
	repoRoot: string;
	stage: string;
	inputs: ReleaseInputs;
	protocolTarball: string;
	controlConformance: string;
	dependencies?: ReleaseDependencies;
}) {
	const packageRoot = path.join(stage, "packages");
	const clientStage = stageOwnedPackage(repoRoot, packageRoot, inputs.client.source_path);
	const workerStage = stageOwnedPackage(repoRoot, packageRoot, inputs.worker.source_path);
	const dependencyRoot = path.join(stage, "node_modules");
	stageRuntimeDependencies(repoRoot, dependencyRoot);
	stagePackedPackage(protocolTarball, dependencyRoot, inputs.protocol.package);
	compilePackage(clientStage, dependencyRoot, dependencies);
	const packedClient = packPackage(clientStage, path.join(stage, "packed"), dependencies);
	if (packedClient.package !== inputs.client.package)
		fail("worker_package_pack_failed", "Packed client identity does not match the worker release inventory.");
	stagePackedPackage(packedClient.path, dependencyRoot, inputs.client.package);
	projectWorkerControlSession({ workerStage, dependencyRoot, inputs, controlConformance, dependencies });
	compilePackage(workerStage, dependencyRoot, dependencies);
	const packedWorker = packPackage(workerStage, path.join(stage, "packed"), dependencies);
	if (packedWorker.package !== inputs.worker.package)
		fail("worker_package_pack_failed", "Packed worker identity does not match the worker release inventory.");
	const consumer = stagePackedWorkerConsumer({
		stage,
		dependencyRoot,
		packedClient: packedClient.path,
		packedWorker: packedWorker.path,
		inputs,
	});
	const consumerSmoke = smokeInstalledWorker({ consumer, dependencies });
	const controlSessionBytes = readFileSync(path.join(workerStage, "leased-consumer-control-session-contract.json"));
	return {
		worker: { name: packedWorker.filename, bytes: packedWorker.bytes, sha256: packedWorker.sha256, path: packedWorker.path },
		client: {
			package: packedClient.package,
			version: packedClient.version,
			filename: packedClient.filename,
			bytes: packedClient.bytes,
			sha256: packedClient.sha256,
		},
		consumerSmoke,
		consumer,
		controlSessionContract: {
			contract: JSON.parse(controlSessionBytes.toString("utf8")),
			sha256: sha256(controlSessionBytes),
		},
	};
}

function projectWorkerControlSession({
	workerStage,
	dependencyRoot,
	inputs,
	controlConformance,
	dependencies,
}: {
	workerStage: string;
	dependencyRoot: string;
	inputs: ReleaseInputs;
	controlConformance: string;
	dependencies: ReleaseDependencies;
}): void {
	if (inputs.trust_anchor?.kind !== "reviewed_gateway_handoff_lock") return;
	const protocolModule = path.join(dependencyRoot, ...inputs.protocol.package.split("/"), "dist/index.js");
	const handoff = {
		gateway_tag: inputs.trust_anchor.gateway_tag,
		gateway_commit: inputs.trust_anchor.gateway_commit,
		protocol_tree: inputs.protocol.producer.protocol_tree,
		archive_sha256: inputs.trust_anchor.archive_sha256,
	};
	try {
		(dependencies.projectControlSession ?? execFileSync)(
			process.execPath,
			[PROJECT_STAGED_WORKER_CONTROL_SESSION_PATH, workerStage, protocolModule, controlConformance, JSON.stringify(handoff)],
			{ stdio: "pipe" },
		);
	} catch {
		fail(
			"control_conformance_projection_failed",
			"Worker control-session contract could not be projected from the reviewed Gateway archive.",
		);
	}
}

function stageOwnedPackage(repoRoot: string, packageRoot: string, relativePath: string): string {
	const source = path.join(repoRoot, relativePath);
	assertRegularTree(source, "unsafe_owned_source", OMITTED_OWNED_PACKAGE_DIRECTORIES);
	const destination = path.join(packageRoot, path.basename(relativePath));
	cpSync(source, destination, {
		recursive: true,
		dereference: false,
		filter: (entry) => path.basename(entry) !== "dist" && path.basename(entry) !== "node_modules",
	});
	return destination;
}

function stageRuntimeDependencies(repoRoot: string, dependencyRoot: string): void {
	const pending = ["typescript", "yaml", "undici-types", "@types/node"];
	const staged = new Set<string>();
	while (pending.length > 0) {
		const name = pending.shift();
		if (name === undefined || staged.has(name)) continue;
		assertPackageName(name, "missing_build_dependency");
		const source = containedPath(path.join(repoRoot, "node_modules"), name, "missing_build_dependency");
		assertRegularTree(source, "missing_build_dependency");
		const destination = containedPath(dependencyRoot, name, "missing_build_dependency");
		mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
		cpSync(source, destination, { recursive: true, dereference: false });
		staged.add(name);
		const packageJson = asJsonRecord(readJsonFile(path.join(source, "package.json")));
		if (!packageJson) fail("missing_build_dependency", "Staged build dependency metadata is invalid.");
		const rawDependencies = packageJson.dependencies;
		if (rawDependencies !== undefined && !asJsonRecord(rawDependencies))
			fail("missing_build_dependency", "Staged build dependency metadata has malformed dependencies.");
		for (const [dependency, version] of Object.entries(asJsonRecord(rawDependencies) ?? {})) {
			assertPackageName(dependency, "missing_build_dependency");
			if (typeof version !== "string" || version.length === 0)
				fail("missing_build_dependency", "Staged build dependency metadata has malformed dependency versions.");
			if (!staged.has(dependency)) pending.push(dependency);
		}
	}
}

function assertPackageName(name: string, code: string): void {
	const parts = name.split("/");
	const valid =
		name.length > 0 &&
		!path.isAbsolute(name) &&
		!name.includes("\\") &&
		parts.every((part) => part.length > 0 && part !== "." && part !== "..") &&
		(parts.length === 1 || (parts.length === 2 && parts[0].startsWith("@") && parts[0].length > 1));
	if (!valid) fail(code, "Worker dependency name is not a safe npm package name.");
}

function containedPath(root: string, relative: string, code: string): string {
	const candidate = path.resolve(root, ...relative.split("/"));
	const rootPath = path.resolve(root);
	const relation = path.relative(rootPath, candidate);
	if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation))
		fail(code, "Worker release path escapes its staging root.");
	return candidate;
}

function readJsonFile(file: string): unknown {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		fail("missing_build_dependency", "Staged build dependency metadata is invalid.");
	}
}

function stagePackedPackage(tarball: string, dependencyRoot: string, packageName: string): void {
	if (typeof tarball !== "string" || !existsSync(tarball) || !lstatSync(tarball).isFile() || lstatSync(tarball).isSymbolicLink()) {
		fail("invalid_packed_dependency", "Packed worker dependency must be a regular tarball.");
	}
	const extraction = mkdtempSync(path.join(tmpdir(), "ceal-worker-release-extract-"));
	try {
		assertArchiveMembers(tarball);
		execFileSync("tar", ["-xzf", tarball, "-C", extraction], { stdio: "pipe" });
		const source = path.join(extraction, "package");
		assertRegularTree(source, "invalid_packed_dependency");
		assertPackageName(packageName, "invalid_packed_dependency");
		const destination = containedPath(dependencyRoot, packageName, "invalid_packed_dependency");
		if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
		mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
		renameSync(source, destination);
	} catch (error) {
		if (error instanceof WorkerReleasePackageError) throw error;
		fail("invalid_packed_dependency", "Packed worker dependency could not be installed.");
	} finally {
		rmSync(extraction, { recursive: true, force: true });
	}
}

function assertArchiveMembers(tarball: string): void {
	let members: string[] = [];
	try {
		members = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
			.trim()
			.split("\n")
			.filter(Boolean);
	} catch {
		fail("invalid_packed_dependency", "Packed worker dependency is not a readable archive.");
	}
	if (
		members.length === 0 ||
		members.some(
			(member) => !member.startsWith("package/") || member.includes("\\") || member.split("/").some((part) => part === "." || part === ".."),
		)
	) {
		fail("invalid_packed_dependency", "Packed worker dependency contains an unsafe archive path.");
	}
	let listing: string[] = [];
	try {
		listing = execFileSync("tar", ["-tvzf", tarball], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
			.trim()
			.split("\n")
			.filter(Boolean);
	} catch {
		fail("invalid_packed_dependency", "Packed worker dependency cannot be safely inspected.");
	}
	if (listing.length !== members.length || listing.some((line) => !/^[d-]/u.test(line))) {
		fail("invalid_packed_dependency", "Packed worker dependency may contain links or non-regular entries.");
	}
}

function compilePackage(packageDirectory: string, dependencyRoot: string, dependencies: ReleaseDependencies): void {
	const compiler = resolveTypeScriptCompiler(dependencyRoot);
	try {
		(dependencies.runCompiler ?? execFileSync)(
			process.execPath,
			[compiler, "-p", "tsconfig.build.json", "--typeRoots", path.join(dependencyRoot, "@types"), "--types", "node"],
			{
				cwd: packageDirectory,
				stdio: "pipe",
				env: toolchainEnv(),
			},
		);
	} catch (error) {
		// The bare message named a source defect for every way tsc can fail,
		// including the ways that are not about the source at all — an OOM kill or
		// a missing compiler read as "your TypeScript does not compile", and cost a
		// re-run to find out otherwise. tsc writes its diagnostics to stdout, so
		// carry both streams and the signal.
		fail(
			"worker_package_build_failed",
			`Worker-owned TypeScript source did not compile against the supplied Protocol artifact.${compilerDiagnosis(error)}`,
		);
	}
}

function resolveTypeScriptCompiler(dependencyRoot: string): string {
	try {
		return resolvePackageBin(path.join(dependencyRoot, "typescript"));
	} catch {
		fail("missing_build_dependency", "Staged TypeScript dependency does not declare a safe compiler entrypoint.");
	}
}

// `execFileSync` attaches the captured streams and the terminating signal to the
// thrown error; a stubbed compiler may attach neither, so every part is optional.
function compilerDiagnosis(error: unknown): string {
	const record = asJsonRecord(error);
	if (!record) return "";
	const streams = [record.stdout, record.stderr]
		.map((stream) => (stream === undefined || stream === null ? "" : String(stream).trim()))
		.filter((text) => text.length > 0)
		.join("\n");
	const signal = typeof record.signal === "string" && record.signal ? ` (compiler terminated by ${record.signal})` : "";
	return streams.length > 0 ? `${signal} Compiler output: ${streams.slice(0, 4000)}` : signal;
}

function packPackage(packageDirectory: string, outputDirectory: string, dependencies: ReleaseDependencies): PackedPackage {
	mkdirSync(outputDirectory, { recursive: true, mode: 0o755 });
	let output: PackResult | undefined;
	try {
		output = (dependencies.pack ?? spawnSync)("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", outputDirectory], {
			cwd: packageDirectory,
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
			env: toolchainEnv(),
		});
	} catch {
		fail("worker_package_pack_failed", "Worker-owned package could not be packed.");
	}
	if (output?.status !== 0) fail("worker_package_pack_failed", "Worker-owned package could not be packed.");
	let metadata: ReturnType<typeof parseNpmPackMetadata> | undefined;
	try {
		metadata = parseNpmPackMetadata(JSON.parse(String(output.stdout)));
	} catch {
		fail("worker_package_pack_failed", "Worker package metadata is invalid.");
	}
	if (!metadata || typeof metadata.filename !== "string" || typeof metadata.name !== "string")
		fail("worker_package_pack_failed", "Worker package metadata is invalid.");
	const artifact = path.join(outputDirectory, metadata.filename);
	if (!existsSync(artifact) || !lstatSync(artifact).isFile() || lstatSync(artifact).isSymbolicLink())
		fail("worker_package_pack_failed", "Worker package output is unsafe.");
	const bytes = readFileSync(artifact);
	return {
		path: artifact,
		filename: metadata.filename,
		bytes: bytes.length,
		sha256: sha256(bytes),
		package: metadata.name,
		version: metadata.version,
	};
}

function stagePackedWorkerConsumer({
	stage,
	dependencyRoot,
	packedClient,
	packedWorker,
	inputs,
}: {
	stage: string;
	dependencyRoot: string;
	packedClient: string;
	packedWorker: string;
	inputs: ReleaseInputs;
}): Consumer {
	const directory = path.join(stage, "consumer");
	const modules = path.join(directory, "node_modules");
	mkdirSync(modules, { recursive: true, mode: 0o755 });
	for (const name of ["yaml", inputs.protocol.package]) stageInstalledDependency(dependencyRoot, modules, name);
	stagePackedPackage(packedClient, modules, inputs.client.package);
	stagePackedPackage(packedWorker, modules, inputs.worker.package);
	const workerBin = path.join(modules, ...inputs.worker.package.split("/"), "dist", "bin.js");
	if (!existsSync(workerBin) || lstatSync(workerBin).isSymbolicLink())
		fail("consumer_smoke_failed", "Installed worker package did not expose its declared command.");
	return { directory, workerBin };
}

function smokeInstalledWorker({ consumer, dependencies }: { consumer: Consumer; dependencies: ReleaseDependencies }): {
	command: string;
	installed_from_packed_archives: true;
	source_or_workspace_fallback_used: false;
} {
	let output = "";
	try {
		const runConsumer = dependencies.runConsumer;
		output = runConsumer
			? runConsumer(process.execPath, [consumer.workerBin, "commands"], {
					cwd: consumer.directory,
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
					env: { ...process.env, HOME: path.join(consumer.directory, "home") },
				})
			: String(
					execFileSync(process.execPath, [consumer.workerBin, "commands"], {
						cwd: consumer.directory,
						encoding: "utf8",
						stdio: ["ignore", "pipe", "pipe"],
						env: { ...process.env, HOME: path.join(consumer.directory, "home") },
					}),
				);
	} catch {
		fail("consumer_smoke_failed", "Installed packed worker command could not run.");
	}
	if (!/command: ceal\n/u.test(output) || !/name: capabilities\n/u.test(output) || /cealctl/u.test(output)) {
		fail("consumer_smoke_failed", "Installed packed worker command did not expose the expected worker-only surface.");
	}
	return { command: "ceal", installed_from_packed_archives: true, source_or_workspace_fallback_used: false };
}

function stageInstalledDependency(sourceRoot: string, destinationRoot: string, packageName: string): void {
	assertPackageName(packageName, "missing_runtime_dependency");
	const source = containedPath(sourceRoot, packageName, "missing_runtime_dependency");
	assertRegularTree(source, "missing_runtime_dependency");
	const destination = containedPath(destinationRoot, packageName, "missing_runtime_dependency");
	mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
	cpSync(source, destination, { recursive: true, dereference: false });
}

function materializeOutput({
	output,
	repoRoot,
	inputs,
	version,
	packed,
}: {
	output: OutputDirectory;
	repoRoot: string;
	inputs: ReleaseInputs;
	version: string;
	packed: ReturnType<typeof prepareWorkerReleaseConsumer>;
}): void {
	const staging = mkdtempSync(path.join(path.dirname(output.directory), `.${path.basename(output.directory)}.ceal-worker-package-`));
	try {
		writeFileSync(path.join(staging, MARKER), "ceal worker release package output\n", { mode: 0o644 });
		const artifactPath = path.join(staging, packed.worker.name);
		cpSync(packed.worker.path, artifactPath, { dereference: false });
		const guide = createSkillDirectoryBundle(path.join(repoRoot, inputs.guide.source_path));
		const notice = readFileSync(path.join(repoRoot, NOTICE_FILENAME), "utf8");
		writeFileSync(path.join(staging, inputs.guide.embedded_asset), guide.bytes, { mode: 0o644 });
		writeFileSync(path.join(staging, NOTICE_FILENAME), notice, { mode: 0o644 });
		const manifest = {
			schema_version: "ceal.worker_release_package_manifest.v1",
			status: "local_candidate_not_published",
			version,
			artifact: { name: packed.worker.name, bytes: packed.worker.bytes, sha256: packed.worker.sha256 },
			client: packed.client,
			guide: {
				name: inputs.guide.embedded_asset,
				format: inputs.guide.format,
				bytes: guide.bytes.length,
				sha256: guide.sha256,
				files: guide.files,
			},
			third_party_notices: { name: NOTICE_FILENAME, bytes: notice.length, sha256: sha256(notice) },
			protocol: inputs.protocol,
			consumer_smoke: packed.consumerSmoke,
			non_claims: ["This is a local packed worker-package candidate, not a signed native CLI release or installation."],
		};
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
		writeFileSync(path.join(staging, MANIFEST_FILENAME), manifestBytes, { mode: 0o644 });
		const checksumEntries = [
			{ name: packed.worker.name, sha256: packed.worker.sha256 },
			{ name: inputs.guide.embedded_asset, sha256: guide.sha256 },
			{ name: NOTICE_FILENAME, sha256: sha256(notice) },
			{ name: MANIFEST_FILENAME, sha256: sha256(manifestBytes) },
		].sort((left, right) => left.name.localeCompare(right.name));
		writeFileSync(path.join(staging, "SHA256SUMS"), checksumEntries.map((entry) => `${entry.sha256}  ${entry.name}`).join("\n") + "\n", {
			mode: 0o644,
		});
		publishOutputDirectory(staging, output);
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
}

function assertRegularTree(root: string, code: string, omittedDirectories: readonly string[] = []): void {
	if (!isRegularNonSymlinkDirectory(root)) fail(code, "Worker package input directory is unsafe.");
	for (const name of readdirSync(root)) {
		if (omittedDirectories.includes(name)) continue;
		const entry = path.join(root, name);
		const stat = lstatSync(entry);
		if (stat.isSymbolicLink()) fail(code, "Worker package input cannot contain symbolic links.");
		if (stat.isDirectory()) assertRegularTree(entry, code, omittedDirectories);
	}
}

function readJson(filePath: string, code: string): unknown {
	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		fail(code, "Worker package input JSON is invalid.");
	}
}

function fail(code: string, message: string): never {
	throw new WorkerReleasePackageError(code, message);
}

function parseArgs(argv: readonly string[]): ReturnType<typeof parseScriptArgs> {
	return parseScriptArgs(argv, {
		fail,
		defaults: { force: false },
		flags: { "--force": "force" },
		values: { "--out": "outputDirectory", "--gateway-handoff-archive": "gatewayHandoffArchive" },
		valueMessage: "Worker package option requires a value.",
		unknownMessage: "Unexpected worker package build argument.",
	});
}

export function runCli(argv: readonly string[], io: Pick<Console, "log" | "error"> = console): number {
	const json = argv.includes("--json");
	try {
		const parsed = parseArgs(argv);
		if (parsed.help) {
			io.log(
				"usage: node scripts/build-worker-release-package.ts --out <absolute-dir> --gateway-handoff-archive <absolute-tar.gz> [--force] [--json]",
			);
			return 0;
		}
		const result = buildWorkerReleasePackage(parsed.options);
		io.log(parsed.json ? JSON.stringify(result, null, 2) : `Built worker package ${result.version}.`);
		return 0;
	} catch (error) {
		const known = error instanceof WorkerReleasePackageError;
		const payload = {
			schema_version: "ceal.worker_release_package_build_error.v1",
			ok: false,
			error_code: known ? error.code : "worker_package_build_failed",
			message: known ? error.message : "Could not build worker package.",
		};
		if (json) io.log(JSON.stringify(payload));
		else io.error(payload.message);
		return 2;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
