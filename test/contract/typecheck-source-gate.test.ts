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
		// Only the authored packages. `packages/ceal-protocol` is deliberately absent:
		// it is an installed signed artifact, and naming it here would make this gate
		// demand that a re-added source tree be typechecked rather than refused.
		["ls-files", "-z", "--", "packages/ceal-client/src", "packages/ceal-worker-cli/src"],
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
	const compiler = path.join(ROOT, "node_modules", ".bin", "tsc");
	return JSON.parse(execFileSync(process.execPath, [compiler, "--showConfig", "-p", typecheckConfigPath], { cwd: ROOT, encoding: "utf8" }));
}

test("source typecheck covers every tracked package TypeScript source", () => {
	const configuredFiles = showConfig()
		.files.map((file: string) => path.normalize(file.replace(/^\.\//u, "")))
		.sort();
	assert.deepEqual(configuredFiles, trackedSourceFiles());
});

test("source typecheck resolves the one owned workspace package to its editable source entrypoint", () => {
	assert.deepEqual(typecheckConfig.compilerOptions.paths, {
		// The Protocol is deliberately absent. It is an installed dependency now, not
		// a workspace, so it resolves to the tarball dist declarations that
		// skipLibCheck skips -- which is what keeps this project ratcheting authored
		// source without ratcheting a package this repository does not own.
		"@corca-ai/ceal": ["./packages/ceal-client/src/index.ts"],
	});
	assert.equal(typecheckConfig.compilerOptions.baseUrl, undefined);
	assert.deepEqual(typecheckConfig.compilerOptions.lib, ["ES2022"]);
	assert.equal(typecheckConfig.compilerOptions.lib.includes("DOM"), false);
	assert.equal(typecheckConfig.compilerOptions.module, "NodeNext");
	assert.equal(typecheckConfig.compilerOptions.moduleResolution, "NodeNext");
	assert.equal(typecheckConfig.compilerOptions.noImplicitOverride, true);
	assert.equal(typecheckConfig.compilerOptions.noFallthroughCasesInSwitch, true);
	assert.equal(typecheckConfig.compilerOptions.noImplicitReturns, true);
	assert.equal(typecheckConfig.compilerOptions.noUnusedLocals, true);
	assert.equal(typecheckConfig.compilerOptions.noUnusedParameters, true);
	assert.equal(typecheckConfig.compilerOptions.noUncheckedIndexedAccess, true);
	assert.equal(typecheckConfig.compilerOptions.exactOptionalPropertyTypes, true);
});

test("explicit any is a native lint error in the Worker full route", () => {
	assert.equal(manifest.scripts.lint, "eslint .");
	assert.match(readFileSync(path.join(ROOT, "eslint.config.ts"), "utf8"), /"@typescript-eslint\/no-explicit-any":\s*"error"/u);
	assert.match(manifest.scripts.check, /^npm run lint &&/u);
});

test("terminating and watch typecheck modes use distinct cache writers", () => {
	const packageTerminating = manifest.scripts["lint:types:packages"];
	const toolsTerminating = manifest.scripts["lint:types:tools"];
	const testsTerminating = manifest.scripts["lint:types:tests"];
	const packageWatch = manifest.scripts["lint:types:watch"];
	const toolsWatch = manifest.scripts["lint:types:tools:watch"];
	const ts6Terminating = manifest.scripts["lint:types:ts6"];
	const terminatingCache = typecheckConfig.compilerOptions.tsBuildInfoFile;
	const toolsTerminatingCache = toolsTypecheckConfig.compilerOptions.tsBuildInfoFile;
	const testsTerminatingCache = testsTypecheckConfig.compilerOptions.tsBuildInfoFile;
	const packageWatchCache = packageWatch.match(/--tsBuildInfoFile\s+(\S+)/u)?.[1];
	const toolsWatchCache = toolsWatch.match(/--tsBuildInfoFile\s+(\S+)/u)?.[1];
	const ts6CacheEntries = [
		...ts6Terminating.matchAll(/tsc6 -p (tsconfig\.(?:typecheck|tools|tests)\.json) --pretty false --tsBuildInfoFile (\S+)/gu),
	].map(([, config, cache]) => ({ config, cache }));
	assert.equal(packageTerminating, "npm run lint:types:raw:packages");
	assert.equal(toolsTerminating, "npm run lint:types:raw:tools");
	assert.equal(testsTerminating, "npm run lint:types:raw:tests");
	assert.equal(manifest.scripts["lint:types:raw:packages"], "tsc -p tsconfig.typecheck.json --pretty false");
	assert.equal(manifest.scripts["lint:types:raw:tools"], "tsc -p tsconfig.tools.json --pretty false");
	assert.equal(manifest.scripts["lint:types:raw:tests"], "tsc -p tsconfig.tests.json --pretty false");
	assert.equal(
		ts6Terminating,
		"tsc6 -p tsconfig.typecheck.json --pretty false --tsBuildInfoFile node_modules/.cache/ceal-typecheck-ts6.tsbuildinfo && tsc6 -p tsconfig.tools.json --pretty false --tsBuildInfoFile node_modules/.cache/ceal-tools-typecheck-ts6.tsbuildinfo && tsc6 -p tsconfig.tests.json --pretty false --tsBuildInfoFile node_modules/.cache/ceal-tests-typecheck-ts6.tsbuildinfo",
	);
	assert.equal(packageWatchCache, "node_modules/.cache/ceal-typecheck-watch.tsbuildinfo");
	assert.equal(toolsWatchCache, "node_modules/.cache/ceal-tools-typecheck-watch.tsbuildinfo");
	assert.deepEqual(ts6CacheEntries, [
		{ config: "tsconfig.typecheck.json", cache: "node_modules/.cache/ceal-typecheck-ts6.tsbuildinfo" },
		{ config: "tsconfig.tools.json", cache: "node_modules/.cache/ceal-tools-typecheck-ts6.tsbuildinfo" },
		{ config: "tsconfig.tests.json", cache: "node_modules/.cache/ceal-tests-typecheck-ts6.tsbuildinfo" },
	]);
	const ts6Caches = ts6CacheEntries.map(({ cache }) => cache);
	assert.equal(new Set(ts6Caches).size, 3);
	assert.equal(ts6Caches.includes(terminatingCache.replace(/^\.\//u, "")), false);
	assert.equal(ts6Caches.includes(toolsTerminatingCache.replace(/^\.\//u, "")), false);
	assert.equal(ts6Caches.includes(testsTerminatingCache.replace(/^\.\//u, "")), false);
	assert.equal(ts6Terminating.includes("--watch"), false);
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
	for (const cache of ts6Caches) assert.match(cache, /^node_modules\/[.]cache\//u);
});

test("test typecheck is strict, source-only, and cached separately", () => {
	assert.equal(testsTypecheckConfig.compilerOptions.strict, true);
	assert.equal(testsTypecheckConfig.compilerOptions.noEmit, true);
	assert.equal(testsTypecheckConfig.compilerOptions.incremental, true);
	assert.equal(testsTypecheckConfig.compilerOptions.module, "NodeNext");
	assert.equal(testsTypecheckConfig.compilerOptions.moduleResolution, "NodeNext");
	assert.equal(testsTypecheckConfig.compilerOptions.allowImportingTsExtensions, true);
	assert.deepEqual(testsTypecheckConfig.compilerOptions.types, ["node"]);
	assert.deepEqual(testsTypecheckConfig.compilerOptions.lib, ["ES2022", "DOM"]);
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
	assert.equal(toolsTypecheckConfig.compilerOptions.noImplicitOverride, true);
	assert.equal(toolsTypecheckConfig.compilerOptions.noFallthroughCasesInSwitch, true);
	assert.equal(toolsTypecheckConfig.compilerOptions.noImplicitReturns, true);
	assert.equal(toolsTypecheckConfig.compilerOptions.noUnusedLocals, true);
	assert.equal(toolsTypecheckConfig.compilerOptions.noUnusedParameters, true);
	assert.equal(toolsTypecheckConfig.compilerOptions.noUncheckedIndexedAccess, true);
	assert.equal(toolsTypecheckConfig.compilerOptions.exactOptionalPropertyTypes, true);
	assert.equal(toolsTypecheckConfig.compilerOptions.skipLibCheck, true);
	assert.equal(toolsTypecheckConfig.compilerOptions.allowImportingTsExtensions, true);
	assert.deepEqual(toolsTypecheckConfig.compilerOptions.types, ["node"]);
	assert.deepEqual(toolsTypecheckConfig.include, ["scripts/**/*.ts", "test/**/*.ts", "types/**/*.d.ts"]);
});

test("the source gate is terminating, source-only, and independent of checkout artifacts", () => {
	assert.equal(typecheckConfig.compilerOptions.noEmit, true);
	assert.equal(manifest.scripts["lint:types"], "npm run lint:types:packages && npm run lint:types:tools && npm run lint:types:tests");
	assert.doesNotMatch(manifest.scripts["lint:types"], /repo-build|npm run build|packages\/[^ ]+\/dist/u);
	assert.doesNotMatch(manifest.scripts["lint:types"], /--watch/u);
	assert.match(manifest.scripts.check, /npm run lint:types/u);
	assert.match(manifest.scripts["check:unit"], /npm run lint:types/u);
});

test("the main type gate delegates each owner to its raw TypeScript compiler route", () => {
	assert.equal(manifest.scripts["lint:types:packages"], "npm run lint:types:raw:packages");
	assert.equal(manifest.scripts["lint:types:tools"], "npm run lint:types:raw:tools");
	assert.equal(manifest.scripts["lint:types:tests"], "npm run lint:types:raw:tests");
	assert.equal(
		manifest.scripts["lint:types:raw"],
		"npm run lint:types:raw:packages && npm run lint:types:raw:tools && npm run lint:types:raw:tests",
	);
	assert.doesNotMatch(JSON.stringify(manifest.scripts), /check-typecheck-ratchet|typecheck-ratchet-baseline/u);
});
