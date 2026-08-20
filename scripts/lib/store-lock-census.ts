// Which writers of a lock-guarded local store reach it without the lock.
//
// This exists because of a measurement, not a theory. On 2026-08-09 commit
// 52d8a45 fixed "the append takes the lock and the removal does not" in
// `receipt-spool.ts`, and the same commit left the module's third writer —
// `recordDrop` — outside the lock it had just introduced. The next sweep found
// that, and nothing between the two could have: `npm run check` was green
// across both, because no gate here enumerates the writers of a resource. A
// reviewer is handed one site and its named sibling; the population is never
// listed. That is the query this file runs.
//
// The rule it enforces is narrow on purpose. It says nothing about whether a
// module *should* own a lock — `discovery-cache.ts` writes under the store home
// with no lock and that is a considered choice, not a defect. It applies only
// inside a module that has already declared, by calling a `with…Lock` helper,
// that its store needs exclusion. Inside such a module every writer is either
// under the lock or carries `@lockFree` with a reason.
//
// Parsed with the TypeScript compiler rather than matched with a regex, for the
// reason `production-reachability.ts` states: a regex that quietly stops
// matching leaves a gate green while claiming to have walked the tree.
import { forEachOwnedSource } from "./owned-package-sources.ts";
import ts from "typescript";

/**
 * A call to one of these mutates the store on disk. `openSync` is conditional —
 * only a write-mode open counts, because a read-only open is how several of
 * these modules legitimately inspect a file outside the lock.
 */
const MUTATORS = new Set([
	"appendFileSync",
	"chmodSync",
	"cpSync",
	"fchmodSync",
	"ftruncateSync",
	"renameSync",
	"rmSync",
	"unlinkSync",
	"writeCealLocalStoreFile",
	"writeFileSync",
	"writeSync",
]);
const WRITE_OPEN_FLAGS = /\bO_(WRONLY|RDWR|CREAT|APPEND|TRUNC)\b/u;
/** The shape of the lock primitives this tree declares. `local-store-lock.ts` owns the only one today. */
const GUARD_NAME = /^with[A-Z]\w*Lock$/u;
const PRIMITIVE_MODULES = new Set(["local-store-lock.ts"]);

type FunctionMap = Map<string, ts.FunctionDeclaration>;
type CallSite = { guarded: boolean; owner: string | undefined };
type Finding = { file: string; line: number; symbol: string; mutations: string[]; guards: string[] };
type Exempt = { file: string; line: number; symbol: string; mutations: string[] };
type CensusModule = { file: string; guards: string[]; findings: Finding[]; exempt: Exempt[]; clean: string[] };

function lineOf(source: ts.SourceFile, node: ts.Node): number {
	return ts.getLineAndCharacterOfPosition(source, node.getStart()).line + 1;
}

function calleeName(node: ts.Node): string | undefined {
	if (!ts.isCallExpression(node)) return undefined;
	if (ts.isIdentifier(node.expression)) return node.expression.text;
	if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)) return node.expression.name.text;
	return undefined;
}

/** Every top-level `function` declaration in the module, by name. */
function topLevelFunctions(source: ts.SourceFile): FunctionMap {
	const functions: FunctionMap = new Map();
	for (const statement of source.statements) {
		if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
			functions.set(statement.name.text, statement);
		}
	}
	return functions;
}

/**
 * The module's guard names: the `with…Lock` primitives it calls, plus any local
 * wrapper that exists only to delegate to one.
 *
 * The delegation test is deliberately strict — the wrapper's callback must do
 * nothing but invoke one of the wrapper's own parameters. `underSpoolLock`
 * (`async () => action()`) qualifies; `removeUnderLock`, whose callback calls
 * two module functions of its own, does not. A looser test would classify every
 * consumer of the lock as a guard and widen what counts as protected, which is
 * the direction that hides a finding.
 */
function resolveGuards(source: ts.SourceFile, functions: FunctionMap): Set<string> {
	const guards = new Set<string>();
	const visitForPrimitives = (node: ts.Node): void => {
		const name = calleeName(node);
		if (name && GUARD_NAME.test(name)) guards.add(name);
		ts.forEachChild(node, visitForPrimitives);
	};
	visitForPrimitives(source);
	if (guards.size === 0) return guards;

	let widened = true;
	while (widened) {
		widened = false;
		for (const [name, declaration] of functions) {
			if (guards.has(name)) continue;
			const parameters = new Set(
				declaration.parameters.flatMap((parameter) => (ts.isIdentifier(parameter.name) ? [parameter.name.text] : [])),
			);
			let delegates = false;
			const visit = (node: ts.Node): void => {
				const callee = calleeName(node);
				if (callee && guards.has(callee) && ts.isCallExpression(node)) {
					for (const argument of node.arguments) {
						if (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) continue;
						let onlyInvokesParameter = false;
						let touchesAnythingElse = false;
						const inspect = (inner: ts.Node): void => {
							const innerCallee = calleeName(inner);
							if (innerCallee) {
								if (parameters.has(innerCallee)) onlyInvokesParameter = true;
								else touchesAnythingElse = true;
							}
							ts.forEachChild(inner, inspect);
						};
						ts.forEachChild(argument, inspect);
						if (onlyInvokesParameter && !touchesAnythingElse) delegates = true;
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(declaration);
			if (delegates) {
				guards.add(name);
				widened = true;
			}
		}
	}
	return guards;
}

/** True when the node sits inside an argument of a call to one of the module's guards. */
function underGuard(node: ts.Node, guards: Set<string>): boolean {
	let child = node;
	let parent = node.parent;
	while (parent) {
		const callee = calleeName(parent);
		if (
			callee &&
			guards.has(callee) &&
			ts.isCallExpression(parent) &&
			parent.arguments.some((argument: ts.Expression) => argument === child || argument.pos <= child.pos)
		) {
			// `argument === child` covers a direct argument; the position test covers
			// a node nested anywhere inside one. The callee itself is never an
			// argument, so a recursive guard call is not self-protecting.
			if (parent.expression !== child) return true;
		}
		child = parent;
		parent = parent.parent;
	}
	return false;
}

/** The enclosing top-level function declaration, or undefined for module-level code. */
function enclosingFunction(node: ts.Node, functions: FunctionMap): string | undefined {
	for (let parent = node.parent; parent; parent = parent.parent) {
		if (ts.isFunctionDeclaration(parent) && parent.name && functions.get(parent.name.text) === parent) return parent.name.text;
	}
	return undefined;
}

function hasLockFreeTag(source: ts.SourceFile, declaration: ts.FunctionDeclaration): boolean {
	const leading = source.text.slice(declaration.getFullStart(), declaration.getStart());
	return /@lockFree\b/u.test(leading);
}

/**
 * Analyze one module. Returns `undefined` when the module declares no lock, so
 * the caller can name it in the census as considered-and-skipped rather than
 * letting a silent skip read as a clean result.
 */
function analyzeModule(relative: string, source: ts.SourceFile): CensusModule | undefined {
	const functions = topLevelFunctions(source);
	const guards = resolveGuards(source, functions);
	if (guards.size === 0) return undefined;

	// Every mutating call, attributed to the function that lexically contains it.
	const mutations = new Map<string, string[]>();
	// Every intra-module call of a top-level function, with whether it is guarded.
	const callSites = new Map<string, CallSite[]>();
	const visit = (node: ts.Node): void => {
		const callee = calleeName(node);
		if (callee) {
			const isMutation = MUTATORS.has(callee) || (callee === "openSync" && WRITE_OPEN_FLAGS.test(node.getText()));
			if (isMutation && !underGuard(node, guards)) {
				const owner = enclosingFunction(node, functions);
				if (owner) {
					const ownerMutations = mutations.get(owner) ?? [];
					ownerMutations.push(`${callee}@${lineOf(source, node)}`);
					mutations.set(owner, ownerMutations);
				}
			}
			if (functions.has(callee)) {
				const sites = callSites.get(callee) ?? [];
				sites.push({ guarded: underGuard(node, guards), owner: enclosingFunction(node, functions) });
				callSites.set(callee, sites);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);

	// A function is protected when it has at least one intra-module call site and
	// every one of them is either lexically under a guard or inside a function
	// that is itself protected. Fixpoint, because the chain can be longer than one.
	const protectedFns = new Set<string>();
	let widened = true;
	while (widened) {
		widened = false;
		for (const name of functions.keys()) {
			if (protectedFns.has(name)) continue;
			const sites = callSites.get(name) ?? [];
			if (sites.length === 0) continue;
			if (sites.every((site) => site.guarded || (site.owner && protectedFns.has(site.owner)))) {
				protectedFns.add(name);
				widened = true;
			}
		}
	}

	const findings: Finding[] = [];
	const exempt: Exempt[] = [];
	const clean: string[] = [];
	for (const [name, mutating] of mutations) {
		const declaration = functions.get(name);
		if (!declaration) continue;
		if (protectedFns.has(name)) {
			clean.push(name);
			continue;
		}
		if (hasLockFreeTag(source, declaration)) {
			exempt.push({ file: relative, line: lineOf(source, declaration), symbol: name, mutations: mutating });
			continue;
		}
		findings.push({ file: relative, line: lineOf(source, declaration), symbol: name, mutations: mutating, guards: [...guards].sort() });
	}
	return { file: relative, guards: [...guards].sort(), findings, exempt, clean: clean.sort() };
}

/**
 * Walk the owned packages and report every writer that reaches a guarded store
 * outside its lock.
 *
 * `considered` and `skipped` are part of the result rather than debug output:
 * this check can only be trusted while it is looking at the modules it claims
 * to, and a renamed lock helper would otherwise empty it silently.
 */
type StoreLockOptions = { repoRoot: string; roots?: readonly string[] | undefined };
type StoreLockReport = { considered: string[]; guarded: CensusModule[]; skipped: string[]; findings: Finding[]; exempt: Exempt[] };

export function analyzeStoreLockCensus({ repoRoot, roots }: StoreLockOptions): StoreLockReport {
	const guarded: CensusModule[] = [];
	const skipped: string[] = [];
	const findings: Finding[] = [];
	const exempt: Exempt[] = [];
	// `local-store-lock.ts` *is* the primitive and cannot be judged against itself.
	const considered = forEachOwnedSource({ repoRoot, roots, skipFile: (name) => PRIMITIVE_MODULES.has(name) }, (relative, source) => {
		const module = analyzeModule(relative, source);
		if (!module) {
			skipped.push(relative);
			return;
		}
		guarded.push(module);
		findings.push(...module.findings);
		exempt.push(...module.exempt);
	});
	return { considered, guarded, skipped, findings, exempt };
}
