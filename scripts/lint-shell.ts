#!/usr/bin/env node
// `npm run lint` is `biome check .`, which sees no shell at all. That was fine
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
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { exitWith } from "./lib/exit-with.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Named, not globbed: every shell file here is load-bearing and few, so an
// inventory a reader can check beats a pattern that silently stops matching.
const SHELL_FILES = ["install-ceal.sh", ".githooks/pre-push"];

const missing = SHELL_FILES.filter((file) => !existsSync(path.join(ROOT, file)));
if (missing.length > 0) {
	// Not a skip: the inventory is wrong, and a lint that quietly checks nothing
	// is the failure this file exists to prevent.
	exitWith("lint-shell", `these declared shell files do not exist: ${missing.join(", ")}`, 2);
}

if (spawnSync("shellcheck", ["--version"], { stdio: "ignore" }).status !== 0) {
	exitWith("lint-shell", `skipped — shellcheck is not installed; ${SHELL_FILES.length} shell files went unchecked`, 0);
}

// `-s sh`: both files declare `#!/usr/bin/env sh`, and letting shellcheck infer
// bash would accept bashisms that fail on a dash-based `/bin/sh`.
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
if (result.status === 0) process.stderr.write(`lint-shell: ${SHELL_FILES.length} shell files clean\n`);
// A null status means shellcheck died on a signal, which is not a clean run.
// `?? 0` reported one, the way `coverage-scripts.mjs` deliberately does not.
process.exit(result.status ?? 1);
