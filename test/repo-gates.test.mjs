import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

function read(relative) {
	return readFileSync(path.join(ROOT, relative), "utf8");
}

// A lint step that only some entry points run is a lint step maintainers learn
// to route around. Both gates must carry it, or "green" means different things
// depending on which command was typed.
test("both gates run the linter, and the final gate runs every suite", () => {
	assert.match(manifest.scripts["check:unit"], /npm run lint/u);
	assert.match(manifest.scripts.check, /npm run lint/u);
	assert.match(manifest.scripts.check, /npm test/u);
	assert.equal(manifest.scripts.lint, "biome lint .");
});

// The frozen packages are compatibility inputs this lane may not originate
// edits in. Linting them would surface findings an agent cannot legally act on,
// and the pressure to "just fix the lint error" is exactly how a frozen copy
// drifts.
test("the linter excludes the frozen packages and leaves formatting alone", () => {
	const biome = JSON.parse(read("biome.json"));
	assert.equal(biome.formatter.enabled, false);
	assert.equal(biome.linter.enabled, true);
	for (const frozen of ["packages/ceal-protocol", "packages/ceal-operator-cli"]) {
		assert.ok(
			biome.files.includes.includes(`!${frozen}/**`),
			`biome.json must exclude the frozen package ${frozen}`,
		);
	}
});

// Release workflows trigger on tags only, so without this lane the first CI run
// for a change is its release run — and a failed release tag cannot be reused.
test("a non-tag CI lane runs the full gate on main", () => {
	const workflow = parse(read(".github/workflows/check.yml"));
	assert.deepEqual(workflow.on.push.branches, ["main"]);
	assert.deepEqual(workflow.on.pull_request.branches, ["main"]);
	assert.ok(
		Object.values(workflow.jobs).some((job) => job.steps.some((step) => step.run === "npm run check")),
		"the check workflow must run the same npm run check maintainers run",
	);
	// The real-binary and installer suites gate themselves on linux-x64, so any
	// other runner reports green while skipping exactly the proofs that matter.
	assert.match(Object.values(workflow.jobs)[0]["runs-on"], /ubuntu/u);
});

// A checked-in hook enforces nothing on its own: it only runs in clones whose
// core.hooksPath points at it, which is why the installer ships beside it.
test("the pre-push hook is checked in and its installer reports honestly", () => {
	assert.ok(existsSync(path.join(ROOT, ".githooks/pre-push")), ".githooks/pre-push must be checked in");
	const hook = read(".githooks/pre-push");
	assert.match(hook, /npm run check:unit/u);
	// A tag push is the expensive one, so it must not settle for the fast gate.
	assert.match(hook, /npm run check\b/u);
	assert.equal(manifest.scripts["hooks:install"], "node scripts/install-git-hooks.mjs");
});

// Proven against a throwaway clone rather than this one: asserting the current
// checkout's core.hooksPath would pass only on a machine that happens to be set
// up, and would fail on CI's fresh checkout for a reason unrelated to the code.
test("the hook installer reports unset, installs, and confirms", (context) => {
	const scratch = mkdtempSync(path.join(tmpdir(), "ceal-hooks-"));
	context.after(() => rmSync(scratch, { recursive: true, force: true }));
	const clone = path.join(scratch, "repo");
	execFileSync("git", ["init", "--quiet", clone], { stdio: "pipe" });
	cpSync(path.join(ROOT, ".githooks"), path.join(clone, ".githooks"), { recursive: true });
	cpSync(path.join(ROOT, "scripts/install-git-hooks.mjs"), path.join(clone, "scripts/install-git-hooks.mjs"), {
		recursive: true,
	});

	const check = () =>
		spawnSync(process.execPath, ["scripts/install-git-hooks.mjs", "--check"], { cwd: clone, encoding: "utf8" });
	// Unset is a state, not a crash: it must exit non-zero and say what to run.
	const before = check();
	assert.equal(before.status, 1);
	assert.match(before.stderr, /npm run hooks:install/u);

	execFileSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: clone, stdio: "pipe" });
	assert.equal(check().status, 0);
	assert.equal(
		execFileSync("git", ["config", "--local", "--get", "core.hooksPath"], { cwd: clone, encoding: "utf8" }).trim(),
		".githooks",
	);
	// Re-running is safe: an installed clone stays installed.
	execFileSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: clone, stdio: "pipe" });
	assert.equal(check().status, 0);
});
