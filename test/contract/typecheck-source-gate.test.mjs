import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const typecheckConfigPath = path.join(ROOT, "tsconfig.typecheck.json");
const typecheckConfig = JSON.parse(readFileSync(typecheckConfigPath, "utf8"));

function trackedSourceFiles() {
	return execFileSync(
		"git",
		["ls-files", "-z", "--", "packages/ceal-protocol/src", "packages/ceal-client/src", "packages/ceal-worker-cli/src"],
		{
			cwd: ROOT,
			encoding: "buffer",
		},
	)
		.toString("utf8")
		.split("\0")
		.filter(Boolean)
		.filter((file) => file.endsWith(".ts"))
		.sort();
}

function showConfig() {
	const compiler = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
	return JSON.parse(execFileSync(process.execPath, [compiler, "--showConfig", "-p", typecheckConfigPath], { cwd: ROOT, encoding: "utf8" }));
}

test("source typecheck covers every tracked package TypeScript source", () => {
	const configuredFiles = showConfig()
		.files.map((file) => path.normalize(file.replace(/^\.\//u, "")))
		.sort();
	assert.deepEqual(configuredFiles, trackedSourceFiles());
});

test("source typecheck resolves workspace packages to exact editable source entrypoints", () => {
	assert.deepEqual(typecheckConfig.compilerOptions.paths, {
		"@corca-ai/ceal-protocol": ["packages/ceal-protocol/src/index.ts"],
		"@corca-ai/ceal": ["packages/ceal-client/src/index.ts"],
	});
	assert.equal(typecheckConfig.compilerOptions.baseUrl, ".");
	assert.equal(typecheckConfig.compilerOptions.module, "NodeNext");
	assert.equal(typecheckConfig.compilerOptions.moduleResolution, "NodeNext");
});

test("terminating and watch typecheck modes use distinct cache writers", () => {
	const terminating = manifest.scripts["lint:types"];
	const watch = manifest.scripts["lint:types:watch"];
	const terminatingCache = typecheckConfig.compilerOptions.tsBuildInfoFile;
	const watchCache = watch.match(/--tsBuildInfoFile\s+(\S+)/u)?.[1];
	assert.equal(terminating, "tsc -p tsconfig.typecheck.json --pretty false");
	assert.equal(watchCache, "node_modules/.cache/ceal-typecheck-watch.tsbuildinfo");
	assert.notEqual(terminatingCache, watchCache);
	assert.match(terminatingCache, /^\.\/node_modules\/[.]cache\//u);
	assert.match(watchCache, /^node_modules\/[.]cache\//u);
});

test("the source gate is terminating, source-only, and independent of checkout artifacts", () => {
	assert.equal(typecheckConfig.compilerOptions.noEmit, true);
	assert.doesNotMatch(manifest.scripts["lint:types"], /repo-build|npm run build|packages\/[^ ]+\/dist/u);
	assert.doesNotMatch(manifest.scripts["lint:types"], /--watch/u);
	assert.match(manifest.scripts.check, /npm run lint:types/u);
	assert.match(manifest.scripts["check:unit"], /npm run lint:types/u);
});
