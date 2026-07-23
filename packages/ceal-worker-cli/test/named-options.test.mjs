import assert from "node:assert/strict";
import test from "node:test";
import { parseNamedOptions } from "../dist/named-options.js";

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

test("named option parser keeps flags separate from values and operands", () => {
	assert.deepEqual(normalized(["query=ceal", "--fresh", "--target", "target:team-inbox", "--detail"]), {
		values: { "--target": "target:team-inbox" }, flags: ["--fresh", "--detail"], operands: ["query=ceal"],
	});
	assert.equal(normalized(["--fresh", "--fresh"]), null);
});
