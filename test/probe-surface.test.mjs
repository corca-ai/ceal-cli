import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = path.join(ROOT, "scripts", "probe-surface.mjs");

function probe(args) {
	return spawnSync(process.execPath, [GUARD, ...args], { encoding: "utf8", cwd: ROOT });
}

// The incident this guard exists for: `ceal session logout` sat in a list of
// otherwise read-only spot checks and revoked a live Gateway client session.
test("a declared non-read-only route is refused as a probe", () => {
	for (const args of [["ceal", "session", "logout"], ["ceal", "guide", "register", "codex"], ["ceal", "update"], ["cealctl", "connectors", "apply", "--stdin"]]) {
		const result = probe(args);
		assert.equal(result.status, 2, args.join(" "));
		assert.match(result.stderr, /refusing '/u);
		assert.match(result.stderr, /declared effect is (?:local_write|control_write), not read_only/u);
		assert.equal(result.stdout, "", `${args.join(" ")} must not run`);
	}
});

test("help and read-only routes run, always in a throwaway HOME", () => {
	const help = probe(["ceal", "session", "logout", "--help"]);
	assert.equal(help.status, 0);
	assert.match(help.stdout, /^Usage: ceal session logout$/mu);
	assert.match(help.stderr, /throwaway HOME/u);
	const readOnly = probe(["ceal", "capabilities"]);
	assert.match(readOnly.stderr, /effect: read_only.*throwaway HOME/u);
	// An isolated HOME has no session, which is the proof it did not read the
	// operator's own state.
	assert.match(readOnly.stdout, /^status: unavailable$/mu);
});

test("the child's own declared effect decides, not the parent's", () => {
	// `guide` declares read_only_or_local_write; its `status` child is read_only,
	// so the probe runs — resolving the route is what makes the guard precise
	// instead of blocking a whole family.
	const status = probe(["ceal", "guide", "status"]);
	assert.match(status.stderr, /effect: read_only.*throwaway HOME/u);
	assert.match(status.stdout, /^schema_version: ceal\.guide\.v1$/mu);
});

test("the escape hatch is explicit and still isolated", () => {
	const refused = probe(["ceal", "guide", "register", "codex"]);
	assert.equal(refused.status, 2);
	const allowed = probe(["--allow-effect", "local_write", "ceal", "guide", "register", "codex"]);
	assert.match(allowed.stderr, /effect: local_write.*throwaway HOME/u);
	assert.match(allowed.stdout, /^schema_version: ceal\.guide\.v1$/mu);
	// The write landed in the throwaway HOME, never the operator's Codex dir.
	assert.doesNotMatch(allowed.stdout, new RegExp(process.env.HOME.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("an unknown binary or command is refused before spawning", () => {
	for (const args of [["nope", "capabilities"], ["ceal", "not-a-command"], ["ceal"]]) {
		const result = probe(args);
		assert.equal(result.status, 2, args.join(" "));
		assert.equal(result.stdout, "");
	}
});
