#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { codedErrorClass } from "./lib/coded-error.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROTOCOL_NAME = "@corca-ai/ceal-protocol";
const CLIENT_NAME = "@corca-ai/ceal";
const WORKER_NAME = "@corca-ai/ceal-worker-cli";
const GATEWAY_REPOSITORY = "corca-ai/ceal";

export const GatewayProtocolConsumerError = codedErrorClass("GatewayProtocolConsumerError", ["workspace"]);

export function verifyGatewayProtocolConsumer({ repoRoot = REPO_ROOT, protocolTarball, protocolProvenance, keepWorkspace = false } = {}) {
	const root = path.resolve(repoRoot);
	const input = validateArtifactInput({ protocolTarball, protocolProvenance });
	const releaseInputs = validateReleaseInputs(root, input.provenance.artifact.version);
	// Canonicalize so lock/path comparisons agree on hosts where the temp root
	// sits behind a symlink (macOS /var -> /private/var).
	const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-gateway-protocol-consumer-")));
	try {
		const client = buildClient({ root, workspace, input, releaseInputs });
		const worker = buildWorker({ root, workspace, input, client, releaseInputs });
		const installed = installAndExerciseWorker({ workspace, input, client, worker });
		const result = {
			schema_version: "ceal.gateway_protocol_packed_consumer_proof.v1",
			ok: true,
			proof_level: "local_integration",
			writes_external: false,
			gateway_protocol: input.provenance,
			worker_source: {
				repository: "corca-ai/ceal-cli",
				commit: git(root, ["rev-parse", "HEAD"]),
				tree: git(root, ["rev-parse", "HEAD^{tree}"]),
			},
			worker_release_inputs: {
				...releaseInputs,
				guide_sha256: sha256(readRegularFile(path.join(root, releaseInputs.guide), "invalid_worker_release_inputs")),
				installer_sha256: sha256(readRegularFile(path.join(root, releaseInputs.installer), "invalid_worker_release_inputs")),
			},
			consumer: installed,
			non_claims: [
				"This proves a local packed artifact consumer only; it does not publish, sign, install, update, or roll back a release.",
				"This does not prove a Gateway host, policy, connector, provider, audit, or Narnia Stage 3 action.",
			],
			workspace: keepWorkspace ? workspace : null,
		};
		return result;
	} catch (error) {
		if (error instanceof GatewayProtocolConsumerError) {
			error.workspace ??= workspace;
			throw error;
		}
		throw new GatewayProtocolConsumerError(
			"consumer_verification_failed",
			"Gateway protocol packed-consumer verification failed.",
			workspace,
		);
	}
}

// This used to call into `verify-worker-release-inputs.mjs`, which read a second
// inventory (`release/worker-inputs.json`) whose contents were pinned to a frozen
// constant in that script and restated again in its test — three hand-kept copies
// of one list, and a fourth in the live `worker-release-inputs.json` that the real
// release lane reads. Read the live inventory directly instead. The package
// identity, `private` flag, and exact-protocol-dependency claims that script also
// made are asserted in `test/contract/repo-gates.test.mjs`, and the release lane
// enforces the version agreement in `scripts/worker-release-inputs.mjs`.
function validateReleaseInputs(root, protocolVersion) {
	const inventory = readJson(path.join(root, "worker-release-inputs.json"), "invalid_worker_release_inputs");
	const client = { path: inventory?.client?.source_path, name: inventory?.client?.package };
	const worker = { path: inventory?.worker?.source_path, name: inventory?.worker?.package };
	const guide = inventory?.guide?.source_path;
	if (!client.path || !client.name || !worker.path || !worker.name || !guide) {
		throw new GatewayProtocolConsumerError("invalid_worker_release_inputs", "Worker release inventory does not name the owned inputs.");
	}
	for (const input of [client, worker]) {
		const manifest = readJson(path.join(root, input.path, "package.json"), "invalid_worker_release_inputs");
		if (manifest.name !== input.name) {
			throw new GatewayProtocolConsumerError("invalid_worker_release_inputs", "Worker release input package identity is invalid.");
		}
		// The consumer proof is about resolving *this* protocol version, so a
		// package declaring a different one would make the readback meaningless.
		if (manifest.dependencies?.[PROTOCOL_NAME] !== protocolVersion) {
			throw new GatewayProtocolConsumerError(
				"invalid_worker_release_inputs",
				"Worker release package does not declare the supplied Gateway protocol version exactly.",
			);
		}
	}
	return {
		packages: { client, worker },
		guide,
		installer: "install-ceal.sh",
		protocol: { package: PROTOCOL_NAME, input: "gateway_artifact_only", version: protocolVersion },
	};
}

function validateArtifactInput({ protocolTarball, protocolProvenance }) {
	const tarball = requireAbsoluteRegularFile(protocolTarball, "invalid_protocol_tarball");
	const provenancePath = requireAbsoluteRegularFile(protocolProvenance, "invalid_protocol_provenance");
	const provenance = readJson(provenancePath, "invalid_protocol_provenance");
	const bytes = readFileSync(tarball);
	if (
		provenance?.schema_version !== "ceal.gateway_protocol_artifact.v1" ||
		provenance?.source?.repository !== GATEWAY_REPOSITORY ||
		!isGitRef(provenance?.source?.commit) ||
		!isGitRef(provenance?.source?.tree) ||
		provenance?.source?.package_path !== "packages/ceal-protocol" ||
		provenance?.artifact?.package !== PROTOCOL_NAME ||
		!isVersion(provenance?.artifact?.version) ||
		provenance?.artifact?.sha256 !== sha256(bytes) ||
		!isSha512Integrity(provenance?.artifact?.npm_integrity) ||
		!Array.isArray(provenance?.artifact?.exports)
	) {
		throw new GatewayProtocolConsumerError("invalid_protocol_provenance", "Gateway protocol provenance does not bind this artifact.");
	}
	const manifest = readPackedManifest(tarball);
	if (
		manifest?.name !== PROTOCOL_NAME ||
		manifest.version !== provenance.artifact.version ||
		manifest.repository?.url !== "git+https://github.com/corca-ai/ceal.git" ||
		manifest.repository?.directory !== "packages/ceal-protocol" ||
		manifest.publishConfig?.access !== "public" ||
		JSON.stringify(Object.keys(manifest.exports ?? {}).sort()) !== JSON.stringify(provenance.artifact.exports.slice().sort())
	) {
		throw new GatewayProtocolConsumerError("protocol_identity_mismatch", "Gateway protocol tarball metadata differs from its provenance.");
	}
	return { tarball, provenancePath, provenance, sha256: provenance.artifact.sha256, manifest };
}

function buildClient({ root, workspace, input, releaseInputs }) {
	const source = copySourcePackage(root, workspace, releaseInputs.packages.client.path);
	const manifest = readJson(path.join(source, "package.json"), "invalid_client_package");
	assertPublishedDependency(manifest, PROTOCOL_NAME, input.provenance.artifact.version, "invalid_client_package");
	setDependencies(source, { [PROTOCOL_NAME]: artifactSpecifier(input.tarball) });
	install(source, "client_install");
	const protocol = assertInstalledProtocol(source, input);
	run(source, "npm", ["run", "build"], "client_build");
	setDependencies(source, { [PROTOCOL_NAME]: input.provenance.artifact.version });
	const tarball = pack(source, path.join(workspace, "tarballs"), CLIENT_NAME, "client_pack");
	return { source, tarball, protocol, version: manifest.version };
}

function buildWorker({ root, workspace, input, client, releaseInputs }) {
	const source = copySourcePackage(root, workspace, releaseInputs.packages.worker.path);
	const manifest = readJson(path.join(source, "package.json"), "invalid_worker_package");
	// The worker versions with the client, not with the pinned Gateway
	// protocol artifact: the protocol dependency alone must match the
	// supplied artifact exactly.
	assertPublishedDependency(manifest, PROTOCOL_NAME, input.provenance.artifact.version, "invalid_worker_package");
	assertPublishedDependency(manifest, CLIENT_NAME, client.version, "invalid_worker_package");
	setDependencies(source, {
		[PROTOCOL_NAME]: artifactSpecifier(input.tarball),
		[CLIENT_NAME]: artifactSpecifier(client.tarball.path),
	});
	install(source, "worker_install");
	const protocol = assertInstalledProtocol(source, input);
	assertInstalledPackage(source, CLIENT_NAME, "invalid_client_install");
	run(source, "npm", ["run", "build"], "worker_build");
	setDependencies(source, {
		[PROTOCOL_NAME]: input.provenance.artifact.version,
		[CLIENT_NAME]: client.version,
	});
	const tarball = pack(source, path.join(workspace, "tarballs"), WORKER_NAME, "worker_pack");
	return { source, tarball, protocol };
}

function installAndExerciseWorker({ workspace, input, client, worker }) {
	const consumer = path.join(workspace, "consumer");
	mkdirSync(consumer, { recursive: true, mode: 0o755 });
	writeFileSync(
		path.join(consumer, "package.json"),
		`${JSON.stringify({ name: "ceal-gateway-protocol-consumer", private: true, type: "module" })}\n`,
	);
	install(consumer, "consumer_install", [input.tarball, client.tarball.path, worker.tarball.path]);
	const protocol = assertInstalledProtocol(consumer, input);
	assertInstalledPackage(consumer, CLIENT_NAME, "invalid_client_install");
	assertInstalledPackage(consumer, WORKER_NAME, "invalid_worker_install");
	const bin = path.join(consumer, "node_modules", ".bin", "ceal");
	const commands = run(consumer, process.execPath, [bin, "commands"], "worker_commands");
	if (!/ceal[.]commands[.]v1/u.test(commands.stdout))
		throw new GatewayProtocolConsumerError("worker_smoke_failed", "Installed worker did not emit command discovery.");
	const resolution = run(
		consumer,
		process.execPath,
		["--input-type=module", "--eval", "console.log(import.meta.resolve('@corca-ai/ceal-protocol'))"],
		"protocol_resolution",
	).stdout.trim();
	const resolvedPath = filePathFromResolution(resolution);
	assertContainedRegularPath(consumer, resolvedPath, "escaped_protocol_resolution");
	if (!resolvedPath.includes(`${path.sep}node_modules${path.sep}`))
		throw new GatewayProtocolConsumerError("source_fallback", "Worker resolved protocol outside installed node_modules.");
	return {
		protocol_tarball_sha256: input.sha256,
		protocol_lock: protocol.lock,
		protocol_resolution: resolvedPath,
		client_tarball_sha256: client.tarball.sha256,
		worker_tarball_sha256: worker.tarball.sha256,
		worker_commands_schema: "ceal.commands.v1",
	};
}

function copySourcePackage(root, workspace, sourcePath) {
	const source = path.join(root, sourcePath);
	const destination = path.join(workspace, "sources", path.basename(sourcePath));
	cpSync(source, destination, {
		recursive: true,
		filter: (entry) => !["node_modules", "dist"].includes(path.basename(entry)),
	});
	if (existsSync(path.join(workspace, "sources", "ceal-protocol")))
		throw new GatewayProtocolConsumerError("source_fallback", "Isolated worker fixture must not contain protocol source.");
	assertNoProtocolFallbackSource(destination);
	return destination;
}

function assertNoProtocolFallbackSource(root) {
	for (const relative of ["src", "package.json", "tsconfig.json", "tsconfig.build.json"]) {
		const target = path.join(root, relative);
		if (!existsSync(target)) continue;
		for (const file of regularFiles(target)) {
			const text = readFileSync(file, "utf8");
			if (/workspace:|packages\/ceal-protocol|@corca-ai\/ceal-protocol\/(?:src|dist)/u.test(text)) {
				throw new GatewayProtocolConsumerError(
					"source_fallback",
					"Worker source contains a protocol workspace, path, or undeclared-subpath fallback.",
				);
			}
		}
	}
}

function setDependencies(root, values) {
	const file = path.join(root, "package.json");
	const manifest = readJson(file, "invalid_package_manifest");
	manifest.dependencies = { ...manifest.dependencies, ...values };
	writeFileSync(file, `${JSON.stringify(manifest, null, "\t")}\n`);
}

function install(cwd, label, artifacts = []) {
	run(cwd, "npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", ...artifacts], label);
}

function pack(cwd, destination, expectedName, label) {
	if (!existsSync(destination)) {
		const parent = path.dirname(destination);
		if (!existsSync(parent)) throw new GatewayProtocolConsumerError("invalid_workspace", "Consumer tarball directory parent is missing.");
		// npm owns the package archive; this directory contains only disposable proof output.
		mkdirSync(destination, { recursive: true, mode: 0o755 });
	}
	const result = run(cwd, "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], label);
	let metadata;
	try {
		metadata = JSON.parse(result.stdout)?.[0];
	} catch {
		throw new GatewayProtocolConsumerError("invalid_pack_metadata", "Consumer package pack metadata is invalid.");
	}
	if (metadata?.name !== expectedName || typeof metadata.filename !== "string")
		throw new GatewayProtocolConsumerError("invalid_pack_metadata", "Consumer package pack identity is invalid.");
	const artifact = path.join(destination, metadata.filename);
	return { path: artifact, sha256: sha256(readRegularFile(artifact, "invalid_pack_artifact")) };
}

function assertInstalledProtocol(root, input) {
	const packageRoot = assertInstalledPackage(root, PROTOCOL_NAME, "invalid_protocol_install");
	const manifest = readJson(path.join(packageRoot, "package.json"), "invalid_protocol_install");
	if (
		manifest.name !== PROTOCOL_NAME ||
		manifest.version !== input.provenance.artifact.version ||
		manifest.repository?.url !== "git+https://github.com/corca-ai/ceal.git"
	) {
		throw new GatewayProtocolConsumerError("protocol_identity_mismatch", "Installed protocol does not match the Gateway artifact identity.");
	}
	const lock = readJson(path.join(root, "package-lock.json"), "invalid_protocol_lock");
	const entry = lock?.packages?.[`node_modules/${PROTOCOL_NAME}`];
	// npm records `resolved` against the canonicalized package root, so both
	// sides are realpath-compared; a mismatch still fails closed.
	if (
		entry?.link === true ||
		typeof entry.integrity !== "string" ||
		canonicalLockTarball(root, entry.resolved) !== realpathSync(input.tarball)
	) {
		throw new GatewayProtocolConsumerError(
			"protocol_lock_mismatch",
			"Installed protocol lock entry does not point to the supplied Gateway tarball.",
		);
	}
	return { package_root: packageRoot, lock: { resolved: entry.resolved, integrity: entry.integrity } };
}

function assertInstalledPackage(root, packageName, code) {
	const packageRoot = path.join(root, "node_modules", ...packageName.split("/"));
	assertContainedRegularPath(root, packageRoot, code);
	return packageRoot;
}

function assertContainedRegularPath(root, target, code) {
	const stat = existsSync(target) ? lstatSync(target) : null;
	if (!stat || stat.isSymbolicLink()) throw new GatewayProtocolConsumerError(code, "Installed package must be a non-symlink path.");
	const realRoot = realpathSync(root);
	const realTarget = realpathSync(target);
	if (!realTarget.startsWith(`${realRoot}${path.sep}`))
		throw new GatewayProtocolConsumerError(code, "Installed package escaped its isolated consumer.");
}

function assertPublishedDependency(manifest, name, version, code) {
	if (manifest?.dependencies?.[name] !== version)
		throw new GatewayProtocolConsumerError(code, `Worker source dependency on ${name} must be the exact published version ${version}.`);
}

function artifactSpecifier(file) {
	return `file:${file}`;
}

function resolveLockTarball(root, resolved) {
	if (typeof resolved !== "string" || !resolved.startsWith("file:")) return null;
	return path.resolve(root, resolved.slice("file:".length));
}

function canonicalLockTarball(root, resolved) {
	const tarball = resolveLockTarball(root, resolved);
	if (tarball === null || !existsSync(tarball)) return null;
	return realpathSync(tarball);
}

function requireAbsoluteRegularFile(value, code) {
	if (typeof value !== "string" || !path.isAbsolute(value))
		throw new GatewayProtocolConsumerError(code, "Protocol proof input must be an absolute regular file.");
	return readRegularFile(path.resolve(value), code) && path.resolve(value);
}

function readRegularFile(file, code) {
	const stat = existsSync(file) ? lstatSync(file) : null;
	if (!stat?.isFile() || stat.isSymbolicLink())
		throw new GatewayProtocolConsumerError(code, "Protocol proof input must be a regular non-symlink file.");
	return readFileSync(file);
}

function readPackedManifest(tarball) {
	try {
		return JSON.parse(
			execFileSync("tar", ["-xOzf", tarball, "package/package.json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
		);
	} catch {
		throw new GatewayProtocolConsumerError("invalid_protocol_tarball", "Protocol artifact is not a readable package tarball.");
	}
}

function run(cwd, command, args, label) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 8 * 1024 * 1024,
		// NODE_V8_COVERAGE is cleared for the same reason NODE_PATH is: this helper
		// spawns a package manager and a compiler inside a staged consumer, and
		// inheriting the parent's coverage collection makes them write profiles that
		// remap to nothing here. Worth about 9s of the coverage run and no coverage
		// at all — measured both ways, because the test this helper serves looked
		// like the run's dominant cost and was not. docs/gates.md has the numbers.
		env: { ...process.env, NODE_PATH: "", NODE_V8_COVERAGE: "" },
	});
	if (result.status !== 0) throw new GatewayProtocolConsumerError("command_failed", `Packed consumer ${label} failed.`);
	return result;
}

function git(cwd, args) {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		throw new GatewayProtocolConsumerError("git_identity_failed", "Worker source Git identity is unavailable.");
	}
}

function regularFiles(target) {
	const stat = lstatSync(target);
	if (stat.isFile()) return [target];
	if (!stat.isDirectory() || stat.isSymbolicLink())
		throw new GatewayProtocolConsumerError("unsafe_source", "Worker source must contain only regular files and directories.");
	return readdirSync(target).flatMap((name) => regularFiles(path.join(target, name)));
}

function readJson(file, code) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		throw new GatewayProtocolConsumerError(code, "Consumer proof JSON is invalid.");
	}
}

function filePathFromResolution(value) {
	if (!value.startsWith("file:"))
		throw new GatewayProtocolConsumerError("escaped_protocol_resolution", "Protocol resolution is not a file URL.");
	return fileURLToPath(value);
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
function isGitRef(value) {
	return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}
function isVersion(value) {
	return typeof value === "string" && /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/u.test(value);
}
function isSha512Integrity(value) {
	return typeof value === "string" && /^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(value);
}

function parseArgs(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") return { help: true };
		if (
			![
				["--protocol-tarball", "protocolTarball"],
				["--protocol-provenance", "protocolProvenance"],
				["--keep-workspace", "keepWorkspace"],
			].some(([flag, field]) => {
				if (arg !== flag || options[field] !== undefined) return false;
				options[field] = flag === "--keep-workspace" ? true : argv[++index];
				return true;
			})
		)
			throw new GatewayProtocolConsumerError("invalid_argument", "Invalid packed protocol consumer argument.");
	}
	return { options };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const parsed = parseArgs(process.argv.slice(2));
		if (parsed.help)
			console.log(
				"usage: node scripts/verify-gateway-protocol-consumer.mjs --protocol-tarball <absolute-tgz> --protocol-provenance <absolute-json> [--keep-workspace]",
			);
		else console.log(JSON.stringify(verifyGatewayProtocolConsumer(parsed.options), null, 2));
	} catch (error) {
		console.error(
			JSON.stringify({
				schema_version: "ceal.gateway_protocol_packed_consumer_error.v1",
				ok: false,
				error_code: error instanceof GatewayProtocolConsumerError ? error.code : "consumer_verification_failed",
			}),
		);
		process.exitCode = 2;
	}
}
