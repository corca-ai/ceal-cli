import { allMarkdownFiles, isGeneralMarkdown, main, MARKDOWN_EXCLUSIONS, stagedMarkdownFiles } from "../../scripts/check-markdown.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);

function fixture(context: { after: (callback: () => void) => void }): string {
	const root = mkdtempSync(path.join(os.tmpdir(), "ceal-worker-markdown-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "-q", "-b", "main", root], { stdio: "pipe" });
	symlinkSync(path.join(ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
	cpSync(path.join(ROOT, ".markdownlint-cli2.jsonc"), path.join(root, ".markdownlint-cli2.jsonc"));
	return root;
}

function stage(root: string, relativePath: string, contents: string): void {
	const absolute = path.join(root, relativePath);
	mkdirSync(path.dirname(absolute), { recursive: true });
	writeFileSync(absolute, contents);
	execFileSync("git", ["add", relativePath], { cwd: root, stdio: "pipe" });
}

test("the local scope selects general Markdown and excludes artifacts", (context) => {
	const root = fixture(context);
	stage(root, "README.md", "# Good\n\nText.\n");
	stage(root, "charness-artifacts/ignored.md", "# Bad\n\n\nText.\n");
	assert.deepEqual(stagedMarkdownFiles(root), ["README.md"]);
	assert.deepEqual(allMarkdownFiles(root), ["README.md"]);
	assert.equal(isGeneralMarkdown("docs/gates.md"), true);
	assert.equal(isGeneralMarkdown("charness-artifacts/ignored.md"), false);
	assert.deepEqual(MARKDOWN_EXCLUSIONS, ["charness-artifacts/", ".charness/", ".cautilus/", ".pytest_cache/"]);
});

test("the staged route blocks a real Markdown violation", async (context) => {
	const root = fixture(context);
	stage(root, "README.md", "# Broken\n\n\nText.\n");
	assert.equal(await main(root, ["--staged"]), 1);
});

test("the staged route fails closed when its local policy is absent", async (context) => {
	const root = mkdtempSync(path.join(os.tmpdir(), "ceal-worker-markdown-no-policy-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "-q", "-b", "main", root], { stdio: "pipe" });
	stage(root, "README.md", "# Good\n\nText.\n");
	assert.equal(await main(root, ["--staged"]), 2);
});

test("package, full-check, and pre-commit contracts expose both routes", () => {
	const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
	assert.equal(manifest.scripts["lint:markdown"], "node scripts/check-markdown.ts --all");
	assert.equal(manifest.scripts["lint:markdown:staged"], "node scripts/check-markdown.ts --staged");
	assert.match(manifest.scripts.check, /npm run lint:markdown/u);
	assert.match(manifest.scripts["check:unit"], /npm run lint:markdown/u);
	const hook = readFileSync(path.join(ROOT, ".githooks/pre-commit"), "utf8");
	assert.match(hook, /^run_gate "markdown" npm run lint:markdown:staged$/mu);
	const source = readFileSync(path.join(ROOT, "scripts/check-markdown.ts"), "utf8");
	assert.match(source, /markdownlint only/u);
	assert.doesNotMatch(source, /check_doc_authoring_preflight/u);
});
