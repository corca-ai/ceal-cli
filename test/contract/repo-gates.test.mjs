import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

const WORKER_CONTRACT_TESTS = [
	"test/contract/gateway-leased-consumer-call-handoff.test.mjs",
	"test/contract/prewarm-offline-consumer-cache.test.mjs",
	"test/contract/probe-surface.test.mjs",
	"test/contract/protocol-vendor-pin.test.mjs",
	"test/contract/repo-build.test.mjs",
	"test/contract/repo-gates.test.mjs",
	"test/contract/safe-output-path.test.mjs",
	"test/contract/script-lib.test.mjs",
	"test/contract/worker-acceptance-packet.test.mjs",
	"test/contract/worker-gateway-handoff-archive.test.mjs",
	"test/contract/worker-guide-contract.test.mjs",
	"test/contract/worker-release-assets.test.mjs",
	"test/contract/worker-release-inputs.test.mjs",
];
const WORKER_RELEASE_TESTS = [
	"test/gateway-protocol-consumer.test.mjs",
	"test/worker-native-artifact.test.mjs",
	"test/worker-release-installer.test.mjs",
	"test/worker-release-package.test.mjs",
];

function testFilesIn(script) {
	return (script ?? "")
		.split(/\s+/u)
		.filter((token) => token.endsWith(".test.mjs"))
		.sort();
}

function read(relative) {
	return readFileSync(path.join(ROOT, relative), "utf8");
}

// Two tests read the coverage runner: the one that checks how scripts/ is
// measured, and the one that resolves `npm test` down to the two tiers. Naming
// the path once means a rename cannot leave one of them reading a stale file.
function runnerSource() {
	return read("scripts/coverage-scripts.mjs");
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
	// The claim is which package must not be a workspace, plus which three must
	// be. An ordered deepEqual additionally fails on a legitimately added
	// workspace, which is drift-reporting, not defect-reporting.
	for (const owned of ["packages/ceal-protocol", "packages/ceal-client", "packages/ceal-worker-cli"]) {
		assert.ok(manifest.workspaces.includes(owned), `${owned} must be a workspace`);
	}
	// `packages/ceal-operator-cli` used to sit here as a frozen non-workspace copy.
	// `corca-ai/ceal` owns and has moved past it, so the copy is gone and the claim
	// is now about the directory, not the workspace list: re-vendoring a stale fork
	// is the defect, and a workspace assertion would not catch it.
	assert.ok(!existsSync(path.join(ROOT, "packages", "ceal-operator-cli")), "cealctl source belongs to corca-ai/ceal, not this repo");
	assert.match(manifest.scripts["check:unit"], /npm run lint/u);
	assert.match(manifest.scripts.check, /npm run lint/u);
	assert.match(manifest.scripts.check, /npm test/u);
	// `biome check`, not `biome lint`: it also verifies formatting, so an
	// unformatted commit fails the gate instead of merely drifting. Two separate
	// claims — the subcommand and the scope — rather than one exact string, so a
	// reporter or config flag is allowed but a narrowed scope is not.
	assert.match(manifest.scripts.lint, /^biome check\b/u);
	assert.ok(manifest.scripts.lint.split(/\s+/u).includes("."), "the linter must run over the whole tree");
	assert.doesNotMatch(manifest.scripts.lint, /--changed|--staged|--since/u);
	assert.match(manifest.scripts.build, /npm run build:worker/u);
	assert.match(manifest.scripts["build:worker"], /^node scripts\/generate-leased-consumer-handoff-runtime[.]mjs/u);
	assert.match(manifest.scripts["build:worker"], /packages\/ceal-protocol run build/u);
	for (const ownerPackage of ["packages/ceal-client", "packages/ceal-worker-cli"]) {
		assert.match(manifest.scripts["build:worker"], new RegExp(`${ownerPackage} run build`, "u"));
		assert.match(manifest.scripts.coverage, new RegExp(`${ownerPackage} run coverage`, "u"));
	}
	assert.doesNotMatch(manifest.scripts.coverage, /packages\/ceal-protocol/u);
	// `test:unit` IS the coverage run. Running the suites plainly and then again
	// under c8 paid for the same 275 tests twice and let the floor apply to a
	// second execution nobody read. A separate `coverage` script stays for a
	// human who wants the report without the rest of the gate.
	assert.equal(manifest.scripts["test:unit"], "npm run coverage");

	// A floor is only a floor if it fails closed, and c8 only checks one when the
	// config says so. `check-coverage` false anywhere turns the whole thing into a
	// report the gate prints and ignores.
	for (const ownerPackage of ["ceal-client", "ceal-worker-cli"]) {
		const config = JSON.parse(read(`packages/${ownerPackage}/.c8rc.json`));
		assert.equal(config["check-coverage"], true, `${ownerPackage} must fail below its floor, not just report`);
		assert.equal(config.all, true, `${ownerPackage} must count modules no test loaded; without this they are invisible, not zero`);
		for (const ratio of ["statements", "branches", "functions", "lines"]) {
			assert.ok(config[ratio] > 80, `${ownerPackage} ${ratio} floor is ${config[ratio]}; a floor under what is measured catches nothing`);
		}
	}
	const workerPackage = JSON.parse(read("packages/ceal-worker-cli/package.json"));
	assert.match(workerPackage.scripts.build, /^tsc -p tsconfig\.build\.json\b/u);
	// A trailing `|| true` would make every type error a green build, which is the
	// one thing loosening this assertion off exact equality must not permit.
	assert.doesNotMatch(workerPackage.scripts.build, /\|\||;|--noEmit/u);
});

// The third target. `scripts/` is the release lane's production code and was the
// one owned tree with no coverage at all, so a guard nobody called looked exactly
// like a guard everybody called. It is measured to make that difference visible
// on every run instead of by hand-audit.
test("scripts/ is measured on the same terms as the two packages", () => {
	const config = JSON.parse(read(".c8rc.scripts.json"));
	// Same three properties the packages carry, and for the same reasons: without
	// `check-coverage` the floor is a printed number, and without `all` an entirely
	// untested script is absent from the report rather than zero — which is the
	// single failure mode this target exists to prevent.
	assert.equal(config["check-coverage"], true, "scripts/ coverage must fail below its floor, not just report");
	assert.equal(config.all, true, "scripts/ must count scripts no test loaded; without this an unreached guard is invisible, not zero");
	// Measured on 2026-08-08 across both tiers at 80.55 / 72.68 / 89.75 / 80.55.
	// The floors sit just under. Nothing here may fall back to the portable 80%
	// default, which for branches would sit eight points above what is measured
	// and for the rest would be a floor that cannot fail.
	assert.deepEqual(Object.fromEntries(["statements", "branches", "functions", "lines"].map((ratio) => [ratio, config[ratio]])), {
		statements: 80,
		branches: 72,
		functions: 89,
		lines: 80,
	});
	// `all: true` enumerates from `src`, and `include` is what keeps the report to
	// this tree: without it a run that also loaded `packages/*/dist` would fold
	// that coverage into the same ratios.
	assert.equal(config.src, "scripts");
	assert.deepEqual(config.include, ["scripts/**/*.mjs"]);
	assert.deepEqual(config.extension, [".mjs"]);
	// One exclusion, by name and with a reason, matching the discipline the two
	// packages already follow. The runner spawns c8 and so is never inside the
	// coverage it produces; nothing else may be excluded, because an exclusion here
	// is precisely how an unreached guard would be hidden again.
	assert.deepEqual(config.exclude, ["scripts/coverage-scripts.mjs"]);

	// c8 exits 0 when its file set is empty — verified, not assumed: an `include`
	// matching nothing prints all-zero ratios and still passes, because istanbul
	// computes them from 0/0 totals. So the floor alone cannot tell "measured and
	// passed" from "measured nothing", and the runner compares the emitted
	// `coverage-summary.json` against the inventory on disk after every measured
	// run. That check is the one this whole target rests on.
	assert.match(runnerSource(), /function assertReportIsNotEmpty\(\)/u);
	assert.match(runnerSource(), /^\s*assertReportIsNotEmpty\(\);/mu, "the emptiness check must be called, not merely declared");

	// `extension` is the other half of that inventory, and it is why this must not
	// silently widen: a `.js` or `.sh` helper dropped into scripts/ matches neither
	// the glob nor the runner's inventory, so it would be unmeasured rather than
	// zero and nothing would say so.
	const foreign = readdirSync(path.join(ROOT, "scripts"), { recursive: true })
		.map((name) => `scripts/${name}`.replaceAll(path.sep, "/"))
		.filter((name) => /[.](?:js|cjs|mts|ts|sh)$/u.test(name));
	assert.deepEqual(foreign, [], "scripts/ carries a file the .mjs-only coverage inventory cannot see; measure it or move it");

	// The floor must be enforced where the full proof set runs. `platformProofTest`
	// correctly skips the installed-binary proofs elsewhere, so a floor applied
	// there would fail a run for skipping what it is right to skip — but the
	// converse is the real risk: dropping the release platform out of the runner's
	// list would leave the floor enforced only on hosts that prove less.
	const proofPlatform = read("test/platform-proof.mjs").match(/PLATFORM_PROOF_PLATFORM = "([^"]+)"/u);
	const enforced = runnerSource().match(/MEASURED_PLATFORMS = Object\.freeze\(\[([^\]]*)\]\)/u);
	assert.ok(proofPlatform && enforced, "the proof helper and the coverage runner must each name their platforms in one place");
	assert.ok(
		enforced[1].includes(`"${proofPlatform[1]}"`),
		`the coverage floor must be enforced on ${proofPlatform[1]}, the host that carries every platform proof`,
	);
	// And nowhere the proofs cannot run. Adding `darwin` here is the `ceal-v0.67.0`
	// shape the runner exists to avoid, and it would look like widening coverage.
	assert.doesNotMatch(enforced[1], /darwin|win32/u, "the floor may only be enforced where the platform proofs run");
});

// `npm ci` installs a platform binary only if `package-lock.json` carries that
// platform's package. npm records the ones matching the host it resolved on, and
// silently drops the rest when `node_modules` is present — so a maintainer on one
// architecture regenerating the lock removes every other runner's toolchain, with
// no error and no diff a reader would read as a break.
//
// That happened on 2026-08-08 (`d8fc5fd`): 6 of 8 `@biomejs/cli-*` and 25 of 26
// `@esbuild/*` entries left the lock, `biome check .` — the FIRST command of
// `npm run check` — died on every non-arm64 runner, and five consecutive
// `check.yml` runs failed. The release lane runs the same gate on `linux-amd64`
// and `darwin-arm64`, so the next tag would have burned on two of three legs.
//
// Derived from the runners the lanes actually declare, not a hardcoded list: a
// new runner architecture must bring its toolchain with it.
test("the lockfile carries a toolchain for every platform the lanes run on", () => {
	const RUNNER_PLATFORMS = { ubuntu: "linux", macos: "darwin" };
	const RUNNER_ARCHITECTURES = [
		["-arm", "arm64"],
		["", "x64"],
	];
	const workflows = readdirSync(path.join(ROOT, ".github", "workflows")).filter((name) => name.endsWith(".yml"));
	const runners = new Set(
		workflows.flatMap((name) =>
			Object.values(parse(read(path.join(".github", "workflows", name))).jobs ?? {}).flatMap((job) =>
				[job["runs-on"], ...(job.strategy?.matrix?.include ?? []).map((entry) => entry.runner ?? entry.os)]
					.filter((value) => typeof value === "string" && !value.includes("${{"))
					.map(String),
			),
		),
	);
	// macOS runners are arm64 whatever the image name says, so the suffix rule
	// below only decides the Linux ones.
	const required = new Set(
		[...runners].map((runner) => {
			const os = Object.entries(RUNNER_PLATFORMS).find(([image]) => runner.includes(image))?.[1];
			assert.ok(os, `unknown runner image '${runner}'; teach this gate its platform before adding it to a lane`);
			if (os === "darwin") return "darwin-arm64";
			return `linux-${RUNNER_ARCHITECTURES.find(([suffix]) => suffix && runner.endsWith(suffix))?.[1] ?? "x64"}`;
		}),
	);
	assert.ok(required.size >= 2, `only ${required.size} platform derived from ${runners.size} runners; this check would be near-vacuous`);

	const lock = JSON.parse(read("package-lock.json"));
	const present = new Set(Object.keys(lock.packages));
	// Every optional dependency any package declares whose *name* carries one of
	// those platforms. The name is what npm resolves against, so a missing entry
	// is exactly an uninstallable toolchain — no registry access needed to tell.
	const declared = [...new Set(Object.values(lock.packages).flatMap((entry) => Object.keys(entry.optionalDependencies ?? {})))];
	assert.ok(declared.length > 0, "no optional platform dependencies found; this check would be vacuous");
	const missing = declared.filter(
		(name) => [...required].some((platform) => name.endsWith(platform)) && !present.has(`node_modules/${name}`),
	);
	assert.deepEqual(
		missing,
		[],
		`package-lock.json is missing ${missing.length} platform package(s) a lane runner needs: ${missing.join(", ")}. Regenerate the lock without node_modules present — npm prunes the platforms it cannot see.`,
	);
});

// The frozen packages are compatibility inputs this lane may not originate
// edits in. Linting them would surface findings an agent cannot legally act on,
// and the pressure to "just fix the lint error" is exactly how a frozen copy
// drifts.
test("the linter and formatter both run, and both exclude the frozen package", () => {
	const biome = JSON.parse(read("biome.json"));
	assert.equal(biome.linter.enabled, true);
	assert.equal(biome.formatter.enabled, true);
	// Tabs and a generous width are the existing tree's shape, not a new house
	// style: a narrower width would rewrite far more than the long lines that
	// motivated turning the formatter on.
	assert.equal(biome.formatter.indentStyle, "tab");
	assert.equal(biome.formatter.lineWidth, 140);
	// The thing that must hold is that the frozen package is excluded, not which
	// spelling biome prefers this year. Pinning the literal `!<path>/**` made a
	// correct migration to `!<path>` — biome's own fixable preference — look like
	// a removed exclusion.
	const frozen = "packages/ceal-protocol";
	assert.ok(
		biome.files.includes.some((pattern) => pattern === `!${frozen}` || pattern === `!${frozen}/**`),
		`biome.json must exclude the frozen package ${frozen}`,
	);
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

// Both gate legs are conditional now, so `scope` is no longer a cost optimisation
// with an unconditional leg behind it — it is the only thing between a code
// change and no CI at all. The danger was never the skip, it is the filter
// widening later: one `packages/` or `scripts/` entry added to the allowlist
// would silently return this repository to the state that burned
// `ceal-v0.66.0`, and nothing else would notice, because a skipped job reports
// success. That was true when one leg still ran; it is now the whole of the
// protection. So the allowlist is asserted against real paths, not merely
// asserted to exist.
test("the check lane may skip a gate only for documentation-only changes", () => {
	const workflow = parse(read(".github/workflows/check.yml"));
	const conditional = Object.entries(workflow.jobs).filter(([, job]) => typeof job.if === "string");
	// The classifier itself must not be conditional, or the answer every other job
	// depends on could go unasked.
	assert.ok(!conditional.some(([name]) => name === "scope"), "the scope job must run unconditionally; nothing else can decide for it");
	assert.ok(conditional.length > 0, "at least one leg must be scope-gated, or the classifier decides nothing");
	for (const [name, job] of conditional) {
		// The condition must be the classifier's answer rather than anything a
		// commit message, an actor, or a label could set.
		assert.match(job.if, /^needs\.scope\.outputs\.code == 'true'$/u, `'${name}' must run on exactly the scope job's verdict`);
		assert.ok([job.needs].flat().includes("scope"), `'${name}' must depend on the scope job it reads`);
	}
	// Every leg that runs the gate has to be reachable on a code change. A job
	// gated on something the classifier cannot report 'true' for would look like a
	// running gate and never run.
	const gateJobs = Object.entries(workflow.jobs).filter(([, job]) => (job.steps ?? []).some(runsFinalGate));
	assert.ok(gateJobs.length >= 2, "both the linux and the macOS gate legs must still exist");
	for (const [name, job] of gateJobs) {
		assert.ok(
			typeof job.if !== "string" || job.if.includes("needs.scope.outputs.code"),
			`'${name}' must be gated on the classifier or not at all`,
		);
	}

	const classify = (workflow.jobs.scope?.steps ?? []).map((step) => step.run ?? "").join("\n");
	assert.ok(classify.includes("git diff --name-only"), "the scope job must classify from the actual changed paths");
	// Read the allowlist out of the classifier and prove the code directories are
	// not in it. Matching the pattern text would pass on a regex that happens to
	// contain the right characters, so this runs it against real paths instead.
	const pattern = /grep -vE '\^\(([^']+)\)'/u.exec(classify);
	assert.ok(pattern, "the scope job must exclude documentation with one readable allowlist pattern");
	const documentation = new RegExp(`^(${pattern[1]})`, "u");
	for (const file of ["docs/handoff.md", "charness-artifacts/x.md", "README.md", "CLAUDE.md"]) {
		assert.ok(documentation.test(file), `${file} is documentation and should not force the macOS gate`);
	}
	for (const file of [
		"packages/ceal-worker-cli/src/index.ts",
		"scripts/build-worker-release-assets.mjs",
		"test/contract/repo-gates.test.mjs",
		".github/workflows/check.yml",
		"install-ceal.sh",
		"package.json",
		"gateway-protocol-handoff-lock.json",
		"skills/ceal-guide/SKILL.md",
	]) {
		assert.ok(!documentation.test(file), `${file} can change what a release builds, so it must run the gate`);
	}
	// The hand-written list above is a sample. This is the claim behind it, and it
	// is the one that has to hold as the release inventory grows: nothing the
	// release actually consumes may be classified as prose. `skills/ceal-guide`
	// is the case that makes this worth deriving rather than listing — it is
	// markdown, and it is a signed release asset.
	const releaseInputs = JSON.parse(read("worker-release-inputs.json"));
	const sourcePaths = JSON.stringify(releaseInputs).match(/"source_path":\s*"([^"]+)"/gu) ?? [];
	assert.ok(sourcePaths.length > 0, "no release source paths found; this check would be vacuous");
	for (const entry of sourcePaths) {
		const source = /"source_path":\s*"([^"]+)"/u.exec(entry)[1];
		assert.ok(!documentation.test(source), `${source} is a release input, so a change to it must never be classified as documentation`);
	}
	// Fail-open would be the expensive mistake here; fail-closed is the dangerous
	// one. Every branch that cannot classify must run the lane.
	assert.ok(
		classify.includes("decide_code") && !/echo "code=false"[\s\S]*decide_code/u.test(classify),
		"the classifier must resolve every uncertain case to running the gate",
	);
});

// `ceal update` runs this installer and waits for it, so an unbounded fetch here
// made that command unbounded too — no envelope, no exit, nothing an agent can
// read. The bound belongs to every download rather than to the three that
// existed when it was added, so this asserts the shape — one helper, every
// download through it — as well as the flags. A fourth download calling the
// network directly is exactly how this regresses, and it would pass a test that
// only checked the existing three.
test("every download in the worker installer is bounded", () => {
	const installer = read("install-ceal.sh");
	const lines = installer.split("\n");
	// Bounded by a line that is exactly `}` rather than by the first `}` in the
	// text: the helper body contains `${...}`, and a non-greedy scan stops inside
	// it, truncating the helper and failing this test against the wrong region.
	const opens = lines.findIndex((line) => /^fetch\(\)\s*\{/u.test(line));
	assert.notEqual(opens, -1, "install-ceal.sh must define the fetch helper every download goes through");
	const closes = lines.findIndex((line, index) => index > opens && line.trim() === "}");
	assert.notEqual(closes, -1, "the fetch helper must be closed by a line that is exactly '}'");
	const helper = lines.slice(opens, closes + 1);

	const helperText = helper.join("\n");
	assert.match(helperText, /--connect-timeout/u, "fetch must bound how long an origin may take to answer at all");
	// Stall detection rather than a flat transfer cap: the worker binary is a Node
	// SEA of well over a hundred megabytes, and a --max-time small enough to catch
	// a black hole would hard-fail a slow link that is working fine.
	assert.match(helperText, /--speed-limit/u, "fetch must cut off a transfer that has stopped moving");
	assert.match(helperText, /--speed-time/u, "fetch must say how long a stall is tolerated");
	assert.match(helperText, /--max-time/u, "fetch must keep an absolute backstop above the stall bound");

	// Any downloader outside the helper is an unbounded wait, whichever tool it
	// reaches for. This cannot see `curl` invoked through a variable, so it is a
	// guard against the accident, not against someone routing around it.
	// Kept as (line, number) pairs rather than a filtered list, so the failure can
	// name the real file line rather than an index into a subset of it.
	for (const [index, line] of lines.entries()) {
		if (index >= opens && index <= closes) continue;
		if (/command -v|for tool in|^\s*#/u.test(line)) continue;
		assert.doesNotMatch(
			line,
			/\b(?:curl|wget)\b/u,
			`install-ceal.sh:${index + 1} downloads outside fetch(); route it through the helper so it is bounded`,
		);
	}
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

	// Relocated from release-contract.test.mjs and verify-worker-release-inputs.test.mjs,
	// both of which went with the legacy lane. Nothing else asserted these, and
	// they are release-identity claims that outlive that lane: the worker is a
	// private build input, the client and protocol are the published pair, and
	// every consumer pins the vendored protocol exactly. A range here would let a
	// release ship a package declaring one protocol while the lock binds another.
	const protocol = JSON.parse(read("packages/ceal-protocol/package.json"));
	assert.equal(manifests.worker.private, true, "the worker CLI is a build input, never a published package");
	assert.equal(manifests.client.private, undefined, "the client SDK must stay publishable");
	assert.equal(protocol.private, undefined, "the vendored protocol must stay publishable");
	for (const [name, consumer] of [
		["client", manifests.client],
		["worker", manifests.worker],
	]) {
		assert.equal(
			consumer.dependencies["@corca-ai/ceal-protocol"],
			protocol.version,
			`the ${name} must declare the vendored protocol version exactly`,
		);
	}

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
	// The helper is only load-bearing if the proofs that motivated it use it, and
	// that is an anti-vacuity floor, not an inventory. Naming the suites here made
	// a rename or a suite move look like a missing platform proof, and the floor
	// dropped to one when the development-only release-artifact suite was deleted.
	const declaring = suites.filter((suite) => /platformProofTest\(/u.test(read(path.join("test", suite))));
	assert.ok(declaring.length >= 1, "no suite declares a platform-gated proof through the shared helper");
});

// Requirement 3 of the proof/ship divergence decision says worker release,
// packing, acceptance-candidate emission, and immutable provenance must reject a
// divergent state independently of which test command ran. Those call sites are
// behaviourally unfalsifiable while the live pin is converged — every suite would
// stay green if someone deleted them — so they are pinned by source shape. This
// is weaker than a behavioural test and is here because it is the only thing that
// fails when the call is removed.
test("every release, packing, and acceptance path still asserts protocol shippability", () => {
	const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8");
	for (const [file, why] of [
		["scripts/worker-release-inputs.mjs", "the chokepoint every release, packing, and native-artifact path funnels through"],
		["scripts/worker-acceptance-packet.mjs", "acceptance-candidate emission"],
	]) {
		assert.match(read(file), /assertShippableProtocolVendorPin\(/u, `${file} must assert shippability: ${why}`);
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
// Two pin assertions already existed, but between them they covered exactly two
// workflows, so `check.yml`, `ceal-release.yml`, and
// `ceal-worker-stable-rollback.yml` were pinned only by habit. This asserts
// across every workflow rather than a hand-kept list.
test("every workflow pins every action to a full commit SHA", () => {
	const directory = path.join(ROOT, ".github/workflows");
	const workflows = readdirSync(directory).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
	assert.ok(workflows.length >= 4, `only ${workflows.length} workflows found; the scan is not reaching .github/workflows`);
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

// GitHub's default job timeout is six hours. `check.yml` bounded itself; the
// release lanes did not, and they are the ones where it matters most — a tag
// cannot be reused, so a wedged release job turns a burned tag into something
// discovered hours after the cause stopped being obvious. Asserting across every
// workflow rather than a hand-kept list is what keeps a newly added lane from
// inheriting the default silently. The one exemption this carried was the frozen
// cealctl-release.yml, which is gone with the rest of that lane, so the rule now
// applies to every workflow without a hole in it.

test("every workflow job this lane owns bounds its own runtime", () => {
	const directory = path.join(ROOT, ".github/workflows");
	const workflows = readdirSync(directory).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
	assert.ok(workflows.length >= 4, `only ${workflows.length} workflows found; the scan is not reaching .github/workflows`);
	let bounded = 0;
	for (const name of workflows) {
		const jobs = Object.entries(parse(read(path.join(".github/workflows", name))).jobs ?? {});
		// A file that parses to zero jobs would satisfy the loop trivially, which
		// is how this kind of sweep goes quietly vacuous after a restructure.
		assert.ok(jobs.length > 0, `${name} declares no jobs; confirm that is real rather than a parse miss`);
		for (const [job, definition] of jobs) {
			assert.equal(
				typeof definition["timeout-minutes"],
				"number",
				`${name} job '${job}' has no timeout-minutes, so a wedged run holds a runner for the 6-hour default`,
			);
			bounded += 1;
		}
	}
	assert.ok(bounded >= 6, `only ${bounded} jobs checked across ${workflows.length} workflows`);
});

// `npm run check` skips the release-artifact and installer proofs on a host that
// cannot build them, and CEAL_REQUIRE_PLATFORM_PROOFS is what turns that skip
// into a failure on a host that can. `check.yml` set it and the release lane did
// not, so the lane those proofs exist to describe was the weaker gate of the two
// — and its failures are the ones that burn a tag.
test("the release lane demands the platform proofs its own artifacts depend on", () => {
	const workflow = parse(read(".github/workflows/ceal-release.yml"));
	const gate = Object.values(workflow.jobs)
		.flatMap((job) => job.steps ?? [])
		.find(runsFinalGate);
	assert.ok(gate, "the release workflow must still carry one step that runs the final gate");
	const requirement = String(gate.env?.CEAL_REQUIRE_PLATFORM_PROOFS);
	assert.match(
		requirement,
		/matrix\.platform/u,
		"the release gate must derive the requirement from the build matrix rather than pinning one value for every runner",
	);
	// Pinning "1" everywhere would fail the macOS legs, which are correct to
	// skip; pinning "0" everywhere would restore the hole. Both halves are named.
	assert.match(requirement, /'1'/u, "the release gate must demand the proofs somewhere");
	assert.match(requirement, /'0'/u, "the release gate must still let the runners that cannot build them skip");
});

// A release tag cannot be reused, so the dry-run dispatch exists to exercise
// this workflow without spending one. That is only true while it cannot
// publish, and "cannot publish" is a property of two `if:` conditions that
// nothing else would notice losing — a dispatch that started signing would look
// like a successful run. Both halves are asserted: which jobs are push-only, and
// that no other job reaches a publishing tool.
test("the release lane's dispatch is a dry run that cannot sign, upload, or move stable", () => {
	const workflow = parse(read(".github/workflows/ceal-release.yml"));
	assert.ok(workflow.on.workflow_dispatch !== undefined, "the release lane must keep a dispatch that can be exercised without a tag");
	assert.deepEqual(workflow.on.push.tags, ["ceal-v*.*.*"], "the publishing trigger stays tag-only");

	const pushOnly = Object.entries(workflow.jobs).filter(([, job]) => String(job.if ?? "").includes("github.event_name == 'push'"));
	const dispatchable = Object.entries(workflow.jobs).filter(([name]) => !pushOnly.some(([guarded]) => guarded === name));
	assert.ok(pushOnly.length >= 2, "the jobs that write to the release origin must be gated on the push event");

	// Every tool that mutates the origin or mints a signature must live behind
	// that gate. Checking the tools rather than the job names is what keeps this
	// true after a restructure that moves a step to a different job.
	const publishing = /cosign sign-blob|wrangler r2 object put|gh release/u;
	for (const [name, job] of dispatchable) {
		const steps = (job.steps ?? []).map((step) => `${step.run ?? ""}\n${step.uses ?? ""}`).join("\n");
		assert.doesNotMatch(steps, publishing, `job '${name}' runs on a dispatch, so it must not sign, upload, or move the stable pointer`);
	}
	const guarded = pushOnly
		.flatMap(([, job]) => job.steps ?? [])
		.map((step) => step.run ?? "")
		.join("\n");
	assert.match(guarded, publishing, "the push-only jobs must still be the ones that publish");
});

// The release legs share one commit, so running the full gate on all four
// re-proved the same source three extra times — and two of those runs were
// macOS minutes, which bill at ten times Linux. Skipping them is safe only
// while the remaining set keeps two properties, and a later edit could drop
// either one without any run turning red, because a skipped step reports
// success. Both are asserted here rather than left to the comment.
test("the release lane still validates its source on the platforms that can prove it", () => {
	const workflow = parse(read(".github/workflows/ceal-release.yml"));
	const entries = Object.values(workflow.jobs).flatMap((job) => job.strategy?.matrix?.include ?? []);
	const validating = entries.filter((entry) => String(entry.validate_source) === "1");
	assert.ok(validating.length > 0, "at least one release leg must run the full gate; a tag is otherwise built from unproven source");

	// The platform-gated proofs only run where CEAL_REQUIRE_PLATFORM_PROOFS is
	// '1'. If that leg ever stops validating source, the release-artifact and
	// installer suites stop running anywhere in the release lane at all.
	assert.ok(
		validating.some((entry) => entry.platform === "linux-amd64"),
		"linux-amd64 is the only leg that can run the platform-gated proofs, so it must keep running the gate",
	);
	// `ceal-v0.66.0` burned on a break that only appears on macOS. One macOS leg
	// must still reach the gate before anything is signed.
	assert.ok(
		validating.some((entry) => String(entry.runner ?? entry.os).includes("macos")),
		"one macOS leg must still validate source, because a macOS-only break has burned a tag before",
	);

	// Every leg must answer the question, so a newly added platform cannot
	// inherit "skip" by leaving the field out.
	for (const entry of entries) {
		assert.match(
			String(entry.validate_source),
			/^[01]$/u,
			`release leg '${entry.platform}' must declare validate_source explicitly rather than defaulting to a skip`,
		);
	}

	// The skip is only sound because composition compiles and smoke-tests the
	// binary by itself. If that stopped being true, a skipped leg would ship a
	// binary nothing had built from checked source.
	const compile = read("scripts/build-worker-release-package.mjs");
	assert.match(compile, /tsconfig\.build\.json/u, "composition must still run its own compiler for the legs that skip the gate");
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

// The two regex matches above would pass just as happily against a hook that ran
// the gate and then swallowed its exit code, and the hook now does bookkeeping
// after the gate returns. Run it instead of reading it: an early version guarded
// the timing write but not its rotation, so an unwritable log directory turned a
// green gate into a blocked push one line after printing "passed".
test("the pre-push hook propagates the gate's exit code and never blocks on its own bookkeeping", (context) => {
	const scratch = mkdtempSync(path.join(tmpdir(), "ceal-hook-exit-"));
	context.after(() => rmSync(scratch, { recursive: true, force: true }));
	// The gate commands are the one thing that must not really run here, so the
	// harness puts a stand-in `npm` ahead of the real one on PATH.
	const bin = path.join(scratch, "bin");
	mkdirSync(bin, { recursive: true });
	const stub = path.join(bin, "npm");
	const timingLog = path.join(scratch, "timing", "command-timing.jsonl");
	const runHook = (refLine, exitCode) => {
		writeFileSync(stub, `#!/bin/sh\nexit ${exitCode}\n`, { mode: 0o755 });
		// `cwd: ROOT`, because git runs a pre-push hook from the top of the working
		// tree and the hook's relative paths depend on it — running it from a scratch
		// directory tested a situation that cannot happen. Isolation comes from the
		// environment instead: a stub `npm` ahead on PATH, the ratchet's own skip
		// switch (the scratch tree is not a repo it could scan), and a timing log
		// redirected out of the maintainer's own.
		return spawnSync("sh", [path.join(ROOT, ".githooks/pre-push"), "origin", "git@example.invalid:x/y.git"], {
			cwd: ROOT,
			input: refLine,
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${bin}:${process.env.PATH}`,
				CEAL_SKIP_DUP_RATCHET: "1",
				CEAL_TIMING_LOG: timingLog,
			},
		});
	};

	assert.equal(runHook("refs/heads/topic a refs/heads/topic b\n", 0).status, 0, "a passing gate must let the push through");
	// Not 1: a flattened code hides which gate failed and how.
	assert.equal(runHook("refs/heads/topic a refs/heads/topic b\n", 42).status, 42, "the gate's own exit code must reach git");
	assert.equal(runHook("refs/tags/ceal-v9.9.9 a refs/tags/ceal-v9.9.9 b\n", 7).status, 7, "a tag push must fail closed too");

	// The bookkeeping half. Every write path is best-effort, so a log directory
	// the hook cannot write must cost a warning, never the push. Rotation is the
	// path that gets forgotten, so the log starts over the keep threshold.
	mkdirSync(path.dirname(timingLog), { recursive: true });
	writeFileSync(timingLog, `${"x\n".repeat(400)}`);
	chmodSync(path.dirname(timingLog), 0o500);
	const blocked = runHook("refs/heads/topic a refs/heads/topic b\n", 0).status;
	// Restored inline, not in an `after` hook: node:test runs those in registration
	// order, so the scratch cleanup above would hit EACCES before the restore ran.
	chmodSync(path.dirname(timingLog), 0o700);
	assert.equal(blocked, 0, "an unwritable timing log must not block a green gate");
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

// A glob once put frozen `cealctl` and legacy dual-release proofs back into the
// worker pre-push/CI gate. Both suites stay explicit inventories so that a file
// added under test/ has to be placed deliberately rather than swept in.
test("every test file under test/ belongs to one explicit worker suite", () => {
	const scripts = manifest.scripts;
	// Which files each suite runs is the claim; the argument order and spacing of
	// the `node --test` line are not. Exact equality made a reporter flag or a
	// reordering fail as if a suite had lost coverage.
	for (const [suite, declared] of [
		["test:contract", WORKER_CONTRACT_TESTS],
		["test:release", WORKER_RELEASE_TESTS],
	]) {
		// The file set is the claim, but the runner still has to be `node --test`:
		// swapping it, or appending a name filter, would run almost nothing while
		// every file stayed listed.
		assert.match(scripts[suite], /^node --test /u, `${suite} must run through the node test runner`);
		assert.doesNotMatch(scripts[suite], /--test-name-pattern|--test-skip-pattern/u);
		assert.deepEqual(testFilesIn(scripts[suite]), [...declared].sort());
	}
	assert.match(scripts["check:unit"], /npm run test:contract/u);
	// `npm test` no longer names the two tiers itself: it goes through
	// `coverage:scripts`, whose runner wraps them in c8 so scripts/ is measured
	// once rather than run plainly and then again under coverage. The claim is
	// unchanged — every suite still runs in the final gate — so it is resolved
	// through the chain instead of pattern-matched at the entry point, and each
	// hop is asserted, because a broken hop would silently stop running a tier.
	//
	// `test:unit` is a hop here for the first time. Nothing used to assert that
	// anything *called* it — only what it was — so deleting it from `test` took
	// both packages' coverage floors out of `npm run check`, and out of
	// `check.yml`, with every gate green.
	for (const [hop, reaches] of [
		["test", /npm run test:unit\b/u],
		["test", /npm run coverage:scripts/u],
		["coverage:scripts", /^node scripts\/coverage-scripts[.]mjs$/u],
		["test:tiers", /npm run test:contract/u],
		["test:tiers", /npm run test:release/u],
	]) {
		assert.match(scripts[hop], reaches, `${hop} must still reach ${reaches.source}, or the final gate stops running a suite`);
	}
	// Joined with `&&`, so a red suite stops the chain. A `;` or `||` join would
	// run every one of them and report the last one's status, which is the same
	// failure as not running them at all.
	for (const chain of ["test", "test:tiers"]) {
		assert.doesNotMatch(scripts[chain], /;|\|\|/u, `${chain} must fail on the first red step`);
	}
	assert.match(runnerSource(), /const TIERS = "test:tiers"/u);
	// Both of the runner's paths reach the tiers through that one constant. A
	// quoted tier name would mean one of them runs something else — or runs it a
	// second time, unmeasured, beside the c8 pass. Quoted, because the prose above
	// it names both tiers on purpose.
	assert.doesNotMatch(runnerSource(), /"test:(?:contract|release)"/u, "the runner must reach both tiers only through test:tiers");
	// The legacy compatibility suite is gone with the lane it audited, so a test
	// file now belongs to a worker suite or to nothing.
	assert.equal(scripts["test:legacy-compatibility"], undefined, "the legacy compatibility suite must not come back");

	const declared = [...WORKER_CONTRACT_TESTS, ...WORKER_RELEASE_TESTS].sort();
	const actual = [
		...readdirSync(path.join(ROOT, "test", "contract"))
			.filter((name) => name.endsWith(".test.mjs"))
			.map((name) => `test/contract/${name}`),
		...readdirSync(path.join(ROOT, "test"))
			.filter((name) => name.endsWith(".test.mjs"))
			.map((name) => `test/${name}`),
	].sort();
	assert.deepEqual(declared, actual);

	// Any other directory under test/ would be declared by neither inventory.
	const directories = readdirSync(path.join(ROOT, "test"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
	assert.deepEqual(directories, ["contract"], "a new test/ subdirectory needs an explicit suite inventory entry");
});

// A "the contract suite stays small enough to run on every push" test lived here
// and asserted `WORKER_CONTRACT_TESTS.length <= 20` — a constant declared at the
// top of this same file. It could only fail when a human edited that array, and
// by its own comment it could not measure the runtime it was about. The rule it
// meant to carry belongs to CLAUDE.md, which already says to time a gate with
// `time npm run check` on the host in hand rather than trust a recorded figure.
