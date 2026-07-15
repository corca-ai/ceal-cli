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
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRE = createRequire(import.meta.url);
const MARKER = ".ceal-cli-platform-binaries";
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const BUILD_PACKAGE_DIRS = Object.freeze(["ceal-protocol", "ceal-client", "ceal-worker-cli", "ceal-operator-cli"]);
const COMMANDS = Object.freeze([
	{
		id: "ceal",
		packageDir: "ceal-worker-cli",
		help: "Usage: ceal <command> [options]",
		requiredCommands: ["session", "capabilities"],
	},
	{
		id: "cealctl",
		packageDir: "ceal-operator-cli",
		help: "Usage: cealctl <command> [options]",
		requiredCommands: ["login", "sessions", "logout", "access", "connectors", "enrollments"],
	},
]);

export class CealCliPlatformBuildError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "CealCliPlatformBuildError";
		this.code = code;
	}
}

export async function buildCealCliPlatformBinaries(options = {}, deps = {}) {
	const normalized = normalizeOptions(options, deps);
	try {
		await (deps.buildSource ?? buildCurrentSource)();
	} catch (error) {
		throw normalizeError(error);
	}
	prepareOutput(normalized.outputDir, normalized.force);
	const work = mkdtempSync(path.join(tmpdir(), "ceal-cli-platform-build-"));
	try {
		const artifacts = [];
		for (const command of COMMANDS) {
			artifacts.push(await buildOne({ command, normalized, work, deps }));
		}
		const guides = buildGuideAssets(normalized, deps);
		const noticeName = "THIRD_PARTY_NOTICES.txt";
		const noticeBytes = readFileSync(path.join(ROOT, noticeName));
		const notices = { name: noticeName, sha256: digest(noticeBytes), bytes: noticeBytes.length };
		const manifest = buildManifest(normalized, artifacts, guides, notices);
		const manifestName = "ceal-cli-platform-release-manifest.json";
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
		writeFileSync(path.join(normalized.outputDir, manifestName), manifestBytes, { mode: 0o644 });
		writeFileSync(path.join(normalized.outputDir, noticeName), noticeBytes, { mode: 0o644 });
		const checksummed = [...artifacts.map((item) => ({ name: item.name, sha256: item.sha256 })), ...guides.map((item) => ({ name: item.name, sha256: item.sha256 })), {
			name: manifestName,
			sha256: digest(manifestBytes),
		}, {
			name: noticeName,
			sha256: digest(noticeBytes),
		}].sort((left, right) => left.name.localeCompare(right.name));
		writeFileSync(path.join(normalized.outputDir, "SHA256SUMS"), checksummed.map((item) => `${item.sha256}  ${item.name}`).join("\n") + "\n", { mode: 0o644 });
		return {
			schema_version: "ceal.cli_platform_binary_build.v1",
			ok: true,
			proof_level: "local_state",
			writes_external: false,
			version: normalized.version,
			platform: normalized.platform,
			output_dir: normalized.outputDir,
			artifacts,
			guides,
			manifest: { name: manifestName, sha256: digest(manifestBytes) },
			notices,
			checksums: { name: "SHA256SUMS", entry_count: checksummed.length },
		};
	} catch (error) {
		for (const command of COMMANDS) rmSync(path.join(normalized.outputDir, `${command.id}-${normalized.platform}`), { force: true });
		throw normalizeError(error);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

function buildGuideAssets(normalized, deps) {
	const guides = normalized.contract.guides;
	if (!guides || typeof guides !== "object" || Array.isArray(guides)) fail("guide_contract_invalid", "Release contract must declare signed guide assets.");
	return Object.entries(guides).map(([id, candidate]) => {
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) fail("guide_contract_invalid", "Release contract guide entry is invalid.");
		const guide = candidate;
		const sourcePath = resolveGuideSource(guide.path);
		const name = requirePattern(guide.asset, "guide asset", /^[a-z][a-z0-9-]{0,63}-SKILL[.]md$/u);
		const binary = requirePattern(guide.binary, "guide binary", /^(ceal|cealctl)$/u);
		const bytes = (deps.readGuide ?? readFileSync)(sourcePath);
		const sha256 = digest(bytes);
		if (guide.sha256 !== sha256) fail("guide_drift", "Release contract guide digest does not match source.");
		writeFileSync(path.join(normalized.outputDir, name), bytes, { mode: 0o644 });
		return { id, name, binary, bytes: bytes.length, sha256 };
	});
}

function resolveGuideSource(value) {
	const relative = requirePattern(value, "guide path", /^skills\/[a-z][a-z0-9-]{0,63}\/SKILL[.]md$/u);
	const sourcePath = path.resolve(ROOT, relative);
	const stat = lstatSync(sourcePath);
	if (stat.isSymbolicLink() || !stat.isFile()) fail("guide_contract_invalid", "Release guide source must be a regular file.");
	return sourcePath;
}

async function buildOne({ command, normalized, work, deps }) {
	const bundlePath = path.join(work, `${command.id}.cjs`);
	await (deps.bundle ?? bundleCommand)({ command, bundlePath });
	const blobPath = path.join(work, `${command.id}.blob`);
	(deps.createBlob ?? createBlob)({ bundlePath, blobPath, work, command: command.id });
	const name = `${command.id}-${normalized.platform}`;
	const artifactPath = path.join(normalized.outputDir, name);
	(deps.copyRuntime ?? copyRuntime)({ artifactPath });
	chmodSync(artifactPath, 0o755);
	(deps.injectBlob ?? injectBlob)({ artifactPath, blobPath, postjectCli: normalized.postjectCli });
	const smoke = (deps.smoke ?? smokeBinary)({ artifactPath, command, expectedVersion: normalized.version });
	const bytes = readFileSync(artifactPath);
	return { id: command.id, name, bytes: bytes.length, sha256: digest(bytes), smoke };
}

function normalizeOptions(options, deps) {
	const contract = (deps.readContract ?? readReleaseContract)();
	const version = requirePattern(options.version, "version", /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/u);
	assertReleaseVersion(contract, version);
	assertPackageIdentities(deps, version);
	const platform = requireTargetPlatform(contract, options.platform ?? currentPlatform(), deps);
	const outputDir = path.resolve(requireString(options.outputDir ?? options.out, "output directory"));
	assertOutputOutsideBuildTrees(outputDir);
	return {
		contract,
		force: options.force === true,
		outputDir,
		platform,
		postjectCli: (deps.resolvePostjectCli ?? resolvePostjectCli)(),
		version,
	};
}

function assertOutputOutsideBuildTrees(outputDir) {
	assertNoSymlinkComponents(outputDir);
	for (const packageDir of BUILD_PACKAGE_DIRS) {
		const buildDir = path.join(ROOT, "packages", packageDir, "dist");
		if (pathsOverlap(outputDir, buildDir)) fail("unsafe_output", "Release output must not overlap package build input.");
	}
}

function assertNoSymlinkComponents(outputDir) {
	const parsed = path.parse(outputDir);
	let current = parsed.root;
	for (const component of outputDir.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
		current = path.join(current, component);
		try {
			if (lstatSync(current).isSymbolicLink()) fail("unsafe_output", "Release output path must not contain symbolic links.");
		} catch (error) {
			if (error instanceof CealCliPlatformBuildError) throw error;
			if (error?.code === "ENOENT") return;
			fail("unsafe_output", "Could not safely inspect release output path.");
		}
	}
}

function pathsOverlap(left, right) {
	return left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
}

function assertReleaseVersion(contract, version) {
	if (version !== contract.release_version) fail("version_mismatch", "Build version must match the release contract.");
}

function assertPackageIdentities(deps, version) {
	for (const command of COMMANDS) {
		const manifest = (deps.readPackageManifest ?? readPackageManifest)(command);
		if (manifest.version !== version || manifest.bin?.[command.id] !== "./dist/bin.js") fail("version_mismatch", "CLI package identity must match the release contract.");
	}
}

function requireTargetPlatform(contract, platform, deps) {
	const supported = contract.native_build_matrix?.platforms;
	if (!Array.isArray(supported) || !supported.includes(platform)) {
		fail("unsupported_platform", "Platform must match the release contract native build matrix.");
	}
	if (platform !== (deps.currentPlatform ?? currentPlatform)()) fail("platform_mismatch", "Platform binaries must be built on their target architecture.");
	return platform;
}

function readReleaseContract() {
	return readJson(path.join(ROOT, "release-contract.json"), "release contract");
}

function readPackageManifest(command) {
	return readJson(path.join(ROOT, "packages", command.packageDir, "package.json"), "package manifest");
}

function prepareOutput(outputDir, force) {
	const unsafe = new Set([path.parse(outputDir).root, ROOT, path.resolve(ROOT, "..")]);
	if (unsafe.has(outputDir)) fail("unsafe_output", "Refusing a broad release output directory.");
	if (!existsSync(outputDir)) {
		mkdirSync(outputDir, { recursive: true, mode: 0o755 });
		writeFileSync(path.join(outputDir, MARKER), "ceal CLI platform build output\n", { mode: 0o644 });
		return;
	}
	const stat = lstatSync(outputDir);
	if (stat.isSymbolicLink() || !stat.isDirectory()) fail("unsafe_output", "Release output must be a regular directory.");
	if (readdirSync(outputDir).length === 0) {
		writeFileSync(path.join(outputDir, MARKER), "ceal CLI platform build output\n", { mode: 0o644 });
		return;
	}
	if (!force || !safeMarker(outputDir)) fail("output_not_replaceable", "Use --force only with a marked release output directory.");
	rmSync(outputDir, { recursive: true, force: true });
	mkdirSync(outputDir, { recursive: true, mode: 0o755 });
	writeFileSync(path.join(outputDir, MARKER), "ceal CLI platform build output\n", { mode: 0o644 });
}

function safeMarker(outputDir) {
	const marker = path.join(outputDir, MARKER);
	return existsSync(marker) && lstatSync(marker).isFile() && !lstatSync(marker).isSymbolicLink();
}

async function bundleCommand({ command, bundlePath }) {
	const entry = path.join(ROOT, "packages", command.packageDir, "dist", "bin.js");
	if (!existsSync(entry)) fail("build_failed", "Current source build did not produce a required CLI entrypoint.");
	await esbuild.build({ bundle: true, entryPoints: [entry], format: "cjs", logLevel: "silent", outfile: bundlePath, platform: "node", target: "node22" });
}

export function buildCurrentSource(options = {}) {
	const root = options.root ?? ROOT;
	const runBuild = options.runBuild ?? runRootBuild;
	try {
		for (const packageDir of BUILD_PACKAGE_DIRS) rmSync(path.join(root, "packages", packageDir, "dist"), { recursive: true, force: true });
		runBuild(root);
	} catch {
		fail("build_failed", "Could not compile current source for platform binaries.");
	}
}

function runRootBuild(root) {
	execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });
}

function createBlob({ bundlePath, blobPath, work, command }) {
	const config = path.join(work, `${command}.sea.json`);
	writeFileSync(config, `${JSON.stringify({
		main: path.basename(bundlePath),
		output: path.basename(blobPath),
		executable: process.execPath,
		disableExperimentalSEAWarning: true,
		useCodeCache: false,
		useSnapshot: false,
		execArgvExtension: "none",
	}, null, 2)}\n`, { mode: 0o644 });
	execFileSync(process.execPath, ["--experimental-sea-config", path.basename(config)], { cwd: work, stdio: "pipe" });
}

function copyRuntime({ artifactPath }) {
	copyFileSync(process.execPath, artifactPath);
}

function injectBlob({ artifactPath, blobPath, postjectCli }) {
	execFileSync(process.execPath, [postjectCli, artifactPath, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", SEA_FUSE, "--overwrite"], { stdio: "pipe" });
}

function smokeBinary({ artifactPath, command, expectedVersion }) {
	const smokeHome = mkdtempSync(path.join(tmpdir(), "ceal-cli-platform-smoke-home-"));
	const run = (args) => execFileSync(artifactPath, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, HOME: smokeHome },
	});
	try {
		const version = parse(run(["version"]));
		const help = run(["--help"]);
		if (version.command !== command.id || version.version !== expectedVersion || !help.includes(command.help)) fail("smoke_failed", "Built command identity or help did not match.");
		const discovery = parse(run(["commands"]));
		const discoveredCommands = Array.isArray(discovery?.commands)
			? discovery.commands.map((item) => item?.name).filter((name) => typeof name === "string")
			: [];
		assertRequiredCommandDiscovery(discoveredCommands, command.requiredCommands, command.id);
		let unconfiguredCapabilities = false;
		if (command.id === "ceal") {
			const capabilities = parse(run(["capabilities"]));
			unconfiguredCapabilities = capabilities?.status === "unavailable" && capabilities?.live_gateway_checked === false;
			if (!unconfiguredCapabilities) fail("smoke_failed", "Built ceal command did not complete its async unconfigured capability readback.");
		}
		return {
			ok: true,
			command: version.command,
			version: version.version,
			help: true,
			required_commands: command.requiredCommands,
			unconfigured_capabilities: unconfiguredCapabilities,
		};
	} finally {
		rmSync(smokeHome, { recursive: true, force: true });
	}
}

export function assertRequiredCommandDiscovery(discoveredCommands, requiredCommands, command = "CLI") {
	const missing = Array.isArray(discoveredCommands) && Array.isArray(requiredCommands)
		? requiredCommands.filter((name) => !discoveredCommands.includes(name))
		: ["invalid discovery document"];
	if (missing.length > 0) fail("smoke_failed", `Built ${command} command discovery omitted required commands: ${missing.join(", ")}.`);
}

function buildManifest(normalized, artifacts, guides, notices) {
	return {
		schema_version: "ceal.cli_platform_release_manifest.v1",
		artifact_state: "unsigned_build_output",
		repository: normalized.contract.repository,
		release_version: normalized.version,
		platform: normalized.platform,
		protocol: normalized.contract.protocol,
		artifacts: Object.fromEntries(artifacts.map((item) => [item.id, { name: item.name, bytes: item.bytes, sha256: item.sha256 }])),
		guides: Object.fromEntries(guides.map((item) => [item.id, { name: item.name, binary: item.binary, bytes: item.bytes, sha256: item.sha256 }])),
		third_party_notices: notices,
		signature_policy: {
			method: "cosign_keyless_blob",
			issuer: "https://token.actions.githubusercontent.com",
			workflow: "corca-ai/ceal-cli/.github/workflows/cealctl-release.yml",
			workflow_ref: `refs/tags/v${normalized.version}`,
		},
		non_claims: [
			"This manifest does not itself prove a signature, tag, draft release, upload, publication, or installation.",
		],
	};
}

function resolvePostjectCli() {
	try {
		const resolved = path.join(path.dirname(REQUIRE.resolve("postject/package.json")), "dist", "cli.js");
		if (existsSync(resolved)) return resolved;
	} catch {
		// Normalize below.
	}
	fail("postject_unavailable", "postject is required to build platform binaries.");
}

function currentPlatform() {
	const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : process.arch;
	return `${process.platform}-${arch}`;
}

function readJson(file, label) {
	try { return JSON.parse(readFileSync(file, "utf8")); } catch { fail("invalid_input", `Invalid ${label}.`); }
}

function requirePattern(value, label, pattern) {
	const result = requireString(value, label);
	if (!pattern.test(result)) fail("invalid_argument", `Invalid ${label}.`);
	return result;
}

function requireString(value, label) {
	if (typeof value !== "string" || value.length === 0 || value.length > 512 || /[\r\n]/u.test(value)) fail("invalid_argument", `Invalid ${label}.`);
	return value;
}

function digest(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function normalizeError(error) {
	return error instanceof CealCliPlatformBuildError ? error : new CealCliPlatformBuildError("build_failed", "Could not build Ceal CLI platform binaries.");
}

function fail(code, message) {
	throw new CealCliPlatformBuildError(code, message);
}

function parseArgs(argv) {
	const options = { force: false };
	let json = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") return { help: true, json, options };
		if (arg === "--json") json = true;
		else if (arg === "--force") options.force = true;
		else if (["--version", "--platform", "--out"].includes(arg)) options[arg.slice(2) === "out" ? "outputDir" : arg.slice(2)] = requireString(argv[++index], arg);
		else fail("invalid_argument", "Unexpected platform build argument.");
	}
	return { help: false, json, options };
}

export async function runCli(argv, io = console, deps = {}) {
	let json = argv.includes("--json");
	try {
		const parsed = parseArgs(argv);
		json = parsed.json;
		if (parsed.help) {
			io.log("usage: node scripts/build-platform-binaries.mjs --version <semver> --out <dir> [--platform <platform>] [--force] [--json]");
			return 0;
		}
		const result = await buildCealCliPlatformBinaries(parsed.options, deps);
		io.log(json ? JSON.stringify(result, null, 2) : `Built ceal and cealctl ${result.version} for ${result.platform}.`);
		return 0;
	} catch (error) {
		const normalized = normalizeError(error);
		const payload = { schema_version: "ceal.cli_platform_binary_build_error.v1", ok: false, error_code: normalized.code, message: normalized.message };
		if (json) io.log(JSON.stringify(payload)); else io.error(payload.message);
		return 2;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runCli(process.argv.slice(2));
