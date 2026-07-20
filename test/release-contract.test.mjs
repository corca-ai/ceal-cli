import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	buildCealCliReleaseManifest,
	CealCliReleaseManifestError,
} from "../scripts/build-release-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = existsSync(path.join(repoRoot, "packages")) ? repoRoot : path.resolve(repoRoot, "../..");

test("one release contract binds package, protocol, binary, and rollback identity", () => {
	const contract = readJson("release-contract.json");
	const rootPackage = readJson("package.json");
	const packages = Object.fromEntries([
		"ceal-protocol",
		"ceal-client",
		"ceal-worker-cli",
		"ceal-operator-cli",
	].map((name) => [name, readPackageJson(name)]));
	assert.equal(rootPackage.version, contract.release_version);
	for (const manifest of Object.values(packages)) assert.equal(manifest.version, contract.release_version);
	assert.equal(packages["ceal-protocol"].name, contract.protocol.package);
	assert.equal(packages["ceal-client"].name, contract.client.package);
	assert.equal(contract.client.role, "client_sdk_only");
	assert.deepEqual(contract.npm_packages.public, ["@corca-ai/ceal-protocol", "@corca-ai/ceal"]);
	assert.deepEqual(contract.npm_packages.private_build_inputs, ["@corca-ai/ceal-worker-cli", "@corca-ai/ceal-operator-cli"]);
	assert.equal(packages["ceal-protocol"].private, undefined);
	assert.equal(packages["ceal-client"].private, undefined);
	assert.equal(packages["ceal-worker-cli"].private, true);
	assert.equal(packages["ceal-operator-cli"].private, true);
	assert.equal(contract.npm_packages.initial_bootstrap.method, "maintainer_direct_publish_with_2fa");
	assert.equal(contract.npm_packages.subsequent_releases.method, "npm_stage_with_oidc_trusted_publisher");
	assert.equal(contract.npm_packages.publication_state, "not_published");
	assert.equal(packages["ceal-worker-cli"].name, contract.artifacts.ceal.package);
	assert.equal(packages["ceal-worker-cli"].bin.ceal, "./dist/bin.js");
	assert.equal(packages["ceal-operator-cli"].name, contract.artifacts.cealctl.package);
	assert.equal(packages["ceal-operator-cli"].bin.cealctl, "./dist/bin.js");
	assert.deepEqual(Object.fromEntries(Object.entries(contract.guides).map(([name, guide]) => [name, {
		asset: guide.asset,
		binary: guide.binary,
	}])), {
		"ceal-guide": { asset: "ceal-guide-SKILL.md", binary: "ceal" },
		"cealctl-guide": { asset: "cealctl-guide-SKILL.md", binary: "cealctl" },
	});
	assert.deepEqual(contract.rollback.source, {
		strategy: "normal_additive_revert",
		immutable_commit: "f458a0bce291123644c84efdbeb48d5255a74c64",
	});
	assert.equal(contract.rollback.legacy_cealctl_distribution.scope, "cealctl_only");
	assert.equal(contract.rollback.legacy_cealctl_distribution.tag_and_release_are_mutable_pointers, true);
	assert.ok(contract.publication_blockers.length > 0);
});

test("npm workflow stages only the approved public package pair through OIDC", () => {
	const workflow = readFileSync(path.join(repoRoot, ".github/workflows/npm-package-stage.yml"), "utf8");
	assert.match(workflow, /environment: ceal-npm-release[\s\S]+contents: read[\s\S]+id-token: write/u);
	assert.match(workflow, /npm install --global npm@11[.]18[.]0/u);
	assert.match(workflow, /CEAL_NPM_APPROVED_PROTOCOL_SHA256/u);
	assert.match(workflow, /CEAL_NPM_APPROVED_CLIENT_SHA256/u);
	assert.match(workflow, /npm stage publish "npm-stage-inputs\/corca-ai-ceal-protocol-\$\{version\}[.]tgz"/u);
	assert.match(workflow, /npm stage publish "npm-stage-inputs\/corca-ai-ceal-\$\{version\}[.]tgz"/u);
	assert.match(workflow, /if: always\(\)[\s\S]+npm-stage-inputs\/[\s\S]+npm-stage-results\//u);
	assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|npm publish|npm stage (?:approve|reject)|packages\/ceal-(?:worker|operator)-cli/u);
	for (const action of workflow.matchAll(/uses:\s+([^\s]+)/gu)) assert.match(action[1], /@[a-f0-9]{40}$/u);
});

test("public package dependencies are exact and never escape the candidate checkout", () => {
	for (const name of ["ceal-protocol", "ceal-client", "ceal-worker-cli", "ceal-operator-cli"]) {
		const manifest = readPackageJson(name);
		for (const dependencies of [manifest.dependencies ?? {}, manifest.optionalDependencies ?? {}]) {
			for (const [dependency, value] of Object.entries(dependencies)) {
				assert.doesNotMatch(value, /^(?:file:|link:|workspace:)|(?:^|[/\\])[.][.]?(?:[/\\]|$)|private/u, `${name}: ${dependency}`);
				if (dependency.startsWith("@corca-ai/")) assert.match(value, /^[0-9]+[.][0-9]+[.][0-9]+$/u);
			}
		}
	}
});

test("release manifest builder verifies package identities, records separate digests, and retains blockers", (context) => {
	const outputDir = mkdtempSync(path.join(tmpdir(), "ceal-cli-manifest-"));
	context.after(() => rmSync(outputDir, { recursive: true, force: true }));
	const ceal = path.join(outputDir, "worker.tgz");
	const cealctl = path.join(outputDir, "operator.tgz");
	writeArtifactArchive(outputDir, ceal, "@corca-ai/ceal-worker-cli", "ceal");
	writeArtifactArchive(outputDir, cealctl, "@corca-ai/ceal-operator-cli", "cealctl");
	const result = buildCealCliReleaseManifest({
		repoRoot,
		outputDir: path.join(outputDir, "release"),
		artifacts: [{ id: "ceal", path: ceal }, { id: "cealctl", path: cealctl }],
	});
	assert.equal(result.ok, true);
	assert.equal(result.proof_level, "local_state");
	assert.notEqual(result.manifest.artifacts.ceal.sha256, result.manifest.artifacts.cealctl.sha256);
	assert.equal(result.manifest.protocol.wire_version, "1.3.0");
	assert.ok(result.manifest.publication_blockers.length > 0);
	assert.equal(result.manifest.status, "local_candidate_not_published");

	const invalid = path.join(outputDir, "not-a-package.tgz");
	writeFileSync(invalid, "not an npm package archive\n");
	assert.throws(
		() => buildCealCliReleaseManifest({
			repoRoot,
			outputDir: path.join(outputDir, "invalid-release"),
			artifacts: [{ id: "ceal", path: invalid }, { id: "cealctl", path: cealctl }],
		}),
		(error) => error instanceof CealCliReleaseManifestError && error.code === "invalid_artifact",
	);

	const mislabeled = path.join(outputDir, "mislabeled.tgz");
	writeArtifactArchive(outputDir, mislabeled, "@corca-ai/ceal-operator-cli", "cealctl");
	assert.throws(
		() => buildCealCliReleaseManifest({
			repoRoot,
			outputDir: path.join(outputDir, "mislabeled-release"),
			artifacts: [{ id: "ceal", path: mislabeled }, { id: "cealctl", path: cealctl }],
		}),
		(error) => error instanceof CealCliReleaseManifestError && error.code === "artifact_identity_mismatch",
	);
});

function writeArtifactArchive(root, archivePath, packageName, command) {
	const staging = path.join(root, `staging-${command}-${path.basename(archivePath)}`);
	const packageDir = path.join(staging, "package");
	mkdirSync(packageDir, { recursive: true });
	writeFileSync(path.join(packageDir, "package.json"), `${JSON.stringify({
		name: packageName,
		version: "0.65.0",
		bin: { [command]: "./dist/bin.js" },
	})}\n`);
	execFileSync("tar", ["-czf", archivePath, "-C", staging, "package"]);
}

function readJson(relativePath) {
	return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function readPackageJson(name) {
	return JSON.parse(readFileSync(path.join(packageRoot, "packages", name, "package.json"), "utf8"));
}
