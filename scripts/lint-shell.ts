#!/usr/bin/env node
// `npm run lint` is `eslint .`, which sees no shell at all. That was fine
// while shell was incidental here. It is not incidental now: `install-ceal.sh`
// is a signed release asset a customer executes, and `.githooks/pre-push` is the
// last gate before a push — and a defect in the hook's own bookkeeping already
// turned a passing gate into a blocked push once.
//
// Skips loudly rather than failing when `shellcheck` is absent, for the same
// reason as the duplicate ratchet: a macOS runner does not ship it, and a gate
// that no-ops on a host while claiming to have run is worse than one that says
// it stood aside. That makes this maintainer-local enforcement; `AGENTS.md`
// records it as such.
import { exitWith } from "./lib/exit-with.ts";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Two populations, for two different reasons.
//
// `install-ceal.sh` is named: it is one load-bearing signed release asset, and a
// name a reader can check beats a pattern that silently stops matching.
//
// The hooks are DERIVED from `.githooks/`, because naming them had a blind spot
// that a second hook made real. Every file in that directory is a shell hook by
// construction — git executes it — so a hook added without being named here
// would have been the one shell file in the tree nobody linted, and the failure
// mode is silent. The named-inventory guarantee is kept for what it can still
// guarantee: a declared file that disappears is a hard error below.
const NAMED_SHELL_FILES = ["install-ceal.sh"];
const HOOK_DIRECTORY = ".githooks";
const hookFiles = existsSync(path.join(ROOT, HOOK_DIRECTORY))
	? readdirSync(path.join(ROOT, HOOK_DIRECTORY))
			.filter((entry) => statSync(path.join(ROOT, HOOK_DIRECTORY, entry)).isFile())
			.map((entry) => `${HOOK_DIRECTORY}/${entry}`)
			.sort()
	: [];
const SHELL_FILES = [...NAMED_SHELL_FILES, ...hookFiles];

const missing = NAMED_SHELL_FILES.filter((file) => !existsSync(path.join(ROOT, file)));
if (missing.length > 0) {
	// Not a skip: the inventory is wrong, and a lint that quietly checks nothing
	// is the failure this file exists to prevent.
	exitWith("lint-shell", `these declared shell files do not exist: ${missing.join(", ")}`, 2);
}

if (hookFiles.length === 0) {
	// Same reasoning one level up: the derivation's population went empty, so a
	// green run below would mean "no hooks were checked", not "the hooks are
	// clean". `config/gate-contract.json` declares this directory as the hook
	// runner, so an empty one is a broken repository, not a configuration.
	exitWith("lint-shell", `${HOOK_DIRECTORY}/ holds no hook files; the declared hook runner has nothing in it`, 2);
}

if (spawnSync("shellcheck", ["--version"], { stdio: "ignore" }).status !== 0) {
	exitWith("lint-shell", `skipped — shellcheck is not installed; ${SHELL_FILES.length} shell files went unchecked`, 0);
}

// `-s sh`: every file here declares a POSIX-sh shebang, and letting shellcheck
// infer bash would accept bashisms that fail on a dash-based `/bin/sh`.
//
// `--severity=warning` drops the info tier, which here is entirely deliberate
// idiom: `set -- $version` with `IFS=.` is intentional word-splitting to parse a
// semver, and `[ -d "$x" ] && [ ! -L "$x" ] || fail` is a guard whose "C may run
// when A is true" note describes exactly what it is for. Suppressing those one by
// one would put nine directives in a shipped installer to silence style notes on
// correct code. Warning and above still fire — that tier is what found a dead
// variable this file had been assigning since its byte-comparison was removed.
const result = spawnSync("shellcheck", ["-s", "sh", "--severity=warning", ...SHELL_FILES], { cwd: ROOT, stdio: "inherit" });
if (result.error) exitWith("lint-shell", `could not run shellcheck (${result.error.message})`, 2);
// Names, not just a count. The population is derived now, and a count says
// nothing about WHICH files a derivation produced — a derivation returning the
// right number of wrong paths reads identically. It is also what lets a caller
// check the population against `git ls-files` instead of against the same
// `readdirSync` this file used to build it.
if (result.status === 0) process.stderr.write(`lint-shell: ${SHELL_FILES.length} shell files clean: ${SHELL_FILES.join(", ")}\n`);
// A null status means shellcheck died on a signal, which is not a clean run.
// `?? 0` reported one, the way `coverage-scripts.mjs` deliberately does not.
process.exit(result.status ?? 1);
