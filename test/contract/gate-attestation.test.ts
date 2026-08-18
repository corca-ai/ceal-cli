// The gate receipt, proven against throwaway repositories rather than this one.
//
// Everything this suite is about is a REFUSAL: the value of an attestation is
// entirely in the cases where it declines to apply, because the case where it
// applies just saves time and the case where it wrongly applies ships a binary
// built from source nothing proved. So every field of the record gets its own
// mutation here, and each one has to produce a named difference — a suite that
// only checked the happy path would stay green if the comparator compared
// nothing at all.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import type { appendFileSync } from "node:fs";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { main as attestationMain, type GateAttestationCliOptions } from "../../scripts/gate-attestation.ts";
import {
	ATTESTATION_ARTIFACT_PREFIX,
	ATTESTED_PROFILE,
	attestationArtifactName,
	attestationDigest,
	buildGateAttestation,
	GATE_ATTESTATION_PATH,
	GATE_ATTESTATION_SCHEMA,
	type GateAttestation,
	gateAttestationDifferences,
	PASS_FAIL_ENV_KEYS,
	RUNNER_IDENTITY_ENV,
	readGateAttestationFile,
	readGateSourceState,
	resolveGateJobs,
	resolveRunnerIdentity,
	serializeGateAttestation,
} from "../../scripts/lib/gate-attestation.ts";
import {
	type ReuseLookupOptions,
	resolveAttestationReuse,
	main as resolverMain,
	SOURCE_WORKFLOW_FILE,
} from "../../scripts/resolve-gate-attestation.ts";
import { scratchTree } from "../scratch-dir.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNNER = "ubuntu-24.04";
const CLEAN_ENV = { [RUNNER_IDENTITY_ENV]: RUNNER, CEAL_REQUIRE_PLATFORM_PROOFS: "1" };

function git(root: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		// A maintainer with `commit.gpgSign` or a global excludesFile would
		// otherwise get a red suite describing their machine, not this code.
		env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
	}).trim();
}

function fixtureRepo(context: TestContext, files: Record<string, string> = {}): string {
	const root = scratchTree(context, "ceal-gate-attestation-", {
		".gitignore": "node_modules/\n.charness/\n",
		"package.json": `${JSON.stringify({ name: "fixture", scripts: { check: "npm run lint && npm test", "check:unit": "npm run lint" } }, null, "\t")}\n`,
		"source.txt": "one\n",
		"node_modules/.package-lock.json": '{"name":"fixture","lockfileVersion":3}\n',
		...files,
	});
	git(root, "init", "--quiet", "-b", "main");
	git(root, "add", "-A");
	git(root, "-c", "user.email=gate@example.invalid", "-c", "user.name=gate", "commit", "--quiet", "-m", "fixture");
	return root;
}

/**
 * A fixture repository plus a captured CLI surface for it. Four suites opened
 * with the same three lines, and the duplicate ratchet named them on the first
 * run; a helper is the honest answer to that, not a classification.
 */
function cliFixture(context: TestContext): { root: string; output: string[]; io: GateAttestationCliOptions } {
	const root = fixtureRepo(context);
	const output: string[] = [];
	return { root, output, io: { repoRoot: root, env: CLEAN_ENV, stdout: (text: string) => output.push(text), stderr: () => {} } };
}

function build(root: string, env: NodeJS.ProcessEnv = CLEAN_ENV): GateAttestation {
	const result = buildGateAttestation({ repoRoot: root, env });
	assert.ok(result.ok, `expected a record, got ${result.ok ? "" : `${result.reason} — ${result.detail}`}`);
	return result.attestation;
}

test("a clean checkout earns a record that names its source, its gate, and its host", (context) => {
	const root = fixtureRepo(context);
	const attestation = build(root);
	assert.equal(attestation.schema, GATE_ATTESTATION_SCHEMA);
	assert.equal(attestation.commit, git(root, "rev-parse", "HEAD"));
	assert.equal(attestation.tree, git(root, "rev-parse", "HEAD^{tree}"));
	assert.equal(attestation.profile, ATTESTED_PROFILE);
	assert.deepEqual(attestation.jobs, ["npm run lint", "npm test"]);
	assert.equal(attestation.runner_identity, RUNNER);
	assert.equal(attestation.node_version, process.version);
	assert.deepEqual(attestation.pass_fail_env, { CEAL_REQUIRE_PLATFORM_PROOFS: "1" });
	assert.match(String(attestation.install_fingerprint), /^[a-f0-9]{64}$/u);
	assert.match(String(attestation.created_at), /^\d{4}-\d{2}-\d{2}T/u);
});

// The tree hash is HEAD's, so it says nothing about a working copy that has
// moved on. Recording anyway would attest a gate run against source that is not
// what any later site would build.
test("a dirty checkout earns no record at all", (context) => {
	const root = fixtureRepo(context);
	writeFileSync(path.join(root, "source.txt"), "two\n");
	const modified = buildGateAttestation({ repoRoot: root, env: CLEAN_ENV });
	assert.equal(modified.ok, false);
	assert.equal(modified.reason, "dirty_checkout");
	assert.match(modified.detail, /source\.txt/u);

	// An untracked file is drift too: it can be the source a suite imported.
	git(root, "checkout", "--", "source.txt");
	writeFileSync(path.join(root, "extra.txt"), "new\n");
	assert.equal(buildGateAttestation({ repoRoot: root, env: CLEAN_ENV }).reason, "dirty_checkout");

	// Ignored paths are not drift: the gate's own build output and the receipt
	// itself live there, so counting them would make every record impossible.
	rmSync(path.join(root, "extra.txt"));
	mkdirSync(path.join(root, ".charness", "quality"), { recursive: true });
	writeFileSync(path.join(root, ".charness", "quality", "junk.json"), "{}\n");
	assert.equal(buildGateAttestation({ repoRoot: root, env: CLEAN_ENV }).ok, true);
});

test("a profile package.json does not declare earns no record", (context) => {
	const root = fixtureRepo(context);
	const unknown = buildGateAttestation({ repoRoot: root, profile: "check:invented", env: CLEAN_ENV });
	assert.equal(unknown.ok, false);
	assert.equal(unknown.reason, "unknown_profile");
	assert.match(unknown.detail, /check:invented/u);
});

test("the digest names the record's identity and ignores its diagnostics", (context) => {
	const root = fixtureRepo(context);
	const attestation = build(root);
	const reordered = Object.fromEntries(Object.entries(attestation).reverse()) as unknown as GateAttestation;
	assert.equal(attestationDigest(reordered), attestationDigest(attestation), "field order must not change the identity");
	assert.equal(
		attestationDigest({ ...attestation, created_at: "1999-01-01T00:00:00.000Z" }),
		attestationDigest(attestation),
		"when the gate ran is diagnostics, not identity",
	);
	assert.equal(attestationArtifactName(attestation), `${ATTESTATION_ARTIFACT_PREFIX}${attestationDigest(attestation)}`);
	assert.match(attestationArtifactName(attestation), /^[\w-]+$/u, "the name is used as an artifact name, which forbids path characters");
});

// One case per field, because a comparator that skipped one field would still
// pass every other case in this file.
test("every identity field is compared, and a difference is named", (context) => {
	const root = fixtureRepo(context);
	const attestation = build(root);
	const mutations: Array<[string, GateAttestation]> = [
		["commit", { ...attestation, commit: "0".repeat(40) }],
		["tree", { ...attestation, tree: "0".repeat(40) }],
		["schema", { ...attestation, schema: "ceal.gate_attestation.v0" }],
		["profile", { ...attestation, profile: "check:unit" }],
		["jobs", { ...attestation, jobs: ["npm run lint"] }],
		["runner_identity", { ...attestation, runner_identity: "macos-15" }],
		["node_version", { ...attestation, node_version: "v0.0.0" }],
		["pass_fail_env", { ...attestation, pass_fail_env: { CEAL_REQUIRE_PLATFORM_PROOFS: "0" } }],
		["install_fingerprint", { ...attestation, install_fingerprint: null }],
	];
	for (const [field, mutated] of mutations) {
		const differences = gateAttestationDifferences(attestation, mutated);
		assert.deepEqual(
			differences.map((line) => line.split(":")[0]),
			[field],
			`${field} must be the only difference reported for a ${field} mutation`,
		);
		assert.notEqual(attestationDigest(mutated), attestationDigest(attestation), `${field} must change the artifact name`);
	}
	assert.deepEqual(gateAttestationDifferences(attestation, attestation), []);
});

test("a record from a producer this run does not know is refused rather than partly compared", (context) => {
	const root = fixtureRepo(context);
	const attestation = build(root);
	const extended = { ...attestation, coverage_floor: 84 };
	assert.deepEqual(
		gateAttestationDifferences(attestation, extended).map((line) => line.split(":")[0]),
		["coverage_floor"],
	);
	for (const shape of [null, "receipt", 7, []]) {
		assert.match(gateAttestationDifferences(attestation, shape)[0], /not a record/u, `${JSON.stringify(shape)} is not a record`);
	}
});

test("a runner declares its identity and a workstation cannot borrow one", () => {
	assert.equal(resolveRunnerIdentity({ [RUNNER_IDENTITY_ENV]: " macos-15 " }), "macos-15");
	for (const empty of [{}, { [RUNNER_IDENTITY_ENV]: "" }, { [RUNNER_IDENTITY_ENV]: "   " }]) {
		assert.match(resolveRunnerIdentity(empty), /^local:/u, "a local host must never present itself as a CI runner label");
	}
});

test("the phase list is the gate's own chain, and an absent gate is an empty one", (context) => {
	const root = fixtureRepo(context);
	assert.deepEqual(resolveGateJobs(root, "check:unit"), ["npm run lint"]);
	assert.deepEqual(resolveGateJobs(root, "nope"), []);
	// This repository's own gate, so a phase added to `npm run check` shows up in
	// the record rather than only in the tree hash.
	assert.ok(resolveGateJobs(ROOT, ATTESTED_PROFILE).includes("npm test"));
});

test("the source state separates the tracked tree from what is merely present", (context) => {
	const root = fixtureRepo(context);
	const clean = readGateSourceState(root);
	assert.deepEqual(clean.dirtyPaths, []);
	writeFileSync(path.join(root, "source.txt"), "two\n");
	assert.deepEqual(readGateSourceState(root).dirtyPaths, ["source.txt"]);
});

// `record` runs inside `postcheck`, so a non-zero exit from it would redden a
// gate that had just passed. Evidence must never be able to do that.
test("recording a receipt never fails the gate that earned it", (context) => {
	const root = fixtureRepo(context);
	const errors: string[] = [];
	const stderr = (text: string) => errors.push(text);

	writeFileSync(path.join(root, "source.txt"), "two\n");
	assert.equal(attestationMain(["record"], { repoRoot: root, env: CLEAN_ENV, stderr }), 0);
	assert.match(errors.join(""), /dirty_checkout/u);

	git(root, "checkout", "--", "source.txt");
	// An unwritable receipt directory is an operability problem, not a gate one.
	mkdirSync(path.join(root, ".charness"), { recursive: true });
	writeFileSync(path.join(root, ".charness", "quality"), "not a directory\n");
	assert.equal(attestationMain(["record"], { repoRoot: root, env: CLEAN_ENV, stderr }), 0);
	assert.match(errors.join(""), /could not write/u);
});

test("a recorded receipt is reusable, and stops being reusable the moment anything moves", (context) => {
	const { root, io } = cliFixture(context);

	assert.equal(attestationMain(["verify"], io), 1, "there is nothing to reuse before a gate has run");
	assert.equal(attestationMain(["record"], io), 0);
	const stored = JSON.parse(readFileSync(path.join(root, GATE_ATTESTATION_PATH), "utf8")) as GateAttestation;
	assert.equal(stored.schema, GATE_ATTESTATION_SCHEMA);
	assert.equal(attestationMain(["verify"], io), 0);

	// Same source, different gate.
	assert.equal(attestationMain(["verify", "--profile", "check:unit"], io), 1);
	// Same source, different host.
	assert.equal(attestationMain(["verify"], { ...io, env: { ...CLEAN_ENV, [RUNNER_IDENTITY_ENV]: "macos-15" } }), 1);
	// Same source and host, weaker proof requested to satisfy a stronger one.
	assert.equal(attestationMain(["verify"], { ...io, env: { ...CLEAN_ENV, CEAL_REQUIRE_PLATFORM_PROOFS: "0" } }), 1);
	// Same everything, new commit.
	writeFileSync(path.join(root, "source.txt"), "two\n");
	git(root, "add", "-A");
	git(root, "-c", "user.email=gate@example.invalid", "-c", "user.name=gate", "commit", "--quiet", "-m", "move");
	assert.equal(attestationMain(["verify"], io), 1);
});

test("publish fails loudly where record stays quiet, and prints what CI has to upload", (context) => {
	const { root, output, io } = cliFixture(context);
	assert.equal(attestationMain(["publish"], io), 1, "a CI checkout with no receipt is a defect, not a fact about the host");

	assert.equal(attestationMain(["record"], io), 0);
	output.length = 0;
	assert.equal(attestationMain(["publish"], io), 0);
	const printed = Object.fromEntries(
		output
			.join("")
			.trim()
			.split("\n")
			.map((line) => line.split("=")),
	);
	assert.equal(printed.artifact_name, attestationArtifactName(build(root)));
	assert.equal(printed.attestation_path, GATE_ATTESTATION_PATH);
	assert.equal(
		Object.keys(printed).length,
		2,
		"publish writes to $GITHUB_OUTPUT, so every stdout line must be a key=value pair a workflow reads",
	);
});

test("the CLI refuses a verb it does not have rather than guessing one", (context) => {
	const { output, io } = cliFixture(context);
	assert.equal(attestationMain(["publishh"], io), 2);
	assert.equal(attestationMain([], io), 2, "a bare invocation must not default into a verb that writes");
	assert.match(output.join(""), /Usage/u);
	assert.equal(attestationMain(["--help"], io), 0);
	assert.equal(attestationMain(["verify", "--help"], io), 0);
});

test("an unreadable receipt is refused, not partly trusted", (context) => {
	const root = fixtureRepo(context);
	mkdirSync(path.join(root, path.dirname(GATE_ATTESTATION_PATH)), { recursive: true });
	const receipt = path.join(root, GATE_ATTESTATION_PATH);
	writeFileSync(receipt, "{ not json\n");
	assert.equal(readGateAttestationFile(receipt).reason, "unreadable_attestation");
	assert.equal(readGateAttestationFile(path.join(root, "absent.json")).reason, "missing_attestation");
	assert.equal(attestationMain(["verify"], { repoRoot: root, env: CLEAN_ENV, stderr: () => {} }), 1);

	writeFileSync(receipt, serializeGateAttestation(build(root)));
	assert.equal(attestationMain(["verify"], { repoRoot: root, env: CLEAN_ENV, stderr: () => {} }), 0);
});

function fakeFetch(routes: Array<[string, unknown]>, calls: string[] = []) {
	const impl = async (input: string | URL | Request) => {
		const url = String(input);
		calls.push(url);
		const route = routes.find(([pattern]) => url.includes(pattern));
		if (!route) return new Response("[]", { status: 404 });
		if (route[1] instanceof Error) throw route[1];
		return new Response(JSON.stringify(route[1]), { status: 200, headers: { "content-type": "application/json" } });
	};
	return impl as unknown as typeof fetch;
}

function ciEnv(root: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	return {
		...CLEAN_ENV,
		GITHUB_REPOSITORY: "corca-ai/ceal-cli",
		GITHUB_TOKEN: "token",
		GITHUB_SHA: git(root, "rev-parse", "HEAD"),
		...extra,
	};
}

test("the release lane reuses a gate only when a green check run carries this exact record", async (context) => {
	const root = fixtureRepo(context);
	const name = attestationArtifactName(build(root, ciEnv(root)));
	const calls: string[] = [];
	const verdict = await resolveAttestationReuse({
		repoRoot: root,
		env: ciEnv(root),
		fetchImpl: fakeFetch(
			[
				[`workflows/${SOURCE_WORKFLOW_FILE}/runs`, { workflow_runs: [{ id: 11 }, { id: 12 }] }],
				["runs/11/artifacts", { artifacts: [{ name: `${ATTESTATION_ARTIFACT_PREFIX}other`, expired: false }] }],
				["runs/12/artifacts", { artifacts: [{ name, expired: false }] }],
			],
			calls,
		),
	});
	assert.equal(verdict.reuse, true);
	assert.equal(verdict.reason, "attested_green");
	assert.equal(verdict.artifactName, name);
	assert.ok(
		calls[0].includes("status=success"),
		"only a green run may be asked for its artifacts; a red run's receipt describes a lane that failed",
	);
});

test("every way the lookup can come up short answers 'run the gate' instead of failing the job", async (context) => {
	const root = fixtureRepo(context);
	const name = attestationArtifactName(build(root, ciEnv(root)));
	const runs: [string, unknown] = [`workflows/${SOURCE_WORKFLOW_FILE}/runs`, { workflow_runs: [{ id: 11 }] }];
	const cases: Array<[string, ReuseLookupOptions]> = [
		["no_green_check_run", { env: ciEnv(root), fetchImpl: fakeFetch([[`workflows/${SOURCE_WORKFLOW_FILE}/runs`, { workflow_runs: [] }]]) }],
		[
			"no_matching_attestation",
			{
				env: ciEnv(root),
				fetchImpl: fakeFetch([runs, ["runs/11/artifacts", { artifacts: [{ name: `${ATTESTATION_ARTIFACT_PREFIX}stale` }] }]]),
			},
		],
		[
			// An expired artifact is a name with nothing behind it. Accepting one
			// would make reuse a property of retention rather than of source.
			"no_matching_attestation",
			{ env: ciEnv(root), fetchImpl: fakeFetch([runs, ["runs/11/artifacts", { artifacts: [{ name, expired: true }] }]]) },
		],
		["no_matching_attestation", { env: ciEnv(root), fetchImpl: fakeFetch([runs, ["runs/11/artifacts", { artifacts: [] }]]) }],
		["lookup_failed", { env: ciEnv(root), fetchImpl: fakeFetch([]) }],
		["lookup_failed", { env: ciEnv(root), fetchImpl: fakeFetch([[`workflows/${SOURCE_WORKFLOW_FILE}/runs`, new Error("socket hang up")]]) }],
		["no_actions_api_credentials", { env: ciEnv(root, { GITHUB_TOKEN: "" }) }],
		["no_actions_api_credentials", { env: ciEnv(root, { GITHUB_REPOSITORY: "" }) }],
		["checkout_is_not_the_run_commit", { env: ciEnv(root, { GITHUB_SHA: "0".repeat(40) }) }],
		["checkout_is_not_the_run_commit", { env: ciEnv(root, { GITHUB_SHA: "" }) }],
		["unknown_profile", { env: ciEnv(root), profile: "check:invented" }],
	];
	for (const [reason, options] of cases) {
		const verdict = await resolveAttestationReuse({ repoRoot: root, ...options });
		assert.equal(verdict.reuse, false, `${reason} must not reuse`);
		assert.equal(verdict.reason, reason);
		assert.ok(verdict.detail.length > 0, `${reason} must say what it saw`);
	}

	// A dirty CI checkout has no record to look up, so there is nothing to name.
	writeFileSync(path.join(root, "source.txt"), "two\n");
	const dirty = await resolveAttestationReuse({ repoRoot: root, env: ciEnv(root), fetchImpl: fakeFetch([]) });
	assert.equal(dirty.reason, "dirty_checkout");
	assert.equal(dirty.artifactName, null);
});

test("a green run is not enough on its own: the query and the artifact both have to be trustworthy", async (context) => {
	const root = fixtureRepo(context);
	const name = attestationArtifactName(build(root, ciEnv(root)));
	const calls: string[] = [];
	const runs: [string, unknown] = [`workflows/${SOURCE_WORKFLOW_FILE}/runs`, { workflow_runs: [{ id: 11 }] }];

	// A pull_request run executes the workflow definition from the PR, so a PR
	// could pick the artifact name its run publishes without running the gate.
	// Only a push run is asked for.
	await resolveAttestationReuse({
		repoRoot: root,
		env: ciEnv(root),
		fetchImpl: fakeFetch([runs, ["runs/11/artifacts", { artifacts: [{ name, expired: false }] }]], calls),
	});
	assert.match(calls[0], /[?&]event=push(&|$)/u, "a pull_request run must not be able to supply the receipt");

	// An artifact that has not said it is live has not said it is live. Every
	// other refusal here costs a gate run; trusting a missing field would not.
	const silentExpiry = await resolveAttestationReuse({
		repoRoot: root,
		env: ciEnv(root),
		fetchImpl: fakeFetch([runs, ["runs/11/artifacts", { artifacts: [{ name }] }]]),
	});
	assert.equal(silentExpiry.reuse, false);
	assert.equal(silentExpiry.reason, "no_matching_attestation");
});

// The whole point of the lookup can evaporate silently: if the two lanes ever
// stop agreeing on a field, every release just pays the gate again and no gate
// anywhere turns red. The run summary is what makes that visible.
test("the lookup says in the run summary whether reuse actually happened", async (context) => {
	const root = fixtureRepo(context);
	const name = attestationArtifactName(build(root, ciEnv(root)));
	const runs: [string, unknown] = [`workflows/${SOURCE_WORKFLOW_FILE}/runs`, { workflow_runs: [{ id: 11 }] }];
	const summaries: string[] = [];
	const appendFile = ((_path: string, text: string) => summaries.push(String(text))) as unknown as typeof appendFileSync;
	const env = ciEnv(root, { GITHUB_STEP_SUMMARY: "/dev/null" });
	const lookup = (lookupEnv: NodeJS.ProcessEnv, routes: Array<[string, unknown]>) =>
		resolverMain({ repoRoot: root, env: lookupEnv, appendFile, fetchImpl: fakeFetch(routes), stdout: () => {}, stderr: () => {} });
	const noRuns: Array<[string, unknown]> = [[`workflows/${SOURCE_WORKFLOW_FILE}/runs`, { workflow_runs: [] }]];

	await lookup(env, [runs, ["runs/11/artifacts", { artifacts: [{ name, expired: false }] }]]);
	await lookup(env, noRuns);
	assert.match(summaries[0], /reused an attested-green run/u);
	assert.match(summaries[1], /re-proved from scratch \(no_green_check_run\)/u);
	for (const line of summaries) assert.match(line, new RegExp(RUNNER, "u"), "the summary must name the runner the verdict is about");

	// No summary file, no summary, and no failure either.
	summaries.length = 0;
	await lookup(ciEnv(root), noRuns);
	assert.deepEqual(summaries, []);
});

test("the lookup writes one line per key and always exits zero", async (context) => {
	const { root, output } = cliFixture(context);
	const code = await resolverMain({
		repoRoot: root,
		env: ciEnv(root),
		fetchImpl: fakeFetch([[`workflows/${SOURCE_WORKFLOW_FILE}/runs`, { workflow_runs: [] }]]),
		stdout: (text: string) => output.push(text),
		stderr: () => {},
	});
	assert.equal(code, 0, "a lookup that cannot answer must cost a gate run, never a burned tag");
	assert.deepEqual(
		output
			.join("")
			.trim()
			.split("\n")
			.map((line) => line.split("=")[0]),
		["reuse", "reason", "artifact_name"],
	);
	assert.match(output.join(""), /reuse=false/u);
});

test("this repository's own gate is the one the receipt describes", () => {
	// The suites above all run against fixtures, which cannot notice a rename of
	// the real gate or of the workflow the release lane queries.
	const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
	assert.equal(manifest.scripts.postcheck, "node scripts/gate-attestation.ts record");
	assert.ok(ATTESTED_PROFILE in manifest.scripts, "the attested profile must be a script this repository has");
	assert.deepEqual(PASS_FAIL_ENV_KEYS, ["CEAL_REQUIRE_PLATFORM_PROOFS"]);
	assert.ok(
		readFileSync(path.join(ROOT, ".github", "workflows", SOURCE_WORKFLOW_FILE), "utf8").includes("gate-attestation.ts publish"),
		"the workflow the release lane queries must be the one that uploads receipts",
	);
});

test("the pre-push hook asks for the receipt before it spends the full gate", () => {
	const hook = readFileSync(path.join(ROOT, ".githooks", "pre-push"), "utf8");
	const guard = /if node scripts\/gate-attestation\.ts verify; then\n(?:.*\n)*?\telse\n\t\trun_phase "tag push[^"]*" npm run check\n/u;
	assert.match(hook, guard, "the full gate must be the else branch of the receipt check, so a refusal always runs it");
	assert.doesNotMatch(hook, /gate-attestation\.ts (?:record|publish)/u, "the hook must not write receipts; postcheck owns that");
});
