import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateWorkerReleaseInputs, WorkerReleaseInputsError } from "../../scripts/verify-worker-release-inputs.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// The supplied version has to be the one the worker packages declare, because
// that agreement is exactly what this validator checks. Reading it from the
// vendored copy keeps the next artifact consumption from failing here for a
// reason unrelated to the code under test.
const VENDORED_PROTOCOL_VERSION = JSON.parse(
	readFileSync(new URL("../../packages/ceal-protocol/package.json", import.meta.url), "utf8"),
).version;

test("legacy release inventory allows only worker source and a supplied Gateway protocol version", () => {
	const inputs = validateWorkerReleaseInputs({ repoRoot: REPO_ROOT, protocolVersion: VENDORED_PROTOCOL_VERSION });
	assert.equal(inputs.source_repository, "corca-ai/ceal-cli");
	assert.deepEqual(inputs.packages, {
		client: { path: "packages/ceal-client", name: "@corca-ai/ceal" },
		worker: { path: "packages/ceal-worker-cli", name: "@corca-ai/ceal-worker-cli" },
	});
	assert.equal(inputs.guide, "skills/ceal-guide/SKILL.md");
	assert.deepEqual(inputs.protocol, {
		package: "@corca-ai/ceal-protocol",
		input: "gateway_artifact_only",
		version: VENDORED_PROTOCOL_VERSION,
	});
});

test("legacy release inventory rejects every declared Gateway and legacy input", () => {
	for (const forbiddenPath of validInventory().forbidden_paths) {
		const inventory = validInventory();
		if (forbiddenPath.startsWith("packages/")) inventory.packages.worker.path = forbiddenPath;
		else inventory.guide = forbiddenPath;
		assert.throws(
			() => validateWorkerReleaseInputs({ repoRoot: REPO_ROOT, inventory }),
			(error) => error instanceof WorkerReleaseInputsError && error.code === "forbidden_input",
			forbiddenPath,
		);
	}
});

test("legacy release inventory rejects an undeclared protocol version", () => {
	assert.throws(
		() => validateWorkerReleaseInputs({ repoRoot: REPO_ROOT, protocolVersion: "0.65.1" }),
		(error) => error instanceof WorkerReleaseInputsError && error.code === "protocol_version_mismatch",
	);
});

function validInventory() {
	return {
		schema_version: "ceal.worker_release_inputs.v1",
		source_repository: "corca-ai/ceal-cli",
		packages: {
			client: { path: "packages/ceal-client", name: "@corca-ai/ceal" },
			worker: { path: "packages/ceal-worker-cli", name: "@corca-ai/ceal-worker-cli" },
		},
		guide: "skills/ceal-guide/SKILL.md",
		protocol: { package: "@corca-ai/ceal-protocol", input: "gateway_artifact_only" },
		forbidden_paths: [
			"packages/ceal-protocol",
			"packages/ceal-operator-cli",
			"skills/cealctl-guide",
			"install.sh",
			"release-contract.json",
			"scripts/build-platform-binaries.mjs",
			"scripts/build-release-manifest.mjs",
			".github/workflows/cealctl-release.yml",
			".github/workflows/npm-package-stage.yml",
		],
	};
}
