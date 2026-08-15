import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { applyConversion, parseArgs, planConversion } from "../../scripts/convert-legacy-mjs.ts";

test("converter dry-run is bounded, policy-selected, and non-mutating", () => {
	const policy = readFileSync("config/no-legacy-mjs.json", "utf8");
	const result = spawnSync(process.execPath, ["scripts/convert-legacy-mjs.ts", "--path-prefix", "scripts/", "--limit", "1"], {
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
	const plan = JSON.parse(result.stdout) as { dry_run: boolean; converted: string[] };
	assert.equal(plan.dry_run, true);
	assert.equal(plan.converted.length, 1);
	assert.match(plan.converted[0], /^scripts\/.+\.mjs$/u);
	assert.equal(readFileSync("config/no-legacy-mjs.json", "utf8"), policy);
});

test("converter rejects non-canonical or unsafe limits", () => {
	for (const value of ["0", "01", "1.0", "9007199254740992"]) {
		const result = spawnSync(process.execPath, ["scripts/convert-legacy-mjs.ts", "--limit", value], { encoding: "utf8" });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /canonical positive safe integer/u);
	}
});

function fixture(policyEntries = ["scripts/convert.mjs"]): string {
	const root = mkdtempSync(join(tmpdir(), "ceal-agent-convert-fixture-"));
	mkdirSync(join(root, "scripts"));
	mkdirSync(join(root, "config"));
	mkdirSync(join(root, "refs"));
	writeFileSync(join(root, "scripts/convert.mjs"), "export const converted = true;\n");
	writeFileSync(
		join(root, "config/no-legacy-mjs.json"),
		`${JSON.stringify({ schema_version: "ceal.no_legacy_mjs.v1", files: policyEntries.sort() }, null, "\t")}\n`,
	);
	writeFileSync(
		join(root, "config/test-lanes.json"),
		JSON.stringify({ selected: "scripts\\\\convert.mjs", query: "scripts/convert.mjs?cache=1", fragment: "scripts/convert.mjs#part" }),
	);
	writeFileSync(join(root, "config/other.json"), JSON.stringify({ selected: "scripts/convert.mjs" }));
	writeFileSync(join(root, "refs/invalid.bin"), Buffer.from([0xc3, 0x28]));
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
	execFileSync("git", ["-C", root, "config", "user.name", "Ceal Agent test"]);
	execFileSync("git", ["-C", root, "add", "-A"]);
	return root;
}

test("apply rewrites resolved Windows references but leaves query, fragment, binary, and symlink files alone", (context) => {
	const root = fixture();
	context.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(root, "refs/target.txt"), "outside\n");
	symlinkSync(join(root, "refs/target.txt"), join(root, "refs/symlink.txt"));
	execFileSync("git", ["-C", root, "add", "-A"]);
	const stagedBefore = execFileSync("git", ["-C", root, "diff", "--cached", "--raw"], { encoding: "utf8" });
	chmodSync(join(root, "config/other.json"), 0o755);
	chmodSync(join(root, "config/no-legacy-mjs.json"), 0o750);
	const plan = planConversion(root, "scripts\\", 1);
	applyConversion(plan);
	assert.equal(existsSync(join(root, "scripts/convert.mjs")), false);
	assert.equal(existsSync(join(root, "scripts/convert.ts")), true);
	const lanes = readFileSync(join(root, "config/test-lanes.json"), "utf8");
	assert.equal((JSON.parse(lanes) as { selected: string }).selected, "scripts\\\\convert.ts");
	assert.match(lanes, /scripts\/convert\.mjs\?cache=1/u);
	assert.match(lanes, /scripts\/convert\.mjs#part/u);
	assert.equal(readFileSync(join(root, "refs/invalid.bin")).toString("hex"), "c328");
	assert.equal(lstatSync(join(root, "config/other.json")).mode & 0o7777, 0o755);
	assert.equal(lstatSync(join(root, "config/no-legacy-mjs.json")).mode & 0o7777, 0o750);
	assert.deepEqual(
		readdirSync(root).filter((entry) => entry.startsWith(".ceal-legacy-mjs-")),
		[],
	);
	assert.equal(execFileSync("git", ["-C", root, "diff", "--cached", "--raw"], { encoding: "utf8" }), stagedBefore);
	assert.deepEqual(plan.skippedNonText, ["refs/invalid.bin"]);
});

test("preflight refuses a missing later source without mutating an earlier valid source", (context) => {
	const root = fixture(["scripts/convert.mjs", "scripts/missing.mjs"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	assert.throws(() => planConversion(root, "scripts", 2), /legacy_mjs_policy_drift/u);
	assert.equal(existsSync(join(root, "scripts/convert.mjs")), true);
	assert.equal(existsSync(join(root, "scripts/convert.ts")), false);
});

test("preflight rejects a selected source symlink even when its target is inside another tree", (context) => {
	const root = fixture();
	const outside = mkdtempSync(join(tmpdir(), "ceal-agent-source-link-"));
	writeFileSync(join(outside, "convert.mjs"), "outside\n");
	rmSync(join(root, "scripts/convert.mjs"));
	symlinkSync(join(outside, "convert.mjs"), join(root, "scripts/convert.mjs"));
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	});
	assert.throws(() => planConversion(root, "scripts", 1), /conversion_source_invalid/u);
});

test("preflight rejects a selected source whose parent directory resolves outside the root", (context) => {
	const root = fixture(["links/convert.mjs", "scripts/convert.mjs"]);
	const outside = mkdtempSync(join(tmpdir(), "ceal-agent-outside-"));
	writeFileSync(join(outside, "convert.mjs"), "outside\n");
	mkdirSync(join(root, "links"));
	rmSync(join(root, "links"), { recursive: true, force: true });
	symlinkSync(outside, join(root, "links"), "dir");
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	});
	assert.throws(() => planConversion(root, "links", 1), /legacy_mjs_policy_drift|conversion_source_invalid|conversion_path_escape/u);
});

test("apply rechecks a reference parent realpath immediately before writing", (context) => {
	const root = fixture();
	const outside = mkdtempSync(join(tmpdir(), "ceal-agent-reference-outside-"));
	writeFileSync(join(root, "refs/reference.json"), JSON.stringify({ selected: "scripts/convert.mjs" }));
	execFileSync("git", ["-C", root, "add", "-A"]);
	const plan = planConversion(root, "scripts", 1);
	rmSync(join(root, "refs"), { recursive: true, force: true });
	symlinkSync(outside, join(root, "refs"), "dir");
	context.after(() => {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	});
	assert.throws(() => applyConversion(plan), /conversion_path_escape|conversion_transaction_failed/u);
	assert.equal(existsSync(join(root, "scripts/convert.mjs")), true);
});

test("malformed policy and target collisions fail closed", (context) => {
	const root = fixture();
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const policyPath = join(root, "config/no-legacy-mjs.json");
	writeFileSync(policyPath, JSON.stringify({ schema_version: "ceal.no_legacy_mjs.v1", files: ["scripts/convert.mjs"], extra: true }));
	assert.throws(() => planConversion(root, "scripts", 1), /legacy_mjs_policy_wrong_shape/u);
	writeFileSync(policyPath, `${JSON.stringify({ schema_version: "ceal.no_legacy_mjs.v1", files: ["scripts/convert.mjs"] })}\n`);
	writeFileSync(join(root, "scripts/convert.ts"), "collision\n");
	assert.throws(() => planConversion(root, "scripts", 1), /conversion_target_collision/u);
	rmSync(join(root, "scripts/convert.ts"));
	symlinkSync(join(root, "scripts/no-such-target.ts"), join(root, "scripts/convert.ts"));
	assert.throws(() => planConversion(root, "scripts", 1), /conversion_target_collision/u);
});

test("full policy drift rejects an additional tracked legacy file before prefix selection", (context) => {
	const root = fixture();
	context.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(root, "scripts/extra.mjs"), "extra\n");
	execFileSync("git", ["-C", root, "add", "-A"]);
	assert.throws(() => planConversion(root, "scripts/convert", 1), /legacy_mjs_policy_drift:additions=scripts\/extra\.mjs/u);
	assert.equal(existsSync(join(root, "scripts/convert.mjs")), true);
});

test("dry-run output reports skipped non-text files without touching them", (context) => {
	const root = fixture();
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const result = spawnSync(
		process.execPath,
		[resolve("scripts/convert-legacy-mjs.ts"), "--repo-root", root, "--path-prefix", "scripts", "--limit", "1", "--dry-run"],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	const output = JSON.parse(result.stdout) as { skipped_non_text: string[] };
	assert.deepEqual(output.skipped_non_text, ["refs/invalid.bin"]);
});

test("static templates and path.join references are planned like the real agent-prompting source", (context) => {
	const root = fixture();
	writeFileSync(
		join(root, "refs/agent-prompting.ts"),
		'const joined = join("scripts", "convert.mjs");\nconst templated = `scripts/convert.mjs`;\n',
	);
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = planConversion(root, "scripts", 1);
	const reference = plan.references.find((entry) => entry.file === "refs/agent-prompting.ts");
	assert.equal(reference?.rewrites, 2);
	assert.equal(
		reference?.after.toString("utf8"),
		'const joined = join("scripts", "convert.ts");\nconst templated = `scripts/convert.ts`;\n',
	);
	assert.deepEqual(plan.unresolvedReferences, []);
});

test("the exact policy authority is never treated as a reference", (context) => {
	const root = fixture();
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = planConversion(root, "scripts", 1);
	assert.equal(
		plan.references.some((entry) => entry.file === "config/no-legacy-mjs.json"),
		false,
	);
	assert.deepEqual(
		plan.references.map((entry) => entry.file),
		["config/other.json", "config/test-lanes.json"],
	);
});

test("policy validation retains the canonical checker invariants", (context) => {
	const root = fixture();
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const policyPath = join(root, "config/no-legacy-mjs.json");
	for (const files of [
		["scripts/convert.mjs", "scripts/convert.mjs"],
		["scripts/convert.ts"],
		["scripts/other.mjs", "scripts/convert.mjs"],
	]) {
		writeFileSync(policyPath, `${JSON.stringify({ schema_version: "ceal.no_legacy_mjs.v1", files })}\n`);
		assert.throws(() => planConversion(root, "scripts", 1), /legacy_mjs_policy_wrong_shape/u);
	}
});

test("binary-expression dynamic identities are finite and block apply", (context) => {
	const root = fixture();
	writeFileSync(join(root, "refs/binary.ts"), 'const generated = "scripts/" + name + ".mjs";\n');
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = planConversion(root, "scripts", 1);
	assert.deepEqual(plan.unresolvedReferences, ["refs/binary.ts"]);
	assert.throws(() => applyConversion(plan), /conversion_unresolved_references/u);
});

test("apply rejects a changed reference or policy preimage", (context) => {
	const referenceRoot = fixture();
	context.after(() => rmSync(referenceRoot, { recursive: true, force: true }));
	const referencePlan = planConversion(referenceRoot, "scripts", 1);
	writeFileSync(join(referenceRoot, "config/other.json"), "concurrent\n");
	assert.throws(() => applyConversion(referencePlan), /conversion_reference_changed:config\/other\.json/u);

	const policyRoot = fixture();
	context.after(() => rmSync(policyRoot, { recursive: true, force: true }));
	const policyPlan = planConversion(policyRoot, "scripts", 1);
	writeFileSync(join(policyRoot, "config/no-legacy-mjs.json"), readFileSync(join(policyRoot, "config/no-legacy-mjs.json"), "utf8") + "\n");
	assert.throws(() => applyConversion(policyPlan), /conversion_policy_changed/u);
});

test("BOM-bearing audited text preserves its BOM and invalid UTF-8 is skipped", (context) => {
	const root = fixture();
	writeFileSync(join(root, "refs/bom.txt"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("scripts/convert.mjs\n")]));
	writeFileSync(join(root, "refs/invalid.txt"), Buffer.from([0xef, 0xbb, 0x28]));
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = planConversion(root, "scripts", 1);
	applyConversion(plan);
	const bytes = readFileSync(join(root, "refs/bom.txt"));
	assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), true);
	assert.match(bytes.toString("utf8"), /scripts\/convert\.ts/u);
	assert.equal(plan.skippedNonText.includes("refs/invalid.txt"), true);
});

test("dynamic templates and joins remain unresolved and block apply", (context) => {
	const root = fixture();
	writeFileSync(join(root, "refs/dynamic.ts"), 'const joined = join("scripts", name + ".mjs");\nconst templated = `scripts/${name}.mjs`;\n');
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = planConversion(root, "scripts", 1);
	assert.deepEqual(plan.unresolvedReferences, ["refs/dynamic.ts"]);
	assert.throws(() => applyConversion(plan), /conversion_unresolved_references/u);
	const result = spawnSync(
		process.execPath,
		["scripts/convert-legacy-mjs.ts", "--repo-root", root, "--path-prefix", "scripts", "--limit", "1", "--apply"],
		{ encoding: "utf8" },
	);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /conversion_unresolved_references:refs\/dynamic\.ts/u);
	assert.equal(existsSync(join(root, "scripts/convert.mjs")), true);
});

test("join-only dynamic selected identities block conversion", (context) => {
	const root = fixture();
	writeFileSync(join(root, "refs/join-only-dynamic.ts"), 'const generated = join("scripts", name + ".mjs");\n');
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = planConversion(root, "scripts", 1);
	assert.deepEqual(plan.unresolvedReferences, ["refs/join-only-dynamic.ts"]);
	assert.throws(() => applyConversion(plan), /conversion_unresolved_references/u);
});

test("mixed joins require a qualified static suffix and keep dynamic basenames unresolved only when identifiable", (context) => {
	const root = fixture();
	writeFileSync(
		join(root, "refs/mixed-join.ts"),
		[
			"const guidesDir = '/runtime/guides';",
			"const basename = 'dynamic-directory';",
			"const quality = join(ROOT, 'scripts', 'convert.mjs');",
			"const qualified = join(guidesDir, 'scripts', 'convert.mjs');",
			"const prompting = join(guidesDir, basename, 'convert.mjs');",
			"const dynamicFilename = join('scripts', name + '.mjs');",
			"",
		].join("\n"),
	);
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = planConversion(root, "scripts", 1);
	const reference = plan.references.find((entry) => entry.file === "refs/mixed-join.ts");
	assert.equal(reference?.rewrites, 2);
	assert.match(reference?.after.toString("utf8") ?? "", /quality = join\(ROOT, 'scripts', 'convert\.ts'\)/u);
	assert.match(reference?.after.toString("utf8") ?? "", /qualified = join\(guidesDir, 'scripts', 'convert\.ts'\)/u);
	assert.match(reference?.after.toString("utf8") ?? "", /prompting = join\(guidesDir, basename, 'convert\.mjs'\)/u);
	assert.match(reference?.after.toString("utf8") ?? "", /dynamicFilename = join\('scripts', name \+ '\.mjs'\)/u);
	assert.deepEqual(plan.unresolvedReferences, ["refs/mixed-join.ts"]);
});

test("dynamic templates with a selected canonical path block direct and CLI apply", (context) => {
	const root = fixture();
	writeFileSync(join(root, "refs/selected-dynamic.ts"), "const generated = `${root}/scripts/convert.mjs`;\n");
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const beforeSource = readFileSync(join(root, "scripts/convert.mjs"));
	const plan = planConversion(root, "scripts", 1);
	assert.deepEqual(plan.unresolvedReferences, ["refs/selected-dynamic.ts"]);
	assert.throws(() => applyConversion(plan), /conversion_unresolved_references:refs\/selected-dynamic\.ts/u);
	assert.deepEqual(readFileSync(join(root, "scripts/convert.mjs")), beforeSource);
	const result = spawnSync(
		process.execPath,
		["scripts/convert-legacy-mjs.ts", "--repo-root", root, "--path-prefix", "scripts", "--limit", "1", "--apply"],
		{ encoding: "utf8" },
	);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /conversion_unresolved_references:refs\/selected-dynamic\.ts/u);
	assert.deepEqual(readFileSync(join(root, "scripts/convert.mjs")), beforeSource);
	assert.equal(existsSync(join(root, "scripts/convert.ts")), false);
});

test("Windows-backslash dynamic templates with a selected canonical path block apply", (context) => {
	const root = fixture();
	writeFileSync(join(root, "refs/windows-selected-dynamic.ts"), "const generated = `${root}\\scripts\\convert.mjs`;\n");
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const beforeSource = readFileSync(join(root, "scripts/convert.mjs"));
	const plan = planConversion(root, "scripts", 1);
	assert.deepEqual(plan.unresolvedReferences, ["refs/windows-selected-dynamic.ts"]);
	assert.throws(() => applyConversion(plan), /conversion_unresolved_references:refs\/windows-selected-dynamic\.ts/u);
	assert.deepEqual(readFileSync(join(root, "scripts/convert.mjs")), beforeSource);
	const result = spawnSync(
		process.execPath,
		["scripts/convert-legacy-mjs.ts", "--repo-root", root, "--path-prefix", "scripts", "--limit", "1", "--apply"],
		{ encoding: "utf8" },
	);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /conversion_unresolved_references:refs\/windows-selected-dynamic\.ts/u);
	assert.deepEqual(readFileSync(join(root, "scripts/convert.mjs")), beforeSource);
	assert.equal(existsSync(join(root, "scripts/convert.ts")), false);
});

test("unrelated dynamic mjs output paths do not block a selected conversion", (context) => {
	const root = fixture();
	writeFileSync(
		join(root, "refs/unrelated-dynamic.ts"),
		[
			"const generated = `${workspacePath}/${GUIDE_DIR_NAME}/convert.mjs`;",
			"const runtime = `${runtimeRoot}/runtime/entrypoint.mjs`;",
			"",
		].join("\n"),
	);
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = planConversion(root, "scripts", 1);
	assert.deepEqual(plan.unresolvedReferences, []);
	applyConversion(plan);
	assert.equal(existsSync(join(root, "scripts/convert.ts")), true);
});

test("fixture source strings and regular expressions are not dynamic references", (context) => {
	const root = fixture();
	writeFileSync(
		join(root, "refs/fixture-data.ts"),
		[
			'const source = \'const generated = `${root}/scripts/convert.mjs`; const joined = join("scripts", name + ".mjs");\';',
			'const pattern = /`\\${root}\\/scripts\\/convert\\.mjs`|join\\(\\"scripts\\", name\\s\\+\\s\\"\\.mjs\\"\\)/;',
			"",
		].join("\n"),
	);
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = planConversion(root, "scripts", 1);
	assert.deepEqual(plan.unresolvedReferences, []);
});

test("regex payload after return is fixture data, not a dynamic reference", (context) => {
	const root = fixture();
	writeFileSync(join(root, "refs/return-regex.ts"), 'function fixtureData() { return /join\\("scripts", name \\+ \\".mjs\\"\\)/; }\n');
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	assert.deepEqual(planConversion(root, "scripts", 1).unresolvedReferences, []);
});

test("offsets are recomputed after a length-changing static join rewrite", (context) => {
	const root = fixture();
	writeFileSync(
		join(root, "refs/offset.ts"),
		'const staticPath = join("scripts", "convert.mjs");\nconst generated = `${root}/scripts/convert.mjs`;\n',
	);
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = planConversion(root, "scripts", 1);
	assert.deepEqual(plan.unresolvedReferences, ["refs/offset.ts"]);
	assert.equal(plan.references.find((entry) => entry.file === "refs/offset.ts")?.rewrites, 1);
});

test("unsupported directory fsync is reported deterministically while conversion succeeds", (context) => {
	const root = fixture();
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const durability = applyConversion(planConversion(root, "scripts", 1), { directorySync: "unsupported" });
	assert.equal(durability, "unsupported_directory_fsync");
	assert.equal(existsSync(join(root, "scripts/convert.ts")), true);
});

test("directory fsync EIO fails and rolls back", (context) => {
	const root = fixture();
	context.after(() => rmSync(root, { recursive: true, force: true }));
	assert.throws(
		() => applyConversion(planConversion(root, "scripts", 1), { directorySync: "EIO" }),
		/conversion_transaction_failed:original=directory_fsync_failed:EIO:rollback=directory_fsync_failed:EIO/u,
	);
	assert.equal(existsSync(join(root, "scripts/convert.mjs")), true);
});

test("rollback reports a missing completed rename target instead of silently skipping it", (context) => {
	const root = fixture();
	context.after(() => rmSync(root, { recursive: true, force: true }));
	assert.throws(
		() => applyConversion(planConversion(root, "scripts", 1), { failAfter: 4, removeCompletedTargetBeforeRollback: true }),
		/conversion_transaction_failed:original=.*rollback=.*ENOENT/u,
	);
});

test("apply rolls every byte and filename back after an injected mid-transaction failure", (context) => {
	const root = fixture();
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const beforeReference = readFileSync(join(root, "config/test-lanes.json"));
	const beforeOtherReference = readFileSync(join(root, "config/other.json"));
	const beforePolicy = readFileSync(join(root, "config/no-legacy-mjs.json"));
	const plan = planConversion(root, "scripts", 1);
	assert.throws(() => applyConversion(plan, { failAfter: 1 }), /injected_conversion_failure/u);
	assert.equal(readFileSync(join(root, "config/test-lanes.json")).equals(beforeReference), true);
	assert.equal(readFileSync(join(root, "config/other.json")).equals(beforeOtherReference), true);
	assert.equal(readFileSync(join(root, "config/no-legacy-mjs.json")).equals(beforePolicy), true);
	assert.equal(existsSync(join(root, "scripts/convert.mjs")), true);
	assert.equal(existsSync(join(root, "scripts/convert.ts")), false);
	assert.deepEqual(readdirSync(root).sort(), [".git", "config", "refs", "scripts"]);
	assert.throws(
		() => applyConversion(plan, { failAfter: 1, failRollback: true }),
		/conversion_transaction_failed:original=.*rollback=injected_rollback_failure/u,
	);
});

test("CLI grammar is order-independent but help cannot authorize options", () => {
	assert.deepEqual(parseArgs(["--limit", "2", "--path-prefix", "scripts\\", "--dry-run"]), {
		root: process.cwd(),
		prefix: "scripts",
		limit: 2,
		apply: false,
		help: false,
	});
	assert.throws(() => parseArgs(["--apply", "--dry-run"]), /mutually exclusive/u);
	assert.throws(() => parseArgs(["--dry-run", "--apply"]), /mutually exclusive/u);
	assert.throws(() => parseArgs(["--help", "--apply"]), /help cannot be combined/u);
	assert.throws(() => parseArgs(["--path-prefix", "../outside"]), /legacy_mjs_policy_invalid_path/u);
});

test("AST reference analysis handles nested, aliased, and TSX calls without fixture false positives", (context) => {
	const root = fixture();
	writeFileSync(
		join(root, "refs/nested.tsx"),
		[
			"import path from 'node:path';",
			"const pjoin = path.join;",
			"const direct = pjoin('scripts', 'convert.mjs');",
			"const nested = (path['join'])('scripts', name + '.mjs');",
			'const data = \'path.join("scripts", name + ".mjs")\';',
			"export const view = <div>{direct}{nested}</div>;",
			"",
		].join("\n"),
	);
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = planConversion(root, "scripts", 1);
	const reference = plan.references.find((entry) => entry.file === "refs/nested.tsx");
	assert.equal(reference?.rewrites, 1);
	assert.deepEqual(plan.unresolvedReferences, ["refs/nested.tsx"]);
});

test("non-code audited files rewrite static tokens and block plausible dynamic identities", (context) => {
	const root = fixture();
	writeFileSync(join(root, "refs/guide.md"), "static scripts/convert.mjs\n");
	writeFileSync(join(root, "refs/config.yaml"), "dynamic: scripts/${name}.mjs\n");
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = planConversion(root, "scripts", 1);
	assert.equal(plan.references.find((entry) => entry.file === "refs/guide.md")?.rewrites, 1);
	assert.deepEqual(plan.unresolvedReferences, ["refs/config.yaml"]);
});

test("path import provenance and finite dynamic chunks avoid unrelated identities", (context) => {
	const root = fixture();
	writeFileSync(
		join(root, "refs/provenance.ts"),
		[
			"import { join as importedJoin } from 'node:path';",
			"import * as pathNamespace from 'node:path';",
			"const pathAlias = pathNamespace;",
			"const elementJoin = pathAlias[`join`];",
			"const first = importedJoin('scripts', 'convert.mjs');",
			"const second = elementJoin('scripts', 'convert.mjs');",
			"const dynamic = pathAlias.join('scripts', name + '.mjs');",
			"const unrelated = `scripts/verify-${name}.mjs`;",
			"function join(...parts: string[]) { return parts.join('/'); }",
			"const local = join('scripts', name + '.mjs');",
			"",
		].join("\n"),
	);
	execFileSync("git", ["-C", root, "add", "-A"]);
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = planConversion(root, "scripts", 1);
	const reference = plan.references.find((entry) => entry.file === "refs/provenance.ts");
	assert.equal(reference?.rewrites, 2);
	assert.deepEqual(plan.unresolvedReferences, ["refs/provenance.ts"]);
	assert.match(reference?.after.toString("utf8") ?? "", /first = importedJoin\('scripts', 'convert\.ts'\)/u);
	assert.match(reference?.after.toString("utf8") ?? "", /second = elementJoin\('scripts', 'convert\.ts'\)/u);
});
