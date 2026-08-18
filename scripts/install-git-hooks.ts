#!/usr/bin/env node
// Points this clone's core.hooksPath at the checked-in .githooks directory, so
// the pre-push gate travels with the repository instead of living in one
// maintainer's .git. Re-running is safe and reports what it changed.
//
// `--check` exits non-zero when the hook is not installed, so a gate can ask
// "is this clone actually enforcing the hook?" without mutating anything.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_DIR = path.join(REPO_ROOT, ".githooks");
const RELATIVE_HOOKS_DIR = ".githooks";
const BLAME_IGNORE_FILE = ".git-blame-ignore-revs";
const checkOnly = process.argv.includes("--check");

function git(args: readonly string[]) {
	return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function configuredHooksPath() {
	try {
		return git(["config", "--local", "--get", "core.hooksPath"]);
	} catch {
		// git exits 1 when the key is unset, which is a state, not a failure.
		return "";
	}
}

// The bulk reformat would otherwise attribute most of the tree to itself. GitHub
// reads this file on its own; a local clone has to be told once.
function configureBlameIgnore() {
	if (!existsSync(path.join(REPO_ROOT, BLAME_IGNORE_FILE))) return;
	try {
		git(["config", "--local", "blame.ignoreRevsFile", BLAME_IGNORE_FILE]);
	} catch {
		// Blame ergonomics are not worth failing an install over.
	}
}

if (!existsSync(HOOKS_DIR) || !statSync(HOOKS_DIR).isDirectory()) {
	console.error(`install-git-hooks: ${RELATIVE_HOOKS_DIR}/ is missing; nothing to install.`);
	process.exit(1);
}

const current = configuredHooksPath();

if (checkOnly) {
	// `core.hooksPath` alone is not enforcement. git silently skips a hook it
	// cannot execute — it says so only under `advice.ignoredHook` — and the
	// executable bit is exactly what the restore below exists because it does not
	// survive every checkout path. Answering "installed" on the strength of the
	// config key told a clone in that state that it was enforcing the only gate
	// this repository actually enforces, and a release tag cut there would have
	// run nothing.
	const pushHook = path.join(HOOKS_DIR, "pre-push");
	const executable = existsSync(pushHook) && (statSync(pushHook).mode & 0o100) !== 0;
	if (current === RELATIVE_HOOKS_DIR && executable) {
		console.log(`install-git-hooks: core.hooksPath is ${RELATIVE_HOOKS_DIR} and pre-push is executable (installed).`);
		process.exit(0);
	}
	console.error(
		current === RELATIVE_HOOKS_DIR
			? `install-git-hooks: core.hooksPath is ${RELATIVE_HOOKS_DIR}, but ${RELATIVE_HOOKS_DIR}/pre-push is ${existsSync(pushHook) ? "not executable" : "missing"}.\n` +
					"git skips a hook it cannot execute, so this clone does not run the pre-push gate. Repair it with: npm run hooks:install"
			: `install-git-hooks: core.hooksPath is ${current === "" ? "unset" : current}, expected ${RELATIVE_HOOKS_DIR}.\n` +
					"This clone does not run the pre-push gate. Install it with: npm run hooks:install",
	);
	process.exit(1);
}

// The executable bit does not survive every checkout path (archive exports,
// some Windows clones), so restore it rather than assuming git carried it.
for (const entry of readdirSync(HOOKS_DIR)) {
	const hook = path.join(HOOKS_DIR, entry);
	if (statSync(hook).isFile()) chmodSync(hook, 0o755);
}

if (current === RELATIVE_HOOKS_DIR) {
	configureBlameIgnore();
	console.log(`install-git-hooks: already installed (core.hooksPath=${RELATIVE_HOOKS_DIR}); refreshed hook permissions.`);
	process.exit(0);
}

git(["config", "--local", "core.hooksPath", RELATIVE_HOOKS_DIR]);
configureBlameIgnore();
console.log(
	`install-git-hooks: set core.hooksPath=${RELATIVE_HOOKS_DIR}` +
		(current === "" ? "." : ` (was ${current}).`) +
		"\nPre-push now runs the iteration gate, or the full gate for a tag push.",
);
