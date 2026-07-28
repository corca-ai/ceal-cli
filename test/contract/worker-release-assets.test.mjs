import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

import {
	composeWorkerReleaseAssets,
	mergeWorkerReleaseAssetSets,
	WorkerReleaseAssetsError,
} from "../../scripts/build-worker-release-assets.mjs";

// The installer's own allowlist, read out of the shell rather than restated
// here. It was a hand-copy, and a hand-copy of an allowlist is the shape that
// passes while the two sides disagree: dropping `darwin` from install-ceal.sh
// left both this test and the installer green, each checking a different
// contract. Deriving it means the shell is the single definition and a
// narrowing there fails here.
const INSTALLER_ALLOWLIST = installerAllowlist();

function installerAllowlist() {
	const script = readFileSync(path.join(REPO_ROOT, "install-ceal.sh"), "utf8");
	// The one `grep -Ev` in verify_checksum_inventory carries the allowlist as
	// the alternation between the checksum prefix and the anchor.
	const match = /grep -Evc '\^\[a-f0-9\]\{64\} {2}\((?<allowed>.+)\)\$'/u.exec(script);
	assert.ok(match?.groups?.allowed, "install-ceal.sh no longer carries a recognizable checksum-inventory allowlist");
	return new RegExp(`^(${match.groups.allowed})$`, "u");
}

// Deriving the allowlist proves the two sides agree, not that they agree on the
// right thing: both would still pass if the shell narrowed to linux, because no
// fixture here composes a darwin asset. The release matrix is the producer, so
// it decides what the installer must be able to accept.
function releasePlatforms() {
	const workflow = readFileSync(path.join(REPO_ROOT, ".github", "workflows", "ceal-release.yml"), "utf8");
	const platforms = parse(workflow).jobs?.build?.strategy?.matrix?.include?.map((entry) => entry.platform) ?? [];
	assert.ok(platforms.length >= 4, `ceal-release.yml build matrix names only ${platforms.length} platforms`);
	return platforms;
}

test("the installer's allowlist accepts every platform the release matrix builds", () => {
	for (const platform of releasePlatforms()) {
		for (const asset of [`ceal-${platform}`, `ceal-worker-release-manifest-${platform}.json`]) {
			assert.match(asset, INSTALLER_ALLOWLIST, `install-ceal.sh would reject ${asset}, which ceal-release.yml builds`);
		}
	}
});

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
	assert.deepEqual(
		files,
		[
			".ceal-worker-release-assets",
			"SHA256SUMS",
			"THIRD_PARTY_NOTICES.txt",
			"ceal-guide-SKILL.md",
			"ceal-linux-arm64",
			"ceal-worker-release-manifest-linux-arm64.json",
			"install-ceal.sh",
		].sort(),
	);
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
		() =>
			composeWorkerReleaseAssets(
				{
					outputDirectory: path.join(root, "version-mismatch"),
					gatewayHandoffArchive: "/unused/fixture.tar.gz",
					repoRoot: fixtureRepo(root),
					version: "0.99.0",
				},
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
	const driftedSums = readFileSync(path.join(inputs[1], "SHA256SUMS"), "utf8").replace(
		/^[a-f0-9]{64}(?= {2}ceal-guide-SKILL[.]md$)/mu,
		digest(Buffer.from("drifted guide\n")),
	);
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
	assert.match(workflow, /GATEWAY_HANDOFF_ORIGIN: https:\/\/ceal[.]borca[.]ai\/releases\/gateway-handoff/u);
	assert.match(workflow, /\$GATEWAY_HANDOFF_ORIGIN\/\$HANDOFF_RELEASE_TAG\/\$HANDOFF_ARCHIVE/u);
	// The two literals above must name the archive the lock binds. Nothing else
	// checks this, and the failure mode is the expensive one: the download
	// succeeds against a stale origin path, the digest comparison fails, and the
	// tag is burned. One clean run per tag is the contract, so this has to fail in
	// the gate rather than in the release.
	const lock = JSON.parse(readFileSync(path.join(REPO_ROOT, "gateway-handoff-lock.json"), "utf8"));
	assert.match(
		workflow,
		new RegExp(`HANDOFF_RELEASE_TAG: ${lock.gateway.tag.replaceAll(".", "[.]")}\\n`, "u"),
		"the release workflow's handoff tag must be the one gateway-handoff-lock.json binds",
	);
	assert.match(
		workflow,
		new RegExp(`HANDOFF_ARCHIVE: ${lock.archive.filename.replaceAll(".", "[.]")}\\n`, "u"),
		"the release workflow's handoff archive must be the one gateway-handoff-lock.json binds",
	);
	assert.match(workflow, /CEAL_RELEASE_ORIGIN: https:\/\/ceal[.]borca[.]ai\/releases/u);
	assert.match(workflow, /concurrency:\n {2}group: ceal-worker-release-origin\n {2}cancel-in-progress: false/u);
	assert.match(workflow, /CEAL_RELEASE_CLOUDFLARE_ACCOUNT_ID/u);
	assert.match(workflow, /CEAL_RELEASE_CLOUDFLARE_API_TOKEN/u);
	assert.match(workflow, /wrangler r2 object put[\s\S]+--remote/u);
	assert.match(workflow, /releases\/worker\/stable\/ceal-worker-stable-release[.]json/u);
	assert.match(workflow, /ceal[.]worker_stable_release[.]v1/u);
	assert.match(workflow, /sha256sums_sha256/u);
	assert.match(workflow, /stable signed-inventory pointer: advanced after immutable artifact verification/u);
	assert.doesNotMatch(workflow, /gh release/u);
	assert.doesNotMatch(workflow, /contents: write/u);
	assert.match(workflow, /ceal-release\.yml@refs\/tags\/\$TAG/u);
	assert.match(workflow, /id-token: write/u);
	assert.match(workflow, /cosign sign-blob --yes/u);
});

// The merge tooling is platform-generic, but every workflow site that names a
// platform is not. A platform present in the contract yet missing from any one
// of these sites publishes a silently partial inventory, so derive all of them
// from the contract instead of restating a platform list here.
test("worker release workflow builds, merges, and signs every contracted release platform", () => {
	const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/ceal-release.yml"), "utf8");
	const parsed = parse(workflow);
	const contract = JSON.parse(readFileSync(path.join(REPO_ROOT, "release-contract.json"), "utf8"));
	const platforms = contract.native_build_matrix.signed_release_platforms;
	assert.deepEqual([...platforms].sort(), ["darwin-amd64", "darwin-arm64", "linux-amd64", "linux-arm64"]);

	const built = parsed.jobs.build.strategy.matrix.include.map((entry) => entry.platform);
	assert.deepEqual([...built].sort(), [...platforms].sort(), "every contracted platform needs a build runner");

	// Each site is isolated: asserting against a whole job lets one site cover
	// for another, which is exactly the partial-inventory bug being guarded.
	const downloads = parsed.jobs.assemble.steps.flatMap((step) => (step.with?.name ? [step.with.name] : []));
	const merge = runStepContaining(parsed.jobs.assemble, "build-worker-release-assets.mjs merge");
	const inventory = runStepContaining(parsed.jobs["sign-and-publish"], "Unexpected worker release inventory");
	const signing = bashArray(runStepContaining(parsed.jobs["sign-and-publish"], "cosign sign-blob"), "primary");
	// The rollback lane re-verifies this same set before moving stable, so it is
	// a fifth platform-naming site and drifts silently without this assertion.
	const rollback = parse(readFileSync(path.join(REPO_ROOT, ".github/workflows/ceal-worker-stable-rollback.yml"), "utf8"));
	const rollbackSigning = bashArray(runStepContaining(rollback.jobs.rollback, "cosign verify-blob"), "primary");
	assert.deepEqual([...rollbackSigning].sort(), [...signing].sort(), "rollback must re-verify the signed set");
	const manifestLoop = /for platform in ([^;]+); do/u.exec(inventory)?.[1].trim().split(/\s+/u);

	assert.deepEqual([...manifestLoop].sort(), [...platforms].sort(), "manifest check must cover every platform");
	for (const platform of platforms) {
		assert.ok(
			downloads.some((name) => name.endsWith(`-${platform}`)),
			`assemble must download the ${platform} handoff`,
		);
		assert.ok(merge.includes(`--input "$PWD/handoff/${platform}"`), `assemble must merge the ${platform} input`);
		for (const asset of [`ceal-${platform}`, `ceal-worker-release-manifest-${platform}.json`]) {
			assert.ok(inventory.includes(asset), `the exact inventory gate must accept ${asset}`);
			assert.ok(signing.includes(asset), `the signing array must cover ${asset}`);
		}
	}
});

function runStepContaining(job, needle) {
	const found = job.steps.filter((step) => (step.run ?? "").includes(needle));
	assert.equal(found.length, 1, `expected exactly one step containing ${needle}`);
	return found[0].run;
}

// Reads `name=( ... )` as the shell would split it, so a token dropped from the
// array is visible even when the same token appears elsewhere in the step.
function bashArray(script, name) {
	const body = new RegExp(`${name}=\\(([^)]*)\\)`, "u").exec(script);
	assert.ok(body, `expected a ${name}=( ... ) array`);
	return body[1].trim().split(/\s+/u);
}

// The build job is the only one that runs on macOS runners, which ship no GNU
// coreutils; a sha256sum there fails the darwin legs and blocks every release.
test("worker release build job uses no GNU-only tool on its macOS runners", () => {
	const parsed = parse(readFileSync(path.join(REPO_ROOT, ".github/workflows/ceal-release.yml"), "utf8"));
	assert.ok(
		parsed.jobs.build.strategy.matrix.include.some((entry) => entry.runner.startsWith("macos-")),
		"this guard is only meaningful while a darwin runner exists",
	);
	// Whole-line comments are dropped: the guard is about executed commands, and
	// the step that replaced sha256sum names it while explaining why.
	const scripts = parsed.jobs.build.steps
		.flatMap((step) => (step.run ?? "").split("\n"))
		.filter((line) => !line.trimStart().startsWith("#"))
		.join("\n");
	assert.doesNotMatch(scripts, /\bsha256sum\b/u);
});

test("worker stable rollback re-verifies an immutable public tag before moving the pointer", () => {
	const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/ceal-worker-stable-rollback.yml"), "utf8");
	assert.match(workflow, /workflow_dispatch:/u);
	assert.match(workflow, /Type ROLLBACK to replace the stable pointer/u);
	assert.match(workflow, /inputs[.]confirmation == 'ROLLBACK'/u);
	assert.match(workflow, /concurrency:\n {2}group: ceal-worker-release-origin\n {2}cancel-in-progress: false/u);
	assert.match(workflow, /sha256sum -c SHA256SUMS/u);
	assert.match(workflow, /cosign verify-blob/u);
	assert.doesNotMatch(workflow, /cosign sign-blob|gh release/u);
	assert.match(workflow, /wrangler r2 object put[\s\S]+--remote/u);
	const publicProofIndex = workflow.indexOf("cosign verify-blob");
	const pointerAdvanceIndex = workflow.indexOf("releases/worker/stable/ceal-worker-stable-release.json");
	assert.ok(publicProofIndex >= 0, "rollback must verify immutable public signatures");
	assert.ok(pointerAdvanceIndex > publicProofIndex, "rollback must move stable only after immutable public proof");
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

function digest(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
