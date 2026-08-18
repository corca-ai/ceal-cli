import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { secretlintRunGroups, secretlintTargetFiles, syntheticSecretlintConfig } from "../../scripts/run-secretlint.ts";
import { required as requiredValue } from "../required.ts";

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

test("Worker staged projection sees staged additions but not unstaged files", () => {
	const scratch = mkdtempSync(path.join(tmpdir(), "ceal-worker-secretlint-staged-"));
	try {
		mkdirSync(path.join(scratch, "scripts"));
		writeFileSync(path.join(scratch, "scripts/staged.ts"), "export const staged = true;\n");
		writeFileSync(path.join(scratch, "scripts/unstaged.ts"), "export const unstaged = true;\n");
		execFileSync("git", ["-C", scratch, "init", "-q"]);
		execFileSync("git", ["-C", scratch, "add", "scripts/staged.ts"]);
		assert.deepEqual(secretlintTargetFiles({ repoRoot: scratch, staged: true }), ["scripts/staged.ts"]);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
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
	assert.match(requiredValue(scripts.check, "check_script"), /npm run lint:secrets/u);
	assert.match(requiredValue(scripts["check:unit"], "check_unit_script"), /npm run lint:secrets/u);
	const hook = readFileSync(`${ROOT}/.githooks/pre-commit`, "utf8");
	assert.match(hook, /^run_gate "secrets" npm run lint:secrets:staged$/mu);
	const contract = readJson("config/gate-contract.json");
	const hookTiers = contract.hook_tiers as Array<{ commands: Array<{ gate_commands: string[] }> }>;
	const preCommitCommands = hookTiers[0]?.commands[0]?.gate_commands ?? [];
	assert.ok(preCommitCommands.includes("npm run lint:secrets:staged"));
});

test("Worker rules reject a live-shaped GitHub token in an isolated file", () => {
	const scratch = mkdtempSync(path.join(tmpdir(), "ceal-worker-secretlint-live-"));
	const file = path.join(scratch, "input.txt");
	try {
		writeFileSync(file, `const token = ${JSON.stringify(["ghp", "0".repeat(36)].join("_"))};\n`);
		const result = spawnSync(
			process.execPath,
			[
				path.resolve(ROOT, "node_modules/secretlint/bin/secretlint.js"),
				"--no-color",
				"--format",
				"compact",
				"--no-glob",
				"--secretlintrc",
				path.resolve(ROOT, ".secretlintrc.json"),
				file,
			],
			{ cwd: ROOT, encoding: "utf8" },
		);
		assert.equal(result.error, undefined);
		assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});
