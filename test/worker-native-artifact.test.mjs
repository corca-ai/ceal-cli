import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { buildWorkerNativeArtifact, WorkerNativeArtifactError } from "../scripts/build-worker-native-artifact.mjs";
import { packedProtocolFixture } from "./worker-release-package-fixture.mjs";

test("native worker artifact consumes a manifest-bound packed consumer and emits no operator material", async (context) => {
	const fixture = packedProtocolFixture(context);
	const output = path.join(fixture.root, "worker-native");
	const result = await buildWorkerNativeArtifact({ outputDirectory: output, ...fixture });
	assert.equal(result.ok, true);
	const platform = process.arch === "arm64" ? "linux-arm64" : "linux-amd64";
	const otherPlatform = platform === "linux-arm64" ? "linux-amd64" : "linux-arm64";
	assert.equal(result.platform, platform);
	assert.deepEqual(result.consumer_smoke, {
		command: "ceal", installed_from_packed_archives: true, source_or_workspace_fallback_used: false,
	});
	assert.equal(result.native_smoke.command, "ceal");
	assert.equal(result.native_smoke.operator_surface_absent, true);
	const files = readdirSync(output).sort();
	assert.deepEqual(files, [
		".ceal-worker-native-artifact", "SHA256SUMS", "THIRD_PARTY_NOTICES.txt", "ceal-guide-SKILL.md",
		"ceal-worker-native-artifact-manifest.json", result.artifact.name,
	].sort());
	assert.equal(files.some((name) => name.includes("cealctl")), false);
	const manifest = JSON.parse(readFileSync(path.join(output, "ceal-worker-native-artifact-manifest.json"), "utf8"));
	assert.equal(manifest.artifact.sha256, result.artifact.sha256);
	assert.equal(manifest.protocol.sha256, fixture.provenance.artifact.sha256);
	assert.equal(manifest.handoff.sha256, fixture.expectedHandoffSha256);
	assert.equal(manifest.native_smoke.operator_surface_absent, true);
	const outputCommands = execFileSync(path.join(output, result.artifact.name), ["commands"], { encoding: "utf8" });
	assert.match(outputCommands, /command: ceal\n/u);
	assert.match(outputCommands, /name: update\n/u);
	assert.doesNotMatch(outputCommands, /cealctl/u);
	const artifact = path.join(output, result.artifact.name);
	const unknownHome = path.join(fixture.root, "unknown-home");
	writeStoredSession(unknownHome, "http://127.0.0.1:1/gateway/client");
	const unknown = await runArtifact(artifact, ["call", "message.post", "--target", "target:team-inbox", "text=retry-safe"], unknownHome);
	assert.equal(unknown.code, 3);
	assert.equal(unknown.stderr, "");
	const unknownPayload = parse(unknown.stdout);
	assert.equal(unknownPayload.receipt.evidence, "outcome_unknown");
	assert.match(unknownPayload.receipt.request_ref, /^ceal:[a-f0-9-]+:call$/u);
	assert.match(unknownPayload.error.next_action, /Do not repeat a write yet/u);
	assert.doesNotMatch(unknown.stdout, /ceal_personal_|ceal_refresh_/u);
	await withFailureGateway(async (endpoint) => {
		const failedHome = path.join(fixture.root, "failed-home");
		writeStoredSession(failedHome, endpoint);
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
		assert.equal(sums.split("\n").some((line) => /^[a-f0-9]{64}  /u.test(line) && line.endsWith(`  ${name}`)), true);
	}
	await assert.rejects(
		() => buildWorkerNativeArtifact({ outputDirectory: path.join(fixture.root, "cross-platform"), platform: otherPlatform, ...fixture }),
		hasCode("platform_mismatch"),
	);
});

function hasCode(code) {
	return (error) => error instanceof WorkerNativeArtifactError && error.code === code;
}

function writeStoredSession(home, endpoint) {
	const directory = path.join(home, ".ceal");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	chmodSync(directory, 0o700);
	writeFileSync(path.join(directory, "client-session.json"), `${JSON.stringify({
		schema_version: "ceal.client_session_store.v1",
		gateway_endpoint: endpoint,
		profile_ref: "profile:native-fixture",
		membership_ref: "membership:native-fixture",
		registration_ref: "registration:native-fixture",
		client_ref: "client:native-fixture",
		subject_ref: "subject:native-fixture",
		instance_ref: "instance:native-fixture",
		access_token: `ceal_personal_${"P".repeat(43)}`,
		expires_at: "2099-07-14T00:00:00.000Z",
		refresh_token: `ceal_refresh_${"R".repeat(43)}`,
		refresh_token_idle_expires_at: "2099-08-14T00:00:00.000Z",
		refresh_token_absolute_expires_at: "2099-10-14T00:00:00.000Z",
	}, null, 2)}\n`, { mode: 0o600 });
}

async function runArtifact(artifact, args, home) {
	const child = spawn(artifact, args, { env: { ...process.env, HOME: home }, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	const code = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", resolve);
	});
	return { code, stdout, stderr };
}

async function withFailureGateway(callback) {
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({
			ok: false,
			request_id: body.request_id,
			protocol_version: "1.3.0",
			error: { code: "continuation_not_available", message: "server-controlled", next_action: "server-controlled" },
		}));
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("fixture Gateway address unavailable");
	try { await callback(`http://127.0.0.1:${address.port}/gateway/client`); }
	finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}
