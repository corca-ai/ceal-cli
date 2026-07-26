import assert from "node:assert/strict";
import test from "node:test";
import { parseNamedOptions, unknownNamedOption } from "../dist/named-options.js";

const VALUE_OPTIONS = new Set(["--target", "--profile"]);
const FLAG_OPTIONS = new Set(["--fresh", "--detail"]);

function normalized(options) {
	const parsed = parseNamedOptions(options, VALUE_OPTIONS, FLAG_OPTIONS);
	return parsed && {
		values: Object.fromEntries(parsed.values),
		flags: [...parsed.flags],
		operands: parsed.operands,
	};
}

test("named options are normalized independently of their placement among operands", () => {
	const expected = {
		values: { "--target": "target:team-inbox", "--profile": "profile:work" },
		flags: [], operands: ["query=ceal", "limit=1"],
	};
	assert.deepEqual(normalized(["--target", "target:team-inbox", "query=ceal", "--profile", "profile:work", "limit=1"]), expected);
	assert.deepEqual(normalized(["--profile", "profile:work", "query=ceal", "--target", "target:team-inbox", "limit=1"]), expected);
});

test("named option parser rejects ambiguous or unsupported option forms", () => {
	assert.equal(normalized(["--target", "target:team-inbox", "--target", "target:other"]), null);
	assert.equal(normalized(["--target", "--profile", "profile:work"]), null);
	assert.equal(normalized(["--target", "target:team-inbox", "--unknown", "value"]), null);
	assert.equal(normalized(["--target", "target:team-inbox", "--", "query=ceal"]), null);
});

test("named option values may use non-grammar option-looking text", () => {
	assert.deepEqual(normalized(["--target", "--literal"]), {
		values: { "--target": "--literal" }, flags: [], operands: [],
	});
	assert.deepEqual(normalized(["--target", "--"]), {
		values: { "--target": "--" }, flags: [], operands: [],
	});
});

test("named option parser keeps flags separate from values and operands", () => {
	assert.deepEqual(normalized(["query=ceal", "--fresh", "--target", "target:team-inbox", "--detail"]), {
		values: { "--target": "target:team-inbox" }, flags: ["--fresh", "--detail"], operands: ["query=ceal"],
	});
	assert.equal(normalized(["--fresh", "--fresh"]), null);
});

// A refusal that cannot name the offending option pushes the reader toward
// whatever the caller was about to build instead of the token they typed.
test("the unknown-option reader names the first undeclared option only", () => {
	assert.equal(unknownNamedOption(["--target", "target:x"], VALUE_OPTIONS, FLAG_OPTIONS), null);
	assert.equal(unknownNamedOption(["--bogus"], VALUE_OPTIONS, FLAG_OPTIONS), "--bogus");
	assert.equal(unknownNamedOption(["--fresh", "--bogus", "--other"], VALUE_OPTIONS, FLAG_OPTIONS), "--bogus");
	// A declared option's value is consumed, so a value that looks like an
	// option is not misreported as the unknown one.
	assert.equal(unknownNamedOption(["--target", "--detail"], VALUE_OPTIONS, FLAG_OPTIONS), null);
	// Operands are not options, and a grammar whose only fault is a duplicate or
	// a missing value has no unknown option to name.
	assert.equal(unknownNamedOption(["query=ceal"], VALUE_OPTIONS, FLAG_OPTIONS), null);
	assert.equal(unknownNamedOption(["--fresh", "--fresh"], VALUE_OPTIONS, FLAG_OPTIONS), null);
});
