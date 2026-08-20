import { parseNpmPackMetadata } from "../scripts/lib/npm-pack-metadata.ts";
import assert from "node:assert/strict";
import test from "node:test";

const entry = {
	name: "@corca-ai/example",
	version: "1.2.3",
	filename: "corca-ai-example-1.2.3.tgz",
	integrity: "sha512-YWJjZA==",
	shasum: "a".repeat(40),
};

test("parses legacy npm pack array", () => assert.deepEqual(parseNpmPackMetadata([entry]), entry));
test("parses npm 12 package-name keyed object", () => assert.deepEqual(parseNpmPackMetadata({ [entry.name]: entry }), entry));

for (const [label, value] of [
	["invalid JSON value", "not-json"],
	["empty array", []],
	["multiple array entries", [entry, entry]],
	["empty package map", {}],
	["multiple package map entries", { [entry.name]: entry, other: entry }],
	["key mismatch", { wrong: entry }],
	["missing name", [{ ...entry, name: undefined }]],
	["non-string version", [{ ...entry, version: 1 }]],
	["missing filename", [{ ...entry, filename: undefined }]],
	["path traversal", [{ ...entry, filename: "../escape.tgz" }]],
	["absolute filename", [{ ...entry, filename: "/tmp/escape.tgz" }]],
	["malformed integrity", [{ ...entry, integrity: "sha256-nope" }]],
	["malformed shasum", [{ ...entry, shasum: "nope" }]],
] as const) {
	test(`rejects ${label}`, () => assert.throws(() => parseNpmPackMetadata(value)));
}
