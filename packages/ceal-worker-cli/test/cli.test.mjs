import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { parseAllDocuments } from "yaml";
import { CEAL_COMMANDS, renderPlainYamlDocument, runCealCommand } from "../dist/index.js";
import { classifyGatewayFailure, writeCallCompleted } from "../dist/call-result-output.js";

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
		assert.match(result.stdout, /Named options follow required positionals, are order-independent, and may be supplied once\./u);
		assert.equal(result.stderr, "");
		for (const command of CEAL_COMMANDS) assert.match(result.stdout, new RegExp(`^  ${command.name}\\s`, "mu"));
	}
	for (const command of CEAL_COMMANDS) {
		for (const args of [[command.name, "--help"], [command.name, "-h"], ["help", command.name]]) {
			const result = await run(args);
			assert.equal(result.code, 0);
			assert.equal(result.stderr, "");
			assert.match(result.stdout, new RegExp(`^Usage: ${escapeRegExp(command.usage)}$`, "mu"));
			assert.match(result.stdout, /Named options follow required positionals, are order-independent, and may be supplied once\./u);
			assert.match(result.stdout, new RegExp(`^Effect: ${command.effect}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Evidence: ${command.evidence}$`, "mu"));
			assert.match(result.stdout, new RegExp(`^Result schema: ${command.result_schema}$`, "mu"));
			assert.match(result.stdout, /^Recovery\/readback: /mu);
		}
	}
	const sessionEnrollmentHelp = await run(["session", "enroll", "--help"]);
	assert.equal(sessionEnrollmentHelp.code, 0);
	assert.match(sessionEnrollmentHelp.stdout, /^Usage: ceal session \[enroll --gateway <https-url> \[--code-stdin\] \| logout\]$/mu);
	assert.equal(sessionEnrollmentHelp.stderr, "");
	const capabilitiesHelp = await run(["capabilities", "--help"]);
	for (const option of ["--endpoint", "--profile", "--request-id", "--token-stdin"]) {
		assert.match(capabilitiesHelp.stdout, new RegExp(option, "u"));
	}
	assert.match(capabilitiesHelp.stdout, /targets --profile <profile-ref>/u);
	const callHelp = await run(["call", "--help"]);
	assert.match(callHelp.stdout, /select a target for that same capability/u);
	assert.match(callHelp.stdout, /Do not mix a target returned for another capability/u);
	const guideHelp = await run(["guide", "--help"]);
	assert.match(guideHelp.stdout, /status[\s\S]+Effect: read_only/u);
	assert.match(guideHelp.stdout, /register codex[\s\S]+Effect: local_write/u);
});

test("every public command emits one YAML document without a format flag", async () => {
	for (const command of CEAL_COMMANDS) {
		const args = command.name === "call" ? ["call", "message.search", "--target", "target:team-inbox", "query=launch"]
			: command.name === "receipt" ? ["receipt", "show", "request:test"]
			: command.name === "observe" ? ["observe", "--port", "0"] : [command.name];
		// The observer intentionally serves until closed; close it right after
		// its single serving document is written.
		const runtime = command.name === "observe" ? { onObserverListening: (handle) => void handle.close() } : {};
		const payload = await yamlRun(args, command.name === "call" || command.name === "receipt" || command.name === "guide" || command.name === "update" ? 3 : 0, runtime);
		assert.equal(payload.schema ?? payload.schema_version, command.result_schema);
		if (payload.command !== undefined) assert.equal(payload.command, "ceal");
	}
});

test("version identifies the package, protocol, range, and credential context", async () => {
	assert.deepEqual(await yamlRun(["version"]), {
		schema_version: "ceal.version.v1",
		command: "ceal",
		version: "0.65.0",
		protocol_version: "1.3.0",
		supported_gateway_protocol_range: { minimum: "1.3.0", maximum: "1.3.0" },
		credential_context: "gateway_issued_client_session",
	});
});

test("commands YAML is the machine-readable discovery surface", async () => {
	const payload = await yamlRun(["commands"]);
	assert.equal(payload.schema_version, "ceal.commands.v1");
	assert.deepEqual(payload.commands.map((command) => command.name), ["version", "commands", "update", "session", "guide", "capabilities", "call", "receipt", "observe"]);
});

test("update is option-free, stable-only, and keeps child execution behind one YAML result", async () => {
	let invoked = 0;
	const payload = await yamlRun(["update"], 0, {
		runStableUpdate: async () => {
			invoked += 1;
			return {
				status: "updated",
				previous_version: "0.65.0",
				installed_version: "0.65.1",
				platform: "linux-arm64",
				artifact_sha256: "a".repeat(64),
				elapsed_ms: 42,
			};
		},
	});
	assert.deepEqual(payload, {
		schema_version: "ceal.update.v1",
		command: "ceal",
		status: "updated",
		effect: "local_write",
		stable_only: true,
		previous_version: "0.65.0",
		installed_version: "0.65.1",
		platform: "linux-arm64",
		artifact_sha256: "a".repeat(64),
		elapsed_ms: 42,
		non_claims: ["Gateway_not_contacted", "Agent_not_updated", "operator_cli_not_updated"],
	});
	const invalid = await run(["update", "v0.65.1"], { runStableUpdate: async () => { invoked += 1; return { status: "updated" }; } });
	assert.equal(invalid.code, 2);
	assert.equal(invoked, 1);
	const unavailable = await yamlRun(["update"], 3);
	assert.equal(unavailable.schema_version, "ceal.update.v1");
	assert.equal(unavailable.status, "unavailable");
	assert.equal(unavailable.error.kind, "update_unavailable");
});

test("guide status and Codex registration expose one update-safe local skill path", async () => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-guide-runtime-"));
	const guidePath = path.join(root, "install", ".ceal-cli", "worker", "current", "guide");
	const registrationPath = path.join(root, "codex", "skills", "ceal-guide");
	mkdirSync(guidePath, { recursive: true });
	writeFileSync(path.join(guidePath, "SKILL.md"), "name: ceal-guide\n");
	let registered = false;
	const inspect = () => ({
		status: registered ? "registered" : "staged", agent: "codex", guide_id: "ceal-guide",
		guide_path: guidePath, registration_path: registrationPath, update_safe: true, registered,
	});
	try {
		const status = await yamlRun(["guide", "status"], 0, { inspectAgentGuide: inspect });
		assert.equal(status.status, "staged");
		assert.equal(status.registered, false);
		assert.equal(status.effect, "read_only");
		const result = await yamlRun(["guide", "register", "codex"], 0, {
			registerAgentGuide: () => { registered = true; return inspect(); },
		});
		assert.equal(result.status, "registered");
		assert.equal(result.action, "register");
		assert.equal(result.effect, "local_write");
		assert.equal(result.update_safe, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("session enrollment exchanges stdin once, stores the credential, and never renders it", async () => {
	await withEnrollmentGateway(async ({ endpoint, token }) => {
		let stored = null;
		const payload = await yamlRun(["session", "enroll", "--code-stdin", "--gateway", endpoint], 0, {
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

		let stdinRead = false;
		const ttyStdin = await yamlRun(["session", "enroll", "--gateway", endpoint, "--code-stdin"], 3, {
			isInputTerminal: () => true,
			readSecret: async () => { stdinRead = true; return "E".repeat(48); },
			saveSession: async () => assert.fail("must not save"),
		});
		assert.equal(ttyStdin.error.kind, "stdin_enrollment_requires_pipe");
		assert.equal(stdinRead, false);
		assert.match(ttyStdin.error.next_action, /hidden prompt/u);
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

test("capabilities fails closed for malformed absolute refresh expiry before a refresh request", async () => {
	await withRenewingGateway(async ({ endpoint, refreshCalls }) => {
		const payload = await yamlRun(["capabilities"], 3, {
			loadSession: async () => storedSession(endpoint, {
				expiresAt: "2020-01-01T00:00:00.000Z",
				refreshTokenAbsoluteExpiresAt: "not-a-date",
			}),
			saveSession: async () => {},
			now: () => Date.parse("2026-07-13T00:00:00.000Z"),
		});
		assert.equal(payload.status, "unavailable");
		assert.equal(payload.error.kind, "refresh_expired");
		assert.equal(refreshCalls(), 0);
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
		assert.equal(payload.data.results.length, 1);
		assert.equal(payload.receipt.evidence, "readback_verified");
		assert.equal(payload.receipt.request_ref, "narnia:call:1:call");
		assert.equal("usage" in payload, false);
		assert.equal("profile" in payload, false);
		assert.equal("audit" in payload, false);
		assert.deepEqual(requests.map((item) => item.body.operation), ["call", "readback"]);
		assert.equal(requests[0].body.body.arguments.query, "launch");
	});
});

test("call spools an allowlisted receipt projection and a spool failure never changes the result", async () => {
	await withGateway(async ({ endpoint }) => {
		const spooled = [];
		const payload = await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 0, {
			loadSession: async () => storedSession(endpoint),
			nextRequestId: (() => { let id = 0; return () => `narnia:spool:${++id}`; })(),
			recordReceiptSpool: (entry) => spooled.push(entry),
			now: () => Date.parse("2026-07-24T12:00:00.000Z"),
		});
		assert.equal(payload.status, "completed");
		assert.deepEqual(spooled, [{
			recordedAt: Date.parse("2026-07-24T12:00:00.000Z"),
			requestRef: "narnia:spool:1:call",
			status: "completed",
			evidence: "readback_verified",
			auditRefs: ["gateway-audit:event:001"],
			capabilityId: "message.search",
			targetRef: "target:team-inbox",
		}]);
		// The spooled projection may never carry call arguments or result data.
		assert.equal(JSON.stringify(spooled).includes("launch"), false);
	});
	await withGateway(async ({ endpoint }) => {
		const broken = await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 0, {
			loadSession: async () => storedSession(endpoint),
			recordReceiptSpool: () => { throw new Error("spool unavailable"); },
		});
		assert.equal(broken.status, "completed");
		assert.equal(broken.receipt.evidence, "readback_verified");
	});
});

test("a pre-issue call failure is not spooled while an issued unknown-outcome failure is", async () => {
	const spooled = [];
	await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 3, {
		recordReceiptSpool: (entry) => spooled.push(entry),
	});
	assert.deepEqual(spooled, []);
	await yamlRun(["call", "message.search", "--target", "target:team-inbox", "query=launch"], 3, {
		loadSession: async () => storedSession("http://127.0.0.1:9"),
		recordReceiptSpool: (entry) => spooled.push(entry),
		now: () => Date.parse("2026-07-24T12:00:00.000Z"),
	});
	assert.deepEqual(spooled, [{
		recordedAt: Date.parse("2026-07-24T12:00:00.000Z"),
		requestRef: "ceal:call:call",
		status: "error",
		evidence: "outcome_unknown",
		auditRefs: [],
		capabilityId: "message.search",
		targetRef: "target:team-inbox",
		errorKind: "request_failed",
	}]);
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
				timing: { gateway_elapsed_ms: 42 },
			}],
		});
		assert.deepEqual(requests.map((item) => item.body.operation), ["readback"]);
	});
});

test("a policy-denied receipt retains the error code, non-claims, and negotiated Gateway timing", async () => {
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun(["receipt", "show", "narnia:denied:1:call"], 0, {
			loadSession: async () => storedSession(endpoint),
			nextRequestId: () => "narnia:denied-receipt:1",
		});
		assert.deepEqual(payload, {
			schema_version: "ceal.receipt.v1",
			status: "verified",
			request_ref: "narnia:denied:1:call",
			events: [{
				ref: "gateway-audit:event:denied", operation: "call", outcome: "denied", authorization: "denied",
				error_code: "resource_not_available",
				non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
				timing: { gateway_elapsed_ms: 6892 },
			}],
		});
	}, (request) => policyDeniedReadbackResponse(request));
});

test("a legacy readback without negotiated timing omits the timing block instead of rendering zero", async () => {
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun(["receipt", "show", "narnia:denied:2:call"], 0, {
			loadSession: async () => storedSession(endpoint),
			nextRequestId: () => "narnia:denied-receipt:2",
		});
		assert.equal(payload.status, "verified");
		assert.equal("timing" in payload.events[0], false);
	}, (request) => {
		const response = policyDeniedReadbackResponse(request);
		delete response.value.events[0].gateway_elapsed_ms;
		return response;
	});
});

test("a decoder-legal invalid call-detail timing is omitted, not rendered", async () => {
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun(["receipt", "show", "narnia:call:3:call"], 0, {
			loadSession: async () => storedSession(endpoint),
			nextRequestId: () => "narnia:receipt:3",
		});
		assert.equal(payload.status, "verified");
		assert.equal("timing" in payload.events[0], false);
	}, (request) => {
		const response = readbackResponse(request);
		response.value.events[0].call.gateway_elapsed_ms = 42.5;
		return response;
	});
});

test("event-level Gateway timing stays authoritative over successful call-detail timing", async () => {
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun(["receipt", "show", "narnia:call:2:call"], 0, {
			loadSession: async () => storedSession(endpoint),
			nextRequestId: () => "narnia:receipt:2",
		});
		assert.deepEqual(payload.events[0].timing, { gateway_elapsed_ms: 57 });
	}, (request) => {
		const response = readbackResponse(request);
		response.value.events[0].gateway_elapsed_ms = 57;
		return response;
	});
});

test("stored client Session selects an assigned Profile per request without another login", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const runtime = {
			loadSession: async () => storedSession(endpoint),
			nextRequestId: (() => { let index = 0; return () => `narnia:profile:${++index}`; })(),
		};
		const capabilities = await yamlRun(["capabilities", "--profile", "profile:ax"], 0, runtime);
		assert.equal(capabilities.gateway.profile_ref, "profile:ax");
		const call = await yamlRun([
			"call", "message.search", "--profile", "profile:ax", "--target", "target:team-inbox", "query=launch",
		], 0, runtime);
		assert.equal(call.status, "completed");
		const receipt = await yamlRun(["receipt", "show", "narnia:profile:3:call", "--profile", "profile:ax"], 0, runtime);
		assert.equal(receipt.status, "verified");
		assert.deepEqual(requests.map((item) => item.body.profile_ref), [
			"profile:ax", "profile:ax", "profile:ax", "profile:ax", "profile:ax",
		]);
	});
});

test("call refuses to claim completion when audit readback has no verified event", () => {
	let stdout = "";
	const code = writeCallCompleted({
		schema_version: "ceal.gateway_call_result.v1", capability_id: "file.search",
		grant_ref: "grant:workspace-file-search", grant_revision: 7, target_ref: "target:workspace",
		data: { schema_version: "ceal.file_search_result.v1", results: [{ ref: "file:roadmap", label: "Roadmap" }] },
		redaction: { state: "applied", omitted_classes: ["raw_provider_ids"] },
		host_decision: "accepted", proof_level: "host_decision", non_claims: ["production_audit_not_reached"],
	}, [], "request:missing-readback", { stdout: { write: (chunk) => { stdout += String(chunk); } }, stderr: { write() {} } }, null, {
		capabilityId: "file.search", targetRef: "target:workspace", arguments: {}, purpose: "Search",
	});
	assert.equal(code, 3);
	const payload = parseAllDocuments(stdout, { uniqueKeys: true })[0].toJS();
	assert.equal(payload.status, "error");
	assert.equal(payload.receipt.evidence, "readback_unavailable");
	assert.deepEqual(payload.receipt.audit_refs, []);
	assert.equal(payload.error.kind, "audit_readback_missing");
});

test("compatibility result data passes through without a client-side message projection", () => {
	let stdout = "";
	const code = writeCallCompleted({
		schema_version: "ceal.gateway_call_result.v1", capability_id: "message.get",
		grant_ref: "grant:team-inbox-message-get", grant_revision: 4, target_ref: "target:team-inbox",
		data: {
			schema_version: "ceal.message_get_result.v1", ref: "message:approved_001", source_label: "Team inbox",
			source: { provider: "slack", url: "https://workspace.slack.com/archives/C0123456789/p1720000000000100" },
			text: "Full authorized message text.", offset: 0,
		},
		redaction: { state: "applied", omitted_classes: ["credential_material"] },
		host_decision: "accepted", proof_level: "host_decision", non_claims: ["production_audit_not_reached"],
	}, [{ event_ref: "gateway-audit:get:001" }], "request:get:001", { stdout: { write: (chunk) => { stdout += String(chunk); } }, stderr: { write() {} } }, null, {
		capabilityId: "message.get", targetRef: "target:team-inbox", arguments: {}, purpose: "Read",
	});
	assert.equal(code, 0);
	const payload = parseAllDocuments(stdout, { uniqueKeys: true })[0].toJS();
	assert.deepEqual(payload, {
		schema_version: "ceal.result.v2", status: "completed", capability: "message.get", target: "target:team-inbox",
		data: {
			schema_version: "ceal.message_get_result.v1", ref: "message:approved_001", source_label: "Team inbox",
			source: { provider: "slack", url: "https://workspace.slack.com/archives/C0123456789/p1720000000000100" },
			text: "Full authorized message text.", offset: 0,
		},
		receipt: { evidence: "readback_verified", request_ref: "request:get:001", audit_refs: ["gateway-audit:get:001"] },
	});
});

test("compatibility result data passes through without a client-side write projection", async () => {
	let stdout = "";
	const code = writeCallCompleted({
		schema_version: "ceal.gateway_call_result.v1", capability_id: "message.create",
		grant_ref: "grant:team-inbox-message-create", grant_revision: 4, target_ref: "target:team-inbox",
		data: {
			schema_version: "ceal.message_create_result.v1", delivery: "verified",
			message_ref: "message:created_001", reply_to: "message:approved_001",
		},
		redaction: { state: "applied", omitted_classes: ["message_text", "idempotency_key", "provider_locator", "provider_identity"] },
		host_decision: "accepted", proof_level: "host_decision", non_claims: ["production_audit_not_reached"],
	}, [{ event_ref: "gateway-audit:create:001" }], "request:create:001", { stdout: { write: (chunk) => { stdout += String(chunk); } }, stderr: { write() {} } }, null, {
		capabilityId: "message.create", targetRef: "target:team-inbox", arguments: {}, purpose: "Reply",
	});
	assert.equal(code, 0);
	const payload = parseAllDocuments(stdout, { uniqueKeys: true })[0].toJS();
	assert.deepEqual(payload.data, {
		schema_version: "ceal.message_create_result.v1", delivery: "verified", message_ref: "message:created_001", reply_to: "message:approved_001",
	});
});

test("call does not impose a legacy capability-specific operand allowlist", async () => {
	const payload = await yamlRun([
		"call", "message.create", "--target", "target:team-inbox",
		"reply_to=message:approved_001", "text=Approved", "idempotency_key=retry-001", "format=compact",
	], 3, { loadSession: async () => storedSession("http://127.0.0.1:9") });
	assert.equal(payload.error.kind, "request_failed");
	assert.deepEqual(payload.receipt, {
		evidence: "outcome_unknown", request_ref: "ceal:call:call", audit_refs: [],
	});
	assert.match(payload.error.next_action, /Do not repeat a write yet/u);
	assert.match(payload.error.next_action, /ceal receipt show ceal:call:call/u);
});

test("a rejected call followed by failed session renewal is known pre-provider state, not an unknown receipt", async () => {
	await withRenewingGateway(async ({ endpoint, oldRefreshToken, requests }) => {
		const payload = await yamlRun([
			"call", "message.search", "--target", "target:team-inbox", "query=launch",
		], 3, {
			loadSession: async () => storedSession(endpoint, { refreshToken: oldRefreshToken }),
			saveSession: async () => { throw new Error("local store unavailable"); },
			nextRequestId: () => "narnia:renewal-failed:001",
		});
		assert.equal(payload.error.kind, "session_renewal_failed");
		assert.equal("receipt" in payload, false);
		assert.doesNotMatch(payload.error.next_action, /Do not repeat a write yet/u);
		assert.deepEqual(requests.map((request) => request.body.operation), ["call"]);
	}, { rejectFirstGateway: true });
});

test("rate-limited calls explain a retryable recovery instead of operator restoration", () => {
	assert.deepEqual(classifyGatewayFailure({ code: "rate_limited", message: "server-controlled" }), {
		code: "rate_limited",
		message: "The Gateway rate quota for this client is temporarily exhausted.",
		nextAction: "Wait briefly and retry the same call; the connector does not need operator restoration.",
		denial: false,
	});
});

test("an unavailable continuation asks the agent to rediscover instead of restoring the connector", () => {
	assert.deepEqual(classifyGatewayFailure({ code: "continuation_not_available", message: "server-controlled" }), {
		code: "continuation_not_available",
		message: "The approved continuation is no longer available.",
		nextAction: "Run fresh capability discovery, then search or resolve the governed resource again and use its new reference.",
		denial: false,
	});
});

test("a failed pre-provider call preserves its request ref and receipt exposes the safe failure phase", async () => {
	await withGateway(async ({ endpoint }) => {
		const runtime = {
			loadSession: async () => storedSession(endpoint),
			nextRequestId: (() => { let index = 0; return () => `narnia:failed:${++index}`; })(),
		};
		const failed = await yamlRun(["call", "message.get", "--target", "target:team-inbox", "ref=message:expired"], 3, runtime);
		assert.deepEqual(failed.receipt, {
			evidence: "not_read_back", request_ref: "narnia:failed:1:call", audit_refs: [],
		});
		assert.equal(failed.error.kind, "continuation_not_available");

		const receipt = await yamlRun(["receipt", "show", "narnia:failed:1:call"], 0, runtime);
		assert.deepEqual(receipt.events[0], {
			ref: "gateway-audit:event:failed", operation: "call", outcome: "failed", authorization: "allowed",
			error_code: "continuation_not_available",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
			capability: "message.get", target: "target:team-inbox",
			grant: { ref: "grant:team-inbox-message-get", revision: 4 },
		});
	}, (request) => request.operation === "call" ? continuationFailureResponse(request) : failedReadbackResponse(request));
});

test("an unknown failure code degrades by its typed recovery class, never by server prose", () => {
	assert.deepEqual(classifyGatewayFailure({
		code: "quota_exceeded_v2", message: "server-controlled", next_action: "server-controlled prose",
		recovery: { kind: "retry", retry_after_ms: 30_000 },
	}), {
		code: "quota_exceeded_v2",
		message: "The Gateway declined the request with a retryable rejection.",
		nextAction: "Wait briefly and retry the same call; the connector does not need operator restoration.",
		denial: false,
	});
});

test("receipt projects safe connector route provenance without provider material", async () => {
	await withGateway(async ({ endpoint }) => {
		const receipt = await yamlRun(["receipt", "show", "narnia:route:1:call"], 0, {
			loadSession: async () => storedSession(endpoint),
			nextRequestId: () => "narnia:route:receipt",
		});
		assert.deepEqual(receipt.events[0], {
			ref: "gateway-audit:event:failed", operation: "call", outcome: "failed", authorization: "not_evaluated",
			error_code: "connector_unavailable",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
			connector_route_failure: { connector_kind: "notion", phase: "scope_observation" },
		});
	}, (request) => connectorFailureReadbackResponse(request));
});

test("the known code table wins over a disagreeing recovery class", () => {
	assert.deepEqual(classifyGatewayFailure({
		code: "rate_limited", message: "server-controlled", recovery: { kind: "operator_restore" },
	}), {
		code: "rate_limited",
		message: "The Gateway rate quota for this client is temporarily exhausted.",
		nextAction: "Wait briefly and retry the same call; the connector does not need operator restoration.",
		denial: false,
	});
});

test("a non-member recovery kind is never echoed and falls to the generic hint", () => {
	assert.deepEqual(classifyGatewayFailure({
		code: "mystery_code", message: "server-controlled", recovery: { kind: "reboot_universe" },
	}), {
		code: "gateway_request_failed",
		message: "The Gateway rejected the capability request.",
		nextAction: "Check Gateway status and audit readback, then retry with a new request ID.",
		denial: false,
	});
});

test("write idempotency conflicts explain safe recovery without exposing the original payload", () => {
	assert.deepEqual(classifyGatewayFailure({ code: "idempotency_conflict", message: "server-controlled" }), {
		code: "idempotency_conflict",
		message: "The idempotency key names a different governed write.",
		nextAction: "Reuse the exact original request, or choose a new idempotency key for a new intended write.",
		denial: false,
	});
});

test("compatibility link data passes through and unsafe input is left to the Gateway contract", async () => {
	const sourceUrl = "https://workspace.slack.com/archives/C0123456789/p1720000000000100";
	await withGateway(async ({ endpoint, requests }) => {
		const url = `${sourceUrl}?thread_ts=1720000000.000100&channel=C0123456789&message_ts=1720000000.000100`;
		const payload = await yamlRun(["call", "resource.resolve", "--target", "target:team-inbox", `url=${url}`], 0, {
			loadSession: async () => storedSession(endpoint), nextRequestId: () => "narnia:resolve:1",
		});
		assert.deepEqual(payload.data, {
			schema_version: "ceal.resource_resolve_result.v1", resource: {
				ref: "message:approved_001", kind: "message", source: { provider: "slack", url: sourceUrl },
			},
		});
		assert.deepEqual(requests[0].body.body.arguments, { url });
	}, (request) => request.operation === "call" ? success(request, {
		schema_version: "ceal.gateway_call_result.v1", capability_id: "resource.resolve",
		grant_ref: "grant:team-inbox-resource-resolve", grant_revision: 4, target_ref: request.body.target_ref,
		data: { schema_version: "ceal.resource_resolve_result.v1", resource: {
			ref: "message:approved_001", kind: "message",
			source: { provider: "slack", url: sourceUrl },
		} },
		redaction: { state: "applied", omitted_classes: ["credential_material"] },
		host_decision: "accepted", proof_level: "host_decision", non_claims: ["production_audit_not_reached"],
	}) : readbackResponse(request));
	const invalid = await yamlRun([
		"call", "resource.resolve", "--target", "target:team-inbox",
		"url=https://workspace.slack.com/archives/C0123456789/p1720000000000100?token=forbidden",
	], 3, { loadSession: async () => storedSession("http://127.0.0.1:9") });
	assert.equal(invalid.error.kind, "invalid_request");
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
			const sessionPath = path.join(home, ".ceal", "client-session.json");
			assert.equal(statSync(sessionPath).mode & 0o777, 0o600);
			assert.equal(JSON.parse(readFileSync(sessionPath, "utf8")).access_token, token);
		} finally { rmSync(home, { recursive: true, force: true }); }
	});
});

test("separate ceal processes serialize an in-flight single-use client refresh", async () => {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-bin-refresh-lock-"));
	const firstRefresh = `ceal_refresh_${"R".repeat(43)}`;
	const secondRefresh = `ceal_refresh_${"S".repeat(43)}`;
	const refreshRequests = [];
	let currentRefresh = firstRefresh;
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (request.url === "/gateway/client/refresh") {
			refreshRequests.push(body.refresh_token);
			if (body.refresh_token !== currentRefresh) return response.end(JSON.stringify({ schema_version: "ceal.client_refresh_result.v1", ok: false, error: { code: "refresh_replayed" } }));
			if (refreshRequests.length === 1) await delay(100);
			currentRefresh = secondRefresh;
			response.writeHead(200, { "content-type": "application/json" });
			return response.end(JSON.stringify(rotatedClientSession(currentRefresh)));
		}
		const value = body.operation === "handshake" ? handshakeResponse(body) : discoveryResponse(body);
		response.writeHead(200, { "content-type": "application/json" });
		return response.end(JSON.stringify(value));
	});
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	const endpoint = `http://127.0.0.1:${address.port}/gateway/client`;
	const sessionPath = path.join(home, ".ceal", "client-session.json");
	try {
		mkdirSync(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
		writeFileSync(sessionPath, `${JSON.stringify(serializeStoredSession(storedSession(endpoint, {
			expiresAt: "2020-01-01T00:00:00.000Z", refreshToken: firstRefresh,
		})), null, 2)}\n`, { mode: 0o600 });
		const [first, second] = await Promise.all([
			runBin(["capabilities"], "", { HOME: home }),
			runBin(["capabilities"], "", { HOME: home }),
		]);
		assert.equal(first.code, 0, first.stderr);
		assert.equal(second.code, 0, second.stderr);
		assert.equal(parseYaml(first.stdout).status, "available");
		assert.equal(parseYaml(second.stdout).status, "available");
		assert.deepEqual(refreshRequests, [firstRefresh]);
		assert.match(readFileSync(sessionPath, "utf8"), new RegExp(secondRefresh, "u"));
	} finally {
		await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		rmSync(home, { recursive: true, force: true });
	}
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

test("capabilities rejects stray operands in both explicit and target-selection grammars", async () => {
	const explicit = await yamlRun([
		"capabilities",
		"--endpoint", "https://gateway.example.test",
		"--profile", "profile:narnia",
		"--request-id", "narnia:grammar:001",
		"--token-stdin",
		"unexpected",
	], 2);
	assert.equal(explicit.error.kind, "invalid_argument");
	const targets = await yamlRun(["capabilities", "targets", "--capability", "message.search", "unexpected"], 2);
	assert.equal(targets.error.kind, "invalid_argument");
	for (const match of ["--literal", "--"]) {
		const optionLikeValue = await yamlRun(["capabilities", "targets", "--capability", "message.search", "--match", match]);
		assert.equal(optionLikeValue.status, "unavailable");
	}
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
		assert.deepEqual(payload.targets, []);
		assert.deepEqual(payload.target_catalog, { target_count: 1, returned_count: 0, complete: false, selection_required: true });
		assert.match(payload.next_action, /capabilities targets/u);
		assert.deepEqual(requests.map((item) => item.body.operation), ["handshake", "discover"]);
		assert.deepEqual(requests.map((item) => item.authorization), [`Bearer ${token}`, `Bearer ${token}`]);
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(token, "u"));
	});
});

test("capabilities defaults to a concise catalog that omits each per-capability contract body", async () => {
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun([
			"capabilities",
			"--endpoint", endpoint,
			"--profile", "profile:narnia",
			"--request-id", "narnia:concise:001",
			"--token-stdin",
		], 0, { readSecret: async () => `ceal_personal_${"C".repeat(43)}` });
		assert.equal(payload.status, "available");
		// The concise rows keep everything an agent needs to *select* a capability
		// (id, label, effect, target requirement) but drop the input grammar body.
		assert.deepEqual(payload.capabilities.map((item) => item.capability_id), ["message.search"]);
		for (const capability of payload.capabilities) {
			assert.equal(Object.hasOwn(capability, "input_contract"), false, "concise default must omit input_contract");
			assert.equal(Object.hasOwn(capability, "write_contract"), false, "concise default must omit write_contract");
			assert.equal(typeof capability.label, "string");
			assert.equal(typeof capability.effect, "string");
		}
		// And the caller is told how to recover the omitted detail.
		assert.match(payload.capability_detail, /--detail/u);
	});
});

test("capabilities --detail restores each capability's full input contract", async () => {
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun([
			"capabilities", "--detail",
			"--endpoint", endpoint,
			"--profile", "profile:narnia",
			"--request-id", "narnia:detail:001",
			"--token-stdin",
		], 0, { readSecret: async () => `ceal_personal_${"D".repeat(43)}` });
		assert.equal(payload.status, "available");
		assert.deepEqual(payload.capabilities.map((item) => item.capability_id), ["message.search"]);
		const [capability] = payload.capabilities;
		assert.equal(Object.hasOwn(capability, "input_contract"), true, "--detail must include input_contract");
		assert.equal(capability.input_contract.schema_version, "ceal.message_search_input.v1");
		// The concise-mode recovery hint is not repeated when the detail is present.
		assert.equal(Object.hasOwn(payload, "capability_detail"), false);
	});
});

test("capabilities negotiates and surfaces the eligible-Profile catalog for --profile selection", async () => {
	const eligible = [
		{ profile_ref: "profile:ax-team", membership_ref: "membership:ax-team" },
		{ profile_ref: "profile:narnia", membership_ref: "membership:narnia" },
	];
	const responseFactory = (body) => {
		if (body.operation !== "handshake") return discoveryResponse(body);
		const base = handshakeResponse(body);
		return { ...base, value: { ...base.value, eligible_profiles: eligible } };
	};
	await withGateway(async ({ endpoint, requests }) => {
		const payload = await yamlRun([
			"capabilities",
			"--endpoint", endpoint,
			"--profile", "profile:narnia",
			"--request-id", "narnia:profiles:001",
			"--token-stdin",
		], 0, { readSecret: async () => `ceal_personal_${"S".repeat(43)}` });
		assert.equal(payload.status, "available");
		// The transport declared the negotiation on the handshake request.
		assert.equal(requests[0].body.operation, "handshake");
		assert.equal(requests[0].profiles, "accept");
		// The currently selected Profile and the catalog of alternatives an agent
		// may pass to `--profile` are both operator-visible.
		assert.equal(payload.gateway.profile_ref, "profile:narnia");
		assert.deepEqual(payload.gateway.eligible_profiles, eligible);
	}, responseFactory);
});

test("capabilities names profile_selection_required with the catalog when more than one Profile is eligible", async () => {
	const eligible = [
		{ profile_ref: "profile:ax-team", membership_ref: "membership:ax-team" },
		{ profile_ref: "profile:narnia", membership_ref: "membership:narnia" },
	];
	const responseFactory = (body) => {
		if (body.operation !== "handshake") return discoveryResponse(body);
		const base = handshakeResponse(body);
		return { ...base, value: { ...base.value, eligible_profiles: eligible } };
	};
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun([
			"capabilities",
			"--endpoint", endpoint,
			"--profile", "profile:narnia",
			"--request-id", "narnia:selection:001",
			"--token-stdin",
		], 0, { readSecret: async () => `ceal_personal_${"S".repeat(43)}` });
		assert.equal(payload.status, "available");
		assert.equal(payload.profile_selection.code, "profile_selection_required");
		assert.equal(payload.profile_selection.active_profile_ref, "profile:narnia");
		assert.match(payload.profile_selection.next_action, /--profile/u);
		// The hint points at the catalog surfaced on the gateway block.
		assert.deepEqual(payload.gateway.eligible_profiles, eligible);
	}, responseFactory);
});

test("capabilities omits profile_selection when a single eligible Profile becomes active automatically", async () => {
	const eligible = [{ profile_ref: "profile:narnia", membership_ref: "membership:narnia" }];
	const responseFactory = (body) => {
		if (body.operation !== "handshake") return discoveryResponse(body);
		const base = handshakeResponse(body);
		return { ...base, value: { ...base.value, eligible_profiles: eligible } };
	};
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun([
			"capabilities",
			"--endpoint", endpoint,
			"--profile", "profile:narnia",
			"--request-id", "narnia:selection:single",
			"--token-stdin",
		], 0, { readSecret: async () => `ceal_personal_${"S".repeat(43)}` });
		assert.equal(payload.status, "available");
		// One selectable Profile activates automatically; no selection hint.
		assert.deepEqual(payload.gateway.eligible_profiles, eligible);
		assert.equal(Object.hasOwn(payload, "profile_selection"), false);
	}, responseFactory);
});

test("capabilities omits eligible_profiles when the Gateway does not negotiate the catalog", async () => {
	await withGateway(async ({ endpoint }) => {
		const payload = await yamlRun([
			"capabilities",
			"--endpoint", endpoint,
			"--profile", "profile:narnia",
			"--request-id", "narnia:profiles:absent",
			"--token-stdin",
		], 0, { readSecret: async () => `ceal_personal_${"S".repeat(43)}` });
		assert.equal(payload.status, "available");
		// Older Gateway / non-negotiated response carries no catalog, so the
		// surface stays absent rather than an empty list.
		assert.equal(Object.hasOwn(payload.gateway, "eligible_profiles"), false);
	});
});

test("capabilities selects a bounded target page through the stored client session", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const token = `ceal_personal_${"S".repeat(43)}`;
		const payload = await yamlRun([
			"capabilities", "targets", "--capability", "message.search", "--match", "team", "--limit", "1",
		], 0, {
			loadSession: async () => storedSession(endpoint, { accessToken: token }),
			nextRequestId: () => "narnia:target-catalog:001",
		});
		assert.equal(payload.status, "available");
		assert.deepEqual(payload.targets.map((item) => item.target_ref), ["target:team-inbox"]);
		assert.deepEqual(payload.target_catalog, { target_count: 1, returned_count: 1, complete: true, selection_required: false });
		assert.deepEqual(requests.map((item) => item.body.body), [
			{ client: { name: "ceal", version: "0.65.0" } },
			{ capability_id: "message.search", match: "team", limit: 1 },
		]);
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
		protocol_version: "1.3.0",
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

test("capabilities probes live and populates the discovery cache when cold", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const cache = inMemoryDiscoveryCache();
		const payload = await yamlRun(["capabilities"], 0, {
			loadSession: async () => storedSession(endpoint),
			now: () => Date.parse("2026-07-18T12:00:00.000Z"),
			...cache.runtime,
		});
		assert.equal(payload.status, "available");
		assert.equal(payload.catalog_source, "live_discovery");
		assert.deepEqual(payload.claims_allowed, ["gateway_handshake", "gateway_discovery"]);
		assert.deepEqual(requests.map((item) => item.body.operation), ["handshake", "discover"]);
		const entry = cache.entry();
		assert.ok(entry, "cold probe must populate the cache");
		assert.deepEqual(entry.key, {
			gatewayEndpoint: endpoint, profileRef: "profile:narnia", membershipRef: "membership:narnia", negotiatedProtocolVersion: "1.3.0",
		});
		assert.equal(entry.cachedAt, Date.parse("2026-07-18T12:00:00.000Z"));
		assert.equal(entry.discovery.schema_version, "ceal.gateway_discovery.v2");
	});
});

test("capabilities serves a warm discovery cache without a live discovery probe", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const now = Date.parse("2026-07-18T12:00:00.000Z");
		const cache = inMemoryDiscoveryCache(cachedEntry(endpoint, now - 60_000));
		const payload = await yamlRun(["capabilities"], 0, {
			loadSession: async () => storedSession(endpoint),
			now: () => now,
			...cache.runtime,
		});
		assert.equal(payload.status, "available");
		assert.equal(payload.catalog_source, "cached_discovery");
		assert.equal(payload.live_gateway_checked, true, "the handshake is still a live gateway check");
		assert.deepEqual(payload.claims_allowed, ["gateway_handshake"], "no live discovery is claimed when cached");
		assert.equal(payload.catalog_cached_at, new Date(now - 60_000).toISOString());
		assert.equal(typeof payload.catalog_expires_at, "string");
		// The discovery probe never ran: only the handshake reached the gateway.
		assert.deepEqual(requests.map((item) => item.body.operation), ["handshake"]);
		// The served catalog is the cached one (target_count 2), not a live re-probe (1).
		assert.equal(payload.target_catalog.target_count, 2);
	});
});

test("capabilities re-probes when the cached entry is past its freshness window", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const now = Date.parse("2026-07-18T12:00:00.000Z");
		const cache = inMemoryDiscoveryCache(cachedEntry(endpoint, now - 10_000));
		const payload = await yamlRun(["capabilities"], 0, {
			loadSession: async () => storedSession(endpoint),
			now: () => now, discoveryCacheTtlMs: 5_000,
			...cache.runtime,
		});
		assert.equal(payload.catalog_source, "live_discovery");
		assert.deepEqual(requests.map((item) => item.body.operation), ["handshake", "discover"]);
		assert.equal(cache.entry().cachedAt, now, "stale re-probe refreshes the cache stamp");
		assert.equal(cache.entry().discovery.target_catalog.target_count, 1, "cache now holds the live value");
	});
});

test("capabilities re-probes when the cached key does not match the handshake identity", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const now = Date.parse("2026-07-18T12:00:00.000Z");
		const foreign = cachedEntry(endpoint, now);
		foreign.key.profileRef = "profile:other";
		const cache = inMemoryDiscoveryCache(foreign);
		const payload = await yamlRun(["capabilities"], 0, {
			loadSession: async () => storedSession(endpoint), now: () => now, ...cache.runtime,
		});
		assert.equal(payload.catalog_source, "live_discovery");
		assert.deepEqual(requests.map((item) => item.body.operation), ["handshake", "discover"]);
	});
});

test("capabilities --fresh bypasses a warm cache and probes live", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const now = Date.parse("2026-07-18T12:00:00.000Z");
		const cache = inMemoryDiscoveryCache(cachedEntry(endpoint, now));
		const payload = await yamlRun(["capabilities", "--fresh"], 0, {
			loadSession: async () => storedSession(endpoint), now: () => now, ...cache.runtime,
		});
		assert.equal(payload.catalog_source, "live_discovery");
		assert.deepEqual(requests.map((item) => item.body.operation), ["handshake", "discover"]);
		assert.equal(cache.entry().discovery.target_catalog.target_count, 1, "--fresh refreshes the cache");
	});
});

test("capabilities degrades to a live probe when the discovery cache read fails", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const payload = await yamlRun(["capabilities"], 0, {
			loadSession: async () => storedSession(endpoint),
			now: () => Date.parse("2026-07-18T12:00:00.000Z"),
			loadDiscoveryCache: async () => { throw new Error("cache read boom"); },
			saveDiscoveryCache: async () => {},
		});
		assert.equal(payload.status, "available");
		assert.equal(payload.catalog_source, "live_discovery");
		assert.deepEqual(requests.map((item) => item.body.operation), ["handshake", "discover"]);
	});
});

test("capabilities degrades to a live probe when a fresh cache entry has a malformed discovery value", async () => {
	await withGateway(async ({ endpoint, requests }) => {
		const now = Date.parse("2026-07-18T12:00:00.000Z");
		const malformed = cachedEntry(endpoint, now);
		malformed.discovery = { schema_version: "ceal.gateway_discovery.v2" };
		const cache = inMemoryDiscoveryCache(malformed);
		const payload = await yamlRun(["capabilities"], 0, {
			loadSession: async () => storedSession(endpoint), now: () => now, ...cache.runtime,
		});
		assert.equal(payload.catalog_source, "live_discovery");
		assert.deepEqual(requests.map((item) => item.body.operation), ["handshake", "discover"]);
		assert.equal(cache.entry().discovery.target_catalog.target_count, 1, "the live discovery replaces the malformed cache value");
	});
});

function inMemoryDiscoveryCache(initial = null) {
	let current = initial;
	return {
		entry: () => current,
		runtime: {
			loadDiscoveryCache: async () => current,
			saveDiscoveryCache: async (value) => { current = value; },
			removeDiscoveryCache: async () => { current = null; },
		},
	};
}

function cachedEntry(endpoint, cachedAt) {
	return {
		key: { gatewayEndpoint: endpoint, profileRef: "profile:narnia", membershipRef: "membership:narnia", negotiatedProtocolVersion: "1.3.0" },
		cachedAt,
		discovery: {
			schema_version: "ceal.gateway_discovery.v2",
			profile_ref: "profile:narnia", membership_ref: "membership:narnia",
			capabilities: [{
				capability_id: "message.search", label: "Search messages", effect: "read", target_requirement: "required",
				input_contract: { schema_version: "ceal.message_search_input.v1", required: ["query"], query: { type: "string", max_bytes: 512 } },
				evidence_requirement: "gateway_audit",
			}],
			targets: [],
			// target_count 2 distinguishes this cached value from a live re-probe (1).
			target_catalog: { target_count: 2, returned_count: 0, complete: false, selection_required: true },
			host_decision: "accepted", proof_level: "host_decision",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		},
	};
}

async function withGateway(callback, responseFactory = null) {
	const requests = [];
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		requests.push({ authorization: request.headers.authorization, profiles: request.headers["x-ceal-profiles"], body });
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
	// Never let the real binary touch the developer's actual home: the CLI
	// persists session/discovery state under $HOME/.ceal, so an un-overridden
	// spawn would leak fixture data into the real store.
	const isolatedHome = env.HOME === undefined ? mkdtempSync(path.join(tmpdir(), "ceal-bin-isolated-home-")) : null;
	const child = spawn(process.execPath, [bin, ...args], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env, ...(isolatedHome ? { HOME: isolatedHome } : {}) } });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	child.stdin.end(stdin);
	try {
		const code = await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("close", resolve);
		});
		return { code, stdout, stderr };
	} finally {
		if (isolatedHome) rmSync(isolatedHome, { recursive: true, force: true });
	}
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
	let refreshCallCount = 0;
	let gatewayRejected = false;
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (request.url === "/gateway/client/refresh") {
			refreshCallCount += 1;
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
			response.end(JSON.stringify({ ok: false, request_id: body.request_id, protocol_version: "1.3.0", error: { code: "authentication_failed", message: "Authentication is required.", next_action: "Renew." } }));
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
	try { await callback({ endpoint: `http://127.0.0.1:${address.port}/gateway/client`, oldRefreshToken, newAccessToken, newRefreshToken, requests, revoked, refreshCalls: () => refreshCallCount }); }
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

function serializeStoredSession(session) {
	return {
		schema_version: "ceal.client_session_store.v1", gateway_endpoint: session.gatewayEndpoint,
		profile_ref: session.profileRef, membership_ref: session.membershipRef, registration_ref: session.registrationRef,
		client_ref: session.clientRef, subject_ref: session.subjectRef, instance_ref: session.instanceRef,
		access_token: session.accessToken, expires_at: session.expiresAt, refresh_token: session.refreshToken,
		refresh_token_idle_expires_at: session.refreshTokenIdleExpiresAt,
		refresh_token_absolute_expires_at: session.refreshTokenAbsoluteExpiresAt,
	};
}

function rotatedClientSession(refreshToken) {
	return {
		schema_version: "ceal.client_refresh_result.v1", ok: true,
		profile_ref: "profile:narnia", membership_ref: "membership:narnia", registration_ref: "registration:narnia",
		client_ref: "client:narnia", subject_ref: "subject:hwidong", instance_ref: "instance:corca",
		access_token: `ceal_personal_${"N".repeat(43)}`, expires_at: "2099-07-14T00:00:00.000Z",
		refresh_token: refreshToken, refresh_token_idle_expires_at: "2099-08-14T00:00:00.000Z",
		refresh_token_absolute_expires_at: "2099-10-14T00:00:00.000Z",
	};
}

function delay(milliseconds) { return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)); }

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
		negotiated_protocol_version: "1.3.0",
		supported_gateway_protocol_range: { minimum: "1.3.0", maximum: "1.3.0" },
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
	const selected = request.body.capability_id === "message.search";
	return success(request, {
		schema_version: "ceal.gateway_discovery.v2",
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
		targets: selected ? [{ target_ref: "target:team-inbox", label: "Team inbox", access: "granted", capability_ids: ["message.search"], capability_access: [matureCapabilityAccess()] }] : [],
		target_catalog: selected
			? { target_count: 1, returned_count: 1, complete: true, selection_required: false }
			: { target_count: 1, returned_count: 0, complete: false, selection_required: true },
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
				requested_limit: 5, query_utf8_bytes: 6, result_count: 1, gateway_elapsed_ms: 42,
				coverage: matureSearchCoverage(),
			},
			proof_level: "host_decision", non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		}],
	});
}

// Mirrors the applied Gateway's pre-provider policy denial: no call detail or
// grant snapshot exists, so the negotiated handling time rides on the event.
function policyDeniedReadbackResponse(request) {
	return success(request, {
		schema_version: "ceal.gateway_audit_readback.v1", request_id: request.body.request_id,
		events: [{
			schema_version: "ceal.gateway_audit_event.v1", event_ref: "gateway-audit:event:denied", request_id: request.body.request_id,
			profile_ref: request.profile_ref, membership_ref: "membership:narnia", membership_revision: 1, registration_ref: "registration:narnia",
			client_ref: "client:narnia", client_revision: 1, subject_ref: "subject:hwidong", instance_ref: "instance:corca",
			occurred_at: "2026-07-24T09:00:00.000Z",
			operation: "call", auth_decision: "allowed", policy_decision: "denied", outcome: "denied",
			error_code: "resource_not_available", gateway_elapsed_ms: 6892,
			proof_level: "host_decision", non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		}],
	});
}

function continuationFailureResponse(request) {
	return {
		ok: false,
		request_id: request.request_id,
		protocol_version: "1.3.0",
		error: {
			code: "continuation_not_available",
			message: "server-controlled",
			next_action: "server-controlled",
		},
	};
}

function failedReadbackResponse(request) {
	return success(request, {
		schema_version: "ceal.gateway_audit_readback.v1", request_id: request.body.request_id,
		events: [{
			schema_version: "ceal.gateway_audit_event.v1", event_ref: "gateway-audit:event:failed", request_id: request.body.request_id,
			profile_ref: request.profile_ref, membership_ref: "membership:narnia", membership_revision: 1, registration_ref: "registration:narnia",
			client_ref: "client:narnia", client_revision: 1, subject_ref: "subject:hwidong", instance_ref: "instance:corca",
			occurred_at: "2026-07-20T13:00:00.000Z", operation: "call", auth_decision: "allowed", policy_decision: "allowed",
			outcome: "failed", error_code: "continuation_not_available",
			grant_snapshot: {
				schema_version: "ceal.gateway_authorization_snapshot.v1", capability_id: "message.get", target_ref: "target:team-inbox",
				grant_ref: "grant:team-inbox-message-get", grant_revision: 4,
			},
			proof_level: "host_decision", non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		}],
	});
}

function connectorFailureReadbackResponse(request) {
	const response = failedReadbackResponse(request);
	const event = response.value.events[0];
	event.policy_decision = "not_evaluated";
	event.error_code = "connector_unavailable";
	delete event.grant_snapshot;
	event.connector_route_failure = {
		schema_version: "ceal.gateway_connector_route_failure.v1",
		connector_kind: "notion",
		phase: "scope_observation",
	};
	return response;
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
		protocol_version: "1.3.0",
		proof_ref_or_unavailable: `audit:${request.request_id}`,
		value,
	};
}
