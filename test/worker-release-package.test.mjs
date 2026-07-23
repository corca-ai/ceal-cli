import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildWorkerReleasePackage } from "../scripts/build-worker-release-package.mjs";
import { ROOT, packedProtocolFixture } from "./worker-release-package-fixture.mjs";

test("worker package build consumes a manifest-bound packed Protocol and emits no operator material", (context) => {
	const fixture = packedProtocolFixture(context);
	const output = path.join(fixture.root, "worker-package");
	const result = buildWorkerReleasePackage({ repoRoot: ROOT, outputDirectory: output, ...fixture });
	assert.equal(result.ok, true);
	assert.deepEqual(result.consumer_smoke, {
		command: "ceal", installed_from_packed_archives: true, source_or_workspace_fallback_used: false,
	});
	assert.equal(result.artifact.path, undefined);
	const files = readdirSync(output).sort();
	assert.deepEqual(files, [
		".ceal-worker-release-package", "SHA256SUMS", "THIRD_PARTY_NOTICES.txt", "ceal-guide-SKILL.md",
		"ceal-worker-release-package-manifest.json", result.artifact.name,
	].sort());
	assert.equal(files.some((name) => name.includes("cealctl")), false);
	const manifest = JSON.parse(readFileSync(path.join(output, "ceal-worker-release-package-manifest.json"), "utf8"));
	assert.equal(manifest.artifact.sha256, result.artifact.sha256);
	assert.equal(manifest.protocol.sha256, fixture.provenance.artifact.sha256);
	const sums = readFileSync(path.join(output, "SHA256SUMS"), "utf8");
	for (const name of files.filter((name) => name !== ".ceal-worker-release-package" && name !== "SHA256SUMS")) {
		assert.equal(sums.split("\n").some((line) => /^[a-f0-9]{64}  /u.test(line) && line.endsWith(`  ${name}`)), true);
	}
	const packedPaths = execFileSync("tar", ["-tzf", path.join(output, result.artifact.name)], { encoding: "utf8" });
	assert.match(packedPaths, /^package\/dist\/bin[.]js$/mu);
	assert.doesNotMatch(packedPaths, /(?:^|\/)src\//u);
	assert.doesNotMatch(packedPaths, /cealctl|operator/u);
});
