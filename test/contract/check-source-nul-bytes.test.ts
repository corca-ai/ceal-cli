import assert from "node:assert/strict";
import test from "node:test";

import { findSourceNulBytes } from "../../scripts/check-source-nul-bytes.ts";

const NUL = String.fromCharCode(0);

function fixture(files: Record<string, string>) {
	return {
		list: () => Object.keys(files),
		read: (absolutePath: string) => {
			const name = Object.keys(files).find((file) => absolutePath.endsWith(file));
			return name === undefined ? null : (files[name] ?? null);
		},
	};
}

test("a raw NUL byte in tracked source is reported with its line", () => {
	const source =
		["const a = 1;", "const key = " + String.fromCharCode(96) + "$" + "{x}" + NUL + "$" + "{y}" + String.fromCharCode(96) + ";"].join("\n") +
		"\n";
	const { list, read } = fixture({ "scripts/keyed.mjs": source });
	assert.deepEqual(findSourceNulBytes("/repo", list, read), [{ file: "scripts/keyed.mjs", line: 2 }]);
});

test("the six-character source escape is not a finding", () => {
	const source = "const key = " + String.fromCharCode(96) + "$" + "{x}\\u0000$" + "{y}" + String.fromCharCode(96) + ";\n";
	const { list, read } = fixture({ "scripts/keyed.mjs": source });
	assert.deepEqual(findSourceNulBytes("/repo", list, read), []);
});

test("every offending line is reported, not only the first", () => {
	const { list, read } = fixture({
		"scripts/a.mjs": "one" + NUL + "\nclean\nthree" + NUL + "\n",
		"scripts/b.mjs": "clean\n",
	});
	assert.deepEqual(findSourceNulBytes("/repo", list, read), [
		{ file: "scripts/a.mjs", line: 1 },
		{ file: "scripts/a.mjs", line: 3 },
	]);
});

test("an unreadable file is skipped rather than crashing the gate", () => {
	assert.deepEqual(
		findSourceNulBytes(
			"/repo",
			() => ["scripts/gone.mjs"],
			() => null,
		),
		[],
	);
});
