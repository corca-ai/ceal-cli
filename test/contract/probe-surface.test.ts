import { CEAL_AGENT_HOST_ENVIRONMENT_VARIABLES } from "../../packages/ceal-worker-cli/dist/agent-guide.js";
import { CEAL_SUBCOMMANDS } from "../../packages/ceal-worker-cli/dist/subcommands.js";
import { isAgentHostEnvironmentVariables, isSplitSubcommandResult, lookupProbeBinary } from "../../scripts/probe-surface-contract.ts";
import { requiredCapture } from "../required.ts";
import assert from "node:assert/strict";
import { spawnSync,type SpawnSyncReturns } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Contract tier, not release: this needs only `npm run build`, and the guard it
// proves exists to stop a destructive probe — so the pre-push hook is exactly
// where it belongs. It paid the release tier's serialized tax for 2.0s of work.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = path.join(ROOT, "scripts", "probe-surface.ts");

type ProbeResult = SpawnSyncReturns<string>;
type Probe = (args: string[], environment?: NodeJS.ProcessEnv) => ProbeResult;

function probe(args: string[]): ProbeResult {
	return spawnSync(process.execPath, [GUARD, ...args], { encoding: "utf8", cwd: ROOT });
}

function withProbeEnvironment(run: (probe: Probe) => void): void {
	run(
		(args: string[], environment?: NodeJS.ProcessEnv): ProbeResult =>
			spawnSync(process.execPath, [GUARD, ...args], { encoding: "utf8", cwd: ROOT, env: { ...process.env, ...environment } }),
	);
}

function registrationPaths(stdout: string): string[] {
	return [...stdout.matchAll(/^\s*registration_path: (.+)$/gmu)].map((match) => requiredCapture(match, 1, "registration_path"));
}

// The incident this guard exists for: `ceal session logout` sat in a list of
// otherwise read-only spot checks and revoked a live Gateway client session.
test("a declared non-read-only route is refused as a probe", () => {
	for (const args of [
		["ceal", "session", "logout"],
		["ceal", "session", "refresh"],
		["ceal", "guide", "register", "codex"],
		["ceal", "update"],
	]) {
		const result = probe(args);
		assert.equal(result.status, 2, args.join(" "));
		assert.match(result.stderr, /refusing '/u);
		assert.match(result.stderr, /declared effect is (?:local_write|remote_write|control_write), not read_only/u);
		assert.equal(result.stdout, "", `${args.join(" ")} must not run`);
	}
});

// `call` is the route that executes a governed provider capability, and it
// declared `read_only` until the vocabulary grew a term for a change that does
// not happen on this machine. The guard admitted it for exactly as long as the
// declaration lied, which is the whole point of deriving the guard from the
// declaration: it is only ever as right as the field it reads.
test("the route that reaches a provider is refused, and no flag opens it", () => {
	const refused = probe(["ceal", "call", "message.search", "--target", `target:${"a".repeat(64)}`]);
	assert.equal(refused.status, 2);
	assert.match(refused.stderr, /declared effect is remote_write, not read_only/u);
	assert.equal(refused.stdout, "");

	// The escape hatch's safety argument is the throwaway HOME, and that covers
	// local state only. Offering it here would read as "retry with a flag" for
	// the one class of route where retrying is the mistake.
	for (const args of [
		["--allow-effect", "remote_write", "ceal", "call", "message.search"],
		["--allow-effect", "remote_write", "ceal", "session", "logout"],
	]) {
		const hatched = probe(args);
		assert.equal(hatched.status, 2, args.join(" "));
		assert.match(hatched.stderr, /--allow-effect remote_write is refused/u);
		assert.match(hatched.stderr, /cannot undo a Gateway or provider change/u);
		assert.equal(hatched.stdout, "");
	}

	// And the refusal must not advertise a hatch this guard would then refuse.
	assert.doesNotMatch(refused.stderr, /Pass --allow-effect/u);
	assert.match(refused.stderr, /Run the installed binary directly/u);
});

test("help and read-only routes run, always in a throwaway HOME", () => {
	const help = probe(["ceal", "session", "logout", "--help"]);
	assert.equal(help.status, 0);
	assert.match(help.stdout, /^Usage: ceal session logout$/mu);
	assert.match(help.stderr, /throwaway HOME/u);
	const readOnly = probe(["ceal", "session", "status"]);
	assert.match(readOnly.stderr, /effect: read_only.*throwaway HOME/u);
	// An isolated HOME has no session, which is the proof it did not read the
	// operator's own state.
	assert.match(readOnly.stdout, /^status: unconfigured$/mu);
	const readOnlyRoutes: Array<[string[], string]> = [
		[["ceal", "receipt", "show", "ceal:prior:call"], "ceal.receipt.v1"],
		[["ceal", "acceptance", "emit"], "ceal.worker_acceptance_result.v2"],
	];
	for (const [args, schema] of readOnlyRoutes) {
		const result = probe(args);
		assert.match(result.stderr, /effect: read_only.*throwaway HOME/u, args.join(" "));
		assert.match(result.stdout, new RegExp(`^schema_version: ${schema.replaceAll(".", "\\.")}$`, "mu"), args.join(" "));
	}
});

test("a read-only route that serves until interrupted is refused before spawning", () => {
	const refused = probe(["ceal", "observe", "--port", "0"]);
	assert.equal(refused.status, 2);
	assert.equal(refused.stdout, "");
	assert.match(refused.stderr, /declared lifecycle is until_interrupted/u);
	assert.match(refused.stderr, /would not settle/u);

	const help = probe(["ceal", "observe", "--help"]);
	assert.equal(help.status, 0, help.stderr);
	assert.match(help.stdout, /^Lifecycle: until_interrupted$/mu);
});

test("the child's own declared effect decides, not the parent's", () => {
	// `guide` declares read_only_or_local_write; its `status` child is read_only,
	// so the probe runs — resolving the route is what makes the guard precise
	// instead of blocking a whole family.
	const status = probe(["ceal", "guide", "status"]);
	assert.match(status.stderr, /effect: read_only.*throwaway HOME/u);
	assert.match(status.stdout, /^schema_version: ceal\.guide\.v1$/mu);

	// The session parent is remote_write because some children enroll or revoke,
	// while this explicit local summary is safe to probe in isolation.
	const sessionStatus = probe(["ceal", "session", "status"]);
	assert.match(sessionStatus.stderr, /effect: read_only.*throwaway HOME/u);
	assert.match(sessionStatus.stdout, /^schema_version: ceal\.client_session\.v1$/mu);
	assert.match(sessionStatus.stdout, /^status: unconfigured$/mu);

	// Bare aliases are not a second dispatch-only fact: both parents declare
	// status as their default leaf, so the sanctioned probe reaches the same
	// read-only route the binary does.
	const bareRoutes: Array<[string[], string]> = [
		[["ceal", "guide"], "ceal.guide.v1"],
		[["ceal", "session"], "ceal.client_session.v1"],
	];
	for (const [args, schema] of bareRoutes) {
		const bare = probe(args);
		assert.notEqual(bare.status, 2, bare.stderr);
		assert.match(bare.stderr, /effect: read_only.*throwaway HOME/u);
		assert.match(bare.stdout, new RegExp(`^schema_version: ${schema.replaceAll(".", "\\.")}$`, "mu"));
	}
});

test("the escape hatch is explicit and still isolated", () => {
	const refused = probe(["ceal", "guide", "register", "codex"]);
	assert.equal(refused.status, 2);
	withProbeEnvironment((run: Probe) => {
		const allowed = run(["--allow-effect", "local_write", "ceal", "guide", "register", "codex"]);
		assert.match(allowed.stderr, /effect: local_write.*throwaway HOME/u);
		assert.match(allowed.stdout, /^schema_version: ceal\.guide\.v1$/mu);
		// The registration actually happened, so the path below is a real write
		// target rather than the shape of a failure document.
		assert.match(allowed.stdout, /^status: available$/mu);
		assert.match(allowed.stdout, /^ {4}registered: true$/mu);
		// The write landed in the throwaway HOME, never the operator's Codex dir.
		for (const reported of registrationPaths(allowed.stdout)) assert.match(reported, /ceal-probe-home-/u);
	});
});

// An agent-host override defaults to a path under HOME, so a negative assertion
// against HOME cannot prove the override itself is pinned. Point every declared
// override at a sentinel the throwaway HOME can never contain, and assert the
// reported paths positively. Deriving the set from the host table is what makes
// a newly declared host with an unpinned variable fail here rather than in an
// operator's real state.
test("an inherited agent-host override cannot aim a probed write at real state", () => {
	// Unique per run and swept afterwards: a sentinel left behind by a failing
	// run must not turn the next run's "was never created" claim into a stale
	// failure that outlives the defect.
	const sentinel = path.join(tmpdir(), `ceal-probe-sentinel-agent-host-${process.pid}`);
	assert.ok(CEAL_AGENT_HOST_ENVIRONMENT_VARIABLES.length > 0);
	const overrides = Object.fromEntries(CEAL_AGENT_HOST_ENVIRONMENT_VARIABLES.map((variable) => [variable, sentinel]));
	try {
		withProbeEnvironment((run: Probe) => {
			// Only the agent-host overrides are set. The guard also pins
			// XDG_RUNTIME_DIR, but no guide route reads it, so including it here
			// would assert nothing while looking like coverage — the exact shape of
			// the defect this test was rewritten to remove.
			const result = run(["--allow-effect", "local_write", "ceal", "guide", "register", "claude"], overrides);
			assert.match(result.stdout, /^status: available$/mu);
			assert.doesNotMatch(result.stdout, new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
			const reported = registrationPaths(result.stdout);
			// Every declared host reports a path, and every one of them is throwaway.
			assert.equal(reported.length, CEAL_AGENT_HOST_ENVIRONMENT_VARIABLES.length);
			for (const host of reported) assert.match(host, /ceal-probe-home-/u);
			// The strongest form of the claim: the sentinel tree was never created.
			assert.equal(existsSync(sentinel), false);
		});
	} finally {
		rmSync(sentinel, { recursive: true, force: true });
	}
});

test("an unknown binary or command is refused before spawning", () => {
	for (const args of [["nope", "capabilities"], ["ceal", "not-a-command"], ["ceal"]]) {
		const result = probe(args);
		assert.equal(result.status, 2, args.join(" "));
		assert.equal(result.stdout, "");
	}
});

test("probe declaration contracts reject path escapes and malformed routes", () => {
	assert.equal(isAgentHostEnvironmentVariables(CEAL_AGENT_HOST_ENVIRONMENT_VARIABLES), true);
	for (const variables of [["../outside"], ["A/B"], [""], ["SAFE", "SAFE"]]) {
		assert.equal(isAgentHostEnvironmentVariables(variables), false, variables.join(","));
	}

	const valid = CEAL_SUBCOMMANDS.find((entry) => entry.parent === "guide" && entry.route[0] === "status");
	assert.ok(valid);
	assert.equal(isSplitSubcommandResult({ subcommand: valid, rest: [] }, "guide"), true);
	assert.equal(isSplitSubcommandResult({ subcommand: { ...valid, parent: "session" }, rest: [] }, "guide"), false);
	assert.equal(isSplitSubcommandResult({ subcommand: { ...valid, route: [] }, rest: [] }, "guide"), false);
	assert.equal(isSplitSubcommandResult({ subcommand: { ...valid, route: ["../outside"] }, rest: [] }, "guide"), false);
	assert.equal(isSplitSubcommandResult({ subcommand: { ...valid, route: ["bad/route"] }, rest: [] }, "guide"), false);
	const binaries = { ceal: "primary", second: "secondary" };
	assert.equal(lookupProbeBinary(binaries, "ceal"), "primary");
	assert.equal(lookupProbeBinary(binaries, "second"), "secondary");
	for (const key of ["unknown", "toString", "__proto__"]) assert.equal(lookupProbeBinary(binaries, key), undefined, key);
});
