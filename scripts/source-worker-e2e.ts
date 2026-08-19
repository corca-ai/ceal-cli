#!/usr/bin/env node

// Source-built Worker -> real Gateway E2E runner.
//
// The ordinary Worker test suites own deterministic local Gateway fixtures.
// This command is the separate operator lane for proving that the same source
// checkout can build a Worker entrypoint and reach a real Gateway without an
// installed release. It never chooses a provider capability or target on its
// own; the operator supplies values returned by live discovery.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { CEAL_SAFE_CURSOR } from "../packages/ceal-worker-cli/src/safe-ref.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_ENTRYPOINT = path.join(ROOT, "packages/ceal-worker-cli/dist/bin.js");
const BUILD_TIMEOUT_MS = 120_000;
const COMMAND_TIMEOUT_MS = 60_000;
const MAX_CAPTURED_OUTPUT = 512 * 1024;
const MAX_TARGET_PAGES = 16;
const SAFE_PROFILE = /^profile:[a-z0-9][a-z0-9._-]*$/u;
const TIMED_WORKER_COMMANDS = new Set(["capabilities", "targets", "call", "receipt", "session_refresh"]);

export type SourceWorkerE2eOptions = {
	help: boolean;
	doctor: boolean;
	plan: boolean;
	build: boolean;
	detail: boolean;
	json: boolean;
	allowLiveGateway: boolean;
	allowSessionRefresh: boolean;
	allowProviderCall: boolean;
	explicitSessionRefresh: boolean;
	boundaryReason?: string;
	profile?: string;
	capability?: string;
	target?: string;
	cursor?: string;
	arguments: string[];
};

type CommandResult = {
	args: readonly string[];
	exit_code: number;
	elapsed_ms: number;
	stdout: string;
	stderr: string;
	timed_out: boolean;
};

type RecordValue = Record<string, unknown>;

export function parseSourceWorkerE2eArgs(args: readonly string[]): SourceWorkerE2eOptions {
	const result: SourceWorkerE2eOptions = {
		help: false,
		doctor: false,
		plan: false,
		build: false,
		detail: false,
		json: false,
		allowLiveGateway: false,
		allowSessionRefresh: false,
		allowProviderCall: false,
		explicitSessionRefresh: false,
		arguments: [],
	};
	const seen = new Set<string>();
	const value = (index: number, name: string): string => {
		const candidate = args[index + 1];
		if (!candidate || candidate.startsWith("--")) throw new Error(`${name} requires a value`);
		return candidate;
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") {
			result.help = true;
			continue;
		}
		if (arg === "--doctor") {
			result.doctor = true;
			continue;
		}
		if (arg === "--plan") {
			result.plan = true;
			continue;
		}
		if (arg === "--build") {
			result.build = true;
			continue;
		}
		if (arg === "--detail") {
			result.detail = true;
			continue;
		}
		if (arg === "--json") {
			result.json = true;
			continue;
		}
		if (arg === "--allow-live-gateway") {
			result.allowLiveGateway = true;
			continue;
		}
		if (arg === "--allow-session-refresh") {
			result.allowSessionRefresh = true;
			continue;
		}
		if (arg === "--allow-provider-call") {
			result.allowProviderCall = true;
			continue;
		}
		if (arg === "--session-refresh") {
			result.explicitSessionRefresh = true;
			continue;
		}
		if (arg === "--boundary-reason") {
			if (seen.has(arg)) throw new Error("--boundary-reason may be supplied once");
			seen.add(arg);
			result.boundaryReason = value(index, arg);
			index += 1;
			continue;
		}
		if (arg === "--profile") {
			if (seen.has(arg)) throw new Error("--profile may be supplied once");
			seen.add(arg);
			result.profile = value(index, arg);
			index += 1;
			continue;
		}
		if (arg === "--capability") {
			if (seen.has(arg)) throw new Error("--capability may be supplied once");
			seen.add(arg);
			result.capability = value(index, arg);
			index += 1;
			continue;
		}
		if (arg === "--target") {
			if (seen.has(arg)) throw new Error("--target may be supplied once");
			seen.add(arg);
			result.target = value(index, arg);
			index += 1;
			continue;
		}
		if (arg === "--cursor") {
			if (seen.has(arg)) throw new Error("--cursor may be supplied once");
			seen.add(arg);
			result.cursor = value(index, arg);
			index += 1;
			continue;
		}
		if (arg === "--argument") {
			const operand = value(index, arg);
			if (!operand.includes("=")) throw new Error("--argument requires key=value");
			result.arguments.push(operand);
			index += 1;
			continue;
		}
		throw new Error(`unknown option: ${arg}`);
	}
	if (result.profile !== undefined && !SAFE_PROFILE.test(result.profile)) throw new Error("--profile must be a safe profile reference");
	if ((result.capability === undefined) !== (result.target === undefined))
		throw new Error("--capability and --target must be supplied together");
	if (result.cursor !== undefined && (result.capability === undefined || result.target === undefined))
		throw new Error("--cursor requires --capability and --target");
	if (result.cursor !== undefined && !CEAL_SAFE_CURSOR.test(result.cursor))
		throw new Error("--cursor must be a Gateway-issued opaque cursor");
	if (result.explicitSessionRefresh && !result.allowSessionRefresh) throw new Error("--session-refresh requires --allow-session-refresh");
	if (result.allowSessionRefresh && !result.boundaryReason) throw new Error("--allow-session-refresh requires --boundary-reason");
	if (result.allowProviderCall && !result.boundaryReason) throw new Error("--allow-provider-call requires --boundary-reason");
	if (result.capability !== undefined && !result.allowProviderCall) throw new Error("a provider call requires --allow-provider-call");
	if (result.allowProviderCall && !result.allowLiveGateway) throw new Error("--allow-provider-call requires --allow-live-gateway");
	if (result.explicitSessionRefresh && !result.allowLiveGateway) throw new Error("--session-refresh requires --allow-live-gateway");
	if (result.doctor && (result.plan || result.allowLiveGateway || result.explicitSessionRefresh || result.capability !== undefined))
		throw new Error("--doctor cannot be combined with an execution mode");
	if (result.plan && (result.doctor || result.allowLiveGateway || result.explicitSessionRefresh || result.capability !== undefined))
		throw new Error("--plan cannot be combined with an execution mode");
	return result;
}

export function sourceWorkerE2eHelp(): string {
	return [
		"Usage: npm run prove:source-e2e -- [options]",
		"",
		"Run the source-built Worker against the real Gateway when explicitly enabled.",
		"Normal unit/fixture tests do not call a live Gateway or provider.",
		"",
		"Read-only setup:",
		"  --doctor                     Check source entrypoint/build readiness only.",
		"  --plan                       Print the planned command sequence; do not run it.",
		"  --build                      Run the repo-owned local Worker build first.",
		"  --detail                     Include bounded command summaries and catalog counts.",
		"  --json                       Emit JSON instead of YAML.",
		"",
		"Live boundary:",
		"  --allow-live-gateway         Permit source Worker -> Gateway discovery.",
		"  --allow-session-refresh      Permit explicit/automatic Gateway session rotation.",
		"  --session-refresh            Force 'ceal session refresh' before discovery.",
		"  --boundary-reason <text>     Record why the live boundary is being exercised.",
		"",
		"Optional provider call (always opt-in):",
		"  --capability <id>            Capability id returned by live discovery.",
		"  --target <target-ref>        Exact opaque target ref returned for that capability.",
		"  --cursor <cursor-ref>        Optional current Gateway cursor to start bounded target paging.",
		"  --argument <key=value>       Repeat fields declared by that capability.",
		"  --allow-provider-call        Permit 'ceal call' and receipt readback.",
		"",
		"The runner never invents a target from a label. Resolve a safe resource such as",
		"ceal-tester through live target discovery, then pass its returned opaque ref.",
	].join("\n");
}

export function sourceWorkerE2ePlan(options: SourceWorkerE2eOptions): RecordValue {
	const profile = options.profile ? ` --profile ${options.profile}` : "";
	const commands = [
		...(options.build ? [{ command: "npm run build:worker", effect: "local_write" }] : []),
		{ command: "ceal version", effect: "read_only" },
		{ command: "ceal guide status", effect: "read_only" },
		{ command: "ceal session status", effect: "read_only" },
		{ command: "ceal capabilities --help", effect: "read_only" },
		...(options.explicitSessionRefresh ? [{ command: "ceal session refresh", effect: "remote_write" }] : []),
		{ command: `ceal capabilities${profile} --fresh --detail`, effect: "read_only", session_effect: "refresh_if_needed" },
		...(options.capability && options.target
			? [
					{
						command: `ceal capabilities targets --capability ${options.capability}${profile}${options.cursor ? ` --cursor ${options.cursor}` : ""} --limit 64 (follow up to ${MAX_TARGET_PAGES} Gateway pages)`,
						effect: "read_only",
						session_effect: "refresh_if_needed",
					},
					{ command: `ceal call ${options.capability} --target <returned-opaque-ref>${profile} <declared-arguments>`, effect: "remote_write" },
					{ command: "ceal receipt show <request-ref>", effect: "read_only" },
				]
			: []),
	];
	return {
		schema_version: "ceal.source_worker_e2e_plan.v1",
		command: "source-worker-e2e",
		status: "planned",
		worker_entrypoint: "packages/ceal-worker-cli/dist/bin.js",
		commands,
		non_claims: ["No Gateway, session, provider, Slack, or receipt action was executed."],
	};
}

export function summarizeYaml(stdout: string, kind: string): RecordValue {
	let value: unknown;
	try {
		value = parseYaml(stdout);
	} catch {
		return { kind, parse_status: "invalid", stdout_bytes: Buffer.byteLength(stdout) };
	}
	if (!isRecord(value)) return { kind, parse_status: "non_object" };
	const summary: RecordValue = { kind, parse_status: "valid", schema_version: value.schema_version, ok: value.ok, status: value.status };
	for (const key of [
		"version",
		"protocol_version",
		"access_status",
		"renewal_configured",
		"session_refresh",
		"proof_level",
		"live_gateway_checked",
		"failure_stage",
		"request_ref",
		"gateway_audit_readback",
		"provider_state_readback",
		"outcome",
		"carrier",
		"update_safe",
		"materialized",
		"guide_path",
	])
		if (value[key] !== undefined && isSafeSummaryValue(value[key])) summary[key] = value[key];
	if (isRecord(value.gateway))
		summary.gateway = pick(value.gateway, ["instance_ref", "profile_ref", "negotiated_protocol_version", "host_decision"]);
	if (isRecord(value.error)) summary.error = pick(value.error, ["kind", "next_action"]);
	if (isRecord(value.gateway_observation)) {
		const observation = pick(value.gateway_observation, [
			"phase",
			"operation",
			"network_reached",
			"http_response_received",
			"protocol_handshake_verified",
			"discovery_verified",
			"http_status",
			"response_content_type",
			"response_kind",
			"response_protocol_version",
			"response_schema_version",
			"response_envelope_kind",
			"response_error_code",
			"response_shape_issue",
		]);
		for (const key of ["response_protocol_version", "response_schema_version", "response_error_code"])
			if (value.gateway_observation[key] === null) observation[key] = null;
		summary.gateway_observation = observation;
	}
	if (Array.isArray(value.capabilities)) summary.capability_count = value.capabilities.length;
	if (Array.isArray(value.targets)) summary.target_count = value.targets.length;
	if (isRecord(value.receipt))
		summary.receipt = pick(value.receipt, ["request_ref", "status", "gateway_audit_readback", "provider_state_readback", "outcome"]);
	return summary;
}

/** Help is a human/agent surface, not a YAML result document. Keep its summary
 * typed as a surface probe instead of misclassifying valid plain-text help as
 * a failed response parse. */
export function summarizeHelp(stdout: string, kind: string): RecordValue {
	const hasUsage = /^Usage:/mu.test(stdout);
	const hasEffect = /^Effect:\s+\S+/mu.test(stdout);
	const hasSessionEffect = /^Session effect:\s+\S+/mu.test(stdout);
	return {
		kind,
		parse_status: hasUsage && hasEffect && hasSessionEffect ? "surface" : "invalid",
		surface_kind: "help",
		stdout_bytes: Buffer.byteLength(stdout),
	};
}

function isRecord(value: unknown): value is RecordValue {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeSummaryValue(value: unknown): value is string | number | boolean {
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function pick(value: RecordValue, keys: readonly string[]): RecordValue {
	return Object.fromEntries(keys.filter((key) => isSafeSummaryValue(value[key])).map((key) => [key, value[key]]));
}

function sha256(file: string): string {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function gitFact(args: readonly string[]): string | null {
	const result = spawnSyncNode("git", args, 10_000);
	return result.exit_code === 0 ? result.stdout.trim() : null;
}

function spawnSyncNode(command: string, args: readonly string[], timeout: number): CommandResult {
	const started = Date.now();
	const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", timeout, maxBuffer: MAX_CAPTURED_OUTPUT });
	const spawnError = result.error as NodeJS.ErrnoException | undefined;
	return {
		args,
		exit_code: result.status ?? 1,
		elapsed_ms: Date.now() - started,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		timed_out: spawnError?.code === "ETIMEDOUT",
	};
}

async function runProcess(command: string, args: readonly string[], timeoutMs: number): Promise<CommandResult> {
	const started = Date.now();
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const collect = (current: string, chunk: Buffer): string => {
			const next = current + chunk.toString("utf8");
			return next.length > MAX_CAPTURED_OUTPUT ? next.slice(0, MAX_CAPTURED_OUTPUT) : next;
		};
		child.stdout.on("data", (chunk: Buffer) => {
			stdout = collect(stdout, chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr = collect(stderr, chunk);
		});
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, timeoutMs);
		child.once("close", (code) => {
			clearTimeout(timer);
			resolve({ args, exit_code: code ?? 1, elapsed_ms: Date.now() - started, stdout, stderr, timed_out: timedOut });
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			resolve({ args, exit_code: 1, elapsed_ms: Date.now() - started, stdout, stderr: `${stderr}${error.message}`, timed_out: timedOut });
		});
	});
}

function commandSummary(result: CommandResult, kind: string): RecordValue {
	const timing = summarizeTimingStderr(result.stderr);
	return {
		...(kind === "capabilities_help" ? summarizeHelp(result.stdout, kind) : summarizeYaml(result.stdout, kind)),
		exit_code: result.exit_code,
		elapsed_ms: result.elapsed_ms,
		timed_out: result.timed_out,
		...(timing.length > 0 ? { timing } : {}),
	};
}

/** Keep only the Worker timing contract; never forward arbitrary stderr. */
export function summarizeTimingStderr(stderr: string): RecordValue[] {
	const events: RecordValue[] = [];
	for (const line of stderr.split(/\r?\n/u)) {
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(value) || value.schema_version !== "ceal.timing.v1" || value.event !== "finish") continue;
		if (typeof value.stage !== "string" || !/^[a-z][a-z0-9_]{0,63}$/u.test(value.stage)) continue;
		if (typeof value.elapsed_ms !== "number" || !Number.isFinite(value.elapsed_ms) || value.elapsed_ms < 0) continue;
		if (value.outcome !== "ok" && value.outcome !== "error") continue;
		events.push({ stage: value.stage, elapsed_ms: value.elapsed_ms, outcome: value.outcome });
	}
	return events;
}

async function main(): Promise<number> {
	let options: SourceWorkerE2eOptions;
	try {
		options = parseSourceWorkerE2eArgs(process.argv.slice(2));
	} catch (error) {
		return emit(
			{
				schema_version: "ceal.source_worker_e2e.v1",
				command: "source-worker-e2e",
				ok: false,
				status: "invalid_argument",
				error: { kind: "invalid_argument", message: error instanceof Error ? error.message : "invalid argument" },
			},
			false,
		);
	}
	if (options.help) {
		process.stdout.write(`${sourceWorkerE2eHelp()}\n`);
		return 0;
	}
	if (options.plan) return emit(sourceWorkerE2ePlan(options), options.json);
	const dirty = gitFact(["status", "--porcelain", "--untracked-files=no"]);
	const metadata = {
		entrypoint: "packages/ceal-worker-cli/dist/bin.js",
		entrypoint_sha256: existsSync(WORKER_ENTRYPOINT) ? sha256(WORKER_ENTRYPOINT) : null,
		source_head: gitFact(["rev-parse", "HEAD"]),
		source_tree: gitFact(["rev-parse", "HEAD^{tree}"]),
		source_dirty: dirty === null ? null : dirty !== "",
		home_mode: "current_process_HOME",
	};
	if (options.doctor) {
		const guide = existsSync(WORKER_ENTRYPOINT)
			? await runProcess(process.execPath, [WORKER_ENTRYPOINT, "guide", "status"], COMMAND_TIMEOUT_MS)
			: undefined;
		return emit(
			{
				schema_version: "ceal.source_worker_e2e_doctor.v1",
				command: "source-worker-e2e doctor",
				ok: existsSync(WORKER_ENTRYPOINT) && guide?.exit_code === 0,
				status: !existsSync(WORKER_ENTRYPOINT) ? "build_required" : guide?.exit_code === 0 ? "ready" : "source_guide_unavailable",
				source_worker: metadata,
				...(guide === undefined ? {} : { guide: commandSummary(guide, "guide") }),
				next_action: existsSync(WORKER_ENTRYPOINT)
					? guide?.exit_code === 0
						? "Run with --allow-live-gateway for an explicit live proof."
						: "Restore the source guide or build a matching signed Worker, then rerun this doctor."
					: "Run npm run build:worker, then rerun this doctor.",
			},
			options.json,
		);
	}
	const commands: RecordValue[] = [];
	if (options.build) {
		const build = await runProcess("npm", ["run", "build:worker"], BUILD_TIMEOUT_MS);
		commands.push(commandSummary(build, "build"));
		if (build.exit_code !== 0)
			return emit(
				{
					schema_version: "ceal.source_worker_e2e.v1",
					command: "source-worker-e2e",
					ok: false,
					status: "build_failed",
					source_worker: { ...metadata, entrypoint_sha256: existsSync(WORKER_ENTRYPOINT) ? sha256(WORKER_ENTRYPOINT) : null },
					commands,
					non_claims: ["No Gateway or provider action was executed."],
				},
				options.json,
			);
	}
	if (!options.allowLiveGateway)
		return emit(
			{
				schema_version: "ceal.source_worker_e2e.v1",
				command: "source-worker-e2e",
				ok: false,
				status: "boundary_required",
				source_worker: { ...metadata, entrypoint_sha256: existsSync(WORKER_ENTRYPOINT) ? sha256(WORKER_ENTRYPOINT) : null },
				commands,
				error: {
					kind: "live_gateway_not_authorized",
					message: "Live discovery is disabled by default.",
					next_action: "Pass --allow-live-gateway; add --allow-session-refresh --boundary-reason when the stored session may rotate.",
				},
				non_claims: ["No Gateway or provider action was executed."],
			},
			options.json,
		);
	if (!existsSync(WORKER_ENTRYPOINT))
		return emit(
			{
				schema_version: "ceal.source_worker_e2e.v1",
				command: "source-worker-e2e",
				ok: false,
				status: "build_required",
				source_worker: metadata,
				commands,
				error: {
					kind: "source_worker_not_built",
					message: "The source-built Worker entrypoint is missing.",
					next_action: "Run npm run build:worker or pass --build.",
				},
			},
			options.json,
		);
	const worker = (args: readonly string[], kind: string) =>
		runProcess(
			process.execPath,
			[WORKER_ENTRYPOINT, ...(TIMED_WORKER_COMMANDS.has(kind) ? ["--timing"] : []), ...args],
			COMMAND_TIMEOUT_MS,
		).then((result) => {
			const summary = commandSummary(result, kind);
			commands.push(summary);
			return { result, summary };
		});
	const version = await worker(["version"], "version");
	const guide = await worker(["guide", "status"], "guide");
	const session = await worker(["session", "status"], "session");
	const help = await worker(["capabilities", "--help"], "capabilities_help");
	const autoRefreshRequired = help.result.stdout.includes("Session effect: refresh_if_needed");
	if ([version, guide, session, help].some((entry) => entry.result.exit_code !== 0) || !autoRefreshRequired)
		return emit(
			{
				schema_version: "ceal.source_worker_e2e.v1",
				command: "source-worker-e2e",
				ok: false,
				status: "source_contract_failed",
				source_worker: { ...metadata, entrypoint_sha256: sha256(WORKER_ENTRYPOINT) },
				session: session.summary,
				commands,
				error: {
					kind: "source_worker_contract_unverified",
					message: "The source-built Worker preflight did not prove the expected session-refresh declaration.",
					next_action: "Inspect version, guide, session, and capabilities help before using the live lane.",
				},
				non_claims: ["No Gateway discovery or provider action was executed because source Worker preflight was not proven."],
			},
			options.json,
		);
	const refreshAuthorized = options.allowSessionRefresh && Boolean(options.boundaryReason);
	if (autoRefreshRequired && !refreshAuthorized)
		return emit(
			{
				schema_version: "ceal.source_worker_e2e.v1",
				command: "source-worker-e2e",
				ok: false,
				status: "session_refresh_boundary_required",
				source_worker: { ...metadata, entrypoint_sha256: sha256(WORKER_ENTRYPOINT) },
				session: session.summary,
				commands,
				boundary: {
					live_gateway_allowed: true,
					session_refresh_allowed: false,
					provider_call_allowed: false,
					boundary_reason_supplied: Boolean(options.boundaryReason),
				},
				error: {
					kind: "session_refresh_not_authorized",
					message: "The source Worker declares refresh_if_needed for capabilities.",
					next_action: "Pass --allow-session-refresh --boundary-reason <text> to authorize this live E2E run.",
				},
				non_claims: ["No Gateway discovery or provider action was executed because session refresh authorization was absent."],
			},
			options.json,
		);
	if (options.explicitSessionRefresh) await worker(["session", "refresh"], "session_refresh");
	const capabilityArgs = [
		"capabilities",
		...(options.profile ? ["--profile", options.profile] : []),
		"--fresh",
		...(options.detail ? ["--detail"] : []),
	];
	const discovery = await worker(capabilityArgs, "capabilities");
	let providerCallSucceeded = !options.capability;
	if (options.capability && options.target && discovery.result.exit_code === 0) {
		let targetReturned = false;
		let targetCursor = options.cursor;
		for (let page = 0; page < MAX_TARGET_PAGES && !targetReturned; page += 1) {
			const targets = await worker(
				[
					"capabilities",
					"targets",
					"--capability",
					options.capability,
					...(options.profile ? ["--profile", options.profile] : []),
					"--limit",
					"64",
					...(targetCursor ? ["--cursor", targetCursor] : []),
					...(options.detail ? ["--detail"] : []),
				],
				"targets",
			);
			if (targets.result.exit_code !== 0)
				return emit(
					{
						schema_version: "ceal.source_worker_e2e.v1",
						command: "source-worker-e2e",
						ok: false,
						status: "target_discovery_failed",
						source_worker: { ...metadata, entrypoint_sha256: sha256(WORKER_ENTRYPOINT) },
						session: session.summary,
						commands,
						error: {
							kind: "target_discovery_failed",
							next_action: "Use the returned Gateway error and re-run target discovery only after its recovery instruction is satisfied.",
						},
						non_claims: ["No provider call was executed because target discovery failed."],
					},
					options.json,
				);
			targetReturned = targetRefReturned(targets.result.stdout, options.target);
			if (targetReturned) break;
			targetCursor = nextTargetCursor(targets.result.stdout);
			if (!targetCursor) break;
		}
		if (!targetReturned)
			return emit(
				{
					schema_version: "ceal.source_worker_e2e.v1",
					command: "source-worker-e2e",
					ok: false,
					status: "target_not_returned",
					source_worker: { ...metadata, entrypoint_sha256: sha256(WORKER_ENTRYPOINT) },
					session: session.summary,
					commands,
					error: {
						kind: "target_not_returned",
						next_action: "Use an opaque target_ref returned for this capability by the immediately preceding target discovery.",
					},
					non_claims: ["No provider call was executed because the supplied target was not returned by Gateway discovery."],
				},
				options.json,
			);
		const callArgs = [
			"call",
			options.capability,
			"--target",
			options.target,
			...(options.profile ? ["--profile", options.profile] : []),
			...options.arguments,
		];
		const call = await worker(callArgs, "call");
		const requestRef = callRequestRef(call.result.stdout);
		const receipt = requestRef
			? await worker(["receipt", "show", requestRef, ...(options.profile ? ["--profile", options.profile] : [])], "receipt")
			: undefined;
		providerCallSucceeded = call.result.exit_code === 0 && receipt?.result.exit_code === 0;
	}
	const ok = discovery.result.exit_code === 0 && providerCallSucceeded;
	const failureStage = discovery.result.exit_code !== 0 ? "gateway_discovery" : providerCallSucceeded ? undefined : "provider_roundtrip";
	return emit(
		{
			schema_version: "ceal.source_worker_e2e.v1",
			command: "source-worker-e2e",
			ok,
			status: ok ? "completed" : failureStage === "gateway_discovery" ? "gateway_discovery_failed" : "provider_roundtrip_failed",
			...(failureStage ? { failure_stage: failureStage } : {}),
			source_worker: { ...metadata, entrypoint_sha256: sha256(WORKER_ENTRYPOINT) },
			session: session.summary,
			commands,
			boundary: {
				live_gateway_allowed: true,
				session_refresh_allowed: refreshAuthorized,
				provider_call_allowed: options.allowProviderCall,
				boundary_reason_supplied: Boolean(options.boundaryReason),
			},
			non_claims: [
				"This is source-built local checkout evidence, not a signed release or installed-client proof.",
				...(options.capability ? [] : ["No provider call was requested; no provider state is claimed."]),
			],
		},
		options.json,
	);
}

function parseValue(stdout: string): unknown {
	try {
		return parseYaml(stdout);
	} catch {
		return undefined;
	}
}

export function targetRefReturned(stdout: string, targetRef: string): boolean {
	const value = parseValue(stdout);
	if (!isRecord(value) || !Array.isArray(value.targets)) return false;
	return value.targets.some((target) => isRecord(target) && target.target_ref === targetRef);
}

export function nextTargetCursor(stdout: string): string | undefined {
	const value = parseValue(stdout);
	if (!isRecord(value) || !isRecord(value.target_catalog)) return undefined;
	const cursor = value.target_catalog.next_cursor;
	return typeof cursor === "string" && CEAL_SAFE_CURSOR.test(cursor) ? cursor : undefined;
}

export function callRequestRef(stdout: string): string | undefined {
	const value = parseValue(stdout);
	if (!isRecord(value)) return undefined;
	if (typeof value.request_ref === "string") return value.request_ref;
	return isRecord(value.receipt) && typeof value.receipt.request_ref === "string" ? value.receipt.request_ref : undefined;
}

function emit(value: RecordValue, json: boolean): number {
	process.stdout.write(json ? `${JSON.stringify(value)}\n` : stringifyYaml(value));
	return value.ok === false ||
		[
			"boundary_required",
			"build_required",
			"build_failed",
			"gateway_discovery_failed",
			"provider_roundtrip_failed",
			"source_contract_failed",
			"target_discovery_failed",
			"target_not_returned",
			"session_refresh_boundary_required",
			"invalid_argument",
		].includes(String(value.status))
		? 3
		: 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly)
	main()
		.then((exitCode) => {
			process.exitCode = exitCode;
		})
		.catch((error) => {
			process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
			process.exitCode = 1;
		});
