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
	parsePublishedWorkerReleaseInventory,
	WorkerReleaseAssetsError,
} from "../../scripts/build-worker-release-assets.mjs";
import {
	readControlSessionContract,
	verifyEmbeddedCarrierContractSource,
	verifyEmbeddedControlSessionContractSource,
	verifyEmbeddedGatewayLeasedConsumerHandoffSource,
} from "../../scripts/generate-leased-consumer-handoff-runtime.mjs";

const CARRIER_CONTRACT_PATH = path.join(REPO_ROOT, "packages", "ceal-worker-cli", "leased-consumer-carrier-contract.json");
const CARRIER_CONTRACT_BYTES = readFileSync(CARRIER_CONTRACT_PATH);
const CARRIER_CONTRACT = JSON.parse(CARRIER_CONTRACT_BYTES.toString("utf8"));
const CARRIER_CONTRACT_SHA256 = digest(CARRIER_CONTRACT_BYTES);
const CONTROL_SESSION_CONTRACT_PATH = path.join(REPO_ROOT, "packages", "ceal-worker-cli", "leased-consumer-control-session-contract.json");
const CONTROL_SESSION_CONTRACT_BYTES = readFileSync(CONTROL_SESSION_CONTRACT_PATH);
const CONTROL_SESSION_CONTRACT = JSON.parse(CONTROL_SESSION_CONTRACT_BYTES.toString("utf8"));
const CONTROL_SESSION_CONTRACT_SHA256 = digest(CONTROL_SESSION_CONTRACT_BYTES);
const CARRIER_HANDOFF = verifyEmbeddedGatewayLeasedConsumerHandoffSource({ repoRoot: REPO_ROOT });

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
	assert.ok(platforms.length >= 3, `ceal-release.yml build matrix names only ${platforms.length} platforms`);
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
	assert.equal(manifest.private_leased_consumer_carrier.contract_json, CARRIER_CONTRACT_BYTES.toString("utf8"));
	assert.equal(manifest.private_leased_consumer_carrier.contract_sha256, CARRIER_CONTRACT_SHA256);
	assert.equal(manifest.private_leased_consumer_control_session.contract_json, CONTROL_SESSION_CONTRACT_BYTES.toString("utf8"));
	assert.equal(manifest.private_leased_consumer_control_session.contract_sha256, CONTROL_SESSION_CONTRACT_SHA256);
	assert.deepEqual(manifest.private_leased_consumer_handoff, CARRIER_HANDOFF);
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
	await assert.rejects(
		() =>
			composeWorkerReleaseAssets(
				{ outputDirectory: path.join(root, "carrier-drift"), gatewayHandoffArchive: "/unused/fixture.tar.gz", repoRoot: fixtureRepo(root) },
				{ buildNative: fakeNativeBuild("linux-arm64", "0.65.0", { carrierSha256: "f".repeat(64) }) },
			),
		hasCode("private_carrier_contract_drift"),
	);
	await assert.rejects(
		() =>
			composeWorkerReleaseAssets(
				{
					outputDirectory: path.join(root, "control-session-drift"),
					gatewayHandoffArchive: "/unused/fixture.tar.gz",
					repoRoot: fixtureRepo(root),
				},
				{ buildNative: fakeNativeBuild("linux-arm64", "0.65.0", { controlSessionSha256: "f".repeat(64) }) },
			),
		hasCode("private_control_session_contract_drift"),
	);
});

test("native source verification refuses a stale generated carrier contract before bundling", (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-carrier-generated-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const generated = path.join(root, "packages", "ceal-worker-cli", "src", "generated");
	mkdirSync(generated, { recursive: true });
	writeFileSync(path.join(root, "packages", "ceal-worker-cli", "leased-consumer-carrier-contract.json"), CARRIER_CONTRACT_BYTES);
	writeFileSync(
		path.join(generated, "leased-consumer-carrier-contract.ts"),
		'export const LEASED_CONSUMER_CARRIER_CONTRACT_JSON = "{}" as const;\nexport const LEASED_CONSUMER_CARRIER_CONTRACT_SHA256 = "' +
			"0".repeat(64) +
			'" as const;\n',
	);
	assert.throws(() => verifyEmbeddedCarrierContractSource({ repoRoot: root }), /embedded_carrier_contract_drift/u);
});

test("native source verification refuses a stale generated control-session contract before bundling", (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-control-session-generated-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const generated = path.join(root, "packages", "ceal-worker-cli", "src", "generated");
	mkdirSync(generated, { recursive: true });
	writeFileSync(
		path.join(root, "packages", "ceal-worker-cli", "leased-consumer-control-session-contract.json"),
		CONTROL_SESSION_CONTRACT_BYTES,
	);
	writeFileSync(
		path.join(root, "gateway-protocol-handoff-lock.json"),
		readFileSync(path.join(REPO_ROOT, "gateway-protocol-handoff-lock.json")),
	);
	writeFileSync(
		path.join(generated, "leased-consumer-control-session-contract.ts"),
		'export const LEASED_CONSUMER_CONTROL_SESSION_CONTRACT_JSON = "{}" as const;\nexport const LEASED_CONSUMER_CONTROL_SESSION_CONTRACT_SHA256 = "' +
			"0".repeat(64) +
			'" as const;\n',
	);
	assert.throws(() => verifyEmbeddedControlSessionContractSource({ repoRoot: root }), /embedded_control_session_contract_drift/u);
});

test("private control-session release input accepts only its exact capability-control v4 grammar pair", (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-control-session-contract-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const contractPath = path.join(root, "packages", "ceal-worker-cli", "leased-consumer-control-session-contract.json");
	mkdirSync(path.dirname(contractPath), { recursive: true });
	writeFileSync(
		path.join(root, "gateway-protocol-handoff-lock.json"),
		readFileSync(path.join(REPO_ROOT, "gateway-protocol-handoff-lock.json")),
	);
	writeFileSync(contractPath, CONTROL_SESSION_CONTRACT_BYTES);
	const accepted = readControlSessionContract(contractPath, { repoRoot: root }).value;
	assert.equal(accepted.agent_ipc.request_schema_version, "ceal.leased_consumer_capability_control_request.v4");
	assert.equal(accepted.schema_version, "ceal.worker_private_leased_consumer_control_session_contract.v2");
	assert.deepEqual(accepted.gateway.operation_deadline_bounds_ms, { minimum: 30000, maximum: 600000 });
	const legacyDeadline = JSON.parse(CONTROL_SESSION_CONTRACT_BYTES);
	legacyDeadline.gateway.operation_deadline_ms = 30000;
	delete legacyDeadline.gateway.operation_deadline_bounds_ms;
	writeFileSync(contractPath, `${JSON.stringify(legacyDeadline, null, 2)}\n`);
	assert.throws(() => readControlSessionContract(contractPath, { repoRoot: root }), /invalid_control_session_contract/u);
	const wideBounds = JSON.parse(CONTROL_SESSION_CONTRACT_BYTES);
	wideBounds.gateway.operation_deadline_bounds_ms.maximum = 700000;
	writeFileSync(contractPath, `${JSON.stringify(wideBounds, null, 2)}\n`);
	assert.throws(() => readControlSessionContract(contractPath, { repoRoot: root }), /invalid_control_session_contract/u);
	const mixed = JSON.parse(CONTROL_SESSION_CONTRACT_BYTES);
	mixed.agent_ipc.response_schema_version = "ceal.leased_consumer_control_response.v1";
	writeFileSync(contractPath, `${JSON.stringify(mixed, null, 2)}\n`);
	assert.throws(() => readControlSessionContract(contractPath, { repoRoot: root }), /invalid_control_session_contract/u);
	const stalePathContract = JSON.parse(CONTROL_SESSION_CONTRACT_BYTES);
	stalePathContract.gateway.socket_path = "/run/ceal/leased-consumer-control-v1.sock";
	writeFileSync(contractPath, `${JSON.stringify(stalePathContract, null, 2)}\n`);
	assert.throws(() => readControlSessionContract(contractPath, { repoRoot: root }), /invalid_control_session_contract/u);
});

test("native source verification refuses a stale generated Gateway handoff before bundling", (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-handoff-generated-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	writeGatewayHandoffFixture(root);
	const generated = path.join(root, "packages", "ceal-worker-cli", "src", "generated", "leased-consumer-handoff.ts");
	const source = readFileSync(generated, "utf8");
	writeFileSync(
		generated,
		source.replace(
			/GATEWAY_LEASED_CONSUMER_HANDOFF_SHA256 = "[a-f0-9]{64}"/u,
			`GATEWAY_LEASED_CONSUMER_HANDOFF_SHA256 = "${"0".repeat(64)}"`,
		),
	);
	assert.throws(
		() => verifyEmbeddedGatewayLeasedConsumerHandoffSource({ repoRoot: root }),
		/embedded_gateway_leased_consumer_handoff_drift/u,
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

	const platformManifest = path.join(inputs[1], "ceal-worker-release-manifest-linux-amd64.json");
	const originalManifest = readFileSync(platformManifest);
	const driftedManifest = JSON.parse(originalManifest);
	driftedManifest.private_leased_consumer_carrier.contract_json = "{}";
	writeFileSync(platformManifest, `${JSON.stringify(driftedManifest, null, 2)}\n`);
	rewriteInventoryDigest(inputs[1], path.basename(platformManifest));
	assert.throws(
		() => mergeWorkerReleaseAssetSets({ outputDirectory: path.join(root, "merged-carrier-drift"), inputs, repoRoot }),
		hasCode("merge_private_carrier_contract_drift"),
	);
	writeFileSync(platformManifest, originalManifest);
	rewriteInventoryDigest(inputs[1], path.basename(platformManifest));

	const driftedHandoff = JSON.parse(readFileSync(platformManifest, "utf8"));
	driftedHandoff.private_leased_consumer_handoff.sha256 = "0".repeat(64);
	writeFileSync(platformManifest, `${JSON.stringify(driftedHandoff, null, 2)}\n`);
	rewriteInventoryDigest(inputs[1], path.basename(platformManifest));
	assert.throws(
		() => mergeWorkerReleaseAssetSets({ outputDirectory: path.join(root, "merged-handoff-drift"), inputs, repoRoot }),
		hasCode("merge_private_carrier_handoff_drift"),
	);
	writeFileSync(platformManifest, originalManifest);
	rewriteInventoryDigest(inputs[1], path.basename(platformManifest));

	const driftedControlSession = JSON.parse(readFileSync(platformManifest, "utf8"));
	driftedControlSession.private_leased_consumer_control_session.contract_json = "{}";
	writeFileSync(platformManifest, `${JSON.stringify(driftedControlSession, null, 2)}\n`);
	rewriteInventoryDigest(inputs[1], path.basename(platformManifest));
	assert.throws(
		() => mergeWorkerReleaseAssetSets({ outputDirectory: path.join(root, "merged-control-session-drift"), inputs, repoRoot }),
		hasCode("merge_private_control_session_contract_drift"),
	);
	writeFileSync(platformManifest, originalManifest);
	rewriteInventoryDigest(inputs[1], path.basename(platformManifest));

	const identicallyDriftedControlSession = JSON.parse(originalManifest);
	identicallyDriftedControlSession.private_leased_consumer_control_session.contract_json = "{}";
	identicallyDriftedControlSession.private_leased_consumer_control_session.contract_sha256 = "0".repeat(64);
	for (const input of inputs) {
		const manifestPath = path.join(
			input,
			`ceal-worker-release-manifest-${input.endsWith("linux-amd64") ? "linux-amd64" : "linux-arm64"}.json`,
		);
		writeFileSync(manifestPath, `${JSON.stringify(identicallyDriftedControlSession, null, 2)}\n`);
		rewriteInventoryDigest(input, path.basename(manifestPath));
	}
	assert.throws(
		() => mergeWorkerReleaseAssetSets({ outputDirectory: path.join(root, "merged-identical-control-session-drift"), inputs, repoRoot }),
		hasCode("merge_private_control_session_contract_drift"),
	);
	for (const input of inputs) {
		const manifestPath = path.join(
			input,
			`ceal-worker-release-manifest-${input.endsWith("linux-amd64") ? "linux-amd64" : "linux-arm64"}.json`,
		);
		writeFileSync(manifestPath, originalManifest);
		rewriteInventoryDigest(input, path.basename(manifestPath));
	}

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
	assert.match(workflow, /gateway-protocol-handoff-lock\.json/u);
	assert.match(workflow, /build-worker-release-assets\.mjs compose/u);
	assert.match(workflow, /build-worker-release-assets\.mjs merge/u);
	assert.doesNotMatch(workflow, /cealctl-linux/u);
	assert.doesNotMatch(workflow, /cealctl-guide/u);
	assert.match(workflow, /\$GATEWAY_HANDOFF_ORIGIN\/\$HANDOFF_RELEASE_TAG\/\$HANDOFF_ARCHIVE/u);
	// The three literals below must name the archive the lock binds. The origin
	// used to be asserted as its own hard-coded string, which is the one of the
	// three that cannot self-heal from a lock bump: moving to a new handoff origin
	// left a passing literal describing the old path. It is derived from the lock
	// now, like the other two. Nothing else
	// checks this, and the failure mode is the expensive one: the download
	// succeeds against a stale origin path, the digest comparison fails, and the
	// tag is burned. One clean run per tag is the contract, so this has to fail in
	// the gate rather than in the release.
	const lock = JSON.parse(readFileSync(path.join(REPO_ROOT, "gateway-protocol-handoff-lock.json"), "utf8"));
	assert.match(
		workflow,
		new RegExp(`GATEWAY_HANDOFF_ORIGIN: ${lock.gateway.origin.replaceAll(".", "[.]")}\\n`, "u"),
		"the release workflow's handoff origin must be the one gateway-protocol-handoff-lock.json binds",
	);
	assert.match(
		workflow,
		new RegExp(`HANDOFF_RELEASE_TAG: ${lock.gateway.tag.replaceAll(".", "[.]")}\\n`, "u"),
		"the release workflow's handoff tag must be the one gateway-protocol-handoff-lock.json binds",
	);
	assert.match(
		workflow,
		new RegExp(`HANDOFF_ARCHIVE: ${lock.archive.filename.replaceAll(".", "[.]")}\\n`, "u"),
		"the release workflow's handoff archive must be the one gateway-protocol-handoff-lock.json binds",
	);
	assert.match(workflow, /CEAL_RELEASE_ORIGIN: https:\/\/ceal[.]borca[.]ai\/releases/u);
	// The platform proofs build a SEA and run an installer for
	// PLATFORM_PROOF_PLATFORM, so demanding them anywhere else converts a correct
	// skip into a hard failure. `startsWith(matrix.platform, 'linux-')` did
	// exactly that on the linux-arm64 leg and burned ceal-v0.67.0 — the first
	// release after the flag landed. No check.yml leg is arm64, so this gate is
	// the only thing between that mistake and another burned tag.
	assert.match(
		workflow,
		/CEAL_REQUIRE_PLATFORM_PROOFS: \$\{\{ matrix[.]platform == 'linux-amd64' && '1' \|\| '0' \}\}/u,
		"the release lane must demand platform proofs only on the leg that can run them",
	);
	assert.doesNotMatch(
		workflow,
		/CEAL_REQUIRE_PLATFORM_PROOFS: \$\{\{ startsWith\(/u,
		"a prefix match over platforms demands proofs on legs that cannot run them",
	);
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
	assert.deepEqual([...platforms].sort(), ["darwin-arm64", "linux-amd64", "linux-arm64"]);

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
	const rollbackInventory = runStepContaining(rollback.jobs.rollback, "parsePublishedWorkerReleaseInventory");
	const rollbackSignature = runStepContaining(rollback.jobs.rollback, "SHA256SUMS.pem");
	assert.match(rollbackInventory, /Verify the signed inventory itself before it is allowed to name any[\s\S]+later URL/u);
	assert.match(rollbackSignature, /cosign verify-blob/u);
	assert.ok(
		rollbackSignature.indexOf("cosign verify-blob") < rollbackInventory.indexOf("parsePublishedWorkerReleaseInventory"),
		"rollback must verify SHA256SUMS before parsing its asset names",
	);
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

test("published worker inventory parser accepts both historical and current release platform sets", () => {
	assert.deepEqual(
		parsePublishedWorkerReleaseInventory(publishedInventory(["linux-arm64", "linux-amd64", "darwin-arm64", "darwin-amd64"])),
		[
			"THIRD_PARTY_NOTICES.txt",
			"ceal-darwin-amd64",
			"ceal-darwin-arm64",
			"ceal-guide-SKILL.md",
			"ceal-linux-amd64",
			"ceal-linux-arm64",
			"ceal-worker-release-manifest-darwin-amd64.json",
			"ceal-worker-release-manifest-darwin-arm64.json",
			"ceal-worker-release-manifest-linux-amd64.json",
			"ceal-worker-release-manifest-linux-arm64.json",
			"install-ceal.sh",
		],
	);
	assert.equal(parsePublishedWorkerReleaseInventory(publishedInventory(["linux-arm64", "linux-amd64", "darwin-arm64"])).length, 9);
});

test("published worker inventory parser rejects duplicate, partial, and widened rollback input", () => {
	const complete = publishedInventory(["linux-arm64"]);
	assert.throws(
		() => parsePublishedWorkerReleaseInventory(`${complete}${complete.split("\n")[0]}\n`),
		hasCode("published_inventory_malformed"),
	);
	assert.throws(
		() => parsePublishedWorkerReleaseInventory(complete.replace("ceal-worker-release-manifest-linux-arm64.json", "unexpected.bin")),
		hasCode("published_inventory_malformed"),
	);
	assert.throws(
		() => parsePublishedWorkerReleaseInventory(complete.replace(/^.*ceal-linux-arm64\n/mu, "")),
		hasCode("published_inventory_malformed"),
	);
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

function publishedInventory(platforms) {
	const names = [
		"THIRD_PARTY_NOTICES.txt",
		"ceal-guide-SKILL.md",
		"install-ceal.sh",
		...platforms.flatMap((platform) => [`ceal-${platform}`, `ceal-worker-release-manifest-${platform}.json`]),
	];
	return `${names.map((name) => `${digest(name)}  ${name}`).join("\n")}\n`;
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

function fakeNativeBuild(
	platform,
	version,
	{
		carrierContract = CARRIER_CONTRACT,
		carrierSha256 = CARRIER_CONTRACT_SHA256,
		controlSessionContract = CONTROL_SESSION_CONTRACT,
		controlSessionSha256 = CONTROL_SESSION_CONTRACT_SHA256,
		carrierHandoff = CARRIER_HANDOFF,
	} = {},
) {
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
			private_leased_consumer_carrier: { contract: carrierContract, sha256: carrierSha256 },
			private_leased_consumer_control_session: { contract: controlSessionContract, sha256: controlSessionSha256 },
			private_leased_consumer_handoff: carrierHandoff,
			native_smoke: { command: "ceal", version, operator_surface_absent: true },
		};
	};
}

function fixtureRepo(root) {
	const repo = path.join(root, "repo");
	mkdirSync(repo, { recursive: true });
	writeFileSync(path.join(repo, "install-ceal.sh"), "#!/usr/bin/env sh\nexit 0\n", { mode: 0o755 });
	const contractDirectory = path.join(repo, "packages", "ceal-worker-cli");
	mkdirSync(contractDirectory, { recursive: true });
	writeFileSync(path.join(contractDirectory, "leased-consumer-carrier-contract.json"), CARRIER_CONTRACT_BYTES);
	writeFileSync(path.join(contractDirectory, "leased-consumer-control-session-contract.json"), CONTROL_SESSION_CONTRACT_BYTES);
	writeFileSync(
		path.join(repo, "gateway-protocol-handoff-lock.json"),
		readFileSync(path.join(REPO_ROOT, "gateway-protocol-handoff-lock.json")),
	);
	writeGatewayHandoffFixture(repo);
	return repo;
}

function writeGatewayHandoffFixture(root) {
	const vendor = path.join(root, "vendor", "gateway-leased-consumer-call");
	const generated = path.join(root, "packages", "ceal-worker-cli", "src", "generated");
	mkdirSync(vendor, { recursive: true });
	mkdirSync(generated, { recursive: true });
	writeFileSync(
		path.join(root, "gateway-leased-consumer-call-handoff-lock.json"),
		readFileSync(path.join(REPO_ROOT, "gateway-leased-consumer-call-handoff-lock.json")),
	);
	writeFileSync(
		path.join(vendor, "gateway-leased-consumer-call-conformance.json"),
		readFileSync(path.join(REPO_ROOT, "vendor", "gateway-leased-consumer-call", "gateway-leased-consumer-call-conformance.json")),
	);
	writeFileSync(
		path.join(generated, "leased-consumer-handoff.ts"),
		readFileSync(path.join(REPO_ROOT, "packages", "ceal-worker-cli", "src", "generated", "leased-consumer-handoff.ts")),
	);
}

function hasCode(code) {
	return (error) => error instanceof WorkerReleaseAssetsError && error.code === code;
}

function digest(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function rewriteInventoryDigest(directory, name) {
	const inventory = path.join(directory, "SHA256SUMS");
	const digestLine = `${digest(readFileSync(path.join(directory, name)))}  ${name}`;
	writeFileSync(inventory, readFileSync(inventory, "utf8").replace(new RegExp(`^[a-f0-9]{64}  ${name}$`, "mu"), digestLine));
}
