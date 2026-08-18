#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const SOURCE_PATHSPECS = ["*.ts", "*.mts", "*.cts", "*.tsx", "*.js", "*.mjs", "*.cjs", "*.jsx", "bin/*"] as const;
const REFERENCE_PATHSPECS = [
	".agents/**",
	".github/workflows/*",
	".githooks/**",
	"lefthook.yml",
	"package.json",
	"config/**",
	"scripts/*.sh",
] as const;
const SOURCE_EXTENSIONS = new Set([".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"]);
const LOADER_REWRITE_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
	".js": [".ts", ".tsx"],
	".mjs": [".mts"],
	".cjs": [".cts"],
	".jsx": [".tsx"],
};
const RELATIVE_SPECIFIER = /^\.\.?\//u;
const REFERENCE_PATTERN = /(?:^|[\s"'`=(,])((?:scripts|bin)\/[A-Za-z0-9._/-]+\.(?:mjs|cjs|js|ts|sh))(?![A-Za-z0-9])/gu;

export interface HardFailure {
	kind: "import" | "reference";
	file: string;
	specifier: string;
}

interface ScanDependencies {
	sourceFiles?: readonly string[];
	referenceFiles?: readonly string[];
	readFile?: (absolutePath: string) => string | null;
	fileExists?: (absolutePath: string) => boolean;
}

interface ScanResult {
	failures: HardFailure[];
}

interface RunOptions {
	repoRoot: string;
	staged: boolean;
}

function gitPaths(repoRoot: string, args: readonly string[], pathspecs: readonly string[] = []): string[] {
	const separator = pathspecs.length > 0 ? ["--", ...pathspecs] : [];
	const output = execFileSync("git", [...args, "-z", ...separator], { cwd: repoRoot, encoding: "utf8" });
	return output.split("\0").filter(Boolean);
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

function readFileOrNull(absolutePath: string): string | null {
	try {
		return readFileSync(absolutePath, "utf8");
	} catch {
		return null;
	}
}

function relativeRepoPath(repoRoot: string, absolutePath: string): string | null {
	const relative = path.relative(repoRoot, absolutePath);
	if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
	return relative;
}

function indexFiles(repoRoot: string): Set<string> {
	return new Set(gitPaths(repoRoot, ["ls-files", "--cached"]));
}

function readIndexFile(repoRoot: string, absolutePath: string): string | null {
	const relative = relativeRepoPath(repoRoot, absolutePath);
	if (relative === null) return null;
	try {
		return execFileSync("git", ["cat-file", "blob", `:${relative}`], {
			cwd: repoRoot,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
	} catch {
		return null;
	}
}

function isSourceFile(file: string): boolean {
	if (file.startsWith("bin/")) return !file.includes(".test.");
	return SOURCE_EXTENSIONS.has(path.extname(file));
}

function sourceFilesFor(repoRoot: string, staged: boolean): string[] {
	const tracked = gitPaths(repoRoot, ["ls-files", ...(staged ? ["--cached"] : [])], SOURCE_PATHSPECS);
	return uniqueSorted(tracked.filter(isSourceFile));
}

function referenceFilesFor(repoRoot: string, staged: boolean): string[] {
	const files = gitPaths(repoRoot, ["ls-files", ...(staged ? ["--cached"] : [])], REFERENCE_PATHSPECS);
	return uniqueSorted(files);
}

function isDiagnosticRecord(file: string): boolean {
	return /^config\/typecheck-baseline(?:-ts6)?\.json$/u.test(file);
}

function extractPathReferences(source: string): string[] {
	const references: string[] = [];
	REFERENCE_PATTERN.lastIndex = 0;
	let match = REFERENCE_PATTERN.exec(source);
	while (match !== null) {
		const reference = match[1];
		if (reference !== undefined && !reference.includes("*")) references.push(reference);
		match = REFERENCE_PATTERN.exec(source);
	}
	return references;
}

function scriptKindFor(file: string): ts.ScriptKind {
	if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
	if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
	if (file.endsWith(".js")) return ts.ScriptKind.JS;
	if (file.endsWith(".mjs")) return ts.ScriptKind.JS;
	if (file.endsWith(".cjs")) return ts.ScriptKind.JS;
	return ts.ScriptKind.TS;
}

function extractRuntimeModuleSpecifiers(source: string, file: string): string[] {
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindFor(file));
	const specifiers: string[] = [];
	const add = (node: ts.Node | undefined, typeOnly: boolean): void => {
		if (!typeOnly && node !== undefined && ts.isStringLiteral(node)) specifiers.push(node.text);
	};
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node)) add(node.moduleSpecifier, node.importClause?.isTypeOnly === true);
		if (ts.isExportDeclaration(node)) add(node.moduleSpecifier, node.isTypeOnly === true);
		if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression, false);
		if (ts.isCallExpression(node)) {
			const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
			const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
			if ((isDynamicImport || isRequire) && node.arguments.length === 1) add(node.arguments[0], false);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return specifiers;
}

function loaderRewriteTarget(target: string, fileExists: (absolutePath: string) => boolean): boolean {
	const extension = path.extname(target);
	return (LOADER_REWRITE_CANDIDATES[extension] ?? []).some((candidate) => fileExists(target.slice(0, -extension.length) + candidate));
}

function artifactSourceTarget(target: string, repoRoot: string, fileExists: (absolutePath: string) => boolean): boolean {
	const relative = path.relative(repoRoot, target);
	const parts = relative.split(path.sep);
	const distIndex = parts.indexOf("dist");
	if (distIndex < 0) return false;
	const emitted = parts.slice(distIndex + 1);
	const emittedFile = emitted.at(-1);
	if (emittedFile === undefined) return false;
	const extension = path.extname(emittedFile);
	const candidates = LOADER_REWRITE_CANDIDATES[extension] ?? [];
	const sourceBase = path.join(repoRoot, ...parts.slice(0, distIndex), "src");
	return candidates.some((candidate) =>
		fileExists(path.join(sourceBase, ...emitted.slice(0, -1), `${emittedFile.slice(0, -extension.length)}${candidate}`)),
	);
}

function hasUnresolvableTarget(file: string, specifier: string, repoRoot: string, fileExists: (absolutePath: string) => boolean): boolean {
	if (!RELATIVE_SPECIFIER.test(specifier)) return false;
	const target = path.resolve(repoRoot, path.dirname(file), specifier);
	if (fileExists(target) || artifactSourceTarget(target, repoRoot, fileExists)) return false;
	return !loaderRewriteTarget(target, fileExists);
}

export function scanRepository(repoRoot: string, dependencies: ScanDependencies = {}, staged = false): ScanResult {
	const stagedIndex =
		staged && (dependencies.readFile === undefined || dependencies.fileExists === undefined) ? indexFiles(repoRoot) : undefined;
	const readFile = dependencies.readFile ?? (staged ? (absolutePath: string) => readIndexFile(repoRoot, absolutePath) : readFileOrNull);
	const fileExists =
		dependencies.fileExists ??
		(staged
			? (absolutePath: string) => {
					const relative = relativeRepoPath(repoRoot, absolutePath);
					return relative !== null && stagedIndex?.has(relative) === true;
				}
			: existsSync);
	const sourceFiles = dependencies.sourceFiles ?? sourceFilesFor(repoRoot, staged);
	const referenceFiles = dependencies.referenceFiles ?? referenceFilesFor(repoRoot, staged);
	const failures: HardFailure[] = [];
	for (const file of uniqueSorted(sourceFiles)) {
		const source = readFile(path.join(repoRoot, file));
		if (source === null) continue;
		for (const specifier of extractRuntimeModuleSpecifiers(source, file)) {
			if (hasUnresolvableTarget(file, specifier, repoRoot, fileExists)) failures.push({ kind: "import", file, specifier });
		}
	}
	for (const file of uniqueSorted(referenceFiles).filter((entry) => !isDiagnosticRecord(entry))) {
		const source = readFile(path.join(repoRoot, file));
		if (source === null) continue;
		for (const specifier of extractPathReferences(source)) {
			if (!fileExists(path.join(repoRoot, specifier))) failures.push({ kind: "reference", file, specifier });
		}
	}
	return { failures };
}

function parseOptions(argv: readonly string[]): RunOptions {
	let repoRoot = process.cwd();
	let staged = false;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--staged") staged = true;
		else if (argument === "--repo-root") {
			const value = argv[index + 1];
			if (value === undefined) throw new Error("--repo-root requires a path.");
			repoRoot = path.resolve(value);
			index += 1;
		} else throw new Error(`Unknown option: ${argument}`);
	}
	return { repoRoot, staged };
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
	try {
		const options = parseOptions(argv);
		const result = scanRepository(options.repoRoot, {}, options.staged);
		if (result.failures.length === 0) {
			console.log("import-hard-failures: no unresolvable imports or declared paths.");
			return 0;
		}
		console.error(`import-hard-failures: ${result.failures.length} unresolved path(s):`);
		for (const failure of result.failures) console.error(`  ${failure.kind}: ${failure.file} -> ${failure.specifier}`);
		return 1;
	} catch (error) {
		console.error(`import-hard-failures: ${error instanceof Error ? error.message : String(error)}`);
		return 2;
	}
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main();
