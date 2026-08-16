import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { codedErrorClass } from "../../scripts/lib/coded-error.ts";
import { parseScriptArgs } from "../../scripts/lib/parse-script-args.ts";
import { createSkillDirectoryBundle } from "../../scripts/lib/skill-directory-bundle.ts";
import { GatewayProtocolConsumerError } from "../../scripts/verify-gateway-protocol-consumer.ts";

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

test("consumer error workspace remains writable for the keep-workspace fallback", () => {
	const error = new GatewayProtocolConsumerError("worker_smoke_failed", "boom");
	error.workspace ??= "/tmp/kept-consumer-workspace";
	assert.equal(error.workspace, "/tmp/kept-consumer-workspace");
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

test("capability audit settles actual children when process-group termination is denied", () => {
	const helper = path.resolve("skills/ceal-capability-audit/scripts/measure_ceal.py");
	const injected = spawnSync(
		"python3",
		[
			"-c",
			[
				"import importlib.util",
				"spec = importlib.util.spec_from_file_location('measure', __import__('sys').argv[1])",
				"measure = importlib.util.module_from_spec(spec)",
				"spec.loader.exec_module(measure)",
				"def denied_group(_pid, _signal): raise PermissionError('injected EPERM')",
				"measure.os.killpg = denied_group",
				"import subprocess",
				"class FakeProcess:",
				"    pid = 12345",
				"    killed = False",
				"    wait_timeout = None",
				"    def kill(self): self.killed = True",
				"    def wait(self, timeout=None):",
				"        self.wait_timeout = timeout",
				"        raise subprocess.TimeoutExpired(['fake-process'], timeout)",
				"fake = FakeProcess()",
				"try: measure.terminate_group(fake)",
				"except RuntimeError as error: assert str(error) == 'process did not settle after termination'",
				"else: raise AssertionError('terminate_group accepted an unsettled process')",
				"assert fake.killed and fake.wait_timeout == measure.TERMINATION_WAIT_SECONDS == 1.0",
				"import time",
				"started = time.monotonic()",
				"timeout_result = measure.run_bounded(['python3', '-c', 'import time; time.sleep(30)'], 0.05, 1024)",
				"assert timeout_result[0] == 124 and timeout_result[3] == 'timeout'",
				"assert timeout_result[4] is not None",
				"assert time.monotonic() - started < 2",
				"started = time.monotonic()",
				"output_result = measure.run_bounded(['python3', '-c', \"import os\\nwhile True: os.write(1, b'x' * 65536)\"], 5, 1024)",
				"assert output_result[0] == 125 and output_result[3] == 'output_limit'",
				"assert output_result[4] is not None and len(output_result[1]) == 1024",
				"assert time.monotonic() - started < 2",
			].join("\n"),
			helper,
		],
		{ encoding: "utf8", timeout: 3000 },
	);
	assert.equal(injected.status, 0, injected.stderr || injected.stdout);
});

test("capability audit cold start resolves its installed helper without an inherited shell variable", () => {
	const skill = readFileSync("skills/ceal-capability-audit/SKILL.md", "utf8");
	assert.match(skill, /Do not assume the shell already exports it/u);
	assert.match(skill, /do not substitute a checkout\s+copy/u);
	assert.match(
		skill,
		/SKILL_DIR='<absolute directory containing this installed SKILL\.md>'\nexport SKILL_DIR\npython3 "\$SKILL_DIR\/scripts\/measure_ceal\.py"/u,
	);
	assert.match(
		skill,
		/legacy `receipt\.evidence: readback_verified` token alone means Gateway audit\s+readback, not provider-state verification/u,
	);
	assert.match(skill, /`audit_event_not_found` response is not permission to repeat the write/u);
	assert.match(skill, /`gateway_audit_readback` and `provider_roundtrip` as separate observations/u);
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
