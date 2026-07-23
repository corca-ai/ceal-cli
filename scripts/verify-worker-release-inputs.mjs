#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INVENTORY_PATH = "release/worker-inputs.json";
const EXPECTED = Object.freeze({
	schema_version: "ceal.worker_release_inputs.v1",
	source_repository: "corca-ai/ceal-cli",
	packages: {
		client: { path: "packages/ceal-client", name: "@corca-ai/ceal" },
		worker: { path: "packages/ceal-worker-cli", name: "@corca-ai/ceal-worker-cli" },
	},
	guide: "skills/ceal-guide/SKILL.md",
	protocol: { package: "@corca-ai/ceal-protocol", input: "gateway_artifact_only" },
	forbidden_paths: [
		"packages/ceal-protocol",
		"packages/ceal-operator-cli",
		"skills/cealctl-guide",
		"install.sh",
		"release-contract.json",
		"scripts/build-platform-binaries.mjs",
		"scripts/build-release-manifest.mjs",
		".github/workflows/cealctl-release.yml",
		".github/workflows/npm-package-stage.yml",
	],
});

export class WorkerReleaseInputsError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "WorkerReleaseInputsError";
		this.code = code;
	}
}

export function validateWorkerReleaseInputs({ repoRoot = REPO_ROOT, protocolVersion, inventory } = {}) {
	const root = path.resolve(repoRoot);
	const candidate = inventory ?? readInventory(root);
	assertInventoryShape(candidate);
	assertRegularDirectory(root, candidate.packages.client.path);
	assertRegularDirectory(root, candidate.packages.worker.path);
	assertRegularFile(root, candidate.guide);
	assertPackage(root, candidate.packages.client, protocolVersion, false);
	assertPackage(root, candidate.packages.worker, protocolVersion, true);
	return {
		schema_version: candidate.schema_version,
		source_repository: candidate.source_repository,
		packages: candidate.packages,
		guide: candidate.guide,
		protocol: {
			package: candidate.protocol.package,
			input: candidate.protocol.input,
			version: protocolVersion ?? null,
		},
	};
}

function readInventory(root) {
	const file = absolutePath(root, INVENTORY_PATH, "invalid_inventory");
	if (!existsSync(file) || lstatSync(file).isSymbolicLink()) {
		throw new WorkerReleaseInputsError("invalid_inventory", "Worker release inventory must be a regular tracked file.");
	}
	try { return JSON.parse(readFileSync(file, "utf8")); }
	catch { throw new WorkerReleaseInputsError("invalid_inventory", "Worker release inventory is not valid JSON."); }
}

function assertInventoryShape(inventory) {
	if (!inventory || typeof inventory !== "object"
		|| inventory.schema_version !== EXPECTED.schema_version
		|| inventory.source_repository !== EXPECTED.source_repository
		|| !Array.isArray(inventory.forbidden_paths)) {
		throw new WorkerReleaseInputsError("invalid_inventory", "Worker release inventory does not match the owned-only release contract.");
	}
	const selectedPaths = [inventory.packages?.client?.path, inventory.packages?.worker?.path, inventory.guide];
	if (selectedPaths.some((entry) => inventory.forbidden_paths.includes(entry))) {
		throw new WorkerReleaseInputsError("forbidden_input", "Worker release inventory selected a Gateway-owned or legacy path.");
	}
	if (inventory.guide !== EXPECTED.guide
		|| !sameObject(inventory.protocol, EXPECTED.protocol)
		|| !sameObject(inventory.packages?.client, EXPECTED.packages.client)
		|| !sameObject(inventory.packages?.worker, EXPECTED.packages.worker)) {
		throw new WorkerReleaseInputsError("invalid_inventory", "Worker release inventory does not match the owned-only release contract.");
	}
	if (!sameStringSet(inventory.forbidden_paths, EXPECTED.forbidden_paths)) {
		throw new WorkerReleaseInputsError("invalid_inventory", "Worker release inventory must retain the complete Gateway and legacy exclusion set.");
	}
}

function assertPackage(root, input, protocolVersion, isWorker) {
	const manifest = readJson(path.join(absolutePath(root, input.path, "unsafe_path"), "package.json"), "invalid_package");
	if (manifest.name !== input.name || !isExactVersion(manifest.version)) {
		throw new WorkerReleaseInputsError("invalid_package", "Worker release package identity is invalid.");
	}
	if (isWorker && manifest.private !== true) {
		throw new WorkerReleaseInputsError("invalid_package", "Worker release CLI must remain a private implementation package.");
	}
	if (!isWorker && manifest.private === true) {
		throw new WorkerReleaseInputsError("invalid_package", "Worker release client SDK must remain publishable.");
	}
	if (protocolVersion !== undefined && manifest.dependencies?.[EXPECTED.protocol.package] !== protocolVersion) {
		throw new WorkerReleaseInputsError("protocol_version_mismatch", "Worker release package does not declare the supplied Gateway protocol version exactly.");
	}
}

function assertRegularDirectory(root, relativePath) {
	const target = absolutePath(root, relativePath, "unsafe_path");
	const stat = existsSync(target) ? lstatSync(target) : null;
	if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new WorkerReleaseInputsError("unsafe_path", "Worker release input must be a regular directory.");
}

function assertRegularFile(root, relativePath) {
	const target = absolutePath(root, relativePath, "unsafe_path");
	const stat = existsSync(target) ? lstatSync(target) : null;
	if (!stat?.isFile() || stat.isSymbolicLink()) throw new WorkerReleaseInputsError("unsafe_path", "Worker release guide must be a regular file.");
}

function absolutePath(root, relativePath, code) {
	if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath)) {
		throw new WorkerReleaseInputsError(code, "Worker release input path must be a non-empty relative path.");
	}
	const target = path.resolve(root, relativePath);
	if (!target.startsWith(`${root}${path.sep}`)) throw new WorkerReleaseInputsError(code, "Worker release input path escaped the repository root.");
	return target;
}

function readJson(file, code) {
	try { return JSON.parse(readFileSync(file, "utf8")); }
	catch { throw new WorkerReleaseInputsError(code, "Worker release package manifest is unreadable."); }
}

function sameObject(actual, expected) {
	return JSON.stringify(actual) === JSON.stringify(expected);
}

function sameStringSet(actual, expected) {
	return actual.length === expected.length && actual.every((entry) => typeof entry === "string")
		&& actual.slice().sort().join("\n") === expected.slice().sort().join("\n");
}

function isExactVersion(value) {
	return typeof value === "string" && /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/u.test(value);
}
