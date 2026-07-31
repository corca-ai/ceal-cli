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

const WORKER_CONTRACT_TESTS = [
	"test/contract/gateway-leased-consumer-call-handoff.test.mjs",
	"test/contract/prewarm-offline-consumer-cache.test.mjs",
	"test/contract/probe-surface.test.mjs",
	"test/contract/protocol-vendor-pin.test.mjs",
	"test/contract/repo-build.test.mjs",
	"test/contract/repo-gates.test.mjs",
	"test/contract/safe-output-path.test.mjs",
	"test/contract/script-lib.test.mjs",
	"test/contract/verify-worker-release-inputs.test.mjs",
	"test/contract/worker-acceptance-packet.test.mjs",
	"test/contract/worker-gateway-handoff-archive.test.mjs",
	"test/contract/worker-gateway-protocol-handoff-archive.test.mjs",
	"test/contract/worker-guide-contract.test.mjs",
	"test/contract/worker-release-assets.test.mjs",
	"test/contract/worker-release-inputs.test.mjs",
];
const WORKER_RELEASE_TESTS = [
	"test/build-worker-release-artifact.test.mjs",
	"test/gateway-protocol-consumer.test.mjs",
	"test/worker-native-artifact.test.mjs",
	"test/worker-release-installer.test.mjs",
	"test/worker-release-package.test.mjs",
];
const LEGACY_COMPATIBILITY_TESTS = [
	"test/contract/build-platform-binaries.test.mjs",
	"test/contract/guide-contract.test.mjs",
	"test/contract/release-contract.test.mjs",
	"test/public-distribution.test.mjs",
];

function nodeTestCommand(testFiles) {
	return `node --test ${testFiles.join(" ")}`;
}

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
	assert.match(manifest.scripts.build, /npm run build:worker/u);
	assert.match(manifest.scripts["build:worker"], /^node scripts\/generate-leased-consumer-handoff-runtime[.]mjs/u);
	assert.match(manifest.scripts["build:worker"], /packages\/ceal-protocol run build/u);
	for (const ownerPackage of ["packages/ceal-client", "packages/ceal-worker-cli"]) {
		assert.match(manifest.scripts["build:worker"], new RegExp(`${ownerPackage} run build`, "u"));
		assert.match(manifest.scripts["test:unit"], new RegExp(`${ownerPackage} test`, "u"));
	}
	for (const frozenPackage of ["packages/ceal-protocol", "packages/ceal-operator-cli"]) {
		assert.doesNotMatch(manifest.scripts["test:unit"], new RegExp(`${frozenPackage} test`, "u"));
	}
	assert.doesNotMatch(manifest.scripts["build:worker"], /packages\/ceal-operator-cli/u);
	const workerPackage = JSON.parse(read("packages/ceal-worker-cli/package.json"));
	assert.equal(workerPackage.scripts.build, "tsc -p tsconfig.build.json");
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
	// The thing that must hold is that the frozen package is excluded, not which
	// spelling biome prefers this year. Pinning the literal `!<path>/**` made a
	// correct migration to `!<path>` — biome's own fixable preference — look like
	// a removed exclusion.
	for (const frozen of ["packages/ceal-protocol", "packages/ceal-operator-cli"]) {
		assert.ok(
			biome.files.includes.some((pattern) => pattern === `!${frozen}` || pattern === `!${frozen}/**`),
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

// macOS minutes bill at ten times Linux minutes, so the macOS leg is most of
// this lane's cost and skipping it for prose is worth real money. The danger is
// not the skip, it is the filter widening later: one `packages/` or `scripts/`
// entry added to the allowlist would silently return this repository to the
// state that burned `ceal-v0.66.0`, and nothing else would notice, because a
// skipped job reports success. So the allowlist is asserted, not just its
// existence.
test("the check lane may skip the macOS gate only for documentation-only changes", () => {
	const workflow = parse(read(".github/workflows/check.yml"));
	const conditional = Object.entries(workflow.jobs).filter(([, job]) => typeof job.if === "string");
	assert.equal(conditional.length, 1, "exactly one check job may be conditional; every other leg must run unconditionally");
	const [name, job] = conditional[0];
	const runners = (job.strategy?.matrix?.include ?? []).map((entry) => String(entry.runner));
	assert.ok(
		runners.length > 0 && runners.every((runner) => runner.includes("macos")),
		`only the macOS leg may be conditional, but '${name}' runs on ${runners.join(", ") || "no declared runner"}`,
	);

	// The condition must be the classifier's answer rather than anything a
	// commit message or an actor could set.
	assert.match(job.if, /needs\.scope\.outputs\.code == 'true'/u, `'${name}' must run whenever the scope job reports code`);
	assert.ok([job.needs].flat().includes("scope"), `'${name}' must depend on the scope job it reads`);

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
		"gateway-handoff-lock.json",
		"skills/ceal-guide/SKILL.md",
	]) {
		assert.ok(!documentation.test(file), `${file} can change what a release builds, so it must run the macOS gate`);
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
		["scripts/build-worker-release-artifact.mjs", "writes a release manifest and provenance without traversing the chokepoint"],
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

// GitHub's default job timeout is six hours. `check.yml` bounded itself; the
// release lanes did not, and they are the ones where it matters most — a tag
// cannot be reused, so a wedged release job turns a burned tag into something
// discovered hours after the cause stopped being obvious. Asserting across every
// workflow rather than a hand-kept list is what keeps a newly added lane from
// inheriting the default silently. Frozen workflows are read here, never edited:
// if one of them lacks a bound, that is a request to its owner, so it is named
// as an exemption rather than left to widen the rule for everyone.
const UNBOUNDED_WORKFLOW_EXEMPTIONS = new Set(["cealctl-release.yml"]);

test("every workflow job this lane owns bounds its own runtime", () => {
	const directory = path.join(ROOT, ".github/workflows");
	const workflows = readdirSync(directory).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
	assert.ok(workflows.length >= 5, `only ${workflows.length} workflows found; the scan is not reaching .github/workflows`);
	let bounded = 0;
	for (const name of workflows) {
		if (UNBOUNDED_WORKFLOW_EXEMPTIONS.has(name)) continue;
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
// worker pre-push/CI gate. Keep the three suites as explicit inventories: every
// test is run somewhere, but Gateway-owned compatibility evidence cannot become
// an accidental worker-source requirement.
test("every test file under test/ belongs to one explicit worker or legacy suite", () => {
	const scripts = manifest.scripts;
	assert.equal(scripts["test:contract"], nodeTestCommand(WORKER_CONTRACT_TESTS));
	assert.equal(scripts["test:release"], nodeTestCommand(WORKER_RELEASE_TESTS));
	assert.equal(scripts["test:legacy-compatibility"], nodeTestCommand(LEGACY_COMPATIBILITY_TESTS));
	assert.match(scripts["check:unit"], /npm run test:contract/u);
	assert.match(scripts.test, /npm run test:contract/u);
	assert.match(scripts.test, /npm run test:release/u);
	assert.doesNotMatch(scripts["check:unit"], /legacy-compatibility/u);
	assert.doesNotMatch(scripts.test, /legacy-compatibility/u);

	const declared = [...WORKER_CONTRACT_TESTS, ...WORKER_RELEASE_TESTS, ...LEGACY_COMPATIBILITY_TESTS].sort();
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

// The contract suite only helps if it stays fast enough to sit in the iteration
// gate. This is a ceiling on the count, not the runtime, because a runtime
// assertion would be flaky on a loaded machine — but a file that belongs in the
// release tier is usually obvious by name.
test("the contract suite stays small enough to run on every push", () => {
	assert.ok(
		WORKER_CONTRACT_TESTS.length <= 20,
		`test:contract has ${WORKER_CONTRACT_TESTS.length} files; re-check that each is still cheap`,
	);
});
