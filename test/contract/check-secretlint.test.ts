import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { secretlintRunGroups, secretlintTargetFiles, syntheticSecretlintConfig } from "../../scripts/run-secretlint.ts";

const ROOT = process.cwd();

function readJson(relativePath: string): Record<string, unknown> {
	return JSON.parse(readFileSync(`${ROOT}/${relativePath}`, "utf8")) as Record<string, unknown>;
}

test("Worker secretlint scope is tracked source and docs, not local artifacts", () => {
	const files = secretlintTargetFiles({ repoRoot: ROOT });
	assert.ok(files.includes("scripts/check-no-legacy-mjs.ts"));
	assert.ok(files.includes("package.json"));
	assert.equal(
		files.some((file) => file.startsWith("charness-artifacts/")),
		false,
	);
	assert.equal(
		files.some((file) => file.startsWith("node_modules/")),
		false,
	);
});

test("Worker synthetic Slack fixture is isolated from the standard run", () => {
	assert.deepEqual(secretlintRunGroups(["packages/ceal-worker-cli/test/cli.test.ts", "packages/ceal-worker-cli/src/cli-runtime.ts"]), {
		standardFiles: ["packages/ceal-worker-cli/src/cli-runtime.ts"],
		syntheticFixtureFiles: ["packages/ceal-worker-cli/test/cli.test.ts"],
	});
	const config = syntheticSecretlintConfig(ROOT);
	const slackRule = config.rules?.find((rule) => rule.id === "@secretlint/secretlint-rule-slack");
	assert.deepEqual(slackRule?.options?.allows, [`/^${["xoxb", "never", "render"].join("-")}$/`]);
});

test("Worker package, check, hook, and declarative contract expose secretlint", () => {
	const manifest = readJson("package.json");
	const scripts = manifest.scripts as Record<string, string>;
	assert.equal(scripts["lint:secrets"], "node scripts/run-secretlint.ts");
	assert.equal(scripts["lint:secrets:staged"], "node scripts/run-secretlint.ts --staged");
	assert.match(scripts.check, /npm run lint:secrets/u);
	assert.match(scripts["check:unit"], /npm run lint:secrets/u);
	const hook = readFileSync(`${ROOT}/.githooks/pre-commit`, "utf8");
	assert.match(hook, /^run_gate "secrets" npm run lint:secrets:staged$/mu);
	const contract = readJson("config/gate-contract.json");
	const hookTiers = contract.hook_tiers as Array<{ commands: Array<{ gate_commands: string[] }> }>;
	const preCommitCommands = hookTiers[0]?.commands[0]?.gate_commands ?? [];
	assert.ok(preCommitCommands.includes("npm run lint:secrets:staged"));
});
