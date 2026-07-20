import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { URL } from "node:url";
import { parseAllDocuments } from "yaml";
import { CEALCTL_COMMANDS, renderPlainYamlDocument, runCealctlCommand } from "../dist/index.js";
import { LocalGatewayOwnerLoginError, loginLocalGatewayOwner } from "../dist/local-gateway-owner-login-client.js";
import { decodeCealProfileConnectorRegistry } from "../dist/profile-connector-admin-client.js";

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
	for (const args of [["access", "show", "--help"], ["access", "apply", "--help"], ["connectors", "show", "--help"], ["connectors", "check", "--help"], ["connectors", "apply", "--help"]]) {
		const result = run(args);
		assert.equal(result.code, 0);
		assert.equal(result.stderr, "");
		assert.match(result.stdout, /^Usage: cealctl (?:access|connectors) (?:show|check|apply)/u);
	}
});

test("registry apply rejects invalid stdin before session or network access", async () => {
	let fetchCalls = 0;
	for (const command of ["access", "connectors"]) {
		const result = await asyncRun([command, "apply", "--stdin", "--dry-run"], {
			readStdin: async () => "schema_version: wrong.v1\n",
			fetchFn: async () => { fetchCalls += 1; throw new Error("network must not run"); },
		});
		assert.equal(result.code, 3);
		assert.equal(parseYaml(result.stdout).error.kind, "invalid_configuration");
	}
	assert.equal(fetchCalls, 0);
});

test("every public command emits one YAML document without a format flag", async () => {
	for (const command of CEALCTL_COMMANDS) {
		const result = await asyncRun([command.name]);
		const payload = parseYaml(result.stdout);
		assert.equal(payload.schema_version, command.result_schema);
		assert.equal(payload.command, "cealctl");
	}
});

test("version reports package, protocol, range, and operator credential context", () => {
	assert.deepEqual(yamlRun(["version"]), {
		schema_version: "cealctl.version.v1",
		command: "cealctl",
		version: "0.65.0",
		protocol_version: "1.3.0",
		supported_gateway_protocol_range: { minimum: "1.3.0", maximum: "1.3.0" },
		credential_context: "cealctl_operator_admin_session",
	});
});

test("commands YAML discovers only the small operator surface", () => {
	const payload = yamlRun(["commands"]);
	assert.equal(payload.schema_version, "cealctl.command_discovery.v1");
	assert.deepEqual(payload.commands.map((command) => command.name), ["version", "commands", "login", "sessions", "logout", "access", "connectors", "enrollments", "doctor"]);
	assert.equal(payload.worker_command_surface_included, false);
	assert.equal(payload.credential_context, "cealctl_operator_admin_session");
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

test("login stores a bound renewable session and enrollment refreshes it without token flags", async () => {
	const adminToken = `ceal_admin_${"A".repeat(43)}`;
	const refreshToken = `ceal_refresh_${"R".repeat(43)}`;
	const rotatedRefreshToken = `ceal_refresh_${"S".repeat(43)}`;
	const homeDir = mkdtempSync(path.join(tmpdir(), "cealctl-session-test-"));
	const observed = [];
	let localLogins = 0;
	let origin = null;
	const accessRegistry = {
		schema_version: "ceal.gateway_access_registry.v1",
		generation: 1,
		memberships: [{ membership_ref: "membership:hwidong-work", profile_ref: "profile:work", subject_ref: "subject:hwidong", profile_audience_revision: 1, revision: 1, status: "active" }],
		clients: [{ client_ref: "client:narnia", subject_ref: "subject:hwidong", instance_ref: "instance:corca", revision: 1, status: "active" }],
		grants: [{ grant_ref: "grant:work-team-inbox", profile_ref: "profile:work", capability_id: "message.search", target_ref: "target:team-inbox", profile_audience_revision: 1, revision: 1, status: "active" }],
	};
	const connectorRegistry = {
		schema_version: "ceal.gateway_profile_connector_registry.v1",
		generation: 1,
		bindings: [{ connector_binding_ref: "binding:work-slack", profile_ref: "profile:work", connector_kind: "slack", connector_principal_ref: "principal:slack-work", revision: 1, status: "active" }],
	};
	const connectorCheck = {
		schema_version: "ceal.profile_connector_check.v1", ok: true, status: "completed", proof_level: "host_decision",
		checks: [{ connector_binding_ref: "binding:work-slack", profile_ref: "profile:work", operation: "message.search", readiness: "ready", diagnostic_code: "ready", recovery: "No action is required.", scope_revision: 1, checked_at: "2099-07-13T00:00:00.000Z", expires_at: "2099-07-13T00:05:00.000Z" }],
	};
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
		observed.push({ url: request.url, authorization: request.headers.authorization, body });
		const common = { profile: "operator", admin_api_origin: origin, deployment_id: "instance:test", auth_issuer_origin: origin, auth_issuing_deployment_id: "instance:test" };
		if (request.url === "/api/cealctl/contract") return json(response, 200, compatibleContract(origin));
		if (request.url === "/api/cealctl/token/refresh") return json(response, 200, {
			schema_version: "cealctl.token_refresh.v1", ...common, access_token: adminToken,
			access_token_expires_at: "2099-07-13T02:00:00.000Z", refresh_token: rotatedRefreshToken,
			refresh_token_idle_expires_at: "2099-08-13T01:00:00.000Z", refresh_token_absolute_expires_at: "2099-10-13T00:00:00.000Z",
		});
		if (request.url === "/api/cealctl/token/revoke") return json(response, 200, {
			schema_version: "cealctl.token_revoke.v1", ...common, revoked: true,
		});
		if (request.url === "/api/cealctl/v1/enrollments") return json(response, 201, {
			schema_version: "ceal.enrollment_create_result.v1", ok: true, code: "C".repeat(43),
			gateway_endpoint: "https://gateway.example.test/api/ceal/v1", expires_at: "2099-07-14T00:00:00.000Z",
		});
		if (request.url === "/api/cealctl/v1/access" && request.method === "GET") return json(response, 200, {
			schema_version: "ceal.access_state.v1", ok: true, status: "configured", dry_run: false,
			registry: accessRegistry, proof_level: "host_decision",
		});
		if (request.url === "/api/cealctl/v1/access" && request.method === "PUT") return json(response, 200, {
			schema_version: "ceal.access_state.v1", ok: true, status: body.dry_run ? "validated" : "applied", dry_run: body.dry_run,
			registry: body.registry, proof_level: "host_decision",
		});
		if (request.url === "/api/cealctl/v1/profile-connectors" && request.method === "GET") return json(response, 200, {
			schema_version: "ceal.profile_connector_state.v1", ok: true, status: "configured", dry_run: false,
			registry: connectorRegistry, proof_level: "host_decision",
		});
		if (request.url === "/api/cealctl/v1/profile-connectors" && request.method === "PUT") return json(response, 200, {
			schema_version: "ceal.profile_connector_state.v1", ok: true, status: body.dry_run ? "validated" : "applied", dry_run: body.dry_run,
			registry: body.registry, proof_level: "host_decision",
		});
		if (request.url === "/api/cealctl/v1/profile-connectors/check" && request.method === "POST") return json(response, 200, connectorCheck);
		return json(response, 404, { error_code: "not_found" });
	});
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	origin = `http://127.0.0.1:${address.port}`;
	try {
		const login = await asyncRun(["login", origin, "--session", "operator"], {
			homeDir,
			localGatewayOwnerLogin: async ({ adminOrigin, profile }) => {
				localLogins += 1;
				return {
					name: profile, admin_api_origin: adminOrigin, deployment_id: "instance:test",
					auth_issuer_origin: adminOrigin, auth_issuing_deployment_id: "instance:test",
					access_token_expires_at: "2099-07-13T01:00:00.000Z", refresh_token: refreshToken,
					refresh_token_idle_expires_at: "2099-08-13T00:00:00.000Z", refresh_token_absolute_expires_at: "2099-10-13T00:00:00.000Z",
				};
			},
		});
		assert.equal(localLogins, 1, login.stdout);
		assert.equal(login.code, 0, login.stdout);
		assert.equal(login.stderr, "");
		assert.equal(parseYaml(login.stdout).status, "authenticated");
		const sessionsPath = path.join(homeDir, ".ceal", "cealctl", "sessions.json");
		assert.equal(statSync(sessionsPath).mode & 0o077, 0);
		assert.doesNotMatch(login.stdout, new RegExp(refreshToken, "u"));
		const sessions = await asyncYamlRun(["sessions"], 0, { homeDir });
		assert.equal(sessions.current_session, "operator");
		assert.equal(sessions.raw_token_visible, false);

		const payload = await asyncYamlRun([
			"enrollments", "create",
			"--client", "narnia", "--profile", "work", "--subject", "hwidong", "--instance", "corca",
		], 0, { homeDir });
		assert.equal(payload.status, "created");
		assert.equal(payload.enrollment_kind, "preapproved_client_device");
		assert.equal(payload.device_enrollment_code, "C".repeat(43));
		assert.equal(payload.gateway_endpoint, "https://gateway.example.test/api/ceal/v1");
		assert.equal(payload.one_time, true);
		assert.doesNotMatch(JSON.stringify(payload), new RegExp(adminToken, "u"));
		const enrollment = observed.find((entry) => entry.url === "/api/cealctl/v1/enrollments");
		assert.equal(enrollment.authorization, `Bearer ${adminToken}`);
		assert.deepEqual(enrollment.body, {
			schema_version: "ceal.enrollment_create.v1",
			profile_ref: "profile:work", client_ref: "client:narnia",
			subject_ref: "subject:hwidong", instance_ref: "instance:corca",
		});
		const shown = await asyncYamlRun(["access", "show"], 0, { homeDir });
		assert.equal(shown.status, "configured");
		assert.deepEqual(shown.registry, accessRegistry);
		const accessYaml = renderPlainYamlDocument(accessRegistry);
		const validated = await asyncYamlRun(["access", "apply", "--stdin", "--dry-run"], 0, {
			homeDir, readStdin: async () => accessYaml,
		});
		assert.equal(validated.status, "validated");
		assert.equal(validated.dry_run, true);
		const applied = await asyncYamlRun(["access", "apply", "--stdin"], 0, {
			homeDir, readStdin: async () => accessYaml,
		});
		assert.equal(applied.status, "applied");
		assert.equal(applied.dry_run, false);
		const accessRequests = observed.filter((entry) => entry.url === "/api/cealctl/v1/access");
		assert.equal(accessRequests.length, 3);
		for (const request of accessRequests) assert.equal(request.authorization, `Bearer ${adminToken}`);
		assert.equal(accessRequests[1].body.schema_version, "ceal.access_apply.v1");
		const connectorShown = await asyncYamlRun(["connectors", "show"], 0, { homeDir });
		assert.equal(connectorShown.status, "configured");
		assert.deepEqual(connectorShown.registry, connectorRegistry);
		const connectorChecked = await asyncYamlRun(["connectors", "check"], 0, { homeDir });
		assert.equal(connectorChecked.status, "completed");
		assert.equal(connectorChecked.checks[0].readiness, "ready");
		assert.match(connectorChecked.next_action, /ceal capabilities/u);
		connectorCheck.checks[0] = { ...connectorCheck.checks[0], readiness: "degraded", diagnostic_code: "bounded_projection" };
		const boundedConnectorChecked = await asyncYamlRun(["connectors", "check"], 0, { homeDir });
		assert.equal(boundedConnectorChecked.checks[0].readiness, "degraded");
		assert.match(boundedConnectorChecked.next_action, /ceal capabilities/u);
		connectorCheck.checks[0] = { ...connectorCheck.checks[0], readiness: "unavailable", diagnostic_code: "provider_unavailable" };
		const unavailableConnectorChecked = await asyncYamlRun(["connectors", "check"], 0, { homeDir });
		assert.match(unavailableConnectorChecked.next_action, /Resolve the reported connector condition/u);
		const connectorYaml = renderPlainYamlDocument(connectorRegistry);
		const connectorValidated = await asyncYamlRun(["connectors", "apply", "--stdin", "--dry-run"], 0, {
			homeDir, readStdin: async () => connectorYaml,
		});
		assert.equal(connectorValidated.status, "validated");
		assert.equal(connectorValidated.dry_run, true);
		const connectorRequests = observed.filter((entry) => entry.url === "/api/cealctl/v1/profile-connectors");
		assert.equal(connectorRequests.length, 2);
		for (const request of connectorRequests) assert.equal(request.authorization, `Bearer ${adminToken}`);
		assert.equal(connectorRequests[1].body.schema_version, "ceal.profile_connector_apply.v1");
		assert.doesNotMatch(JSON.stringify(connectorRequests), /channel|resource|xox[ab]/u);
		const readinessRequest = observed.find((entry) => entry.url === "/api/cealctl/v1/profile-connectors/check");
		assert.equal(readinessRequest.authorization, `Bearer ${adminToken}`);
		assert.equal(readinessRequest.body, null);
		const stored = readFileSync(sessionsPath, "utf8");
		assert.match(stored, new RegExp(rotatedRefreshToken, "u"));
		assert.doesNotMatch(stored, new RegExp(refreshToken, "u"));
		const logout = await asyncYamlRun(["logout"], 0, { homeDir });
		assert.equal(logout.server_revoked, true);
		assert.equal(logout.local_session_removed, true);
		assert.equal((await asyncYamlRun(["sessions"], 0, { homeDir })).status, "unconfigured");
	} finally {
		await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		rmSync(homeDir, { recursive: true, force: true });
	}
});

test("login transports one redaction-safe session over the real local Gateway socket", async () => {
	const root = mkdtempSync(path.join(tmpdir(), "cealctl-local-owner-socket-"));
	const homeDir = path.join(root, "home");
	const socketPath = path.join(root, "admin-gateway.sock");
	mkdirSync(homeDir, { mode: 0o700 });
	const origin = "http://localhost:3777/corca-ai/ceal-prod";
	const refreshToken = `cealr_${"R".repeat(48)}`;
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		assert.equal(request.method, "POST");
		assert.equal(request.url, "/v1/operator/login");
		assert.deepEqual(body, {
			schema_version: "cealctl.local_owner_login_request.v1",
			admin_api_origin: origin,
			profile: "operator",
		});
		json(response, 200, {
			schema_version: "cealctl.local_owner_login.v1",
			status: "authenticated",
			contract_revision: 2,
			profile: "operator",
			admin_api_origin: origin,
			deployment_id: "dep_0123456789abcdef01234567",
			auth_issuer_origin: origin,
			auth_issuing_deployment_id: "dep_0123456789abcdef01234567",
			access_token_expires_at: "2099-07-13T01:00:00.000Z",
			refresh_token: refreshToken,
			refresh_token_idle_expires_at: "2099-08-13T00:00:00.000Z",
			refresh_token_absolute_expires_at: "2099-10-13T00:00:00.000Z",
		});
	});
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
	try {
		const login = await asyncRun(["login", origin, "--session", "operator"], { homeDir, localGatewayOwnerSocketPath: socketPath });
		assert.equal(login.code, 0, login.stdout);
		assert.equal(login.stderr, "");
		assert.equal(parseYaml(login.stdout).status, "authenticated");
		assert.doesNotMatch(login.stdout, new RegExp(refreshToken, "u"));
		const sessionPath = path.join(homeDir, ".ceal", "cealctl", "sessions.json");
		assert.equal(statSync(sessionPath).mode & 0o077, 0);
		assert.match(readFileSync(sessionPath, "utf8"), new RegExp(refreshToken, "u"));
	} finally {
		await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		rmSync(root, { recursive: true, force: true });
	}
});

test("local Gateway login reports an incompatible local contract without storing a session", async () => {
	const root = mkdtempSync(path.join(tmpdir(), "cealctl-local-owner-contract-"));
	const socketPath = path.join(root, "admin-gateway.sock");
	const server = createServer((_request, response) => json(response, 200, {
		schema_version: "cealctl.local_owner_login.v1",
		status: "authenticated",
		contract_revision: 1,
	}));
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
	try {
		await assert.rejects(
			() => loginLocalGatewayOwner({ adminOrigin: "http://localhost:3777/corca-ai/ceal-prod", profile: "operator", socketPath }),
			(error) => error instanceof LocalGatewayOwnerLoginError && error.code === "control_plane_upgrade_required",
		);
	} finally {
		await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		rmSync(root, { recursive: true, force: true });
	}
});

test("local Gateway login classifies a missing contract revision as an old Gateway", async () => {
	const root = mkdtempSync(path.join(tmpdir(), "cealctl-local-owner-old-"));
	const socketPath = path.join(root, "admin-gateway.sock");
	const server = createServer((_request, response) => json(response, 200, {
		schema_version: "cealctl.local_owner_login.v1",
		status: "authenticated",
	}));
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
	try {
		await assert.rejects(
			() => loginLocalGatewayOwner({ adminOrigin: "http://localhost:3777/corca-ai/ceal-prod", profile: "operator", socketPath }),
			(error) => error instanceof LocalGatewayOwnerLoginError && error.code === "control_plane_upgrade_required",
		);
	} finally {
		await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		rmSync(root, { recursive: true, force: true });
	}
});

test("login without the local control channel probes Gateway age for the right recovery", async () => {
	const root = mkdtempSync(path.join(tmpdir(), "cealctl-login-recovery-"));
	const homeDir = path.join(root, "home");
	mkdirSync(homeDir, { mode: 0o700 });
	const origin = "http://localhost:3777/corca-ai/ceal-prod";
	const missingSocket = path.join(root, "missing.sock");
	try {
		// An old Gateway cannot serve the public contract endpoint: the failure
		// must carry the explicit upgrade-required recovery, not a locality hint.
		const oldGateway = await asyncRun(["login", origin], {
			homeDir, localGatewayOwnerSocketPath: missingSocket,
			fetchFn: async () => response(404, { ok: false }),
		});
		assert.equal(oldGateway.code, 3);
		const oldPayload = parseYaml(oldGateway.stdout);
		assert.equal(oldPayload.error.kind, "control_plane_upgrade_required");
		assert.match(oldPayload.error.next_action, /Install\/apply the matching Gateway release/u);

		// A compatible Gateway proves the problem is local: keep the locality recovery.
		const newGateway = await asyncRun(["login", origin], {
			homeDir, localGatewayOwnerSocketPath: missingSocket,
			fetchFn: async () => response(200, compatibleContract(origin)),
		});
		assert.equal(parseYaml(newGateway.stdout).error.kind, "local_authorization_unavailable");

		// An unreachable probe proves nothing about Gateway age: keep the locality recovery.
		const unreachable = await asyncRun(["login", origin], {
			homeDir, localGatewayOwnerSocketPath: missingSocket,
			fetchFn: async () => { throw new Error("network unreachable"); },
		});
		assert.equal(parseYaml(unreachable.stdout).error.kind, "local_authorization_unavailable");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("per-command help states the YAML-only output contract", () => {
	for (const command of CEALCTL_COMMANDS) {
		const result = run([command.name, "--help"]);
		assert.match(result.stdout, /^Output: one YAML document on stdout; --json is not supported\.$/mu);
	}
});

test("concurrent operator reads serialize single-use refresh rotation before the Admin API", async () => {
	const homeDir = mkdtempSync(path.join(tmpdir(), "cealctl-refresh-lock-"));
	const firstRefresh = `ceal_refresh_${"R".repeat(43)}`;
	const secondRefresh = `ceal_refresh_${"S".repeat(43)}`;
	const thirdRefresh = `ceal_refresh_${"T".repeat(43)}`;
	let currentRefresh = firstRefresh;
	const refreshRequests = [];
	const origin = "https://gateway.example.test/corca-ai/ceal-prod";
	const route = "/corca-ai/ceal-prod";
	const common = {
		profile: "operator", admin_api_origin: origin, deployment_id: "instance:test",
		auth_issuer_origin: origin, auth_issuing_deployment_id: "instance:test",
	};
	const fetchFn = async (url, init = {}) => {
		const pathname = new URL(String(url)).pathname;
		if (pathname === `${route}/api/cealctl/contract`) return response(200, compatibleContract(origin));
		if (pathname === `${route}/api/cealctl/token/refresh`) {
			const body = JSON.parse(String(init.body));
			refreshRequests.push(body.refresh_token);
			if (body.refresh_token !== currentRefresh) return response(409, { error_code: "refresh_replayed" });
			currentRefresh = currentRefresh === firstRefresh ? secondRefresh : thirdRefresh;
			return response(200, {
				schema_version: "cealctl.token_refresh.v1", ...common,
				access_token: `ceal_admin_${"A".repeat(43)}`,
				access_token_expires_at: "2099-07-14T00:00:00.000Z", refresh_token: currentRefresh,
				refresh_token_idle_expires_at: "2099-08-14T00:00:00.000Z",
				refresh_token_absolute_expires_at: "2099-10-14T00:00:00.000Z",
			});
		}
		if (pathname === `${route}/api/cealctl/v1/access`) return response(200, {
			schema_version: "ceal.access_state.v1", ok: true, status: "configured", dry_run: false,
			registry: emptyAccessRegistry(), proof_level: "host_decision",
		});
		if (pathname === `${route}/api/cealctl/v1/profile-connectors`) return response(200, {
			schema_version: "ceal.profile_connector_state.v1", ok: true, status: "configured", dry_run: false,
			registry: emptyConnectorRegistry(), proof_level: "host_decision",
		});
		throw new Error(`Unexpected request: ${pathname}`);
	};
	try {
		await asyncRun(["login", origin, "--session", "operator"], {
			homeDir,
			localGatewayOwnerLogin: async ({ adminOrigin, profile }) => ({
				...common, name: profile, admin_api_origin: adminOrigin, auth_issuer_origin: adminOrigin,
				access_token_expires_at: "2099-07-14T00:00:00.000Z", refresh_token: firstRefresh,
				refresh_token_idle_expires_at: "2099-08-14T00:00:00.000Z",
				refresh_token_absolute_expires_at: "2099-10-14T00:00:00.000Z",
			}),
		});
		const [access, connectors] = await Promise.all([
			asyncRun(["access", "show"], { homeDir, fetchFn }),
			asyncRun(["connectors", "show"], { homeDir, fetchFn }),
		]);
		assert.equal(access.code, 0, access.stdout);
		assert.equal(connectors.code, 0, connectors.stdout);
		assert.deepEqual(refreshRequests, [firstRefresh, secondRefresh]);
	} finally {
		rmSync(homeDir, { recursive: true, force: true });
	}
});

test("separate cealctl processes serialize an in-flight single-use refresh rotation", async () => {
	const homeDir = mkdtempSync(path.join(tmpdir(), "cealctl-refresh-process-lock-"));
	const firstRefresh = `ceal_refresh_${"R".repeat(43)}`;
	const secondRefresh = `ceal_refresh_${"S".repeat(43)}`;
	const thirdRefresh = `ceal_refresh_${"T".repeat(43)}`;
	const refreshRequests = [];
	let currentRefresh = firstRefresh;
	let origin = null;
	const server = createServer(async (request, reply) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
		if (request.url === "/api/cealctl/contract") return json(reply, 200, compatibleContract(origin));
		if (request.url === "/api/cealctl/token/refresh") {
			refreshRequests.push(body.refresh_token);
			if (body.refresh_token !== currentRefresh) return json(reply, 409, { error_code: "refresh_replayed" });
			if (refreshRequests.length === 1) await delay(100);
			currentRefresh = currentRefresh === firstRefresh ? secondRefresh : thirdRefresh;
			return json(reply, 200, rotatedOperatorSession(origin, currentRefresh));
		}
		if (request.url === "/api/cealctl/v1/access") return json(reply, 200, {
			schema_version: "ceal.access_state.v1", ok: true, status: "configured", dry_run: false,
			registry: emptyAccessRegistry(), proof_level: "host_decision",
		});
		return json(reply, 404, { error_code: "not_found" });
	});
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test server address unavailable");
	origin = `http://127.0.0.1:${address.port}`;
	const sessionPath = path.join(homeDir, ".ceal", "cealctl", "sessions.json");
	try {
		mkdirSync(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
		writeFileSync(sessionPath, `${JSON.stringify({
			schema_version: "cealctl.operator_sessions.v1", current_profile: "operator",
			profiles: { operator: { ...rotatedOperatorSession(origin, firstRefresh), name: undefined } },
		}, null, 2)}\n`, { mode: 0o600 });
		const [access, secondAccess] = await Promise.all([
			runPackagedCealctl(["access", "show"], homeDir),
			runPackagedCealctl(["access", "show"], homeDir),
		]);
		assert.equal(access.code, 0, access.stderr);
		assert.equal(secondAccess.code, 0, secondAccess.stderr);
		assert.equal(parseYaml(access.stdout).status, "configured");
		assert.equal(parseYaml(secondAccess.stdout).status, "configured");
		assert.deepEqual(refreshRequests, [firstRefresh, secondRefresh]);
		assert.match(readFileSync(sessionPath, "utf8"), new RegExp(thirdRefresh, "u"));
	} finally {
		await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		rmSync(homeDir, { recursive: true, force: true });
	}
});

test("a missing local Gateway authorization channel is rejected before login creates an operator session", async () => {
	const homeDir = mkdtempSync(path.join(tmpdir(), "cealctl-stale-contract-"));
	const result = await asyncRun(["login", "https://ceal.example.test/corca-ai/ceal-dev"], {
		homeDir,
		localGatewayOwnerSocketPath: "/tmp/cealctl-missing-local-owner.sock",
	});
	try {
		assert.equal(result.code, 3);
		const payload = parseYaml(result.stdout);
		assert.equal(payload.error.kind, "local_authorization_unavailable");
		assert.match(payload.error.next_action, /Gateway admin host/u);
		assert.equal(existsSync(path.join(homeDir, ".ceal", "cealctl", "sessions.json")), false);
	} finally {
		rmSync(homeDir, { recursive: true, force: true });
	}
});

test("login rejects retired apex and organization-only control targets before local authorization", async () => {
	for (const origin of ["https://ceal.example.test", "https://ceal.example.test/corca-ai"]) {
		const homeDir = mkdtempSync(path.join(tmpdir(), "cealctl-instance-route-"));
		const result = await asyncRun(["login", origin], {
			homeDir,
			localGatewayOwnerSocketPath: "/tmp/cealctl-instance-route-must-not-open.sock",
		});
		try {
			assert.equal(result.code, 3);
			assert.equal(parseYaml(result.stdout).error.kind, "instance_route_required");
			assert.match(result.stdout, /organization\/instance route/u);
			assert.equal(existsSync(path.join(homeDir, ".ceal", "cealctl", "sessions.json")), false);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	}
});

test("stored organization-only sessions fail with canonical instance-route recovery", async () => {
	const homeDir = mkdtempSync(path.join(tmpdir(), "cealctl-retired-session-"));
	const sessionPath = path.join(homeDir, ".ceal", "cealctl", "sessions.json");
	const origin = "https://ceal.example.test/corca-ai";
	mkdirSync(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
	writeFileSync(sessionPath, `${JSON.stringify({
		schema_version: "cealctl.operator_sessions.v1",
		current_profile: "operator",
		profiles: { operator: { ...rotatedOperatorSession(origin, `ceal_refresh_${"R".repeat(43)}`), name: undefined } },
	}, null, 2)}\n`, { mode: 0o600 });
	try {
		const result = await asyncRun(["sessions"], { homeDir });
		assert.equal(result.code, 3);
		assert.equal(parseYaml(result.stdout).error.kind, "instance_route_required");
		assert.match(result.stdout, /organization\/instance route/u);
	} finally {
		rmSync(homeDir, { recursive: true, force: true });
	}
});

test("login uses one local Gateway socket response and never projects its session secret", async () => {
	const homeDir = mkdtempSync(path.join(tmpdir(), "cealctl-local-owner-home-"));
	const socketDir = mkdtempSync(path.join(tmpdir(), "cealctl-local-owner-socket-"));
	const socketPath = path.join(socketDir, "gateway.sock");
	const origin = "https://ceal.example.test/corca-ai/ceal-prod";
	const refreshToken = `ceal_refresh_${"Q".repeat(43)}`;
	let observed = null;
	const server = createServer(async (request, reply) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		observed = { url: request.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
		return json(reply, 200, {
			schema_version: "cealctl.local_owner_login.v1", status: "authenticated", contract_revision: 2, profile: "operator",
			admin_api_origin: origin, deployment_id: "instance:prod",
			auth_issuer_origin: origin, auth_issuing_deployment_id: "instance:prod",
			access_token_expires_at: "2099-07-14T00:00:00.000Z", refresh_token: refreshToken,
			refresh_token_idle_expires_at: "2099-08-14T00:00:00.000Z",
			refresh_token_absolute_expires_at: "2099-10-14T00:00:00.000Z",
		});
	});
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
	try {
		const result = await asyncRun(["login", origin, "--session", "operator"], { homeDir, localGatewayOwnerSocketPath: socketPath });
		assert.equal(result.code, 0, result.stdout);
		assert.equal(result.stderr, "");
		assert.deepEqual(observed, {
			url: "/v1/operator/login",
			body: { schema_version: "cealctl.local_owner_login_request.v1", admin_api_origin: origin, profile: "operator" },
		});
		assert.doesNotMatch(result.stdout, new RegExp(refreshToken, "u"));
		assert.equal(parseYaml(result.stdout).session.name, "operator");
		const stored = readFileSync(path.join(homeDir, ".ceal", "cealctl", "sessions.json"), "utf8");
		assert.match(stored, new RegExp(refreshToken, "u"));
		assert.equal(statSync(path.join(homeDir, ".ceal", "cealctl", "sessions.json")).mode & 0o077, 0);
	} finally {
		await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		rmSync(homeDir, { recursive: true, force: true });
		rmSync(socketDir, { recursive: true, force: true });
	}
});

test("worker commands, JSON modes, and unsafe operands fail as redacted YAML", () => {
	for (const args of [["version", "--json"], ["version", "--format", "json"]]) {
		assert.equal(yamlRun(args, 2).error.kind, "invalid_argument");
	}
	for (const command of ["targets", "integrations", "objects", "call"]) {
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
	assert.equal(parseYaml(version.stdout).version, "0.65.0");
	const unknown = spawnSync(process.execPath, [binPath.pathname, "call", "unsafe-secret"], { encoding: "utf8" });
	assert.equal(unknown.status, 2);
	assert.doesNotMatch(`${unknown.stdout}${unknown.stderr}`, /unsafe-secret/u);
});

test("package metadata stays exact and packages only dist plus MIT license", () => {
	const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	assert.equal(manifest.name, "@corca-ai/ceal-operator-cli");
	assert.equal(manifest.version, "0.65.0");
	assert.equal(manifest.dependencies["@corca-ai/ceal-protocol"], "0.65.0");
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
	const result = await asyncRun(args, runtime);
	assert.equal(result.code, expectedCode, `${result.stderr}\n${result.stdout}`);
	assert.equal(result.stderr, "");
	return parseYaml(result.stdout);
}

async function asyncRun(args, runtime = {}) {
	let stdout = "";
	let stderr = "";
	const code = await runCealctlCommand(args, {
		stdout: { write(chunk) { stdout += String(chunk); } },
		stderr: { write(chunk) { stderr += String(chunk); } },
	}, runtime);
	return { code, stdout, stderr };
}

function json(response, status, body) {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

function response(status, body) {
	return new globalThis.Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function rotatedOperatorSession(origin, refreshToken) {
	return {
		schema_version: "cealctl.token_refresh.v1", profile: "operator", admin_api_origin: origin,
		deployment_id: "instance:test", auth_issuer_origin: origin, auth_issuing_deployment_id: "instance:test",
		access_token: `ceal_admin_${"A".repeat(43)}`,
		access_token_expires_at: "2099-07-14T00:00:00.000Z", refresh_token: refreshToken,
		refresh_token_idle_expires_at: "2099-08-14T00:00:00.000Z",
		refresh_token_absolute_expires_at: "2099-10-14T00:00:00.000Z",
	};
}

function runPackagedCealctl(args, homeDir) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [new URL("../dist/bin.js", import.meta.url).pathname, ...args], {
			env: { ...process.env, HOME: homeDir }, stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => { stdout += String(chunk); });
		child.stderr.on("data", (chunk) => { stderr += String(chunk); });
		child.once("error", reject);
		child.once("close", (code) => resolve({ code, stdout, stderr }));
	});
}

function delay(milliseconds) { return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)); }

function emptyAccessRegistry() {
	return { schema_version: "ceal.gateway_access_registry.v1", generation: 1, memberships: [], clients: [], grants: [] };
}

function emptyConnectorRegistry() {
	return { schema_version: "ceal.gateway_profile_connector_registry.v1", generation: 1, bindings: [] };
}

function compatibleContract(origin) {
	return {
		schema_version: "ceal.admin_api_contract.v1",
		contract_revision: 2,
		deployment_id: "instance:test",
		admin_api_origin: origin,
		features: [
			{ id: "operator_session.v2", routes: [
				{ method: "POST", path: "/api/cealctl/token/refresh", required_scope: null },
				{ method: "POST", path: "/api/cealctl/token/revoke", required_scope: null },
			] },
		{ id: "personal_client_access.v1", routes: [
			{ method: "GET", path: "/api/cealctl/v1/access", required_scope: "ceal.access.manage" },
			{ method: "PUT", path: "/api/cealctl/v1/access", required_scope: "ceal.access.manage" },
		] },
		{ id: "profile_connector_control.v1", routes: [
			{ method: "GET", path: "/api/cealctl/v1/profile-connectors", required_scope: "ceal.profile_connector.manage" },
			{ method: "PUT", path: "/api/cealctl/v1/profile-connectors", required_scope: "ceal.profile_connector.manage" },
		] },
		{ id: "profile_connector_readiness.v1", routes: [
			{ method: "POST", path: "/api/cealctl/v1/profile-connectors/check", required_scope: "ceal.profile_connector.inspect" },
		] },
			{ id: "personal_client_enrollment.v1", routes: [
				{ method: "POST", path: "/api/cealctl/v1/enrollments", required_scope: "ceal.client.enroll" },
			] },
		],
	};
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("connector registry decoder accepts an optional operation_policy and rejects malformed ones", () => {
	const base = {
		connector_binding_ref: "connector-binding:work-slack", profile_ref: "profile:work",
		connector_kind: "slack", connector_principal_ref: "connector-principal:work-slack-bot",
		revision: 2, status: "active",
	};
	const registry = (bindings) => ({ schema_version: "ceal.gateway_profile_connector_registry.v1", generation: 3, bindings });
	// An operator can now express a connector's operation policy (e.g. enabling message.create).
	const policy = ["message.search", "message.get", "resource.resolve", "conversation.thread.get", "message.create"];
	const decoded = decodeCealProfileConnectorRegistry(registry([{ ...base, operation_policy: policy }]));
	assert.deepEqual(decoded.bindings[0].operation_policy, policy);
	// A base binding without operation_policy still decodes (backward compatible).
	assert.ok(decodeCealProfileConnectorRegistry(registry([base])));
	// Malformed operation_policy values are rejected (empty, duplicate, bad ref, non-array).
	for (const bad of [[], ["message.search", "message.search"], ["not a ref!"], "message.create", { a: 1 }]) {
		assert.throws(() => decodeCealProfileConnectorRegistry(registry([{ ...base, operation_policy: bad }])), /invalid configuration/u);
	}
	// An unknown extra binding field is still rejected.
	assert.throws(() => decodeCealProfileConnectorRegistry(registry([{ ...base, extra: 1 }])), /invalid configuration/u);
});
