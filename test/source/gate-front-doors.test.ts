// Every `npm run lint:*` front door in `scripts/` that nothing else loads.
//
// Measured 2026-08-21: these six files had ZERO coverage, because each executes
// at import and calls `process.exit`, so no test could import them and none did.
// Nothing in this repository would have noticed one of them crashing on startup
// — a bad import specifier, a moved lib path, a renamed export — and the failure
// mode is the worst one a gate has: a red exit that reads like a caught
// regression, or a green one from a gate that never ran.
//
// So this asserts the FRONT DOOR contract and deliberately not the verdict: that
// each script starts, resolves its imports, produces its report, and announces
// itself with the summary line it declares. Asserting the verdict would make
// this a second copy of the gate, which would then have to be kept in step with
// it — and a duplicated gate is not a tested gate.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

type FrontDoor = {
	script: string;
	args?: string[];
	env?: NodeJS.ProcessEnv;
	announces: RegExp;
};

const FRONT_DOORS: FrontDoor[] = [
	{ script: "check-duplicate-literal.ts", announces: /check-duplicate-literal: \d+ modules/u },
	{ script: "check-production-reachability.ts", announces: /check-production-reachability: \d+ entries/u },
	{ script: "check-store-lock-census.ts", announces: /check-store-lock-census: \d+ modules considered/u },
	{ script: "check-node-modules-drift.ts", announces: /node_modules drift/u },
	// The ratchet shells out to a python adapter and a `nose` binary that a clone
	// need not have. Its own skip path is the deterministic surface here; running
	// the real detector belongs to the gate, not to a unit test.
	{ script: "check-dup-ratchet.ts", env: { CEAL_SKIP_DUP_RATCHET: "1" }, announces: /dup-ratchet: skipped/u },
	// `--check` is the read-only mode. Without it this script WRITES git config,
	// which is why the flag is passed explicitly rather than defaulted into.
	{ script: "install-git-hooks.ts", args: ["--check"], announces: /install-git-hooks/u },
];

function runFrontDoor({ script, args = [], env = {} }: FrontDoor) {
	return spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", script), ...args], {
		cwd: REPO_ROOT,
		encoding: "utf-8",
		env: { ...process.env, ...env },
	});
}

for (const frontDoor of FRONT_DOORS) {
	test(`${frontDoor.script} starts, reports, and announces itself`, () => {
		const result = runFrontDoor(frontDoor);
		assert.equal(result.error, undefined, `${frontDoor.script} could not be spawned`);
		assert.equal(result.signal, null, `${frontDoor.script} died on ${result.signal}`);
		const output = `${result.stdout}${result.stderr}`;
		// A module-resolution or syntax failure exits 1 with a stack trace and no
		// summary line, which is exactly what an exit-code-only assertion would
		// mistake for a caught regression.
		assert.doesNotMatch(output, /Cannot find (module|package)|ERR_MODULE_NOT_FOUND|SyntaxError/u, `${frontDoor.script} failed to load:\n${output}`);
		assert.match(output, frontDoor.announces, `${frontDoor.script} did not announce itself:\n${output}`);
	});
}

// --- the branch that decides whether a gate runs at all ----------------------
//
// Everything above proves a front door starts. These prove the branch that
// decides whether the check happens, which had no coverage and is the worse
// failure: a gate that silently declines to run reads exactly like one that
// passed.

function runDupRatchet(env: NodeJS.ProcessEnv) {
	return spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "check-dup-ratchet.ts")], { cwd: REPO_ROOT, encoding: "utf-8", env });
}

test("check-dup-ratchet reports a SKIP, never a pass, when no quality skill is available", () => {
	// An explicit dir that is not a quality skill short-circuits the whole
	// resolution chain, so this stays deterministic on a machine that HAS the
	// skill installed — which this one does.
	const notASkill = mkdtempSync(path.join(os.tmpdir(), "ceal-not-a-skill-"));
	const result = runDupRatchet({ ...process.env, CEAL_SKIP_DUP_RATCHET: "0", CHARNESS_QUALITY_SKILL_DIR: notASkill });
	assert.match(`${result.stdout}${result.stderr}`, /dup-ratchet: skipped/u);
	// Exit 0 on purpose, and worth pinning: every skip reason is "this clone
	// cannot run the check", never "the check passed", and a caller must not read
	// the two the same way.
	assert.equal(result.status, 0);
});

test("check-dup-ratchet scans the plugin cache and still skips when it holds no quality skill", () => {
	// A HOME whose plugin cache is version-shaped but holds no quality skill:
	// exercises the cache scan and its version ordering without letting the real
	// detector run, which would be slow and machine-dependent.
	const home = mkdtempSync(path.join(os.tmpdir(), "ceal-fake-home-"));
	const cache = path.join(home, ".claude", "plugins", "cache", "corca-charness", "charness");
	for (const version of ["1.0.0", "1.2.0"]) mkdirSync(path.join(cache, version, "skills", "public", "quality"), { recursive: true });
	const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
	delete env.CHARNESS_QUALITY_SKILL_DIR;
	delete env.SKILL_DIR;
	delete env.CEAL_SKIP_DUP_RATCHET;
	const result = runDupRatchet(env);
	assert.match(`${result.stdout}${result.stderr}`, /dup-ratchet: skipped/u);
	assert.equal(result.status, 0);
});

test("check-node-modules-drift --help prints its usage and exits clean", () => {
	const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "check-node-modules-drift.ts"), "--help"], {
		cwd: REPO_ROOT,
		encoding: "utf-8",
	});
	assert.match(`${result.stdout}${result.stderr}`, /Usage: node scripts\/check-node-modules-drift\.ts/u);
	assert.equal(result.status, 0);
});

test("install-git-hooks --check does not write git config", () => {
	const before = spawnSync("git", ["-C", REPO_ROOT, "config", "--local", "--get", "core.hooksPath"], { encoding: "utf-8" });
	runFrontDoor({ script: "install-git-hooks.ts", args: ["--check"], announces: /./u });
	const after = spawnSync("git", ["-C", REPO_ROOT, "config", "--local", "--get", "core.hooksPath"], { encoding: "utf-8" });
	// The check mode is the only reason this whole file can run in a test at all.
	// Pinning its read-only-ness is what keeps that true.
	assert.equal(after.stdout, before.stdout);
	assert.equal(after.status, before.status);
});
