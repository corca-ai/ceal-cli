import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeProductionReachability, productionEntries, workflowConsumers } from "../../scripts/lib/production-reachability.ts";
import { scratchTree } from "../scratch-dir.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fixture(context: TestContext, files: Record<string, string>): string {
	const root = scratchTree(context, "ceal-reach-", files);
	// The analyzer reads this directory whether or not a fixture declares a
	// workflow, so it has to exist even when the file map is silent about it.
	mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
	return root;
}

const MANIFEST = JSON.stringify({ scripts: { build: "node scripts/entry.ts" } });

// The analyzer is proven on trees whose answer is known before it runs. Asserting
// only that this repository reports zero would pass just as well if the walk
// found nothing at all, which is the failure mode that matters: this check exists
// to be the standing signal for a defect coverage cannot see, so a silently
// empty walk would read exactly like a clean tree.
test("an export no production path reaches is reported, and one that is reached is not", (context) => {
	const root = fixture(context, {
		"package.json": MANIFEST,
		"scripts/entry.ts": 'import { used } from "./lib/helper.ts";\nused();\n',
		"scripts/lib/helper.ts": "export function used() {}\nexport function neverCalled() {}\n",
	});
	const { findings } = analyzeProductionReachability({ repoRoot: root, workflows: [] });
	assert.deepEqual(
		findings.map(({ file, symbol }) => `${file}: ${symbol}`),
		["scripts/lib/helper.ts: neverCalled"],
	);
});

test("an export the production graph does not import but its own module calls is not reported", (context) => {
	const root = fixture(context, {
		"package.json": MANIFEST,
		// The surplus-modifier case: `knip`'s question, not this one. Reporting it
		// here would bury the reachability finding under export hygiene.
		"scripts/entry.ts": "export function helper() {}\nhelper();\n",
	});
	assert.deepEqual(analyzeProductionReachability({ repoRoot: root, workflows: [] }).findings, []);
});

test("package artifact edges use current source and never poisoned checkout dist", (context) => {
	const root = fixture(context, {
		"package.json": MANIFEST,
		"scripts/entry.ts": 'import { used } from "../packages/ceal-client/dist/index.js";\nused();\n',
		"packages/ceal-client/dist/index.js": 'throw new Error("poisoned dist executed");\n',
		"packages/ceal-client/src/index.ts": 'import { value } from "./value.js";\nexport function used() { return value; }\n',
		"packages/ceal-client/src/value.ts": 'export const value: string = "source";\n',
	});
	const report = analyzeProductionReachability({ repoRoot: root, workflows: [] });
	assert.deepEqual(report.findings, []);
	assert.ok(report.reachable.includes("packages/ceal-client/src/index.ts"));
	assert.ok(report.reachable.includes("packages/ceal-client/src/value.ts"));
	assert.ok(!report.reachable.includes("packages/ceal-client/dist/index.js"));
});

test("a workspace artifact edge with no source owner fails closed", (context) => {
	const root = fixture(context, {
		"package.json": MANIFEST,
		"scripts/entry.ts": 'import { orphan } from "../packages/ceal-client/dist/orphan.js";\norphan();\n',
		"packages/ceal-client/dist/orphan.js": "export function orphan() {}\n",
	});
	assert.throws(() => analyzeProductionReachability({ repoRoot: root, workflows: [] }), /workspace source authority is missing/u);
});

test("an artifact edge outside declared workspace packages remains literal", (context) => {
	const root = fixture(context, {
		"package.json": MANIFEST,
		"scripts/entry.ts": 'import { used } from "../vendor/example/dist/index.js";\nused();\n',
		"vendor/example/dist/index.js": "export function used() {}\n",
	});
	const report = analyzeProductionReachability({ repoRoot: root, workflows: [] });
	assert.ok(report.reachable.includes("vendor/example/dist/index.js"));
});

test("an inline workflow target uses the same workspace source authority", (context) => {
	const root = fixture(context, {
		"package.json": MANIFEST,
		"scripts/entry.ts": "export function unrelated() {}\nunrelated();\n",
		"packages/ceal-client/dist/index.js": 'throw new Error("poisoned dist executed");\n',
		"packages/ceal-client/src/index.ts": "export function used() {}\n",
	});
	const report = analyzeProductionReachability({
		repoRoot: root,
		workflows: [
			{
				workflow: ".github/workflows/release.yml",
				target: path.join(root, "packages", "ceal-client", "dist", "index.js"),
				names: ["used"],
				namespace: false,
			},
		],
	});
	assert.ok(report.reachable.includes("packages/ceal-client/src/index.ts"));
	assert.ok(!report.reachable.includes("packages/ceal-client/dist/index.js"));
	assert.deepEqual(report.findings, []);
});

test("an inline workflow artifact target without source fails closed", (context) => {
	const root = fixture(context, {
		"package.json": MANIFEST,
		"scripts/entry.ts": "export function unrelated() {}\nunrelated();\n",
		"packages/ceal-client/dist/orphan.js": "export function orphan() {}\n",
	});
	assert.throws(
		() =>
			analyzeProductionReachability({
				repoRoot: root,
				workflows: [
					{
						workflow: ".github/workflows/release.yml",
						target: path.join(root, "packages", "ceal-client", "dist", "orphan.js"),
						names: ["orphan"],
						namespace: false,
					},
				],
			}),
		/workspace source authority is missing/u,
	);
});

test("a module no entry reaches is reported as a file rather than export by export", (context) => {
	const root = fixture(context, {
		"package.json": MANIFEST,
		"scripts/entry.ts": "export function nothing() {}\nnothing();\n",
		"scripts/stranded.ts": "export function alsoStranded() {}\n",
	});
	const report = analyzeProductionReachability({ repoRoot: root, workflows: [] });
	assert.deepEqual(report.unreachableFiles, ["scripts/stranded.ts"]);
	// And not also as an export finding: the file is the actionable statement, and
	// listing every export inside it would be the same defect counted twice.
	assert.deepEqual(report.findings, []);
});

test("the protocol pin exempts only its exact owner-bound test-support file", (context) => {
	const root = fixture(context, {
		"package.json": MANIFEST,
		"protocol-vendor-pin.json": JSON.stringify({ test_support: { vendored_path: "scripts/test-support/base64url.ts" } }),
		"scripts/entry.ts": "export function nothing() {}\nnothing();\n",
		"scripts/test-support/base64url.ts": "export function fixtureOnly() {}\n",
		"scripts/test-support/stranded.ts": "export function stillStranded() {}\n",
	});
	const report = analyzeProductionReachability({ repoRoot: root, workflows: [] });
	assert.deepEqual(report.unreachableFiles, ["scripts/test-support/stranded.ts"]);
});

test("a @testOnly export is exempt, and the tag on one declaration does not cover the next", (context) => {
	const root = fixture(context, {
		"package.json": MANIFEST,
		"scripts/entry.ts": 'import { used } from "./lib/helper.ts";\nused();\n',
		"scripts/lib/helper.ts":
			"export function used() {}\n/**\n * @testOnly\n */\nexport function forTheSuite() {}\nexport function untagged() {}\n",
	});
	const { findings } = analyzeProductionReachability({ repoRoot: root, workflows: [] });
	assert.deepEqual(
		findings.map(({ symbol }) => symbol),
		["untagged"],
	);
});

// A release lane reaching into `scripts/` from an inline `node --input-type=module`
// step is a production caller. Missing it made the check's first run against this
// repository report a symbol the rollback lane depends on, and a check that is
// wrong on its first run is a check that gets turned off.
test("an inline workflow script counts as a production consumer", (context) => {
	const root = fixture(context, {
		"package.json": MANIFEST,
		"scripts/entry.ts": "export function unrelated() {}\nunrelated();\n",
		"scripts/parser.ts": "export function parseInventory() {}\n",
		".github/workflows/release.yml": [
			"jobs:",
			"  publish:",
			"    steps:",
			"      - run: |",
			"          node --input-type=module -e '",
			'            import { readFileSync } from "node:fs";',
			'            import { parseInventory } from "./scripts/parser.ts";',
			"            parseInventory(readFileSync(process.argv[1]));",
			"          ' arg",
		].join("\n"),
	});
	const consumers = workflowConsumers(root);
	// The names must come from the statement that carries the relative specifier.
	// A locator spanning two adjacent imports attributes `readFileSync` here, and
	// then the symbol the lane actually needs still reads as unreached.
	assert.deepEqual(
		consumers.map(({ names }) => names),
		[["parseInventory"]],
	);
	const report = analyzeProductionReachability({ repoRoot: root });
	assert.deepEqual(report.findings, []);
	assert.deepEqual(report.unreachableFiles, []);
});

// The gate itself. Every assertion above proves the analyzer can speak; this one
// is the repository's answer, and the two guards below keep a zero from meaning
// "the walk found nothing to look at".
test("this repository has no production-unreachable script surface", () => {
	const report = analyzeProductionReachability({ repoRoot: ROOT });
	assert.ok(report.entries.length > 5, `only ${report.entries.length} entries resolved; this gate would be near-vacuous`);
	assert.ok(report.reachable.length >= report.entries.length, "the walk reached fewer modules than it started from");
	assert.deepEqual(report.unreachableFiles, [], "no production entry reaches these files");
	assert.deepEqual(
		report.findings.map(({ file, line, symbol }) => `${file}:${line} ${symbol}`),
		[],
		"exported and reached by no production path: wire it in, mark it @testOnly, or delete it",
	);
});

test("the manifest is what declares an entry, so an undeclared script is not one", () => {
	const entries = productionEntries(ROOT).map((absolute) => path.relative(ROOT, absolute));
	// Sampled rather than listed in full: the point is that the manifest is read,
	// not that this file keeps a second copy of it.
	assert.ok(entries.includes("scripts/probe-surface.ts"), "a declared npm-script entry must resolve");
	assert.ok(!entries.includes("scripts/lib/exit-with.ts"), "a library reached only by import is not an entry");
});
