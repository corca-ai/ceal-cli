import assert from "node:assert/strict";
import test from "node:test";
import { codedErrorClass } from "../scripts/lib/coded-error.mjs";
import { parseScriptArgs } from "../scripts/lib/parse-script-args.mjs";

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
	assert.throws(() => parse(["--out"]), (error) => error.code === "invalid_argument" && error.message === "option requires a value");
	// The following token IS consumed as the value when present, which is the
	// documented grammar: `--out --force` sets outputDirectory to "--force".
	assert.equal(parse(["--out", "--force"]).options.outputDirectory, "--force");
});

test("an unrecognized argument is refused rather than ignored", () => {
	for (const argv of [["--nope"], ["stray"], ["--out", "/tmp/a", "--nope"]]) {
		assert.throws(() => parse(argv), (error) => error.code === "invalid_argument" && error.message === "unexpected argument");
	}
});

// Object.hasOwn, not `in`: an inherited key must not read as a declared option.
test("prototype keys are not declared options", () => {
	for (const hostile of ["__proto__", "constructor", "toString"]) {
		assert.throws(() => parse([hostile]), (error) => error.code === "invalid_argument");
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
