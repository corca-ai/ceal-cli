import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
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
	// `biome check`, not `biome lint`: it also verifies formatting, so an
	// unformatted commit fails the gate instead of merely drifting.
	assert.equal(manifest.scripts.lint, "biome check .");
});

// The frozen packages are compatibility inputs this lane may not originate
// edits in. Linting them would surface findings an agent cannot legally act on,
// and the pressure to "just fix the lint error" is exactly how a frozen copy
// drifts.
test("the linter and formatter both run, and both exclude the frozen packages", () => {
	const biome = JSON.parse(read("biome.json"));
	assert.equal(biome.linter.enabled, true);
	assert.equal(biome.formatter.enabled, true);
	// Tabs and a generous width are the existing tree's shape, not a new house
	// style: a narrower width would rewrite far more than the long lines that
	// motivated turning the formatter on.
	assert.equal(biome.formatter.indentStyle, "tab");
	assert.equal(biome.formatter.lineWidth, 140);
	for (const frozen of ["packages/ceal-protocol", "packages/ceal-operator-cli"]) {
		assert.ok(biome.files.includes.includes(`!${frozen}/**`), `biome.json must exclude the frozen package ${frozen}`);
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

// `npm run check` is not self-sufficient on a cold runner: the packed-consumer
// proofs install with --offline, so a runner that skipped the prewarm fails
// them as ENOTCACHED. This gate ran green locally and red on CI for exactly
// that reason; pin the ordering so the next lane cannot repeat it.
test("every CI lane that runs the gate prewarms the offline consumer cache first", () => {
	for (const file of [".github/workflows/check.yml", ".github/workflows/ceal-release.yml"]) {
		const steps = Object.values(parse(read(file)).jobs).flatMap((job) => job.steps ?? []);
		const runs = steps.map((step) => step.run ?? "");
		const gate = runs.findIndex((run) => run.trim() === "npm run check");
		if (gate === -1) continue;
		const prewarm = runs.findIndex((run) => run.includes("prewarm-offline-consumer-cache.mjs"));
		assert.notEqual(prewarm, -1, `${file} runs the gate without prewarming the offline cache`);
		assert.ok(prewarm < gate, `${file} must prewarm the offline cache before running the gate`);
	}
});

// A range in engines.node would let the check lane resolve a different major
// than the release lane builds on, and a green check would stop predicting a
// green release. One pin, asserted equal across both lanes.
test("the check lane and the release lane pin the same Node", () => {
	const pinned = read(".nvmrc").trim();
	assert.match(pinned, /^\d+\.\d+\.\d+$/u);
	assert.match(manifest.engines.node, /^>=/u);

	const checkSetup = Object.values(parse(read(".github/workflows/check.yml")).jobs)
		.flatMap((job) => job.steps ?? [])
		.find((step) => (step.uses ?? "").startsWith("actions/setup-node"));
	assert.equal(checkSetup.with["node-version-file"], ".nvmrc");

	const releaseVersions = Object.values(parse(read(".github/workflows/ceal-release.yml")).jobs)
		.flatMap((job) => job.steps ?? [])
		.filter((step) => (step.uses ?? "").startsWith("actions/setup-node"))
		.map((step) => String(step.with["node-version"]));
	assert.ok(releaseVersions.length > 0, "the release lane must pin a Node version");
	for (const version of releaseVersions) {
		assert.equal(version, pinned, "ceal-release.yml and .nvmrc must pin the same Node");
	}
});

// The reformat touched 64 files at once, so `git blame` needs to be told to skip
// it or most of the tree attributes to that single commit.
test("every formatting-only commit is recorded for git blame to ignore", () => {
	const revisions = read(".git-blame-ignore-revs")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
	assert.ok(revisions.length > 0, ".git-blame-ignore-revs must list the bulk-reformat commit");
	for (const revision of revisions) {
		assert.match(revision, /^[0-9a-f]{40}$/u, "each entry must be a full 40-character SHA, which is what git requires");
	}

	// Resolving each SHA is the check that actually catches a typo, since git
	// ignores an unresolvable entry silently. It only means anything in a full
	// clone: CI checks out with fetch-depth 1, where an ancestor commit is
	// genuinely absent rather than wrong. Skipping beats asserting something the
	// checkout cannot answer — this test failed on CI for exactly that reason.
	const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: ROOT, encoding: "utf8" }).trim();
	if (shallow === "true") return;
	for (const revision of revisions) {
		const type = execFileSync("git", ["cat-file", "-t", revision], { cwd: ROOT, encoding: "utf8" }).trim();
		assert.equal(type, "commit", `${revision} must be a commit in this repository`);
	}
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

	const check = () => spawnSync(process.execPath, ["scripts/install-git-hooks.mjs", "--check"], { cwd: clone, encoding: "utf8" });
	// Unset is a state, not a crash: it must exit non-zero and say what to run.
	const before = check();
	assert.equal(before.status, 1);
	assert.match(before.stderr, /npm run hooks:install/u);

	execFileSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: clone, stdio: "pipe" });
	assert.equal(check().status, 0);
	assert.equal(execFileSync("git", ["config", "--local", "--get", "core.hooksPath"], { cwd: clone, encoding: "utf8" }).trim(), ".githooks");
	// Re-running is safe: an installed clone stays installed.
	execFileSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: clone, stdio: "pipe" });
	assert.equal(check().status, 0);
});

// The reason this suite exists. `test:release` globs `test/*.test.mjs`, which the
// pre-push hook never runs for a branch push — it runs `check:unit`. Every
// repo-contract test written into `test/` was therefore invisible to the hook and
// first failed on CI, twice in one session. Cheap contract tests live in
// `test/contract/` and run inside `check:unit`; the expensive release-artifact
// proofs stay in `test/`. A new file must land in exactly one of the two, because
// landing in neither is the silent failure this guards.
test("every test file under test/ belongs to exactly one suite", () => {
	const scripts = manifest.scripts;
	assert.equal(scripts["test:contract"], "node --test test/contract/*.test.mjs");
	assert.match(scripts["test:release"], /^node --test --test-concurrency=1 test\/\*\.test\.mjs$/u);
	// The two globs are exclusive: test/*.test.mjs cannot match test/contract/*.
	assert.match(scripts["check:unit"], /npm run test:contract/u);
	assert.match(scripts.test, /npm run test:contract/u);
	assert.match(scripts.test, /npm run test:release/u);

	const contract = readdirSync(path.join(ROOT, "test", "contract")).filter((name) => name.endsWith(".test.mjs"));
	const release = readdirSync(path.join(ROOT, "test")).filter((name) => name.endsWith(".test.mjs"));
	assert.ok(contract.length > 0 && release.length > 0);

	// Any other directory under test/ would be globbed by neither script.
	const directories = readdirSync(path.join(ROOT, "test"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
	assert.deepEqual(directories, ["contract"], "a new test/ subdirectory is run by no suite; wire it up or use test/contract/");
});

// The contract suite only helps if it stays fast enough to sit in the iteration
// gate. This is a ceiling on the count, not the runtime, because a runtime
// assertion would be flaky on a loaded machine — but a file that belongs in the
// release tier is usually obvious by name.
test("the contract suite stays small enough to run on every push", () => {
	const contract = readdirSync(path.join(ROOT, "test", "contract")).filter((name) => name.endsWith(".test.mjs"));
	assert.ok(contract.length <= 20, `test/contract has ${contract.length} files; re-check that each is still cheap`);
});
