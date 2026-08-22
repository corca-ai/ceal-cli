// The two detectors that arm `AGENTS.md` `## One Fact, One Home`, and the
// bindings for the second homes a boundary makes unavoidable.
//
// Both analyzers are proven on trees whose answer is known before they run.
// Asserting only that this repository reports zero would pass identically if the
// walk found nothing at all — the failure mode both `production-reachability`
// and `coverage-scripts` have sections about, and the one that turned a real
// defect green here twice.
import {
	analyzeDuplicateLiterals,
	DUPLICATE_LITERAL_EXEMPTIONS,
	DUPLICATE_LITERAL_MIN_BODY_LENGTH,
} from "../../scripts/lib/duplicate-literal.ts";
import { analyzeStoreLockCensus } from "../../scripts/lib/store-lock-census.ts";
import { required as requiredValue } from "../required.ts";
import { scratchTree } from "../scratch-dir.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// The Protocol is an installed dependency, not a workspace. Naming the path once
// keeps every binding below pointed at the same artifact.
const PROTOCOL_DIST = "node_modules/@corca-ai/ceal-protocol/dist";
const PACKAGE = "packages/ceal-worker-cli/src";

const fixture = (context: TestContext, files: Record<string, string>): string => scratchTree(context, "ceal-one-fact-", files);

const GUARDED_STORE = `import { withLocalStoreLock } from "./local-store-lock.js";

async function underLock(directory, action) {
	return withLocalStoreLock({ lockPath: directory }, async () => action());
}

async function append(directory, file) {
	return underLock(directory, () => writeIt(file));
}

function writeIt(file) {
	writeFileSync(file, "x");
}
`;

// ---------------------------------------------------------------- store lock

test("a writer outside the module's lock is reported and a writer inside it is not", (context) => {
	const root = fixture(context, {
		[`${PACKAGE}/store.ts`]: `${GUARDED_STORE}
function recordSomething(file) {
	writeFileSync(file, ".");
}

export function makeStore(directory, file) {
	return { append: () => append(directory, file), drop: () => recordSomething(file) };
}
`,
	});
	const { findings } = analyzeStoreLockCensus({ repoRoot: root, roots: [PACKAGE] });
	assert.deepEqual(
		findings.map(({ file, symbol }) => `${file}: ${symbol}`),
		[`${PACKAGE}/store.ts: recordSomething`],
		"the unguarded writer, and only it",
	);
});

test("moving the unguarded writer under the lock clears the finding", (context) => {
	const root = fixture(context, {
		[`${PACKAGE}/store.ts`]: `${GUARDED_STORE}
async function recordSomething(directory, file) {
	return underLock(directory, () => writeFileSync(file, "."));
}

export function makeStore(directory, file) {
	return { append: () => append(directory, file), drop: () => recordSomething(directory, file) };
}
`,
	});
	assert.deepEqual(analyzeStoreLockCensus({ repoRoot: root, roots: [PACKAGE] }).findings, []);
});

test("a module that declares no lock is skipped rather than judged, and says so", (context) => {
	const root = fixture(context, {
		[`${PACKAGE}/plain.ts`]: 'export function write(file) {\n\twriteFileSync(file, "x");\n}\n',
	});
	const report = analyzeStoreLockCensus({ repoRoot: root, roots: [PACKAGE] });
	assert.deepEqual(report.findings, [], "no lock means no rule to break");
	assert.deepEqual(report.skipped, [`${PACKAGE}/plain.ts`], "and the skip is named, not silent");
});

test("@lockFree exempts a writer, and the exemption is reported rather than hidden", (context) => {
	const root = fixture(context, {
		[`${PACKAGE}/store.ts`]: `${GUARDED_STORE}
// @lockFree: appends one byte with O_APPEND, which is atomic below PIPE_BUF.
function recordSomething(file) {
	writeFileSync(file, ".");
}

export function makeStore(directory, file) {
	return { append: () => append(directory, file), drop: () => recordSomething(file) };
}
`,
	});
	const report = analyzeStoreLockCensus({ repoRoot: root, roots: [PACKAGE] });
	assert.deepEqual(report.findings, []);
	assert.deepEqual(
		report.exempt.map(({ symbol }) => symbol),
		["recordSomething"],
	);
});

test("the census reads this repository's guarded stores, so an emptied walk cannot read as clean", () => {
	const report = analyzeStoreLockCensus({ repoRoot: ROOT });
	assert.ok(report.considered.length > 20, "the walk found modules to consider");
	const guarded = report.guarded.map(({ file }) => file);
	// Named rather than counted: these two are the tree's guarded stores today,
	// and a lock helper renamed out of the `with…Lock` shape would silently drop
	// them from the set while every other assertion here still passed.
	assert.ok(
		guarded.includes("packages/ceal-worker-cli/src/receipt-spool.ts"),
		`receipt-spool is a guarded store, saw ${guarded.join(", ")}`,
	);
	assert.ok(
		guarded.includes("packages/ceal-worker-cli/src/profile-store.ts"),
		`profile-store is a guarded store, saw ${guarded.join(", ")}`,
	);
});

// ---------------------------------------------------------- duplicate literal

const LONG = "/^[A-Za-z]{4}-[0-9]{8}-ref$/u";

test("one pattern spelled in two modules is reported; the same pattern twice in one module is not", (context) => {
	const root = fixture(context, {
		[`${PACKAGE}/a.ts`]: `export const A = ${LONG};\nexport const B = ${LONG};\n`,
	});
	assert.deepEqual(analyzeDuplicateLiterals({ repoRoot: root, roots: [PACKAGE] }).findings, [], "one module, one home — nothing to compare");

	const spread = fixture(context, {
		[`${PACKAGE}/a.ts`]: `export const A = ${LONG};\n`,
		[`${PACKAGE}/b.ts`]: `export const B = ${LONG};\n`,
	});
	assert.deepEqual(
		analyzeDuplicateLiterals({ repoRoot: spread, roots: [PACKAGE] }).findings.map(({ literal }) => literal),
		[LONG],
	);
});

test("an idiom below the floor is not a finding and a grammar above it is", (context) => {
	const short = "/^\\d+$/u";
	assert.ok(short.length - 3 < DUPLICATE_LITERAL_MIN_BODY_LENGTH, "the fixture is genuinely below the declared floor");
	const root = fixture(context, {
		[`${PACKAGE}/a.ts`]: `export const A = ${short};\nexport const C = ${LONG};\n`,
		[`${PACKAGE}/b.ts`]: `export const B = ${short};\nexport const D = ${LONG};\n`,
	});
	assert.deepEqual(
		analyzeDuplicateLiterals({ repoRoot: root, roots: [PACKAGE] }).findings.map(({ literal }) => literal),
		[LONG],
		"the floor separates the idiom from the grammar",
	);
});

test("@separateGrammar must be claimed at every site, not one", (context) => {
	const partial = fixture(context, {
		[`${PACKAGE}/a.ts`]: `// @separateGrammar: a coincidence.\nexport const A = ${LONG};\n`,
		[`${PACKAGE}/b.ts`]: `export const B = ${LONG};\n`,
	});
	const report = analyzeDuplicateLiterals({ repoRoot: partial, roots: [PACKAGE] });
	assert.equal(report.findings.length, 1, "tagging one member may not silence the group");
	assert.equal(requiredValue(report.findings[0], "partial_duplicate_finding").partiallyTagged, true);

	const both = fixture(context, {
		[`${PACKAGE}/a.ts`]: `// @separateGrammar: a coincidence.\nexport const A = ${LONG};\n`,
		[`${PACKAGE}/b.ts`]: `// @separateGrammar: also a coincidence.\nexport const B = ${LONG};\n`,
	});
	assert.deepEqual(analyzeDuplicateLiterals({ repoRoot: both, roots: [PACKAGE] }).findings, []);
});

test("the analyzer reads this repository, so a broken glob cannot report zero and read as clean", () => {
	const report = analyzeDuplicateLiterals({ repoRoot: ROOT });
	assert.ok(report.considered.length > 20, `the walk found modules, saw ${report.considered.length}`);
	assert.ok(report.scanned > 5, `and patterns above the floor within them, saw ${report.scanned}`);
});

test("every exemption is still live, and each names the boundary that forbids one home", () => {
	const report = analyzeDuplicateLiterals({ repoRoot: ROOT });
	assert.deepEqual(report.staleExemptions, [], "an exemption whose literal stopped being duplicated has outlived its reason");
	for (const entry of DUPLICATE_LITERAL_EXEMPTIONS) {
		assert.ok(entry.boundary && entry.boundary.length > 20, `${entry.literal} names why one home is impossible`);
		assert.ok(Array.isArray(entry.files) && entry.files.length >= 2, `${entry.literal} pins the exact sites it covers`);
	}
});

// ------------------------------------------------- the second homes, bound

// `@corca-ai/ceal-protocol` owns both grammars below and is an INSTALLED signed
// artifact -- corca-ai/ceal owns it and this repository cannot edit it at all. It
// does not re-export either grammar from its public index, and the client SDK ships
// standalone so it cannot import the worker. The second homes are therefore
// unavoidable, and `AGENTS.md` `## One Fact, One Home` says what that obliges: a
// gate binding the copies, not a note saying they should match. These are that gate.
//
// These read the INSTALLED package rather than a vendored source tree, which is
// what the repository now consumes and therefore the only honest thing to bind
// against. The tarball ships `dist` and `conformance` and no `src`.
//
// The assertions read three separate modules, so none of them can be vacuous the
// way a fixture compared against its own producer was.

test("the safe-ref grammar agrees across the Protocol, the worker and the client", async () => {
	const protocol = await import(path.join(ROOT, PROTOCOL_DIST, "gateway-validation-primitives.js"));
	const worker = await import(path.join(ROOT, "packages/ceal-worker-cli/dist/safe-ref.js"));
	const client = await import(path.join(ROOT, "packages/ceal-client/dist/index.js"));

	assert.equal(worker.CEAL_SAFE_REF.source, protocol.SAFE_REF.source, "the worker's home matches the Protocol's declaration");
	assert.equal(worker.CEAL_SAFE_REF.flags, protocol.SAFE_REF.flags);
	// The client validates a request id against the same grammar and holds the
	// only remaining literal copy of it. Reading it back through the built module
	// rather than the source is what makes this a behavioural binding.
	const oversize = `a${"b".repeat(200)}`;
	await assert.rejects(() => client.createCealClient({ send: async () => ({}) }).request({ request_id: oversize }), TypeError);
	assert.equal(protocol.SAFE_REF.test(oversize), false, "and the Protocol refuses the same input");
	const accepted = `a${"b".repeat(120)}`;
	assert.equal(protocol.SAFE_REF.test(accepted), true, "positive control: the grammar accepts something");
	assert.equal(worker.CEAL_SAFE_REF.test(accepted), true);
	assert.equal(worker.CEAL_SAFE_GATEWAY_CODE.source, protocol.SAFE_CODE.source, "the Worker error-code grammar matches Protocol");
	assert.equal(worker.CEAL_SAFE_GATEWAY_CODE.flags, protocol.SAFE_CODE.flags);
});

test("the Worker direct proof-ref defense agrees with Protocol safe refs", async () => {
	const protocol = await import(path.join(ROOT, PROTOCOL_DIST, "gateway-validation-primitives.js"));
	const worker = await import(path.join(ROOT, "packages/ceal-worker-cli/dist/safe-ref.js"));
	const opaque = "audit:AbcDef123456789012345678";
	assert.doesNotThrow(() => protocol.requireSafeRef(opaque));
	assert.equal(worker.isSafeGatewayProofRef(opaque), true);
	for (const rejected of [`ghp_${"a".repeat(36)}`, "AKIAABCDEFGHIJKLMNOP", "slack:C012345678", "ceal_refresh_" + "r".repeat(43)]) {
		if (!rejected.startsWith("ceal_refresh_")) assert.throws(() => protocol.requireSafeRef(rejected));
		assert.equal(worker.isSafeGatewayProofRef(rejected), false, rejected);
	}
});

test("the Worker direct retry ceiling is bound to the Protocol decoder", () => {
	const limitExpression = (relative: string, name: string): string => {
		const source = readFileSync(path.join(ROOT, relative), "utf8");
		const match = new RegExp(`const ${name} = (?<expression>[^;]+);`, "u").exec(source);
		assert.ok(match?.groups?.expression, `${relative} declares ${name} — re-aim this binding if ownership moves`);
		return match.groups.expression;
	};
	const protocol = limitExpression(`${PROTOCOL_DIST}/index.js`, "MAX_RECOVERY_RETRY_AFTER_MS");
	const worker = limitExpression("packages/ceal-worker-cli/src/call-result-output.ts", "MAX_GATEWAY_RETRY_AFTER_MS");
	assert.equal(worker, protocol, "the direct renderer refuses waits the Protocol decoder would reject");
});

test("the refresh-token grammar agrees across the Protocol, the worker and the client", () => {
	const declarations = [
		`${PROTOCOL_DIST}/personal-client-session.js`,
		`${PROTOCOL_DIST}/enrollment.js`,
		"packages/ceal-worker-cli/src/profile-store.ts",
		"packages/ceal-client/src/personal-client-session-client.ts",
	];
	const pattern = /\/\^ceal_refresh_\[[^\n]*?\$\/u/u;
	const found = declarations.map((relative) => {
		const text = readFileSync(path.join(ROOT, relative), "utf8");
		const match = pattern.exec(text);
		assert.ok(match, `${relative} still declares a refresh-token grammar — if it stopped, this binding needs re-aiming, not deleting`);
		return { relative, literal: match[0] };
	});
	const [first, ...rest] = found;
	const firstFound = requiredValue(first, "refresh_grammar_declaration");
	for (const other of rest) {
		assert.equal(
			other.literal,
			firstFound.literal,
			`${other.relative} disagrees with ${firstFound.relative} about the refresh-token grammar`,
		);
	}
});

test("@separateGrammar covers the statement it sits above and not every literal under it", (context) => {
	// The fresh-eye review's finding, and the fixture is the point: the tag sits
	// on the *function*, so an unbounded ancestor walk reaches it from both
	// literals inside and exempts them together. A tag has to justify a literal,
	// not a region. Written first with the tag on a sibling statement, which
	// could not fail — the walk never reached it from there either way.
	const other = "/^[0-9]{4}-[0-9]{2}-[0-9]{2}T$/u";
	const body = (literalA: string, literalB: string): string =>
		`// @separateGrammar: about the date, not the ref.\nexport function f() {\n\tconst d = ${literalA};\n\tconst r = ${literalB};\n\treturn [d, r];\n}\n`;
	const root = fixture(context, {
		[`${PACKAGE}/a.ts`]: body(other, LONG),
		[`${PACKAGE}/b.ts`]: body(other, LONG),
	});
	const report = analyzeDuplicateLiterals({ repoRoot: root, roots: [PACKAGE] });
	assert.deepEqual(report.exempt, [], "a tag on the enclosing function exempts nothing");
	assert.deepEqual(
		report.findings.map(({ literal }) => literal).sort(),
		[other, LONG].sort(),
		"both duplicated literals are still reported",
	);
});
