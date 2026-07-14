import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { parseAllDocuments } from "yaml";
import { CEAL_COMMANDS, renderPlainYamlDocument, runCealCommand } from "../dist/index.js";

async function run(args, runtime = {}) {
	let stdout = "";
	let stderr = "";
	const code = await runCealCommand(args, {
		stdout: { write: (chunk) => { stdout += String(chunk); } },
		stderr: { write: (chunk) => { stderr += String(chunk); } },
	}, runtime);
	return { code, stdout, stderr };
}

async function yamlRun(args, expectedCode = 0, runtime = {}) {
	const result = await run(args, runtime);
	assert.equal(result.code, expectedCode, `${result.stderr}\n${result.stdout}`);
	assert.equal(result.stderr, "");
	const documents = parseAllDocuments(result.stdout, { uniqueKeys: true });
	assert.equal(documents.length, 1, "stdout must contain exactly one YAML document");
	assert.deepEqual(documents[0].errors, []);
	return documents[0].toJS();
}

test("canonical registry is reachable through stable, read-only help", async () => {
	for (const args of [[], ["help"], ["-h"], ["--help"]]) {
		const result = await run(args);
		assert.equal(result.code, 0);
		assert.match(result.stdout, /^Usage: ceal <command> \[options\]/u);
		assert.equal(result.stderr, "");
		for (const command of CEAL_COMMANDS) assert.match(result.stdout, new RegExp(`^  ${command.name}\\s`, "mu"));
	}
	for (const command of CEAL_COMMANDS) {
		for (const args of [[command.name, "--help"], [command.name, "-h"], ["help", command.name]]) {
			const result = await run(args);
			assert.equal(result.code, 0);
			assert.equal(result.stderr, "");
			assert.match(result.stdout, new RegExp(`^Usage: ${escapeRegExp(command.usage)}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Effect: ${command.effect}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Evidence: ${command.evidence}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Result schema: ${command.result_schema}$`, "mu"));
			assert.match(result.stdout, /^Recovery\/readback: /mu);
		}
	}
	const capabilitiesHelp = await run(["capabilities", "--help"]);
	for (const option of ["--endpoint", "--profile", "--request-id", "--token-stdin"]) {
		assert.match(capabilitiesHelp.stdout, new RegExp(option, "u"));
	}
});

test("every public command emits one YAML document without a format flag", async () => {
	for (const command of CEAL_COMMANDS) {
		const args = command.name === "call" ? ["call", "message.search", "--target", "target:team-inbox", "query=launch"]
			: command.name === "receipt" ? ["receipt", "show", "request:test"] : [command.name];
		const payload = await yamlRun(args, command.name === "call" || command.name === "receipt" ? 3 : 0);
		assert.equal(payload.schema ?? payload.schema_version, command.result_schema);
		if (payload.command !== undefined) assert.equal(payload.command, "ceal");
	}
});

test("version identifies the package, protocol, range, and credential context", async () => {
	assert.deepEqual(await yamlRun(["version"]), {
		schema_version: "ceal.version.v1",
		command: "ceal",
		version: "0.64.0",
		protocol_version: "1.2.0",
		supported_gateway_protocol_range: { minimum: "1.2.0", maximum: "1.2.0" },
		credential_context: "gateway_issued_client_session",
	});
});

test("commands YAML is the machine-readable discovery surface", async () => {
	const payload = await yamlRun(["commands"]);
	assert.equal(payload.schema_version, "ceal.commands.v1");
	assert.deepEqual(payload.commands.map((command) => command.name), ["version", "commands", "session", "capabilities", "call", "receipt"]);
});

test("session enrollment exchanges stdin once, stores the credential, and never renders it", async () => {
	await withEnrollmentGateway(async ({ endpoint, token }) => {
		let stored = null;
		const payload = await yamlRun(["session", "enroll", "--gateway", endpoint, "--code-stdin"], 0, {
			readSecret: async () => "E".repeat(48),
			saveSession: async (session) => { stored = session; },
		});
		assert.equal(payload.status, "enrolled");
		assert.equal(payload.raw_token_visible, false);
		assert.equal(stored.accessToken, token);
		assert.match(stored.refreshToken, /^ceal_refresh_/u);
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(token, "u"));
	});
});

test("terminal enrollment uses a hidden prompt by default and pipe input requires an explicit flag", async () => {
	await withEnrollmentGateway(async ({ endpoint, token }) => {
		let prompted = 0;
		let readStdin = 0;
		let stored = null;
		const result = await run(["session", "enroll", "--gateway", endpoint], {
			isInteractiveTerminal: () => true,
			promptEnrollmentCode: async () => { prompted += 1; return "E".repeat(48); },
			readSecret: async () => { readStdin += 1; return "must-not-be-read"; },
			saveSession: async (session) => { stored = session; },
		});
		assert.equal(result.code, 0);
		assert.equal(prompted, 1);
		assert.equal(readStdin, 0);
		assert.equal(stored.accessToken, token);
		assert.doesNotMatch(`${result.stdout}${result.stderr}`, /E{48}|must-not-be-read/u);

		let consumed = false;
		const nonInteractive = await yamlRun(["session", "enroll", "--gateway", endpoint], 3, {
			isInteractiveTerminal: () => false,
			promptEnrollmentCode: async () => { consumed = true; return "E".repeat(48); },
			readSecret: async () => { consumed = true; return "E".repeat(48); },
			saveSession: async () => assert.fail("must not save"),
		});
		assert.equal(nonInteractive.error.kind, "interactive_enrollment_required");
		assert.equal(consumed, false);
		assert.match(nonInteractive.error.next_action, /--code-stdin/u);
	});
});

test("rejected operator-activation-shaped material cannot create a worker session or appear in recovery output", async () => {
	const code = `celn_${"A".repeat(40)}`;
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		assert.equal(request.url, "/gateway/client/enroll");
		assert.equal(body.code, code);
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({
			schema_version: "ceal.enrollment_result.v1", ok: false,
			error: { code: "enrollment_invalid", message: "The supplied material is not a device enrollment.", next_action: "Request approved device enrollment." },
		}));
	});
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	let saved = false;
	try {
		const payload = await yamlRun(["session", "enroll", "--gateway", `http://127.0.0.1:${address.port}/gateway/client`, "--code-stdin"], 3, {
			readSecret: async () => code,
			saveSession: async () => { saved = true; },
		});
		assert.equal(payload.status, "denied");
		assert.equal(saved, false);
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(code, "u"));
		assert.match(payload.error.next_action, /organization administrator/u);
	} finally {
		await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	}
});

test("capabilities renews an expiring stored session once and persists the rotation", async () => {
	await withRenewingGateway(async ({ endpoint, oldRefreshToken, newAccessToken, newRefreshToken, requests }) => {
		let saved = null;
		const payload = await yamlRun(["capabilities"], 0, {
			loadSession: async () => storedSession(endpoint, { accessToken: `ceal_personal_${"O".repeat(43)}`, expiresAt: "2020-01-01T00:00:00.000Z", refreshToken: oldRefreshToken }),
			saveSession: async (session) => { saved = session; },
			nextRequestId: () => "narnia:renewed:001",
			now: () => Date.parse("2026-07-13T00:00:00.000Z"),
		});
		assert.equal(payload.status, "available");
		assert.equal(saved.accessToken, newAccessToken);
		assert.equal(saved.refreshToken, newRefreshToken);
		assert.deepEqual(requests.map((item) => item.authorization), [`Bearer ${newAccessToken}`, `Bearer ${newAccessToken}`]);
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(oldRefreshToken, "u"));
	});
});

test("capabilities retries one authentication rejection by rotating a still-current session", async () => {
	await withRenewingGateway(async ({ endpoint, oldRefreshToken, newAccessToken, requests }) => {
		let saved = null;
		const payload = await yamlRun(["capabilities"], 0, {
			loadSession: async () => storedSession(endpoint, { refreshToken: oldRefreshToken, refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z" }),
			saveSession: async (session) => { saved = session; }, nextRequestId: () => "narnia:retry:001",
		});
		assert.equal(payload.status, "available");
		assert.equal(saved.accessToken, newAccessToken);
		assert.deepEqual(requests.map((item) => item.authorization), [`Bearer ${"ceal_personal_"}${"P".repeat(43)}`, `Bearer ${newAccessToken}`, `Bearer ${newAccessToken}`]);
	}, { rejectFirstGateway: true });
});

test("session logout revokes the server session before removing the local session", async () => {
	await withRenewingGateway(async ({ endpoint, oldRefreshToken, revoked }) => {
		let removed = false;
		const payload = await yamlRun(["session", "logout"], 0, {
			loadSession: async () => storedSession(endpoint, { refreshToken: oldRefreshToken }),
			removeSession: async () => { removed = true; },
		});
		assert.equal(payload.status, "logged_out");
		assert.equal(payload.server_session_revoked, true);
		assert.equal(removed, true);
		assert.deepEqual(revoked, [oldRefreshToken]);
	});
});

test("call invokes one granted capability and independently reads back its audit event", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const payload = await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch", "limit=3"], 0, {
			loadSession: async () => storedSession(endpoint),
			nextRequestId: (() => { let id = 0; return () => `narnia:call:${++id}`; })(),
		});
		assert.equal(payload.schema_version, "ceal.result.v2");
		assert.equal(payload.status, "completed");
		assert.equal(payload.capability, "message.search");
		assert.equal(payload.target, "target:team-inbox");
		assert.equal(payload.data.matches.length, 1);
		assert.equal(payload.receipt.request_ref, "narnia:call:1:call");
		assert.equal("usage" in payload, false);
		assert.equal("profile" in payload, false);
		assert.equal("audit" in payload, false);
		assert.deepEqual(requests.map((item) => item.body.operation), ["call", "readback"]);
		assert.equal(requests[0].body.body.arguments.query, "launch");
	});
});

test("receipt keeps audit metadata out of normal results and retrieves a safe projection on demand", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const payload = await yamlRun(["receipt", "show", "narnia:call:1:call"], 0, {
			loadSession: async () => storedSession(endpoint),
			nextRequestId: () => "narnia:receipt:1",
		});
		assert.deepEqual(payload, {
			schema_version: "ceal.receipt.v1",
			status: "verified",
			request_ref: "narnia:call:1:call",
			events: [{
				ref: "gateway-audit:event:001", operation: "call", outcome: "succeeded", authorization: "allowed",
				capability: "message.search", target: "target:team-inbox",
				grant: { ref: "grant:team-inbox-message-search", revision: 4 },
				search: { requested_limit: 5, result_count: 1, coverage: "bounded" },
			}],
		});
		assert.deepEqual(requests.map((item) => item.body.operation), ["readback"]);
	});
});

test("call preserves one request identity across authentication refresh and final audit readback", async () => {
	await withRenewingGateway(async ({ endpoint, oldRefreshToken, newAccessToken, requests }) => {
		let saved = null;
		const payload = await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 0, {
			loadSession: async () => storedSession(endpoint, {
				refreshToken: oldRefreshToken, refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
			}),
			saveSession: async (session) => { saved = session; },
			nextRequestId: (() => { let id = 0; return () => `narnia:retry-call:${++id}`; })(),
		});
		assert.equal(payload.status, "completed");
		assert.equal(payload.capability, "message.search");
		assert.equal(saved.accessToken, newAccessToken);
		assert.deepEqual(requests.map((item) => item.body.operation), ["call", "call", "readback"]);
		assert.deepEqual(requests.map((item) => item.authorization), [
			`Bearer ${"ceal_personal_"}${"P".repeat(43)}`, `Bearer ${newAccessToken}`, `Bearer ${newAccessToken}`,
		]);
		assert.equal(requests[0].body.request_id, requests[1].body.request_id);
		assert.equal(requests[2].body.body.request_id, requests[1].body.request_id);
	}, { rejectFirstGateway: true });
});

test("call forwards a discovered provider-neutral capability without a CLI command rewrite", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const payload = await yamlRun(["call", "file.search", "--target", "target:workspace", "query=roadmap", "kind=document"], 0, {
			loadSession: async () => storedSession(endpoint),
			nextRequestId: (() => { let id = 0; return () => `narnia:generic:${++id}`; })(),
		});
		assert.equal(payload.schema_version, "ceal.result.v2");
		assert.equal(payload.status, "completed");
		assert.equal(payload.capability, "file.search");
		assert.equal(payload.target, "target:workspace");
		assert.deepEqual(requests[0].body.body.arguments, { query: "roadmap", kind: "document" });
	}, (request) => request.operation === "call" ? success(request, {
		schema_version: "ceal.gateway_call_result.v1", capability_id: "file.search",
		grant_ref: "grant:workspace-file-search", grant_revision: 7, target_ref: request.body.target_ref,
		data: { schema_version: "ceal.file_search_result.v1", results: [{ ref: "file:roadmap", label: "Roadmap" }] },
		redaction: { state: "applied", omitted_classes: ["raw_provider_ids"] },
		host_decision: "accepted", proof_level: "host_decision", non_claims: ["production_audit_not_reached"],
	}) : success(request, {
		schema_version: "ceal.gateway_audit_readback.v1", request_id: request.body.request_id,
		events: [{
			schema_version: "ceal.gateway_audit_event.v1", event_ref: "gateway-audit:event:generic",
			request_id: request.body.request_id, profile_ref: request.profile_ref,
			membership_ref: "membership:narnia", membership_revision: 1, registration_ref: "registration:narnia", client_ref: "client:narnia", client_revision: 1,
			subject_ref: "subject:hwidong", instance_ref: "instance:corca",
			occurred_at: "2026-07-13T21:00:00.000Z", operation: "call", auth_decision: "allowed",
			policy_decision: "allowed", outcome: "succeeded", error_code: null,
			grant_snapshot: {
				schema_version: "ceal.gateway_authorization_snapshot.v1",
				capability_id: "file.search", target_ref: "target:workspace",
				grant_ref: "grant:workspace-file-search", grant_revision: 7,
			},
			call: {
				schema_version: "ceal.gateway_audit_call_detail.v1", capability_id: "file.search",
				grant_ref: "grant:workspace-file-search", grant_revision: 7, target_ref: "target:workspace",
				input_summary: { field_count: 2 }, output_summary: { result_count: 1 },
			},
			proof_level: "host_decision", non_claims: ["production_audit_not_reached"],
		}],
	}));
});

test("capabilities uses an enrolled session without endpoint or token options", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const token = `ceal_personal_${"P".repeat(43)}`;
		const payload = await yamlRun(["capabilities"], 0, {
			loadSession: async () => ({
				gatewayEndpoint: endpoint, profileRef: "profile:narnia", registrationRef: "registration:narnia",
				membershipRef: "membership:narnia", clientRef: "client:narnia", subjectRef: "subject:hwidong", instanceRef: "instance:corca",
				accessToken: token, expiresAt: "2099-07-14T00:00:00.000Z",
				refreshToken: `ceal_refresh_${"R".repeat(43)}`,
				refreshTokenIdleExpiresAt: "2099-08-14T00:00:00.000Z",
				refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
			}),
			nextRequestId: () => "narnia:stored:001",
		});
		assert.equal(payload.status, "available");
		assert.deepEqual(requests.map((item) => item.authorization), [`Bearer ${token}`, `Bearer ${token}`]);
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(token, "u"));
	});
});

test("packaged bin persists an enrolled session with owner-only modes", async () => {
	await withEnrollmentGateway(async ({ endpoint, token }) => {
		const home = mkdtempSync(path.join(tmpdir(), "ceal-bin-home-"));
		try {
			const result = await runBin(["session", "enroll", "--gateway", endpoint, "--code-stdin"], `${"E".repeat(48)}\n`, { HOME: home });
			assert.equal(result.code, 0, result.stdout);
			assert.doesNotMatch(result.stdout, new RegExp(token, "u"));
			assert.equal(statSync(path.join(home, ".ceal")).mode & 0o777, 0o700);
			assert.equal(statSync(path.join(home, ".ceal", "client-session.json")).mode & 0o777, 0o600);
			assert.equal(readFileSync(path.join(home, ".ceal", "client-session.json"), "utf8").includes(token), true);
		} finally { rmSync(home, { recursive: true, force: true }); }
	});
});

test("capabilities reports an honest Gateway-required unavailable surface without connection options", async () => {
	const payload = await yamlRun(["capabilities"]);
	assert.equal(payload.status, "unavailable");
	assert.equal(payload.proof_level, "surface");
	assert.equal(payload.live_gateway_checked, false);
	assert.deepEqual(payload.capabilities, []);
	assert.deepEqual(payload.claims_allowed, []);
	assert.equal(typeof payload.next_action, "string");
	assert.equal(Object.hasOwn(payload, "next_actions"), false);
});

test("capabilities performs outbound handshake and discovery with a stdin-only token", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const token = "ceal_personal_test_token_never_render";
		const payload = await yamlRun([
			"capabilities",
			"--endpoint", endpoint,
			"--profile", "profile:narnia",
			"--request-id", "narnia:acceptance:001",
			"--token-stdin",
		], 0, { readSecret: async () => token });
		assert.equal(payload.status, "available");
		assert.equal(payload.live_gateway_checked, true);
		assert.equal(payload.proof_level, "host_decision");
		assert.equal(payload.gateway.profile_ref, "profile:narnia");
		assert.equal(payload.gateway.membership_ref, "membership:narnia");
		assert.deepEqual(payload.capabilities.map((item) => item.capability_id), ["message.search"]);
		assert.deepEqual(payload.targets.map((item) => item.target_ref), ["target:team-inbox"]);
		assert.deepEqual(requests.map((item) => item.body.operation), ["handshake", "discover"]);
		assert.deepEqual(requests.map((item) => item.authorization), [`Bearer ${token}`, `Bearer ${token}`]);
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(token, "u"));
	});
});

test("packaged bin reads stdin, completes async discovery, and preserves safe exit behavior", async () => {
	await withGateway(async ({ endpoint }) => {
		const args = [
			"capabilities",
			"--endpoint", endpoint,
			"--profile", "profile:narnia",
			"--request-id", "narnia:bin:001",
			"--token-stdin",
		];
		const success = await runBin(args, "ceal_personal_bin_token_never_render\n");
		assert.equal(success.code, 0, success.stderr);
		assert.equal(parseYaml(success.stdout).status, "available");
		assert.doesNotMatch(success.stdout, /ceal_personal_bin_token_never_render/u);

		const empty = await runBin(args, "");
		assert.equal(empty.code, 3);
		assert.equal(parseYaml(empty.stdout).error.kind, "invalid_configuration");

		const oversized = await runBin(args, "x".repeat(4098));
		assert.equal(oversized.code, 3);
		assert.equal(parseYaml(oversized.stdout).error.kind, "credential_input_failed");
		assert.equal(oversized.stderr, "");
	});
});

test("Gateway failure output never reflects server-controlled secret text", async () => {
	const token = "ceal_personal_reflected_token_never_render";
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun([
			"capabilities",
			"--endpoint", endpoint,
			"--profile", "profile:narnia",
			"--request-id", "narnia:failure:001",
			"--token-stdin",
		], 3, { readSecret: async () => token });
		assert.equal(payload.status, "unavailable");
		assert.equal(payload.proof_level, "host_decision");
		assert.equal(payload.error.code, "gateway_request_failed");
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(token, "u"));
	}, (request) => ({
		ok: false,
		request_id: request.request_id,
		protocol_version: "1.2.0",
		error: { code: "internal_error", message: token, next_action: token },
	}));
});

test("Gateway option and transport failures are redacted YAML", async () => {
	const secret = "ceal_personal_failure_token_never_render";
	for (const args of [
		["capabilities", "--endpoint", "https://gateway.example.test"],
		["capabilities", "--endpoint", "http://not-loopback.example.test", "--profile", "profile:narnia", "--request-id", "request:1", "--token-stdin"],
	]) {
		const expectedCode = args.length === 3 ? 2 : 3;
		const payload = await yamlRun(args, expectedCode, { readSecret: async () => secret });
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(secret, "u"));
	}
});

test("JSON modes and unsafe commands fail as redacted YAML", async () => {
	for (const args of [["version", "--json"], ["version", "--format", "json"]]) {
		const payload = await yamlRun(args, 2);
		assert.equal(payload.error.kind, "invalid_argument");
	}
	const unsafeOperand = "secret-token-xoxb-never-render";
	for (const command of ["admin", "apply", "credential", "doctor", "login", "restart", "status"]) {
		const result = await run([command, unsafeOperand]);
		assert.equal(result.code, 2);
		assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(unsafeOperand, "u"));
		assert.equal((await yamlRun([command, unsafeOperand], 2)).error.kind, "unknown_command");
	}
});

test("library execution is deterministic, dependency-injected, and does not assign process exit state", async () => {
	const beforeExitCode = process.exitCode;
	const first = await run(["capabilities"]);
	const second = await run(["capabilities"]);
	assert.deepEqual(second, first);
	assert.equal(process.exitCode, beforeExitCode);
	const builtSource = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
	assert.doesNotMatch(builtSource, /node:(?:fs|http|https|net)|process[.]env|\bHOME\b/u);
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

async function withGateway(callback, responseFactory = null) {
	const requests = [];
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		requests.push({ authorization: request.headers.authorization, body });
		const value = responseFactory ? responseFactory(body)
			: body.operation === "handshake" ? handshakeResponse(body)
				: body.operation === "discover" ? discoveryResponse(body)
					: body.operation === "call" ? callResponse(body) : readbackResponse(body);
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(value));
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	try {
		await callback({ endpoint: `http://127.0.0.1:${address.port}/gateway/client`, requests });
	} finally {
		await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	}
}

async function runBin(args, stdin, env = {}) {
	const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
	const child = spawn(process.execPath, [bin, ...args], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	child.stdin.end(stdin);
	const code = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", resolve);
	});
	return { code, stdout, stderr };
}

async function withEnrollmentGateway(callback) {
	const token = `ceal_personal_${"T".repeat(43)}`;
	const refreshToken = `ceal_refresh_${"R".repeat(43)}`;
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		assert.equal(request.url, "/gateway/client/enroll");
		assert.equal(body.code, "E".repeat(48));
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({
			schema_version: "ceal.enrollment_result.v1", ok: true,
			profile_ref: "profile:narnia", membership_ref: "membership:narnia",
			registration_ref: "registration:narnia", client_ref: "client:narnia",
			subject_ref: "subject:hwidong", instance_ref: "instance:corca",
			access_token: token, expires_at: "2099-07-14T00:00:00.000Z",
			refresh_token: refreshToken,
			refresh_token_idle_expires_at: "2099-08-14T00:00:00.000Z",
			refresh_token_absolute_expires_at: "2099-10-14T00:00:00.000Z",
		}));
	});
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	try { await callback({ endpoint: `http://127.0.0.1:${address.port}/gateway/client`, token }); }
	finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

async function withRenewingGateway(callback, options = {}) {
	const oldRefreshToken = `ceal_refresh_${"O".repeat(43)}`;
	const newRefreshToken = `ceal_refresh_${"N".repeat(43)}`;
	const newAccessToken = `ceal_personal_${"N".repeat(43)}`;
	const requests = [];
	const revoked = [];
	let gatewayRejected = false;
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (request.url === "/gateway/client/refresh") {
			assert.equal(body.refresh_token, oldRefreshToken);
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({
				schema_version: "ceal.client_refresh_result.v1", ok: true,
				profile_ref: "profile:narnia", membership_ref: "membership:narnia",
				registration_ref: "registration:narnia", client_ref: "client:narnia",
				subject_ref: "subject:hwidong", instance_ref: "instance:corca", access_token: newAccessToken,
				expires_at: "2099-07-14T00:00:00.000Z", refresh_token: newRefreshToken,
				refresh_token_idle_expires_at: "2099-08-14T00:00:00.000Z", refresh_token_absolute_expires_at: "2099-10-14T00:00:00.000Z",
			}));
			return;
		}
		if (request.url === "/gateway/client/revoke") {
			revoked.push(body.refresh_token);
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ schema_version: "ceal.client_revoke_result.v1", ok: true, revoked: true }));
			return;
		}
		requests.push({ authorization: request.headers.authorization, body });
		if (options.rejectFirstGateway && !gatewayRejected) {
			gatewayRejected = true;
			response.writeHead(401, { "content-type": "application/json" });
			response.end(JSON.stringify({ ok: false, request_id: body.request_id, protocol_version: "1.2.0", error: { code: "authentication_failed", message: "Authentication is required.", next_action: "Renew." } }));
			return;
		}
		const value = body.operation === "handshake" ? handshakeResponse(body)
			: body.operation === "discover" ? discoveryResponse(body)
				: body.operation === "call" ? callResponse(body) : readbackResponse(body);
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(value));
	});
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	try { await callback({ endpoint: `http://127.0.0.1:${address.port}/gateway/client`, oldRefreshToken, newAccessToken, newRefreshToken, requests, revoked }); }
	finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function storedSession(endpoint, overrides = {}) {
	return {
		gatewayEndpoint: endpoint, profileRef: "profile:narnia", membershipRef: "membership:narnia",
		registrationRef: "registration:narnia", clientRef: "client:narnia", subjectRef: "subject:hwidong", instanceRef: "instance:corca",
		accessToken: `ceal_personal_${"P".repeat(43)}`, expiresAt: "2099-07-14T00:00:00.000Z",
		refreshToken: `ceal_refresh_${"R".repeat(43)}`,
		refreshTokenIdleExpiresAt: "2099-08-14T00:00:00.000Z",
		refreshTokenAbsoluteExpiresAt: "2099-10-14T00:00:00.000Z",
		...overrides,
	};
}

function parseYaml(stdout) {
	const documents = parseAllDocuments(stdout, { uniqueKeys: true });
	assert.equal(documents.length, 1);
	assert.deepEqual(documents[0].errors, []);
	return documents[0].toJS();
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function handshakeResponse(request) {
	return success(request, {
		schema_version: "ceal.gateway_handshake.v1",
		negotiated_protocol_version: "1.2.0",
		supported_gateway_protocol_range: { minimum: "1.2.0", maximum: "1.2.0" },
		profile_ref: request.profile_ref,
		membership_ref: "membership:narnia",
		registration_ref: "registration:narnia",
		client_ref: "client:narnia",
		subject_ref: "subject:hwidong",
		instance_ref: "instance:corca",
		host_decision: "accepted",
		proof_level: "host_decision",
		non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	});
}

function discoveryResponse(request) {
	return success(request, {
		schema_version: "ceal.gateway_discovery.v1",
		profile_ref: request.profile_ref,
		membership_ref: "membership:narnia",
		capabilities: [{
			capability_id: "message.search",
			label: "Search messages",
			effect: "read",
			target_requirement: "required",
			input_contract: {
				schema_version: "ceal.message_search_input.v1",
				required: ["query"],
				query: { type: "string", max_bytes: 512 },
				limit: { type: "integer", minimum: 1, maximum: 10, default: 5 },
			},
			evidence_requirement: "gateway_audit",
		}],
		targets: [{ target_ref: "target:team-inbox", label: "Team inbox", access: "granted", capability_ids: ["message.search"], capability_access: [matureCapabilityAccess()] }],
		host_decision: "accepted",
		proof_level: "host_decision",
		non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	});
}

function callResponse(request) {
	return success(request, {
		schema_version: "ceal.gateway_call_result.v1", capability_id: "message.search",
		grant_ref: "grant:team-inbox-message-search", grant_revision: 4, target_ref: request.body.target_ref,
		data: {
			schema_version: "ceal.message_search_result.v1", query: { redacted: true, utf8_bytes: 6, empty: false },
			result_count: 1,
			results: [{ ref: "message:msg_001", target_ref: request.body.target_ref, created_at: "2026-07-10T00:00:00.000Z", source_label: "Team inbox", text_preview: "Launch readiness is green." }],
			coverage: matureSearchCoverage(),
			minimization: { raw_provider_ids_included: false, raw_messages_included: false, credential_material_included: false },
		},
		redaction: { state: "applied", omitted_classes: ["query_text", "raw_provider_ids", "raw_messages"] },
		host_decision: "accepted", proof_level: "host_decision",
		non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	});
}

function readbackResponse(request) {
	return success(request, {
		schema_version: "ceal.gateway_audit_readback.v1", request_id: request.body.request_id,
		events: [{
			schema_version: "ceal.gateway_audit_event.v1", event_ref: "gateway-audit:event:001", request_id: request.body.request_id,
			profile_ref: request.profile_ref, membership_ref: "membership:narnia", membership_revision: 1, registration_ref: "registration:narnia",
			client_ref: "client:narnia", client_revision: 1, subject_ref: "subject:hwidong", instance_ref: "instance:corca",
			occurred_at: "2026-07-13T21:00:00.000Z",
			operation: "call", auth_decision: "allowed", policy_decision: "allowed", outcome: "succeeded", error_code: null,
			grant_snapshot: {
				schema_version: "ceal.gateway_authorization_snapshot.v1",
				capability_id: "message.search", target_ref: "target:team-inbox",
				grant_ref: "grant:team-inbox-message-search", grant_revision: 4,
			},
			call: {
				schema_version: "ceal.gateway_audit_call_detail.v1", capability_id: "message.search",
				grant_ref: "grant:team-inbox-message-search", grant_revision: 4, target_ref: "target:team-inbox",
				requested_limit: 5, query_utf8_bytes: 6, result_count: 1,
				coverage: matureSearchCoverage(),
			},
			proof_level: "host_decision", non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		}],
	});
}

function matureCapabilityAccess() {
	return {
		schema_version: "ceal.capability_access.v1",
		capability_id: "message.search",
		grant_ref: "grant:team-inbox-message-search",
		grant_revision: 4,
		readiness: "ready",
	};
}

function matureSearchCoverage() {
	return {
		schema_version: "ceal.message_search_coverage.v1",
		source: "authoritative_index",
		match_semantics: "backend_ranked",
		reply_coverage: "included",
		completeness: "bounded",
		truncated: false,
	};
}

function success(request, value) {
	return {
		ok: true,
		request_id: request.request_id,
		protocol_version: "1.2.0",
		proof_ref_or_unavailable: `audit:${request.request_id}`,
		value,
	};
}
