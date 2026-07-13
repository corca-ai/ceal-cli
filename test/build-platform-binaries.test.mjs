import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	buildCealCliPlatformBinaries,
	CealCliPlatformBuildError,
} from "../scripts/build-platform-binaries.mjs";

for (const platform of ["linux-arm64", "linux-amd64"]) {
	test(`builds one smoke-checked ceal and cealctl ${platform} set`, async () => {
		await withTempDir(async (root) => {
			const calls = [];
			const outputDir = path.join(root, "release");
			const result = await buildCealCliPlatformBinaries({
				version: "0.64.0",
				platform,
				outputDir,
			}, fakeDeps(calls, platform));
			assert.equal(result.ok, true);
			assert.equal(result.writes_external, false);
			assert.deepEqual(result.artifacts.map((item) => item.id), ["ceal", "cealctl"]);
			assert.deepEqual(calls.map((item) => item.kind), [
				"bundle", "blob", "runtime", "inject", "smoke",
				"bundle", "blob", "runtime", "inject", "smoke",
			]);
			const manifest = JSON.parse(readFileSync(path.join(outputDir, result.manifest.name), "utf8"));
			assert.equal(manifest.schema_version, "ceal.cli_platform_release_manifest.v1");
			assert.equal(manifest.artifact_state, "unsigned_build_output");
			assert.equal(manifest.release_version, "0.64.0");
			assert.equal(manifest.platform, platform);
			assert.deepEqual(Object.keys(manifest.artifacts), ["ceal", "cealctl"]);
			assert.deepEqual(manifest.third_party_notices, result.notices);
			const sums = readFileSync(path.join(outputDir, "SHA256SUMS"), "utf8").trim().split("\n");
			assert.equal(sums.length, 4);
			for (const item of result.artifacts) {
				assert.ok(sums.includes(`${item.sha256}  ${item.name}`));
				assert.equal(item.sha256, digest(readFileSync(path.join(outputDir, item.name))));
			}
			assert.equal(result.notices.name, "THIRD_PARTY_NOTICES.txt");
			assert.equal(result.notices.sha256, digest(readFileSync(path.join(outputDir, result.notices.name))));
		});
	});
}

test("rejects cross-platform builds, version drift, and unsafe replacement", async () => {
	await withTempDir(async (root) => {
		await assert.rejects(
			() => buildCealCliPlatformBinaries({ version: "0.64.0", platform: "darwin-arm64", outputDir: path.join(root, "unsupported") }, fakeDeps([])),
			hasCode("unsupported_platform"),
		);
		await assert.rejects(
			() => buildCealCliPlatformBinaries({ version: "0.64.0", platform: "linux-amd64", outputDir: path.join(root, "cross") }, fakeDeps([])),
			hasCode("platform_mismatch"),
		);
		await assert.rejects(
			() => buildCealCliPlatformBinaries({ version: "9.9.9", platform: "linux-arm64", outputDir: path.join(root, "version") }, fakeDeps([])),
			hasCode("version_mismatch"),
		);
		writeFileSync(path.join(root, "keep"), "keep\n");
		await assert.rejects(
			() => buildCealCliPlatformBinaries({ version: "0.64.0", platform: "linux-arm64", outputDir: root, force: true }, fakeDeps([])),
			hasCode("output_not_replaceable"),
		);
		assert.equal(readFileSync(path.join(root, "keep"), "utf8"), "keep\n");
	});
});

function fakeDeps(calls, currentPlatform = "linux-arm64") {
	return {
		currentPlatform: () => currentPlatform,
		resolvePostjectCli: () => "postject.js",
		readContract: () => ({
			repository: "corca-ai/ceal-cli",
			release_version: "0.64.0",
			protocol: {},
			first_proof_matrix: { platform: "linux-arm64" },
			native_build_matrix: { platforms: ["linux-arm64", "linux-amd64"], signed_release_platforms: ["linux-arm64"] },
			publication_blockers: [],
			non_claims: [],
		}),
		readPackageManifest: (command) => ({ version: "0.64.0", bin: { [command.id]: "./dist/bin.js" } }),
		bundle: async ({ command, bundlePath }) => {
			calls.push({ kind: "bundle", command: command.id });
			writeFileSync(bundlePath, `bundle:${command.id}\n`);
		},
		createBlob: ({ command, blobPath }) => {
			calls.push({ kind: "blob", command });
			writeFileSync(blobPath, `blob:${command}\n`);
		},
		copyRuntime: ({ artifactPath }) => {
			calls.push({ kind: "runtime", artifactPath });
			writeFileSync(artifactPath, "runtime\n");
		},
		injectBlob: ({ artifactPath }) => {
			calls.push({ kind: "inject", artifactPath });
			writeFileSync(artifactPath, `${readFileSync(artifactPath, "utf8")}blob\n`);
		},
		smoke: ({ command, expectedVersion }) => {
			calls.push({ kind: "smoke", command: command.id });
			return { ok: true, command: command.id, version: expectedVersion, help: true };
		},
	};
}

function hasCode(code) {
	return (error) => error instanceof CealCliPlatformBuildError && error.code === code;
}

async function withTempDir(callback) {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-cli-platform-test-"));
	try { await callback(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function digest(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
