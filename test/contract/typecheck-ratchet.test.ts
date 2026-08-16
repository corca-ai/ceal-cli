import assert from "node:assert/strict";
import test from "node:test";
import { isKnownContinuation, parseDiagnostics, ratchetViolations, validateBaseline } from "../../scripts/check-typecheck-ratchet.ts";

const root = "/checkout";

test("typecheck ratchet accepts an unchanged known-red baseline", () => {
	const baseline = parseDiagnostics("/checkout/a.ts(1,1): error TS7006: implicit any\n/checkout/b.ts(2,3): error TS2339: missing\n", root);
	assert.deepEqual(ratchetViolations(baseline, baseline), []);
});

test("typecheck ratchet rejects diagnostic migration between known files", () => {
	const baseline = parseDiagnostics("/checkout/a.ts(1,1): error TS7006: implicit any\n", root);
	const migrated = parseDiagnostics("/checkout/b.ts(1,1): error TS7006: implicit any\n", root);
	assert.deepEqual(ratchetViolations(baseline, migrated), [
		"baseline_reduction_required a.ts::TS7006: 0 < baseline 1",
		"diagnostic b.ts::TS7006: 1 > baseline 0",
		"new failing file: b.ts",
	]);
});

test("typecheck ratchet requires an explicit baseline update for reductions", () => {
	const baseline = parseDiagnostics("/checkout/a.ts(1,1): error TS7006: implicit any\n/checkout/a.ts(2,1): error TS7006: another\n", root);
	const improved = parseDiagnostics("/checkout/a.ts(1,1): error TS7006: implicit any\n", root);
	assert.deepEqual(ratchetViolations(baseline, improved), ["baseline_reduction_required a.ts::TS7006: 1 < baseline 2"]);
});

test("typecheck ratchet rejects new files and diagnostic codes", () => {
	const baseline = parseDiagnostics("/checkout/a.ts(1,1): error TS7006: implicit any\n", root);
	const current = parseDiagnostics(
		"/checkout/a.ts(1,1): error TS7006: implicit any\n/checkout/a.ts(2,1): error TS2339: missing\n/checkout/new.ts(1,1): error TS2345: bad\n",
		root,
	);
	assert.deepEqual(ratchetViolations(baseline, current), [
		"diagnostic a.ts::TS2339: 1 > baseline 0",
		"diagnostic new.ts::TS2345: 1 > baseline 0",
		"new failing file: new.ts",
	]);
});

test("diagnostic parsing is sorted, relative, and reports global errors", () => {
	const snapshot = parseDiagnostics(
		"error TS5058: The specified path does not exist.\n/checkout/z.ts(1,1): error TS2339: z\n/checkout/a.ts(1,1): error TS7006: a\n/checkout/a.ts(2,1): error TS7006: b\n",
		root,
	);
	assert.deepEqual(snapshot.files, ["a.ts", "z.ts"]);
	assert.deepEqual(snapshot.diagnosticsByFile, { "a.ts": { TS7006: 2 }, "z.ts": { TS2339: 1 } });
	assert.deepEqual(snapshot.unparsed, ["error TS5058: The specified path does not exist."]);
});

test("a parsed diagnostic plus compiler fatal output remains unparsed", () => {
	const snapshot = parseDiagnostics("/checkout/a.ts(1,1): error TS7006: implicit any\n  FATAL compiler crash\n", root);
	assert.deepEqual(snapshot.files, ["a.ts"]);
	assert.deepEqual(snapshot.unparsed, ["  FATAL compiler crash"]);
});

test("continuation grammar accepts current TS7 samples but rejects arbitrary suffixes", () => {
	const samples = [
		"  Argument of type 'string' is not assignable to parameter of type 'number'.",
		"  No index signature with a parameter of type 'string' was found on type '{ repository: string; }'.",
		"  Not all constituents of type 'string | (() => unknown)' are callable.",
		"  Property 'source' does not exist on type 'string'.",
		"  Target signature provides too few arguments. Expected 1 or more, but got 0.",
		"  The last overload gave the following error.",
		"  The types of property 'access' are incompatible.",
		"  Type 'null' is not assignable to type 'object'.",
		"  Types of property 'status' are incompatible.",
	];
	for (const sample of samples) {
		assert.equal(isKnownContinuation(sample), true, sample);
		assert.equal(isKnownContinuation(`${sample} FATAL compiler crash`), false, sample);
	}
});

test("baseline validation rejects malformed, unsorted, and non-portable data", () => {
	assert.throws(() => validateBaseline({ version: 1, compiler: "typescript@6", projects: {} }));
	assert.throws(() =>
		validateBaseline({
			version: 1,
			compiler: "typescript@7",
			projects: {
				packages: { config: "tsconfig.typecheck.json", files: ["../outside.ts"], diagnosticsByFile: { "../outside.ts": { TS7006: 1 } } },
				tools: { config: "tsconfig.tools.json", files: [], diagnosticsByFile: {} },
				tests: { config: "tsconfig.tests.json", files: [], diagnosticsByFile: {} },
			},
		}),
	);
});
