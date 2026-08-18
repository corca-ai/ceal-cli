import assert from "node:assert/strict";
import test from "node:test";
import {
	parseSourceWorkerE2eArgs,
	sourceWorkerE2eHelp,
	sourceWorkerE2ePlan,
	summarizeHelp,
	summarizeTimingStderr,
	summarizeYaml,
	targetRefReturned,
} from "../../scripts/source-worker-e2e.ts";

test("source-worker-e2e keeps the live lane explicitly opt-in and records session refresh separately", () => {
	const options = parseSourceWorkerE2eArgs([
		"--allow-live-gateway",
		"--allow-session-refresh",
		"--boundary-reason",
		"local E2E acceptance",
		"--capability",
		"message.create",
		"--target",
		"target:opaque",
		"--argument",
		"text=source E2E",
		"--allow-provider-call",
	]);
	assert.equal(options.allowLiveGateway, true);
	assert.equal(options.allowSessionRefresh, true);
	assert.equal(options.allowProviderCall, true);
	assert.deepEqual(options.arguments, ["text=source E2E"]);
	const plan = sourceWorkerE2ePlan(options);
	assert.equal(plan.status, "planned");
	const commands = plan.commands as Array<Record<string, unknown>>;
	assert.equal(commands.at(-3)?.effect, "read_only");
	assert.match(String(commands.at(-3)?.command), /capabilities targets/u);
	assert.equal(commands.at(-2)?.effect, "remote_write");
	assert.match(String(commands.at(-2)?.command), /returned-opaque-ref/u);
	assert.doesNotMatch(String(commands.at(-2)?.command), /target:opaque/u);
	assert.equal(targetRefReturned("targets:\n  - target_ref: target:opaque\n", "target:opaque"), true);
	assert.equal(targetRefReturned("targets: []\n", "target:opaque"), false);
});

test("source-worker-e2e rejects a provider call without its separate boundary", () => {
	assert.throws(
		() => parseSourceWorkerE2eArgs(["--allow-live-gateway", "--capability", "message.create", "--target", "target:x"]),
		/allow-provider-call/u,
	);
	assert.throws(() => parseSourceWorkerE2eArgs(["--allow-live-gateway", "--allow-session-refresh"]), /boundary-reason/u);
	assert.throws(() => parseSourceWorkerE2eArgs(["--doctor", "--allow-live-gateway"]), /doctor cannot/u);
});

test("source-worker-e2e summaries omit tokens and raw provider response bodies", () => {
	const summary = summarizeYaml(
		[
			"schema_version: ceal.capabilities.v1",
			"ok: false",
			"status: unavailable",
			"failure_stage: gateway_discovery",
			"access_token: ceal_personal_SECRET",
			"error:",
			"  kind: invalid_response",
			"  message: provider-secret-body",
			"  next_action: Check the declared route.",
			"gateway_observation:",
			"  http_status: 401",
			"  response_kind: protocol_invalid",
			"  response_protocol_version: 1.2.0",
			"  response_schema_version: null",
			"  response_envelope_kind: failure",
			"  response_error_code: authentication_failed",
			"  response_shape_issue: discovery_target_catalog_incomplete_without_cursor",
		].join("\n"),
		"capabilities",
	);
	assert.equal((summary.error as Record<string, unknown>).kind, "invalid_response");
	assert.equal((summary.gateway_observation as Record<string, unknown>).response_kind, "protocol_invalid");
	assert.equal((summary.gateway_observation as Record<string, unknown>).response_protocol_version, "1.2.0");
	assert.equal((summary.gateway_observation as Record<string, unknown>).response_schema_version, null);
	assert.equal((summary.gateway_observation as Record<string, unknown>).response_envelope_kind, "failure");
	assert.equal((summary.gateway_observation as Record<string, unknown>).response_error_code, "authentication_failed");
	assert.equal((summary.gateway_observation as Record<string, unknown>).response_shape_issue, "discovery_target_catalog_incomplete_without_cursor");
	assert.equal(summary.failure_stage, "gateway_discovery");
	assert.doesNotMatch(JSON.stringify(summary), /SECRET|provider-secret-body/u);
});

test("source-worker-e2e classifies plain-text capabilities help as a surface probe", () => {
	const summary = summarizeHelp("Usage: ceal capabilities\nEffect: read_only\nSession effect: refresh_if_needed\n", "capabilities_help");
	assert.equal(summary.parse_status, "surface");
	assert.equal(summary.surface_kind, "help");
	assert.equal(summarizeHelp("not help", "capabilities_help").parse_status, "invalid");
});

test("source-worker-e2e preserves only bounded Worker finish timings from stderr", () => {
	const timing = summarizeTimingStderr(
		[
			JSON.stringify({ schema_version: "ceal.timing.v1", event: "start", stage: "gateway_discovery" }),
			JSON.stringify({
				schema_version: "ceal.timing.v1",
				event: "finish",
				stage: "gateway_handshake",
				elapsed_ms: 12.5,
				outcome: "ok",
				token: "secret",
			}),
			JSON.stringify({
				schema_version: "ceal.timing.v1",
				event: "finish",
				stage: "gateway_discovery",
				elapsed_ms: 345.75,
				outcome: "error",
				response_body: "provider payload",
			}),
			JSON.stringify({ schema_version: "ceal.timing.v1", event: "finish", stage: "bad stage", elapsed_ms: 1, outcome: "ok" }),
			"not json",
		].join("\n"),
	);
	assert.deepEqual(timing, [
		{ stage: "gateway_handshake", elapsed_ms: 12.5, outcome: "ok" },
		{ stage: "gateway_discovery", elapsed_ms: 345.75, outcome: "error" },
	]);
	assert.doesNotMatch(JSON.stringify(timing), /secret|provider payload/u);
});

test("source-worker-e2e help distinguishes fixture tests from the live source-built lane", () => {
	const help = sourceWorkerE2eHelp();
	assert.match(help, /source-built Worker/u);
	assert.match(help, /--allow-live-gateway/u);
	assert.match(help, /--allow-provider-call/u);
	assert.match(help, /ceal-tester/u);
});
