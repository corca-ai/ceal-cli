import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";
import test from "node:test";
import { URL } from "node:url";
import { parseAllDocuments } from "yaml";
import { CEAL_COMMANDS, renderPlainYamlDocument, runCealCommand } from "../dist/index.js";

function run(args) {
	let stdout = "";
	let stderr = "";
	const code = runCealCommand(args, {
		stdout: { write: (chunk) => { stdout += String(chunk); } },
		stderr: { write: (chunk) => { stderr += String(chunk); } },
	});
	return { code, stdout, stderr };
}

function yamlRun(args, expectedCode = 0) {
	const result = run(args);
	assert.equal(result.code, expectedCode, result.stderr);
	assert.equal(result.stderr, "");
	const documents = parseAllDocuments(result.stdout, { uniqueKeys: true });
	assert.equal(documents.length, 1, "stdout must contain exactly one YAML document");
	assert.deepEqual(documents[0].errors, []);
	return documents[0].toJS();
}

test("canonical registry is reachable through stable, read-only help", () => {
	for (const args of [[], ["help"], ["-h"], ["--help"]]) {
		const result = run(args);
		assert.equal(result.code, 0);
		assert.match(result.stdout, /^Usage: ceal <command> \[options\]/u);
		assert.equal(result.stderr, "");
		for (const command of CEAL_COMMANDS) assert.match(result.stdout, new RegExp(`^  ${command.name}\\s`, "mu"));
	}
	for (const command of CEAL_COMMANDS) {
		for (const args of [[command.name, "--help"], [command.name, "-h"], ["help", command.name]]) {
			const result = run(args);
			assert.equal(result.code, 0);
			assert.equal(result.stderr, "");
			assert.match(result.stdout, new RegExp(`^Usage: ${command.usage}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Effect: ${command.effect}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Evidence: ${command.evidence}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Result schema: ${command.result_schema}$`, "mu"));
			assert.match(result.stdout, /^Recovery\/readback: /mu);
		}
	}
});

test("every public command emits one YAML document without a format flag", () => {
	for (const command of CEAL_COMMANDS) {
		const payload = yamlRun([command.name]);
		assert.equal(payload.schema_version, command.result_schema);
		assert.equal(payload.command, "ceal");
	}
});

test("version identifies the package, protocol, range, and credential context", () => {
	assert.deepEqual(yamlRun(["version"]), {
		schema_version: "ceal.version.v1",
		command: "ceal",
		version: "0.64.0",
		protocol_version: "1.0.0",
		supported_gateway_protocol_range: { minimum: "1.0.0", maximum: "1.0.0" },
		credential_context: "gateway_issued_client_profile",
	});
});

test("commands YAML is the machine-readable discovery surface", () => {
	const payload = yamlRun(["commands"]);
	assert.equal(payload.schema_version, "ceal.commands.v1");
	assert.deepEqual(payload.commands.map((command) => command.name), ["version", "commands", "capabilities"]);
});

test("capabilities reports an honest Gateway-required unavailable surface", () => {
	const payload = yamlRun(["capabilities"]);
	assert.equal(payload.status, "unavailable");
	assert.equal(payload.proof_level, "surface");
	assert.equal(payload.live_gateway_checked, false);
	assert.deepEqual(payload.capabilities, []);
	assert.deepEqual(payload.claims_allowed, []);
	assert.equal(typeof payload.next_action, "string");
	assert.equal(Object.hasOwn(payload, "next_actions"), false);
});

test("JSON modes and unsafe commands fail as redacted YAML", () => {
	for (const args of [["version", "--json"], ["version", "--format", "json"]]) {
		const payload = yamlRun(args, 2);
		assert.equal(payload.error.kind, "invalid_argument");
	}
	const unsafeOperand = "secret-token-xoxb-never-render";
	for (const command of ["admin", "apply", "credential", "doctor", "login", "restart", "status"]) {
		const result = run([command, unsafeOperand]);
		assert.equal(result.code, 2);
		assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(unsafeOperand, "u"));
		assert.equal(yamlRun([command, unsafeOperand], 2).error.kind, "unknown_command");
	}
});

test("library execution is deterministic, IO-only, and does not assign process exit state", () => {
	const beforeExitCode = process.exitCode;
	const first = run(["capabilities"]);
	const second = run(["capabilities"]);
	assert.deepEqual(second, first);
	assert.equal(process.exitCode, beforeExitCode);
	const builtSource = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
	assert.doesNotMatch(builtSource, /node:(?:fs|http|https|net)|process[.]env|\bHOME\b|\bfetch\s*[(]/u);
});

test("YAML renderer rejects non-plain scalars, objects, cycles, and aliases", () => {
	const shared = { value: 1 };
	const cyclic = {};
	cyclic.self = cyclic;
	for (const value of [undefined, Number.NaN, 1n, new Date(), new Map(), { nested: undefined }, [shared, shared], cyclic]) {
		assert.throws(() => renderPlainYamlDocument(value), TypeError);
	}
	assert.doesNotMatch(renderPlainYamlDocument({ text: "plain", nested: [true, null, 1.5] }), /^(?:---|%YAML)|[&*][A-Za-z0-9_-]+/mu);
});
