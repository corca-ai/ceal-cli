import { resolvePairedProtocolSpecifier, resolvePairedSourceProtocol } from "../../scripts/paired-source-protocol-resolver.ts";
import {
	callRequestRef,
	nextTargetCursor,
	parseSourceWorkerE2eArgs,
	sourceWorkerE2eHelp,
	sourceWorkerE2ePlan,
	sourceWorkerLaunchSpec,
	summarizeHelp,
	summarizeTimingStderr,
	summarizeYaml,
	targetRefReturned,
} from "../../scripts/source-worker-e2e.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function pairedGatewayFixture() {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-paired-protocol-"));
	const packageRoot = path.join(root, "packages", "ceal-protocol");
	const sourceRoot = path.join(packageRoot, "src");
	const distRoot = path.join(packageRoot, "dist");
	mkdirSync(sourceRoot, { recursive: true });
	mkdirSync(distRoot, { recursive: true });
	writeFileSync(
		path.join(packageRoot, "package.json"),
		JSON.stringify({ name: "@corca-ai/ceal-protocol", version: "9.9.9", type: "module", main: "./dist/index.js" }),
	);
	writeFileSync(path.join(sourceRoot, "index.ts"), "export const source = true;\n");
	writeFileSync(path.join(sourceRoot, "conformance.ts"), "export const conformance = true;\n");
	writeFileSync(path.join(distRoot, "index.js"), "export const source = true;\n");
	writeFileSync(path.join(distRoot, "conformance.js"), "export const conformance = true;\n");
	utimesSync(path.join(sourceRoot, "index.ts"), new Date(1_000), new Date(1_000));
	utimesSync(path.join(sourceRoot, "conformance.ts"), new Date(1_000), new Date(1_000));
	utimesSync(path.join(distRoot, "index.js"), new Date(2_000), new Date(2_000));
	utimesSync(path.join(distRoot, "conformance.js"), new Date(2_000), new Date(2_000));
	return { root, packageRoot, sourceRoot, distRoot };
}

test("source-worker-e2e keeps paired source off by default and names the frozen vendor", () => {
	const options = parseSourceWorkerE2eArgs(["--plan"]);
	assert.equal(options.gatewayRepoRoot, undefined);
	const plan = sourceWorkerE2ePlan(options);
	assert.deepEqual(plan.protocol_source, { mode: "frozen_local_vendor" });
	assert.match(JSON.stringify(plan.non_claims), /installed or released parity/u);
});

test("source-worker-e2e fails closed for a malformed or missing paired Gateway root", () => {
	const missing = resolvePairedSourceProtocol(path.join(tmpdir(), "ceal-paired-protocol-does-not-exist"));
	assert.equal(missing.ok, false);
	if (!missing.ok) assert.equal(missing.code, "gateway_repo_root_missing");
	const { root, packageRoot } = pairedGatewayFixture();
	try {
		writeFileSync(
			path.join(packageRoot, "package.json"),
			JSON.stringify({ name: "not-the-protocol", version: "9.9.9", type: "module", main: "./dist/index.js" }),
		);
		const malformed = resolvePairedSourceProtocol(root);
		assert.equal(malformed.ok, false);
		if (!malformed.ok) {
			assert.equal(malformed.code, "gateway_protocol_package_identity_mismatch");
			assert.match(malformed.next_action, /npm --prefix/u);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source-worker-e2e refuses a stale paired dist with an actionable Gateway build", () => {
	const { root, sourceRoot, distRoot } = pairedGatewayFixture();
	try {
		utimesSync(path.join(sourceRoot, "index.ts"), new Date(3_000), new Date(3_000));
		utimesSync(path.join(distRoot, "conformance.js"), new Date(4_000), new Date(4_000));
		const stale = resolvePairedSourceProtocol(root);
		assert.equal(stale.ok, false);
		if (!stale.ok) {
			assert.equal(stale.code, "gateway_protocol_dist_stale");
			assert.match(stale.next_action, /npm --prefix .*packages[\\/]ceal-protocol.* run build/u);
			assert.match(stale.next_action, /does not build or copy/u);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source-worker-e2e rejects an incomplete paired dist before launching a Worker", () => {
	const { root, distRoot } = pairedGatewayFixture();
	try {
		unlinkSync(path.join(distRoot, "conformance.js"));
		const incomplete = resolvePairedSourceProtocol(root);
		assert.equal(incomplete.ok, false);
		if (!incomplete.ok) assert.equal(incomplete.code, "gateway_protocol_dist_stale");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source-worker-e2e composes paired Worker argv, env, and import-hook mapping", () => {
	const { root, distRoot } = pairedGatewayFixture();
	try {
		const resolution = resolvePairedSourceProtocol(root);
		assert.equal(resolution.ok, true);
		if (!resolution.ok) return;
		const launch = sourceWorkerLaunchSpec("/worker/dist/bin.js", ["capabilities", "--help"], "capabilities", resolution.protocol);
		assert.equal(launch.command, process.execPath);
		assert.deepEqual(launch.args.slice(0, 2), ["--import", path.resolve("scripts/paired-source-protocol-resolver.ts")]);
		assert.deepEqual(launch.args.slice(2), ["/worker/dist/bin.js", "--timing", "capabilities", "--help"]);
		assert.equal(launch.env.CEAL_PAIRED_SOURCE_PROTOCOL_DIST, distRoot);
		assert.equal(launch.env.CEAL_PAIRED_SOURCE_PROTOCOL_DIST_SHA256, resolution.protocol.dist_sha256);
		assert.equal(launch.env.CEAL_PAIRED_SOURCE_GATEWAY_ROOT, root);
		assert.equal(launch.env.CEAL_PAIRED_SOURCE_PROTOCOL_LOADER, "1");
		assert.equal(resolvePairedProtocolSpecifier("@corca-ai/ceal-protocol", distRoot), path.join(distRoot, "index.js"));
		assert.equal(resolvePairedProtocolSpecifier("@corca-ai/not-protocol", distRoot), null);
		assert.throws(() => resolvePairedProtocolSpecifier("@corca-ai/ceal-protocol/conformance", distRoot), /unsupported subpath/u);
		assert.throws(() => resolvePairedProtocolSpecifier("@corca-ai/ceal-protocol/private", distRoot), /unsupported subpath/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source-worker-e2e child refuses dist bytes changed after parent validation", () => {
	const { root, distRoot } = pairedGatewayFixture();
	const workerEntrypoint = path.join(root, "worker.mjs");
	try {
		writeFileSync(workerEntrypoint, 'import { source } from "@corca-ai/ceal-protocol"; process.stdout.write(String(source));\n');
		const resolution = resolvePairedSourceProtocol(root);
		assert.equal(resolution.ok, true);
		if (!resolution.ok) return;
		const launch = sourceWorkerLaunchSpec(workerEntrypoint, [], "guide", resolution.protocol);
		writeFileSync(path.join(distRoot, "index.js"), "export const source = false;\n");
		const child = spawnSync(launch.command, launch.args, {
			cwd: path.resolve("."),
			encoding: "utf8",
			env: { ...process.env, ...launch.env },
		});
		assert.notEqual(child.status, 0);
		assert.match(child.stderr, /child validation does not match/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source-worker-e2e resolver hook loads the paired Protocol in a real child process", () => {
	const { root } = pairedGatewayFixture();
	const workerEntrypoint = path.join(root, "worker.mjs");
	try {
		writeFileSync(workerEntrypoint, 'import { source } from "@corca-ai/ceal-protocol"; process.stdout.write(JSON.stringify({ source }));\n');
		const resolution = resolvePairedSourceProtocol(root);
		assert.equal(resolution.ok, true);
		if (!resolution.ok) return;
		const launch = sourceWorkerLaunchSpec(workerEntrypoint, [], "guide", resolution.protocol);
		const child = spawnSync(launch.command, launch.args, {
			cwd: path.resolve("."),
			encoding: "utf8",
			env: { ...process.env, ...launch.env },
		});
		assert.equal(child.status, 0, child.stderr);
		assert.deepEqual(JSON.parse(child.stdout), { source: true });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

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
		"--cursor",
		"cursor:page-two",
		"--argument",
		"text=source E2E",
		"--allow-provider-call",
	]);
	assert.equal(options.allowLiveGateway, true);
	assert.equal(options.allowSessionRefresh, true);
	assert.equal(options.allowProviderCall, true);
	assert.equal(options.freshDiscovery, false);
	assert.equal(options.cursor, "cursor:page-two");
	assert.deepEqual(options.arguments, ["text=source E2E"]);
	const plan = sourceWorkerE2ePlan(options);
	assert.equal(plan.status, "planned");
	const commands = plan.commands as Array<Record<string, unknown>>;
	assert.equal(commands.at(-3)?.effect, "read_only");
	assert.match(String(commands.at(-3)?.command), /capabilities targets/u);
	assert.match(String(commands.at(-3)?.command), /--cursor cursor:page-two/u);
	assert.match(String(commands.at(-3)?.command), /follow up to 16 Gateway pages/u);
	assert.equal(commands.at(-2)?.effect, "remote_write");
	assert.match(String(commands.at(-2)?.command), /returned-opaque-ref/u);
	assert.doesNotMatch(String(commands.at(-2)?.command), /target:opaque/u);
	const catalogCommand = commands.find(
		(command) => String(command.command).startsWith("ceal capabilities") && !String(command.command).includes("--help"),
	);
	assert.equal(catalogCommand?.effect, "read_only");
	assert.doesNotMatch(String(catalogCommand?.command), /--fresh/u);
	const freshPlan = sourceWorkerE2ePlan({ ...options, freshDiscovery: true });
	const freshCommands = freshPlan.commands as Array<Record<string, unknown>>;
	assert.match(
		String(
			freshCommands.find((command) => String(command.command).startsWith("ceal capabilities") && !String(command.command).includes("--help"))
				?.command,
		),
		/--fresh/u,
	);
	assert.doesNotMatch(
		String(freshCommands.find((command) => String(command.command).includes("capabilities targets"))?.command),
		/--fresh/u,
	);
	assert.equal(targetRefReturned("targets:\n  - target_ref: target:opaque\n", "target:opaque"), true);
	assert.equal(targetRefReturned("targets: []\n", "target:opaque"), false);
	assert.equal(nextTargetCursor("target_catalog:\n  next_cursor: cursor:page-two\n"), "cursor:page-two");
	assert.equal(nextTargetCursor("target_catalog:\n  next_cursor: unsafe cursor\n"), undefined);
});

test("source-worker-e2e extracts a request ref from either call result shape", () => {
	assert.equal(callRequestRef("request_ref: ceal:top-level:call\n"), "ceal:top-level:call");
	assert.equal(callRequestRef("receipt:\n  request_ref: ceal:nested:call\n  status: completed\n"), "ceal:nested:call");
	assert.equal(callRequestRef("status: completed\n"), undefined);
});

test("source-worker-e2e rejects a provider call without its separate boundary", () => {
	assert.throws(
		() => parseSourceWorkerE2eArgs(["--allow-live-gateway", "--capability", "message.create", "--target", "target:x"]),
		/allow-provider-call/u,
	);
	assert.throws(() => parseSourceWorkerE2eArgs(["--allow-live-gateway", "--cursor", "cursor:page-two"]), /--cursor requires/u);
	assert.throws(
		() =>
			parseSourceWorkerE2eArgs(["--allow-live-gateway", "--capability", "message.create", "--target", "target:x", "--cursor", "not-a-cursor"]),
		/opaque cursor/u,
	);
	assert.throws(() => parseSourceWorkerE2eArgs(["--allow-live-gateway", "--allow-session-refresh"]), /boundary-reason/u);
	assert.throws(() => parseSourceWorkerE2eArgs(["--doctor", "--allow-live-gateway"]), /doctor cannot/u);
});

test("source-worker-e2e parses the deliberate fresh-discovery opt-in", () => {
	const options = parseSourceWorkerE2eArgs(["--fresh-discovery", "--plan"]);
	assert.equal(options.freshDiscovery, true);
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
	assert.equal(
		(summary.gateway_observation as Record<string, unknown>).response_shape_issue,
		"discovery_target_catalog_incomplete_without_cursor",
	);
	assert.equal(summary.failure_stage, "gateway_discovery");
	assert.doesNotMatch(JSON.stringify(summary), /SECRET|provider-secret-body/u);
});

test("source-worker-e2e retains the local guide carrier without treating it as a release claim", () => {
	const summary = summarizeYaml(
		[
			"schema_version: ceal.guide.v1",
			"ok: true",
			"status: available",
			"carrier: source",
			"update_safe: false",
			"guide_path: /checkout/skills/ceal-guide",
		].join("\n"),
		"guide",
	);
	assert.equal(summary.carrier, "source");
	assert.equal(summary.update_safe, false);
	assert.equal(summary.guide_path, "/checkout/skills/ceal-guide");
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
	assert.match(help, /--fresh-discovery/u);
	assert.match(help, /ceal-tester/u);
});
