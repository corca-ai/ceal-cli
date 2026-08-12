import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import {
	buildWorkerNativeArtifact,
	buildWorkerNativeArtifactFromDevelopmentInputs,
	runCli,
	WorkerNativeArtifactError,
} from "../scripts/build-worker-native-artifact.mjs";
import { writeClientSessionStoreFixture } from "./client-session-store-fixture.mjs";
import {
	assertReleaseManifestProvenance,
	execReleaseTestProcess,
	processIsAlive,
	runAsyncReleaseProcess,
	runSyncReleaseProcess,
} from "./release-process-bounds.mjs";
import { packedProtocolFixture } from "./worker-release-package-fixture.mjs";

let packedFixture;
test.before((context) => {
	packedFixture = packedProtocolFixture(context);
});

test("native worker artifact consumes a manifest-bound packed consumer and emits no operator material", async () => {
	const fixture = packedFixture;
	const output = path.join(fixture.root, "worker-native");
	const result = await buildWorkerNativeArtifactFromDevelopmentInputs({ outputDirectory: output, ...fixture });
	assert.equal(result.ok, true);
	const architecture = process.arch === "arm64" ? "arm64" : "amd64";
	const platform = `${process.platform === "darwin" ? "darwin" : "linux"}-${architecture}`;
	const otherPlatform = platform.endsWith("arm64") ? platform.replace("arm64", "amd64") : platform.replace("amd64", "arm64");
	assert.equal(result.platform, platform);
	assert.deepEqual(result.consumer_smoke, {
		command: "ceal",
		installed_from_packed_archives: true,
		source_or_workspace_fallback_used: false,
	});
	assert.equal(result.native_smoke.command, "ceal");
	assert.equal(result.native_smoke.operator_surface_absent, true);
	assert.equal(result.client.package, "@corca-ai/ceal");
	assert.equal(result.client.version, result.version);
	assert.match(result.client.sha256, /^[a-f0-9]{64}$/u);
	const files = readdirSync(output).sort();
	assert.deepEqual(
		files,
		[
			".ceal-worker-native-artifact",
			"SHA256SUMS",
			"THIRD_PARTY_NOTICES.txt",
			"ceal-guide-SKILL.md",
			"ceal-worker-native-artifact-manifest.json",
			result.artifact.name,
		].sort(),
	);
	assert.equal(
		files.some((name) => name.includes("cealctl")),
		false,
	);
	const manifest = JSON.parse(readFileSync(path.join(output, "ceal-worker-native-artifact-manifest.json"), "utf8"));
	assertReleaseManifestProvenance(manifest, result, fixture.provenance.artifact.sha256);
	assert.equal(manifest.handoff.sha256, fixture.expectedHandoffSha256);
	assert.equal(manifest.native_smoke.operator_surface_absent, true);
	assert.equal(manifest.guide.name, "ceal-guide.tar");
	assert.ok(manifest.guide.files.some((file) => file.path === "references/capability-workflow.md"));
	assert.equal(manifest.compatibility_guide.name, "ceal-guide-SKILL.md");
	assert.equal(result.native_smoke.embedded_guide_sha256, manifest.guide.sha256);
	assert.equal(result.native_smoke.guide_registration, true);
	const outputCommands = execReleaseTestProcess(path.join(output, result.artifact.name), ["commands"], { encoding: "utf8" });
	assert.match(outputCommands, /command: ceal\n/u);
	assert.match(outputCommands, /name: update\n/u);
	assert.doesNotMatch(outputCommands, /cealctl/u);
	const artifact = path.join(output, result.artifact.name);
	const unknownHome = path.join(fixture.root, "unknown-home");
	writeClientSessionStoreFixture(unknownHome, {
		gatewayEndpoint: "http://127.0.0.1:1/gateway/client",
		label: "native-fixture",
	});
	const unknown = await runArtifact(artifact, ["call", "message.post", "--target", "target:team-inbox", "text=retry-safe"], unknownHome);
	assert.equal(unknown.code, 3);
	assert.equal(unknown.stderr, "");
	const unknownPayload = parse(unknown.stdout);
	assert.equal(unknownPayload.receipt.evidence, "outcome_unknown");
	assert.match(unknownPayload.receipt.request_ref, /^ceal:[a-f0-9-]+:call$/u);
	assert.match(unknownPayload.error.next_action, /Do not repeat this call yet/u);
	assert.doesNotMatch(unknown.stdout, /ceal_personal_|ceal_refresh_/u);
	await withFailureGateway(async (endpoint) => {
		const failedHome = path.join(fixture.root, "failed-home");
		writeClientSessionStoreFixture(failedHome, { gatewayEndpoint: endpoint, label: "native-fixture" });
		const failed = await runArtifact(artifact, ["call", "message.get", "--target", "target:team-inbox", "ref=message:expired"], failedHome);
		assert.equal(failed.code, 3);
		assert.equal(failed.stderr, "");
		const failedPayload = parse(failed.stdout);
		assert.equal(failedPayload.receipt.evidence, "not_read_back");
		assert.match(failedPayload.receipt.request_ref, /^ceal:[a-f0-9-]+:call$/u);
		assert.equal(failedPayload.error.kind, "continuation_not_available");
		assert.doesNotMatch(failed.stdout, /ceal_personal_|ceal_refresh_|server-controlled/u);
	});
	const sums = readFileSync(path.join(output, "SHA256SUMS"), "utf8");
	for (const name of files.filter((name) => !name.startsWith(".") && name !== "SHA256SUMS")) {
		assert.equal(
			sums.split("\n").some((line) => /^[a-f0-9]{64} {2}/u.test(line) && line.endsWith(`  ${name}`)),
			true,
		);
	}
	await assert.rejects(
		() =>
			buildWorkerNativeArtifactFromDevelopmentInputs({
				outputDirectory: path.join(fixture.root, "cross-platform"),
				platform: otherPlatform,
				...fixture,
			}),
		hasCode("platform_mismatch"),
	);
});

// The real postject macho-segment and codesign calls only run on a macOS
// host; this fixture proves the darwin step order, platform propagation, and
// artifact naming deterministically on the Linux lane.
test("darwin native build removes, injects, then ad-hoc signs in order", async () => {
	const fixture = packedFixture;
	const output = path.join(fixture.root, "worker-native-darwin");
	const steps = [];
	const result = await buildWorkerNativeArtifactFromDevelopmentInputs(
		{ outputDirectory: output, ...fixture },
		{
			currentPlatform: () => "darwin-arm64",
			// Every other step of this build is stubbed, because the assertions below
			// are about darwin step order, platform propagation and artifact naming.
			// Staging the real packed consumer proved none of them and cost more than
			// the rest of the test put together; the unstubbed path is proven by the
			// linux test above, which asserts the consumer smoke it produces.
			prepareConsumer: ({ stage }) => {
				const consumerDirectory = path.join(stage, "consumer");
				const workerBin = path.join(consumerDirectory, "node_modules", ".bin", "ceal");
				mkdirSync(path.dirname(workerBin), { recursive: true });
				writeFileSync(workerBin, "#!/usr/bin/env node\n");
				return {
					worker: { name: "ceal-worker-cli-fixture.tgz", bytes: 1, sha256: "0".repeat(64), path: path.join(stage, "fixture.tgz") },
					client: {
						package: "@corca-ai/ceal",
						version: "0.75.0",
						filename: "corca-ai-ceal-0.75.0.tgz",
						bytes: 1,
						sha256: "1".repeat(64),
					},
					consumerSmoke: { resolved: "packed", fixture: true },
					consumer: { directory: consumerDirectory, workerBin },
				};
			},
			bundle: async ({ bundlePath }) => writeFileSync(bundlePath, "bundle\n"),
			createBlob: ({ blobPath }) => writeFileSync(blobPath, "blob\n"),
			copyRuntime: ({ artifactPath }) => writeFileSync(artifactPath, "runtime\n"),
			removeMachoSignature: ({ artifactPath }) => {
				steps.push("remove-signature");
				writeFileSync(artifactPath, "unsigned\n");
			},
			injectBlob: ({ artifactPath, platform }) => {
				steps.push(`inject:${platform}`);
				writeFileSync(artifactPath, "injected\n");
			},
			signMachoAdhoc: ({ artifactPath }) => {
				steps.push("adhoc-sign");
				writeFileSync(artifactPath, "signed\n");
			},
			resolvePostjectCli: () => "postject-fixture",
			smoke: ({ artifactPath, version }) => ({
				command: "ceal",
				version,
				help: true,
				required_commands: [],
				operator_surface_absent: true,
				fixture_artifact: path.basename(artifactPath),
			}),
		},
	);
	assert.equal(result.ok, true);
	assert.equal(result.platform, "darwin-arm64");
	assert.equal(result.artifact.name, "ceal-darwin-arm64");
	assert.deepEqual(steps, ["remove-signature", "inject:darwin-arm64", "adhoc-sign"]);
	assert.equal(readFileSync(path.join(output, "ceal-darwin-arm64"), "utf8"), "signed\n");
	await assert.rejects(
		() =>
			buildWorkerNativeArtifactFromDevelopmentInputs(
				{ outputDirectory: path.join(fixture.root, "darwin-cross"), platform: "linux-arm64", ...fixture },
				{ currentPlatform: () => "darwin-arm64" },
			),
		hasCode("platform_mismatch"),
	);
});

test("production native build accepts only the locked archive lane", async (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-native-boundary-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	await assert.rejects(
		() => buildWorkerNativeArtifact({ outputDirectory: path.join(root, "release-only"), protocolTarball: "/tmp/protocol.tgz" }),
		hasCode("gateway_handoff_archive_required"),
	);
	const messages = [];
	const io = { log: (message) => messages.push(message), error: (message) => messages.push(message) };
	assert.equal(await runCli(["--out", path.join(root, "cli"), "--protocol-tarball", "/tmp/protocol.tgz", "--json"], io), 2);
	assert.equal(JSON.parse(messages.pop()).error_code, "invalid_argument");
});

test("native artifact process proof kills a command tree that exceeds its deadline", async (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-native-process-bound-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const pidFile = path.join(root, "pid");
	const result = await runArtifact(
		"/bin/sh",
		[
			"-c",
			`trap '' TERM; /bin/sh -c 'while :; do sleep 1; done' & child=$!; printf '%s %s' "$$" "$child" > ${JSON.stringify(pidFile)}; printf 'ready\\n'; wait`,
		],
		root,
		{
			timeoutMs: 50,
			terminationGraceMs: 50,
			postKillReportMs: 50,
			postExitDrainMs: 10,
			timeoutStartMarker: "ready\n",
			timeoutStartDeadlineMs: 5_000,
		},
	);
	assert.equal(result.timedOut, true);
	assert.equal(result.signal, "SIGKILL");
	for (const pid of readFileSync(pidFile, "utf8").split(" ").map(Number))
		assert.equal(processIsAlive(pid), false, `timed-out artifact pid ${pid} survived its watchdog`);
});

test("release process deadline starts only after its fixture-ready marker", async (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-native-process-marker-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const result = await runArtifact(
		process.execPath,
		[
			"-e",
			"setTimeout(() => process.stdout.write('ready\\n'), 150); setTimeout(() => process.stdout.write('late\\n'), 500); setTimeout(() => process.exit(0), 3_000)",
		],
		root,
		{
			timeoutMs: 50,
			terminationGraceMs: 50,
			postKillReportMs: 50,
			postExitDrainMs: 10,
			timeoutStartMarker: "ready\n",
			timeoutStartDeadlineMs: 2_000,
		},
	);
	assert.equal(result.timedOut, true);
	assert.match(result.stdout, /ready/u);
	assert.doesNotMatch(result.stdout, /late/u);
});

test("release process fixture-ready marker has its own missing-marker deadline", async (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-native-process-marker-missing-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const result = await runArtifact(process.execPath, ["-e", "setTimeout(() => {}, 250)"], root, {
		timeoutMs: 2_000,
		terminationGraceMs: 50,
		postKillReportMs: 50,
		postExitDrainMs: 10,
		timeoutStartMarker: "ready\n",
		timeoutStartDeadlineMs: 50,
	});
	assert.equal(result.timedOut, true);
	assert.doesNotMatch(result.stdout, /ready/u);
});

test("sync release supervisor budgets the fixture-ready deadline before the command timeout", () => {
	const result = runSyncReleaseProcess(
		process.execPath,
		["-e", "setTimeout(() => process.stdout.write('ready\\n'), 300); setTimeout(() => process.exit(0), 3_000)"],
		{
			encoding: "utf8",
			timeoutStartMarker: "ready\n",
			timeoutStartDeadlineMs: 500,
		},
		10,
		0,
	);
	assert.equal(result.timedOut, true);
	assert.match(result.stdout, /ready/u);
});

function hasCode(code) {
	return (error) => error instanceof WorkerNativeArtifactError && error.code === code;
}

async function runArtifact(artifact, args, home, bounds) {
	return runAsyncReleaseProcess(artifact, args, { cwd: process.cwd(), env: { ...process.env, HOME: home } }, bounds);
}

async function withFailureGateway(callback) {
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		response.writeHead(200, { "content-type": "application/json" });
		response.end(
			JSON.stringify({
				ok: false,
				request_id: body.request_id,
				protocol_version: "1.3.0",
				error: { code: "continuation_not_available", message: "server-controlled", next_action: "server-controlled" },
			}),
		);
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("fixture Gateway address unavailable");
	try {
		await callback(`http://127.0.0.1:${address.port}/gateway/client`);
	} finally {
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
}
