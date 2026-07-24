import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import {
	composeWorkerReleaseAssets,
	mergeWorkerReleaseAssetSets,
	WorkerReleaseAssetsError,
} from "../scripts/build-worker-release-assets.mjs";

// The installer accepts exactly this shape; keep the two allowlists aligned.
const INSTALLER_ALLOWLIST = /^(THIRD_PARTY_NOTICES[.]txt|ceal-worker-release-manifest-(linux|darwin)-(amd64|arm64)[.]json|ceal-guide-SKILL[.]md|ceal-(linux|darwin)-(amd64|arm64)|install-ceal[.]sh)$/u;

test("composed worker release assets match the installer's signed inventory contract", async (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-assets-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const output = path.join(root, "assets-linux-arm64");
	const result = await composeWorkerReleaseAssets(
		{ outputDirectory: output, gatewayHandoffArchive: "/unused/fixture.tar.gz", repoRoot: fixtureRepo(root) },
		{ buildNative: fakeNativeBuild("linux-arm64", "0.65.0") },
	);
	assert.equal(result.ok, true);
	assert.equal(result.platform, "linux-arm64");
	assert.equal(result.version, "0.65.0");
	const files = readdirSync(output).sort();
	assert.deepEqual(files, [
		".ceal-worker-release-assets", "SHA256SUMS", "THIRD_PARTY_NOTICES.txt", "ceal-guide-SKILL.md",
		"ceal-linux-arm64", "ceal-worker-release-manifest-linux-arm64.json", "install-ceal.sh",
	].sort());
	const sums = readFileSync(path.join(output, "SHA256SUMS"), "utf8").trim().split("\n");
	assert.equal(sums.length, 5);
	for (const line of sums) {
		const name = line.slice(66);
		assert.match(name, INSTALLER_ALLOWLIST);
		assert.equal(line.slice(0, 64), digest(readFileSync(path.join(output, name))));
	}
	const manifest = JSON.parse(readFileSync(path.join(output, "ceal-worker-release-manifest-linux-arm64.json"), "utf8"));
	assert.equal(manifest.schema_version, "ceal.worker_release_manifest.v1");
	assert.equal(manifest.version, "0.65.0");
	assert.equal(manifest.platform, "linux-arm64");
	assert.equal(manifest.command, "ceal");
	assert.equal(manifest.guide.name, "ceal-guide-SKILL.md");
	assert.equal(manifest.guide.sha256, digest(readFileSync(path.join(output, "ceal-guide-SKILL.md"))));
	assert.equal(manifest.installer.sha256, digest(readFileSync(path.join(output, "install-ceal.sh"))));
	await assert.rejects(
		() => composeWorkerReleaseAssets(
			{ outputDirectory: path.join(root, "version-mismatch"), gatewayHandoffArchive: "/unused/fixture.tar.gz", repoRoot: fixtureRepo(root), version: "0.99.0" },
			{ buildNative: fakeNativeBuild("linux-arm64", "0.65.0") },
		),
		hasCode("version_mismatch"),
	);
});

test("merged worker release sets stay pair-complete with byte-identical shared assets", async (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-assets-merge-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const repoRoot = fixtureRepo(root);
	const inputs = [];
	for (const platform of ["linux-arm64", "linux-amd64"]) {
		const output = path.join(root, `assets-${platform}`);
		await composeWorkerReleaseAssets(
			{ outputDirectory: output, gatewayHandoffArchive: "/unused/fixture.tar.gz", repoRoot },
			{ buildNative: fakeNativeBuild(platform, "0.65.0") },
		);
		inputs.push(output);
	}
	const merged = path.join(root, "merged");
	const result = mergeWorkerReleaseAssetSets({ outputDirectory: merged, inputs, repoRoot });
	assert.equal(result.ok, true);
	assert.deepEqual(result.platforms, ["linux-amd64", "linux-arm64"]);
	assert.equal(result.entry_count, 7);
	const sums = readFileSync(path.join(merged, "SHA256SUMS"), "utf8").trim().split("\n");
	assert.equal(sums.length, 7);
	for (const line of sums) assert.match(line.slice(66), INSTALLER_ALLOWLIST);

	writeFileSync(path.join(inputs[1], "ceal-guide-SKILL.md"), "drifted guide\n");
	const driftedSums = readFileSync(path.join(inputs[1], "SHA256SUMS"), "utf8")
		.replace(/^[a-f0-9]{64}(?=  ceal-guide-SKILL[.]md$)/mu, digest(Buffer.from("drifted guide\n")));
	writeFileSync(path.join(inputs[1], "SHA256SUMS"), driftedSums);
	assert.throws(
		() => mergeWorkerReleaseAssetSets({ outputDirectory: path.join(root, "merged-drift"), inputs, repoRoot }),
		hasCode("merge_shared_drift"),
	);

	rmSync(path.join(inputs[0], "ceal-worker-release-manifest-linux-arm64.json"));
	assert.throws(
		() => mergeWorkerReleaseAssetSets({ outputDirectory: path.join(root, "merged-incomplete"), inputs: [inputs[0]], repoRoot }),
		hasCode("merge_input_incomplete"),
	);
});

test("worker release workflow signs only the worker inventory from the locked archive", () => {
	const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/ceal-release.yml"), "utf8");
	assert.match(workflow, /tags:\n {6}- "ceal-v\*\.\*\.\*"/u);
	assert.match(workflow, /gateway-handoff-lock\.json/u);
	assert.match(workflow, /build-worker-release-assets\.mjs compose/u);
	assert.match(workflow, /build-worker-release-assets\.mjs merge/u);
	assert.doesNotMatch(workflow, /cealctl-linux/u);
	assert.doesNotMatch(workflow, /cealctl-guide/u);
	assert.match(workflow, /--prerelease --verify-tag/u);
	assert.match(workflow, /ceal-release\.yml@refs\/tags\/\$TAG/u);
	assert.match(workflow, /id-token: write/u);
	assert.match(workflow, /cosign sign-blob --yes/u);
});

function fakeNativeBuild(platform, version) {
	return async ({ outputDirectory }) => {
		mkdirSync(outputDirectory, { recursive: true });
		const binary = Buffer.from(`native-${platform}\n`);
		writeFileSync(path.join(outputDirectory, `ceal-${platform}`), binary, { mode: 0o755 });
		writeFileSync(path.join(outputDirectory, "ceal-guide-SKILL.md"), "---\nname: ceal-guide\n");
		writeFileSync(path.join(outputDirectory, "THIRD_PARTY_NOTICES.txt"), "notice\n");
		return {
			ok: true,
			version,
			platform,
			artifact: { name: `ceal-${platform}`, bytes: binary.length, sha256: digest(binary) },
			protocol: { package: "@corca-ai/ceal-protocol", version, sha256: "0".repeat(64) },
			native_smoke: { command: "ceal", version, operator_surface_absent: true },
		};
	};
}

function fixtureRepo(root) {
	const repo = path.join(root, "repo");
	mkdirSync(repo, { recursive: true });
	writeFileSync(path.join(repo, "install-ceal.sh"), "#!/usr/bin/env sh\nexit 0\n", { mode: 0o755 });
	return repo;
}

function hasCode(code) {
	return (error) => error instanceof WorkerReleaseAssetsError && error.code === code;
}

function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
