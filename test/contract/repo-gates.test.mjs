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

// Both gates below have to find "the step that runs the final gate", and both used
// to do it with exact equality after `trim()`. Wrapping the step in a multi-line
// `run:` — to export one env var, say — then made one of them vacuous and the
// other fail claiming the lane does not run the gate at all. One line-wise
// predicate, so the two can no longer disagree about what they are looking at.
function runsFinalGate(step) {
	return (step.run ?? "").split("\n").some((line) => line.trim() === "npm run check");
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
		Object.values(workflow.jobs).some((job) => job.steps.some(runsFinalGate)),
		"the check workflow must run the same npm run check maintainers run",
	);
	// The gate must run everywhere the release lane builds. It did not, and a
	// fixture path that is symlinked on macOS and not on Linux therefore first
	// failed in the tagged run that burned ceal-v0.66.0.
	const runners = Object.values(workflow.jobs).flatMap((job) => (job.strategy?.matrix?.include ?? []).map((entry) => entry.runner));
	const releaseRunners = Object.values(parse(read(".github/workflows/ceal-release.yml")).jobs).flatMap((job) =>
		(job.strategy?.matrix?.include ?? []).map((entry) => entry.runner ?? entry.os),
	);
	for (const family of ["ubuntu", "macos"]) {
		assert.ok(
			runners.some((runner) => String(runner).includes(family)),
			`the check lane must run on ${family}, because the release lane builds there`,
		);
		assert.ok(
			releaseRunners.some((runner) => String(runner).includes(family)),
			`expected the release lane to still build on ${family}`,
		);
	}
	// Being on ubuntu is the image's promise, not a check. This makes that runner
	// prove it ran them, so an image change fails loudly instead of going quiet —
	// and only that runner, since the proofs build for linux-x64 and a macOS
	// runner is correct to skip them.
	const entries = Object.values(workflow.jobs).flatMap((job) => job.strategy?.matrix?.include ?? []);
	const linux = entries.find((entry) => String(entry.runner).includes("ubuntu"));
	assert.equal(linux.require_platform_proofs, "1", "the linux gate must require the platform-gated proofs to actually run");
	for (const entry of entries.filter((candidate) => !String(candidate.runner).includes("ubuntu"))) {
		assert.equal(entry.require_platform_proofs, "0", `${entry.runner} cannot build the linux-x64 proofs, so it must not be asked to`);
	}
	const gate = Object.values(workflow.jobs)
		.flatMap((job) => job.steps ?? [])
		.find(runsFinalGate);
	assert.ok(gate, "the check workflow must still carry one step that runs the final gate");
	assert.match(
		String(gate.env?.CEAL_REQUIRE_PLATFORM_PROOFS),
		/matrix\.require_platform_proofs/u,
		"the gate step must take the requirement from the matrix rather than pinning one value for every runner",
	);
});

// The release procedure used to be "bump the eight version-bearing files by
// hand", and two of those eight were version literals inlined into request
// bodies with no gate at all — a missed one would introduce the client to the
// Gateway under a version it is not, silently, because nothing reads them back.
// The versions are derived from the manifests now; this keeps them that way and
// keeps the manifests agreeing, so a release bumps `package.json` and no more.
test("the shipped version is derived from the manifests, not retyped into source", () => {
	const manifests = {
		root: manifest,
		client: JSON.parse(read("packages/ceal-client/package.json")),
		worker: JSON.parse(read("packages/ceal-worker-cli/package.json")),
	};
	const version = manifests.root.version;
	assert.match(version, /^\d+\.\d+\.\d+$/u, "the root manifest must carry an exact version");
	assert.equal(manifests.client.version, version, "the client manifest must carry the same version as the root");
	assert.equal(manifests.worker.version, version, "the worker manifest must carry the same version as the root");
	// The worker depends on the client by exact version; a stale pin here installs
	// a client whose own handshake version disagrees with the worker's.
	assert.equal(manifests.worker.dependencies["@corca-ai/ceal"], version, "the worker must depend on this exact client version");

	// No source file may carry the current version as a literal. Matching the
	// *current* version rather than any version-shaped string is deliberate: test
	// fixtures legitimately use arbitrary version strings, and only a literal that
	// tracks the release is a hand-bumped copy.
	// AGENTS.md says "nothing else carries the version", so the sweep has to reach
	// everything that could: it covered only the two `src` trees, which left the
	// release scripts, the installer, and the workflows free to retype it.
	const scanned = [];
	for (const root of ["packages/ceal-client/src", "packages/ceal-worker-cli/src", "scripts", ".github/workflows"]) {
		const directory = path.join(ROOT, root);
		for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
			if (!entry.isFile() || /[.](?:map|d[.]ts)$/u.test(entry.name)) continue;
			scanned.push(path.join(root, path.relative(directory, path.join(entry.parentPath ?? entry.path, entry.name))));
		}
	}
	scanned.push("install-ceal.sh");
	assert.ok(scanned.length > 20, `only ${scanned.length} files scanned for a retyped version`);
	for (const relative of scanned) {
		assert.doesNotMatch(
			read(relative),
			new RegExp(`["']${version.replace(/[.]/gu, "[.]")}["']`, "u"),
			`${relative} retypes the released version; derive it from the package manifest instead`,
		);
	}
});

// A release tag that fails cannot be reused, and 0.65.8 was burned by a readback
// that a couple of retries would have survived. The retry is therefore a release
// invariant, not a nicety: a single-shot fetch here spends a tag on a 503.
test("the release lane retries its public readbacks instead of burning the tag", () => {
	const release = read(".github/workflows/ceal-release.yml");
	const script = Object.values(parse(release).jobs)
		.flatMap((job) => job.steps ?? [])
		.map((step) => step.run ?? "")
		.find((run) => run.includes("fetch_public()"));
	assert.ok(script, "the release lane must still define fetch_public");
	// Transport failures and edge 5xx say nothing about the release, so they retry.
	assert.match(script, /000\|429\|5\[0-9\]\[0-9\]/u, "fetch_public must retry transient readback failures");
	// A 404 is real information the uploader acts on, so it must not be retried away.
	assert.doesNotMatch(script, /000\|404/u, "a 404 must stay actionable rather than being retried as transient");
	// Object storage is not read-your-write, so a readback that requires 200 waits.
	assert.match(script, /await_public\(\)/u, "the release lane must define the wait-for-200 readback");
	for (const readback of ["bootstrap_status", "pointer_status"]) {
		assert.match(
			script,
			new RegExp(`${readback}="\\$\\(await_public `, "u"),
			`${readback} requires 200, so it must wait rather than fetch once`,
		);
	}
	// The opposite case, and the reason this is not "await everywhere": the first
	// release has no stable pointer yet, so 404 is a real answer there and waiting
	// for a 200 that will never come would hang the lane instead of proceeding.
	assert.match(script, /current_status="\$\(fetch_public /u, "the stable-pointer probe treats 404 as an answer and must not wait for 200");
});

// A bare `process.platform` skip is how the release suite went green on arm64
// macOS with zero installed-binary proofs: the skip was correct and invisible.
// The shared helper names the missing proof in the output and carries the
// strict-runner escape hatch, so a new inline skip must not reintroduce silence.
test("every platform-gated proof declares its gap through the shared helper", () => {
	// Recursive: this scanned only the top level, so `test/contract/` was never
	// covered — and a suite moving down there (guide-contract did) walked out of the
	// gate silently, into the tier where new tests are most likely to land.
	const suites = readdirSync(path.join(ROOT, "test"), { recursive: true }).filter((name) => name.endsWith(".test.mjs"));
	assert.ok(
		suites.some((suite) => path.dirname(suite) === "contract"),
		"the scan must reach test/contract/, which is where cheap suites live",
	);
	for (const suite of suites) {
		const source = read(path.join("test", suite));
		const inline = /skip:\s*process\.(?:platform|arch)/u.test(source);
		assert.equal(inline, false, `test/${suite} skips on the host platform inline; use platformProofTest from test/platform-proof.mjs`);
	}
	// The helper is only load-bearing if the two proofs that motivated it use it.
	for (const suite of ["build-worker-release-artifact.test.mjs", "worker-release-installer.test.mjs"]) {
		assert.match(read(path.join("test", suite)), /platformProofTest\(/u, `test/${suite} must declare its platform-gated proof`);
	}
});

// `npm run check` is not self-sufficient on a cold runner: the packed-consumer
// proofs install with --offline, so a runner that skipped the prewarm fails
// them as ENOTCACHED. This gate ran green locally and red on CI for exactly
// that reason; pin the ordering so the next lane cannot repeat it.
test("every CI lane that runs the gate prewarms the offline consumer cache first", () => {
	for (const file of [".github/workflows/check.yml", ".github/workflows/ceal-release.yml"]) {
		const steps = Object.values(parse(read(file)).jobs).flatMap((job) => job.steps ?? []);
		const runs = steps.map((step) => step.run ?? "");
		// Asserted rather than skipped: exact equality plus `if (gate === -1) continue`
		// silently made this whole test vacuous for a lane whose gate step moved to a
		// multi-line `run:`, which is the failure it exists to prevent.
		const gate = steps.findIndex(runsFinalGate);
		assert.notEqual(gate, -1, `${file} no longer runs 'npm run check'; this gate cannot silently stop applying`);
		const prewarm = runs.findIndex((run) => run.includes("prewarm-offline-consumer-cache.mjs"));
		assert.notEqual(prewarm, -1, `${file} runs the gate without prewarming the offline cache`);
		assert.ok(prewarm < gate, `${file} must prewarm the offline cache before running the gate`);
	}
});

// A mutable action ref resolves to whatever the tag points at when the lane runs,
// which for the release lanes is the moment artifacts get signed and published.
// Two pin assertions already existed, but between them they covered exactly one
// workflow this lane can edit (`npm-package-stage.yml`) and one it cannot
// (`cealctl-release.yml`, frozen) — so `check.yml`, `ceal-release.yml`, and
// `ceal-worker-stable-rollback.yml` were pinned only by habit. A frozen file may
// be read, so this asserts across every workflow rather than a hand-kept list.
test("every workflow pins every action to a full commit SHA", () => {
	const directory = path.join(ROOT, ".github/workflows");
	const workflows = readdirSync(directory).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
	assert.ok(workflows.length >= 5, `only ${workflows.length} workflows found; the scan is not reaching .github/workflows`);
	let pinned = 0;
	for (const name of workflows) {
		const uses = [...read(path.join(".github/workflows", name)).matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gmu)].map((match) => match[1]);
		// A zero-match file would satisfy the loop below trivially, which is how a
		// reformat or a flow-style `uses` key turns this kind of sweep vacuous.
		assert.ok(uses.length > 0, `${name} declares no 'uses:' step; confirm that is real rather than a parse miss`);
		for (const action of uses) {
			// A local composite action (`./.github/actions/...`) has no ref to pin.
			if (action.startsWith("./")) continue;
			assert.match(action, /@[a-f0-9]{40}$/u, `${name} uses a mutable action ref: ${action}`);
			pinned += 1;
		}
	}
	assert.ok(pinned >= 10, `only ${pinned} pinned action refs checked across ${workflows.length} workflows`);
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
