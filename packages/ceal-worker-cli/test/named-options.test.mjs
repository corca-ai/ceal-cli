import assert from "node:assert/strict";
import test from "node:test";
import { parseNamedOptions } from "../dist/named-options.js";

const VALUE_OPTIONS = new Set(["--target", "--profile"]);

function normalized(options) {
	const parsed = parseNamedOptions(options, VALUE_OPTIONS, new Set());
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
