import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { codedErrorClass } from "../../scripts/lib/coded-error.mjs";
import { parseScriptArgs } from "../../scripts/lib/parse-script-args.mjs";
import { createSkillDirectoryBundle } from "../../scripts/lib/skill-directory-bundle.mjs";

function thrower() {
	return (code, message) => {
		const error = new Error(message);
		error.code = code;
		throw error;
	};
}

const SPEC = {
	defaults: { force: false },
	flags: { "--force": "force" },
	values: { "--out": "outputDirectory", "--platform": "platform" },
	valueMessage: "option requires a value",
	unknownMessage: "unexpected argument",
};

function parse(argv, overrides = {}) {
	return parseScriptArgs(argv, { fail: thrower(), ...SPEC, ...overrides });
}

test("help short-circuits and still reports the defaults", () => {
	for (const flag of ["--help", "-h"]) {
		assert.deepEqual(parse([flag]), { help: true, json: false, options: { force: false } });
	}
	// --help wins even after other arguments, so `--out x --help` documents
	// rather than builds.
	assert.equal(parse(["--out", "x", "--help"]).help, true);
});

test("flags, values, and --json are collected regardless of order", () => {
	assert.deepEqual(parse(["--json", "--force", "--out", "/tmp/a", "--platform", "linux-amd64"]), {
		help: false,
		json: true,
		options: { force: true, outputDirectory: "/tmp/a", platform: "linux-amd64" },
	});
	assert.deepEqual(parse(["--platform", "linux-amd64", "--out", "/tmp/a", "--force", "--json"]).options, {
		force: true,
		outputDirectory: "/tmp/a",
		platform: "linux-amd64",
	});
});

// A value option at the end of argv used to read `undefined` and, worse, a
// missing value must never silently swallow the following option.
test("a value option with no value is refused", () => {
	assert.throws(
		() => parse(["--out"]),
		(error) => error.code === "invalid_argument" && error.message === "option requires a value",
	);
	// The following token IS consumed as the value when present, which is the
	// documented grammar: `--out --force` sets outputDirectory to "--force".
	assert.equal(parse(["--out", "--force"]).options.outputDirectory, "--force");
});

test("an unrecognized argument is refused rather than ignored", () => {
	for (const argv of [["--nope"], ["stray"], ["--out", "/tmp/a", "--nope"]]) {
		assert.throws(
			() => parse(argv),
			(error) => error.code === "invalid_argument" && error.message === "unexpected argument",
		);
	}
});

// Object.hasOwn, not `in`: an inherited key must not read as a declared option.
test("prototype keys are not declared options", () => {
	for (const hostile of ["__proto__", "constructor", "toString"]) {
		assert.throws(
			() => parse([hostile]),
			(error) => error.code === "invalid_argument",
		);
	}
});

test("defaults are copied, so one call cannot leak into the next", () => {
	const defaults = { force: false };
	const first = parseScriptArgs(["--force"], { fail: thrower(), ...SPEC, defaults });
	const second = parseScriptArgs([], { fail: thrower(), ...SPEC, defaults });
	assert.equal(first.options.force, true);
	assert.equal(second.options.force, false);
	assert.equal(defaults.force, false, "the caller's defaults object must not be mutated");
});

test("a coded error keeps its name, code, and instanceof", () => {
	const Alpha = codedErrorClass("AlphaError");
	const Beta = codedErrorClass("BetaError");
	const error = new Alpha("bad_input", "boom");
	assert.equal(error.name, "AlphaError");
	assert.equal(error.code, "bad_input");
	assert.equal(error.message, "boom");
	assert.ok(error instanceof Alpha);
	assert.ok(error instanceof Error);
	assert.ok(!(error instanceof Beta), "distinct classes must not be interchangeable");
	assert.equal(Alpha.name, "AlphaError", "the class itself must be named for readable stacks");
	assert.match(error.stack.split("\n")[0], /^AlphaError: boom$/u);
});

test("declared extra fields are assigned and default to null", () => {
	const WithWorkspace = codedErrorClass("WorkspaceError", ["workspace"]);
	assert.equal(new WithWorkspace("command_failed", "boom", "/tmp/ws").workspace, "/tmp/ws");
	assert.equal(new WithWorkspace("command_failed", "boom").workspace, null);
});

test("skill directory bundles are deterministic, complete, and refuse unsafe entries", (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-skill-bundle-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const skill = path.join(root, "skill");
	mkdirSync(path.join(skill, "references"), { recursive: true });
	writeFileSync(path.join(skill, "SKILL.md"), "---\nname: fixture\n---\n");
	writeFileSync(path.join(skill, "references", "workflow.md"), "# Workflow\n");
	const first = createSkillDirectoryBundle(skill);
	const second = createSkillDirectoryBundle(skill);
	assert.deepEqual(first.bytes, second.bytes);
	assert.deepEqual(
		first.files.map((file) => file.path),
		["SKILL.md", "references/workflow.md"],
	);
	const archive = path.join(root, "skill.tar");
	writeFileSync(archive, first.bytes);
	assert.equal(execFileSync("tar", ["-tf", archive], { encoding: "utf8" }), "SKILL.md\nreferences/workflow.md\n");
	symlinkSync("SKILL.md", path.join(skill, "references", "alias.md"));
	assert.throws(() => createSkillDirectoryBundle(skill), /refuses symlink/u);
	writeFileSync(path.join(skill, "assets"), "not a directory\n");
	assert.throws(() => createSkillDirectoryBundle(skill), /support root must be a directory/u);
});

test("capability audit measurement bounds settlement and does not echo operands", () => {
	const helper = path.resolve("skills/ceal-capability-audit/scripts/measure_ceal.py");
	const secret = "private-operand-value";
	const timed = spawnSync(
		"python3",
		[helper, "--label", "timeout", "--timeout-seconds", "0.05", "--", "python3", "-c", "import time; time.sleep(5)", secret],
		{ encoding: "utf8" },
	);
	assert.equal(timed.status, 124, timed.stderr);
	assert.match(timed.stderr, /"settlement": "timeout"/u);
	assert.doesNotMatch(timed.stderr, new RegExp(secret, "u"));
	const flooded = spawnSync(
		"python3",
		[helper, "--label", "flood", "--max-output-bytes", "64", "--", "python3", "-c", "print('x' * 4096)"],
		{ encoding: "utf8" },
	);
	assert.equal(flooded.status, 125, flooded.stderr);
	assert.equal(Buffer.byteLength(flooded.stdout), 64);
	assert.match(flooded.stderr, /"settlement": "output_limit"/u);
	const inherited = spawnSync(
		"python3",
		[
			helper,
			"--label",
			"descendant",
			"--timeout-seconds",
			"0.05",
			"--",
			"python3",
			"-c",
			"import subprocess; subprocess.Popen(['python3', '-c', 'import time; time.sleep(5)'])",
		],
		{ encoding: "utf8", timeout: 1000 },
	);
	assert.equal(inherited.status, 124, inherited.stderr);
	assert.match(inherited.stderr, /"settlement": "timeout"/u);
});

test("capability audit file arguments are regular and bounded before reading", (context) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-audit-file-arg-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const helper = path.resolve("skills/ceal-capability-audit/scripts/measure_ceal.py");
	const oversized = path.join(root, "oversized.txt");
	writeFileSync(oversized, "x".repeat(65));
	const refused = spawnSync(
		"python3",
		[helper, "--label", "file", "--max-file-arg-bytes", "64", "--file-arg", `text=${oversized}`, "--", "true"],
		{ encoding: "utf8" },
	);
	assert.equal(refused.status, 2);
	assert.match(refused.stderr, /exceeds --max-file-arg-bytes/u);
	const fifo = path.join(root, "fifo");
	execFileSync("mkfifo", [fifo]);
	const special = spawnSync("python3", [helper, "--label", "fifo", "--file-arg", `text=${fifo}`, "--", "true"], {
		encoding: "utf8",
		timeout: 1000,
	});
	assert.equal(special.status, 2, special.stderr);
	assert.match(special.stderr, /regular file/u);
});
