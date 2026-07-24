#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { parse } from "yaml";
import { verifyGatewayProtocolConsumer } from "./verify-gateway-protocol-consumer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRE = createRequire(import.meta.url);
const MARKER = ".ceal-worker-release-output";
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

export class WorkerReleaseArtifactError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "WorkerReleaseArtifactError";
		this.code = code;
	}
}

export async function buildWorkerReleaseArtifact(options = {}, deps = {}) {
	const normalized = normalizeOptions(options, deps);
	const proof = await verifyConsumer(normalized, deps);
	try {
		const workerVersion = requireWorkerSource(proof.workspace, normalized.version);
		prepareOutput(normalized.outputDirectory, normalized.force);
		const work = mkdtempSync(path.join(tmpdir(), "ceal-worker-release-bundle-"));
		try {
			const artifact = await buildArtifact({ normalized, proof, work, workerVersion, deps });
			const guide = copyGuide({ normalized, proof });
			const installer = copyInstaller({ normalized, proof });
			const notices = copyNotices(normalized);
			const manifest = writeManifest({ normalized, proof, artifact, guide, installer, notices, workerVersion });
			writeChecksums(normalized.outputDirectory, [artifact, guide, installer, notices, manifest]);
			return {
				schema_version: "ceal.worker_release_artifact_build.v1",
				ok: true,
				proof_level: "local_integration",
				writes_external: false,
				version: workerVersion,
				platform: normalized.platform,
				output_dir: normalized.outputDirectory,
				artifact,
				guide,
				installer,
				notices,
				manifest,
				checksums: { name: "SHA256SUMS", entry_count: 5 },
			};
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	} finally {
		if (proof.workspace) rmSync(proof.workspace, { recursive: true, force: true });
	}
}

function normalizeOptions(options, deps) {
	const platform = requirePlatform(options.platform ?? currentPlatform());
	if (platform !== (deps.currentPlatform ?? currentPlatform)()) fail("platform_mismatch", "Worker artifact must be built on its target platform.");
	return {
		force: options.force === true,
		outputDirectory: requireOutputDirectory(options.outputDirectory ?? options.out),
		platform,
		postjectCli: (deps.resolvePostjectCli ?? resolvePostjectCli)(),
		protocolProvenance: requireAbsoluteFile(options.protocolProvenance, "protocol_provenance_required"),
		protocolTarball: requireAbsoluteFile(options.protocolTarball, "protocol_tarball_required"),
		version: options.version,
	};
}

async function verifyConsumer(normalized, deps) {
	try {
		const proof = await (deps.verifyConsumer ?? verifyGatewayProtocolConsumer)({
			repoRoot: ROOT,
			protocolTarball: normalized.protocolTarball,
			protocolProvenance: normalized.protocolProvenance,
			keepWorkspace: true,
		});
		if (!proof?.ok || !proof.workspace || !path.isAbsolute(proof.workspace)) fail("consumer_proof_failed", "Worker artifact requires a successful isolated packed-consumer proof.");
		return proof;
	} catch (error) {
		cleanupFailedConsumerWorkspace(error?.workspace);
		if (error instanceof WorkerReleaseArtifactError) throw error;
		fail("consumer_proof_failed", "Worker artifact requires a successful isolated packed-consumer proof.");
	}
}

function cleanupFailedConsumerWorkspace(workspace) {
	if (typeof workspace !== "string" || !path.isAbsolute(workspace)) return;
	const resolved = path.resolve(workspace);
	// The workspace is canonicalized at creation, so compare against the
	// canonical temp root (macOS reports /var while realpath is /private/var).
	let canonicalTempRoot;
	try { canonicalTempRoot = realpathSync(tmpdir()); } catch { return; }
	if (path.dirname(resolved) !== canonicalTempRoot || !path.basename(resolved).startsWith("ceal-gateway-protocol-consumer-")) return;
	rmSync(resolved, { recursive: true, force: true });
}

function requireWorkerSource(workspace, requestedVersion) {
	const manifest = readJson(path.join(workspace, "sources", "ceal-worker-cli", "package.json"), "invalid_worker_source");
	if (manifest?.name !== "@corca-ai/ceal-worker-cli" || !isVersion(manifest.version) || manifest.bin?.ceal !== "./dist/bin.js") {
		fail("invalid_worker_source", "Packed consumer did not produce the declared worker CLI source.");
	}
	if (requestedVersion !== undefined && requestedVersion !== manifest.version) fail("version_mismatch", "Worker artifact version must match the isolated worker package.");
	return manifest.version;
}

async function buildArtifact({ normalized, proof, work, workerVersion, deps }) {
	const entry = path.join(proof.workspace, "sources", "ceal-worker-cli", "dist", "bin.js");
	if (!isRegularFile(entry)) fail("invalid_worker_source", "Isolated worker source did not build a CLI entrypoint.");
	const bundlePath = path.join(work, "ceal.cjs");
	await (deps.bundle ?? bundleWorker)({ entry, bundlePath });
	const blobPath = path.join(work, "ceal.blob");
	(deps.createBlob ?? createBlob)({ bundlePath, blobPath, work });
	const name = `ceal-${normalized.platform}`;
	const artifactPath = path.join(normalized.outputDirectory, name);
	(deps.copyRuntime ?? copyRuntime)({ artifactPath });
	chmodSync(artifactPath, 0o755);
	(deps.injectBlob ?? injectBlob)({ artifactPath, blobPath, postjectCli: normalized.postjectCli });
	const smoke = (deps.smoke ?? smokeArtifact)({ artifactPath, version: workerVersion });
	const bytes = readFileSync(artifactPath);
	return { name, bytes: bytes.length, sha256: sha256(bytes), smoke };
}

async function bundleWorker({ entry, bundlePath }) {
	await esbuild.build({ bundle: true, entryPoints: [entry], format: "cjs", logLevel: "silent", outfile: bundlePath, platform: "node", target: "node22" });
}

function createBlob({ bundlePath, blobPath, work }) {
	const config = path.join(work, "ceal.sea.json");
	writeFileSync(config, `${JSON.stringify({ main: path.basename(bundlePath), output: path.basename(blobPath), executable: process.execPath, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false, execArgvExtension: "none" }, null, 2)}\n`);
	execFileSync(process.execPath, ["--experimental-sea-config", path.basename(config)], { cwd: work, stdio: "pipe" });
}

function copyRuntime({ artifactPath }) { copyFileSync(process.execPath, artifactPath); }

function injectBlob({ artifactPath, blobPath, postjectCli }) {
	execFileSync(process.execPath, [postjectCli, artifactPath, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", SEA_FUSE, "--overwrite"], { stdio: "pipe" });
}

function smokeArtifact({ artifactPath, version }) {
	const smokeHome = mkdtempSync(path.join(tmpdir(), "ceal-worker-release-smoke-home-"));
	try {
		const result = parse(execFileSync(artifactPath, ["version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: smokeHome } }));
		if (result?.command !== "ceal" || result.version !== version) fail("smoke_failed", "Worker artifact identity did not match the isolated worker package.");
		return { ok: true, command: result.command, version: result.version };
	} finally {
		rmSync(smokeHome, { recursive: true, force: true });
	}
}

function copyGuide({ normalized, proof }) {
	const guide = proof.worker_release_inputs?.guide;
	if (guide !== "skills/ceal-guide/SKILL.md") fail("invalid_worker_inputs", "Packed consumer did not retain the worker guide input.");
	const source = path.join(ROOT, guide);
	if (!isRegularFile(source)) fail("invalid_worker_inputs", "Worker guide input is not a regular file.");
	const name = "ceal-guide-SKILL.md";
	const bytes = readFileSync(source);
	if (proof.worker_release_inputs?.guide_sha256 !== sha256(bytes)) fail("guide_drift", "Worker guide changed after the packed-consumer proof.");
	writeFileSync(path.join(normalized.outputDirectory, name), bytes, { mode: 0o644 });
	return { name, bytes: bytes.length, sha256: sha256(bytes) };
}

function copyInstaller({ normalized, proof }) {
	if (proof.worker_release_inputs?.installer !== "install-ceal.sh") fail("invalid_worker_inputs", "Packed consumer did not retain the worker installer input.");
	const source = path.join(ROOT, proof.worker_release_inputs.installer);
	if (!isRegularFile(source)) fail("invalid_worker_inputs", "Worker installer input is not a regular file.");
	const name = "install-ceal.sh";
	const bytes = readFileSync(source);
	if (proof.worker_release_inputs?.installer_sha256 !== sha256(bytes)) fail("installer_drift", "Worker installer changed after the packed-consumer proof.");
	writeFileSync(path.join(normalized.outputDirectory, name), bytes, { mode: 0o755 });
	return { name, bytes: bytes.length, sha256: sha256(bytes) };
}

function copyNotices(normalized) {
	const name = "THIRD_PARTY_NOTICES.txt";
	const bytes = readFileSync(path.join(ROOT, name));
	writeFileSync(path.join(normalized.outputDirectory, name), bytes, { mode: 0o644 });
	return { name, bytes: bytes.length, sha256: sha256(bytes) };
}

function writeManifest({ normalized, proof, artifact, guide, installer, notices, workerVersion }) {
	const name = `ceal-worker-release-manifest-${normalized.platform}.json`;
	const manifest = {
		schema_version: "ceal.worker_release_manifest.v1",
		artifact_state: "unsigned_local_build",
		version: workerVersion,
		platform: normalized.platform,
		command: "ceal",
		gateway_protocol: proof.gateway_protocol,
		worker_source: proof.worker_source,
		worker_release_inputs: proof.worker_release_inputs,
		artifacts: { ceal: artifact },
		guide,
		installer,
		third_party_notices: notices,
		non_claims: [
			"This local build does not create a tag, signature, release upload, publication, installation, update, or rollback.",
			"This does not prove a Gateway host, policy, connector, provider, audit, or Narnia Stage 3 action.",
		],
	};
	const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
	writeFileSync(path.join(normalized.outputDirectory, name), bytes, { mode: 0o644 });
	return { name, sha256: sha256(bytes) };
}

function writeChecksums(outputDirectory, entries) {
	const lines = entries.slice().sort((left, right) => left.name.localeCompare(right.name)).map((entry) => `${entry.sha256}  ${entry.name}`);
	writeFileSync(path.join(outputDirectory, "SHA256SUMS"), `${lines.join("\n")}\n`, { mode: 0o644 });
}

function requireOutputDirectory(value) {
	if (typeof value !== "string" || !path.isAbsolute(value)) fail("invalid_output", "Worker artifact output must be an absolute directory.");
	const output = path.resolve(value);
	if ([path.parse(output).root, ROOT, path.resolve(ROOT, "..")].includes(output)
		|| output.startsWith(`${ROOT}${path.sep}`)
		|| ROOT.startsWith(`${output}${path.sep}`)) fail("unsafe_output", "Refusing a broad or repository-overlapping worker output directory.");
	assertNoSymlinkComponents(output);
	return output;
}

function assertNoSymlinkComponents(output) {
	const parsed = path.parse(output);
	let current = parsed.root;
	for (const component of output.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
		current = path.join(current, component);
		try {
			if (lstatSync(current).isSymbolicLink()) fail("unsafe_output", "Worker artifact output path must not contain symbolic links.");
		} catch (error) {
			if (error instanceof WorkerReleaseArtifactError) throw error;
			if (error?.code === "ENOENT") return;
			fail("unsafe_output", "Could not safely inspect worker artifact output path.");
		}
	}
}

function prepareOutput(outputDirectory, force) {
	if (!existsSync(outputDirectory)) {
		mkdirSync(outputDirectory, { recursive: true, mode: 0o755 });
		writeFileSync(path.join(outputDirectory, MARKER), "worker release output\n");
		return;
	}
	const stat = lstatSync(outputDirectory);
	if (!stat.isDirectory() || stat.isSymbolicLink()) fail("unsafe_output", "Worker artifact output must be a regular directory.");
	if (readdirSync(outputDirectory).length === 0) {
		writeFileSync(path.join(outputDirectory, MARKER), "worker release output\n");
		return;
	}
	if (!force || !isRegularFile(path.join(outputDirectory, MARKER))) fail("output_not_replaceable", "Use --force only with a marked worker output directory.");
	rmSync(outputDirectory, { recursive: true, force: true });
	mkdirSync(outputDirectory, { recursive: true, mode: 0o755 });
	writeFileSync(path.join(outputDirectory, MARKER), "worker release output\n");
}

function requireAbsoluteFile(value, code) {
	if (typeof value !== "string" || !path.isAbsolute(value) || !isRegularFile(value)) fail(code, "Worker artifact requires an absolute regular protocol input.");
	return path.resolve(value);
}

function isRegularFile(file) {
	const stat = existsSync(file) ? lstatSync(file) : null;
	return Boolean(stat?.isFile() && !stat.isSymbolicLink());
}

function resolvePostjectCli() {
	try {
		const resolved = path.join(path.dirname(REQUIRE.resolve("postject/package.json")), "dist", "cli.js");
		if (isRegularFile(resolved)) return resolved;
	} catch { /* normalize below */ }
	fail("postject_unavailable", "postject is required to build the local worker artifact.");
}

function currentPlatform() {
	const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : process.arch;
	return `${process.platform}-${arch}`;
}

function requirePlatform(value) {
	if (typeof value !== "string" || !/^(linux|darwin)-(amd64|arm64)$/u.test(value)) fail("invalid_platform", "Worker artifact platform is invalid.");
	return value;
}

function readJson(file, code) {
	try { return JSON.parse(readFileSync(file, "utf8")); }
	catch { fail(code, "Worker artifact source manifest is unreadable."); }
}

function isVersion(value) { return typeof value === "string" && /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/u.test(value); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function fail(code, message) { throw new WorkerReleaseArtifactError(code, message); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.stderr.write("build-worker-release-artifact is a development-only module; use release:worker:package or release:worker:native with a lock-bound --gateway-handoff-archive.\n");
	process.exitCode = 2;
}
