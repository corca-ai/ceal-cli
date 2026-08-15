#!/usr/bin/env node
/** Exact-list ratchet for the repository's remaining legacy MJS files. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const POLICY_SCHEMA = "ceal.no_legacy_mjs.v1";
export const DEFAULT_POLICY = "config/no-legacy-mjs.json";
export type GitRunner = (args: string[], cwd: string) => Buffer;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gitBytes: GitRunner = (args, cwd) => execFileSync("git", args, { cwd, encoding: "buffer" });

function nulLines(bytes: Buffer): string[] {
	return bytes.toString("utf8").split("\0").filter(Boolean);
}

function assertPath(file: unknown, context: string): asserts file is string {
	const windowsAbsolute = typeof file === "string" && (/^[A-Za-z]:/u.test(file) || /^\\\\/u.test(file));
	if (
		typeof file !== "string" ||
		file.length === 0 ||
		file.includes("\\") ||
		file.startsWith("/") ||
		windowsAbsolute ||
		file.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
	) {
		throw new Error(`${context} contains a non-normalized path`);
	}
}

export function resolveRepoRoot(requestedRoot: string, runGit: GitRunner = gitBytes): string {
	let requested: string;
	try {
		requested = realpathSync(requestedRoot);
	} catch {
		throw new Error(`repo root is not a readable directory: ${requestedRoot}`);
	}
	let discovered: string;
	try {
		discovered = realpathSync(runGit(["rev-parse", "--show-toplevel"], requestedRoot).toString("utf8").trim());
	} catch {
		throw new Error(`repo root is not a Git worktree: ${requestedRoot}`);
	}
	if (requested !== discovered) throw new Error(`repo root must be the Git worktree root: ${requestedRoot}`);
	return requested;
}

export function readPolicy(policyPath: string): string[] {
	if (!existsSync(policyPath)) throw new Error(`missing policy: ${policyPath}`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(policyPath, "utf8"));
	} catch {
		throw new Error(`malformed policy: ${policyPath}`);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("policy must be an object");
	const record = parsed as Record<string, unknown>;
	if (record.schema_version !== POLICY_SCHEMA || Object.keys(record).some((key) => key !== "schema_version" && key !== "files")) {
		throw new Error("policy has the wrong object shape");
	}
	if (!Array.isArray(record.files) || record.files.some((file) => typeof file !== "string")) throw new Error("policy files must be strings");
	const files = record.files as string[];
	files.forEach((file, index) => {
		assertPath(file, `policy files[${index}]`);
	});
	if (new Set(files).size !== files.length) throw new Error("policy files contain duplicates");
	if (files.some((file, index) => index > 0 && files[index - 1]! >= file)) throw new Error("policy files must be strictly sorted");
	if (files.some((file) => !file.endsWith(".mjs"))) throw new Error("policy files must be .mjs paths");
	return files;
}

export function trackedLegacyMjs(repoRoot: string, runGit: GitRunner = gitBytes): string[] {
	const resolvedRoot = resolveRepoRoot(repoRoot, runGit);
	return trackedLegacyMjsAtRoot(resolvedRoot, runGit);
}

function trackedLegacyMjsAtRoot(repoRoot: string, runGit: GitRunner): string[] {
	const tracked = nulLines(runGit(["ls-files", "-z", "--cached", "--", "*.mjs"], repoRoot));
	const staged = nulLines(runGit(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR", "--", "*.mjs"], repoRoot));
	const files = [...new Set([...tracked, ...staged])];
	files.forEach((file) => {
		assertPath(file, "git output");
	});
	return files.filter((file) => file.endsWith(".mjs")).sort();
}

export function writeBaseline(repoRoot: string, policyPath: string, runGit: GitRunner = gitBytes): string[] {
	const resolvedRoot = resolveRepoRoot(repoRoot, runGit);
	const files = trackedLegacyMjsAtRoot(resolvedRoot, runGit);
	writeFileSync(policyPath, `${JSON.stringify({ schema_version: POLICY_SCHEMA, files }, null, "\t")}\n`);
	return files;
}

export function checkNoLegacyMjs(repoRoot: string, policyPath: string, runGit: GitRunner = gitBytes): string[] {
	const resolvedRoot = resolveRepoRoot(repoRoot, runGit);
	const expected = readPolicy(policyPath);
	const actual = trackedLegacyMjsAtRoot(resolvedRoot, runGit);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		const added = actual.filter((file) => !expected.includes(file));
		const removed = expected.filter((file) => !actual.includes(file));
		throw new Error(`legacy MJS list changed (added: ${added.join(", ") || "none"}; removed: ${removed.join(", ") || "none"})`);
	}
	return actual;
}

export function parseArgs(args: string[]): { write: boolean; repoRoot: string; policyPath: string } {
	let write = false;
	let repoRoot = ROOT;
	let policyPath: string | undefined;
	const seen = new Set<string>();
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]!;
		if (arg === "--write-baseline") {
			if (seen.has(arg)) throw new Error(`duplicate flag: ${arg}`);
			seen.add(arg);
			write = true;
		} else if (arg === "--repo-root" || arg === "--policy") {
			if (seen.has(arg)) throw new Error(`duplicate flag: ${arg}`);
			const value = args[index + 1];
			if (!value || value.startsWith("-")) throw new Error(`missing value for ${arg}`);
			seen.add(arg);
			if (arg === "--repo-root") repoRoot = path.resolve(value);
			else policyPath = path.resolve(value);
			index += 1;
		} else throw new Error(`unknown flag: ${arg}`);
	}
	return { write, repoRoot, policyPath: policyPath ?? path.join(repoRoot, DEFAULT_POLICY) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const options = parseArgs(process.argv.slice(2));
		const files = options.write
			? writeBaseline(options.repoRoot, options.policyPath)
			: checkNoLegacyMjs(options.repoRoot, options.policyPath);
		process.stdout.write(`no-legacy-mjs: ${options.write ? "wrote" : "verified"} ${files.length} files\n`);
	} catch (error) {
		process.stderr.write(`no-legacy-mjs: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
