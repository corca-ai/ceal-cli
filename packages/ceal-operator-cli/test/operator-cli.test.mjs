import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { URL } from "node:url";
import { parseAllDocuments } from "yaml";
import { CEALCTL_COMMANDS, renderPlainYamlDocument, runCealctlCommand } from "../dist/index.js";

test("canonical registry is reachable through stable, read-only help", () => {
	for (const args of [[], ["-h"], ["--help"], ["help"]]) {
		const result = run(args);
		assert.equal(result.code, 0);
		assert.match(result.stdout, /^Usage: cealctl <command>/u);
		assert.equal(result.stderr, "");
		for (const command of CEALCTL_COMMANDS) assert.match(result.stdout, new RegExp(`^  ${command.name}\\s`, "mu"));
	}
	for (const command of CEALCTL_COMMANDS) {
		for (const args of [[command.name, "--help"], [command.name, "-h"], ["help", command.name]]) {
			const result = run(args);
			assert.equal(result.code, 0);
			assert.equal(result.stderr, "");
			assert.match(result.stdout, new RegExp(`^Usage: ${escapeRegExp(command.usage)}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Effect: ${command.effect}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Evidence: ${command.evidence}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Result schema: ${command.result_schema}$`, "mu"));
			assert.match(result.stdout, /^Recovery\/readback: /mu);
		}
	}
});

test("every public command emits one YAML document without a format flag", () => {
	for (const command of CEALCTL_COMMANDS) {
		const payload = yamlRun([command.name]);
		assert.equal(payload.schema_version, command.result_schema);
		assert.equal(payload.command, "cealctl");
	}
});

test("version reports package, protocol, range, and operator credential context", () => {
	assert.deepEqual(yamlRun(["version"]), {
		schema_version: "cealctl.version.v1",
		command: "cealctl",
		version: "0.64.0",
		protocol_version: "1.0.0",
		supported_gateway_protocol_range: { minimum: "1.0.0", maximum: "1.0.0" },
		credential_context: "cealctl_operator_admin_profile",
	});
});

test("commands YAML discovers only the small operator surface", () => {
	const payload = yamlRun(["commands"]);
	assert.equal(payload.schema_version, "cealctl.command_discovery.v1");
	assert.deepEqual(payload.commands.map((command) => command.name), ["version", "commands", "enrollments", "doctor"]);
	assert.equal(payload.worker_command_surface_included, false);
	assert.equal(payload.credential_context, "cealctl_operator_admin_profile");
});

test("doctor reports surface health without setup, runtime, writes, or network claims", () => {
	const payload = yamlRun(["doctor"]);
	assert.equal(payload.status, "surface_ready");
	assert.equal(payload.proof_level, "surface");
	assert.deepEqual(payload.setup, { status: "not_checked" });
	assert.deepEqual(payload.runtime, { status: "not_checked" });
	assert.equal(payload.writes_local_state, false);
	assert.equal(payload.writes_external, false);
	assert.equal(payload.network_accessed, false);
});

test("enrollments create uses only the administrator session and emits transferable one-time material", async () => {
	const adminToken = `ceal_admin_${"A".repeat(43)}`;
	let observed = null;
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		observed = { authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
		response.writeHead(201, { "content-type": "application/json" });
		response.end(JSON.stringify({ schema_version: "ceal.enrollment_create_result.v1", ok: true, code: "C".repeat(43), gateway_endpoint: "https://gateway.example.test/api/ceal/v1", expires_at: "2099-07-14T00:00:00.000Z" }));
	});
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	try {
		const payload = await asyncYamlRun([
			"enrollments", "create",
			"--admin-endpoint", `http://127.0.0.1:${address.port}/api/cealctl/v1/enrollments`,
			"--name", "narnia", "--profile", "work", "--subject", "hwidong", "--instance", "corca",
			"--admin-token-stdin",
		], 0, { readSecret: async () => adminToken });
		assert.equal(payload.status, "created");
		assert.equal(payload.enrollment_code, "C".repeat(43));
		assert.equal(payload.gateway_endpoint, "https://gateway.example.test/api/ceal/v1");
		assert.equal(payload.one_time, true);
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(adminToken, "u"));
		assert.equal(observed.authorization, `Bearer ${adminToken}`);
		assert.deepEqual(observed.body, {
			schema_version: "ceal.enrollment_create.v1",
			profile_ref: "profile:work", registration_ref: "registration:narnia", client_ref: "client:narnia", runner_ref: "runner:narnia",
			subject_ref: "subject:hwidong", instance_ref: "instance:corca",
		});
	} finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

test("worker commands, JSON modes, and unsafe operands fail as redacted YAML", () => {
	for (const args of [["version", "--json"], ["version", "--format", "json"]]) {
		assert.equal(yamlRun(args, 2).error.kind, "invalid_argument");
	}
	for (const command of ["targets", "integrations", "objects", "profiles", "call"]) {
		assert.equal(yamlRun([command], 2).error.kind, "unknown_command");
	}
	const secret = ["xoxb", "unsafe", "secret", "material"].join("-");
	const opaqueOperand = ["", "home", "opaque", "operand"].join("/");
	const result = run(["call", "message.search", `token=${secret}`, opaqueOperand]);
	assert.equal(result.code, 2);
	assert.doesNotMatch(`${result.stdout}${result.stderr}`, /xoxb|message[.]search|home|opaque/u);
});

test("runtime surface performs no HOME, filesystem, or network access", () => {
	const untouchedPath = path.join(tmpdir(), `cealctl-no-mutation-${randomUUID()}`);
	assert.equal(existsSync(untouchedPath), false);
	let fetchCalls = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => { fetchCalls += 1; throw new Error("network must not run"); };
	try {
		for (const args of [[], ["version"], ["commands"], ["doctor"], ["call", "unsafe"]]) run(args);
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.equal(fetchCalls, 0);
	assert.equal(existsSync(untouchedPath), false);
	const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
	assert.doesNotMatch(source, /node:(?:fs|http|https|net)|process[.]env|HOME|fetch\s*\(|[.]ceal[/\\]/u);
});

test("packaged bin delegates once and preserves process exit codes", () => {
	const binSource = readFileSync(new URL("../src/bin.ts", import.meta.url), "utf8");
	assert.match(binSource, /^#!\/usr\/bin\/env node/u);
	assert.match(binSource, /Promise[.]resolve\(runCealctlCommand/u);
	assert.match(binSource, /process[.]exitCode = code/u);
	assert.doesNotMatch(binSource, /process[.]exit\s*\(/u);
	const binPath = new URL("../dist/bin.js", import.meta.url);
	const version = spawnSync(process.execPath, [binPath.pathname, "version"], { encoding: "utf8" });
	assert.equal(version.status, 0, version.stderr);
	assert.equal(parseYaml(version.stdout).version, "0.64.0");
	const unknown = spawnSync(process.execPath, [binPath.pathname, "call", "unsafe-secret"], { encoding: "utf8" });
	assert.equal(unknown.status, 2);
	assert.doesNotMatch(`${unknown.stdout}${unknown.stderr}`, /unsafe-secret/u);
});

test("package metadata stays exact and packages only dist plus MIT license", () => {
	const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	assert.equal(manifest.name, "@corca-ai/ceal-operator-cli");
	assert.equal(manifest.version, "0.64.0");
	assert.equal(manifest.dependencies["@corca-ai/ceal-protocol"], "0.64.0");
	assert.equal(manifest.dependencies["@corca-ai/ceal"], undefined);
	assert.equal(manifest.dependencies.yaml, "2.9.0");
	assert.equal(manifest.license, "MIT");
	assert.deepEqual(manifest.files, ["dist", "LICENSE"]);
	assert.equal(manifest.bin.cealctl, "./dist/bin.js");
});

test("YAML renderer rejects non-plain scalars, objects, cycles, and aliases", () => {
	const shared = { value: 1 };
	const cyclic = {};
	cyclic.self = cyclic;
	for (const value of [undefined, Number.POSITIVE_INFINITY, 1n, new Date(), new Set(), { nested: undefined }, [shared, shared], cyclic]) {
		assert.throws(() => renderPlainYamlDocument(value), TypeError);
	}
	assert.doesNotMatch(renderPlainYamlDocument({ text: "plain", nested: [true, null, 1.5] }), /^(?:---|%YAML)|[&*][A-Za-z0-9_-]+/mu);
});

function run(args) {
	let stdout = "";
	let stderr = "";
	const code = runCealctlCommand(args, {
		stdout: { write(chunk) { stdout += String(chunk); } },
		stderr: { write(chunk) { stderr += String(chunk); } },
	});
	return { code, stdout, stderr };
}

function parseYaml(stdout) {
	const documents = parseAllDocuments(stdout, { uniqueKeys: true });
	assert.equal(documents.length, 1, "stdout must contain exactly one YAML document");
	assert.deepEqual(documents[0].errors, []);
	return documents[0].toJS();
}

function yamlRun(args, expectedCode = 0) {
	const result = run(args);
	assert.equal(result.code, expectedCode, result.stderr);
	assert.equal(result.stderr, "");
	return parseYaml(result.stdout);
}

async function asyncYamlRun(args, expectedCode = 0, runtime = {}) {
	let stdout = "";
	let stderr = "";
	const code = await runCealctlCommand(args, {
		stdout: { write(chunk) { stdout += String(chunk); } },
		stderr: { write(chunk) { stderr += String(chunk); } },
	}, runtime);
	assert.equal(code, expectedCode, `${stderr}\n${stdout}`);
	assert.equal(stderr, "");
	return parseYaml(stdout);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
