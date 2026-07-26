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
const checkOnly = process.argv.includes("--check");

function git(args) {
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

if (!existsSync(HOOKS_DIR) || !statSync(HOOKS_DIR).isDirectory()) {
	console.error(`install-git-hooks: ${RELATIVE_HOOKS_DIR}/ is missing; nothing to install.`);
	process.exit(1);
}

const current = configuredHooksPath();

if (checkOnly) {
	if (current === RELATIVE_HOOKS_DIR) {
		console.log(`install-git-hooks: core.hooksPath is ${RELATIVE_HOOKS_DIR} (installed).`);
		process.exit(0);
	}
	console.error(
		`install-git-hooks: core.hooksPath is ${current === "" ? "unset" : current}, expected ${RELATIVE_HOOKS_DIR}.\n` +
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
	console.log(`install-git-hooks: already installed (core.hooksPath=${RELATIVE_HOOKS_DIR}); refreshed hook permissions.`);
	process.exit(0);
}

git(["config", "--local", "core.hooksPath", RELATIVE_HOOKS_DIR]);
console.log(
	`install-git-hooks: set core.hooksPath=${RELATIVE_HOOKS_DIR}` +
		(current === "" ? "." : ` (was ${current}).`) +
		"\nPre-push now runs the iteration gate, or the full gate for a tag push.",
);
