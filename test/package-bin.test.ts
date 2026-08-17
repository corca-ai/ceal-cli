import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolvePackageBin } from "../scripts/lib/package-bin.ts";

test("package bin resolver accepts the native TypeScript tsc entrypoint", () => {
	const root = path.resolve("node_modules", "@typescript", "native");
	assert.equal(resolvePackageBin(root), path.join(root, "bin", "tsc"));
});

test("package bin resolver rejects unsafe entrypoints and symlinks", (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-package-bin-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(path.join(root, "bin"));
	writeFileSync(path.join(root, "package.json"), JSON.stringify({ bin: { tsc: "../escape" } }));
	assert.throws(() => resolvePackageBin(root), /unsafe|escapes/u);
	writeFileSync(path.join(root, "package.json"), JSON.stringify({ bin: { tsc: "bin/tsc" } }));
	writeFileSync(path.join(root, "outside.js"), "");
	symlinkSync(path.join(root, "outside.js"), path.join(root, "bin", "tsc"));
	assert.throws(() => resolvePackageBin(root), /symbolic/u);
});
