#!/usr/bin/env node

// A raw NUL byte makes a source file invisible to recursive text searches on
// this host. Keep the source spelling portable and let binary-input fixtures
// live in data files instead.

import { isMainModule } from "./lib/is-main-module.ts";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const NUL = String.fromCharCode(0);
const SOURCE_GLOBS = ["*.mjs", "*.cjs", "*.js", "*.ts", "*.tsx", "*.py", "*.sh"];
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

type ReadFile = (absolutePath: string) => string | null;
type ListFiles = (repoRoot: string) => readonly string[];
export type SourceNulFinding = { file: string; line: number };

function gitLines(repoRoot: string, args: readonly string[]): string[] {
	return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER })
		.split("\n")
		.filter((line) => line.length > 0);
}

export function findSourceNulBytes(
	repoRoot: string,
	listFiles: ListFiles = defaultListFiles,
	readFile: ReadFile = defaultReadFile,
): SourceNulFinding[] {
	const findings: SourceNulFinding[] = [];
	for (const file of listFiles(repoRoot)) {
		const text = readFile(path.join(repoRoot, file));
		if (text === null || !text.includes(NUL)) continue;
		for (const [index, line] of text.split("\n").entries()) {
			if (line.includes(NUL)) findings.push({ file, line: index + 1 });
		}
	}
	return findings;
}

function defaultListFiles(repoRoot: string): string[] {
	return gitLines(repoRoot, ["ls-files", "--", ...SOURCE_GLOBS]);
}

// The normal scan cannot see a new file until after it is committed. The
// commit hook therefore reads the index, which is the content the commit will
// actually record.
function stagedListFiles(repoRoot: string): string[] {
	return gitLines(repoRoot, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "--", ...SOURCE_GLOBS]);
}

function defaultReadFile(absolutePath: string): string | null {
	try {
		return readFileSync(absolutePath, "utf8");
	} catch {
		return null;
	}
}

function stagedReadFile(repoRoot: string): ReadFile {
	return (absolutePath) => {
		const file = path.relative(repoRoot, absolutePath);
		try {
			return execFileSync("git", ["show", ":" + file], { cwd: repoRoot, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER });
		} catch {
			return null;
		}
	};
}

function repoRootFromArgv(argv: readonly string[]): string {
	const index = argv.indexOf("--repo-root");
	return index === -1 ? process.cwd() : (argv[index + 1] ?? process.cwd());
}

function main(argv: readonly string[]): number {
	const repoRoot = repoRootFromArgv(argv);
	const staged = argv.includes("--staged");
	const findings = staged ? findSourceNulBytes(repoRoot, stagedListFiles, stagedReadFile(repoRoot)) : findSourceNulBytes(repoRoot);
	if (findings.length === 0) {
		console.log(staged ? "No raw NUL bytes in staged source." : "No raw NUL bytes in tracked source.");
		return 0;
	}
	console.error("Tracked source must not carry a raw NUL byte -- recursive text searches skip the whole file silently:");
	for (const finding of findings) console.error("- " + finding.file + ":" + finding.line);
	console.error("Spell it as the source escape instead; the runtime string is identical.");
	return 1;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
