import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import type { BinaryLike } from "node:crypto";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

import type { buildWorkerNativeArtifact } from "../../scripts/build-worker-native-artifact.ts";
import {
	composeWorkerReleaseAssets,
	mergeWorkerReleaseAssetSets,
	parsePublishedWorkerReleaseInventory,
	runCli,
	WorkerReleaseAssetsError,
} from "../../scripts/build-worker-release-assets.ts";
import {
	readControlSessionContract,
	verifyEmbeddedCarrierContractSource,
	verifyEmbeddedControlSessionContractSource,
	verifyEmbeddedGatewayLeasedConsumerHandoffSource,
} from "../../scripts/generate-leased-consumer-handoff-runtime.ts";
import { inspectOutputDirectory, publishOutputDirectory } from "../../scripts/lib/output-directory.ts";
import { createSkillDirectoryBundle } from "../../scripts/lib/skill-directory-bundle.ts";
import { assertCliFailureChannels } from "../cli-failure-channels.ts";
import { runFixtureGit } from "../converged-protocol-repo-fixture.ts";
import { required as requiredValue } from "../required.ts";

const CARRIER_CONTRACT_PATH = path.join(REPO_ROOT, "packages", "ceal-worker-cli", "leased-consumer-carrier-contract.json");
const CARRIER_CONTRACT_BYTES = readFileSync(CARRIER_CONTRACT_PATH);
const CARRIER_CONTRACT = JSON.parse(CARRIER_CONTRACT_BYTES.toString("utf8"));
const CARRIER_CONTRACT_SHA256 = digest(CARRIER_CONTRACT_BYTES);
const CONTROL_SESSION_CONTRACT_PATH = path.join(REPO_ROOT, "packages", "ceal-worker-cli", "leased-consumer-control-session-contract.json");
const CONTROL_SESSION_CONTRACT_BYTES = readFileSync(CONTROL_SESSION_CONTRACT_PATH);
const CONTROL_SESSION_CONTRACT = JSON.parse(CONTROL_SESSION_CONTRACT_BYTES.toString("utf8"));
const CONTROL_SESSION_CONTRACT_SHA256 = digest(CONTROL_SESSION_CONTRACT_BYTES);
const CARRIER_HANDOFF = verifyEmbeddedGatewayLeasedConsumerHandoffSource({ repoRoot: REPO_ROOT });
// Read from the lock rather than restated, for the same reason as the installer
// allowlist below: a hand-copied expectation and the value it stands for drift
// apart silently, and here both sides of a comparison would be this file.
const LOCKED_GATEWAY = JSON.parse(readFileSync(path.join(REPO_ROOT, "gateway-protocol-handoff-lock.json"), "utf8")).gateway;
const LOCKED_PROTOCOL_PRODUCER = Object.freeze({
	repository: LOCKED_GATEWAY.repository,
	commit: LOCKED_GATEWAY.commit,
	tree: LOCKED_GATEWAY.tree,
});

// The installer's own allowlist, read out of the shell rather than restated
// here. It was a hand-copy, and a hand-copy of an allowlist is the shape that
// passes while the two sides disagree: dropping `darwin` from install-ceal.sh
// left both this test and the installer green, each checking a different
// contract. Deriving it means the shell is the single definition and a
// narrowing there fails here.
const INSTALLER_ALLOWLIST = installerAllowlist();

type Manifest = {
	client: { sha256: string };
	embedded_guide: { sha256: string };
	native_smoke: { embedded_guide_sha256: string; guide_registration: boolean };
	private_leased_consumer_control_session: { contract_json: string; contract_sha256: string };
	private_leased_consumer_carrier: { contract_json: string; contract_sha256: string };
	private_leased_consumer_handoff: { sha256: string };
	protocol: { producer?: unknown };
};
type DriftCase = [string, (manifest: Manifest) => void, string];
type ReleaseStep = { run?: string; with?: { name?: string } };
type ReleaseJob = { steps: ReleaseStep[] };
type FakeNativeBuild = typeof buildWorkerNativeArtifact;

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
	const platforms = parse(workflow).jobs?.build?.strategy?.matrix?.include?.map((entry: { platform: string }) => entry.platform) ?? [];
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

test("release assets CLI renders failures through the declared output channels", async () => {
	await assertCliFailureChannels(runCli, ["compose"], "invalid_output");
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
	assert.deepEqual(manifest.client, {
		package: "@corca-ai/ceal",
		version: "0.65.0",
		filename: "corca-ai-ceal-0.65.0.tgz",
		bytes: 1234,
		sha256: "c".repeat(64),
	});
	assert.equal(manifest.private_leased_consumer_carrier.contract_json, CARRIER_CONTRACT_BYTES.toString("utf8"));
	assert.equal(manifest.private_leased_consumer_carrier.contract_sha256, CARRIER_CONTRACT_SHA256);
	assert.equal(manifest.private_leased_consumer_control_session.contract_json, CONTROL_SESSION_CONTRACT_BYTES.toString("utf8"));
	assert.equal(manifest.private_leased_consumer_control_session.contract_sha256, CONTROL_SESSION_CONTRACT_SHA256);
	assert.deepEqual(manifest.private_leased_consumer_handoff, CARRIER_HANDOFF);
	assert.equal(manifest.guide.name, "ceal-guide-SKILL.md");
	assert.equal(manifest.guide.sha256, digest(readFileSync(path.join(output, "ceal-guide-SKILL.md"))));
	const compatibilityGuide = readFileSync(path.join(output, "ceal-guide-SKILL.md"), "utf8");
	assert.match(compatibilityGuide, /ceal guide register codex/u);
	assert.match(compatibilityGuide, /ceal guide register claude/u);
	assert.doesNotMatch(compatibilityGuide, /references\//u);
	assert.equal(manifest.embedded_guide.name, "ceal-guide.tar");
	assert.equal(manifest.embedded_guide.format, "ustar");
	assert.ok(manifest.embedded_guide.files.some((file: { path: string }) => file.path === "SKILL.md"));
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

test("output directory refuses a relative path before resolving it", () => {
	assert.throws(
		() =>
			inspectOutputDirectory("relative-output", {
				repoRoot: REPO_ROOT,
				force: false,
				subject: "Worker release assets output",
				marker: ".ceal-worker-release-assets",
				fail: (code: string, message: string): never => {
					throw new Error(`${code}:${message}`);
				},
			}),
		/invalid_output/u,
	);
});

test("forced publish restores the marked output when staging rename fails", (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-output-publish-restore-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const output = path.join(root, "assets");
	mkdirSync(output);
	writeFileSync(path.join(output, ".ceal-worker-release-assets"), "marker\n");
	writeFileSync(path.join(output, "previous.txt"), "previous\n");
	assert.throws(() => publishOutputDirectory(path.join(root, "missing-staging"), { directory: output, force: true }), /ENOENT/u);
	assert.equal(readFileSync(path.join(output, "previous.txt"), "utf8"), "previous\n");
	assert.deepEqual(readdirSync(root), ["assets"]);
});

test("compose preserves a coded native-builder error", async (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-assets-error-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const repoRoot = fixtureRepo(root);
	const buildNative: FakeNativeBuild = async () => {
		throw Object.assign(new Error("fixture native failure"), { code: "fixture_native_failure" });
	};
	await assert.rejects(
		() => composeWorkerReleaseAssets({ outputDirectory: path.join(root, "assets"), repoRoot }, { buildNative }),
		(error: unknown) =>
			error instanceof WorkerReleaseAssetsError && error.code === "fixture_native_failure" && error.message === "fixture native failure",
	);
});

test("compose classifies a malformed native carrier descriptor as carrier drift", async (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-assets-carrier-descriptor-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const repoRoot = fixtureRepo(root);
	const base = fakeNativeBuild("linux-arm64", "0.65.0");
	const buildNative: FakeNativeBuild = async (options = {}, dependencies = {}) => ({
		...(await base(options, dependencies)),
		private_leased_consumer_carrier: { sha256: CARRIER_CONTRACT_SHA256 },
	});
	await assert.rejects(
		() => composeWorkerReleaseAssets({ outputDirectory: path.join(root, "assets"), repoRoot }, { buildNative }),
		(error: unknown) =>
			error instanceof WorkerReleaseAssetsError &&
			error.code === "private_carrier_contract_drift" &&
			error.message === "Worker release assets refuse a native binary whose embedded carrier contract differs from the source contract.",
	);
});

test("compose classifies a malformed native control-session descriptor as control-session drift", async (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-assets-control-descriptor-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const repoRoot = fixtureRepo(root);
	const base = fakeNativeBuild("linux-arm64", "0.65.0");
	const buildNative: FakeNativeBuild = async (options = {}, dependencies = {}) => ({
		...(await base(options, dependencies)),
		private_leased_consumer_control_session: { sha256: CONTROL_SESSION_CONTRACT_SHA256 },
	});
	await assert.rejects(
		() => composeWorkerReleaseAssets({ outputDirectory: path.join(root, "assets"), repoRoot }, { buildNative }),
		(error: unknown) =>
			error instanceof WorkerReleaseAssetsError &&
			error.code === "private_control_session_contract_drift" &&
			error.message ===
				"Worker release assets refuse a native binary whose embedded control-session contract differs from the source contract.",
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
	const protocolManifest = path.join(root, "packages", "ceal-protocol", "package.json");
	mkdirSync(path.dirname(protocolManifest), { recursive: true });
	writeFileSync(protocolManifest, readFileSync(path.join(REPO_ROOT, "packages", "ceal-protocol", "package.json")));
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
			'" as const;\nexport const LEASED_CONSUMER_CONTROL_SESSION_ROUTES_SHA256 = "14e5c0e6c376903f7a590f5adfe7d82be8d310ea52c28893e4b43298ebeda11a" as const;\n',
	);
	assert.throws(() => verifyEmbeddedControlSessionContractSource({ repoRoot: root }), /embedded_control_session_contract_drift/u);
});

test("private control-session release input accepts only the signed v6 disposition grammar", (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-control-session-contract-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const contractPath = path.join(root, "packages", "ceal-worker-cli", "leased-consumer-control-session-contract.json");
	mkdirSync(path.dirname(contractPath), { recursive: true });
	const protocolManifestPath = path.join(root, "packages", "ceal-protocol", "package.json");
	mkdirSync(path.dirname(protocolManifestPath), { recursive: true });
	writeFileSync(protocolManifestPath, readFileSync(path.join(REPO_ROOT, "packages", "ceal-protocol", "package.json")));
	const generatedPath = path.join(root, "packages", "ceal-worker-cli", "src", "generated", "leased-consumer-control-session-contract.ts");
	mkdirSync(path.dirname(generatedPath), { recursive: true });
	writeFileSync(
		generatedPath,
		readFileSync(path.join(REPO_ROOT, "packages", "ceal-worker-cli", "src", "generated", "leased-consumer-control-session-contract.ts")),
	);
	writeFileSync(
		path.join(root, "gateway-protocol-handoff-lock.json"),
		readFileSync(path.join(REPO_ROOT, "gateway-protocol-handoff-lock.json")),
	);
	const current = JSON.parse(CONTROL_SESSION_CONTRACT_BYTES.toString("utf8"));
	writeFileSync(contractPath, `${JSON.stringify(current, null, 2)}\n`);
	const accepted = readControlSessionContract(contractPath, { repoRoot: root }).value;
	assert.equal(accepted.agent_ipc.request_schema_version, "ceal.leased_consumer_capability_control_request.v6");
	assert.equal(accepted.agent_ipc.response_schema_version, "ceal.leased_consumer_capability_control_response.v6");
	assert.equal(accepted.schema_version, "ceal.worker_private_leased_consumer_control_session_contract.v3");
	assert.equal(accepted.gateway.routes.materialization, "/api/ceal/agent/v1/control/materialization");
	assert.equal(accepted.gateway.routes.notification_receipt, "/api/ceal/agent/v1/control/notification-receipt");
	assert.deepEqual(accepted.gateway.operation_deadline_bounds_ms, { minimum: 30000, maximum: 600000 });
	const mismatchedProtocolManifest = JSON.parse(readFileSync(protocolManifestPath, "utf8"));
	mismatchedProtocolManifest.version = "0.72.20";
	writeFileSync(protocolManifestPath, `${JSON.stringify(mismatchedProtocolManifest, null, 2)}\n`);
	assert.throws(
		() => readControlSessionContract(contractPath, { repoRoot: root }),
		/invalid_control_session_contract/u,
		"the signed handoff lock cannot drift from the vendored Protocol manifest",
	);
	writeFileSync(protocolManifestPath, readFileSync(path.join(REPO_ROOT, "packages/ceal-protocol/package.json")));
	const legacyDeadline = structuredClone(current);
	legacyDeadline.gateway.operation_deadline_ms = 30000;
	delete legacyDeadline.gateway.operation_deadline_bounds_ms;
	writeFileSync(contractPath, `${JSON.stringify(legacyDeadline, null, 2)}\n`);
	assert.throws(() => readControlSessionContract(contractPath, { repoRoot: root }), /invalid_control_session_contract/u);
	const wideBounds = structuredClone(current);
	wideBounds.gateway.operation_deadline_bounds_ms.maximum = 700000;
	writeFileSync(contractPath, `${JSON.stringify(wideBounds, null, 2)}\n`);
	assert.throws(() => readControlSessionContract(contractPath, { repoRoot: root }), /invalid_control_session_contract/u);
	const stalePathContract = structuredClone(current);
	stalePathContract.gateway.socket_path = "/run/ceal/leased-consumer-control-v1.sock";
	writeFileSync(contractPath, `${JSON.stringify(stalePathContract, null, 2)}\n`);
	assert.throws(() => readControlSessionContract(contractPath, { repoRoot: root }), /invalid_control_session_contract/u);

	for (const mutate of [
		(value: typeof current) => (value.notification_channel.child_fd = 4),
		(value: typeof current) => (value.notification_channel.maximum_frame_bytes = 4097),
		(value: typeof current) => (value.agent_ipc.request_schema_version = "ceal.leased_consumer_capability_control_request.v5"),
		(value: typeof current) => (value.agent_ipc.response_schema_version = "ceal.leased_consumer_capability_control_response.v5"),
		(value: typeof current) => (value.agent_ipc.response_schema_version = "ceal.leased_consumer_capability_control_response.v4"),
		(value: typeof current) => delete value.gateway.routes.notification_receipt,
		(value: typeof current) => delete value.gateway.routes.materialization,
		(value: typeof current) => (value.gateway.routes.unexpected_materializer = value.gateway.routes.materialization),
		(value: typeof current) => (value.gateway.routes.materialization = "/api/ceal/agent/v1/control/unexpected-materializer"),
		(value: typeof current) => (value.gateway.routes.extra = "/api/ceal/agent/v1/control/extra"),
	]) {
		const invalid = structuredClone(current);
		mutate(invalid);
		writeFileSync(contractPath, `${JSON.stringify(invalid, null, 2)}\n`);
		assert.throws(() => readControlSessionContract(contractPath, { repoRoot: root }), /invalid_control_session_contract/u);
	}
	const coupled = structuredClone(current);
	coupled.gateway.routes.materialization = "/api/ceal/agent/v1/control/coupled-materializer";
	const coupledDigest = createHash("sha256").update(JSON.stringify(coupled.gateway.routes)).digest("hex");
	writeFileSync(contractPath, `${JSON.stringify(coupled, null, 2)}\n`);
	writeFileSync(
		generatedPath,
		readFileSync(generatedPath, "utf8").replace(
			/LEASED_CONSUMER_CONTROL_SESSION_ROUTES_SHA256 = "[a-f0-9]{64}"/u,
			`LEASED_CONSUMER_CONTROL_SESSION_ROUTES_SHA256 = "${coupledDigest}"`,
		),
	);
	assert.throws(
		() => readControlSessionContract(contractPath, { repoRoot: root }),
		/invalid_control_session_contract/u,
		"a coupled contract and generated digest edit cannot replace the signed lock anchor",
	);
	writeFileSync(
		generatedPath,
		readFileSync(path.join(REPO_ROOT, "packages", "ceal-worker-cli", "src", "generated", "leased-consumer-control-session-contract.ts")),
	);
	const downgradedLock = JSON.parse(readFileSync(path.join(REPO_ROOT, "gateway-protocol-handoff-lock.json"), "utf8"));
	downgradedLock.protocol.version = "0.72.13";
	writeFileSync(path.join(root, "gateway-protocol-handoff-lock.json"), `${JSON.stringify(downgradedLock, null, 2)}\n`);
	writeFileSync(contractPath, `${JSON.stringify(current, null, 2)}\n`);
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
	const inputs: string[] = [];
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

	const amd64Input = requiredValue(inputs[1], "linux_amd64_input");
	const platformManifest = path.join(amd64Input, "ceal-worker-release-manifest-linux-amd64.json");
	const originalManifest = readFileSync(platformManifest);
	// One shape, five mutations. Each rewrites the linux-amd64 manifest, expects
	// the merge to refuse with a named code, and restores — spelling that out five
	// times hid the only thing that differs between them, which is the pair of
	// (mutation, code).
	//
	// Every one of these is now compared against the checkout, so none of them
	// escapes by drifting identically on every leg — the loop after this one proves
	// that for all three private inputs. It used to be true only of the
	// control-session contract and of protocol provenance; the carrier contract and
	// the Gateway handoff were checked for cross-platform agreement alone, which an
	// identical corruption walks straight through. Protocol provenance carries two
	// cases because they are different mistakes: bytes bound to another Gateway
	// commit, and a manifest that names a version with no producer at all.
	const driftCases: DriftCase[] = [
		["client", (manifest) => (manifest.client.sha256 = "d".repeat(64)), "merge_client_provenance_drift"],
		["embedded-guide", (manifest) => (manifest.embedded_guide.sha256 = "d".repeat(64)), "merge_embedded_guide_drift"],
		["carrier", (manifest) => (manifest.private_leased_consumer_carrier.contract_json = "{}"), "merge_private_carrier_contract_drift"],
		["handoff", (manifest) => (manifest.private_leased_consumer_handoff.sha256 = "0".repeat(64)), "merge_private_carrier_handoff_drift"],
		[
			"control-session",
			(manifest) => (manifest.private_leased_consumer_control_session.contract_json = "{}"),
			"merge_private_control_session_contract_drift",
		],
		[
			"protocol-provenance",
			(manifest) => (manifest.protocol.producer = { ...LOCKED_PROTOCOL_PRODUCER, commit: "f".repeat(40) }),
			"merge_protocol_provenance_disagreement",
		],
		["protocol-version-only", (manifest) => (manifest.protocol.producer = undefined), "merge_protocol_provenance_incomplete"],
	];
	// One shape, both populations. A drift case is: mutate the manifest, write it
	// wherever this population says, expect the named refusal, restore. Which legs
	// get written is the ONLY difference between drifting one leg and drifting all
	// of them, and spelling the rest twice is what let the two populations cover
	// different sets of inputs without anyone noticing.
	const writeOneLeg = (body: string | Uint8Array): void => {
		writeFileSync(platformManifest, body);
		rewriteInventoryDigest(amd64Input, path.basename(platformManifest));
	};
	const writeEveryLeg = (body: string | Uint8Array): void => {
		for (const input of inputs) {
			const name = `ceal-worker-release-manifest-${input.endsWith("linux-amd64") ? "linux-amd64" : "linux-arm64"}.json`;
			writeFileSync(path.join(input, name), body);
			rewriteInventoryDigest(input, name);
		}
	};
	const expectRefusals = (cases: DriftCase[], write: (body: string | Uint8Array) => void, prefix: string): void => {
		for (const [label, mutate, expected] of cases) {
			const drifted: Manifest = JSON.parse(originalManifest.toString("utf8"));
			mutate(drifted);
			write(`${JSON.stringify(drifted, null, 2)}\n`);
			assert.throws(
				() => mergeWorkerReleaseAssetSets({ outputDirectory: path.join(root, `merged-${prefix}${label}-drift`), inputs, repoRoot }),
				hasCode(expected),
				`${prefix}${label}`,
			);
			write(originalManifest);
		}
	};
	expectRefusals(driftCases, writeOneLeg, "");

	// The corruption that agreement alone cannot see: every leg wrong, identically.
	// That is the ordinary shape, not an exotic one — every leg stages from one
	// snapshot, so a stale or tampered snapshot reaches all of them the same way.
	const identicalDriftCases: DriftCase[] = [
		[
			"embedded-guide",
			(manifest) => {
				manifest.embedded_guide.sha256 = "0".repeat(64);
				manifest.native_smoke.embedded_guide_sha256 = "0".repeat(64);
			},
			"merge_embedded_guide_drift",
		],
		[
			"control-session",
			(manifest) => {
				manifest.private_leased_consumer_control_session.contract_json = "{}";
				manifest.private_leased_consumer_control_session.contract_sha256 = "0".repeat(64);
			},
			"merge_private_control_session_contract_drift",
		],
		[
			"carrier",
			(manifest) => {
				manifest.private_leased_consumer_carrier.contract_json = "{}";
				manifest.private_leased_consumer_carrier.contract_sha256 = "0".repeat(64);
			},
			"merge_private_carrier_contract_drift",
		],
		[
			"handoff",
			(manifest) => {
				manifest.private_leased_consumer_handoff.sha256 = "0".repeat(64);
			},
			"merge_private_carrier_handoff_drift",
		],
	];
	expectRefusals(identicalDriftCases, writeEveryLeg, "identical-");

	for (const input of inputs) {
		const manifestPath = path.join(
			input,
			`ceal-worker-release-manifest-${input.endsWith("linux-amd64") ? "linux-amd64" : "linux-arm64"}.json`,
		);
		writeFileSync(manifestPath, originalManifest);
		rewriteInventoryDigest(input, path.basename(manifestPath));
	}

	writeFileSync(path.join(amd64Input, "ceal-guide-SKILL.md"), "drifted guide\n");
	const driftedSums = readFileSync(path.join(amd64Input, "SHA256SUMS"), "utf8").replace(
		/^[a-f0-9]{64}(?= {2}ceal-guide-SKILL[.]md$)/mu,
		digest(Buffer.from("drifted guide\n")),
	);
	writeFileSync(path.join(amd64Input, "SHA256SUMS"), driftedSums);
	assert.throws(
		() => mergeWorkerReleaseAssetSets({ outputDirectory: path.join(root, "merged-drift"), inputs, repoRoot }),
		hasCode("merge_shared_drift"),
	);

	rmSync(path.join(requiredValue(inputs[0], "linux_arm64_input"), "ceal-worker-release-manifest-linux-arm64.json"));
	assert.throws(
		() =>
			mergeWorkerReleaseAssetSets({
				outputDirectory: path.join(root, "merged-incomplete"),
				inputs: [requiredValue(inputs[0], "linux_arm64_input")],
				repoRoot,
			}),
		hasCode("merge_input_incomplete"),
	);
});

test("merge rejects duplicate checksum entries within one input set", async (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-assets-duplicate-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const repoRoot = fixtureRepo(root);
	const input = path.join(root, "assets-linux-arm64");
	await composeWorkerReleaseAssets(
		{ outputDirectory: input, gatewayHandoffArchive: "/unused/fixture.tar.gz", repoRoot },
		{ buildNative: fakeNativeBuild("linux-arm64", "0.65.0") },
	);
	const inventoryPath = path.join(input, "SHA256SUMS");
	const inventory = readFileSync(inventoryPath, "utf8").trim();
	writeFileSync(inventoryPath, `${inventory}\n${inventory.split("\n")[0]}\n`);
	assert.throws(
		() => mergeWorkerReleaseAssetSets({ outputDirectory: path.join(root, "merged"), inputs: [input], repoRoot }),
		hasCode("merge_duplicate_asset"),
	);
});

test("merge refuses a declared proof and shipment Protocol divergence before reading composed assets", async (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-assets-diverged-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const repoRoot = fixtureRepo(root);
	const missingInput = path.join(root, "missing-assets");
	assert.throws(
		() => mergeWorkerReleaseAssetSets({ outputDirectory: path.join(root, "converged-output"), inputs: [missingInput], repoRoot }),
		hasCode("merge_inputs_required"),
	);
	declareFixtureDivergence(repoRoot);
	const outputDirectory = path.join(root, "merged");
	assert.throws(
		() => mergeWorkerReleaseAssetSets({ outputDirectory, inputs: [missingInput], repoRoot }),
		hasCode("proof_shipment_protocol_divergence"),
	);
	assert.equal(existsSync(outputDirectory), false);
});

test("worker release workflow signs only the worker inventory from the locked archive", () => {
	const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/ceal-release.yml"), "utf8");
	// The tag trigger is asserted against parsed YAML in repo-gates.test.ts; the
	// raw-text form that used to sit here pinned six-space indentation and the
	// choice of quote character too.
	assert.match(workflow, /gateway-protocol-handoff-lock\.json/u);
	assert.match(workflow, /build-worker-release-assets\.ts compose/u);
	assert.match(workflow, /build-worker-release-assets\.ts merge/u);
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
	// Slice 3 A. The gate is skipped on `linux-arm64`, and everything that skip
	// is argued from is architecture-independent — lint, unit, contract, all
	// about the source. `test:release` is not: it is the only proof that npm's
	// resolver ON THAT RUNNER binds the packed Gateway tarball rather than the
	// workspace symlink development creates, and those two are indistinguishable
	// from a passing build. Without this the one binary never asked that question
	// is also a signed one.
	assert.match(
		workflow,
		/if: matrix[.]validate_source == '0'\n {8}run: npm run build && npm run test:release/u,
		"the leg that skips the gate must still prove the packed Gateway consumer on its own runner",
	);
	// The packed-consumer proofs read an offline cache and fail as ENOTCACHED
	// without it, so the prewarm cannot stay conditional on the gate.
	assert.doesNotMatch(
		workflow,
		/- name: Prewarm the offline packed-consumer cache\n {8}if:/u,
		"every leg now runs a packed-consumer proof, so none of them may skip the prewarm",
	);
	assert.match(workflow, /concurrency:\n {2}group: ceal-worker-release-origin\n {2}cancel-in-progress: false/u);
	assert.match(workflow, /CEAL_ENV_CLOUDFLARE_ACCOUNT_ID/u);
	assert.match(workflow, /CEAL_ENV_CLOUDFLARE_API_TOKEN/u);
	assert.doesNotMatch(workflow, /CEAL_RELEASE_CLOUDFLARE_(?:ACCOUNT_ID|API_TOKEN)/u);
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
// platform is not. A platform missing from any one of these sites publishes a
// silently partial inventory, so derive all of them from one producer instead of
// restating a platform list here. That producer used to be the legacy
// release-contract.json; with that lane gone it is the build matrix, which is
// what actually decides what exists to sign.
test("worker release workflow builds, merges, and signs every platform it builds", () => {
	const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/ceal-release.yml"), "utf8");
	const parsed = parse(workflow);
	const platforms = parsed.jobs.build.strategy.matrix.include.map((entry: { platform: string }) => entry.platform);
	// A floor, not a snapshot: every assertion below derives from `platforms`, so
	// the only thing this has to rule out is an empty list making them vacuous.
	assert.ok(platforms.length >= 3, `the build matrix names only ${platforms.length} release platforms`);

	// Each site is isolated: asserting against a whole job lets one site cover
	// for another, which is exactly the partial-inventory bug being guarded.
	const downloads = parsed.jobs.assemble.steps.flatMap((step: ReleaseStep) => (step.with?.name ? [step.with.name] : []));
	const merge = runStepContaining(parsed.jobs.assemble, "build-worker-release-assets.ts merge");
	const inventory = runStepContaining(parsed.jobs["sign-and-publish"], "Unexpected worker release inventory");
	const signing = bashArray(runStepContaining(parsed.jobs["sign-and-publish"], "cosign sign-blob"), "primary");
	// The rollback lane re-verifies this same set before moving stable, so it is
	// a fifth platform-naming site and drifts silently without this assertion.
	const rollback = parse(readFileSync(path.join(REPO_ROOT, ".github/workflows/ceal-worker-stable-rollback.yml"), "utf8"));
	const rollbackInventory = runStepContaining(rollback.jobs.verify, "parsePublishedWorkerReleaseInventory");
	const rollbackSignature = runStepContaining(rollback.jobs.verify, "SHA256SUMS.pem");
	assert.match(rollbackInventory, /Verify the signed inventory itself before it is allowed to name any[\s\S]+later URL/u);
	assert.match(rollbackSignature, /cosign verify-blob/u);
	assert.ok(
		rollbackSignature.indexOf("cosign verify-blob") < rollbackInventory.indexOf("parsePublishedWorkerReleaseInventory"),
		"rollback must verify SHA256SUMS before parsing its asset names",
	);
	const manifestLoopMatch = /for platform in ([^;]+); do/u.exec(inventory);
	const manifestLoop = manifestLoopMatch?.[1]?.trim().split(/\s+/u);
	if (manifestLoop === undefined) throw new Error("manifest_platform_loop_missing");

	assert.deepEqual([...manifestLoop].sort(), [...platforms].sort(), "manifest check must cover every platform");
	for (const platform of platforms) {
		assert.ok(
			downloads.some((name: string) => name.endsWith(`-${platform}`)),
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

test("published worker inventory parser decodes a plain Uint8Array as UTF-8", () => {
	const inventory = publishedInventory(["linux-arm64"]);
	const bytes = new Uint8Array(Buffer.from(inventory, "utf8"));
	assert.equal(parsePublishedWorkerReleaseInventory(bytes).length, 5);
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

function runStepContaining(job: ReleaseJob, needle: string): string {
	const found = job.steps.filter((step) => (step.run ?? "").includes(needle));
	assert.equal(found.length, 1, `expected exactly one step containing ${needle}`);
	const run = found[0]?.run;
	if (typeof run !== "string") throw new Error(`step containing ${needle} has no run script`);
	return run;
}

// Reads `name=( ... )` as the shell would split it, so a token dropped from the
// array is visible even when the same token appears elsewhere in the step.
function bashArray(script: string, name: string): string[] {
	const body = new RegExp(`${name}=\\(([^)]*)\\)`, "u").exec(script);
	assert.ok(body, `expected a ${name}=( ... ) array`);
	const arrayBody = body?.[1];
	if (arrayBody === undefined) throw new Error(`expected a ${name}=( ... ) array body`);
	return arrayBody.trim().split(/\s+/u);
}

function publishedInventory(platforms: string[]): string {
	const names = [
		"THIRD_PARTY_NOTICES.txt",
		"ceal-guide-SKILL.md",
		"install-ceal.sh",
		...platforms.flatMap((platform: string) => [`ceal-${platform}`, `ceal-worker-release-manifest-${platform}.json`]),
	];
	return `${names.map((name) => `${digest(name)}  ${name}`).join("\n")}\n`;
}

// The build job is the only one that runs on macOS runners, which ship no GNU
// coreutils; a sha256sum there fails the darwin legs and blocks every release.
test("worker release build job uses no GNU-only tool on its macOS runners", () => {
	const parsed = parse(readFileSync(path.join(REPO_ROOT, ".github/workflows/ceal-release.yml"), "utf8"));
	assert.ok(
		parsed.jobs.build.strategy.matrix.include.some((entry: { runner: string }) => entry.runner.startsWith("macos-")),
		"this guard is only meaningful while a darwin runner exists",
	);
	// Whole-line comments are dropped: the guard is about executed commands, and
	// the step that replaced sha256sum names it while explaining why.
	const scripts = parsed.jobs.build.steps
		.flatMap((step: ReleaseStep) => (step.run ?? "").split("\n"))
		.filter((line: string) => !line.trimStart().startsWith("#"))
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
	platform: string,
	version: string,
	{
		carrierContract = CARRIER_CONTRACT,
		carrierSha256 = CARRIER_CONTRACT_SHA256,
		controlSessionContract = CONTROL_SESSION_CONTRACT,
		controlSessionSha256 = CONTROL_SESSION_CONTRACT_SHA256,
		carrierHandoff = CARRIER_HANDOFF,
		protocolProducer = LOCKED_PROTOCOL_PRODUCER,
		clientSha256 = "c".repeat(64),
	} = {},
): FakeNativeBuild {
	return async (
		options: Parameters<FakeNativeBuild>[0] = {},
		_dependencies: Parameters<FakeNativeBuild>[1] = {},
	): ReturnType<FakeNativeBuild> => {
		if (!options || typeof options.outputDirectory !== "string") throw new Error("fixture output directory is required");
		const { outputDirectory } = options;
		mkdirSync(outputDirectory, { recursive: true });
		const binary = Buffer.from(`native-${platform}\n`);
		writeFileSync(path.join(outputDirectory, `ceal-${platform}`), binary, { mode: 0o755 });
		const guide = createSkillDirectoryBundle(path.join(REPO_ROOT, "skills", "ceal-guide"));
		const compatibilityGuide = readFileSync(path.join(REPO_ROOT, "scripts", "assets", "ceal-guide-compatibility-SKILL.md"));
		writeFileSync(path.join(outputDirectory, "ceal-guide-SKILL.md"), compatibilityGuide);
		writeFileSync(path.join(outputDirectory, "THIRD_PARTY_NOTICES.txt"), "notice\n");
		return {
			schema_version: "ceal.worker_native_artifact.v1",
			ok: true,
			proof_level: "local_state",
			writes_external: false,
			output_dir: outputDirectory,
			version,
			platform,
			artifact: { name: `ceal-${platform}`, bytes: binary.length, sha256: digest(binary) },
			guide: {
				name: "ceal-guide.tar",
				format: "ustar",
				bytes: guide.bytes.length,
				sha256: guide.sha256,
				files: guide.files,
			},
			compatibility_guide: {
				name: "ceal-guide-SKILL.md",
				bytes: compatibilityGuide.length,
				sha256: digest(compatibilityGuide),
			},
			client: {
				package: "@corca-ai/ceal",
				version,
				filename: `corca-ai-ceal-${version}.tgz`,
				bytes: 1234,
				sha256: clientSha256,
			},
			// Producer provenance, not just a version: the merge asserts it against
			// the lock before the artifacts are handed to signing, and the real
			// compose path fills it from the handoff source
			// (scripts/worker-release-inputs.mjs:504). A fixture carrying only a
			// version would prove the merge accepts a manifest no release produces.
			protocol: { package: "@corca-ai/ceal-protocol", version, sha256: "0".repeat(64), producer: protocolProducer },
			private_leased_consumer_carrier: { contract: carrierContract, sha256: carrierSha256 },
			private_leased_consumer_control_session: { contract: controlSessionContract, sha256: controlSessionSha256 },
			private_leased_consumer_handoff: carrierHandoff,
			native_smoke: {
				command: "ceal",
				version,
				help: true,
				required_commands: [],
				operator_surface_absent: true,
				embedded_guide_sha256: guide.sha256,
				guide_registration: true,
			},
			non_claims: [],
			consumer_smoke: {},
		};
	};
}

function fixtureRepo(root: string): string {
	const repo = path.join(root, "repo");
	mkdirSync(repo, { recursive: true });
	writeFileSync(path.join(repo, "install-ceal.sh"), "#!/usr/bin/env sh\nexit 0\n", { mode: 0o755 });
	cpSync(path.join(REPO_ROOT, "worker-release-inputs.json"), path.join(repo, "worker-release-inputs.json"));
	cpSync(path.join(REPO_ROOT, "skills", "ceal-guide"), path.join(repo, "skills", "ceal-guide"), { recursive: true });
	mkdirSync(path.join(repo, "scripts", "assets"), { recursive: true });
	cpSync(
		path.join(REPO_ROOT, "scripts", "assets", "ceal-guide-compatibility-SKILL.md"),
		path.join(repo, "scripts", "assets", "ceal-guide-compatibility-SKILL.md"),
	);
	const contractDirectory = path.join(repo, "packages", "ceal-worker-cli");
	mkdirSync(contractDirectory, { recursive: true });
	const clientDirectory = path.join(repo, "packages", "ceal-client");
	mkdirSync(clientDirectory, { recursive: true });
	writeFileSync(path.join(clientDirectory, "package.json"), `${JSON.stringify({ name: "@corca-ai/ceal", version: "0.65.0" })}\n`);
	writeFileSync(path.join(contractDirectory, "leased-consumer-carrier-contract.json"), CARRIER_CONTRACT_BYTES);
	writeFileSync(path.join(contractDirectory, "leased-consumer-control-session-contract.json"), CONTROL_SESSION_CONTRACT_BYTES);
	writeGatewayHandoffFixture(repo);
	if (!existsSync(path.join(repo, ".git"))) {
		const lock = JSON.parse(readFileSync(path.join(REPO_ROOT, "gateway-protocol-handoff-lock.json"), "utf8"));
		materializeGitTree(lock.gateway.protocol_tree, path.join(repo, "packages", "ceal-protocol"));
		runFixtureGit(repo, ["init", "--quiet"]);
		runFixtureGit(repo, ["config", "user.name", "Ceal Release Assets Fixture"]);
		runFixtureGit(repo, ["config", "user.email", "fixture@invalid.example"]);
		runFixtureGit(repo, ["add", "."]);
		runFixtureGit(repo, ["commit", "--quiet", "-m", "fixture: seed release assets checkout"]);
		const protocolTree = runFixtureGit(repo, ["rev-parse", "HEAD:packages/ceal-protocol"]);
		writeFileSync(path.join(repo, "gateway-protocol-handoff-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
		const pin = JSON.parse(readFileSync(path.join(REPO_ROOT, "protocol-vendor-pin.json"), "utf8"));
		pin.source.commit = lock.gateway.commit;
		pin.source.tree = protocolTree;
		pin.shipped.status = "agreed";
		pin.shipped.gateway_commit = lock.gateway.commit;
		pin.shipped.protocol_tree = protocolTree;
		delete pin.shipped.reason;
		delete pin.shipped.disposition_owner;
		delete pin.shipped.disposition_request;
		writeFileSync(path.join(repo, "protocol-vendor-pin.json"), `${JSON.stringify(pin, null, 2)}\n`);
		runFixtureGit(repo, ["add", "."]);
		runFixtureGit(repo, ["commit", "--quiet", "-m", "fixture: converge release Protocol identity"]);
	}
	return repo;
}

function declareFixtureDivergence(repo: string): void {
	const request = "docs/protocol-quarantine.md";
	const pinPath = path.join(repo, "protocol-vendor-pin.json");
	const pin = JSON.parse(readFileSync(pinPath, "utf8"));
	pin.source.commit = "d".repeat(40);
	pin.shipped.status = "diverged";
	pin.shipped.reason = "fixture divergence";
	pin.shipped.disposition_owner = "fixture";
	pin.shipped.disposition_request = request;
	mkdirSync(path.dirname(path.join(repo, request)), { recursive: true });
	writeFileSync(path.join(repo, request), "# Fixture divergence\n");
	writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`);
	runFixtureGit(repo, ["add", "."]);
	runFixtureGit(repo, ["commit", "--quiet", "-m", "fixture: declare Protocol divergence"]);
}

function materializeGitTree(tree: string, destination: string): void {
	mkdirSync(destination, { recursive: true });
	const archive = execFileSync("git", ["archive", tree], { cwd: REPO_ROOT });
	execFileSync("tar", ["-xf", "-", "-C", destination], { input: archive });
}

function writeGatewayHandoffFixture(root: string): void {
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

function hasCode(code: string) {
	return (error: unknown): boolean => error instanceof WorkerReleaseAssetsError && error.code === code;
}

function digest(bytes: BinaryLike): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function rewriteInventoryDigest(directory: string, name: string): void {
	const inventory = path.join(directory, "SHA256SUMS");
	const digestLine = `${digest(readFileSync(path.join(directory, name)))}  ${name}`;
	writeFileSync(inventory, readFileSync(inventory, "utf8").replace(new RegExp(`^[a-f0-9]{64}  ${name}$`, "mu"), digestLine));
}
