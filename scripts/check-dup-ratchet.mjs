#!/usr/bin/env node
// Repo-owned front door for the charness quality skill's duplicate ratchet.
//
// The ratchet's policy, detector, and baseline format are the skill's. What this
// repository owns is the answer to "can this clone run it, and what happens when
// it cannot" — and that answer must not be a hardcoded path into one maintainer's
// home directory.
//
// It is deliberately advisory-on-absence and blocking-on-verdict:
//
// - No skill and no `nose` is the normal state of a CI runner and a fresh clone.
//   Failing there would make every push on those hosts red for a reason unrelated
//   to the change, so a missing dependency prints one line and exits 0. That is
//   why this is wired into `.githooks/pre-push` and not into `npm run check`: a
//   gate that no-ops on every CI run while claiming to be part of the gate is a
//   worse lie than an honest maintainer-local one.
// - A skill that IS present and returns a verdict is obeyed exactly. A new
//   duplicate family blocks the push, and the exit code is passed through rather
//   than flattened, so the caller sees which arm fired.
//
// Resolution order, first hit wins: $CHARNESS_QUALITY_SKILL_DIR, then $SKILL_DIR
// when it looks like the quality skill, then the newest versioned plugin cache
// entry, then the charness source checkout. Override the whole thing with
// CEAL_SKIP_DUP_RATCHET=1 when you need the push without it.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { exitWith } from "./lib/exit-with.mjs";

const GATE = path.join("scripts", "check_dup_ratchet.py");

function isQualitySkill(candidate) {
	return Boolean(candidate) && existsSync(path.join(candidate, GATE));
}

// Newest first by semver-ish ordering, so a stale cached plugin version does not
// win over the one the operator actually updated to.
function newestPluginCacheSkill() {
	const root = path.join(os.homedir(), ".claude", "plugins", "cache", "corca-charness", "charness");
	if (!existsSync(root)) return null;
	const versions = readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort((left, right) => compareVersions(right, left));
	for (const version of versions) {
		const candidate = path.join(root, version, "skills", "public", "quality");
		if (isQualitySkill(candidate)) return candidate;
	}
	return null;
}

function compareVersions(left, right) {
	const parse = (value) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const [a, b] = [parse(left), parse(right)];
	for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
		const delta = (a[index] ?? 0) - (b[index] ?? 0);
		if (delta !== 0) return delta;
	}
	return 0;
}

function resolveSkillDir() {
	const explicit = process.env.CHARNESS_QUALITY_SKILL_DIR;
	if (explicit) return isQualitySkill(explicit) ? explicit : null;
	if (isQualitySkill(process.env.SKILL_DIR)) return process.env.SKILL_DIR;
	const cached = newestPluginCacheSkill();
	if (cached) return cached;
	const source = path.join(os.homedir(), ".agents", "src", "charness", "plugins", "charness", "skills", "quality");
	return isQualitySkill(source) ? source : null;
}

// Exit 0: every skip reason is "this clone cannot run the check", never "the
// check passed", and the caller must not treat the two the same way.
function skip(reason) {
	exitWith("dup-ratchet", `skipped — ${reason}`, 0);
}

if (process.env.CEAL_SKIP_DUP_RATCHET === "1") skip("CEAL_SKIP_DUP_RATCHET=1");

const skillDir = resolveSkillDir();
if (!skillDir) skip("no charness quality skill found; set CHARNESS_QUALITY_SKILL_DIR to enable it");

// `nose` is the detector. Without it the skill degrades to advisory anyway, so
// say so here rather than paying a subprocess to be told the same thing.
if (spawnSync("nose", ["--version"], { stdio: "ignore" }).status !== 0) {
	skip("`nose` is not installed; the clone detector is unavailable");
}

const result = spawnSync("python3", [path.join(skillDir, GATE), "--repo-root", "."], {
	stdio: "inherit",
});
if (result.error) skip(`could not run the ratchet (${result.error.message})`);
// A null status means the ratchet died on a signal. `?? 0` called that a pass,
// on the one gate whose whole job is to refuse a regression.
process.exit(result.status ?? 1);
