import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { PASS_FAIL_ENV_KEYS, RUNNER_IDENTITY_ENV } from "../../scripts/lib/gate-attestation.ts";
import {
	collectViolations,
	deriveWorkflows,
	extractGateCommands,
	fullGateInvocationSites,
	fullGateViolations,
	GATE_CONTRACT_SCHEMA,
	main as gateContractMain,
	hookRunnerViolations,
	readContract,
	writeDerivedContract,
} from "../gate-contract-lib.ts";
import { requiredCapture, required as requiredValue } from "../required.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

// The worker tier inventories used to be restated here as two hand-written
// arrays and asserted deep-equal to the npm scripts that actually run them. That
// assertion proved only that two copies agreed: it added no fact about the tree,
// and it made every new suite a two-file edit whose second half existed solely to
// keep the first half green. The npm script is the one home now, and this file
// derives from it — which is also what lets the ownership gate below say
// something the copy never could, namely that every declared path exists and
// every suite on disk has exactly one owner.
//
// What is honestly LOST, stated because the first draft of this comment claimed
// the opposite and a reviewer caught it: the arrays required an explicit edit to
// put a suite into the gate, and nothing requires one now. A file dropped into
// `test/contract/` joins the gate silently, so the incident this shape comes
// from — a glob pulling frozen `cealctl` and legacy dual-release proofs back into
// the worker gate — would recur silently if that material were re-placed under a
// lane directory.
//
// What replaces it is narrower, and worth naming precisely rather than glossing:
// the set of PLACES is closed and asserted (three lane directories under `test/`,
// and nothing else), and every suite outside one must be named. That is the
// guard. It is not the old property.
function workerTierFiles(scripts: Record<string, string>, tier: string) {
	return testFilesIn(tier === "test:contract" ? scripts["test:contract:built"] : scripts[tier]);
}

/**
 * One suite token as the shell would expand it. A stale glob is the release
 * lane's own version of calling a ghost — `sh` passes an unmatched pattern
 * through verbatim and the runner dies on a filename nobody wrote — so an
 * expansion that finds nothing is a failure here rather than a surprise there.
 */
function expandSuiteToken(token: string) {
	if (!token.includes("*")) return [token];
	const directory = path.dirname(token);
	const pattern = new RegExp(`^${path.basename(token).replaceAll(".", "\\.").replaceAll("*", "[^/]*")}$`, "u");
	const matched = readdirSync(path.join(ROOT, directory))
		.filter((name) => pattern.test(name))
		.map((name) => `${directory}/${name}`)
		.sort();
	assert.ok(matched.length > 0, `${token} matches no file; a lane is globbing a directory that no longer holds suites`);
	return matched;
}

function testFilesIn(script: string | undefined) {
	return (script ?? "")
		.split(/\s+/u)
		.filter((token: string) => token.endsWith(".test.mjs") || token.endsWith(".test.ts"))
		.flatMap(expandSuiteToken)
		.sort();
}

const CONTRACT_LANE_DELIMITER = " && node --test ";
const PROJECTION_TEST = "test/source/leased-consumer-control-conformance-projection.test.ts";

function assertSourceLaneTestOwnership(script: string, testFile: string) {
	const segments = script.split(CONTRACT_LANE_DELIMITER);
	assert.equal(segments.length, 2, "test:contract must have exactly one source/artifact lane delimiter");
	const occurrences = testFilesIn(script).filter((file: string) => file === testFile);
	assert.equal(occurrences.length, 1, `${testFile} must be registered exactly once`);
	assert.ok(testFilesIn(segments[0]).includes(testFile), `${testFile} must execute through the source-test runner`);
	assert.ok(!testFilesIn(segments[1]).includes(testFile), `${testFile} must not execute through plain node`);
}

function assertContractGateScriptShape(scripts: Record<string, string>) {
	assert.equal(
		scripts["test:contract"],
		"npm run build && npm run test:contract:built",
		"public contract feedback must build once before the built lane",
	);
	const built = requiredValue(scripts["test:contract:built"], "built_contract_script");
	assert.equal((built.match(/\bnpm run build\b/gu) ?? []).length, 0, "the internal contract lane must not build");
	assertSourceLaneTestOwnership(built, PROJECTION_TEST);
	const commonPhases = [
		"npm run lint",
		"npm run lint:secrets",
		"npm run lint:import-hard-failures",
		"npm run lint:no-legacy-mjs",
		"npm run lint:source-nul-bytes",
		"npm run lint:markdown",
		"npm run lint:types",
		"npm run lint:unused",
		"npm run lint:reachability",
		"npm run lint:store-lock",
		"npm run lint:duplicate-literal",
	];
	const gateDefinitions: Array<[name: "check" | "check:unit", tail: string[]]> = [
		["check", ["npm test"]],
		["check:unit", ["npm run test:unit", "npm run test:contract:built"]],
	];
	for (const [name, tail] of gateDefinitions) {
		const commands = requiredValue(scripts[name], `${name}_script`).split(" && ");
		assert.equal(commands.filter((command: string) => command === "npm run build").length, 1, `${name} must build exactly once`);
		assert.ok(commands.indexOf("npm run build") < commands.indexOf("npm run lint:types"), `${name} must build before typecheck`);
		const withoutBuild = commands.filter((command: string) => command !== "npm run build");
		assert.deepEqual(withoutBuild, [...commonPhases, ...tail], `${name} must preserve every non-build phase once`);
	}
}

function assertTestInventoryCoverage(declared: readonly string[], actual: readonly string[]) {
	assert.deepEqual([...declared].sort(), [...actual].sort());
}

/**
 * Every suite file in the worktree, asked of git rather than derived from a list
 * of directories somebody remembered. Tracked and untracked-but-not-ignored, so
 * a suite added and not yet committed is still owned by somebody.
 */
function trackedSuiteFiles(): string[] {
	return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "*.test.ts", "*.test.mjs"], {
		cwd: ROOT,
		encoding: "utf8",
	})
		.split("\0")
		.filter(Boolean)
		.filter((file) => existsSync(path.join(ROOT, file)))
		.sort();
}

function searchableWorktreeFiles(repoRoot: string): string[] {
	return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
		cwd: repoRoot,
		encoding: "buffer",
	})
		.toString("utf8")
		.split("\0")
		.filter(Boolean)
		.filter((file) => /\.(ts|mjs|cjs|js|json|md|ya?ml|sh)$/u.test(file))
		.filter((file) => existsSync(path.join(repoRoot, file)));
}

function read(relative: string): string {
	return readFileSync(path.join(ROOT, relative), "utf8");
}

function readJson<T>(relative: string): T {
	const value: unknown = JSON.parse(read(relative));
	return value as T;
}

/**
 * Repo-relative files under `directory`, recursively, that `matches` accepts.
 * An absent directory yields nothing rather than throwing, because the
 * workspaces this walks do not all carry every subdirectory.
 *
 * One walk, two callers: the @testOnly scan wanted sources and the suite scan
 * wanted suites, and they had been written as two closures that differed only in
 * the filter and the accumulator — which is exactly the difference this
 * parameter is.
 */
function filesUnder(directory: string, matches: (name: string) => boolean): string[] {
	if (!existsSync(path.join(ROOT, directory))) return [];
	const found: string[] = [];
	for (const entry of readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
		const relative = path.join(directory, entry.name);
		if (entry.isDirectory()) found.push(...filesUnder(relative, matches));
		else if (matches(entry.name)) found.push(relative);
	}
	return found;
}

/**
 * Workspaces whose own suite the root gate reaches AND whose suite is a glob, so
 * a file added there is swept in rather than needing a worker-tier entry.
 *
 * Both halves are read, not assumed. `ceal-protocol` is exactly why: it has a
 * `test` script, that script does glob, and nothing in the root chain calls it —
 * so it is not an owner, and its files have to be named explicitly. Reading only
 * the root call, or only the package script, would have called it owned.
 */
function globOwnedWorkspaces(scripts: Record<string, string>): Set<string> {
	const owners = new Set<string>();
	for (const match of requiredValue(scripts.coverage, "coverage_script").matchAll(/--prefix packages\/([\w-]+) run ([\w:-]+)/gu)) {
		const workspace = requiredCapture(match, 1, "coverage_workspace");
		const script = requiredCapture(match, 2, "coverage_script_name");
		const packaged = JSON.parse(read(path.join("packages", workspace, "package.json")));
		if (/(?:^|\s)test\/\*\.test\.ts(?:\s|$)/u.test(packaged.scripts?.[script] ?? "")) owners.add(workspace);
	}
	return owners;
}

// Two tests read the coverage runner: the one that checks how scripts/ is
// measured, and the one that resolves `npm test` down to the two tiers. Naming
// the path once means a rename cannot leave one of them reading a stale file.
function runnerSource() {
	return read("scripts/coverage-scripts.ts");
}

function workflowPaths() {
	return readdirSync(path.join(ROOT, ".github/workflows"))
		.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
		.map((name) => path.join(".github/workflows", name));
}

function checkedWorkflowPaths() {
	const paths = workflowPaths();
	assert.ok(paths.length >= 3, `only ${paths.length} workflows found; the scan is not reaching .github/workflows`);
	return paths;
}

// Both gates below have to find "the step that runs the final gate", and both used
// to do it with exact equality after `trim()`. Wrapping the step in a multi-line
// `run:` — to export one env var, say — then made one of them vacuous and the
// other fail claiming the lane does not run the gate at all. One line-wise
// predicate, so the two can no longer disagree about what they are looking at.
type WorkflowStep = {
	readonly name?: string;
	readonly id?: string;
	readonly run?: string;
	readonly uses?: string;
	readonly if?: string;
	readonly with?: Record<string, unknown>;
	readonly env?: Record<string, string>;
};
type WorkflowMatrixEntry = {
	readonly runner?: unknown;
	readonly os?: unknown;
	readonly require_platform_proofs?: unknown;
	readonly validate_source?: unknown;
	readonly platform?: unknown;
	readonly [key: string]: unknown;
};
type WorkflowTrigger = {
	readonly branches?: string[];
	readonly tags?: string[];
	readonly [key: string]: unknown;
};
type WorkflowTriggers = {
	readonly push?: WorkflowTrigger;
	readonly pull_request?: WorkflowTrigger;
	readonly workflow_dispatch?: unknown;
	readonly [key: string]: unknown;
};
type WorkflowJob = {
	readonly steps?: WorkflowStep[];
	readonly permissions?: Record<string, unknown>;
	readonly if?: string;
	readonly needs?: string | string[];
	readonly environment?: string;
	readonly env?: Record<string, string>;
	readonly strategy?: { readonly matrix?: { readonly include?: WorkflowMatrixEntry[] } };
	readonly "runs-on"?: unknown;
	readonly [key: string]: unknown;
};
type WorkflowDocument = {
	readonly jobs: Record<string, WorkflowJob>;
	readonly on: WorkflowTriggers;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWorkflow(source: string): WorkflowDocument {
	const value: unknown = parseYaml(source);
	assert.ok(isRecord(value) && isRecord(value.jobs) && isRecord(value.on), "workflow YAML must contain jobs and on mappings");
	return value as WorkflowDocument;
}

function requiredWith(step: WorkflowStep): Record<string, unknown> {
	const withValue = step.with;
	if (withValue === undefined) throw new Error(`${step.name ?? "workflow step"}_with_missing`);
	return withValue;
}

function requiredSteps(job: WorkflowJob): WorkflowStep[] {
	const steps = job.steps;
	if (steps === undefined) throw new Error("workflow_job_steps_missing");
	return steps;
}

function runsFinalGate(step: WorkflowStep) {
	return (step.run ?? "").split("\n").some((line) => line.trim() === "npm run check");
}

function namedStep(job: WorkflowJob, name: string): WorkflowStep {
	const step = (job.steps ?? []).find((candidate) => candidate.name === name);
	if (step === undefined) throw new Error(`missing workflow step: ${name}`);
	return step;
}

function assertRunContains(step: WorkflowStep, fragments: readonly string[]) {
	const source = step.run ?? "";
	for (const fragment of fragments) assert.ok(source.includes(fragment), `${step.name} must contain: ${fragment}`);
}

function assertNoCheckedOutSource(job: WorkflowJob, label: string) {
	assert.equal(
		(job.steps ?? []).some((step) => (step.uses ?? "").startsWith("actions/checkout")),
		false,
		`${label} must not check out repository source`,
	);
	assert.equal(
		(job.steps ?? []).some((step) => /\bnode\s+(?:\.\/)?scripts\/|\bnpm\s+run\b/u.test(step.run ?? "")),
		false,
		`${label} must not execute repository source`,
	);
}

function assertPrivilegedReleaseBoundaries({ worker, rollback }: { worker: WorkflowDocument; rollback: WorkflowDocument }) {
	const publish = requiredValue(worker.jobs["sign-and-publish"], "worker_publish_job");
	const publishEnv = requiredValue(publish.env, "worker_publish_environment");
	assert.equal(publish.environment, "ceal-cli-release");
	assert.equal(publishEnv.CLOUDFLARE_ACCOUNT_ID, "${{ vars.CEAL_ENV_CLOUDFLARE_ACCOUNT_ID }}");
	assert.equal(publishEnv.CLOUDFLARE_API_TOKEN, "${{ secrets.CEAL_ENV_CLOUDFLARE_API_TOKEN }}");
	assertNoCheckedOutSource(publish, "the OIDC-capable worker publish job");
	assertRunContains(namedStep(publish, "Verify same-run worker release binding"), [
		'[ "$GITHUB_REF_TYPE" = "tag" ]',
		'[ "$GITHUB_REF" = "refs/tags/$TAG" ]',
		'[ -n "$GITHUB_SHA" ]',
		'[ -n "$ASSEMBLED_SHA256SUMS_SHA256" ]',
	]);
	assertRunContains(namedStep(publish, "Verify the assembled worker inventory"), [
		'[ "$ASSEMBLED_SHA256SUMS_SHA256" = "$observed" ]',
		"sha256sum -c SHA256SUMS",
	]);
	assert.equal(
		requiredWith(namedStep(publish, "Download exact assembled release handoff")).name,
		"ceal-worker-release-${{ github.sha }}",
		"worker publish must download only this run's assembled handoff",
	);

	const verify = requiredValue(rollback.jobs.verify, "rollback_verify_job");
	assert.equal(verify.environment, undefined, "checked-out rollback verifier must stay unprivileged");
	const activate = requiredValue(rollback.jobs.activate, "rollback_activate_job");
	const activateEnv = requiredValue(activate.env, "rollback_activate_environment");
	assert.equal(activate.environment, "ceal-cli-release");
	assert.equal(activate.needs, "verify");
	assert.equal(activateEnv.CLOUDFLARE_ACCOUNT_ID, "${{ vars.CEAL_ENV_CLOUDFLARE_ACCOUNT_ID }}");
	assert.equal(activateEnv.CLOUDFLARE_API_TOKEN, "${{ secrets.CEAL_ENV_CLOUDFLARE_API_TOKEN }}");
	assertNoCheckedOutSource(activate, "the release-origin rollback job");
	assertRunContains(namedStep(activate, "Verify same-run rollback binding"), [
		'[ -n "$GITHUB_SHA" ]',
		'[ -n "$VERIFIED_SHA256SUMS_SHA256" ]',
	]);
	assert.equal(
		requiredWith(namedStep(activate, "Download the verified rollback handoff")).name,
		"ceal-worker-rollback-${{ github.sha }}",
		"rollback activation must download only this run's verified handoff",
	);
	assertRunContains(namedStep(activate, "Verify the downloaded rollback handoff"), [
		"sha256sum stable/SHA256SUMS",
		"awk '$2 == \"install-ceal.sh\" { print $1 }' stable/SHA256SUMS",
		"sha256sum stable/install-ceal.sh",
		'[ "$pointer_tag" = "$TAG" ]',
		'[ "$VERIFIED_SHA256SUMS_SHA256" = "$observed_digest" ]',
		'[ "$expected_installer" = "$observed_installer" ]',
	]);
	assert.ok(
		(verify.steps ?? []).some(
			(step) => step.name === "Re-verify an immutable worker release" && (step.run ?? "").includes('cp "$readback_dir/SHA256SUMS"'),
		),
		"rollback handoff must carry the verified inventory that binds its bootstrap",
	);
}

test("workflows that exercise release proofs retain historical tags", () => {
	let exercisingJobs = 0;
	for (const workflowPath of workflowPaths()) {
		const workflow = parseWorkflow(read(workflowPath));
		for (const [jobName, job] of Object.entries(workflow.jobs)) {
			const steps = job.steps ?? [];
			const exercisesReleaseProof = steps.some(
				(step) =>
					runsFinalGate(step) ||
					/npm run test:release/u.test(step.run ?? "") ||
					/(?:^|\n)\s*node scripts\/build-worker-release-assets[.]mjs (?:compose|merge)\b/u.test(step.run ?? ""),
			);
			if (!exercisesReleaseProof) continue;
			exercisingJobs += 1;
			const checkout = steps.find((step) => (step.uses ?? "").startsWith("actions/checkout"));
			assert.ok(checkout, `${workflowPath} ${jobName} must check out the source it proves`);
			assert.equal(checkout.with?.["fetch-depth"], 0, `${workflowPath} ${jobName} must resolve historical installer tags`);
		}
	}
	assert.ok(exercisingJobs > 0, "no workflow job exercised a release proof; the history gate became vacuous");
});

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
	assert.match(
		manifest.scripts["build:worker"],
		/^node scripts\/generate-leased-consumer-attachment-stream-runtime[.]ts && node scripts\/generate-leased-consumer-handoff-runtime[.]ts/u,
	);
	assert.match(
		manifest.scripts["build:worker"],
		/node test\/repo-build[.]ts packages\/ceal-protocol packages\/ceal-client packages\/ceal-worker-cli$/u,
	);
	for (const ownerPackage of ["packages/ceal-client", "packages/ceal-worker-cli"]) {
		assert.match(manifest.scripts.coverage, new RegExp(`${ownerPackage} run coverage`, "u"));
	}
	assert.equal((manifest.scripts.coverage.match(/--ignore-scripts/gu) ?? []).length, 2, "root coverage must reuse build:worker output");
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
	const workerCoverage = JSON.parse(read("packages/ceal-worker-cli/.c8rc.json"));
	assert.equal(workerCoverage.src, "src", "Worker coverage must inventory production source, not tests or emitted artifacts");
	assert.deepEqual(workerCoverage.extension, [".ts"], "Worker coverage must count the editable TypeScript authority");
	assert.ok(workerCoverage.exclude.includes("test/**"), "Worker coverage must not count its test harness as production");
	assert.equal(
		workerCoverage["exclude-after-remap"],
		true,
		"Worker exclusions must apply to TypeScript source paths after source-map remapping",
	);
	const workerPackage = JSON.parse(read("packages/ceal-worker-cli/package.json"));
	assert.match(workerPackage.scripts.build, /^tsc -p tsconfig\.build\.json\b/u);
	// A trailing `|| true` would make every type error a green build, which is the
	// one thing loosening this assertion off exact equality must not permit.
	assert.doesNotMatch(workerPackage.scripts.build, /\|\||;|--noEmit/u);
});

test("Protocol, client, and worker behavior execute editable source while emitted surfaces stay in the artifact lane", () => {
	const protocolPackage = JSON.parse(read("packages/ceal-protocol/package.json"));
	const clientPackage = JSON.parse(read("packages/ceal-client/package.json"));
	const workerPackage = JSON.parse(read("packages/ceal-worker-cli/package.json"));
	assert.equal(protocolPackage.scripts.test, "npm run build && node ../../test/run-source-tests.ts test/*.test.ts");
	assert.equal(protocolPackage.scripts.pretest, undefined);
	assert.match(clientPackage.scripts.test, /--import [.][.]\/[.][.]\/test\/source-loader[.]ts/u);
	assert.match(clientPackage.scripts.coverage, /--import [.][.]\/[.][.]\/test\/source-loader[.]ts/u);
	assert.equal(clientPackage.scripts.pretest, undefined);
	assert.equal(clientPackage.scripts.precoverage, undefined);
	assert.equal(workerPackage.scripts.test, "node ../../test/run-source-tests.ts test/*.test.ts");
	assert.equal(workerPackage.scripts.coverage, "c8 node ../../test/run-source-tests.ts test/*.test.ts");
	assert.equal(workerPackage.scripts.pretest, undefined);
	assert.equal(workerPackage.scripts.precoverage, undefined);
	assertContractGateScriptShape(manifest.scripts);
	for (const file of filesUnder("packages/ceal-client/test", (name) => name.endsWith(".test.ts"))) {
		assert.doesNotMatch(read(file), /["'][.][.]\/dist\//u, `${file} must import editable source, not checkout dist`);
	}
	const artifactBuilder = read("test/artifact-workspace.ts");
	assert.match(artifactBuilder, /mkdtempSync/u);
	assert.doesNotMatch(artifactBuilder, /cpSync\([^\n]*["']dist["']/u, "isolated artifacts must not copy checkout dist as an input");
	assert.match(artifactBuilder, /compile\("ceal-protocol"/u);
	assert.match(artifactBuilder, /compile\("ceal-client"/u);
	assert.match(artifactBuilder, /compile\("ceal-worker-cli"/u);
	const artifactProof = read("test/client-artifact.test.ts");
	for (const publicSurface of ["Protocol", "client", "worker", "executable"]) {
		assert.match(artifactProof, new RegExp(publicSurface, "iu"), `artifact lane must name the ${publicSurface} proof purpose`);
	}
	assert.ok(
		workerTierFiles(manifest.scripts, "test:release").includes("test/client-artifact.test.ts"),
		"the isolated-artifact proof belongs to the release tier, not the contract tier",
	);
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
	// The property, not the numbers. This used to `deepEqual` the four floors
	// against literals copied from the config, which cannot tell a right floor
	// from a wrong one — it has no measurement to compare against — and only
	// detects that someone edited one file and not the other, which `git diff`
	// already does. It also had a failure mode that lied: raising the floors
	// after a real improvement reddened THIS test, which failed `test:contract`,
	// which short-circuited `test:tiers` so `test:release` never ran, and the
	// scripts report then came back far below its floor as if coverage had
	// collapsed. One stale literal, reported as a coverage regression.
	//
	// What is checkable is that each ratio is declared, and that is worth
	// checking, because c8's own defaults are not a uniform safe number: three of
	// the four default to a floor that can never fail and one defaults well above
	// what this tree measures. Read them from the installed tool rather than from
	// a copy here — `rg -n "option\('(branches|functions|lines|statements)'" -A 2
	// node_modules/c8/lib/parse-args.js`. The measurement that sets the floors
	// lives in exactly one place: the comment in `scripts/coverage-scripts.ts`,
	// beside the command that reproduces it.
	for (const ratio of ["statements", "branches", "functions", "lines"]) {
		assert.equal(typeof config[ratio], "number", `.c8rc.scripts.json must declare its own ${ratio} floor, measured rather than inherited`);
	}
	// `all: true` enumerates from `src`, and `include` is what keeps the report to
	// this tree: without it a run that also loaded `packages/*/dist` would fold
	// that coverage into the same ratios.
	assert.equal(config.src, "scripts");
	assert.deepEqual(config.include, ["scripts/**/*.ts"]);
	assert.deepEqual(config.extension, [".ts"]);
	// One exclusion, by name and with a reason, matching the discipline the two
	// packages already follow. The runner spawns c8 and so is never inside the
	// coverage it produces; nothing else may be excluded, because an exclusion here
	// is precisely how an unreached guard would be hidden again.
	assert.deepEqual(config.exclude, ["scripts/coverage-scripts.ts"]);

	// c8 exits 0 when its file set is empty — verified, not assumed: an `include`
	// matching nothing prints all-zero ratios and still passes, because istanbul
	// computes them from 0/0 totals. So the floor alone cannot tell "measured and
	// passed" from "measured nothing", and the runner compares the emitted
	// `coverage-summary.json` against the inventory on disk after every measured
	// run. That check is the one this whole target rests on.
	assert.match(runnerSource(), /function assertReportIsNotEmpty\(\)/u);
	assert.match(runnerSource(), /^\s*assertReportIsNotEmpty\(\);/mu, "the emptiness check must be called, not merely declared");

	// `extension` is the other half of that inventory, and it is why this must not
	// silently widen: a `.js`, `.cjs`, `.mts`, or `.sh` helper dropped into scripts/
	// matches neither the glob nor the runner's inventory, so it would be unmeasured
	// rather than zero and nothing would say so.
	const foreign = readdirSync(path.join(ROOT, "scripts"), { recursive: true })
		.map((name) => `scripts/${name}`.replaceAll(path.sep, "/"))
		.filter((name) => /[.](?:js|cjs|mts|sh)$/u.test(name));
	assert.deepEqual(foreign, [], "scripts/ carries a file the coverage inventory cannot see; measure it or move it");

	// The floor must be enforced where the full proof set runs. `platformProofTest`
	// correctly skips the installed-binary proofs elsewhere, so a floor applied
	// there would fail a run for skipping what it is right to skip — but the
	// converse is the real risk: dropping the release platform out of the runner's
	// list would leave the floor enforced only on hosts that prove less.
	const proofPlatform = read("test/platform-proof.ts").match(/PLATFORM_PROOF_PLATFORM = "([^"]+)"/u);
	const enforced = runnerSource().match(/MEASURED_PLATFORMS = Object\.freeze\(\[([^\]]*)\]\)/u);
	const proofPlatformName = requiredValue(proofPlatform?.[1], "proof_platform");
	const enforcedPlatforms = requiredValue(enforced?.[1], "enforced_platforms");
	assert.ok(
		enforcedPlatforms.includes(`"${proofPlatformName}"`),
		`the coverage floor must be enforced on ${proofPlatformName}, the host that carries every platform proof`,
	);
	// And nowhere the proofs cannot run. Adding `darwin` here is the `ceal-v0.67.0`
	// shape the runner exists to avoid, and it would look like widening coverage.
	assert.doesNotMatch(enforcedPlatforms, /darwin|win32/u, "the floor may only be enforced where the platform proofs run");
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
			Object.values(parseWorkflow(read(path.join(".github", "workflows", name))).jobs ?? {}).flatMap((job) =>
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

	const lock = readJson<{
		packages: Record<string, { optionalDependencies?: Record<string, unknown> }>;
	}>("package-lock.json");
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
	const biome = readJson<{
		linter: { enabled: boolean };
		formatter: { enabled: boolean; indentStyle: string; lineWidth: number };
		files: { includes: string[] };
	}>("biome.json");
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
		biome.files.includes.some((pattern: string) => pattern === `!${frozen}` || pattern === `!${frozen}/**`),
		`biome.json must exclude the frozen package ${frozen}`,
	);
});

test("TypeScript 7 owns the main type gate and TypeScript 6 remains an explicit compatibility diagnostic", () => {
	const packageJson = JSON.parse(read("package.json"));
	assert.equal(packageJson.devDependencies["@typescript/native"], "npm:typescript@7.0.2");
	assert.equal(packageJson.devDependencies.typescript, "npm:@typescript/typescript6@6.0.2");
	for (const [owner, script] of [
		["packages", "lint:types:packages"],
		["tools", "lint:types:tools"],
		["tests", "lint:types:tests"],
	] as const) {
		assert.equal(packageJson.scripts[script], `npm run lint:types:raw:${owner}`);
	}
	for (const script of ["lint:types:raw:packages", "lint:types:raw:tools", "lint:types:raw:tests"])
		assert.match(packageJson.scripts[script], /\btsc\b/u);
	assert.match(packageJson.scripts["lint:types:ts6"], /\btsc6\b/u);
	for (const script of ["lint:types", "lint:types:packages", "lint:types:tools", "lint:types:tests"]) {
		assert.doesNotMatch(packageJson.scripts[script], /node_modules[\\/]\.bin/u);
	}
	assert.doesNotMatch(packageJson.scripts["lint:types:ts6"], /node_modules[\\/]\.bin/u);
	const typecheck = JSON.parse(read("tsconfig.typecheck.json"));
	assert.equal(typecheck.compilerOptions.baseUrl, undefined);
	assert.deepEqual(typecheck.compilerOptions.paths, {
		"@corca-ai/ceal-protocol": ["./packages/ceal-protocol/src/index.ts"],
		"@corca-ai/ceal": ["./packages/ceal-client/src/index.ts"],
	});
	assert.deepEqual(typecheck.compilerOptions.lib, ["ES2022"]);
	assert.deepEqual(typecheck.compilerOptions.types, ["node"]);
	const tools = JSON.parse(read("tsconfig.tools.json"));
	assert.deepEqual(tools.compilerOptions.lib, ["ES2022"]);
	assert.deepEqual(tools.compilerOptions.types, ["node"]);
	assert.deepEqual(tools.compilerOptions.paths, {
		"@corca-ai/ceal-protocol": ["./packages/ceal-protocol/src/index.ts"],
		"@corca-ai/ceal": ["./packages/ceal-client/src/index.ts"],
	});
	const lock = JSON.parse(read("package-lock.json"));
	assert.equal(lock.packages[""].devDependencies["@typescript/native"], "npm:typescript@7.0.2");
	assert.equal(lock.packages[""].devDependencies.typescript, "npm:@typescript/typescript6@6.0.2");
	assert.equal(lock.packages["node_modules/@typescript/native"].version, "7.0.2");
	assert.equal(lock.packages["node_modules/typescript"].name, "@typescript/typescript6");
	assert.equal(lock.packages["node_modules/typescript"].version, "6.0.2");
	assert.deepEqual(lock.packages["node_modules/typescript"].bin, { tsc6: "bin/tsc6" });
});

// `lint:shell` covers exactly two checked-in shell files by name, and no linter
// reads a workflow's `run:` block, so the shell inside CI had no gate at all. The
// class this catches is one defect, precisely: `npm stage publish … | tee` under
// `set -eu` reported `tee`'s status, so a publish that failed on 2FA or a 403
// left an exit-0 step and a summary claiming both packages staged. `zsh` and
// `bash` alike need `pipefail` for `$?` to be the pipeline's; the repo contract
// says so for interactive shells and CI is where it costs a release.
// A pipeline's status is the last command's without `pipefail`, so what a missing
// `pipefail` can hide is a failure of whatever is to the LEFT. These produce text
// and have no failure worth reading.
const HARMLESS_PIPE_PRODUCER = /^(printf|echo|cat|ls|find|yes|seq|sort)$/u;

// The command that would actually run immediately left of a pipe: the first word
// after the last shell separator or substitution opener.
//
// `{` and `(` open a group or a subshell, but `${var}` and `$(cmd)` are
// expansions, not separators. Splitting on those made `printf "${a[@]}"` read as
// a command named `a[@]}"` — so an argument could decide whether its own command
// counted as harmless. `$(` still splits, because what follows it really is a
// fresh command.
function lastCommand(segment: string): string {
	const tail = segment.split(/\$\(|&&|\|\||;|(?<!\$)\{|(?<!\$)\(/u).pop() ?? "";
	return tail.trim().split(/\s+/u)[0] ?? "";
}

/**
 * Both halves of the shell-status rule walk the same population. The walk lives
 * here so they cannot come to disagree about what a run block is, and each half
 * supplies only the per-line judgement that is actually its own.
 */
function forEachWorkflowRunBlock(visit: (step: WorkflowStep & { readonly run: string }, where: string) => void): void {
	const workflows = readdirSync(path.join(ROOT, ".github", "workflows")).filter((name) => name.endsWith(".yml"));
	assert.ok(workflows.length >= 3, `only ${workflows.length} workflows scanned; the sweep is not reaching .github/workflows`);
	let scanned = 0;
	for (const name of workflows) {
		for (const job of Object.values(parseWorkflow(read(path.join(".github", "workflows", name))).jobs ?? {})) {
			for (const step of job.steps ?? []) {
				if (typeof step.run !== "string") continue;
				scanned += 1;
				visit({ ...step, run: step.run }, `${name} :: ${step.name ?? "(unnamed step)"}`);
			}
		}
	}
	assert.ok(scanned > 10, `only ${scanned} run blocks scanned; the sweep is not reaching them`);
}

test("every workflow run block that reads a pipeline's status asks for pipefail", () => {
	const offenders: string[] = [];
	forEachWorkflowRunBlock((step, where) => {
		// Only a pipe whose LEFT side can fail meaningfully matters. A `printf`
		// or `find` on the left cannot, which is why the two workflows that
		// still run `set -eu` are not offenders — the sweep says so by looking
		// rather than by exempting them by name.
		// A pipe is spelled with spaces around it here; a `case` alternation is
		// not (`""|0000…)`), which is how the two are told apart without
		// parsing shell. The limit is real and stated rather than hidden: a
		// pipe written `a|b` is missed.
		//
		// What matters is the command on the LEFT of the pipe, wherever it
		// sits — a producer that cannot meaningfully fail carries no status to
		// lose, and it is just as often inside `$( )` as at the start of a
		// line. Reading only the line start exempted the wrong things.
		const risky = step.run
			.split("\n")
			.filter((line) => !/^\s*#/u.test(line))
			.filter((line) =>
				line
					.split(" | ")
					.slice(0, -1)
					.some((left) => !HARMLESS_PIPE_PRODUCER.test(lastCommand(left))),
			);
		if (risky.length === 0) return;
		if (!/\bset\s+-[a-z]*o?\s*pipefail\b|\bset\s+-o\s+pipefail\b/u.test(step.run)) {
			offenders.push(`${where} :: ${requiredValue(risky[0], "risky_pipeline").trim()}`);
		}
	});
	assert.deepEqual(offenders, [], "a run block pipes into a command and would report the wrong exit status");
});

// The other half of the rule above. `set -e` and `pipefail` both fail to see a
// command inside a process substitution: `mapfile -t a < <(node ...)` reports
// mapfile's status, never node's, so a refusal the producer was written to raise
// becomes an empty array and a confusing failure somewhere downstream. This bit
// the rollback lane's published-inventory parser, whose entire job is to name
// what is wrong with a published inventory.
//
// Both spellings are scanned: redirected (`< <(cmd)`) and argument position
// (`diff <(cmd) <(cmd)`), and a substitution whose body runs onto later lines is
// read to its matching paren rather than skipped — the rollback lane's own
// offender was written that way, so a line-at-a-time scan could not see the very
// defect this gate exists for. A substitution is judged by EVERY command in its
// pipeline, using the pipe sweep's own harmless-producer vocabulary, so
// `<(printf x | node …)` is an offender even though its head is harmless.
/** Every process-substitution body in one run block, each read to its matching paren. */
function processSubstitutions(run: string): string[] {
	const bodies: string[] = [];
	for (let index = run.indexOf("<("); index !== -1; index = run.indexOf("<(", index + 2)) {
		if (/^\s*#/u.test(run.slice(run.lastIndexOf("\n", index) + 1, index))) continue;
		let depth = 1;
		let cursor = index + 2;
		while (cursor < run.length && depth > 0) {
			if (run[cursor] === "(") depth += 1;
			else if (run[cursor] === ")") depth -= 1;
			cursor += 1;
		}
		bodies.push(run.slice(index + 2, depth === 0 ? cursor - 1 : run.length));
	}
	return bodies;
}

test("no workflow run block reads a producer's output through a process substitution", () => {
	const offenders: string[] = [];
	forEachWorkflowRunBlock((step, where) => {
		for (const body of processSubstitutions(step.run)) {
			const stages = body.split(" | ").map((stage) => lastCommand(stage));
			if (stages.every((stage) => HARMLESS_PIPE_PRODUCER.test(stage))) continue;
			offenders.push(`${where} :: ${requiredValue(body.split("\n")[0], "process_substitution_line").trim()}`);
		}
	});
	// Positive controls: both spellings are seen, a body that runs onto later lines
	// is seen, a pipeline is judged by every stage rather than its head, and a
	// harmless producer is still waved through.
	assert.deepEqual(processSubstitutions("mapfile -t a < <(node -e 1)"), ["node -e 1"]);
	assert.deepEqual(processSubstitutions("diff -u <(printf a) <(node -e 1)"), ["printf a", "node -e 1"]);
	assert.deepEqual(processSubstitutions("mapfile -t a < <(\n  node -e 1\n)"), ["\n  node -e 1\n"]);
	assert.equal(HARMLESS_PIPE_PRODUCER.test(lastCommand("node -e 1")), false);
	assert.equal(
		"printf x | node -e 1".split(" | ").every((stage) => HARMLESS_PIPE_PRODUCER.test(lastCommand(stage))),
		false,
		"a harmless head must not wave through a pipeline whose tail can fail",
	);
	assert.equal(
		"printf x | sort".split(" | ").every((stage) => HARMLESS_PIPE_PRODUCER.test(lastCommand(stage))),
		true,
	);
	// An expansion in the arguments must not decide what the command is called.
	assert.equal(lastCommand(`printf '%s' "\${expected[@]}"`), "printf");
	assert.equal(lastCommand("{ node -e 1"), "node");
	assert.deepEqual(offenders, [], "a run block reads a process substitution and would lose the producer's exit status");
});

// Release workflows trigger on tags only, so without this lane the first CI run
// for a change is its release run — and a failed release tag cannot be reused.
test("a non-tag CI lane runs the full gate on main", () => {
	const workflow = parseWorkflow(read(".github/workflows/check.yml"));
	assert.ok(workflow.on.push, "the check workflow must declare push triggers");
	assert.ok(workflow.on.pull_request, "the check workflow must declare pull request triggers");
	assert.deepEqual(workflow.on.push.branches, ["main"]);
	assert.deepEqual(workflow.on.pull_request.branches, ["main"]);
	assert.ok(
		Object.values(workflow.jobs).some((job) => (job.steps ?? []).some(runsFinalGate)),
		"the check workflow must run the same npm run check maintainers run",
	);
	// The gate must run everywhere the release lane builds. It did not, and a
	// fixture path that is symlinked on macOS and not on Linux therefore first
	// failed in the tagged run that burned ceal-v0.66.0.
	const runners = Object.values(workflow.jobs).flatMap((job) => (job.strategy?.matrix?.include ?? []).map((entry) => entry.runner));
	const releaseRunners = Object.values(parseWorkflow(read(".github/workflows/ceal-release.yml")).jobs).flatMap((job) =>
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
	assert.ok(linux, "the check workflow must declare a Linux matrix entry");
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
	const workflow = parseWorkflow(read(".github/workflows/check.yml"));
	const conditional = Object.entries(workflow.jobs).filter(([, job]) => typeof job.if === "string");
	// The classifier itself must not be conditional, or the answer every other job
	// depends on could go unasked.
	assert.ok(!conditional.some(([name]) => name === "scope"), "the scope job must run unconditionally; nothing else can decide for it");
	assert.ok(conditional.length > 0, "at least one leg must be scope-gated, or the classifier decides nothing");
	for (const [name, job] of conditional) {
		// The condition must be the classifier's answer rather than anything a
		// commit message, an actor, or a label could set.
		assert.ok(typeof job.if === "string", `'${name}' must declare a workflow condition`);
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
	assert.ok(pattern[1], "the scope job's documentation allowlist must contain a pattern");
	const documentation = new RegExp(`^(${pattern[1]})`, "u");
	for (const file of ["docs/handoff.md", "charness-artifacts/x.md", "README.md", "CLAUDE.md"]) {
		assert.ok(documentation.test(file), `${file} is documentation and should not force the macOS gate`);
	}
	for (const file of [
		"packages/ceal-worker-cli/src/index.ts",
		"scripts/build-worker-release-assets.ts",
		"test/contract/repo-gates.test.ts",
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
		const sourceMatch = /"source_path":\s*"([^"]+)"/u.exec(entry);
		assert.ok(sourceMatch, "every release source path must remain parseable");
		assert.ok(sourceMatch[1], "every release source path must be non-empty");
		const source = sourceMatch[1];
		assert.ok(!documentation.test(source), `${source} is a release input, so a change to it must never be classified as documentation`);
	}
	// Fail-open would be the expensive mistake here; fail-closed is the dangerous
	// one. Every branch that cannot classify must run the lane.
	assert.ok(
		classify.includes("decide_code") && !/echo "code=false"[\s\S]*decide_code/u.test(classify),
		"the classifier must resolve every uncertain case to running the gate",
	);
});

// The gate above reads the allowlist out of the classifier and runs it against
// real paths, which proves the pattern. It executes no line of the shell around
// that pattern, so the only way anyone had to watch an arm decide was to push
// and read the run. That is a poor loop for the one thing standing between a
// code change and no CI at all, and it hides the mistake that is easiest to make
// by hand: reading the tip commit instead of the pushed range. So this runs the
// workflow's own script text against a throwaway repository.
//
// Every case below asserts the *reason* the classifier printed as well as the
// verdict. Verdict alone would not distinguish an arm that decided from one that
// fell through to a later `decide_code` — and since every fallthrough here lands
// on `true`, four of the guards could be deleted with a verdict-only test still
// green.
//
// It is the script text from the YAML, not a copy: a paraphrase here would pass
// while the lane did something else.
test("the scope classifier answers documentation-only, code, and every uncertain case", (context) => {
	const classify = (parseWorkflow(read(".github/workflows/check.yml")).jobs.scope?.steps ?? []).map((step) => step.run ?? "").join("\n");
	const scratch = mkdtempSync(path.join(tmpdir(), "ceal-scope-"));
	context.after(() => rmSync(scratch, { recursive: true, force: true }));
	const clone = path.join(scratch, "repo");
	const script = path.join(scratch, "classify.sh");
	writeFileSync(script, classify);

	// GIT_CONFIG_GLOBAL is neutralised for every git call, this test's and the
	// classifier's: a maintainer running with `commit.gpgSign` or an excludesFile
	// that ignores `*.mjs` would otherwise get a red gate describing their own
	// machine rather than this repository.
	const environment = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
	const git = (...args: string[]): string =>
		execFileSync("git", args, { cwd: clone, encoding: "utf8", stdio: "pipe", env: environment }).trim();
	mkdirSync(path.join(clone, "docs"), { recursive: true });
	mkdirSync(path.join(clone, "scripts"), { recursive: true });
	execFileSync("git", ["init", "--quiet", "-b", "main", clone], { stdio: "pipe", env: environment });
	// Identity on the command line rather than in the config: a CI runner has no
	// global git identity, and `commit` refuses without one.
	const commit = (message: string): string => {
		git("add", "-A");
		git("-c", "user.email=gate@example.invalid", "-c", "user.name=gate", "commit", "--quiet", "-m", message);
		return git("rev-parse", "HEAD");
	};
	const writeProse = (text: string): void => writeFileSync(path.join(clone, "docs", "handoff.md"), text);
	const writeCode = (text: string): void => writeFileSync(path.join(clone, "scripts", "build.mjs"), text);
	writeProse("one\n");
	writeCode("one\n");
	const seed = commit("seed");
	writeProse("two\n");
	const prose = commit("docs only");
	writeCode("two\n");
	const code = commit("code");
	// The ordering that matters: prose *after* code, so a range ending here has a
	// documentation-only tip and a code commit inside it.
	writeProse("three\n");
	const proseAfterCode = commit("docs only, after code");

	const classifyRange = (env: Record<string, string>): { verdict: string; reason: string } => {
		const output = path.join(scratch, "github-output");
		writeFileSync(output, "");
		const run = spawnSync("bash", [script], {
			cwd: clone,
			encoding: "utf8",
			env: { ...environment, GITHUB_OUTPUT: output, EVENT: "", BEFORE: "", BASE_REF: "", HEAD_SHA: "", ...env },
		});
		assert.equal(run.status, 0, `the classifier must always decide, not fail: ${run.stderr}`);
		const decided = /^code=(true|false)$/mu.exec(readFileSync(output, "utf8"));
		assert.ok(decided, `the classifier wrote no verdict: ${readFileSync(output, "utf8")}`);
		return { verdict: requiredValue(decided[1], "classifier_verdict"), reason: run.stdout };
	};

	// The skip itself, over a range rather than a tip commit.
	const skipped = classifyRange({ EVENT: "push", BEFORE: seed, HEAD_SHA: prose });
	assert.equal(skipped.verdict, "false", "a documentation-only range must skip the gate");
	assert.match(skipped.reason, /Documentation-only change/u);

	// The case the whole test exists for: the tip is prose and the range is not.
	// A classifier reading `git show HEAD` rather than the range answers `false`
	// here, which is exactly the hand mistake this encodes against.
	const spanning = classifyRange({ EVENT: "push", BEFORE: seed, HEAD_SHA: proseAfterCode });
	assert.equal(spanning.verdict, "true", "a range whose tip is prose still runs the gate if it contains a code commit");
	assert.match(spanning.reason, /these paths are not documentation:.*scripts\/build\.mjs/u);
	assert.equal(classifyRange({ EVENT: "push", BEFORE: prose, HEAD_SHA: code }).verdict, "true", "a code change must run the gate");

	// A pull request is the arm with no push history to fall back on, and it was
	// broken from the day it was written: `--depth=0` is not a legal depth, so the
	// fetch failed and every pull request ran the full lane no matter what it
	// touched. Nothing noticed, because this repository has never opened one. So
	// the documentation-only answer is proven here against a real fetchable
	// remote rather than assumed.
	const remote = path.join(scratch, "origin.git");
	execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", remote], { stdio: "pipe", env: environment });
	git("remote", "add", "origin", remote);
	git("push", "--quiet", "origin", `${prose}:refs/heads/main`);
	const request = classifyRange({ EVENT: "pull_request", BASE_REF: "main", HEAD_SHA: proseAfterCode });
	assert.equal(request.verdict, "true", "a pull request carrying a code commit must run the gate");
	git("push", "--quiet", "--force", "origin", `${code}:refs/heads/main`);
	const prosePr = classifyRange({ EVENT: "pull_request", BASE_REF: "main", HEAD_SHA: proseAfterCode });
	assert.equal(prosePr.verdict, "false", "a documentation-only pull request must skip the gate");
	assert.match(prosePr.reason, /Documentation-only change/u);

	// A branch sharing no ancestor with the base — a re-created `main`, a subtree
	// import — is what makes `git merge-base` fail. Constructed rather than
	// assumed, because the guard for it is otherwise indistinguishable from the
	// `git diff` failure that would follow it.
	git("checkout", "--quiet", "--orphan", "unrelated");
	writeProse("orphan\n");
	const orphan = commit("unrelated history");
	git("checkout", "--quiet", "main");

	// Fail-closed, one arm at a time, each pinned to the reason its own guard
	// prints. Every one of these is a case the classifier cannot answer.
	const uncertainCases: Array<[RegExp, Record<string, string>]> = [
		[/no previous commit to diff against/u, { EVENT: "push", BEFORE: "0".repeat(40), HEAD_SHA: code }],
		[/the previous commit is not in this clone/u, { EVENT: "push", BEFORE: "d".repeat(40), HEAD_SHA: code }],
		[/workflow_dispatch carries no diff range/u, { EVENT: "workflow_dispatch", HEAD_SHA: code }],
		[/could not fetch the base ref/u, { EVENT: "pull_request", BASE_REF: "absent-branch", HEAD_SHA: code }],
		[/no merge base with main/u, { EVENT: "pull_request", BASE_REF: "main", HEAD_SHA: orphan }],
		// An empty range should not be reachable, and that is the reason to pin it:
		// the arm exists to make "should not happen" run the lane rather than skip it.
		[/the range reports no files/u, { EVENT: "push", BEFORE: code, HEAD_SHA: code }],
	];
	for (const [reason, env] of uncertainCases) {
		const decided = classifyRange(env);
		assert.equal(decided.verdict, "true", `${reason}: an unclassifiable change must run the gate`);
		assert.match(decided.reason, reason, "the guard that fired must be the one that owns this case");
	}
});

// One NUL byte makes `rg` and `grep` classify a source file as binary, and both
// then report nothing for it without saying why. That is not a search failing —
// it is a search succeeding with a wrong answer, and an agent's "no caller"
// claim is built out of exactly those zeroes. On 2026-08-08 a raw NUL in
// `test/device-proof.test.mjs` hid an `instanceof` import from three searches in
// a row and an export was deleted that a suite needed; only running the suite
// disagreed. The byte was never needed: `"\0"` is the same bytes at runtime and
// leaves the file text. So the rule is enforced rather than remembered.
test("no searchable worktree source file is binary to a text search", () => {
	const searchable = searchableWorktreeFiles(ROOT);
	assert.ok(searchable.length > 100, `only ${searchable.length} searchable files found; this check would be near-vacuous`);
	const binary = searchable.filter((file) => readFileSync(path.join(ROOT, file)).includes(0));
	assert.deepEqual(binary, [], 'a NUL byte hides this file from rg and grep; write it as "\\0" instead');
});

test("searchable inventory ignores deleted index paths and includes their untracked replacements", (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-searchable-worktree-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "--quiet", root], { stdio: "pipe" });
	writeFileSync(path.join(root, "old-name.mjs"), "export const oldName = true;\n");
	execFileSync("git", ["add", "old-name.mjs"], { cwd: root, stdio: "pipe" });
	rmSync(path.join(root, "old-name.mjs"));
	writeFileSync(path.join(root, "new-name.mjs"), Buffer.from("export const newName = '\0';\n"));
	assert.deepEqual(searchableWorktreeFiles(root), ["new-name.mjs"]);
	assert.equal(readFileSync(path.join(root, "new-name.mjs")).includes(0), true, "the untracked replacement must remain scannable");
});

// `@testOnly` is how a source file declares that an `export` exists for the
// suites rather than for a production caller, and `knip.json`'s `tags` entry
// makes `npm run lint:unused` skip it. That is a claim, and on its own nothing
// checks it: tagging a symbol nothing uses at all silences the tool just as
// effectively as tagging one a suite genuinely needs — verified by planting a
// tagged unused export and watching `knip` go quiet. An exception that suppresses
// a finding without being checked is the vacuous guard this repository keeps
// removing, so the tag is only allowed where it is true.
test("every @testOnly export is actually reached by a suite", () => {
	const isSource = (name: string): boolean => /\.(ts|mjs)$/u.test(name) && !name.endsWith(".d.ts");
	const sources = [];
	for (const workspace of manifest.workspaces) {
		if (!existsSync(path.join(ROOT, workspace, "src"))) continue;
		sources.push(...filesUnder(path.join(workspace, "src"), isSource));
	}
	// `scripts/` uses the same tag for the same purpose — `lint:reachability`
	// exempts a tagged export exactly as `knip` does — so it is checked here too
	// rather than in a second gate that could disagree with this one.
	sources.push(...filesUnder("scripts", isSource));
	assert.ok(sources.length > 0, "no workspace sources found; this check would be vacuous");

	// The declaration that follows the tag, whether the tag sits in its own block
	// or on one line with the rest of the docstring.
	const DECLARED = /@testOnly[\s\S]*?\*\/\s*export\s+(?:async\s+)?(?:function|class|const|let|interface|type)\s+([A-Za-z0-9_$]+)/gu;
	const tagged = sources.flatMap((file) => [...read(file).matchAll(DECLARED)].map((match) => ({ file, symbol: match[1] })));
	// A positive control on the scan itself: the repository has these today, and a
	// regex that silently stopped matching would otherwise turn this test green.
	assert.ok(tagged.length > 0, "no @testOnly exports found; either the tag is gone or this scan stopped matching");

	const isSuite = (name: string): boolean => /[.]test[.](?:mjs|ts)$/u.test(name);
	const suiteFiles = [...filesUnder("test", isSuite)];
	for (const workspace of manifest.workspaces) suiteFiles.push(...filesUnder(path.join(workspace, "test"), isSuite));
	const suites = suiteFiles.map((file) => read(file));
	assert.ok(suites.length > 0, "no suites found; this check would be vacuous");
	const suiteText = suites.join("\n");

	const unreached = tagged.filter(({ symbol }) => !new RegExp(`\\b${symbol}\\b`, "u").test(suiteText));
	assert.deepEqual(
		unreached.map(({ file, symbol }) => `${file}: ${symbol}`),
		[],
		"a @testOnly export that no suite imports is not test-only, it is unused — delete the export or the tag",
	);
});

test("promoted attachment-stream private entrypoint is reachable and not quarantined", () => {
	const knip = JSON.parse(read("knip.json"));
	assert.deepEqual(knip.workspaces["packages/ceal-worker-cli"].ignore ?? [], []);
	const bin = read("packages/ceal-worker-cli/src/bin.ts");
	const runtime = read("packages/ceal-worker-cli/src/private-bin-runtime.ts");
	assert.match(bin, /LEASED_CONSUMER_ATTACHMENT_STREAM_ENTRYPOINT_ARGV/u);
	assert.match(runtime, /runLeasedConsumerAttachmentStreamEntrypoint/u);
	assert.ok(existsSync(path.join(ROOT, "packages/ceal-worker-cli/src/leased-consumer-attachment-stream-entrypoint.ts")));
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
			scanned.push(path.join(root, path.relative(directory, path.join(entry.parentPath, entry.name))));
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
	const script = Object.values(parseWorkflow(release).jobs)
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
	const suites = readdirSync(path.join(ROOT, "test"), { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".test.ts"));
	assert.ok(
		suites.some((suite) => path.dirname(suite) === "contract"),
		"the scan must reach test/contract/, which is where cheap suites live",
	);
	for (const suite of suites) {
		const source = read(path.join("test", suite));
		const inline = /skip:\s*process\.(?:platform|arch)/u.test(source);
		assert.equal(inline, false, `test/${suite} skips on the host platform inline; use platformProofTest from test/platform-proof.ts`);
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
	const read = (relativePath: string): string => readFileSync(path.join(ROOT, relativePath), "utf8");
	for (const [file, why] of [
		["scripts/worker-release-inputs.ts", "the chokepoint every release, packing, and native-artifact path funnels through"],
		["scripts/worker-acceptance-packet.ts", "acceptance-candidate emission"],
	]) {
		assert.match(
			read(requiredValue(file, "shippability_source_file")),
			/assertShippableProtocolVendorPin\(/u,
			`${file} must assert shippability: ${why}`,
		);
	}
});

// `npm run check` is not self-sufficient on a cold runner: the packed-consumer
// proofs install with --offline, so a runner that skipped the prewarm fails
// them as ENOTCACHED. This gate ran green locally and red on CI for exactly
// that reason; pin the ordering so the next lane cannot repeat it.
test("every CI lane that runs the gate prewarms the offline consumer cache first", () => {
	let gateJobs = 0;
	for (const file of workflowPaths()) {
		for (const [jobName, job] of Object.entries(parseWorkflow(read(file)).jobs)) {
			const steps = job.steps ?? [];
			const gate = steps.findIndex(runsFinalGate);
			if (gate === -1) continue;
			gateJobs += 1;
			const prewarm = steps.findIndex((step) => (step.run ?? "").includes("prewarm-offline-consumer-cache.ts"));
			assert.notEqual(prewarm, -1, `${file} ${jobName} runs the gate without prewarming the offline cache`);
			const sameStepInOrder =
				prewarm === gate &&
				(requiredValue(steps[gate], "final_gate_step").run ?? "").indexOf("prewarm-offline-consumer-cache.ts") <
					(requiredValue(steps[gate], "final_gate_step").run ?? "").indexOf("npm run check");
			assert.ok(prewarm < gate || sameStepInOrder, `${file} ${jobName} must prewarm the offline cache before running the gate`);
		}
	}
	assert.ok(gateJobs > 0, "no workflow job runs the final gate; the offline-cache prerequisite check became vacuous");
});

test("privileged release jobs consume only same-run unprivileged handoffs", () => {
	const workflows = {
		worker: parseWorkflow(read(".github/workflows/ceal-release.yml")),
		rollback: parseWorkflow(read(".github/workflows/ceal-worker-stable-rollback.yml")),
	};
	assertPrivilegedReleaseBoundaries(workflows);

	const removeRunFragment = (step: { run?: string }, fragment: string) => {
		const source = step.run ?? "";
		assert.ok(source.includes(fragment), `mutation fixture is missing: ${fragment}`);
		step.run = source.replace(fragment, "true");
	};
	const mutationCases: Array<{ name: string; apply: (candidate: typeof workflows) => void }> = [
		{
			name: "worker tag-type binding",
			apply: (candidate) =>
				removeRunFragment(
					namedStep(requiredValue(candidate.worker.jobs["sign-and-publish"], "worker_publish_job"), "Verify same-run worker release binding"),
					'[ "$GITHUB_REF_TYPE" = "tag" ]',
				),
		},
		{
			name: "worker tag-ref binding",
			apply: (candidate) =>
				removeRunFragment(
					namedStep(requiredValue(candidate.worker.jobs["sign-and-publish"], "worker_publish_job"), "Verify same-run worker release binding"),
					'[ "$GITHUB_REF" = "refs/tags/$TAG" ]',
				),
		},
		{
			name: "worker artifact binding",
			apply: (candidate) => {
				requiredWith(
					namedStep(requiredValue(candidate.worker.jobs["sign-and-publish"], "worker_publish_job"), "Download exact assembled release handoff"),
				).name = "ceal-worker-release-mutated";
			},
		},
		{
			name: "worker assembled digest binding",
			apply: (candidate) =>
				removeRunFragment(
					namedStep(requiredValue(candidate.worker.jobs["sign-and-publish"], "worker_publish_job"), "Verify the assembled worker inventory"),
					'[ "$ASSEMBLED_SHA256SUMS_SHA256" = "$observed" ]',
				),
		},
		{
			name: "rollback artifact binding",
			apply: (candidate) => {
				requiredWith(
					namedStep(requiredValue(candidate.rollback.jobs.activate, "rollback_activate_job"), "Download the verified rollback handoff"),
				).name = "ceal-worker-rollback-mutated";
			},
		},
		{
			name: "rollback pointer-tag binding",
			apply: (candidate) =>
				removeRunFragment(
					namedStep(requiredValue(candidate.rollback.jobs.activate, "rollback_activate_job"), "Verify the downloaded rollback handoff"),
					'[ "$pointer_tag" = "$TAG" ]',
				),
		},
		{
			name: "rollback verified digest binding",
			apply: (candidate) =>
				removeRunFragment(
					namedStep(requiredValue(candidate.rollback.jobs.activate, "rollback_activate_job"), "Verify the downloaded rollback handoff"),
					'[ "$VERIFIED_SHA256SUMS_SHA256" = "$observed_digest" ]',
				),
		},
		{
			name: "rollback installer binding",
			apply: (candidate) =>
				removeRunFragment(
					namedStep(requiredValue(candidate.rollback.jobs.activate, "rollback_activate_job"), "Verify the downloaded rollback handoff"),
					'[ "$expected_installer" = "$observed_installer" ]',
				),
		},
	];
	for (const mutation of mutationCases) {
		const candidate = structuredClone(workflows);
		mutation.apply(candidate);
		assert.throws(() => assertPrivilegedReleaseBoundaries(candidate), mutation.name);
	}

	const withCheckedOutSource = structuredClone(workflows);
	requiredSteps(requiredValue(withCheckedOutSource.worker.jobs["sign-and-publish"], "worker_publish_job")).unshift({
		uses: "actions/checkout@deadbeef",
	});
	assert.throws(() => assertPrivilegedReleaseBoundaries(withCheckedOutSource));
});

test("release approval uses the authorized trigger, not mutable per-release identity variables", () => {
	const workflowPaths = [
		".github/workflows/ceal-release.yml",
		".github/workflows/ceal-worker-stable-rollback.yml",
		"docs/operator-acceptance.md",
		"docs/handoff.md",
		"docs/release-and-enrollment.md",
	];
	for (const workflowPath of workflowPaths) {
		const source = read(workflowPath);
		assert.match(source, workflowPath.startsWith(".github/") ? /ceal-cli-release/u : /release/u, `${workflowPath} is not a positive control`);
		assert.doesNotMatch(
			source,
			/CEAL_CLI_APPROVED_(?:COMMIT|SHA256SUMS_SHA256)/u,
			`${workflowPath} retains a mutable per-release approval variable`,
		);
	}
});

// A mutable action ref resolves to whatever the tag points at when the lane runs,
// which for the release lanes is the moment artifacts get signed and published.
// Two pin assertions already existed, but between them they covered exactly two
// workflows, so `check.yml`, `ceal-release.yml`, and
// `ceal-worker-stable-rollback.yml` were pinned only by habit. This asserts
// across every workflow rather than a hand-kept list.
test("every workflow pins every action to a full commit SHA", () => {
	let pinned = 0;
	for (const workflowPath of checkedWorkflowPaths()) {
		const uses = [...read(workflowPath).matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gmu)].map((match) =>
			requiredCapture(match, 1, "workflow_action"),
		);
		const name = path.basename(workflowPath);
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
	assert.ok(pinned >= 10, `only ${pinned} pinned action refs checked across ${workflowPaths().length} workflows`);
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
	let bounded = 0;
	for (const workflowPath of checkedWorkflowPaths()) {
		const jobs = Object.entries(parseWorkflow(read(workflowPath)).jobs ?? {});
		const name = path.basename(workflowPath);
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
	assert.ok(bounded >= 6, `only ${bounded} jobs checked across ${workflowPaths().length} workflows`);
});

// `npm run check` skips the release-artifact and installer proofs on a host that
// cannot build them, and CEAL_REQUIRE_PLATFORM_PROOFS is what turns that skip
// into a failure on a host that can. `check.yml` set it and the release lane did
// not, so the lane those proofs exist to describe was the weaker gate of the two
// — and its failures are the ones that burn a tag.
test("the release lane demands the platform proofs its own artifacts depend on", () => {
	const workflow = parseWorkflow(read(".github/workflows/ceal-release.yml"));
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
	const workflow = parseWorkflow(read(".github/workflows/ceal-release.yml"));
	assert.ok(workflow.on.push, "the release workflow must declare push triggers");
	assert.ok(workflow.on.workflow_dispatch !== undefined, "the release lane must keep a dispatch that can be exercised without a tag");
	assert.deepEqual(workflow.on.push.tags, ["ceal-v*.*.*"], "the publishing trigger stays tag-only");

	const pushOnly = Object.entries(workflow.jobs).filter(([, job]) => String(job.if ?? "").includes("github.event_name == 'push'"));
	const dispatchable = Object.entries(workflow.jobs).filter(([name]) => !pushOnly.some(([guarded]) => guarded === name));
	// One, not two. `assemble` was push-gated as well until the merge's
	// pre-signing pin assertion made the cost visible: that job downloads build
	// artifacts, merges them locally and uploads one artifact with
	// `contents: read` and no secrets, so gating it bought nothing and meant the
	// first execution of any change to the merge was a real tag — the exact
	// hazard this dispatch exists to remove. The count is not the property
	// anyway; the tool check below is, and it holds however the jobs are split.
	assert.ok(pushOnly.length >= 1, "the job that signs and publishes must be gated on the push event");

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
	const workflow = parseWorkflow(read(".github/workflows/ceal-release.yml"));
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
	const compile = read("scripts/build-worker-release-package.ts");
	assert.match(compile, /tsconfig\.build\.json/u, "composition must still run its own compiler for the legs that skip the gate");
});

// The gate receipt is what lets the release lane skip a gate `check.yml` already
// ran, and every way it can go wrong is quiet. A receipt written under the wrong
// runner identity does not fail anything — it just never matches, so the saving
// silently stops and nobody is told. A pass/fail environment variable added to a
// gate step but not to the record is worse: two runs that prove different things
// digest the same, and the release lane skips a proof it never had. Neither is
// visible in a run log, so both are asserted here.
test("every step that runs the gate records the receipt the release lane will compare", () => {
	const declared = new Set([RUNNER_IDENTITY_ENV, ...PASS_FAIL_ENV_KEYS]);
	let gateSteps = 0;
	for (const workflowPath of workflowPaths()) {
		for (const [jobName, job] of Object.entries(parseWorkflow(read(workflowPath)).jobs)) {
			for (const step of (job.steps ?? []).filter(runsFinalGate)) {
				gateSteps += 1;
				const where = `${workflowPath}:${jobName}`;
				assert.match(
					String(step.env?.[RUNNER_IDENTITY_ENV]),
					/matrix\./u,
					`${where} must take the receipt's runner identity from the matrix; a hardcoded or absent one makes the two lanes disagree about the same machine`,
				);
				for (const key of Object.keys(step.env ?? {})) {
					assert.ok(
						declared.has(key),
						`${where} sets ${key} on the gate step, so either it cannot change what the gate proves — in which case move it off this step — or it belongs in PASS_FAIL_ENV_KEYS`,
					);
				}
			}
		}
	}
	assert.ok(gateSteps >= 3, `only ${gateSteps} gate steps found; this check would be near-vacuous`);
});

test("the check lane uploads a receipt from every leg that earns one", () => {
	const workflow = parseWorkflow(read(".github/workflows/check.yml"));
	const gateJobs = Object.entries(workflow.jobs as Record<string, WorkflowJob>).filter(([, job]) => (job.steps ?? []).some(runsFinalGate));
	assert.ok(gateJobs.length >= 2, "both gate legs must still exist to earn receipts");
	for (const [name, job] of gateJobs) {
		const upload = (job.steps ?? []).find((step: WorkflowStep) => String(step.uses ?? "").startsWith("actions/upload-artifact"));
		assert.ok(upload?.with, `'${name}' runs the gate but preserves no receipt, so the release lane can never reuse this runner's proof`);
		const uploaded = upload.with;
		// The receipt lives under `.charness/`, which this action skips by default.
		// Without the flag the upload succeeds and publishes nothing: a green step
		// and an artifact that does not exist.
		assert.equal(uploaded["include-hidden-files"], true, `'${name}' would upload an empty artifact`);
		assert.equal(uploaded["if-no-files-found"], "error", `'${name}' must fail rather than publish a receipt-shaped absence`);
		assert.match(
			String(uploaded.name),
			/steps\.\w[\w-]*\.outputs\.artifact_name/u,
			"the artifact name must be the digest the script computed",
		);
	}
});

// Both halves of the reuse branch, because a skipped step reports success: an
// `if` that never runs the gate and an `if` that never builds both look green
// until a tag is cut from a binary nothing compiled.
test("the release lane's gate reuse is one decision with both outcomes wired", () => {
	const workflow = parseWorkflow(read(".github/workflows/ceal-release.yml"));
	const build = requiredValue(workflow.jobs.build, "release_build_job");
	const permissions = requiredValue(build.permissions, "release_build_permissions");
	assert.deepEqual(
		[permissions.contents, permissions.actions],
		["read", "read"],
		"without actions: read the lookup can only ever answer lookup_failed, and the saving disappears with no failure to notice",
	);
	const lookup = requiredValue(
		(build.steps ?? []).find((step: WorkflowStep) => /resolve-gate-attestation\.ts/u.test(step.run ?? "")),
		"attestation_lookup_step",
	);
	const lookupId = requiredValue(lookup.id, "attestation_lookup_id");
	const verdict = `steps.${lookupId}.outputs.reuse`;

	const gate = requiredValue((build.steps ?? []).find(runsFinalGate), "release_final_gate_step");
	assert.ok(String(gate.if).includes(`${verdict} != 'true'`), "the gate must run whenever the lookup did not positively answer 'reuse'");
	// The reuse verdict is built from the LOOKUP step's environment; the proof it
	// skips is the GATE step's. Two independently-edited `env:` blocks, and until
	// this assertion nothing tied them together — so hardcoding the lookup's
	// runner identity while leaving the gate's on `matrix.runner` would make the
	// macOS leg ask for an ubuntu receipt, find the real one, and skip with no
	// macOS proof anywhere. That is the break `ceal-v0.66.0` burned on, reachable
	// by a one-line edit that no other gate in this repository would notice.
	const withoutToken = (env: Record<string, string> | undefined) =>
		Object.fromEntries(Object.entries(env ?? {}).filter(([key]) => key !== "GITHUB_TOKEN"));
	assert.deepEqual(
		withoutToken(lookup.env),
		withoutToken(gate.env),
		"the lookup and the gate must resolve every attested environment value identically, or the receipt describes a proof the lane did not want",
	);
	const reusing = (build.steps ?? []).filter((step: WorkflowStep) => String(step.if ?? "").includes(`${verdict} == 'true'`));
	assert.equal(reusing.length, 1, "exactly one step may stand in for the skipped gate");
	const reuse = requiredValue(reusing[0], "gate_reuse_step");
	assert.equal(
		reuse.run?.trim(),
		"npm run build",
		"the gate is also this leg's build, and the composition below reads dist/, so the skip has to put the build back",
	);
	for (const step of [lookup, gate, reuse]) {
		assert.match(
			String(step.if),
			/matrix\.validate_source == '1'/u,
			"the leg that deliberately skips the gate builds through its own step, and must not be handed a second one",
		);
	}
});

// A range in engines.node would let the check lane resolve a different major
// than the release lane builds on, and a green check would stop predicting a
// green release. One pin, asserted equal across both lanes.
test("the check lane and the release lane pin the same Node", () => {
	const pinned = read(".nvmrc").trim();
	assert.match(pinned, /^\d+\.\d+\.\d+$/u);
	assert.match(manifest.engines.node, /^>=/u);

	const checkSetup = Object.values(parseWorkflow(read(".github/workflows/check.yml")).jobs)
		.flatMap((job) => job.steps ?? [])
		.find((step) => (step.uses ?? "").startsWith("actions/setup-node"));
	assert.ok(checkSetup, "the check workflow must set up Node");
	assert.equal(requiredWith(checkSetup)["node-version-file"], ".nvmrc");

	const releaseVersions = Object.values(parseWorkflow(read(".github/workflows/ceal-release.yml")).jobs)
		.flatMap((job) => job.steps ?? [])
		.filter((step) => (step.uses ?? "").startsWith("actions/setup-node"))
		.map((step) => String(step.with?.["node-version"]));
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
	assert.match(hook, /npm run check:unit$/mu);
	// A tag push is the expensive one, so it must not settle for the fast gate.
	// `/npm run check\b/` was the assertion here and it could not tell the two
	// apart: `\b` matches between `k` and `:`, so the iteration-gate line alone
	// satisfied both, and deleting the tag branch outright left this test green.
	// Anchor the full-gate command to end of line, and require it to be the one
	// the tag branch reaches.
	assert.match(hook, /^\s*run_phase "tag push[^"]*" npm run check$/mu);
	assert.equal(manifest.scripts["hooks:install"], "node scripts/install-git-hooks.ts");
});

// The two regex matches above would pass just as happily against a hook that ran
// the gate and then swallowed its exit code, and the hook now does bookkeeping
// after the gate returns. Run it instead of reading it: an early version guarded
// the timing write but not its rotation, so an unwritable log directory turned a
// green gate into a blocked push one line after printing "passed".
test("the pre-push hook propagates the gate's exit code and never blocks on its own bookkeeping", (context) => {
	const scratch = mkdtempSync(path.join(tmpdir(), "ceal-hook-exit-"));
	context.after(() => rmSync(scratch, { recursive: true, force: true }));
	const checkout = path.join(scratch, "repo");
	mkdirSync(path.join(checkout, ".githooks"), { recursive: true });
	cpSync(path.join(ROOT, ".githooks/pre-push"), path.join(checkout, ".githooks/pre-push"));
	execFileSync("git", ["init", "--quiet", checkout], { stdio: "pipe" });
	// The gate commands are the one thing that must not really run here, so the
	// harness puts a stand-in `npm` ahead of the real one on PATH.
	const bin = path.join(scratch, "bin");
	mkdirSync(bin, { recursive: true });
	const stub = path.join(bin, "npm");
	const nodeStub = path.join(bin, "node");
	const timingLog = path.join(scratch, "timing", "command-timing.jsonl");
	const runHook = (refLine: string, exitCode: number) => {
		writeFileSync(stub, `#!/bin/sh\nexit ${exitCode}\n`, { mode: 0o755 });
		writeFileSync(nodeStub, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		// Git runs a hook from the checkout root, so exercise the checked-in bytes in
		// a throwaway repository. Re-entering this checkout from its own pre-push
		// suite would correctly collide with the real concurrency lock and test the
		// outer push instead of exit propagation.
		return spawnSync("sh", [path.join(checkout, ".githooks/pre-push"), "origin", "git@example.invalid:x/y.git"], {
			cwd: checkout,
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
	cpSync(path.join(ROOT, "scripts/install-git-hooks.ts"), path.join(clone, "scripts/install-git-hooks.ts"), {
		recursive: true,
	});

	const check = () => spawnSync(process.execPath, ["scripts/install-git-hooks.ts", "--check"], { cwd: clone, encoding: "utf8" });
	// Unset is a state, not a crash: it must exit non-zero and say what to run.
	const before = check();
	assert.equal(before.status, 1);
	assert.match(before.stderr, /npm run hooks:install/u);

	execFileSync(process.execPath, ["scripts/install-git-hooks.ts"], { cwd: clone, stdio: "pipe" });
	assert.equal(check().status, 0);
	assert.equal(execFileSync("git", ["config", "--local", "--get", "core.hooksPath"], { cwd: clone, encoding: "utf8" }).trim(), ".githooks");
	// Re-running is safe: an installed clone stays installed.
	execFileSync(process.execPath, ["scripts/install-git-hooks.ts"], { cwd: clone, stdio: "pipe" });
	assert.equal(check().status, 0);

	// `core.hooksPath` alone is not enforcement, and with two hooks that stopped
	// being a distinction without a difference: git skips a hook it cannot
	// execute, saying so only under `advice.ignoredHook`, so a check that named
	// pre-push would have reported this clone installed while its commit gate ran
	// on nothing.
	chmodSync(path.join(clone, ".githooks/pre-commit"), 0o644);
	const unreadable = check();
	assert.equal(unreadable.status, 1, "a hook git cannot execute must not report as installed");
	assert.match(unreadable.stderr, /not executable: pre-commit/u);
	execFileSync(process.execPath, ["scripts/install-git-hooks.ts"], { cwd: clone, stdio: "pipe" });
	assert.equal(check().status, 0, "the installer must repair what its own check refused");
});

// S2 (corca-ai/ceal#717). This repository had no commit tier at all, so a type
// error first surfaced at pre-push, after the commit that carried it was
// written. What the tier must NOT become is the interesting assertion: it holds
// its value only while it stays cheap, and the way it stops being cheap is
// somebody adding the build or the test suite to it.
test("the pre-commit hook is checked in and stays the cheap tier", () => {
	assert.ok(existsSync(path.join(ROOT, ".githooks/pre-commit")), ".githooks/pre-commit must be checked in");
	const hook = read(".githooks/pre-commit");
	for (const gate of [
		"npm run lint",
		"npm run lint:types",
		"npm run lint:no-legacy-mjs",
		"npm run lint:source-nul-bytes:staged",
		"npm run lint:markdown:staged",
		"node test/gate-contract-lib.ts",
		"npm run lint:shell",
	]) {
		assert.match(
			hook,
			new RegExp(`^run_gate "[^"]*" ${gate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "mu"),
			`the commit tier must still run ${gate}`,
		);
	}
	// Every gate goes through `run_gate`, checked first, because everything below
	// reasons about `run_gate` lines. A bare `npm run test:unit` on its own line
	// is still a gate — `set -eu` makes it one — and would have been invisible to
	// all of it.
	const commandLines = hook
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /^(npm|node|npx|\.\/|sh |bash )/u.test(line));
	assert.deepEqual(
		commandLines,
		[],
		`every gate must go through run_gate so the cheapness assertions can see it: ${commandLines.join(", ")}`,
	);

	// This started as `npm (run )?(test|build|check:unit)$`, anchored on the bare
	// script names, and the anchor was the defect: `npm run build:worker`,
	// `test:unit`, `test:contract` and `coverage` are all real scripts in this
	// package that the alternation let straight through, while docs/gates.md
	// promised this test refuses "a test or a build". Match the FAMILY, so a
	// suffixed variant cannot slip past — `\b` before the suffix is what the
	// pre-push assertion above had to learn, used here on purpose rather than by
	// accident.
	const heavy = /^run_gate "[^"]*" npm (run )?(test|build|coverage|check)\b/mu;
	assert.doesNotMatch(hook, heavy, "the commit tier runs no test, no build, no coverage and no full gate; those belong to pre-push");
	// A negative control on that pattern: the gates the tier DOES run must not
	// match it, or the assertion above would be vacuously satisfiable by removing
	// everything.
	assert.doesNotMatch('run_gate "biome" npm run lint\nrun_gate "types" npm run lint:types\n', heavy);
	assert.match('run_gate "x" npm run test:unit\n', heavy, "the pattern must catch a suffixed test script");
	assert.match('run_gate "x" npm run build:worker\n', heavy, "the pattern must catch a suffixed build script");
	assert.match('run_gate "x" npm run check:unit\n', heavy, "the pattern must catch the iteration gate");

	// The strengthened `--check` exists to catch a clone that silently runs
	// nothing, and it had no repo-owned entrypoint: the docs told the reader to
	// type the raw node path, which is the "gate with no `npm run` owner" shape
	// AGENTS.md records as a burn.
	assert.equal(manifest.scripts["hooks:check"], "node scripts/install-git-hooks.ts --check");
});

// The regex matches above would pass just as happily against a hook that ran the
// gates and then swallowed their exit codes — which is the whole difference
// between a gate and a report.
test("the pre-commit hook propagates the failing gate's exit code", (context) => {
	const scratch = mkdtempSync(path.join(tmpdir(), "ceal-precommit-exit-"));
	context.after(() => rmSync(scratch, { recursive: true, force: true }));
	const checkout = path.join(scratch, "repo");
	mkdirSync(path.join(checkout, ".githooks"), { recursive: true });
	cpSync(path.join(ROOT, ".githooks/pre-commit"), path.join(checkout, ".githooks/pre-commit"));
	execFileSync("git", ["init", "--quiet", checkout], { stdio: "pipe" });
	// The gates must not really run here, so stand-ins for `npm` and `node` go
	// ahead of the real ones on PATH.
	const bin = path.join(scratch, "bin");
	mkdirSync(bin, { recursive: true });
	// Two codes, not one: `npm` carries the first gate and `node` carries the
	// fifth, so they can be failed independently.
	const runHook = (npmExit: number, nodeExit: number) => {
		writeFileSync(path.join(bin, "npm"), `#!/bin/sh\nexit ${npmExit}\n`, { mode: 0o755 });
		writeFileSync(path.join(bin, "node"), `#!/bin/sh\nexit ${nodeExit}\n`, { mode: 0o755 });
		return spawnSync("sh", [path.join(checkout, ".githooks/pre-commit")], {
			cwd: checkout,
			encoding: "utf8",
			env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
		});
	};

	assert.equal(runHook(0, 0).status, 0, "a passing tier must let the commit through");
	// Not 1: a flattened code hides which gate failed and how.
	const first = runHook(42, 0);
	assert.equal(first.status, 42, "the gate's own exit code must reach git");
	assert.match(first.stderr, /COMMIT BLOCKED by biome/u, "the hook must name the gate that blocked, not just fail");

	// Failing the FIRST gate proves one `run_gate` line. The tier has six, and a
	// later one written wrong would not be reached above, so fail a gate the hook
	// only gets to after four others have passed.
	const later = runHook(0, 7);
	assert.equal(later.status, 7, "a gate past the first must propagate its own code too");
	assert.match(later.stderr, /COMMIT BLOCKED by gate contract/u, "the hook must name whichever gate blocked, not only the first");
});

// `lint-shell.ts` used to name its files. Adding a second hook made that
// inventory's blind spot real: a hook added without being named would have been
// the one shell file in the tree nobody linted, and silently. The population is
// derived from `.githooks/` now, and this asserts the derivation against the
// directory rather than against the source text — a comment claiming derivation
// is not a derivation.
test("the shell lint covers every checked-in hook, not a named subset", () => {
	// The expectation comes from git, not from the `readdirSync` the module under
	// test uses to build the same list. A fixture built the module's own way
	// proves only that the module agrees with itself; "checked-in" is a claim
	// about the repository, so ask the repository. It also means an untracked
	// file sitting in the hook directory reddens this, which is the right answer:
	// a gate directory is not a scratch directory.
	const tracked = execFileSync("git", ["ls-files", "--", ".githooks"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
	assert.ok(tracked.includes(".githooks/pre-push"), "positive control: git must report a hook we know is checked in");
	const expected = ["install-ceal.sh", ...tracked].join(", ");

	const result = spawnSync(process.execPath, ["scripts/lint-shell.ts"], { cwd: ROOT, encoding: "utf8" });
	// The gate stands aside when shellcheck is absent, which is a different
	// sentence and must not be read as a clean run.
	if (/shellcheck is not installed/u.test(result.stderr)) {
		assert.match(result.stderr, new RegExp(`${tracked.length + 1} shell files went unchecked`, "u"));
		return;
	}
	assert.equal(result.status, 0, result.stderr);
	// Identity, not arity: a derivation that produced the right NUMBER of wrong
	// paths read identically under the count assertion this replaces.
	assert.match(
		result.stderr,
		new RegExp(`shell files clean: ${expected.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\n`, "u"),
		"the linted population must be install-ceal.sh plus every checked-in hook",
	);
});

// The population is `git ls-files`, not a walk of two known directories. A walk
// answers "is everything I looked at owned", which is weaker than the title
// claims and which this test got wrong in four ways at once: a subdirectory
// inside a glob-owned workspace (the package globs are `test/*.test.ts`, which
// does not recurse), a suite outside `test/` and `packages/<name>/test/`, a
// nested workspace layout like `packages/connectors/github/test/`, and a
// `.test.mjs` file, which the script parser accepts and the walk did not collect.
// Asking git for every suite file in the worktree has none of those edges.
test("every test file in this repository has exactly one owner that the gate reaches", () => {
	const scripts = manifest.scripts;
	assertContractGateScriptShape(scripts);
	for (const suite of ["test:contract", "test:release"]) {
		const suiteScript = suite === "test:contract" ? scripts["test:contract:built"] : scripts[suite];
		// The file set is the claim, but both lanes still have to use the Node test
		// runner. Contract behavior begins in the source-authoritative wrapper;
		// release proofs execute immutable artifacts directly.
		if (suite === "test:contract") {
			assert.match(suiteScript, /^node test\/run-source-tests[.]ts /u);
			assert.match(suiteScript, / && node --test /u);
			assertSourceLaneTestOwnership(suiteScript, PROJECTION_TEST);
		} else {
			assert.match(suiteScript, /^node --test /u, `${suite} must run through the node test runner`);
		}
		assert.doesNotMatch(suiteScript, /--test-name-pattern|--test-skip-pattern/u);
	}
	assert.match(scripts["check:unit"], /npm run test:contract:built/u);
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
	const testHops: Array<[string, RegExp]> = [
		["test", /npm run test:unit\b/u],
		["test", /npm run coverage:scripts/u],
		["coverage:scripts", /^node scripts\/coverage-scripts[.]ts$/u],
		["test:tiers", /npm run test:contract/u],
		["test:tiers", /npm run test:release/u],
	];
	for (const [hop, reaches] of testHops) {
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

	const declared = [...workerTierFiles(scripts, "test:contract"), ...workerTierFiles(scripts, "test:release")];
	assert.deepEqual(
		declared.filter((file, index) => declared.indexOf(file) !== index),
		[],
		"a suite named by two tiers is proved twice and owned by neither",
	);
	for (const file of declared) {
		assert.ok(
			existsSync(path.join(ROOT, file)),
			`${file} is named by a worker tier but is not on disk; a rename left the gate calling a ghost`,
		);
	}

	// The population, and who is allowed to own each part of it. This used to walk
	// `test/` only, and `packages/` was left to an assumption nobody had written
	// down — which was false for `ceal-protocol`, whose own `test` script no root
	// chain calls. `leased-consumer-source-import.test.ts` sat there passing in no
	// gate at all until this walk was widened.
	const globOwners = globOwnedWorkspaces(scripts);
	const tracked = trackedSuiteFiles();
	const explicitOnly = tracked.filter((file) => file.startsWith("test/"));
	assert.ok(
		tracked.length > explicitOnly.length && explicitOnly.length > 0,
		"the suite scan found nothing outside test/; it is not reaching the tree",
	);

	assertTestInventoryCoverage(
		declared.filter((file) => file.startsWith("test/")),
		explicitOnly,
	);
	// Mutation proof: a newly added TypeScript suite must fail the same ownership
	// contract as a newly added MJS suite, rather than relying on a human to notice
	// that the explicit inventory was not updated.
	assert.throws(() =>
		assertTestInventoryCoverage(
			declared.filter((file) => file.startsWith("test/")),
			[...explicitOnly, "test/unregistered.test.ts"],
		),
	);

	// A package suite has an owner either way; what must never happen is neither.
	// `ceal-worker-cli`'s attachment-stream carrier is deliberately in both — its
	// root-cwd contract run and its package-cwd coverage run are different
	// environments — so being glob-owned does not forbid an explicit entry.
	//
	// The workspace glob is `test/*.test.ts`, which does NOT recurse, so workspace
	// membership alone is not ownership: the file has to sit directly in that
	// directory. A suite one level deeper is found by git, matched by no glob, and
	// executed by nothing, which is what this shape exists to catch.
	const GLOB_OWNED = /^packages\/([\w-]+)\/test\/[^/]+\.test\.ts$/u;
	for (const file of tracked) {
		const owner = GLOB_OWNED.exec(file);
		const ownerName = owner?.[1];
		assert.ok(
			declared.includes(file) || (ownerName !== undefined && globOwners.has(ownerName)),
			`${file} runs in no gate: no worker tier names it, and it is not directly inside a workspace test/ directory whose own suite the root chain reaches`,
		);
	}

	// Placement IS the declaration now, so the set of places a suite can be placed
	// is the thing that has to stay closed. `test/` root is the release tier,
	// `test/contract/` the artifact lane, `test/source/` the source-authoritative
	// lane; a fourth directory would be globbed by nobody and run nowhere.
	const directories = readdirSync(path.join(ROOT, "test"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	assert.deepEqual(directories, ["contract", "source"], "a new test/ subdirectory is globbed by no lane, so its suites would run nowhere");
});

test("projection conformance cannot move or duplicate outside the source-test lane", () => {
	const correct = `node test/run-source-tests.ts protocol.test.ts ${PROJECTION_TEST}${CONTRACT_LANE_DELIMITER}plain.test.ts`;
	assert.doesNotThrow(() => assertSourceLaneTestOwnership(correct, PROJECTION_TEST));
	const moved = `node test/run-source-tests.ts protocol.test.ts${CONTRACT_LANE_DELIMITER}plain.test.ts ${PROJECTION_TEST}`;
	assert.throws(() => assertSourceLaneTestOwnership(moved, PROJECTION_TEST), /source-test runner/u);
	const duplicated = `${correct} ${PROJECTION_TEST}`;
	assert.throws(() => assertSourceLaneTestOwnership(duplicated, PROJECTION_TEST), /exactly once/u);
	assert.doesNotMatch(
		read(PROJECTION_TEST),
		/packages\/ceal-worker-cli\/dist|copiedDist/u,
		"the source-authoritative projection test must not execute mutable checkout artifacts",
	);
});

test("contract gate ownership rejects build and inventory mutations", () => {
	const scripts = { ...manifest.scripts };
	assert.doesNotThrow(() => assertContractGateScriptShape(scripts));

	const publicBuildMoved = { ...scripts, "test:contract": "npm run test:contract:built" };
	assert.throws(() => assertContractGateScriptShape(publicBuildMoved), /public contract feedback/u);
	const internalBuildAdded = { ...scripts, "test:contract:built": `npm run build && ${scripts["test:contract:built"]}` };
	assert.throws(() => assertContractGateScriptShape(internalBuildAdded), /internal contract lane must not build/u);
	const gateNames: Array<"check" | "check:unit"> = ["check", "check:unit"];
	for (const gate of gateNames) {
		const duplicateBuild = { ...scripts, [gate]: `${scripts[gate]} && npm run build` };
		assert.throws(() => assertContractGateScriptShape(duplicateBuild), /must build exactly once/u);
		const omittedBuild = { ...scripts, [gate]: scripts[gate].replace("npm run build && ", "") };
		assert.throws(() => assertContractGateScriptShape(omittedBuild), /must build exactly once/u);
		const typecheckBeforeBuild = {
			...scripts,
			[gate]: scripts[gate].replace("npm run build && ", "").replace("npm run lint:types && ", "npm run lint:types && npm run build && "),
		};
		assert.throws(() => assertContractGateScriptShape(typecheckBeforeBuild), /must build before typecheck/u);
	}
	// The lanes are globs now, so "drop this suite from the inventory" is no longer
	// a word deleted from a list — it is the lane that covers it losing its glob.
	// Same claim, expressed against what the script actually says today.
	const omittedLane = { ...scripts, "test:contract:built": scripts["test:contract:built"].replace(" test/source/*.test.ts", "") };
	assert.throws(() => assertContractGateScriptShape(omittedLane), /registered exactly once|source-test runner/u);
	const staleGlob = {
		...scripts,
		"test:contract:built": scripts["test:contract:built"].replace("test/source/*.test.ts", "scripts/*.test.ts"),
	};
	assert.throws(() => assertContractGateScriptShape(staleGlob), /matches no file/u);
});

// A "the contract suite stays small enough to run on every push" test lived here
// and asserted `WORKER_CONTRACT_TESTS.length <= 20` — a constant declared at the
// top of this same file. It could only fail when a human edited that array, and
// by its own comment it could not measure the runtime it was about. The rule it
// meant to carry belongs to CLAUDE.md, which already says to time a gate with
// `time npm run check` on the host in hand rather than trust a recorded figure.

// --- Gate-tier contract (three-repo release loop S1, corca-ai/ceal#717) ------
//
// `config/gate-contract.json` is the one declarative statement of which proof
// tiers this repository has. It lives here rather than behind a lint of its own
// because this file is already where "what the gates are" is asserted, and a
// second entry point would be a second answer to the same question.

test("the committed gate contract describes this repository's hook and CI tiers", () => {
	const declared = readContract(ROOT);
	assert.equal(declared.schema, GATE_CONTRACT_SCHEMA);
	assert.deepEqual(
		collectViolations(ROOT, declared),
		[],
		"regenerate with `node test/gate-contract-lib.ts --write` and review the diff; do not edit the file to match a change you did not intend",
	);
});

// The number this whole three-repo effort exists to reduce. One release used to
// pay for `npm run check` seven times: once locally, twice in check.yml, and
// twice per lane in the release workflow's dry run and tag run. The sites are
// asserted by name rather than counted, so removing one is a deliberate edit
// here and adding a fifth cannot pass unnoticed.
//
// A SITE IS NOT A RUN, in both directions, and the difference is the whole of
// what SC1 measures:
//   - `.githooks/pre-push` declares `npm run check` but reaches it only on a
//     TAG push; a branch push runs `check:unit` instead. One site, zero runs
//     for ordinary work.
//   - `ceal-release.yml:build` declares it once and runs it on two of three
//     matrix legs (`if: matrix.validate_source == '1'`). One site, two runs.
// So the site list is an upper bound on an ordinary push and a lower bound on a
// release, and the two numbers must never be conflated when SC1 is measured.
test("the full gate is invoked at exactly the sites the release loop accounts for", () => {
	assert.deepEqual(fullGateInvocationSites(readContract(ROOT)), [
		"pre-push/.githooks/pre-push",
		".github/workflows/ceal-release.yml:build",
		".github/workflows/check.yml:check",
		".github/workflows/check.yml:check-native",
	]);
	// The two conditions the site list cannot see, asserted against their own
	// source so this comment cannot quietly stop being true.
	assert.match(read(".githooks/pre-push"), /if \[ "\$tagged" -eq 1 \]/u, "the pre-push full gate is tag-only");
	assert.match(
		read(".github/workflows/ceal-release.yml"),
		/if: matrix\.validate_source == '1'/u,
		"the release gate runs on a subset of legs",
	);
});

// The extractor decides what the contract can see, so its blind spots are the
// contract's. Each case is a shape one of the three repositories actually
// writes: a hook that explains itself in comments, a hook that echoes the
// command it is about to run, and this repository's `run_phase` wrapper.
test("gate commands are read out of shell text, and prose about them is not", () => {
	assert.deepEqual(extractGateCommands("# rerun npm run check to see it again\nnpm run check:unit"), ["npm run check:unit"]);
	assert.deepEqual(extractGateCommands('echo "running the type gate (npm run lint)" >&2\nnpm run lint'), ["npm run lint"]);
	assert.deepEqual(extractGateCommands('run_phase "tag push, full gate" npm run check'), ["npm run check"]);
	assert.deepEqual(extractGateCommands("npm run check -- --profile ci"), ["npm run check -- --profile ci"]);
	assert.deepEqual(extractGateCommands("node scripts/a.ts \\\n  --flag value"), ["node scripts/a.ts --flag value"]);
	assert.deepEqual(extractGateCommands("CEAL_X=1 node scripts/run-pre-push.ts >> log"), ["node scripts/run-pre-push.ts"]);
	assert.deepEqual(extractGateCommands("node -e 'process.exit(0)'"), [], "an inline program names no script, so it names no gate");
	assert.deepEqual(extractGateCommands("npm run lint && npm test\nnpm run lint"), ["npm run lint", "npm test"]);
	// A command substitution is still a command. Reading only the bare `node`
	// token dropped these, because `status="$(node` is one word.
	assert.deepEqual(extractGateCommands('status="$(node scripts/publish.ts put --key "$k")"'), ['node scripts/publish.ts put --key "$k"']);
	assert.deepEqual(extractGateCommands("out=`npm run build`"), ["npm run build"]);
	// A nested substitution ends the read where it opens; the dangling quote is
	// trimmed so the identity does not carry punctuation the source did not mean.
	assert.deepEqual(extractGateCommands('x="$(node scripts/p.ts --file "$(realpath "$s")")"'), ["node scripts/p.ts --file"]);
	// Positive control: lines the extractor is meant to pass over entirely.
	assert.deepEqual(extractGateCommands("set -eu\ncurl -sSf https://example.invalid -o out"), []);
});

// Runner identity is what S3's attestation compares, and in this repository it
// comes entirely from matrix tables — `check.yml` and `ceal-release.yml` both
// spell `runs-on` as an expression. An unresolved expression would make every
// gate job look like it had no runner at all.
test("a workflow's runners resolve through both matrix spellings", (context) => {
	const scratch = mkdtempSync(path.join(tmpdir(), "ceal-gate-runners-"));
	context.after(() => rmSync(scratch, { recursive: true, force: true }));
	mkdirSync(path.join(scratch, ".github", "workflows"), { recursive: true });
	writeFileSync(
		path.join(scratch, ".github", "workflows", "a.yml"),
		[
			"on: [pull_request]",
			"jobs:",
			"  listed:",
			"    strategy:",
			"      matrix:",
			"        runner: [ubuntu-24.04, macos-15]",
			"    runs-on: ${{ matrix.runner }}",
			"  included:",
			"    strategy:",
			"      matrix:",
			"        include:",
			"          - runner: ubuntu-24.04-arm",
			"    runs-on: ${{ matrix.runner }}",
			"  plain:",
			"    runs-on: ubuntu-latest",
			"    steps:",
			"      - run: npm run check",
			"",
		].join("\n"),
	);
	const workflow = requiredValue(deriveWorkflows(scratch)[0], "derived_workflow");
	assert.deepEqual(workflow.triggers, ["pull_request"], "a list-form `on:` must not be read as string indices");
	assert.deepEqual(
		workflow.jobs.map((job) => [job.id, job.runners]),
		[
			["included", ["ubuntu-24.04-arm"]],
			["listed", ["macos-15", "ubuntu-24.04"]],
			["plain", ["ubuntu-latest"]],
		],
	);
});

// A contract that only ever agrees with itself proves nothing, so the drift it
// is supposed to catch is exercised against a throwaway repository rather than
// demonstrated once by hand and written up.
test("the gate contract goes red when a CI job or a hook command drifts", (context) => {
	const scratch = mkdtempSync(path.join(tmpdir(), "ceal-gate-contract-"));
	context.after(() => rmSync(scratch, { recursive: true, force: true }));
	mkdirSync(path.join(scratch, ".github", "workflows"), { recursive: true });
	mkdirSync(path.join(scratch, ".githooks"), { recursive: true });
	mkdirSync(path.join(scratch, "config"), { recursive: true });
	writeFileSync(path.join(scratch, "package.json"), JSON.stringify({ scripts: { check: "true" } }));
	writeFileSync(path.join(scratch, ".githooks", "pre-push"), "#!/bin/sh\nnpm run check\n");
	const workflow = path.join(scratch, ".github", "workflows", "check.yml");
	writeFileSync(
		workflow,
		"on: [push]\njobs:\n  gate:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run check\n  scope:\n    runs-on: ubuntu-24.04\n    steps: []\n",
	);
	writeFileSync(
		path.join(scratch, "config", "gate-contract.json"),
		JSON.stringify({
			schema: GATE_CONTRACT_SCHEMA,
			repo: "scratch",
			hook_runner: { kind: "githooks", config_path: ".githooks" },
			full_gate_commands: ["npm run check"],
		}),
	);
	writeDerivedContract(scratch);
	assert.deepEqual(collectViolations(scratch), [], "the contract must be green against the tree it was derived from");
	// The nonzero exit is what makes this a gate rather than a report.
	assert.equal(gateContractMain([], scratch), 0, "a green gate must exit zero");

	// Mutation 1: a CI job disappears.
	const original = readFileSync(workflow, "utf8");
	writeFileSync(workflow, original.replace("  scope:\n    runs-on: ubuntu-24.04\n    steps: []\n", ""));
	assert.deepEqual(
		collectViolations(scratch),
		["workflows[path .github/workflows/check.yml].jobs: declares id scope, which this repository no longer has"],
		"removing a CI job must name that job, not the neighbours its removal shifted",
	);
	assert.equal(gateContractMain([], scratch), 1, "a red gate must exit nonzero, or a caller reads it as a pass");
	writeFileSync(workflow, original);
	assert.deepEqual(collectViolations(scratch), []);

	// Mutation 2: a hook grows a command.
	writeFileSync(path.join(scratch, ".githooks", "pre-push"), "#!/bin/sh\nnpm run check\nnpm run lint:shell\n");
	assert.deepEqual(collectViolations(scratch), [
		"hook_tiers[id pre-push].commands[name .githooks/pre-push].gate_commands: this repository has npm run lint:shell, which the contract does not declare",
	]);

	// Mutation 3: the runner identity changes, which the attestation work reads.
	writeFileSync(path.join(scratch, ".githooks", "pre-push"), "#!/bin/sh\nnpm run check\n");
	writeFileSync(workflow, original.replace("  gate:\n    runs-on: ubuntu-24.04", "  gate:\n    runs-on: macos-15"));
	assert.deepEqual(collectViolations(scratch), [
		"workflows[path .github/workflows/check.yml].jobs[id gate].runners: declares ubuntu-24.04, which this repository no longer has",
		"workflows[path .github/workflows/check.yml].jobs[id gate].runners: this repository has macos-15, which the contract does not declare",
	]);
});

// A second installed hook mechanism is the drift the contract cannot describe:
// it would report one of them and stay green about the other.
test("the declared hook runner is an exclusivity claim", () => {
	assert.deepEqual(hookRunnerViolations(ROOT, readContract(ROOT)), []);
	assert.match(
		hookRunnerViolations(ROOT, { hook_runner: { kind: "lefthook", config_path: ".githooks" } }).join("\n"),
		/must be "githooks"/u,
	);
	assert.match(hookRunnerViolations(ROOT, { hook_runner: { kind: "githooks", config_path: "absent" } }).join("\n"), /does not exist/u);
	// Every hand-authored field is checked against its own authority, or it is
	// the unguarded second source of truth the module header disclaims.
	assert.match(
		hookRunnerViolations(ROOT, { hook_runner: { kind: "githooks", config_path: ".githooks", install_command: "npm run renamed" } }).join(
			"\n",
		),
		/install_command names npm run renamed/u,
	);
});

// A renamed gate entrypoint is how a tier quietly stops being anybody's gate.
test("a full-gate command that resolves to nothing is a failure, not a comment", () => {
	assert.deepEqual(fullGateViolations(ROOT, readContract(ROOT)), []);
	assert.match(fullGateViolations(ROOT, { full_gate_commands: ["npm run renamed"] }).join("\n"), /no renamed script/u);
	assert.match(fullGateViolations(ROOT, { full_gate_commands: ["node gone.ts"] }).join("\n"), /no file on disk/u);
	assert.deepEqual(fullGateViolations(ROOT, {}), ["full_gate_commands must name at least one command"]);
});
