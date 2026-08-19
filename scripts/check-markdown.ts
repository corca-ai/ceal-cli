#!/usr/bin/env node

// Worker-owned Markdown gate. The Gateway checkout also runs a Charness authoring
// preflight beside markdownlint, but that helper delegates to an upstream-owned
// packaged Charness tree which this repository does not own. This receiving gate
// therefore makes the non-equivalence explicit: it enforces markdownlint only,
// with the same general-document exclusions and a local dependency/config.

import { isMainModule } from "./lib/is-main-module.ts";
import { main as markdownlintCli2Main } from "markdownlint-cli2";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKDOWNLINT_CONFIG = ".markdownlint-cli2.jsonc";
export const MARKDOWN_EXCLUSIONS = ["charness-artifacts/", ".charness/", ".cautilus/", ".pytest_cache/"] as const;

function gitPaths(repoRoot: string, args: readonly string[]): string[] {
	const result = spawnSync("git", [...args], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (result.error || result.status !== 0) {
		throw new Error(`check-markdown: git path listing failed: ${result.error?.message ?? result.stderr.trim()}`);
	}
	return result.stdout.split("\0").filter((entry) => entry.length > 0);
}

export function isGeneralMarkdown(file: string): boolean {
	return file.endsWith(".md") && !MARKDOWN_EXCLUSIONS.some((prefix) => file.startsWith(prefix));
}

export function stagedMarkdownFiles(repoRoot: string = REPO_ROOT): string[] {
	return gitPaths(repoRoot, ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR", "--", "*.md"]).filter(isGeneralMarkdown);
}

export function allMarkdownFiles(repoRoot: string = REPO_ROOT): string[] {
	const tracked = gitPaths(repoRoot, ["ls-files", "-z", "--", "*.md"]);
	const untracked = gitPaths(repoRoot, ["ls-files", "-z", "--others", "--exclude-standard", "--", "*.md"]);
	return [...new Set([...tracked, ...untracked].filter(isGeneralMarkdown))].sort();
}

type MarkdownlintCli2Main = (params: {
	directory: string;
	argv: string[];
	logMessage: (message: string) => void;
	logError: (message: string) => void;
}) => Promise<number>;

async function markdownlint(repoRoot: string, files: readonly string[]): Promise<number> {
	const config = path.join(repoRoot, MARKDOWNLINT_CONFIG);
	if (!existsSync(config)) {
		console.error(`check-markdown: missing local policy ${MARKDOWNLINT_CONFIG}.`);
		return 2;
	}
	if (files.length === 0) {
		console.log("check-markdown: no general-document Markdown requires markdownlint.");
		return 0;
	}
	try {
		return await (markdownlintCli2Main as unknown as MarkdownlintCli2Main)({
			directory: repoRoot,
			argv: ["--config", MARKDOWNLINT_CONFIG, "--no-globs", ...files],
			logMessage: (message) => console.log(message),
			logError: (message) => console.error(message),
		});
	} catch (error) {
		console.error(`check-markdown: could not run markdownlint-cli2 (${error instanceof Error ? error.message : String(error)}).`);
		return 2;
	}
}

export async function main(repoRoot: string = REPO_ROOT, argv: readonly string[] = process.argv.slice(2)): Promise<number> {
	const unknown = argv.filter((arg) => arg !== "--all" && arg !== "--staged");
	if (unknown.length > 0 || (argv.includes("--all") && argv.includes("--staged"))) {
		console.error("Usage: node scripts/check-markdown.ts [--all|--staged]");
		return 2;
	}
	const files = argv.includes("--all") ? allMarkdownFiles(repoRoot) : stagedMarkdownFiles(repoRoot);
	console.log(`check-markdown: ${argv.includes("--all") ? "all" : "staged"} general-document Markdown — ${files.length} file(s).`);
	return markdownlint(repoRoot, files);
}

if (isMainModule(import.meta.url)) {
	main().then(
		(exitCode) => {
			process.exitCode = exitCode;
		},
		(error: unknown) => {
			console.error(`check-markdown: ${error instanceof Error ? error.message : String(error)}`);
			process.exitCode = 2;
		},
	);
}
