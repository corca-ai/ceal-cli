#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SECRET_LINT_BIN = path.join("node_modules", ".bin", "secretlint");
const SECRET_LINT_CONFIG = ".secretlintrc.json";
const SECRET_LINT_IGNORE = ".secretlintignore";
const SYNTHETIC_SLACK_FILES = new Set(["packages/ceal-worker-cli/test/cli.test.ts"]);
const SYNTHETIC_SLACK_ALLOW = `/^${["xoxb", "never", "render"].join("-")}$/`;
const SOURCE_PATHSPECS = ["*.ts", "*.mts", "*.cts", "*.tsx", "*.js", "*.mjs", "*.cjs", "*.jsx", "bin/*"] as const;
const DOCUMENT_PATHSPECS = [".github/**", ".githooks/**", "config/**", "docs/**", "test/**", "packages/**", "scripts/**"] as const;
const ROOT_FILES = [".secretlintrc.json", "package.json", "package-lock.json", "README.md", "CONTRIBUTING.md", "AGENTS.md"] as const;

interface SecretLintRule {
	id: string;
	options?: Record<string, unknown>;
}

interface SecretLintConfig {
	rules?: SecretLintRule[];
	[key: string]: unknown;
}

interface CommandResult {
	status: number | null;
	stdout: string;
	stderr: string;
	error?: Error;
}

interface RunOptions {
	repoRoot?: string;
	staged?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readConfig(repoRoot: string): SecretLintConfig {
	const parsed: unknown = JSON.parse(readFileSync(path.join(repoRoot, SECRET_LINT_CONFIG), "utf8"));
	if (!isRecord(parsed)) throw new Error(`${SECRET_LINT_CONFIG} must contain a JSON object.`);
	const rules = parsed.rules;
	if (!Array.isArray(rules) || !rules.every((rule) => isRecord(rule) && typeof rule.id === "string")) {
		throw new Error(`${SECRET_LINT_CONFIG} must declare a rules array.`);
	}
	return { ...parsed, rules: rules as SecretLintRule[] };
}

export function syntheticSecretlintConfig(repoRoot: string): SecretLintConfig {
	const config = readConfig(repoRoot);
	const rules = config.rules ?? [];
	const slackRule = rules.find((rule) => rule.id === "@secretlint/secretlint-rule-slack");
	if (!slackRule) throw new Error("The synthetic Worker fixture requires the Slack secretlint rule.");
	slackRule.options = { ...(slackRule.options ?? {}), allows: [SYNTHETIC_SLACK_ALLOW] };
	return config;
}

function gitPaths(repoRoot: string, args: readonly string[], pathspecs: readonly string[]): string[] {
	const output = execFileSync("git", [...args, "-z", "--", ...pathspecs], { cwd: repoRoot, encoding: "utf8" });
	return output.split("\0").filter(Boolean);
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

function isSupportedTarget(file: string): boolean {
	if (file === ".secretlintrc.json" || file === "package.json" || file === "package-lock.json") return true;
	return /\.(?:md|json|ts|mts|cts|tsx|js|mjs|cjs|jsx|yml|yaml)$/u.test(file);
}

export function secretlintTargetFiles({ repoRoot = process.cwd(), staged = false }: RunOptions = {}): string[] {
	const paths = staged
		? gitPaths(
				repoRoot,
				["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
				[...SOURCE_PATHSPECS, ...DOCUMENT_PATHSPECS, ...ROOT_FILES],
			)
		: gitPaths(repoRoot, ["ls-files"], [...SOURCE_PATHSPECS, ...DOCUMENT_PATHSPECS, ...ROOT_FILES]);
	return uniqueSorted(paths.filter(isSupportedTarget));
}

export function secretlintRunGroups(files: readonly string[]): { standardFiles: string[]; syntheticFixtureFiles: string[] } {
	const standardFiles: string[] = [];
	const syntheticFixtureFiles: string[] = [];
	for (const file of files) {
		(SYNTHETIC_SLACK_FILES.has(file) ? syntheticFixtureFiles : standardFiles).push(file);
	}
	return { standardFiles, syntheticFixtureFiles };
}

function runSecretlintCommand(repoRoot: string, files: readonly string[], configJSON?: string): CommandResult {
	if (files.length === 0) return { status: 0, stdout: "", stderr: "" };
	const args = [
		"--no-color",
		"--format",
		"compact",
		"--no-glob",
		"--secretlintignore",
		SECRET_LINT_IGNORE,
		...(configJSON === undefined ? ["--secretlintrc", SECRET_LINT_CONFIG] : ["--secretlintrcJSON", configJSON]),
		...files,
	];
	const result = spawnSync(SECRET_LINT_BIN, args, {
		cwd: repoRoot,
		encoding: "utf8",
		maxBuffer: 100 * 1024 * 1024,
	});
	return { status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error };
}

function combineResults(results: readonly CommandResult[]): CommandResult {
	const error = results.find((result) => result.error)?.error;
	return {
		status: error === undefined && results.every((result) => result.status === 0) ? 0 : error === undefined ? 1 : 2,
		stdout: results
			.map((result) => result.stdout)
			.filter(Boolean)
			.join(""),
		stderr: results
			.map((result) => result.stderr)
			.filter(Boolean)
			.join(""),
		error,
	};
}

export function runSecretlint({ repoRoot = process.cwd(), staged = false }: RunOptions = {}): CommandResult {
	const files = secretlintTargetFiles({ repoRoot, staged });
	const { standardFiles, syntheticFixtureFiles } = secretlintRunGroups(files);
	const results: CommandResult[] = [runSecretlintCommand(repoRoot, standardFiles)];
	if (syntheticFixtureFiles.length > 0) {
		results.push(runSecretlintCommand(repoRoot, syntheticFixtureFiles, JSON.stringify(syntheticSecretlintConfig(repoRoot))));
	}
	return combineResults(results);
}

function parseOptions(argv: readonly string[]): RunOptions {
	let repoRoot = process.cwd();
	let staged = false;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--staged") {
			staged = true;
		} else if (argument === "--repo-root") {
			const value = argv[index + 1];
			if (value === undefined) throw new Error("--repo-root requires a path.");
			repoRoot = path.resolve(value);
			index += 1;
		} else {
			throw new Error(`Unknown option: ${argument}`);
		}
	}
	return { repoRoot, staged };
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
	try {
		const options = parseOptions(argv);
		const result = runSecretlint(options);
		if (result.stdout) process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
		if (result.error) process.stderr.write(`secretlint: failed to start: ${result.error.message}\n`);
		return result.status ?? 2;
	} catch (error) {
		process.stderr.write(`secretlint: ${error instanceof Error ? error.message : String(error)}\n`);
		return 2;
	}
}

function isDirectInvocation(): boolean {
	const argvPath = process.argv[1];
	return argvPath !== undefined && import.meta.url === pathToFileURL(path.resolve(argvPath)).href;
}

if (isDirectInvocation()) process.exitCode = main();
