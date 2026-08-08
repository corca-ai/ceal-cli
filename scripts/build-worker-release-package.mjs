#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { codedErrorClass } from "./lib/coded-error.mjs";
import { parseScriptArgs } from "./lib/parse-script-args.mjs";
import { assertNoSymlinkComponents } from "./lib/safe-output-path.mjs";
import { WorkerReleaseInputError, withWorkerReleaseDevelopmentInputs, withWorkerReleaseInputs } from "./worker-release-inputs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = ".ceal-worker-release-package";
const MANIFEST_FILENAME = "ceal-worker-release-package-manifest.json";
const NOTICE_FILENAME = "THIRD_PARTY_NOTICES.txt";

export const WorkerReleasePackageError = codedErrorClass("WorkerReleasePackageError");

export function buildWorkerReleasePackage(options = {}, dependencies = {}) {
	return buildWorkerReleasePackageWithInputs(options, dependencies, withWorkerReleaseInputs);
}

/**
 * The development-input twin of the function above, for suites that must build a
 * release package without the real release inventory. No lane calls it.
 *
 * @testOnly
 */
export function buildWorkerReleasePackageFromDevelopmentInputs(options = {}, dependencies = {}) {
	return buildWorkerReleasePackageWithInputs(options, dependencies, withWorkerReleaseDevelopmentInputs);
}

function buildWorkerReleasePackageWithInputs(options, dependencies, resolveInputs) {
	const repoRoot = path.resolve(options.repoRoot ?? ROOT);
	const output = inspectOutput(options.outputDirectory, repoRoot, options.force === true);
	try {
		return resolveInputs(
			{ ...options, repoRoot },
			({ inputs, rawInputs }) => {
				let stage;
				try {
					stage = mkdtempSync(path.join(tmpdir(), "ceal-worker-release-package-"));
					const packed = prepareWorkerReleaseConsumer({ repoRoot, stage, inputs, protocolTarball: rawInputs.protocolTarball, dependencies });
					const version = resolveVersion(repoRoot, inputs);
					materializeOutput({ output, repoRoot, inputs, version, packed });
					return {
						schema_version: "ceal.worker_release_package_build.v1",
						ok: true,
						proof_level: "local_state",
						writes_external: false,
						output_dir: output.directory,
						version,
						artifact: { name: packed.worker.name, bytes: packed.worker.bytes, sha256: packed.worker.sha256 },
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
		);
	} catch (error) {
		if (error instanceof WorkerReleasePackageError) throw error;
		if (error instanceof WorkerReleaseInputError) throw new WorkerReleasePackageError(error.code, error.message);
		throw new WorkerReleasePackageError("worker_package_build_failed", "Could not build the isolated worker package.");
	}
}

export function prepareWorkerReleaseConsumer({ repoRoot, stage, inputs, protocolTarball, dependencies = {} }) {
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
	return {
		worker: { name: packedWorker.filename, bytes: packedWorker.bytes, sha256: packedWorker.sha256, path: packedWorker.path },
		consumerSmoke,
		consumer,
	};
}

function stageOwnedPackage(repoRoot, packageRoot, relativePath) {
	const source = path.join(repoRoot, relativePath);
	assertRegularTree(source, "unsafe_owned_source");
	const destination = path.join(packageRoot, path.basename(relativePath));
	cpSync(source, destination, {
		recursive: true,
		dereference: false,
		filter: (entry) => path.basename(entry) !== "dist" && path.basename(entry) !== "node_modules",
	});
	return destination;
}

function stageRuntimeDependencies(repoRoot, dependencyRoot) {
	for (const name of ["typescript", "yaml", "undici-types", "@types/node"]) {
		const source = path.join(repoRoot, "node_modules", ...name.split("/"));
		assertRegularTree(source, "missing_build_dependency");
		const destination = path.join(dependencyRoot, ...name.split("/"));
		mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
		cpSync(source, destination, { recursive: true, dereference: false });
	}
}

function stagePackedPackage(tarball, dependencyRoot, packageName) {
	if (typeof tarball !== "string" || !existsSync(tarball) || !lstatSync(tarball).isFile() || lstatSync(tarball).isSymbolicLink()) {
		fail("invalid_packed_dependency", "Packed worker dependency must be a regular tarball.");
	}
	const extraction = mkdtempSync(path.join(tmpdir(), "ceal-worker-release-extract-"));
	try {
		assertArchiveMembers(tarball);
		execFileSync("tar", ["-xzf", tarball, "-C", extraction], { stdio: "pipe" });
		const source = path.join(extraction, "package");
		assertRegularTree(source, "invalid_packed_dependency");
		const destination = path.join(dependencyRoot, ...packageName.split("/"));
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

function assertArchiveMembers(tarball) {
	let members;
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
	let listing;
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

function compilePackage(packageDirectory, dependencyRoot, dependencies) {
	const compiler = path.join(dependencyRoot, "typescript", "bin", "tsc");
	try {
		(dependencies.runCompiler ?? execFileSync)(process.execPath, [compiler, "-p", "tsconfig.build.json"], {
			cwd: packageDirectory,
			stdio: "pipe",
		});
	} catch {
		fail("worker_package_build_failed", "Worker-owned TypeScript source did not compile against the supplied Protocol artifact.");
	}
}

function packPackage(packageDirectory, outputDirectory, dependencies) {
	mkdirSync(outputDirectory, { recursive: true, mode: 0o755 });
	let output;
	try {
		output = (dependencies.pack ?? spawnSync)("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", outputDirectory], {
			cwd: packageDirectory,
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
		});
	} catch {
		fail("worker_package_pack_failed", "Worker-owned package could not be packed.");
	}
	if (output?.status !== 0) fail("worker_package_pack_failed", "Worker-owned package could not be packed.");
	let metadata;
	try {
		metadata = JSON.parse(output.stdout)?.[0];
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

function stagePackedWorkerConsumer({ stage, dependencyRoot, packedClient, packedWorker, inputs }) {
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

function smokeInstalledWorker({ consumer, dependencies }) {
	let output;
	try {
		output = (dependencies.runConsumer ?? execFileSync)(process.execPath, [consumer.workerBin, "commands"], {
			cwd: consumer.directory,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, HOME: path.join(consumer.directory, "home") },
		});
	} catch {
		fail("consumer_smoke_failed", "Installed packed worker command could not run.");
	}
	if (!/command: ceal\n/u.test(output) || !/name: capabilities\n/u.test(output) || /cealctl/u.test(output)) {
		fail("consumer_smoke_failed", "Installed packed worker command did not expose the expected worker-only surface.");
	}
	return { command: "ceal", installed_from_packed_archives: true, source_or_workspace_fallback_used: false };
}

function stageInstalledDependency(sourceRoot, destinationRoot, packageName) {
	const source = path.join(sourceRoot, ...packageName.split("/"));
	assertRegularTree(source, "missing_runtime_dependency");
	const destination = path.join(destinationRoot, ...packageName.split("/"));
	mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
	cpSync(source, destination, { recursive: true, dereference: false });
}

function materializeOutput({ output, repoRoot, inputs, version, packed }) {
	const staging = mkdtempSync(path.join(path.dirname(output.directory), `.${path.basename(output.directory)}.ceal-worker-package-`));
	try {
		writeFileSync(path.join(staging, MARKER), "ceal worker release package output\n", { mode: 0o644 });
		const artifactPath = path.join(staging, packed.worker.name);
		cpSync(packed.worker.path, artifactPath, { dereference: false });
		const guide = readFileSync(path.join(repoRoot, inputs.guide.source_path));
		const notice = readFileSync(path.join(repoRoot, NOTICE_FILENAME));
		writeFileSync(path.join(staging, inputs.guide.asset), guide, { mode: 0o644 });
		writeFileSync(path.join(staging, NOTICE_FILENAME), notice, { mode: 0o644 });
		const manifest = {
			schema_version: "ceal.worker_release_package_manifest.v1",
			status: "local_candidate_not_published",
			version,
			artifact: { name: packed.worker.name, bytes: packed.worker.bytes, sha256: packed.worker.sha256 },
			guide: { name: inputs.guide.asset, bytes: guide.length, sha256: sha256(guide) },
			third_party_notices: { name: NOTICE_FILENAME, bytes: notice.length, sha256: sha256(notice) },
			protocol: inputs.protocol,
			consumer_smoke: packed.consumerSmoke,
			non_claims: ["This is a local packed worker-package candidate, not a signed native CLI release or installation."],
		};
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
		writeFileSync(path.join(staging, MANIFEST_FILENAME), manifestBytes, { mode: 0o644 });
		const checksumEntries = [
			{ name: packed.worker.name, sha256: packed.worker.sha256 },
			{ name: inputs.guide.asset, sha256: sha256(guide) },
			{ name: NOTICE_FILENAME, sha256: sha256(notice) },
			{ name: MANIFEST_FILENAME, sha256: sha256(manifestBytes) },
		].sort((left, right) => left.name.localeCompare(right.name));
		writeFileSync(path.join(staging, "SHA256SUMS"), checksumEntries.map((entry) => `${entry.sha256}  ${entry.name}`).join("\n") + "\n", {
			mode: 0o644,
		});
		publishOutput(staging, output);
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
}

function resolveVersion(repoRoot, inputs) {
	// The worker release versions independently of the pinned Gateway Protocol
	// artifact: worker and client move together, while the exact protocol pin
	// is enforced against the supplied artifact by the release-input resolver.
	const versions = [inputs.worker, inputs.client].map(
		(entry) => readJson(path.join(repoRoot, entry.source_path, "package.json"), "invalid_inventory").version,
	);
	if (versions.some((value) => typeof value !== "string") || new Set(versions).size !== 1) {
		fail("version_mismatch", "Worker and client package versions must match exactly.");
	}
	return versions[0];
}

function inspectOutput(value, repoRoot, force) {
	if (typeof value !== "string" || !path.isAbsolute(value)) fail("invalid_output", "Worker package output must be an absolute directory.");
	const directory = path.resolve(value);
	if ([path.parse(directory).root, repoRoot, path.resolve(repoRoot, "..")].includes(directory))
		fail("unsafe_output", "Worker package output is too broad.");
	assertNoSymlinkComponents(directory, fail, "Worker package output");
	if (!existsSync(directory)) return { directory, force: false };
	if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
		fail("unsafe_output", "Worker package output must be a regular directory.");
	if (!force || !existsSync(path.join(directory, MARKER)) || lstatSync(path.join(directory, MARKER)).isSymbolicLink())
		fail("output_not_replaceable", "Use --force only with a marked worker package output.");
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

function assertRegularTree(root, code) {
	if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())
		fail(code, "Worker package input directory is unsafe.");
	for (const name of readdirSync(root)) {
		const entry = path.join(root, name);
		const stat = lstatSync(entry);
		if (stat.isSymbolicLink()) fail(code, "Worker package input cannot contain symbolic links.");
		if (stat.isDirectory()) assertRegularTree(entry, code);
	}
}

function readJson(filePath, code) {
	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		fail(code, "Worker package input JSON is invalid.");
	}
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
function fail(code, message) {
	throw new WorkerReleasePackageError(code, message);
}

function parseArgs(argv) {
	return parseScriptArgs(argv, {
		fail,
		defaults: { force: false },
		flags: { "--force": "force" },
		values: { "--out": "outputDirectory", "--gateway-handoff-archive": "gatewayHandoffArchive" },
		valueMessage: "Worker package option requires a value.",
		unknownMessage: "Unexpected worker package build argument.",
	});
}

export function runCli(argv, io = console) {
	const json = argv.includes("--json");
	try {
		const parsed = parseArgs(argv);
		if (parsed.help) {
			io.log(
				"usage: node scripts/build-worker-release-package.mjs --out <absolute-dir> --gateway-handoff-archive <absolute-tar.gz> [--force] [--json]",
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
