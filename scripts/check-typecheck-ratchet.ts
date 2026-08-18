#!/usr/bin/env node
/**
 * TypeScript 7 failure ratchet.
 *
 * The compiler remains the source of truth: this wrapper only records the
 * deterministic shape of its current errors and refuses new files or codes.
 * A baseline is changed deliberately with --write-baseline, never as a side
 * effect of a normal lint run.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isJsonRecord as isRecord } from "../packages/ceal-worker-cli/src/json-record.ts";

export type ProjectName = "packages" | "tools" | "tests";

type TypecheckCounts = {
	files: string[];
	diagnosticsByFile: Record<string, Record<string, number>>;
};

export type TypecheckSnapshot = TypecheckCounts & {
	unparsed: string[];
};

type BaselineProject = {
	config: string;
	files: string[];
	diagnosticsByFile: Record<string, Record<string, number>>;
};

export type TypecheckBaseline = {
	version: 1;
	compiler: "typescript@7";
	projects: Record<ProjectName, BaselineProject>;
};

export const PROJECTS: Record<ProjectName, string> = {
	packages: "tsconfig.typecheck.json",
	tools: "tsconfig.tools.json",
	tests: "tsconfig.tests.json",
};

const PROJECT_ENTRIES: Array<[ProjectName, string]> = [
	["packages", PROJECTS.packages],
	["tools", PROJECTS.tools],
	["tests", PROJECTS.tests],
];

export const BASELINE_PATH = "charness-artifacts/quality/typecheck-ratchet-baseline.json";

const TYPE_QUOTED = "'(?:[^\\r\\n']|'(?!\\s*[.]))+'";
const TYPE_EXPRESSION = `(?:${TYPE_QUOTED}|\\{[^\\r\\n]*\\}|[A-Za-z][^\\r\\n]*)`;
const IDENTIFIER = "'[^'\\r\\n]+'";

export function isKnownContinuation(line: string): boolean {
	if (!/^\s{2,}/u.test(line)) return false;
	const text = line.trimStart();
	return [
		new RegExp(`^Argument of type ${TYPE_EXPRESSION} is not assignable to parameter of type ${TYPE_EXPRESSION}[.]$`, "u"),
		new RegExp(`^No index signature with a parameter of type ${TYPE_EXPRESSION} was found on type ${TYPE_EXPRESSION}[.]$`, "u"),
		new RegExp(`^Not all constituents of type ${TYPE_EXPRESSION} are callable[.]$`, "u"),
		new RegExp(`^Property ${IDENTIFIER} does not exist on type ${TYPE_EXPRESSION}[.]$`, "u"),
		/^Target signature provides too few arguments[.] Expected \d+ or more, but got \d+[.]$/u,
		/^The last overload gave the following error[.]$/u,
		new RegExp(`^The types of (?:property ${IDENTIFIER}|${IDENTIFIER}) are incompatible(?: between these types)?[.]$`, "u"),
		/^The types returned by [^\r\n]+ are incompatible(?: between these types)?[.]$/u,
		new RegExp(
			`^Type ${TYPE_EXPRESSION} (?:has no call signatures|is not assignable to (?:type|parameter of type) ${TYPE_EXPRESSION})[.]$`,
			"u",
		),
		new RegExp(`^Types of property ${IDENTIFIER} are incompatible[.]$`, "u"),
	].some((pattern) => pattern.test(text));
}

function normalizeFile(root: string, value: string): string {
	const absolute = path.isAbsolute(value) ? value : path.resolve(root, value);
	return path.relative(root, absolute).split(path.sep).join("/");
}

export function parseDiagnostics(output: string, root: string): TypecheckSnapshot {
	const files = new Set<string>();
	const diagnosticsByFile: Record<string, Record<string, number>> = {};
	const unparsed: string[] = [];
	let allowCompilerContinuation = false;
	for (const line of output.split(/\r?\n/u)) {
		const match = line.match(/^(.*)\(\d+,\d+\): error (TS\d+):/u);
		if (!match) {
			const knownTypeScriptContinuation = isKnownContinuation(line);
			if (line.length > 0 && !(allowCompilerContinuation && knownTypeScriptContinuation)) unparsed.push(line);
			if (!knownTypeScriptContinuation) allowCompilerContinuation = false;
			continue;
		}
		allowCompilerContinuation = true;
		const file = normalizeFile(root, match[1]);
		files.add(file);
		const fileDiagnostics = diagnosticsByFile[file] ?? {};
		diagnosticsByFile[file] = fileDiagnostics;
		fileDiagnostics[match[2]] = (fileDiagnostics[match[2]] ?? 0) + 1;
	}
	return {
		files: [...files].sort(),
		diagnosticsByFile: Object.fromEntries(
			Object.entries(diagnosticsByFile)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([file, diagnostics]) => [file, Object.fromEntries(Object.entries(diagnostics).sort(([a], [b]) => a.localeCompare(b)))]),
		),
		unparsed,
	};
}

export function ratchetViolations(baseline: TypecheckCounts, current: TypecheckCounts): string[] {
	const violations: string[] = [];
	const allowedFiles = new Set(baseline.files);
	for (const file of current.files) {
		if (!allowedFiles.has(file)) violations.push(`new failing file: ${file}`);
	}
	const allFiles = new Set([...baseline.files, ...current.files]);
	for (const file of allFiles) {
		const baselineCodes = baseline.diagnosticsByFile[file] ?? {};
		const currentCodes = current.diagnosticsByFile[file] ?? {};
		const allCodes = new Set([...Object.keys(baselineCodes), ...Object.keys(currentCodes)]);
		for (const code of allCodes) {
			const baselineCount = baselineCodes[code] ?? 0;
			const currentCount = currentCodes[code] ?? 0;
			if (currentCount > baselineCount) violations.push(`diagnostic ${file}::${code}: ${currentCount} > baseline ${baselineCount}`);
			if (currentCount < baselineCount)
				violations.push(`baseline_reduction_required ${file}::${code}: ${currentCount} < baseline ${baselineCount}`);
		}
	}
	return violations.sort();
}

function readBaseline(root: string): TypecheckBaseline {
	const value: unknown = JSON.parse(readFileSync(path.join(root, BASELINE_PATH), "utf8"));
	return validateBaseline(value);
}

export function validateBaseline(value: unknown): TypecheckBaseline {
	if (!isRecord(value) || value.version !== 1 || value.compiler !== "typescript@7" || !isRecord(value.projects)) {
		throw new Error("invalid typecheck ratchet baseline header");
	}
	const projectNames = PROJECT_ENTRIES.map(([name]) => name).sort();
	if (JSON.stringify(Object.keys(value.projects).sort()) !== JSON.stringify(projectNames))
		throw new Error("invalid typecheck ratchet project keys");
	const projects: Record<ProjectName, BaselineProject> = {
		packages: validateProject(value.projects.packages, PROJECTS.packages, "packages"),
		tools: validateProject(value.projects.tools, PROJECTS.tools, "tools"),
		tests: validateProject(value.projects.tests, PROJECTS.tests, "tests"),
	};
	return { version: 1, compiler: "typescript@7", projects };
}

function validateProject(value: unknown, config: string, name: ProjectName): BaselineProject {
	if (!isRecord(value) || value.config !== config || !isStringArray(value.files) || !isRecord(value.diagnosticsByFile)) {
		throw new Error(`invalid typecheck ratchet project: ${name}`);
	}
	const files = value.files;
	if (files.some((file) => file.length === 0 || file.startsWith("/") || file.split("/").includes("..") || file.includes("\\"))) {
		throw new Error(`non-portable baseline path: ${name}`);
	}
	if (JSON.stringify(files) !== JSON.stringify([...files].sort())) throw new Error(`unsorted baseline files: ${name}`);
	const rawDiagnostics = value.diagnosticsByFile;
	const diagnosticFiles = Object.keys(rawDiagnostics);
	if (JSON.stringify(diagnosticFiles) !== JSON.stringify([...diagnosticFiles].sort()))
		throw new Error(`unsorted baseline diagnostics: ${name}`);
	if (JSON.stringify(diagnosticFiles) !== JSON.stringify(files)) throw new Error(`baseline files do not match diagnostics: ${name}`);
	const diagnosticsByFile: Record<string, Record<string, number>> = {};
	for (const file of files) {
		const rawFileDiagnostics = rawDiagnostics[file];
		if (!isRecord(rawFileDiagnostics)) throw new Error(`invalid baseline diagnostics: ${name}/${file}`);
		const codes = Object.keys(rawFileDiagnostics);
		if (JSON.stringify(codes) !== JSON.stringify([...codes].sort())) throw new Error(`unsorted baseline codes: ${name}/${file}`);
		const diagnostics: Record<string, number> = {};
		for (const code of codes) {
			const count = rawFileDiagnostics[code];
			if (!/^TS\d+$/u.test(code) || typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) {
				throw new Error(`invalid baseline count: ${name}/${file}/${code}`);
			}
			diagnostics[code] = count;
		}
		diagnosticsByFile[file] = diagnostics;
	}
	return { config, files, diagnosticsByFile };
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function emptyBaseline(): TypecheckBaseline {
	return {
		version: 1,
		compiler: "typescript@7",
		projects: {
			packages: { config: PROJECTS.packages, files: [], diagnosticsByFile: {} },
			tools: { config: PROJECTS.tools, files: [], diagnosticsByFile: {} },
			tests: { config: PROJECTS.tests, files: [], diagnosticsByFile: {} },
		},
	};
}

function runProject(root: string, config: string): { snapshot: TypecheckSnapshot; output: string; exitCode: number } {
	const compiler = path.join(root, "node_modules", ".bin", "tsc");
	try {
		const output = execFileSync(compiler, ["-p", config, "--pretty", "false"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { snapshot: parseDiagnostics(output, root), output, exitCode: 0 };
	} catch (error) {
		const failure = isRecord(error) ? error : {};
		const stdout = typeof failure.stdout === "string" ? failure.stdout : "";
		const stderr = typeof failure.stderr === "string" ? failure.stderr : "";
		const exitCode = typeof failure.status === "number" ? failure.status : 1;
		const output = `${stdout}${stderr}`;
		return { snapshot: parseDiagnostics(output, root), output, exitCode };
	}
}

function compilerMajor(root: string): number {
	const compiler = path.join(root, "node_modules", ".bin", "tsc");
	const version = execFileSync(compiler, ["--version"], { cwd: root, encoding: "utf8" }).trim();
	const match = version.match(/^Version (\d+)(?:[.]|$)/u);
	if (!match) throw new Error(`unable to parse TypeScript version: ${version}`);
	return Number(match[1]);
}

function main(): void {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	const args = new Set(process.argv.slice(2));
	const writeBaseline = args.has("--write-baseline");
	const selected = PROJECT_ENTRIES.filter(([name]) => args.has(`--project=${name}`) || args.has(name));
	const projects = selected.length > 0 ? selected : PROJECT_ENTRIES;
	const baseline = writeBaseline && !existsSync(path.join(root, BASELINE_PATH)) ? emptyBaseline() : readBaseline(root);
	if (compilerMajor(root) !== 7) throw new Error("typecheck ratchet requires TypeScript 7");
	const next: TypecheckBaseline = {
		version: baseline.version,
		compiler: baseline.compiler,
		projects: { packages: baseline.projects.packages, tools: baseline.projects.tools, tests: baseline.projects.tests },
	};
	let failed = false;
	for (const [name, config] of projects) {
		const result = runProject(root, config);
		process.stdout.write(result.output);
		if (writeBaseline) {
			if (result.snapshot.unparsed.length > 0) throw new Error(`unparsed compiler diagnostics for ${name}`);
			next.projects[name] = { config, files: result.snapshot.files, diagnosticsByFile: result.snapshot.diagnosticsByFile };
			continue;
		}
		const violations = ratchetViolations(baseline.projects[name], result.snapshot);
		if (result.snapshot.unparsed.length > 0 || violations.length > 0 || (result.exitCode !== 0 && result.snapshot.files.length === 0)) {
			for (const violation of violations) process.stderr.write(`[typecheck-ratchet] ${name}: ${violation}\n`);
			for (const line of result.snapshot.unparsed)
				process.stderr.write(`[typecheck-ratchet] ${name}: unparsed compiler diagnostic: ${line}\n`);
			if (result.exitCode !== 0 && result.snapshot.files.length === 0) {
				process.stderr.write(`[typecheck-ratchet] ${name}: compiler failed without parseable diagnostics\n`);
			}
			failed = true;
		}
	}
	if (writeBaseline) {
		mkdirSync(path.dirname(path.join(root, BASELINE_PATH)), { recursive: true });
		writeFileSync(path.join(root, BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
		return;
	}
	process.exitCode = failed ? 1 : 0;
}

if (import.meta.main) main();
