// Which exports under `scripts/` no production path reaches.
//
// Coverage cannot answer this and neither can `knip`. Coverage reads an
// exhaustively tested guard as covered whether or not production ever calls it,
// which is how two dead guards sat inside files reading 91-94% function coverage
// (docs/release-guard-reachability.md). `knip` cannot answer it here for two
// separate reasons, both measured: the top-level `scripts/*.mjs` are its `entry`
// files and it never reports an entry file's exports, and under `scripts/lib/`
// it counts a test as a consumer — and every one of them is test-imported.
//
// So this walks the production graph only. Entries are the `node scripts/*.mjs`
// invocations declared in `package.json` scripts; edges are static relative
// imports. Tests are not in the graph by construction, which is the whole point:
// a guard only its own test calls is exactly the defect being looked for.
//
// Parsed with the TypeScript compiler rather than matched with a regex. A regex
// that silently stops matching turns this gate green while claiming coverage of
// the tree, and this repository has already shipped one guard that could not
// fail.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** A file is production-reachable if some entry reaches it through static imports. */
function parse(file, text) {
	return ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
}

function isExported(node) {
	return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

/**
 * Every exported name, every statically imported name, and every identifier
 * occurrence in one module.
 *
 * Dynamic `import()` is deliberately not an edge. It cannot be resolved without
 * running the program, and treating an unresolvable specifier as an edge would
 * silently widen the graph until nothing could be unreachable.
 */
function readModule(absolute, repoRoot) {
	const relative = path.relative(repoRoot, absolute);
	const source = parse(relative, readFileSync(absolute, "utf8"));
	const exports = new Map();
	const testOnly = new Set();
	const imports = [];
	const identifiers = [];

	const declare = (name, node) => {
		if (!exports.has(name)) exports.set(name, ts.getLineAndCharacterOfPosition(source, node.getStart()).line + 1);
		// The tag is read off the declaration's own leading comment rather than by
		// scanning the file, so a tag written above one export cannot silence the
		// next one down.
		const leading = source.text.slice(node.getFullStart(), node.getStart());
		if (/@testOnly\b/u.test(leading)) testOnly.add(name);
	};

	const visit = (node) => {
		if (ts.isIdentifier(node)) identifiers.push(node);
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			const names = [];
			const clause = node.importClause;
			if (clause?.name) names.push({ imported: "default", local: clause.name.text });
			if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
				for (const element of clause.namedBindings.elements) {
					names.push({ imported: (element.propertyName ?? element.name).text, local: element.name.text });
				}
			}
			// A namespace import consumes whatever it is asked for at runtime, so
			// every export of that module counts as imported. Narrowing it to the
			// properties actually read would need type resolution this does not do.
			const namespace = clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings);
			imports.push({ specifier: node.moduleSpecifier.text, names, namespace: Boolean(namespace) });
		}
		if (ts.isExportDeclaration(node)) {
			if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				// A re-export is both an edge and an export of this module.
				const names = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : [];
				imports.push({
					specifier: node.moduleSpecifier.text,
					names: names.map((element) => ({ imported: (element.propertyName ?? element.name).text, local: element.name.text })),
					namespace: !node.exportClause,
				});
			}
			if (node.exportClause && ts.isNamedExports(node.exportClause)) {
				for (const element of node.exportClause.elements) declare(element.name.text, element);
			}
		}
		if (ts.isVariableStatement(node) && isExported(node)) {
			for (const declaration of node.declarationList.declarations) {
				if (ts.isIdentifier(declaration.name)) declare(declaration.name.text, declaration);
			}
		}
		if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && isExported(node) && node.name) {
			declare(node.name.text, node);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return { file: relative, absolute, exports, testOnly, imports, identifiers };
}

function resolve(fromAbsolute, specifier) {
	if (!specifier.startsWith(".")) return undefined;
	return path.resolve(path.dirname(fromAbsolute), specifier);
}

const INVOCATION = /node\s+(?:[\w-]+=\S+\s+)*(scripts\/[\w./-]+\.mjs)/gu;

/**
 * Every `node scripts/*.mjs` a production caller runs.
 *
 * The manifest is the primary source, and read rather than listed here: a script
 * added to it becomes an entry without anyone remembering to teach this, and — the
 * load-bearing half — a script *removed* from it stops being one, which is when
 * its exports become findings.
 *
 * Lanes and the hook also invoke scripts directly, and every one of those happens
 * to name a script the manifest declares too. That is a coincidence, not a rule,
 * and the next lane to break it would get a false positive rather than a finding,
 * so they are read as entries in their own right.
 */
export function productionEntries(repoRoot) {
	const entries = new Set();
	const add = (text) => {
		for (const match of String(text).matchAll(INVOCATION)) entries.add(path.join(repoRoot, match[1]));
	};
	const manifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
	for (const command of Object.values(manifest.scripts ?? {})) add(command);
	for (const directory of [path.join(repoRoot, ".github", "workflows"), path.join(repoRoot, ".githooks")]) {
		let names;
		try {
			names = readdirSync(directory);
		} catch {
			// A tree without lanes or hooks is a legitimate input — the fixtures in
			// the suite are exactly that — and not an error to raise here.
			continue;
		}
		for (const name of names) add(readFileSync(path.join(directory, name), "utf8"));
	}
	return [...entries].sort();
}

/**
 * Release lanes call into `scripts/` from inline `node --input-type=module`
 * steps, and those are production callers by any reading — the rollback lane's
 * only inventory parser is reached that way and nowhere else. Missing them made
 * this check's very first run produce a false positive, which is how a gate gets
 * switched off in its first week.
 *
 * What is located textually is the inline *script*, because it sits inside a
 * YAML `run:` block rather than in a module. Its imports are then read by
 * parsing that script as a module. A regex spanning from one `import` to a later
 * `from` reads two adjacent statements as one and attributes the wrong names —
 * which it did here, silently, on the first attempt.
 */
export function workflowConsumers(repoRoot) {
	const directory = path.join(repoRoot, ".github", "workflows");
	const consumers = [];
	for (const name of readdirSync(directory)) {
		if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
		const lines = readFileSync(path.join(directory, name), "utf8").split("\n");
		for (let index = 0; index < lines.length; index += 1) {
			if (!/--input-type=module\s+-e\s+'/u.test(lines[index])) continue;
			const body = [];
			for (let cursor = index + 1; cursor < lines.length && !lines[cursor].trimStart().startsWith("'"); cursor += 1) {
				body.push(lines[cursor]);
			}
			for (const statement of parse(name, body.join("\n")).statements) {
				if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
				const specifier = statement.moduleSpecifier.text;
				if (!specifier.startsWith(".")) continue;
				const names = [];
				const bindings = statement.importClause?.namedBindings;
				if (statement.importClause?.name) names.push("default");
				if (bindings && ts.isNamedImports(bindings)) {
					for (const element of bindings.elements) names.push((element.propertyName ?? element.name).text);
				}
				consumers.push({
					workflow: path.join(".github", "workflows", name),
					// A lane runs from the repository root, so its specifier resolves
					// there whatever prefix it is written with.
					target: path.resolve(repoRoot, specifier),
					names,
					namespace: Boolean(bindings && ts.isNamespaceImport(bindings)),
				});
			}
		}
	}
	return consumers;
}

/**
 * Findings, never verdicts. Each says "no production path reaches this", which
 * is the question; whether the answer is "wire it in" or "delete it" is not
 * something a static walk can decide.
 */
export function analyzeProductionReachability({
	repoRoot,
	entries = productionEntries(repoRoot),
	workflows = workflowConsumers(repoRoot),
} = {}) {
	const modules = new Map();
	const load = (absolute) => {
		if (modules.has(absolute)) return modules.get(absolute);
		const module = readModule(absolute, repoRoot);
		modules.set(absolute, module);
		return module;
	};

	// Reachability first: only a module an entry reaches can consume anything.
	const reachable = new Set();
	const queue = [...entries, ...workflows.map((consumer) => consumer.target)];
	while (queue.length > 0) {
		const absolute = queue.pop();
		if (reachable.has(absolute)) continue;
		reachable.add(absolute);
		for (const record of load(absolute).imports) {
			const target = resolve(absolute, record.specifier);
			if (target) queue.push(target);
		}
	}

	// What the production graph actually consumes, keyed file -> imported names.
	const consumed = new Map();
	const wholeModule = new Set();
	for (const absolute of reachable) {
		for (const record of load(absolute).imports) {
			const target = resolve(absolute, record.specifier);
			if (!target) continue;
			if (record.namespace) wholeModule.add(target);
			const names = consumed.get(target) ?? new Set();
			for (const { imported } of record.names) names.add(imported);
			consumed.set(target, names);
		}
	}
	for (const consumer of workflows) {
		if (consumer.namespace) wholeModule.add(consumer.target);
		const names = consumed.get(consumer.target) ?? new Set();
		for (const name of consumer.names) names.add(name);
		consumed.set(consumer.target, names);
	}

	// A module under `scripts/` that no entry reaches at all is the coarser half
	// of the same defect, and the one a per-export walk cannot state: nothing it
	// exports could be reported, because the walk never opens the file.
	const owned = [];
	const walk = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) walk(absolute);
			else if (entry.name.endsWith(".mjs")) owned.push(absolute);
		}
	};
	walk(path.join(repoRoot, "scripts"));
	const unreachableFiles = owned
		.filter((absolute) => !reachable.has(absolute))
		.map((absolute) => path.relative(repoRoot, absolute))
		.sort();

	const findings = [];
	for (const absolute of [...reachable].sort()) {
		const module = load(absolute);
		if (wholeModule.has(absolute)) continue;
		const importedHere = consumed.get(absolute) ?? new Set();
		for (const [name, line] of module.exports) {
			if (importedHere.has(name)) continue;
			// The same declared exception the TypeScript packages use, checked the
			// same way: `repo-gates.test.mjs` fails when a tagged export is reached
			// by no suite, so the tag cannot quietly become a mute button.
			if (module.testOnly.has(name)) continue;
			// An export the production graph does not import may still be called
			// inside its own module, in which case the export modifier is surplus
			// rather than the code being unreachable. Only the second is this
			// gate's business, so an in-file reference clears it.
			const usedInFile = module.identifiers.some(
				(identifier) =>
					identifier.text === name && ts.getLineAndCharacterOfPosition(identifier.getSourceFile(), identifier.getStart()).line + 1 !== line,
			);
			if (usedInFile) continue;
			findings.push({ file: module.file, symbol: name, line });
		}
	}
	return {
		entries: entries.map((absolute) => path.relative(repoRoot, absolute)).sort(),
		reachable: [...reachable].map((absolute) => path.relative(repoRoot, absolute)).sort(),
		unreachableFiles,
		findings,
	};
}
