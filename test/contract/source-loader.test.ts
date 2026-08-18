import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const LOADER = new URL("../source-loader.ts", import.meta.url);

function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-source-loader-"));
	const packageRoot = path.join(root, "packages", "ceal-client");
	for (const directory of ["ceal-protocol", "ceal-client", "ceal-worker-cli"]) {
		mkdirSync(path.join(root, "packages", directory, "src"), { recursive: true });
	}
	mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
	mkdirSync(path.join(root, "scripts"), { recursive: true });
	writeFileSync(path.join(packageRoot, "src", "index.ts"), 'export const authority: string = "source-v1";\n');
	writeFileSync(path.join(packageRoot, "dist", "index.js"), 'export const authority = "poison-dist";\n');
	return { root, packageRoot };
}

function readAuthority(root: string, specifier: string): string {
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			LOADER.href,
			"--input-type=module",
			"--eval",
			`import(${JSON.stringify(specifier)}).then((value) => process.stdout.write(value.authority))`,
		],
		{
			encoding: "utf8",
			env: { ...process.env, CEAL_SOURCE_TEST_REPO_ROOT: root },
		},
	);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout;
}

function importResult(root: string, specifier: string) {
	return spawnSync(process.execPath, ["--import", LOADER.href, "--input-type=module", "--eval", `import(${JSON.stringify(specifier)})`], {
		encoding: "utf8",
		env: { ...process.env, CEAL_SOURCE_TEST_REPO_ROOT: root },
	});
}

test("source-test loader delegates TypeScript outside package source to native Node loading", () => {
	const { root } = fixture();
	try {
		const nativeOnly = path.join(root, "scripts", "native-only.ts");
		writeFileSync(nativeOnly, "enum NativeOnly { value = 1 }\nconsole.log(NativeOnly.value);\n");
		const result = importResult(root, pathToFileURL(nativeOnly).href);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /TypeScript enum is not supported in strip-only mode/u);

		const prefixSibling = path.join(root, "packages", "ceal-client", "src2", "native-only.ts");
		mkdirSync(path.dirname(prefixSibling), { recursive: true });
		writeFileSync(prefixSibling, "enum NativeOnly { value = 2 }\nconsole.log(NativeOnly.value);\n");
		const siblingResult = importResult(root, `${pathToFileURL(prefixSibling).href}?cache-bust=1`);
		assert.notEqual(siblingResult.status, 0);
		assert.match(siblingResult.stderr, /TypeScript enum is not supported in strip-only mode/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source-test resolver ignores poisoned dist for direct and bare workspace imports", () => {
	const { root, packageRoot } = fixture();
	try {
		assert.equal(readAuthority(root, new URL(`file://${path.join(packageRoot, "dist", "index.js")}`).href), "source-v1");
		assert.equal(readAuthority(root, "@corca-ai/ceal"), "source-v1");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source-test resolver observes an editable-source mutation without a build", () => {
	const { root, packageRoot } = fixture();
	try {
		assert.equal(readAuthority(root, "@corca-ai/ceal"), "source-v1");
		writeFileSync(
			path.join(packageRoot, "src", "index.ts"),
			'enum SourceOnly { value = "source-v2" }\nexport const authority: string = SourceOnly.value;\n',
		);
		assert.equal(readAuthority(root, "@corca-ai/ceal"), "source-v2");
		assert.equal(readAuthority(root, `${pathToFileURL(path.join(packageRoot, "src", "index.ts")).href}?cache-bust=1`), "source-v2");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source-test resolver fails closed when compiled output has no source authority", () => {
	const { root, packageRoot } = fixture();
	try {
		writeFileSync(path.join(packageRoot, "dist", "orphan.js"), "export const orphan = true;\n");
		const result = importResult(root, new URL(`file://${path.join(packageRoot, "dist", "orphan.js")}`).href);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /workspace source authority is missing/u);
		writeFileSync(path.join(packageRoot, "dist", "artifact.json"), "{}\n");
		const compiledData = importResult(root, new URL(`file://${path.join(packageRoot, "dist", "artifact.json")}`).href);
		assert.notEqual(compiledData.status, 0);
		assert.match(compiledData.stderr, /workspace source authority refuses compiled import/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
