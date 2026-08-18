import assert from "node:assert/strict";
import test from "node:test";
import {
	parseSourceWorkerE2eArgs,
	sourceWorkerE2eHelp,
	sourceWorkerE2ePlan,
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
			"access_token: ceal_personal_SECRET",
			"error:",
			"  kind: invalid_response",
			"  message: provider-secret-body",
			"  next_action: Check the declared route.",
			"gateway_observation:",
			"  http_status: 401",
			"  response_kind: protocol_invalid",
		].join("\n"),
		"capabilities",
	);
	assert.equal((summary.error as Record<string, unknown>).kind, "invalid_response");
	assert.equal((summary.gateway_observation as Record<string, unknown>).response_kind, "protocol_invalid");
	assert.doesNotMatch(JSON.stringify(summary), /SECRET|provider-secret-body/u);
});

test("source-worker-e2e help distinguishes fixture tests from the live source-built lane", () => {
	const help = sourceWorkerE2eHelp();
	assert.match(help, /source-built Worker/u);
	assert.match(help, /--allow-live-gateway/u);
	assert.match(help, /--allow-provider-call/u);
	assert.match(help, /ceal-tester/u);
});
