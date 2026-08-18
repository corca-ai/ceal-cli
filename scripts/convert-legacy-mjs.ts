#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdtempSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { readPolicy as readValidatedPolicy, trackedLegacyMjs } from "./check-no-legacy-mjs.ts";

const POLICY_FILE = "config/no-legacy-mjs.json";
type LegacyMjsPolicy = { readonly schema_version: "ceal.no_legacy_mjs.v1"; readonly files: readonly string[] };

function normalizePathPrefix(value: string): string {
	const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
	if (normalized === "" || normalized === ".") return "";
	if (normalized.split("/").some((segment) => segment === ".." || segment === "." || segment === ""))
		throw new Error("legacy_mjs_policy_invalid_path");
	return normalized;
}
function readPolicy(root: string): LegacyMjsPolicy {
	try {
		return { schema_version: "ceal.no_legacy_mjs.v1", files: readValidatedPolicy(join(root, POLICY_FILE)) };
	} catch (error) {
		if (error instanceof Error && /policy|malformed|missing/u.test(error.message)) throw new Error("legacy_mjs_policy_wrong_shape");
		throw error;
	}
}
function renderPolicy(files: readonly string[]): string {
	return `${JSON.stringify({ schema_version: "ceal.no_legacy_mjs.v1", files }, null, "\t")}\n`;
}

const USAGE =
	"Usage: node scripts/convert-legacy-mjs.ts [--repo-root <path>] [--path-prefix <prefix>] [--limit <positive-safe-integer>] [--dry-run|--apply]";
const PATH_TOKEN = /(?:^|[^A-Za-z0-9._/\\-])([A-Za-z0-9._][A-Za-z0-9._/\\-]*\.mjs)(?=$|[^A-Za-z0-9._/\\?&#-])/gu;
// AST-owned call detection below.

export type ConversionArgs = {
	readonly root: string;
	readonly prefix: string;
	readonly limit: number;
	readonly apply: boolean;
	readonly help: boolean;
};
export type ReferenceChange = {
	readonly file: string;
	readonly before: Buffer;
	readonly after: Buffer;
	readonly rewrites: number;
	readonly mode: number;
};
export type ConversionPlan = {
	readonly root: string;
	readonly selected: readonly string[];
	readonly references: readonly ReferenceChange[];
	readonly skippedNonText: readonly string[];
	readonly unresolvedReferences: readonly string[];
	readonly policy: LegacyMjsPolicy;
	readonly policyBefore: Buffer;
	readonly policyMode: number;
};
export type Durability = "not_applied" | "synced" | "unsupported_directory_fsync";

function parseLimit(value: string): number {
	if (!/^[1-9][0-9]*$/u.test(value)) throw new Error("--limit must be a canonical positive safe integer");
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) throw new Error("--limit must be a canonical positive safe integer");
	return parsed;
}
export function parseArgs(argv: readonly string[]): ConversionArgs {
	let root = ".",
		prefix = "",
		max = 25,
		sawApply = false,
		sawDryRun = false,
		help = false;
	const seen = new Set<string>();
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === undefined || seen.has(flag)) throw new Error("CLI arguments are invalid");
		seen.add(flag);
		if (flag === "--help") {
			if (argv.length !== 1) throw new Error("--help cannot be combined with other options");
			help = true;
			continue;
		}
		if (flag === "--apply") {
			if (sawApply || sawDryRun) throw new Error("--dry-run and --apply are mutually exclusive");
			sawApply = true;
			continue;
		}
		if (flag === "--dry-run") {
			if (sawDryRun || sawApply) throw new Error("--dry-run and --apply are mutually exclusive");
			sawDryRun = true;
			continue;
		}
		if (flag !== "--repo-root" && flag !== "--path-prefix" && flag !== "--limit") throw new Error(`Unknown option: ${flag}`);
		const value = argv[++index];
		if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
		if (flag === "--repo-root") root = value;
		else if (flag === "--path-prefix") prefix = normalizePathPrefix(value);
		else max = parseLimit(value);
	}
	return Object.freeze({ root: resolve(root), prefix, limit: max, apply: sawApply, help });
}

function trackedFiles(root: string): string[] {
	return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
		.split("\0")
		.filter(Boolean);
}
function inside(root: string, candidate: string): boolean {
	const local = relative(root, candidate);
	return local === "" || (!local.startsWith("..") && !local.startsWith(sep) && !local.startsWith("/"));
}
function existingParent(candidate: string): string {
	let parent = candidate;
	while (!existsSync(parent)) {
		const next = dirname(parent);
		if (next === parent) break;
		parent = next;
	}
	return parent;
}
function safelyContained(root: string, candidate: string): boolean {
	const lexicalRoot = resolve(root);
	const lexicalCandidate = resolve(candidate);
	if (!inside(lexicalRoot, lexicalCandidate)) return false;
	try {
		return inside(realpathSync(lexicalRoot), realpathSync(existingParent(lexicalCandidate)));
	} catch {
		return false;
	}
}
function assertSafePath(root: string, candidate: string): void {
	if (!safelyContained(root, candidate)) throw new Error(`conversion_path_escape:${relative(root, candidate)}`);
}
function regularOwned(root: string, file: string): boolean {
	const absolute = resolve(root, file);
	if (!safelyContained(root, absolute)) return false;
	try {
		const info = lstatSync(absolute);
		return info.isFile() && !info.isSymbolicLink();
	} catch {
		return false;
	}
}
function assertAbsentTarget(root: string, target: string): void {
	assertSafePath(root, target);
	try {
		lstatSync(target);
		throw new Error(`conversion_target_collision:${relative(root, target)}`);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("conversion_target_collision:")) throw error;
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw new Error(`conversion_target_unreadable:${relative(root, target)}`);
	}
}
function pathMatchesPrefix(entry: string, prefix: string): boolean {
	return prefix === "" || entry === prefix || entry.startsWith(`${prefix}/`);
}
function resolveTarget(root: string, source: string, target: string, selected: Set<string>): string | null {
	const normalized = target
		.replaceAll("\\/", "/")
		.replaceAll("\\", "/")
		.replace(/\/{2,}/gu, "/");
	if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/)/u.test(normalized)) return null;
	for (const candidate of [resolve(root, dirname(source), normalized), resolve(root, normalized.replace(/^\.\//u, ""))]) {
		if (!inside(root, candidate) || !regularOwned(root, relative(root, candidate))) continue;
		const local = relative(root, candidate).replaceAll("\\", "/");
		if (selected.has(local)) return local;
	}
	return null;
}
const AUDITED_TEXT_EXTENSIONS = new Set([
	".bash",
	".cjs",
	".conf",
	".config",
	".js",
	".json",
	".md",
	".mjs",
	".sh",
	".toml",
	".ts",
	".tsx",
	".txt",
	".yaml",
	".yml",
	".zsh",
]);
function isReferenceFile(file: string): boolean {
	return file !== POLICY_FILE && !file.startsWith("charness-artifacts/") && !(file.startsWith("config/") && file.endsWith("-policy.json"));
}
function isAuditedTextFile(file: string): boolean {
	return AUDITED_TEXT_EXTENSIONS.has(extname(file).toLowerCase()) || new Set(["Dockerfile", "Makefile", "Procfile"]).has(basename(file));
}
const CODE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
function sourceKind(file: string): ts.ScriptKind {
	switch (extname(file).toLowerCase()) {
		case ".jsx":
			return ts.ScriptKind.JSX;
		case ".tsx":
			return ts.ScriptKind.TSX;
		case ".js":
		case ".cjs":
		case ".mjs":
			return ts.ScriptKind.JS;
		default:
			return ts.ScriptKind.TS;
	}
}
function unwrapExpression(node: ts.Expression): ts.Expression {
	while (ts.isParenthesizedExpression(node)) node = node.expression;
	return node;
}
function staticExpression(node: ts.Expression): string | null {
	node = unwrapExpression(node);
	return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}
function joinCallee(node: ts.Expression, aliases: ReadonlySet<string>, namespaces: ReadonlySet<string>, bareJoinAllowed: boolean): boolean {
	node = unwrapExpression(node);
	return (
		(ts.isIdentifier(node) && (aliases.has(node.text) || (bareJoinAllowed && node.text === "join"))) ||
		(ts.isPropertyAccessExpression(node) &&
			ts.isIdentifier(node.expression) &&
			namespaces.has(node.expression.text) &&
			node.name.text === "join") ||
		(ts.isElementAccessExpression(node) &&
			ts.isIdentifier(node.expression) &&
			namespaces.has(node.expression.text) &&
			(ts.isStringLiteral(node.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression)) &&
			node.argumentExpression.text === "join")
	);
}
function literalParts(node: ts.Node): string[] {
	const result: string[] = [];
	const visit = (current: ts.Node): void => {
		if (
			ts.isStringLiteral(current) ||
			ts.isNoSubstitutionTemplateLiteral(current) ||
			ts.isTemplateHead(current) ||
			ts.isTemplateMiddle(current) ||
			ts.isTemplateTail(current)
		)
			result.push(current.text);
		ts.forEachChild(current, visit);
	};
	visit(node);
	return result.map((part) =>
		part
			.replaceAll("\\/", "/")
			.replaceAll("\\", "/")
			.replace(/\/{2,}/gu, "/"),
	);
}
function normalizedChunks(node: ts.Node): string[] {
	return literalParts(node)
		.map((part) => part.replaceAll("\\", "/"))
		.filter((part) => part.length > 0);
}
function chunksMatchSelected(chunks: readonly string[], selected: ReadonlySet<string>): boolean {
	if (chunks.length === 0) return false;
	return [...selected].some((entry) => {
		const candidate = entry.replaceAll("\\", "/");
		let offset = 0;
		for (const chunk of chunks) {
			const slashNormalized = chunk.replaceAll("\\", "/");
			const normalized = /^\/+$/u.test(slashNormalized) ? slashNormalized : slashNormalized.replace(/^\/+|\/+$/gu, "");
			if (normalized.length === 0) continue;
			const found = candidate.indexOf(normalized, offset);
			if (found < 0) return false;
			offset = found + normalized.length;
		}
		return true;
	});
}
function dynamicTextMatchesSelected(raw: string, chunks: readonly string[], selected: ReadonlySet<string>): boolean {
	const dynamicCount = [...raw.matchAll(/\$\{|\$\(/gu)].length;
	const meaningfulPrefix = chunks.some((chunk) => chunk.replace(/[\\/]/gu, "").length > 0 && !chunk.endsWith(".mjs"));
	return dynamicCount <= 1 || meaningfulPrefix ? chunksMatchSelected(chunks, selected) : false;
}
function dynamicCanComposeNode(node: ts.Node, source: ts.SourceFile, selected: Set<string>): boolean {
	if (!/\.mjs\b/u.test(node.getText(source))) return false;
	const chunks = ts.isCallExpression(node)
		? node.arguments.flatMap((argument) => normalizedChunks(argument))
		: ts.isTemplateExpression(node)
			? node
					.getText(source)
					.slice(1, -1)
					.split(/\$\{[^}]*\}/gu)
					.filter((part) => part.length > 0)
			: normalizedChunks(node);
	if (ts.isCallExpression(node) && chunks.length < 2 && !chunks.some((chunk) => chunk.includes("/"))) return false;
	return dynamicTextMatchesSelected(node.getText(source), chunks, selected);
}
function normalizePathText(value: string): string {
	return value
		.replaceAll("\\/", "/")
		.replaceAll("\\", "/")
		.replace(/\/{2,}/gu, "/")
		.replace(/^\.\//u, "")
		.replace(/^\/+|\/+$/gu, "");
}
function mixedJoinRewrite(node: ts.CallExpression, selected: Set<string>): ts.Expression | null {
	const staticValues: (string | null)[] = node.arguments.map((argument) => staticExpression(argument));
	let first = staticValues.length;
	while (first > 0 && staticValues[first - 1] !== null) first -= 1;
	const trailing = staticValues.slice(first) as string[];
	if (trailing.length < 2 || !trailing.at(-1)?.endsWith(".mjs")) return null;
	const suffix = normalizePathText(trailing.join("/"));
	if (suffix.split("/").filter(Boolean).length < 2) return null;
	const matches = [...selected].filter((entry) => {
		const candidate = normalizePathText(entry);
		return candidate === suffix || candidate.endsWith(`/${suffix}`);
	});
	if (matches.length !== 1) return null;
	const finalArgument = node.arguments.at(-1);
	if (!finalArgument) return null;
	const raw = finalArgument.getText();
	if (!/\.mjs(?=["'`]?$)/u.test(raw)) return null;
	return finalArgument;
}
function transformStaticJoins(
	text: string,
	root: string,
	file: string,
	selected: Set<string>,
): { text: string; rewrites: number; unresolved: boolean } {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, sourceKind(file));
	const edits: { start: number; end: number; value: string }[] = [];
	let unresolved = false;
	const aliases = new Set<string>();
	const namespaces = new Set<string>();
	const localJoinDeclarations = new Set<string>();
	for (const statement of source.statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteral(statement.moduleSpecifier) ||
			statement.moduleSpecifier.text !== "node:path"
		)
			continue;
		const clause = statement.importClause;
		if (!clause) continue;
		if (clause.name) namespaces.add(clause.name.text);
		if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) namespaces.add(clause.namedBindings.name.text);
		if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
			for (const element of clause.namedBindings.elements) {
				const imported = element.propertyName?.text ?? element.name.text;
				if (imported === "join") aliases.add(element.name.text);
			}
	}
	const collectLocalJoins = (node: ts.Node): void => {
		if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === "join") localJoinDeclarations.add("join");
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "join" &&
			node.initializer &&
			!ts.isStringLiteral(node.initializer)
		)
			localJoinDeclarations.add("join");
		ts.forEachChild(node, collectLocalJoins);
	};
	collectLocalJoins(source);
	const calleeProvenance = (): boolean => {
		let changed = true;
		while (changed) {
			changed = false;
			const discover = (node: ts.Node): void => {
				if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
					const initializer = unwrapExpression(node.initializer);
					if (ts.isIdentifier(initializer) && namespaces.has(initializer.text) && !namespaces.has(node.name.text)) {
						namespaces.add(node.name.text);
						changed = true;
					}
					if (joinCallee(initializer, aliases, namespaces, false) && !aliases.has(node.name.text)) {
						aliases.add(node.name.text);
						changed = true;
					}
				}
				ts.forEachChild(node, discover);
			};
			discover(source);
		}
		return true;
	};
	calleeProvenance();
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && joinCallee(node.expression, aliases, namespaces, !localJoinDeclarations.has("join"))) {
			const values = node.arguments.map((argument) => staticExpression(argument));
			if (values.every((value): value is string => value !== null)) {
				const resolved = resolveTarget(root, file, join(...values), selected);
				let index = -1;
				for (let candidateIndex = values.length - 1; candidateIndex >= 0; candidateIndex -= 1)
					if (values[candidateIndex]?.endsWith(".mjs")) {
						index = candidateIndex;
						break;
					}
				const argument = node.arguments[index];
				if (resolved !== null && argument)
					edits.push({
						start: argument.getStart(source),
						end: argument.getEnd(),
						value: text.slice(argument.getStart(source), argument.getEnd()).replace(/\.mjs(?=["'`]?\s*$)/u, ".ts"),
					});
			} else {
				const mixedArgument = mixedJoinRewrite(node, selected);
				if (mixedArgument)
					edits.push({
						start: mixedArgument.getStart(source),
						end: mixedArgument.getEnd(),
						value: text.slice(mixedArgument.getStart(source), mixedArgument.getEnd()).replace(/\.mjs(?=["'`]?\s*$)/u, ".ts"),
					});
				else if (dynamicCanComposeNode(node, source, selected)) unresolved = true;
			}
		}
		if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && dynamicCanComposeNode(node, source, selected))
			unresolved = true;
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
			const raw = text.slice(node.getStart(source), node.getEnd());
			const changed = raw.replace(PATH_TOKEN, (match, target: string) =>
				resolveTarget(root, file, target, selected) ? match.replace(target, target.replace(/\.mjs$/u, ".ts")) : match,
			);
			if (changed !== raw) edits.push({ start: node.getStart(source), end: node.getEnd(), value: changed });
		} else if (ts.isTemplateExpression(node) && dynamicCanComposeNode(node, source, selected)) unresolved = true;
		ts.forEachChild(node, visit);
	};
	visit(source);
	const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
	for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
		if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
		const start = scanner.getTokenPos();
		const end = scanner.getTextPos();
		const raw = text.slice(start, end);
		const changed = raw.replace(PATH_TOKEN, (match, target: string) =>
			resolveTarget(root, file, target, selected) ? match.replace(target, target.replace(/\.mjs$/u, ".ts")) : match,
		);
		if (changed !== raw) edits.push({ start, end, value: changed });
	}
	const unique = [...new Map(edits.map((edit) => [edit.start, edit])).values()].sort((a, b) => b.start - a.start);
	let updated = text;
	for (const edit of unique) updated = `${updated.slice(0, edit.start)}${edit.value}${updated.slice(edit.end)}`;
	return { text: updated, rewrites: unique.length, unresolved };
}
function transformNonCode(
	text: string,
	root: string,
	file: string,
	selected: Set<string>,
): { text: string; rewrites: number; unresolved: boolean } {
	let rewrites = 0;
	const updated = text.replace(PATH_TOKEN, (match, target: string) => {
		if (resolveTarget(root, file, target, selected) === null) return match;
		rewrites += 1;
		return match.replace(target, target.replace(/\.mjs$/u, ".ts"));
	});
	const dynamicPathPattern = /[A-Za-z0-9._/\\-]*(?:\$\{[^}]*\}|\$\([^)]*\))[A-Za-z0-9._/\\-]*/gu;
	const unresolved = [...text.matchAll(dynamicPathPattern)].some((match) => {
		const value = match[0] ?? "";
		if (!/\.mjs\b/u.test(value)) return false;
		const chunks = value.split(/\$\{[^}]*\}|\$\([^)]*\)/gu).filter((part) => part.length > 0);
		return dynamicTextMatchesSelected(value, chunks, selected);
	});
	return { text: updated, rewrites, unresolved };
}
function collectReferences(
	root: string,
	selected: Set<string>,
	files: readonly string[],
): { references: ReferenceChange[]; skippedNonText: string[]; unresolvedReferences: string[] } {
	const references: ReferenceChange[] = [];
	const skippedNonText: string[] = [];
	const unresolvedReferences: string[] = [];
	for (const file of files.filter(isReferenceFile)) {
		if (!regularOwned(root, file)) continue;
		if (!isAuditedTextFile(file)) {
			skippedNonText.push(file);
			continue;
		}
		const before = readFileSync(join(root, file));
		if (before.includes(0)) {
			skippedNonText.push(file);
			continue;
		}
		let text: string;
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(before);
		} catch {
			skippedNonText.push(file);
			continue;
		}
		const transformed = CODE_EXTENSIONS.has(extname(file).toLowerCase())
			? transformStaticJoins(text, root, file, selected)
			: transformNonCode(text, root, file, selected);
		const rewrites = transformed.rewrites;
		if (transformed.unresolved) unresolvedReferences.push(file);
		const updated = transformed.text;
		if (rewrites > 0)
			references.push({
				file,
				before,
				after: Buffer.concat([
					before.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0),
					Buffer.from(updated.replace(/^\uFEFF/u, ""), "utf8"),
				]),
				rewrites,
				mode: lstatSync(join(root, file)).mode & 0o7777,
			});
	}
	return { references, skippedNonText, unresolvedReferences: [...new Set(unresolvedReferences)].sort() };
}

export function planConversion(root: string, prefix: string, limit: number): ConversionPlan {
	const policy = readPolicy(root);
	const normalizedPrefix = normalizePathPrefix(prefix);
	const tracked = new Set(trackedFiles(root));
	const actual = new Set(trackedLegacyMjs(root).map((entry) => entry.replaceAll("\\", "/")));
	const policySet = new Set(policy.files);
	const additions = [...actual].filter((entry) => !policySet.has(entry)).sort();
	const removals = [...policySet].filter((entry) => !actual.has(entry)).sort();
	if (additions.length || removals.length)
		throw new Error(`legacy_mjs_policy_drift:additions=${additions.join(",")}:removals=${removals.join(",")}`);
	assertSafePath(root, join(root, POLICY_FILE));
	const selected = policy.files.filter((entry) => pathMatchesPrefix(entry, normalizedPrefix)).slice(0, limit);
	for (const entry of selected) {
		if (!tracked.has(entry) || !actual.has(entry) || !regularOwned(root, entry)) throw new Error(`conversion_source_invalid:${entry}`);
		const target = entry.replace(/\.mjs$/u, ".ts");
		const targetPath = join(root, target);
		assertSafePath(root, targetPath);
		assertAbsentTarget(root, targetPath);
	}
	const collected = collectReferences(root, new Set(selected), [...tracked]);
	const policyMode = lstatSync(join(root, POLICY_FILE)).mode & 0o7777;
	return Object.freeze({
		root,
		selected: Object.freeze(selected),
		references: Object.freeze(collected.references),
		skippedNonText: Object.freeze(collected.skippedNonText.sort()),
		unresolvedReferences: Object.freeze(collected.unresolvedReferences),
		policy,
		policyBefore: readFileSync(join(root, POLICY_FILE)),
		policyMode,
	});
}

function syncDirectory(directory: string, injection: "unsupported" | "EIO" | undefined): Durability {
	if (injection === "unsupported") return "unsupported_directory_fsync";
	if (injection === "EIO") {
		const error = Object.assign(new Error("directory_fsync_failed:EIO"), { code: "EIO" });
		throw error;
	}
	try {
		const fd = openSync(directory, "r");
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		return "synced";
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
		if (code === "EINVAL" || code === "ENOTSUP" || code === "EOPNOTSUPP" || code === "EBADF") return "unsupported_directory_fsync";
		throw error;
	}
}
function writeAtomic(
	root: string,
	file: string,
	bytes: Buffer,
	temporaryRoot: string,
	mode: number,
	directorySync: "unsupported" | "EIO" | undefined,
): Durability {
	assertSafePath(root, file);
	assertSafePath(root, temporaryRoot);
	const temp = join(temporaryRoot, `${Math.random().toString(16).slice(2)}.tmp`);
	assertSafePath(root, temp);
	const fd = openSync(temp, "wx", 0o600);
	try {
		writeFileSync(fd, bytes);
		fsyncSync(fd);
		closeSync(fd);
		chmodSync(temp, mode & 0o7777);
		assertSafePath(root, file);
		renameSync(temp, file);
		return syncDirectory(dirname(file), directorySync);
	} catch (error) {
		try {
			closeSync(fd);
		} catch {
			/* preserve the write failure */
		}
		try {
			unlinkSync(temp);
		} catch {
			/* preserve the write failure */
		}
		throw error;
	}
}
function maybeFail(step: string, failAfter: number | undefined, state: { count: number }): void {
	state.count += 1;
	if (failAfter !== undefined && state.count >= failAfter) throw new Error(`injected_conversion_failure:${step}`);
}
function rollbackTransaction(
	root: string,
	temporaryRoot: string,
	policyFile: string,
	policyBefore: Buffer,
	policyMode: number,
	references: readonly ReferenceChange[],
	completedRenames: readonly { from: string; to: string }[],
	failRollback: boolean,
	directorySync: "unsupported" | "EIO" | undefined,
): string[] {
	const errors: string[] = [];
	for (const rename of completedRenames) {
		try {
			if (failRollback) throw new Error("injected_rollback_failure:source");
			lstatSync(rename.to);
			assertSafePath(root, rename.to);
			renameSync(rename.to, rename.from);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}
	for (let index = 0; index < references.length; index += 1) {
		try {
			if (failRollback) throw new Error("injected_rollback_failure:reference");
			const reference = references[index];
			if (reference === undefined) throw new Error("conversion_reference_missing");
			const backup = join(temporaryRoot, `backup-${index}`);
			if (existsSync(backup))
				writeAtomic(root, join(root, reference.file), readFileSync(backup), temporaryRoot, reference.mode, directorySync);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}
	try {
		if (failRollback) throw new Error("injected_rollback_failure:policy");
		writeAtomic(root, policyFile, policyBefore, temporaryRoot, policyMode, directorySync);
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error));
	}
	return errors;
}

export function applyConversion(
	plan: ConversionPlan,
	options: {
		readonly failAfter?: number;
		readonly failRollback?: boolean;
		readonly directorySync?: "unsupported" | "EIO";
		readonly removeCompletedTargetBeforeRollback?: boolean;
	} = {},
): Durability {
	const { root, selected, references, unresolvedReferences, policy, policyBefore, policyMode } = plan;
	if (selected.length === 0) return "not_applied";
	if (unresolvedReferences.length > 0) throw new Error(`conversion_unresolved_references:${unresolvedReferences.join(",")}`);
	const temporaryRoot = mkdtempSync(join(root, ".ceal-legacy-mjs-"));
	let durability: Durability = "synced";
	try {
		const policyFile = join(root, POLICY_FILE);
		const sourceRenames = selected.map((entry) => ({ from: join(root, entry), to: join(root, entry.replace(/\.mjs$/u, ".ts")) }));
		const completedRenames: { from: string; to: string }[] = [];
		const state = { count: 0 };
		try {
			for (let index = 0; index < references.length; index += 1) {
				const reference = references[index];
				if (reference === undefined) throw new Error("conversion_reference_missing");
				writeFileSync(join(temporaryRoot, `backup-${index}`), reference.before, { mode: 0o600 });
			}
			writeFileSync(join(temporaryRoot, "policy-backup"), policyBefore, { mode: 0o600 });
			for (const reference of references) {
				if (!regularOwned(root, reference.file)) throw new Error(`conversion_reference_changed:${reference.file}`);
				if (!readFileSync(join(root, reference.file)).equals(reference.before))
					throw new Error(`conversion_reference_changed:${reference.file}`);
				durability = mergeDurability(
					durability,
					writeAtomic(root, join(root, reference.file), reference.after, temporaryRoot, reference.mode, options.directorySync),
				);
				maybeFail(`reference:${reference.file}`, options.failAfter, state);
			}
			for (const rename of sourceRenames) {
				if (!regularOwned(root, relative(root, rename.from))) throw new Error(`conversion_source_changed:${relative(root, rename.from)}`);
				assertAbsentTarget(root, rename.to);
				renameSync(rename.from, rename.to);
				completedRenames.push(rename);
				durability = mergeDurability(durability, syncDirectory(dirname(rename.from), options.directorySync));
				maybeFail(`rename:${relative(root, rename.from)}`, options.failAfter, state);
			}
			const nextPolicy = policy.files.filter((entry) => !selected.includes(entry));
			if (!regularOwned(root, POLICY_FILE) || !readFileSync(policyFile).equals(policyBefore)) throw new Error("conversion_policy_changed");
			const nextPolicyBytes = Buffer.from(renderPolicy(nextPolicy), "utf8");
			durability = mergeDurability(
				durability,
				writeAtomic(root, policyFile, nextPolicyBytes, temporaryRoot, policyMode, options.directorySync),
			);
			maybeFail("policy", options.failAfter, state);
		} catch (error) {
			if (options.removeCompletedTargetBeforeRollback && completedRenames[0] && existsSync(completedRenames[0].to))
				unlinkSync(completedRenames[0].to);
			const rollbackErrors = rollbackTransaction(
				root,
				temporaryRoot,
				policyFile,
				policyBefore,
				policyMode,
				references,
				completedRenames,
				options.failRollback === true,
				options.directorySync,
			);
			if (rollbackErrors.length > 0)
				throw new Error(
					`conversion_transaction_failed:original=${error instanceof Error ? error.message : String(error)}:rollback=${rollbackErrors.join("|")}`,
				);
			throw error;
		}
	} finally {
		rmSync(temporaryRoot, { recursive: true, force: true });
	}
	return durability;
}
function mergeDurability(left: Durability, right: Durability): Durability {
	return left === "unsupported_directory_fsync" || right === "unsupported_directory_fsync"
		? "unsupported_directory_fsync"
		: left === "not_applied"
			? right
			: left;
}

export function main(argv = process.argv.slice(2)): number {
	const args = parseArgs(argv);
	if (args.help) {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}
	const plan = planConversion(args.root, args.prefix, args.limit);
	if (args.apply && plan.unresolvedReferences.length > 0)
		throw new Error(`conversion_unresolved_references:${plan.unresolvedReferences.join(",")}`);
	const durability = args.apply ? applyConversion(plan) : "not_applied";
	process.stdout.write(
		`${JSON.stringify({ schema_version: "ceal.no_legacy_mjs_conversion.v1", dry_run: !args.apply, path_prefix: args.prefix, converted: plan.selected, reference_rewrites: plan.references.map(({ file, rewrites }) => ({ file, rewrites })), skipped_non_text: plan.skippedNonText, unresolved_references: plan.unresolvedReferences, durability }, null, "\t")}\n`,
	);
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		process.exit(main());
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
