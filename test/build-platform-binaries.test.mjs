import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
import {
	assertRequiredCommandDiscovery,
	buildCealCliPlatformBinaries,
	buildCurrentSource,
	CealCliPlatformBuildError,
	runCli,
} from "../scripts/build-platform-binaries.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

for (const platform of ["linux-arm64", "linux-amd64"]) {
	test(`builds one smoke-checked ceal and cealctl ${platform} set`, async () => {
		await withTempDir(async (root) => {
			const calls = [];
			const outputDir = path.join(root, "release");
			const result = await buildCealCliPlatformBinaries({
				version: "0.65.0",
				platform,
				outputDir,
			}, fakeDeps(calls, platform));
			assert.equal(result.ok, true);
			assert.equal(result.writes_external, false);
			assert.deepEqual(result.artifacts.map((item) => item.id), ["ceal", "cealctl"]);
			assert.deepEqual(result.guides.map((item) => item.id), ["ceal-guide", "cealctl-guide"]);
			assert.deepEqual(result.guides.map((item) => item.binary), ["ceal", "cealctl"]);
			assert.deepEqual(result.artifacts.map((item) => item.smoke.required_commands), [
				["session", "capabilities"],
				["login", "sessions", "logout", "access", "connectors", "enrollments"],
			]);
			assert.deepEqual(calls.map((item) => item.kind), [
				"source",
				"bundle", "blob", "runtime", "inject", "smoke",
				"bundle", "blob", "runtime", "inject", "smoke",
			]);
			const manifest = JSON.parse(readFileSync(path.join(outputDir, result.manifest.name), "utf8"));
			assert.equal(manifest.schema_version, "ceal.cli_platform_release_manifest.v1");
			assert.equal(manifest.artifact_state, "unsigned_build_output");
			assert.equal(manifest.release_version, "0.65.0");
			assert.equal(manifest.platform, platform);
			assert.deepEqual(Object.keys(manifest.artifacts), ["ceal", "cealctl"]);
			assert.deepEqual(Object.keys(manifest.guides), ["ceal-guide", "cealctl-guide"]);
			assert.deepEqual(Object.fromEntries(Object.entries(manifest.guides).map(([id, guide]) => [id, guide.binary])), {
				"ceal-guide": "ceal",
				"cealctl-guide": "cealctl",
			});
			assert.deepEqual(manifest.third_party_notices, result.notices);
			const sums = readFileSync(path.join(outputDir, "SHA256SUMS"), "utf8").trim().split("\n");
			assert.equal(sums.length, 6);
			for (const item of result.artifacts) {
				assert.ok(sums.includes(`${item.sha256}  ${item.name}`));
				assert.equal(item.sha256, digest(readFileSync(path.join(outputDir, item.name))));
			}
			for (const item of result.guides) {
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
			() => buildCealCliPlatformBinaries({ version: "0.65.0", platform: "darwin-arm64", outputDir: path.join(root, "unsupported") }, fakeDeps([])),
			hasCode("unsupported_platform"),
		);
		await assert.rejects(
			() => buildCealCliPlatformBinaries({ version: "0.65.0", platform: "linux-amd64", outputDir: path.join(root, "cross") }, fakeDeps([])),
			hasCode("platform_mismatch"),
		);
		await assert.rejects(
			() => buildCealCliPlatformBinaries({ version: "9.9.9", platform: "linux-arm64", outputDir: path.join(root, "version") }, fakeDeps([])),
			hasCode("version_mismatch"),
		);
		writeFileSync(path.join(root, "keep"), "keep\n");
		await assert.rejects(
			() => buildCealCliPlatformBinaries({ version: "0.65.0", platform: "linux-arm64", outputDir: root, force: true }, fakeDeps([])),
			hasCode("output_not_replaceable"),
		);
		assert.equal(readFileSync(path.join(root, "keep"), "utf8"), "keep\n");
	});
});

test("builds current source once before bundling either command", async () => {
	await withTempDir(async (root) => {
		const calls = [];
		await buildCealCliPlatformBinaries({
			version: "0.65.0",
			platform: "linux-arm64",
			outputDir: path.join(root, "release"),
		}, fakeDeps(calls));
		assert.equal(calls.filter((item) => item.kind === "source").length, 1);
		assert.equal(calls[0].kind, "source");
		assert.equal(calls[1].kind, "bundle");
	});
});

test("rejects release output that overlaps a package build tree before source cleanup", async () => {
	await withTempDir(async (root) => {
		const linkedOutput = path.join(root, "linked-output");
		symlinkSync(path.join(REPO_ROOT, "packages", "ceal-worker-cli", "dist"), linkedOutput, "dir");
		for (const outputDir of [
			path.join(REPO_ROOT, "packages"),
			path.join(REPO_ROOT, "packages", "ceal-worker-cli", "dist"),
			path.join(REPO_ROOT, "packages", "ceal-worker-cli", "dist", "release"),
			linkedOutput,
			path.join(linkedOutput, "release"),
		]) {
			const calls = [];
			await assert.rejects(
				() => buildCealCliPlatformBinaries({ version: "0.65.0", platform: "linux-arm64", outputDir }, fakeDeps(calls)),
				hasCode("unsafe_output"),
			);
			assert.deepEqual(calls, []);
		}
	});
});

test("current source build evicts every stale package output before compilation", async () => {
	await withTempDir(async (root) => {
		const packageDirs = ["ceal-protocol", "ceal-client", "ceal-worker-cli", "ceal-operator-cli"];
		for (const packageDir of packageDirs) {
			const dist = path.join(root, "packages", packageDir, "dist");
			mkdirSync(dist, { recursive: true });
			writeFileSync(path.join(dist, "bin.js"), "stale checkout output\n");
		}
		let compiled = false;
		buildCurrentSource({
			root,
			runBuild: () => {
				for (const packageDir of packageDirs) assert.equal(existsSync(path.join(root, "packages", packageDir, "dist")), false);
				compiled = true;
			},
		});
		assert.equal(compiled, true);
	});
});

test("source build failure precedes release output mutation", async () => {
	await withTempDir(async (root) => {
		const outputDir = path.join(root, "release");
		const workingDeps = fakeDeps([]);
		await buildCealCliPlatformBinaries({ version: "0.65.0", platform: "linux-arm64", outputDir }, workingDeps);
		const existingArtifact = readFileSync(path.join(outputDir, "ceal-linux-arm64"));
		const deps = fakeDeps([]);
		deps.buildSource = () => { throw new Error("compiler details stay private"); };
		await assert.rejects(
			() => buildCealCliPlatformBinaries({ version: "0.65.0", platform: "linux-arm64", outputDir, force: true }, deps),
			hasCode("build_failed"),
		);
		assert.deepEqual(readFileSync(path.join(outputDir, "ceal-linux-arm64")), existingArtifact);
	});
});

test("CLI reports source build failure as one bounded JSON document", async () => {
	await withTempDir(async (root) => {
		const deps = fakeDeps([]);
		deps.buildSource = () => { throw new Error("sensitive compiler details"); };
		const lines = [];
		const status = await runCli([
			"--version", "0.65.0",
			"--platform", "linux-arm64",
			"--out", path.join(root, "release"),
			"--json",
		], { log: (line) => lines.push(line), error: (line) => lines.push(line) }, deps);
		assert.equal(status, 2);
		assert.equal(lines.length, 1);
		assert.deepEqual(JSON.parse(lines[0]), {
			schema_version: "ceal.cli_platform_binary_build_error.v1",
			ok: false,
			error_code: "build_failed",
			message: "Could not build Ceal CLI platform binaries.",
		});
		assert.doesNotMatch(lines[0], /sensitive/u);
	});
});

test("rejects platform artifacts that omit required enrollment workflow commands", () => {
	assert.doesNotThrow(() => assertRequiredCommandDiscovery(["version", "session", "capabilities"], ["session", "capabilities"]));
	assert.throws(
		() => assertRequiredCommandDiscovery(["version", "capabilities"], ["session", "capabilities"]),
		hasCode("smoke_failed"),
	);
	assert.doesNotThrow(() => assertRequiredCommandDiscovery(
		["version", "login", "sessions", "logout", "access", "connectors", "enrollments"],
		["login", "sessions", "logout", "access", "connectors", "enrollments"],
	));
	assert.throws(
		() => assertRequiredCommandDiscovery(["version", "enrollments"], ["login", "sessions", "logout", "access", "connectors", "enrollments"], "cealctl"),
		(error) => hasCode("smoke_failed")(error)
			&& error.message === "Built cealctl command discovery omitted required commands: login, sessions, logout, access, connectors.",
	);
});

function fakeDeps(calls, currentPlatform = "linux-arm64") {
	return {
		buildSource: () => {
			calls.push({ kind: "source" });
		},
		currentPlatform: () => currentPlatform,
		resolvePostjectCli: () => "postject.js",
		readContract: () => ({
			repository: "corca-ai/ceal-cli",
			release_version: "0.65.0",
			protocol: {},
			guides: fakeGuideContract(),
			first_proof_matrix: { platform: "linux-arm64" },
			native_build_matrix: { platforms: ["linux-arm64", "linux-amd64"], signed_release_platforms: ["linux-arm64", "linux-amd64"] },
			publication_blockers: [],
			non_claims: [],
		}),
		readPackageManifest: (command) => ({ version: "0.65.0", bin: { [command.id]: "./dist/bin.js" } }),
		readGuide: () => Buffer.from("fake signed guide\n"),
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
			return {
				ok: true,
				command: command.id,
				version: expectedVersion,
				help: true,
				required_commands: command.requiredCommands,
			};
		},
	};
}

function fakeGuideContract() {
	const sha256 = digest(Buffer.from("fake signed guide\n"));
	return {
		"ceal-guide": { path: "skills/ceal-guide/SKILL.md", asset: "ceal-guide-SKILL.md", binary: "ceal", sha256 },
		"cealctl-guide": { path: "skills/cealctl-guide/SKILL.md", asset: "cealctl-guide-SKILL.md", binary: "cealctl", sha256 },
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
