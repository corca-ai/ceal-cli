import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
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
