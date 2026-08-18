import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { scanRepository } from "../../scripts/check-import-hard-failures.ts";

const ROOT = process.cwd();

function scanVirtual(files: Record<string, string>, sourceFiles: readonly string[], referenceFiles: readonly string[] = []) {
	const contents = new Map(Object.entries(files).map(([file, source]) => [`/repo/${file}`, source]));
	return scanRepository("/repo", {
		sourceFiles,
		referenceFiles,
		readFile: (absolutePath) => contents.get(absolutePath) ?? null,
		fileExists: (absolutePath) => contents.has(absolutePath),
	});
}

function git(repoRoot: string, ...args: string[]): void {
	execFileSync("git", ["-C", repoRoot, ...args], { stdio: "ignore" });
}

test("Worker import gate reports a missing runtime target without a baseline", () => {
	const result = scanVirtual({ "src/main.ts": 'import "./missing.mjs";\n' }, ["src/main.ts"]);
	assert.deepEqual(result.failures, [{ kind: "import", file: "src/main.ts", specifier: "./missing.mjs" }]);
});

test("Worker import gate accepts loader rewrites and emitted dist-to-src ownership", () => {
	const result = scanVirtual(
		{
			"src/main.ts": 'import "./sibling.js";\nimport "../dist/public/index.js";\n',
			"src/sibling.ts": "export {};\n",
			"src/public/index.ts": "export {};\n",
		},
		["src/main.ts"],
	);
	assert.deepEqual(result.failures, []);
});

test("Worker import gate ignores type-only and package imports", () => {
	const result = scanVirtual({ "src/main.ts": 'import type { Missing } from "./missing.js";\nconst load = import("external-package");\n' }, [
		"src/main.ts",
	]);
	assert.deepEqual(result.failures, []);
});

test("Worker staged import gate reads the index projection, including staged deletions", () => {
	const scratch = mkdtempSync(path.join(tmpdir(), "ceal-worker-import-staged-"));
	try {
		mkdirSync(path.join(scratch, "src"));
		git(scratch, "init", "-q");
		writeFileSync(path.join(scratch, "src/main.ts"), 'import "./missing.mjs";\n');
		git(scratch, "add", "src/main.ts");
		writeFileSync(path.join(scratch, "src/main.ts"), 'import "./worktree.ts";\n');
		writeFileSync(path.join(scratch, "src/worktree.ts"), "export {};\n");
		assert.deepEqual(scanRepository(scratch, {}, true).failures, [{ kind: "import", file: "src/main.ts", specifier: "./missing.mjs" }]);

		writeFileSync(path.join(scratch, "src/main.ts"), 'import "./target.ts";\n');
		writeFileSync(path.join(scratch, "src/target.ts"), "export {};\n");
		git(scratch, "add", "src/main.ts", "src/target.ts");
		rmSync(path.join(scratch, "src/target.ts"));
		git(scratch, "add", "-u");
		assert.deepEqual(scanRepository(scratch, {}, true).failures, [{ kind: "import", file: "src/main.ts", specifier: "./target.ts" }]);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});

test("Worker path gate excludes diagnostic records but checks receiving-owned references", () => {
	const result = scanVirtual(
		{
			"config/typecheck-baseline.json": '{"file":"scripts/removed.js"}\n',
			"package.json": '"entry": "scripts/removed.js"\n',
		},
		[],
		["config/typecheck-baseline.json", "package.json"],
	);
	assert.deepEqual(result.failures, [{ kind: "reference", file: "package.json", specifier: "scripts/removed.js" }]);
});

test("Worker package, check, hook, and contract expose the receiving import gate", () => {
	const manifest = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")) as { scripts: Record<string, string> };
	assert.equal(manifest.scripts["lint:import-hard-failures"], "node scripts/check-import-hard-failures.ts --repo-root .");
	assert.equal(manifest.scripts["lint:import-hard-failures:staged"], "node scripts/check-import-hard-failures.ts --repo-root . --staged");
	assert.match(manifest.scripts.check, /npm run lint:import-hard-failures/u);
	assert.match(manifest.scripts["check:unit"], /npm run lint:import-hard-failures/u);
	assert.match(
		readFileSync(`${ROOT}/.githooks/pre-commit`, "utf8"),
		/^run_gate "import hard failures" npm run lint:import-hard-failures:staged$/mu,
	);
	const contract = JSON.parse(readFileSync(`${ROOT}/config/gate-contract.json`, "utf8")) as {
		hook_tiers: Array<{ commands: Array<{ gate_commands: string[] }> }>;
	};
	const preCommitCommands = contract.hook_tiers[0]?.commands[0]?.gate_commands ?? [];
	assert.ok(preCommitCommands.includes("npm run lint:import-hard-failures:staged"));
});
