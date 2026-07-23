import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildWorkerReleaseArtifact } from "../scripts/build-worker-release-artifact.mjs";
import { makeGatewayProtocolFixture } from "./gateway-protocol-fixture.mjs";

test("isolated worker artifact builder emits only ceal-owned local build assets", async (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-worker-artifact-test-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const protocolTarball = path.join(root, "protocol.tgz");
	const protocolProvenance = path.join(root, "protocol.json");
	writeFileSync(protocolTarball, "protocol bytes\n");
	writeFileSync(protocolProvenance, "{}\n");
	const workspace = workerWorkspace(root);
	const calls = [];
	const result = await buildWorkerReleaseArtifact({
		protocolTarball,
		protocolProvenance,
		outputDirectory: path.join(root, "output"),
		platform: "linux-amd64",
		version: "0.65.0",
	}, fakeDeps(workspace, calls));
	assert.equal(result.ok, true);
	assert.equal(result.artifact.name, "ceal-linux-amd64");
	assert.equal(result.artifact.smoke.command, "ceal");
	assert.equal(result.checksums.entry_count, 4);
	assert.deepEqual(calls, ["consumer", "bundle", "blob", "runtime", "inject", "smoke"]);
	assert.deepEqual(list(path.join(root, "output")), [
		".ceal-worker-release-output",
		"SHA256SUMS",
		"THIRD_PARTY_NOTICES.txt",
		"ceal-guide-SKILL.md",
		"ceal-linux-amd64",
		"worker-release-manifest.json",
	]);
	const manifest = JSON.parse(readFileSync(path.join(root, "output", "worker-release-manifest.json"), "utf8"));
	assert.equal(manifest.command, "ceal");
	assert.equal(manifest.artifact_state, "unsigned_local_build");
	assert.equal(manifest.artifacts.ceal.name, "ceal-linux-amd64");
	assert.equal(manifest.artifacts.cealctl, undefined);
	assert.equal(existsSync(path.join(root, "output", "cealctl-linux-amd64")), false);
	assert.equal(existsSync(workspace), false);
});

test("worker artifact builder rejects a symlinked output parent before consumer work", async (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-worker-artifact-output-test-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const protocolTarball = path.join(root, "protocol.tgz");
	const protocolProvenance = path.join(root, "protocol.json");
	writeFileSync(protocolTarball, "protocol bytes\n");
	writeFileSync(protocolProvenance, "{}\n");
	mkdirSync(path.join(root, "real"));
	symlinkSync(path.join(root, "real"), path.join(root, "linked-output"), "dir");
	let consumerCalled = false;
	await assert.rejects(
		() => buildWorkerReleaseArtifact({
			protocolTarball,
			protocolProvenance,
			outputDirectory: path.join(root, "linked-output", "release"),
			platform: "linux-amd64",
		}, { currentPlatform: () => "linux-amd64", resolvePostjectCli: () => "postject.js", verifyConsumer: async () => { consumerCalled = true; } }),
		(error) => error?.code === "unsafe_output",
	);
	assert.equal(consumerCalled, false);
});

test("worker artifact builder removes a failed packed-consumer workspace", async (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-worker-artifact-failure-test-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const protocolTarball = path.join(root, "protocol.tgz");
	const protocolProvenance = path.join(root, "protocol.json");
	writeFileSync(protocolTarball, "protocol bytes\n");
	writeFileSync(protocolProvenance, "{}\n");
	const workspace = path.join(tmpdir(), `ceal-gateway-protocol-consumer-test-failure-${process.pid}`);
	mkdirSync(workspace, { recursive: true });
	const failure = new Error("consumer failed");
	failure.workspace = workspace;
	await assert.rejects(
		() => buildWorkerReleaseArtifact({ protocolTarball, protocolProvenance, outputDirectory: path.join(root, "output"), platform: "linux-amd64" }, {
			currentPlatform: () => "linux-amd64",
			resolvePostjectCli: () => "postject.js",
			verifyConsumer: async () => { throw failure; },
		}),
		(error) => error?.code === "consumer_proof_failed",
	);
	assert.equal(existsSync(workspace), false);
});

test("worker artifact builder proves the real packed protocol consumer and SEA output", { skip: process.platform !== "linux" || process.arch !== "x64" }, async (context) => {
	const fixture = makeGatewayProtocolFixture();
	const output = mkdtempSync(path.join(tmpdir(), "ceal-worker-artifact-integration-test-"));
	context.after(() => {
		rmSync(fixture.root, { recursive: true, force: true });
		rmSync(output, { recursive: true, force: true });
	});
	const result = await buildWorkerReleaseArtifact({
		protocolTarball: fixture.tarball,
		protocolProvenance: fixture.provenance,
		outputDirectory: output,
		platform: "linux-amd64",
		version: "0.65.0",
	});
	assert.equal(result.proof_level, "local_integration");
	assert.equal(result.artifact.name, "ceal-linux-amd64");
	assert.deepEqual(list(output), [
		".ceal-worker-release-output",
		"SHA256SUMS",
		"THIRD_PARTY_NOTICES.txt",
		"ceal-guide-SKILL.md",
		"ceal-linux-amd64",
		"worker-release-manifest.json",
	]);
	assert.match(readFileSync(path.join(output, "SHA256SUMS"), "utf8"), /ceal-linux-amd64/u);
});

function workerWorkspace(root) {
	const workspace = path.join(root, "consumer");
	const source = path.join(workspace, "sources", "ceal-worker-cli");
	mkdirSync(path.join(source, "dist"), { recursive: true });
	writeFileSync(path.join(source, "package.json"), JSON.stringify({
		name: "@corca-ai/ceal-worker-cli",
		version: "0.65.0",
		bin: { ceal: "./dist/bin.js" },
	}));
	writeFileSync(path.join(source, "dist", "bin.js"), "worker entry\n");
	return workspace;
}

function fakeDeps(workspace, calls) {
	return {
		currentPlatform: () => "linux-amd64",
		resolvePostjectCli: () => "postject.js",
		verifyConsumer: async () => {
			calls.push("consumer");
			return {
				ok: true,
				workspace,
				gateway_protocol: { source: { repository: "corca-ai/ceal" } },
				worker_source: { repository: "corca-ai/ceal-cli" },
				worker_release_inputs: { guide: "skills/ceal-guide/SKILL.md", guide_sha256: sha256(readFileSync(path.resolve("skills/ceal-guide/SKILL.md"))) },
			};
		},
		bundle: async ({ bundlePath }) => {
			calls.push("bundle");
			writeFileSync(bundlePath, "bundle\n");
		},
		createBlob: ({ blobPath }) => {
			calls.push("blob");
			writeFileSync(blobPath, "blob\n");
		},
		copyRuntime: ({ artifactPath }) => {
			calls.push("runtime");
			writeFileSync(artifactPath, "runtime\n");
		},
		injectBlob: ({ artifactPath }) => {
			calls.push("inject");
			writeFileSync(artifactPath, `${readFileSync(artifactPath, "utf8")}blob\n`);
		},
		smoke: ({ version }) => {
			calls.push("smoke");
			return { ok: true, command: "ceal", version };
		},
	};
}

function list(directory) {
	return readdirSync(directory).sort();
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
