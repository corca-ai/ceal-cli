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
const toolsTypecheckConfigPath = path.join(ROOT, "tsconfig.tools.json");
const toolsTypecheckConfig = JSON.parse(readFileSync(toolsTypecheckConfigPath, "utf8"));
const testsTypecheckConfigPath = path.join(ROOT, "tsconfig.tests.json");
const testsTypecheckConfig = JSON.parse(readFileSync(testsTypecheckConfigPath, "utf8"));

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
	const packageTerminating = manifest.scripts["lint:types:packages"];
	const toolsTerminating = manifest.scripts["lint:types:tools"];
	const testsTerminating = manifest.scripts["lint:types:tests"];
	const packageWatch = manifest.scripts["lint:types:watch"];
	const toolsWatch = manifest.scripts["lint:types:tools:watch"];
	const terminatingCache = typecheckConfig.compilerOptions.tsBuildInfoFile;
	const toolsTerminatingCache = toolsTypecheckConfig.compilerOptions.tsBuildInfoFile;
	const testsTerminatingCache = testsTypecheckConfig.compilerOptions.tsBuildInfoFile;
	const packageWatchCache = packageWatch.match(/--tsBuildInfoFile\s+(\S+)/u)?.[1];
	const toolsWatchCache = toolsWatch.match(/--tsBuildInfoFile\s+(\S+)/u)?.[1];
	assert.equal(packageTerminating, "tsc -p tsconfig.typecheck.json --pretty false");
	assert.equal(toolsTerminating, "tsc -p tsconfig.tools.json --pretty false");
	assert.equal(testsTerminating, "tsc -p tsconfig.tests.json --pretty false");
	assert.equal(packageWatchCache, "node_modules/.cache/ceal-typecheck-watch.tsbuildinfo");
	assert.equal(toolsWatchCache, "node_modules/.cache/ceal-tools-typecheck-watch.tsbuildinfo");
	assert.notEqual(terminatingCache, packageWatchCache);
	assert.notEqual(toolsTerminatingCache, toolsWatchCache);
	assert.notEqual(terminatingCache, toolsTerminatingCache);
	assert.notEqual(terminatingCache, testsTerminatingCache);
	assert.notEqual(toolsTerminatingCache, testsTerminatingCache);
	assert.match(terminatingCache, /^\.\/node_modules\/[.]cache\//u);
	assert.match(toolsTerminatingCache, /^\.\/node_modules\/[.]cache\//u);
	assert.match(testsTerminatingCache, /^\.\/node_modules\/[.]cache\//u);
	assert.match(packageWatchCache, /^node_modules\/[.]cache\//u);
	assert.match(toolsWatchCache, /^node_modules\/[.]cache\//u);
});

test("test typecheck is strict, source-only, and cached separately", () => {
	assert.equal(testsTypecheckConfig.compilerOptions.strict, true);
	assert.equal(testsTypecheckConfig.compilerOptions.noEmit, true);
	assert.equal(testsTypecheckConfig.compilerOptions.incremental, true);
	assert.equal(testsTypecheckConfig.compilerOptions.module, "NodeNext");
	assert.equal(testsTypecheckConfig.compilerOptions.moduleResolution, "NodeNext");
	assert.equal(testsTypecheckConfig.compilerOptions.allowImportingTsExtensions, true);
	assert.deepEqual(testsTypecheckConfig.compilerOptions.types, ["node"]);
	assert.deepEqual(testsTypecheckConfig.include, ["packages/*/test/**/*.ts"]);
	assert.doesNotMatch(JSON.stringify(testsTypecheckConfig.compilerOptions), /erasableSyntaxOnly/u);
});

test("tools typecheck is strict, source-only, and owns tracked tool TypeScript", () => {
	assert.equal(toolsTypecheckConfig.compilerOptions.strict, true);
	assert.equal(toolsTypecheckConfig.compilerOptions.erasableSyntaxOnly, true);
	assert.equal(toolsTypecheckConfig.compilerOptions.noEmit, true);
	assert.equal(toolsTypecheckConfig.compilerOptions.incremental, true);
	assert.equal(toolsTypecheckConfig.compilerOptions.module, "NodeNext");
	assert.equal(toolsTypecheckConfig.compilerOptions.moduleResolution, "NodeNext");
	assert.equal(toolsTypecheckConfig.compilerOptions.allowImportingTsExtensions, true);
	assert.deepEqual(toolsTypecheckConfig.compilerOptions.types, ["node"]);
	assert.deepEqual(toolsTypecheckConfig.include, ["scripts/**/*.ts", "test/**/*.ts"]);
});

test("the source gate is terminating, source-only, and independent of checkout artifacts", () => {
	assert.equal(typecheckConfig.compilerOptions.noEmit, true);
	assert.equal(manifest.scripts["lint:types"], "npm run lint:types:packages && npm run lint:types:tools && npm run lint:types:tests");
	assert.doesNotMatch(manifest.scripts["lint:types"], /repo-build|npm run build|packages\/[^ ]+\/dist/u);
	assert.doesNotMatch(manifest.scripts["lint:types"], /--watch/u);
	assert.match(manifest.scripts.check, /npm run lint:types/u);
	assert.match(manifest.scripts["check:unit"], /npm run lint:types/u);
});
