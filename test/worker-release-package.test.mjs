import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	buildWorkerReleasePackage,
	buildWorkerReleasePackageFromDevelopmentInputs,
	runCli,
	WorkerReleasePackageError,
} from "../scripts/build-worker-release-package.mjs";
import { packedProtocolFixture, ROOT } from "./worker-release-package-fixture.mjs";

test("worker package build consumes a manifest-bound packed Protocol and emits no operator material", (context) => {
	const fixture = packedProtocolFixture(context);
	const output = path.join(fixture.root, "worker-package");
	const result = buildWorkerReleasePackageFromDevelopmentInputs({ repoRoot: ROOT, outputDirectory: output, ...fixture });
	assert.equal(result.ok, true);
	assert.deepEqual(result.consumer_smoke, {
		command: "ceal",
		installed_from_packed_archives: true,
		source_or_workspace_fallback_used: false,
	});
	assert.equal(result.artifact.path, undefined);
	const files = readdirSync(output).sort();
	assert.deepEqual(
		files,
		[
			".ceal-worker-release-package",
			"SHA256SUMS",
			"THIRD_PARTY_NOTICES.txt",
			"ceal-guide-SKILL.md",
			"ceal-worker-release-package-manifest.json",
			result.artifact.name,
		].sort(),
	);
	assert.equal(
		files.some((name) => name.includes("cealctl")),
		false,
	);
	const manifest = JSON.parse(readFileSync(path.join(output, "ceal-worker-release-package-manifest.json"), "utf8"));
	assert.equal(manifest.artifact.sha256, result.artifact.sha256);
	assert.equal(manifest.protocol.sha256, fixture.provenance.artifact.sha256);
	const sums = readFileSync(path.join(output, "SHA256SUMS"), "utf8");
	for (const name of files.filter((name) => name !== ".ceal-worker-release-package" && name !== "SHA256SUMS")) {
		assert.equal(
			sums.split("\n").some((line) => /^[a-f0-9]{64} {2}/u.test(line) && line.endsWith(`  ${name}`)),
			true,
		);
	}
	const packedPaths = execFileSync("tar", ["-tzf", path.join(output, result.artifact.name)], { encoding: "utf8" });
	assert.match(packedPaths, /^package\/dist\/bin[.]js$/mu);
	assert.doesNotMatch(packedPaths, /(?:^|\/)src\//u);
	assert.doesNotMatch(packedPaths, /cealctl|operator/u);
});

// The compile failure used to report one sentence for every way tsc can fail,
// including the ways that are not about the source — an OOM kill read as "your
// TypeScript does not compile", and the diagnosis cost a re-run of the tier.
test("a failed worker compile carries the compiler's own output and its terminating signal", (context) => {
	const fixture = packedProtocolFixture(context);
	const output = path.join(fixture.root, "worker-package-compile-failure");
	const killed = Object.assign(new Error("Command failed"), {
		stdout: "src/index.ts(1,1): error TS2307: Cannot find module '@corca-ai/ceal-protocol'.",
		stderr: "",
		signal: "SIGKILL",
	});
	assert.throws(
		() =>
			buildWorkerReleasePackageFromDevelopmentInputs(
				{ repoRoot: ROOT, outputDirectory: output, ...fixture },
				{
					runCompiler: () => {
						throw killed;
					},
				},
			),
		(error) =>
			error instanceof WorkerReleasePackageError &&
			error.code === "worker_package_build_failed" &&
			/SIGKILL/u.test(error.message) &&
			/TS2307/u.test(error.message),
	);
});

test("production package build accepts only the locked archive lane", (context) => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ceal-worker-package-boundary-")));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	assert.throws(
		() =>
			buildWorkerReleasePackage({ repoRoot: ROOT, outputDirectory: path.join(root, "release-only"), protocolTarball: "/tmp/protocol.tgz" }),
		(error) => error instanceof WorkerReleasePackageError && error.code === "gateway_handoff_archive_required",
	);
	const messages = [];
	const io = { log: (message) => messages.push(message), error: (message) => messages.push(message) };
	assert.equal(runCli(["--out", path.join(root, "cli"), "--protocol-tarball", "/tmp/protocol.tgz", "--json"], io), 2);
	assert.equal(JSON.parse(messages.pop()).error_code, "invalid_argument");
});
