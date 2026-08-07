import { CealHttpTransportError, createCealClient, createCealHttpTransport } from "@corca-ai/ceal";
import type {
	CealGatewayAnnouncementPolicy,
	CealGatewayAuditEvent,
	CealGatewayCallValue,
	CealGatewayDiscoveryCapability,
	CealGatewayDiscoveryValue,
	CealGatewayHandshakeValue,
} from "@corca-ai/ceal-protocol";
import { CEAL_PROTOCOL_VERSION, CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE } from "@corca-ai/ceal-protocol";
import { buildAcceptanceRecord, readInstalledReleaseFacts } from "./acceptance-record.js";
import { type CealAgentGuideHost, isCealAgentGuideHost } from "./agent-guide.js";
import {
	type CealCallResultRecorder,
	type CealCapabilityEffect,
	type CealParsedCapabilityCall,
	classifyGatewayFailure,
	gatewayFailureCode,
	gatewayResultIdentity,
	writeCallCompleted,
	writeCallGatewayFailure,
	writeCallIncomplete,
	writeCallUnavailable,
} from "./call-result-output.js";
import { validCapabilityId, validTargetRef } from "./capability-arguments.js";
import type { CealCliIo, CealCommandRuntime, CealStableUpdateProgressStage, CealStableUpdateResult } from "./cli-runtime.js";
import {
	CealClientSessionError,
	classifyClientSessionFailure,
	ensureCurrentSession,
	isClassifiedClientSessionFailure,
	runSession,
	SESSION_ROUTES,
	writeClientSessionUnavailable,
} from "./client-session.js";
import { type CealDiscoveryCacheKey, DEFAULT_DISCOVERY_CACHE_TTL_MS, discoveryCacheEntryUsable } from "./discovery-cache.js";
import { parseNamedOptions, unknownNamedOption } from "./named-options.js";
import { createCealObserverServer, OBSERVER_DATA_SOURCES } from "./observer.js";
import { writeHelp, writeYaml } from "./output.js";
import type { CealStoredSession } from "./profile-store.js";
import { callResultCarriesReceipt, receiptSpoolEntryFromCallResult } from "./receipt-spool.js";
import {
	CEAL_SUBCOMMANDS,
	type CealSubcommandDefinition,
	type CealSubcommandHandlers,
	findSubcommand,
	resolveSubcommandRoute,
	splitSubcommandRoute,
	subcommandsOf,
} from "./subcommands.js";

export type { CealSubcommandDefinition, CealSubcommandHandlers, CealSubcommandRouteKey } from "./subcommands.js";
export { CEAL_SUBCOMMANDS, resolveSubcommandRoute, splitSubcommandRoute, subcommandRouteKey } from "./subcommands.js";
export { renderPlainYamlDocument } from "./yaml.js";

// Read from the manifest npm already owns rather than retyped here. The release
// smoke test compares this against `package.json` by running the built binary,
// so a drifted literal used to fail a tagged run — late, and only on a host that
// runs that platform-gated proof. Deriving it removes the drift instead of
// catching it. `dist` and `src` both sit one level below the package root, and
// esbuild inlines the JSON when the single-executable binary is bundled, so the
// specifier resolves identically in source, in `dist`, and inside the artifact.
import packageJson from "../package.json" with { type: "json" };

const CEAL_PACKAGE_VERSION: string = packageJson.version;
const CREDENTIAL_CONTEXT = "gateway_issued_client_session" as const;
const PROTOCOL_VERSION = CEAL_PROTOCOL_VERSION;

// 0xCEA1: a stable, unregistered default so the printed observer URL is
// predictable across sessions; --port 0 selects an ephemeral port instead.
const DEFAULT_OBSERVER_PORT = 52897;

type CatalogProvenance = { source: "live_discovery" } | { source: "cached_discovery"; cachedAt: number; expiresAt: number };

// The first call received an explicit authentication rejection, so no provider
// invocation happened. Keep a failed renewal distinct from a transport loss
// after a call was actually dispatched.
class CealKnownPreProviderCallError extends Error {
	constructor(readonly cause: unknown) {
		super("The Gateway rejected the call before provider execution.");
	}
}

export type { CealCliIo, CealCommandRuntime, CealStableUpdateResult } from "./cli-runtime.js";

export interface CealCommandDefinition {
	name: "version" | "commands" | "update" | "guide" | "capabilities" | "session" | "call" | "receipt" | "observe" | "acceptance";
	description: string;
	usage: string;
	effect: "read_only" | "local_write" | "read_only_or_local_write";
	evidence: "surface" | "surface_or_host_decision";
	result_schema: string;
	recovery: string;
}

export const CEAL_COMMANDS: readonly CealCommandDefinition[] = [
	{
		name: "version",
		description: "Show CLI and protocol versions.",
		usage: "ceal version",
		effect: "read_only",
		evidence: "surface",
		result_schema: "ceal.version.v1",
		recovery: "Run 'ceal version' again after installing or updating the CLI.",
	},
	{
		name: "commands",
		description: "Discover worker-facing commands.",
		usage: "ceal commands",
		effect: "read_only",
		evidence: "surface",
		result_schema: "ceal.commands.v1",
		recovery: "Descend with 'ceal <command> --help' before invoking a command.",
	},
	{
		name: "update",
		description: "Install the latest stable signed worker release into this local prefix.",
		usage: "ceal update",
		effect: "local_write",
		evidence: "surface",
		result_schema: "ceal.update.v1",
		recovery: "Reinstall an explicitly approved signed worker release if this installed CLI cannot update itself.",
	},
	{
		name: "session",
		description: "Enroll an approved client device and inspect its renewable Gateway session.",
		usage: "ceal session [enroll --gateway <https-url> [--code-stdin] | logout]",
		effect: "local_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.client_session.v1",
		recovery: "Ask the organization administrator to confirm approved access and issue a replacement device-enrollment code, then retry.",
	},
	{
		name: "guide",
		description: "Inspect or register the signed agent guide for this installed Ceal release.",
		usage: "ceal guide [status | register codex | register claude]",
		effect: "read_only_or_local_write",
		evidence: "surface",
		result_schema: "ceal.guide.v1",
		recovery: "Run 'ceal guide status', then register only through an explicitly supported local agent host.",
	},
	{
		name: "capabilities",
		description: "Discover Gateway-issued capabilities and select bounded targets.",
		usage:
			"ceal capabilities [--profile <profile-ref>] [--fresh] [--detail] | ceal capabilities targets [--profile <profile-ref>] --capability <id> [--match <text-or-url> | --cursor <opaque>] [--limit <1-64>]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.capabilities.v1",
		recovery: "Configure a Gateway-issued client session, then run 'ceal capabilities' and descend to a bounded target selection.",
	},
	{
		name: "call",
		description: "Invoke an approved capability and read back its Gateway audit event.",
		usage: "ceal call <capability-id> --target <target-ref> [--profile <profile-ref>] [key=value ...]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.result.v2",
		recovery:
			"Run 'ceal capabilities', then select a target for that same capability with 'ceal capabilities targets --capability <capability-id>'. Do not mix a target returned for another capability.",
	},
	{
		name: "receipt",
		description: "Inspect safe Gateway evidence for one audited capability call outcome.",
		usage: "ceal receipt show <request-ref> [--profile <profile-ref>]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.receipt.v1",
		recovery:
			"Use the 'receipt.request_ref' a call returned; a reference with no audited outcome answers 'audit_event_not_found' until the Gateway records one.",
	},
	{
		name: "observe",
		description: "Serve a loopback-only read-only page over this client's cached local state.",
		usage: "ceal observe [--port <0|1024-65535>]",
		effect: "read_only",
		evidence: "surface",
		result_schema: "ceal.observe.v1",
		recovery: "Open the printed 127.0.0.1 URL in a local browser; stop the observer with Ctrl-C.",
	},
	{
		name: "acceptance",
		description: "Emit installed-client acceptance evidence for this exact installed release.",
		usage: "ceal acceptance emit [--request-ref <ref>] [--profile <profile-ref>]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.worker_acceptance_result.v1",
		recovery:
			"Run 'ceal capabilities --fresh' to confirm the session, then re-run; an installed release is required and a build tree is refused.",
	},
];

const COMMAND_BY_NAME = new Map(CEAL_COMMANDS.map((command) => [command.name, command]));

// Read a command's recovery line by the name it is about. A positional index is
// how the wrong one shipped: `CEAL_COMMANDS[2].recovery` meant `session` when it
// was written, then `update` was inserted above it, and a logged-out
// `ceal capabilities` began telling the operator to reinstall the binary instead
// of to get a session. Nothing caught it, because an index is still valid after
// it starts pointing somewhere else.
function commandRecovery(name: CealCommandDefinition["name"]): string {
	const command = COMMAND_BY_NAME.get(name);
	if (!command) throw new Error(`no ceal command is named ${name}`);
	return command.recovery;
}
const TOP_LEVEL_HELP = [
	"Usage: ceal <command> [options]",
	"",
	"Worker-facing Ceal client. Organization authority and credentials remain with the Gateway.",
	"Named options follow required positionals, are order-independent, and may be supplied once.",
	"",
	"Commands:",
	...CEAL_COMMANDS.map((command) => `  ${command.name.padEnd(14)} ${command.description}`),
	"",
	"Run: ceal <command> --help",
].join("\n");

export async function runCealCommand(args: readonly string[], io: CealCliIo, runtime: CealCommandRuntime = {}): Promise<number> {
	if (topLevelHelpRequested(args)) return writeHelp(TOP_LEVEL_HELP, io);
	if (args[0] === "help") return writeRequestedHelp(args.slice(1), io);
	const command = COMMAND_BY_NAME.get(args[0] as CealCommandDefinition["name"]);
	if (!command) return writeError("unknown_command", "Unknown ceal command.", io);
	const options = args.slice(1);
	const requestedHelp = helpRequest(command, options);
	if (requestedHelp !== undefined) return writeHelp(requestedHelp, io);
	if (!commandAcceptsOptions(command.name, options)) return writeError("invalid_argument", "Invalid ceal command options.", io);
	return runKnownCommand(command.name, options, io, runtime);
}

function topLevelHelpRequested(args: readonly string[]): boolean {
	return args.length === 0 || (args.length === 1 && (isHelpToken(args[0]) || args[0] === "help"));
}

function commandAcceptsOptions(command: CealCommandDefinition["name"], options: readonly string[]): boolean {
	return (
		options.length === 0 ||
		command === "guide" ||
		command === "capabilities" ||
		command === "session" ||
		command === "call" ||
		command === "receipt" ||
		command === "observe" ||
		command === "acceptance"
	);
}

// A help token anywhere in the tail is a read-only help request, never an
// operand. Position-sensitive handling let `ceal session enroll --gateway
// --help` reach the enrollment runner, which prompts for a credential before it
// can fail — and let a guessed route dead-end at the top of the tree. Resolve
// the longest declared route the leading positionals name, and fall back to the
// parent leaf, whose `Subcommands:` block names the routes that do exist.
function helpRequest(command: CealCommandDefinition, options: readonly string[]): string | undefined {
	if (!options.some(isHelpToken)) return undefined;
	const { subcommand } = splitSubcommandRoute(command.name, options);
	return subcommand ? subcommandHelp(subcommand) : commandHelp(command);
}

async function runKnownCommand(
	command: CealCommandDefinition["name"],
	options: readonly string[],
	io: CealCliIo,
	runtime: CealCommandRuntime,
): Promise<number> {
	if (command === "version") return writeVersion(io);
	if (command === "commands") return writeCommands(io);
	if (command === "update") return runUpdate(io, runtime);
	if (command === "guide") return runGuide(options, io, runtime);
	if (command === "session") return runSession(options, io, runtime);
	if (command === "call") return runCall(options, io, runtime);
	if (command === "receipt") return runReceipt(options, io, runtime);
	if (command === "observe") return runObserve(options, io, runtime);
	if (command === "acceptance") return runAcceptance(options, io, runtime);
	return runCapabilities(options, io, runtime);
}

// The whole point of this route is that a stranger on their own machine can
// produce the same evidence a maintainer produces from a checkout. So it takes
// no `--binary`: it measures `process.execPath`, which for the shipped SEA is
// the installed artifact itself. Run from a build tree there is no release
// layout beside it, and the refusal below is the correct answer rather than a
// weaker record.
async function runAcceptance(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	const resolvedRoute = resolveSubcommandRoute("acceptance", options, ACCEPTANCE_ROUTES);
	// A bare `ceal acceptance` is the emit route, as a bare `ceal guide` is
	// status: the parent has one job, and making a reader type its only child
	// buys nothing. Options with no route token land here too and are parsed by
	// the emitter, so `ceal acceptance --request-ref <ref>` works.
	if (!resolvedRoute) return emitAcceptanceRecord(options, io, runtime);
	return resolvedRoute.handler(resolvedRoute.rest, io, runtime);
}

async function emitAcceptanceRecord(rest: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	const parsed = parseNamedOptions(rest, new Set(["--request-ref", "--profile"]), new Set());
	if (parsed?.operands.length !== 0)
		return writeAcceptanceRefusal("invalid_argument", "Invalid ceal acceptance emit options.", io, "Run 'ceal acceptance emit --help'.");
	const requestRef = parsed.values.get("--request-ref");
	const profileOption = parsed.values.get("--profile");

	const reading = readInstalledReleaseFacts(process.execPath);
	if (!reading.ok) return writeAcceptanceRefusal(reading.code, reading.message, io);

	const access = await resolveStoredGatewayAccess(io, runtime, profileOption);
	if (!access.ok) {
		return writeAcceptanceRefusal(
			"gateway_session_unavailable",
			"No current Gateway session, so no live evidence can be produced.",
			io,
			"Run 'ceal session enroll --gateway <https-url>' with a code from the organization administrator, then re-run.",
		);
	}

	const startedAt = Date.now();
	try {
		const { client, handshake } = await requestCapabilityHandshake(access.value, runtime);
		if (!handshake.ok) return writeAcceptanceGatewayFailure(handshake.error, io);
		const discovery = await client.request({
			request_id: `${access.value.requestId}:discover`,
			operation: "discover",
			profile_ref: access.value.profileRef,
			body: {},
		});
		if (!discovery.ok) return writeAcceptanceGatewayFailure(discovery.error, io);

		// Read back a receipt only when one is named. This command never calls a
		// provider, so the bounded row is evidence of an act that already happened
		// under its own command and its own audit event.
		let receipt: Record<string, unknown> | null = null;
		if (requestRef !== undefined) {
			const readback = await requestReceiptReadback(
				access.value.storedSession as CealStoredSession,
				access.value.profileRef,
				requestRef,
				runtime,
			);
			if (!readback.readback.ok) return writeAcceptanceGatewayFailure(readback.readback.error, io);
			receipt = { request_ref: requestRef, readback_status: "verified", events: readback.readback.value.events };
		}

		const guide = runtime.inspectAgentGuide?.();
		return writeYaml(
			io.stdout,
			buildAcceptanceRecord({
				release: reading.facts,
				reportedVersion: CEAL_PACKAGE_VERSION,
				clientProtocolVersion: PROTOCOL_VERSION,
				guide: {
					status: guide?.status ?? "unavailable",
					registered_host_count: guide?.hosts?.filter((host) => host.registration_path).length ?? 0,
				},
				session: {
					instance_ref: handshake.value.instance_ref,
					profile_ref: handshake.value.profile_ref,
					negotiated_protocol_version: handshake.value.negotiated_protocol_version,
					host_decision: discovery.value.host_decision,
					catalog_source: "live_discovery",
					capability_count: discovery.value.capabilities.length,
					elapsed_ms: Date.now() - startedAt,
				},
				receipt,
			}),
		);
	} catch {
		return writeAcceptanceRefusal(
			"gateway_unreachable",
			"The Gateway could not be reached for live evidence.",
			io,
			"Check network reachability and retry.",
		);
	}
}

// Keeps the Gateway's own safe failure vocabulary while staying inside this
// command's result schema, so a caller never has to switch parsers to read why
// the evidence run stopped.
function writeAcceptanceGatewayFailure(error: unknown, io: CealCliIo): number {
	const failure = classifyGatewayFailure(error);
	return writeAcceptanceRefusal(failure.code, failure.message, io, failure.nextAction);
}

async function runObserve(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	const parsed = parseNamedOptions(options, new Set(["--port"]), new Set());
	if (parsed?.operands.length !== 0) return writeError("invalid_argument", "Invalid ceal observe options.", io);
	const rawPort = parsed.values.get("--port");
	let port = DEFAULT_OBSERVER_PORT;
	if (rawPort !== undefined) {
		if (!/^\d{1,5}$/u.test(rawPort) || (Number(rawPort) !== 0 && (Number(rawPort) < 1024 || Number(rawPort) > 65535))) {
			return writeError("invalid_argument", "ceal observe --port must be 0 (ephemeral) or 1024-65535.", io);
		}
		port = Number(rawPort);
	}
	const server = createCealObserverServer({
		loadSession: runtime.loadSession,
		loadDiscoveryCache: runtime.loadDiscoveryCache,
		loadReceiptSpool: runtime.loadReceiptSpool,
		inspectAgentAudit: runtime.inspectAgentAudit,
		inspectAgentSession: runtime.inspectAgentSession,
		inspectAgentGuide: runtime.inspectAgentGuide,
		executablePath: runtime.executablePath,
		discoveryCacheTtlMs: runtime.discoveryCacheTtlMs ?? DEFAULT_DISCOVERY_CACHE_TTL_MS,
		now: runtime.now,
	});
	try {
		await new Promise<void>((resolveListen, rejectListen) => {
			server.once("error", rejectListen);
			server.listen(port, "127.0.0.1", () => {
				server.removeListener("error", rejectListen);
				resolveListen();
			});
		});
	} catch {
		writeYaml(io.stdout, {
			schema_version: "ceal.observe.v1",
			command: "ceal",
			ok: false,
			status: "unavailable",
			error: {
				kind: "port_unavailable",
				message: "The local observer could not bind its loopback port.",
				next_action: "Choose a free local port with 'ceal observe --port <port>'.",
			},
		});
		return 3;
	}
	const address = server.address();
	const boundPort = typeof address === "object" && address !== null ? address.port : port;
	const url = `http://127.0.0.1:${boundPort}/`;
	// A serve-phase server error (for example accept failure) must close the
	// observer instead of crashing the process through an unhandled 'error'.
	let observerExitCode = 0;
	server.on("error", () => {
		observerExitCode = 3;
		server.close();
	});
	writeYaml(io.stdout, {
		schema_version: "ceal.observe.v1",
		command: "ceal",
		ok: true,
		status: "serving",
		url,
		bind_address: "127.0.0.1",
		effect: "read_only",
		boundary: { admin_surface: false, provider_credentials: false, live_refresh: false },
		data_sources: [...OBSERVER_DATA_SOURCES],
		receipts: "local_spool_metadata",
		non_claims: [
			"Cached/local state only; the observer never contacts the Gateway or a provider.",
			"The observer serves until this command is interrupted.",
		],
	});
	const closed = new Promise<number>((resolveClose) => server.once("close", () => resolveClose(observerExitCode)));
	runtime.onObserverListening?.({
		url,
		close: () => new Promise<void>((resolveStop, rejectStop) => server.close((error) => (error ? rejectStop(error) : resolveStop()))),
	});
	return closed;
}

async function runUpdate(io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	if (!runtime.runStableUpdate)
		return writeUpdate(io, {
			status: "unavailable",
			error: {
				kind: "update_unavailable",
				message: "This Ceal command is not running from a verified installed worker release.",
				next_action: "Install a signed stable worker release, then run 'ceal update' from that installed command.",
			},
		});
	try {
		const onProgress = runtime.isOutputTerminal?.() ? (stage: CealStableUpdateProgressStage) => writeUpdateProgress(io, stage) : undefined;
		return writeUpdate(io, await runtime.runStableUpdate({ onProgress }));
	} catch {
		return writeUpdate(io, {
			status: "unavailable",
			error: {
				kind: "update_failed",
				message: "The stable signed worker update could not be completed.",
				next_action: "Retry once, then reinstall an explicitly approved signed worker release.",
			},
		});
	}
}

function writeUpdateProgress(io: CealCliIo, stage: CealStableUpdateProgressStage): void {
	const message: Record<CealStableUpdateProgressStage, string> = {
		check: "ceal update: checking the installed worker release",
		download_install: "ceal update: downloading and installing the signed stable worker release",
		verify: "ceal update: verifying signed update completion",
		installed_readback: "ceal update: reading back the installed worker release",
	};
	io.stderr.write(`${message[stage]}\n`);
}

function writeUpdate(io: CealCliIo, result: CealStableUpdateResult): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.update.v1",
		command: "ceal",
		ok: result.status !== "unavailable",
		status: result.status,
		effect: "local_write",
		stable_only: true,
		...(result.previous_version ? { previous_version: result.previous_version } : {}),
		...(result.installed_version ? { installed_version: result.installed_version } : {}),
		...(result.platform ? { platform: result.platform } : {}),
		...(result.artifact_sha256 ? { artifact_sha256: result.artifact_sha256 } : {}),
		...(result.elapsed_ms === undefined ? {} : { elapsed_ms: result.elapsed_ms }),
		...(result.error ? { error: result.error } : {}),
		non_claims: ["Gateway_not_contacted", "Agent_not_updated", "operator_cli_not_updated"],
	});
	return result.status === "unavailable" ? 3 : 0;
}

function writeRequestedHelp(args: readonly string[], io: CealCliIo): number {
	if (args.length === 0) return writeError("invalid_argument", "Help requires one public command name.", io);
	const command = COMMAND_BY_NAME.get(args[0] as CealCommandDefinition["name"]);
	if (!command) return writeError("unknown_command", "Unknown ceal command.", io);
	if (args.length === 1) return writeHelp(commandHelp(command), io);
	const subcommand = findSubcommand(command.name, args.slice(1));
	return subcommand
		? writeHelp(subcommandHelp(subcommand), io)
		: writeError("invalid_argument", "Help requires one public command name or subcommand route.", io);
}

function commandHelp(command: CealCommandDefinition): string {
	const options = commandHelpOptions(command.name);
	const subcommands = subcommandsOf(command.name);
	return [
		`Usage: ${command.usage}`,
		"",
		command.description,
		"Named options follow required positionals, are order-independent, and may be supplied once.",
		"",
		`Effect: ${command.effect}`,
		`Evidence: ${command.evidence}`,
		`Result schema: ${command.result_schema}`,
		`Recovery/readback: ${command.recovery}`,
		"",
		...(subcommands.length === 0
			? []
			: ["Subcommands:", ...subcommandRows(subcommands), `Run: ceal ${command.name} <subcommand> --help for that leaf's own contract.`, ""]),
		"Options:",
		...options,
		"  -h, --help  Show this help without performing work.",
	].join("\n");
}

// Align on the widest route so a multi-word route such as `register codex` keeps
// the two-space column separator that makes each row machine-readable.
function subcommandRows(subcommands: readonly CealSubcommandDefinition[]): readonly string[] {
	const width = Math.max(...subcommands.map((subcommand) => subcommand.route.join(" ").length));
	return subcommands.map((subcommand) => `  ${subcommand.route.join(" ").padEnd(width)}  ${subcommand.description}`);
}

function subcommandHelp(subcommand: CealSubcommandDefinition): string {
	return [
		`Usage: ${subcommand.usage}`,
		"",
		subcommand.description,
		...(subcommand.notes ?? []),
		"Named options follow required positionals, are order-independent, and may be supplied once.",
		"",
		`Effect: ${subcommand.effect}`,
		`Evidence: ${subcommand.evidence}`,
		`Result schema: ${subcommand.result_schema}`,
		`Recovery/readback: ${subcommand.recovery}`,
		"",
		"Options:",
		...(subcommand.options ?? []),
		"  -h, --help  Show this help without performing work.",
	].join("\n");
}

function commandHelpOptions(name: CealCommandDefinition["name"]): readonly string[] {
	if (name === "capabilities")
		return [
			"  --profile <profile-ref> Select one Profile for this request without re-login.",
			"  --fresh                 Bypass the client discovery cache and probe the Gateway live.",
			"  --detail                Include each capability's full input_contract (default: concise).",
			"  --endpoint <https-url>  Gateway client endpoint.",
			"  --request-id <safe-id>  Correlation prefix for handshake and discovery.",
			"  --token-stdin           Read the Gateway-issued client token from stdin.",
		];
	if (name === "call")
		return [
			"  <capability-id>          Capability returned by 'ceal capabilities'.",
			"  --target <target-ref>   Target reference returned by 'ceal capabilities'.",
			"  --profile <profile-ref> Select one assigned Profile for this call without re-login.",
			"  key=value               Capability input; repeat only fields in the discovered input contract.",
			"                          Gateway validates capability-specific grammar and current Profile scope.",
		];
	if (name === "acceptance")
		return [
			"  --request-ref <ref>     'receipt.request_ref' from a completed 'ceal call'; embeds its verified receipt.",
			"  --profile <profile-ref> Select one assigned Profile for this read without re-login.",
			"                          Emits no host paths. Performs a live discovery; never performs a provider call.",
		];
	if (name === "observe")
		return [
			"  --port <0|1024-65535>  Loopback port to serve (default: 52897; 0 selects an ephemeral port).",
			"                          Serves cached session/capability/install/guide state and spooled call-outcome metadata.",
			"                          No admin surface, no provider credentials, no live refresh.",
		];
	return [];
}

function writeVersion(io: CealCliIo): number {
	return writeYaml(io.stdout, {
		schema_version: "ceal.version.v1",
		command: "ceal",
		version: CEAL_PACKAGE_VERSION,
		protocol_version: PROTOCOL_VERSION,
		supported_gateway_protocol_range: CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE,
		credential_context: CREDENTIAL_CONTEXT,
	});
}

function writeCommands(io: CealCliIo): number {
	return writeYaml(io.stdout, {
		schema_version: "ceal.commands.v1",
		command: "ceal",
		ok: true,
		credential_context: CREDENTIAL_CONTEXT,
		commands: CEAL_COMMANDS,
		// Keep the machine-readable inventory at the same depth as installed help:
		// an agent that parses this document must not see fewer routes than the
		// prose surface advertises.
		subcommands: CEAL_SUBCOMMANDS.map((subcommand) => ({
			parent: subcommand.parent,
			route: [...subcommand.route],
			description: subcommand.description,
			usage: subcommand.usage,
			effect: subcommand.effect,
			evidence: subcommand.evidence,
			result_schema: subcommand.result_schema,
			recovery: subcommand.recovery,
		})),
	});
}

type GuideRouteHandler = (subcommand: CealSubcommandDefinition, io: CealCliIo, runtime: CealCommandRuntime) => number;

// One handler per declared guide route. The `register` rows share a handler that
// reads its host from its own declared route, so this dispatcher still never
// learns host names: a new host is one table row, one alias here, and one store
// entry. What the table cannot express is which handler a route reaches, so
// naming every route is the compile-time gate — a row added without a handler
// used to fall through to `status` in the shipped binary.
// One route today, declared through the same table as every other parent so the
// compile-time exhaustiveness check covers it: adding a row to CEAL_SUBCOMMANDS
// without a handler here is a `tsc` failure, which is what stops a shipped
// binary from advertising a route it cannot serve.
type AcceptanceRouteHandler = (rest: readonly string[], io: CealCliIo, runtime: CealCommandRuntime) => Promise<number>;

const ACCEPTANCE_ROUTES: CealSubcommandHandlers<"acceptance", AcceptanceRouteHandler> = {
	emit: (rest, io, runtime) => emitAcceptanceRecord(rest, io, runtime),
};

const GUIDE_ROUTES: CealSubcommandHandlers<"guide", GuideRouteHandler> = {
	status: (_subcommand, io, runtime) => runGuideAction("status", undefined, io, runtime),
	"register codex": runGuideRegister,
	"register claude": runGuideRegister,
};

/**
 * The route keys every runner's dispatch table actually handles, by parent.
 *
 * The `Record` totality `tsc` enforces is the first line of defence and not a
 * complete one: `CealSubcommandRouteKey` reads literal route tuples, so a row
 * declared as `route: ["x"] as string[]` — or any row built from a non-`const`
 * value — has no literal key, demands no handler, and still compiles. That row
 * would advertise its own leaf help, be accepted, and then dead-end in an
 * argument error, which is the failure issue #1 exists to prevent. Exporting the
 * keys lets one runtime gate compare dispatch against the declaration and catch
 * the case the type system structurally cannot.
 *
 * A function, not a const: the four tables are defined at different points in
 * this module, and a top-level object literal would read them in the temporal
 * dead zone.
 */
export function dispatchedRouteKeys(): Readonly<Record<string, readonly string[]>> {
	return {
		acceptance: Object.keys(ACCEPTANCE_ROUTES),
		capabilities: Object.keys(CAPABILITIES_ROUTES),
		guide: Object.keys(GUIDE_ROUTES),
		receipt: Object.keys(RECEIPT_ROUTES),
		session: Object.keys(SESSION_ROUTES),
	};
}

function runGuide(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): number {
	const resolved = resolveSubcommandRoute("guide", options, GUIDE_ROUTES);
	if (!resolved) {
		// A bare `ceal guide` is the status route; anything else here is undeclared.
		return options.length === 0
			? runGuideAction("status", undefined, io, runtime)
			: writeError("invalid_argument", "Invalid guide action.", io);
	}
	if (resolved.rest.length > 0) return writeError("invalid_argument", "Invalid guide action.", io);
	return resolved.handler(resolved.subcommand, io, runtime);
}

function runGuideRegister(subcommand: CealSubcommandDefinition, io: CealCliIo, runtime: CealCommandRuntime): number {
	// The route's second token is the agent host, validated against the host table
	// rather than cast, so a route declared without its host row is refused here
	// instead of silently registering the default host or crashing inside the store.
	const requested = subcommand.route[1];
	if (!isCealAgentGuideHost(requested)) return writeError("invalid_argument", "Unsupported guide agent host.", io);
	return runGuideAction("register", requested, io, runtime);
}

function runGuideAction(
	action: "status" | "register",
	agent: CealAgentGuideHost | undefined,
	io: CealCliIo,
	runtime: CealCommandRuntime,
): number {
	const inspect = action === "register" ? runtime.registerAgentGuide : runtime.inspectAgentGuide;
	if (!inspect) return writeAgentGuideUnavailable(io, action, agent);
	const state = inspect(agent);
	writeYaml(io.stdout, {
		schema_version: "ceal.guide.v1",
		command: "ceal",
		ok: state.status !== "unavailable",
		action,
		effect: action === "status" ? "read_only" : "local_write",
		...state,
	});
	return state.status === "unavailable" ? 3 : 0;
}

// `ok` answers one question on every surface: did this command answer what it
// was asked? It is not "the state is good" — `ceal session` reporting
// `unconfigured` answered correctly, while `ceal capabilities` without a session
// could not answer at all. That is why `ok` tracks the exit code exactly.

function writeAgentGuideUnavailable(io: CealCliIo, action: "status" | "register" = "status", agent: CealAgentGuideHost = "codex"): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.guide.v1",
		command: "ceal",
		ok: false,
		action,
		effect: action === "status" ? "read_only" : "local_write",
		status: "unavailable",
		agent,
		agent_source: "default",
		guide_id: "ceal-guide",
		registered: false,
		update_safe: false,
		error: {
			kind: "guide_unavailable",
			message: "The signed Ceal guide is not available from this command runtime.",
			next_action: "Reinstall a signed Ceal worker release, then run 'ceal guide status'.",
		},
	});
	return 3;
}

async function runCapabilities(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	// `--fresh` (catalog only) forces a live discovery probe past any cache;
	// `--detail` (either case) restores the full per-capability input contract
	// that the concise default omits. Both are stripped before the existing
	// parsers, which do not know the flags.
	const policy = capabilitiesRoutePolicy(options);
	const wantsFresh = policy.acceptsFresh && options.includes("--fresh");
	const wantsDetail = options.includes("--detail");
	const effectiveOptions = options.filter((option) => option !== "--detail" && !(wantsFresh && option === "--fresh"));
	const selection = parseTargetCatalogOptions(effectiveOptions);
	if (selection === null) return writeCapabilitiesArgumentError(options, policy, io);
	const resolved =
		selection.kind === "targets"
			? await resolveStoredGatewayAccess(io, runtime, selection.profileRef)
			: await resolveGatewayAccess(effectiveOptions, io, runtime);
	if (!resolved.ok) return resolved.exitCode;
	try {
		const { client, handshake } = await requestCapabilityHandshake(resolved.value, runtime);
		if (!handshake.ok) return writeGatewayFailure(handshake, io);
		// The catalog case is the cacheable one: its live handshake stays the auth
		// gate while the expensive discovery probe is served from the client cache
		// when warm. The targets case is a live paged query and is never cached.
		if (selection.kind === "catalog") {
			return await serveCapabilityCatalog(resolved.value, handshake, client, selection, wantsFresh, wantsDetail, io, runtime);
		}
		const discovery = await client.request({
			request_id: `${resolved.value.requestId}:discover`,
			operation: "discover",
			profile_ref: resolved.value.profileRef,
			body: selection.body,
		});
		if (!discovery.ok) return writeGatewayFailure(discovery, io);
		return writeCapabilitiesAvailable(handshake, discovery, selection, wantsDetail, io, { source: "live_discovery" }, runtime);
	} catch (error) {
		if (error instanceof CealClientSessionError) return writeClientSessionUnavailable(error.code, io);
		const reason = error instanceof CealHttpTransportError ? error.code : "request_failed";
		return writeGatewayUnavailable(reason, io);
	}
}

async function serveCapabilityCatalog(
	access: GatewayAccess,
	handshake: { request_id: string; value: CealGatewayHandshakeValue },
	client: ReturnType<typeof createCealClient>,
	selection: { kind: "catalog" },
	wantsFresh: boolean,
	wantsDetail: boolean,
	io: CealCliIo,
	runtime: CealCommandRuntime,
): Promise<number> {
	// Key the cache on the live handshake's authoritative identity, not the
	// requested profile: a warm entry can only serve a session the Gateway just
	// re-authenticated, and any profile/membership/protocol change is a cache miss.
	const key: CealDiscoveryCacheKey = {
		gatewayEndpoint: access.endpoint,
		profileRef: handshake.value.profile_ref,
		membershipRef: handshake.value.membership_ref,
		negotiatedProtocolVersion: handshake.value.negotiated_protocol_version,
	};
	const now = runtime.now?.() ?? Date.now();
	const ttlMs = runtime.discoveryCacheTtlMs ?? DEFAULT_DISCOVERY_CACHE_TTL_MS;
	if (!wantsFresh && runtime.loadDiscoveryCache) {
		const entry = await runtime.loadDiscoveryCache().catch(() => null);
		if (entry && discoveryCacheEntryUsable(entry, key, now, ttlMs)) {
			return writeCapabilitiesAvailable(
				handshake,
				{ request_id: `${access.requestId}:discover:cached`, value: entry.discovery as unknown as CealGatewayDiscoveryValue },
				selection,
				wantsDetail,
				io,
				{ source: "cached_discovery", cachedAt: entry.cachedAt, expiresAt: entry.cachedAt + ttlMs },
				runtime,
			);
		}
	}
	const discovery = await client.request({
		request_id: `${access.requestId}:discover`,
		operation: "discover",
		profile_ref: access.profileRef,
		body: {},
	});
	if (!discovery.ok) return writeGatewayFailure(discovery, io);
	// Cache writes are advisory: a failure just means the next call probes live.
	if (runtime.saveDiscoveryCache) {
		await runtime
			.saveDiscoveryCache({ key, cachedAt: now, discovery: discovery.value as unknown as Record<string, unknown> })
			.catch(() => undefined);
	}
	return writeCapabilitiesAvailable(handshake, discovery, selection, wantsDetail, io, { source: "live_discovery" }, runtime);
}

type ParsedTargetCatalogOptions =
	| { kind: "catalog" }
	| { kind: "targets"; profileRef?: string; body: { capability_id: string; match?: string; cursor?: string; limit?: number } }
	| null;

// Every option each capabilities route declares, including the two this command
// strips before the older parsers. Kept beside those parsers so a new option
// cannot be accepted without also becoming nameable in a refusal.
const CAPABILITIES_CATALOG_VALUE_OPTIONS = new Set(["--endpoint", "--profile", "--request-id"]);
const CAPABILITIES_CATALOG_FLAG_OPTIONS = new Set(["--token-stdin", "--fresh", "--detail"]);
const CAPABILITIES_TARGETS_VALUE_OPTIONS = new Set(["--capability", "--cursor", "--limit", "--match", "--profile"]);
const CAPABILITIES_TARGETS_FLAG_OPTIONS = new Set(["--detail"]);

/**
 * Everything about handling one `capabilities` route that is not the same for
 * every route. It lives in the handler table rather than in a `targets: boolean`
 * threaded through three call sites: that boolean read "some declared route
 * matched" but was consumed as "the targets route", so a second declared route
 * would have been refused under the targets route's name and option set — the
 * same fallthrough this slice removed, in a shape `tsc` cannot see.
 */
interface CapabilitiesRoutePolicy {
	/** How a refusal names the route the operator actually typed. */
	route: string;
	valueOptions: ReadonlySet<string>;
	flagOptions: ReadonlySet<string>;
	/** Only the cacheable catalog case has a discovery cache for `--fresh` to bypass. */
	acceptsFresh: boolean;
	/** Only a route that selects a target may report a failed target selection. */
	selectsTarget: boolean;
	parse: (rest: readonly string[]) => ParsedTargetCatalogOptions;
}

// The catalog is the no-route case, so it is the fallback policy rather than a
// table row; every declared route names its own policy.
const CAPABILITIES_CATALOG_POLICY: CapabilitiesRoutePolicy = {
	route: "ceal capabilities",
	valueOptions: CAPABILITIES_CATALOG_VALUE_OPTIONS,
	flagOptions: CAPABILITIES_CATALOG_FLAG_OPTIONS,
	acceptsFresh: true,
	selectsTarget: false,
	parse: parseCapabilityCatalogOptions,
};

const CAPABILITIES_ROUTES: CealSubcommandHandlers<"capabilities", CapabilitiesRoutePolicy> = {
	targets: {
		route: "ceal capabilities targets",
		valueOptions: CAPABILITIES_TARGETS_VALUE_OPTIONS,
		flagOptions: CAPABILITIES_TARGETS_FLAG_OPTIONS,
		acceptsFresh: false,
		selectsTarget: true,
		parse: parseTargetCatalogSelection,
	},
};

function capabilitiesRoutePolicy(options: readonly string[]): CapabilitiesRoutePolicy {
	return resolveSubcommandRoute("capabilities", options, CAPABILITIES_ROUTES)?.handler ?? CAPABILITIES_CATALOG_POLICY;
}

/**
 * A rejected `capabilities` argv used to report a failed *target selection*
 * regardless of what was actually wrong, which sent readers after grants and
 * approval targets when the real fault was a flag the route does not declare —
 * and on the bare catalog route, no target selection was even attempted. Name
 * the unknown option when there is one, and point at the typed route's help.
 */
function writeCapabilitiesArgumentError(options: readonly string[], policy: CapabilitiesRoutePolicy, io: CealCliIo): number {
	const nextAction = `Run '${policy.route} --help'.`;
	const rest = resolveSubcommandRoute("capabilities", options, CAPABILITIES_ROUTES)?.rest ?? options;
	const unknown = unknownNamedOption(rest, policy.valueOptions, policy.flagOptions);
	if (unknown !== null) {
		return writeError("invalid_argument", `Unknown option '${unknown}' for '${policy.route}'.`, io, nextAction);
	}
	// Every option is declared, so the fault is a value, a duplicate, or an operand.
	const message = policy.selectsTarget ? "Invalid capabilities target selection." : "Invalid capabilities options.";
	return writeError("invalid_argument", message, io, nextAction);
}

function parseTargetCatalogOptions(options: readonly string[]): ParsedTargetCatalogOptions {
	const resolved = resolveSubcommandRoute("capabilities", options, CAPABILITIES_ROUTES);
	return resolved ? resolved.handler.parse(resolved.rest) : CAPABILITIES_CATALOG_POLICY.parse(options);
}

function parseCapabilityCatalogOptions(options: readonly string[]): ParsedTargetCatalogOptions {
	if (options.length === 0) return { kind: "catalog" };
	if (storedProfileOption(options) !== null) return { kind: "catalog" };
	return parseGatewayOptions(options).ok ? { kind: "catalog" } : null;
}

function parseTargetCatalogSelection(options: readonly string[]): ParsedTargetCatalogOptions {
	const parsed = parseNamedOptions(options, new Set(["--capability", "--cursor", "--limit", "--match", "--profile"]), new Set());
	if (parsed?.operands.length !== 0) return null;
	const selection = {
		capabilityId: parsed.values.get("--capability"),
		cursor: parsed.values.get("--cursor"),
		match: parsed.values.get("--match"),
		profileRef: parsed.values.get("--profile"),
		limitText: parsed.values.get("--limit"),
	};
	if (!isValidTargetCatalogSelection(selection)) return null;
	const limit = selection.limitText === undefined ? undefined : parseTargetPageLimit(selection.limitText);
	if (selection.limitText !== undefined && limit === undefined) return null;
	return {
		kind: "targets",
		...(selection.profileRef ? { profileRef: selection.profileRef } : {}),
		body: {
			capability_id: selection.capabilityId,
			...(selection.match ? { match: selection.match } : {}),
			...(selection.cursor ? { cursor: selection.cursor } : {}),
			...(limit ? { limit } : {}),
		},
	};
}

function isValidTargetCatalogSelection(
	selection: Readonly<{
		capabilityId: string | undefined;
		cursor: string | undefined;
		match: string | undefined;
		profileRef: string | undefined;
		limitText: string | undefined;
	}>,
): selection is Readonly<{
	capabilityId: string;
	cursor: string | undefined;
	match: string | undefined;
	profileRef: string | undefined;
	limitText: string | undefined;
}> {
	if (!validCapabilityId(selection.capabilityId)) return false;
	if (selection.cursor !== undefined && !isSafeCursor(selection.cursor)) return false;
	if (selection.match !== undefined && !isSafeTargetMatch(selection.match)) return false;
	if (selection.profileRef !== undefined && !isSafeProfileRef(selection.profileRef)) return false;
	if (selection.cursor !== undefined && selection.match !== undefined) return false;
	return true;
}

function isSafeCursor(value: string): boolean {
	return /^cursor:[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/u.test(value);
}
function isSafeTargetMatch(value: string): boolean {
	return Buffer.byteLength(value, "utf8") >= 1 && Buffer.byteLength(value, "utf8") <= 2048 && !hasControlCharacter(value);
}
function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => character.codePointAt(0)! <= 0x1f || character.codePointAt(0) === 0x7f);
}
function parseTargetPageLimit(value: string): number | undefined {
	return /^(?:[1-9]|[1-5][0-9]|6[0-4])$/u.test(value) ? Number(value) : undefined;
}

interface GatewayAccess {
	endpoint: string;
	profileRef: string;
	requestId: string;
	accessToken: string;
	storedSession: CealStoredSession | null;
}

type GatewayAccessResolution = { ok: true; value: GatewayAccess } | { ok: false; exitCode: number };

async function resolveGatewayAccess(
	options: readonly string[],
	io: CealCliIo,
	runtime: CealCommandRuntime,
): Promise<GatewayAccessResolution> {
	const selectedProfile = storedProfileOption(options);
	return selectedProfile
		? resolveStoredGatewayAccess(io, runtime, selectedProfile)
		: options.length === 0
			? resolveStoredGatewayAccess(io, runtime)
			: resolveExplicitGatewayAccess(options, io, runtime);
}

async function resolveStoredGatewayAccess(
	io: CealCliIo,
	runtime: CealCommandRuntime,
	selectedProfile?: string,
): Promise<GatewayAccessResolution> {
	if (!runtime.loadSession) return { ok: false, exitCode: writeCapabilitiesUnavailable(io) };
	try {
		const loaded = await runtime.loadSession();
		const session = loaded ? await ensureCurrentSession(loaded, runtime) : null;
		if (!session) return { ok: false, exitCode: writeCapabilitiesUnavailable(io) };
		return {
			ok: true,
			value: {
				endpoint: session.gatewayEndpoint,
				profileRef: selectedProfile ?? session.profileRef,
				accessToken: session.accessToken,
				storedSession: session,
				requestId: runtime.nextRequestId?.() ?? "ceal:capabilities",
			},
		};
	} catch (error) {
		const exitCode =
			error instanceof CealClientSessionError
				? writeClientSessionUnavailable(error.code, io)
				: writeGatewayUnavailable("session_load_failed", io);
		return { ok: false, exitCode };
	}
}

async function resolveExplicitGatewayAccess(
	options: readonly string[],
	io: CealCliIo,
	runtime: CealCommandRuntime,
): Promise<GatewayAccessResolution> {
	const parsed = parseGatewayOptions(options);
	if (!parsed.ok) return { ok: false, exitCode: writeError("invalid_argument", parsed.message, io) };
	if (!runtime.readSecret) return { ok: false, exitCode: writeGatewayUnavailable("credential_input_unavailable", io) };
	try {
		return { ok: true, value: { ...parsed, accessToken: await runtime.readSecret(), storedSession: null } };
	} catch {
		return { ok: false, exitCode: writeGatewayUnavailable("credential_input_failed", io) };
	}
}

function requestHandshake(client: ReturnType<typeof createCealClient>, access: Pick<GatewayAccess, "profileRef" | "requestId">) {
	return client.request({
		request_id: `${access.requestId}:handshake`,
		operation: "handshake",
		profile_ref: access.profileRef,
		body: { client: { name: "ceal", version: CEAL_PACKAGE_VERSION } },
	});
}

async function requestCapabilityHandshake(access: GatewayAccess, runtime: CealCommandRuntime) {
	let client = createCealClient(createCealHttpTransport({ endpoint: access.endpoint, accessToken: access.accessToken }));
	let handshake = await requestHandshake(client, access);
	const storedSession = access.storedSession;
	if (!shouldRetryAuthentication(handshake, storedSession)) return { client, handshake };
	const session = await ensureCurrentSession(storedSession, runtime, true);
	client = createCealClient(createCealHttpTransport({ endpoint: access.endpoint, accessToken: session.accessToken }));
	handshake = await requestHandshake(client, access);
	return { client, handshake };
}

function shouldRetryAuthentication(
	response: { ok: boolean; error?: unknown },
	session: CealStoredSession | null,
): session is CealStoredSession {
	return !response.ok && gatewayFailureCode(response.error) === "authentication_failed" && Boolean(session?.refreshToken);
}

// Concise default: an agent scanning the catalog wants the capability id, label,
// effect, and whether a target is required — not the full input grammar for all
// ~10 capabilities on every `capabilities` call. `--detail` restores the bodies.
// The omitted fields (`input_contract`, `write_contract`) are re-fetched by
// re-running with `--detail`; the concise rows stay a strict subset so nothing
// the caller needs to *select* a capability is dropped.
// What a client may show of the Gateway's announcement policy, and nothing else.
// The Gateway lane authored this list; `schema_version` and
// `scope_statement_kind` are deliberately absent from it, so a spread of the
// decoded field would render two values the contract does not permit. The
// projection is explicit for that reason — it is an allow-list, not a tidy-up.
const ANNOUNCEMENT_POLICY_NOT_DECLARED = "scope not declared by the Gateway";

function announcementPolicyProjection(policy: CealGatewayAnnouncementPolicy | undefined): unknown {
	// Absence is a rendered answer, not a missing key. An older Gateway, or any
	// response this client did not opt into, must read as "the Gateway did not
	// declare a scope" rather than as no scope statement at all — the two are the
	// same on screen only if the client stays silent, which is the inference this
	// wording exists to prevent.
	if (!policy) return ANNOUNCEMENT_POLICY_NOT_DECLARED;
	return {
		scope_statement: policy.scope_statement,
		provider_application_authority: policy.provider_application_authority,
		explicit_request_required: policy.explicit_request_required,
		provenance_requirement: policy.provenance_requirement,
		non_claims: policy.non_claims,
	};
}

function renderedCapability(capability: CealGatewayDiscoveryCapability, detail: boolean): Record<string, unknown> {
	const projected: Record<string, unknown> = {
		...capability,
		announcement_policy: announcementPolicyProjection(capability.announcement_policy),
	};
	if (detail) return projected;
	return conciseCapability(projected as unknown as CealGatewayDiscoveryCapability);
}

function conciseCapability(capability: CealGatewayDiscoveryCapability): Record<string, unknown> {
	const { input_contract: _input, write_contract: _write, ...summary } = capability;
	return summary;
}

function writeCapabilitiesAvailable(
	handshake: { request_id: string; value: CealGatewayHandshakeValue },
	discovery: { request_id: string; value: CealGatewayDiscoveryValue },
	selection: Exclude<ParsedTargetCatalogOptions, null>,
	detail: boolean,
	io: CealCliIo,
	provenance: CatalogProvenance,
	runtime: CealCommandRuntime,
): number {
	const capabilities = discovery.value.capabilities.map((capability) => renderedCapability(capability, detail));
	return writeYaml(io.stdout, {
		schema_version: "ceal.capabilities.v1",
		command: "ceal",
		ok: true,
		status: "available",
		gateway_required: true,
		credential_context: CREDENTIAL_CONTEXT,
		gateway: {
			profile_ref: handshake.value.profile_ref,
			membership_ref: handshake.value.membership_ref,
			registration_ref: handshake.value.registration_ref,
			client_ref: handshake.value.client_ref,
			subject_ref: handshake.value.subject_ref,
			instance_ref: handshake.value.instance_ref,
			negotiated_protocol_version: handshake.value.negotiated_protocol_version,
			host_decision: handshake.value.host_decision,
			// Surface the negotiated eligible-Profile catalog so an agent can see
			// which `--profile <profile_ref>` selections this session may pass
			// without re-login. Present only when the Gateway negotiated it; the
			// current selection is `gateway.profile_ref` above.
			...(handshake.value.eligible_profiles ? { eligible_profiles: handshake.value.eligible_profiles } : {}),
		},
		capabilities,
		targets: discovery.value.targets,
		// Tell an agent the concise rows omit the input grammar and how to get it,
		// so a compact default never reads as "this capability has no contract".
		...(detail ? {} : { capability_detail: "Re-run 'ceal capabilities --detail' for per-capability input_contract." }),
		target_catalog: discovery.value.target_catalog,
		proof_level: discovery.value.proof_level,
		live_gateway_checked: true,
		// `live_gateway_checked` reports the live handshake (the auth gate, always
		// run). `catalog_source` reports the resource catalog's provenance
		// separately: `cached_discovery` means the handshake was live but the
		// catalog was served from the client cache without a live discovery probe.
		catalog_source: provenance.source,
		...(provenance.source === "cached_discovery"
			? {
					catalog_cached_at: new Date(provenance.cachedAt).toISOString(),
					catalog_expires_at: new Date(provenance.expiresAt).toISOString(),
				}
			: {}),
		// Only claim a live discovery when one actually ran this invocation.
		claims_allowed: provenance.source === "cached_discovery" ? ["gateway_handshake"] : ["gateway_handshake", "gateway_discovery"],
		non_claims: discovery.value.non_claims,
		request_ids: { handshake: handshake.request_id, discovery: discovery.request_id },
		...(capabilityCatalogNextAction(discovery.value.target_catalog, selection)
			? { next_action: capabilityCatalogNextAction(discovery.value.target_catalog, selection) }
			: {}),
		...(profileSelectionHint(handshake.value) ? { profile_selection: profileSelectionHint(handshake.value) } : {}),
		...unregisteredGuideAdvisory(runtime),
	});
}

// Client-local selection code named by the Profile contract: a session with
// more than one eligible Profile has not pinned a single one, so an agent is
// told the affordance rather than left to guess. This is a thin advisory on the
// successful handshake — not a re-architecture of default selection, and not a
// Gateway recovery kind. The hard-failure form (multiple eligible Profiles with
// no active selection at all) needs the still-unimplemented multi-select model
// or a live Gateway Profile denial to reach; see the goal's closeout non-claim.
const CEAL_PROFILE_SELECTION_REQUIRED_CODE = "profile_selection_required" as const;

function profileSelectionHint(handshake: CealGatewayHandshakeValue): {
	code: typeof CEAL_PROFILE_SELECTION_REQUIRED_CODE;
	active_profile_ref: string;
	next_action: string;
} | null {
	const eligible = handshake.eligible_profiles;
	// A single (or absent) eligible Profile becomes active automatically, so the
	// affordance only matters when more than one Profile is selectable. The
	// alternatives themselves are the `gateway.eligible_profiles` catalog; this
	// hint names the recovery code and points at it rather than repeating it.
	if (!eligible || eligible.length < 2) return null;
	return {
		code: CEAL_PROFILE_SELECTION_REQUIRED_CODE,
		active_profile_ref: handshake.profile_ref,
		next_action: "Re-run with '--profile <profile_ref>' to select one of the gateway.eligible_profiles listed above.",
	};
}

/**
 * One advisory on the surface every agent reaches first, and only when the host
 * running this process has not registered the signed guide.
 *
 * Nothing in the binary told an agent the guide existed, so whether it followed
 * the guide's method or improvised was left to chance — the failure being silent
 * by construction (corca-ai/ceal-cli#4). This stays absent once registered, and
 * absent when the running host cannot be identified, so it never becomes noise
 * on a healthy install.
 */
function unregisteredGuideAdvisory(runtime: CealCommandRuntime): Record<string, unknown> {
	try {
		const state = runtime.inspectAgentGuide?.();
		// Only when the guide is present and merely unregistered for the host that
		// is running: advising `guide register` while the asset itself is missing
		// would send an agent to a route that cannot succeed.
		if (state?.agent_source !== "detected" || state.status !== "available") return {};
		const host = state.hosts?.find((entry) => entry.agent === state.agent);
		if (host?.status !== "staged") return {};
		return {
			agent_guide: {
				status: host.status,
				agent: state.agent,
				next_action: `This agent host has not registered the signed Ceal guide, which encodes how to read leaf help and what a result does and does not prove. Run 'ceal guide register ${state.agent}'.`,
			},
		};
	} catch {
		return {};
	}
}

function capabilityCatalogNextAction(
	catalog: CealGatewayDiscoveryValue["target_catalog"],
	selection: Exclude<ParsedTargetCatalogOptions, null>,
): string | null {
	if (catalog.selection_required) return "Run 'ceal capabilities targets --capability <capability-id> --match <name-or-url>'.";
	if (catalog.next_cursor && selection.kind === "targets") {
		return `Run 'ceal capabilities targets --capability ${selection.body.capability_id} --cursor ${catalog.next_cursor}'.`;
	}
	return catalog.returned_count > 0 ? "Use one returned target with 'ceal call <capability-id> --target <target-ref> key=value'." : null;
}

async function runCall(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	const parsed = parseCallOptions(options);
	if (!parsed.ok) return writeCallValidationFailure(io);
	const resolved = await resolveCallSession(runtime);
	if (!resolved.ok) return writeCallUnavailable(resolved.reason, io, null, parsed);
	const requestId = `${runtime.nextRequestId?.() ?? "ceal:call"}:call`;
	// Read the capability's declared effect from the client's own discovery
	// cache before the call, so an unknown-outcome failure can tell a read from a
	// possible write. A cold or stale cache simply yields undefined, which keeps
	// the conservative caution.
	const effectiveProfile = parsed.profileRef ?? resolved.session.profileRef;
	const capabilityEffect = await cachedCapabilityEffect(parsed.capabilityId, runtime, {
		gatewayEndpoint: resolved.session.gatewayEndpoint,
		profileRef: effectiveProfile,
		membershipRef: resolved.session.membershipRef,
		negotiatedProtocolVersion: PROTOCOL_VERSION,
	});
	return executeCall(resolved.session, effectiveProfile, parsed, requestId, io, runtime, capabilityEffect);
}

async function cachedCapabilityEffect(
	capabilityId: string,
	runtime: CealCommandRuntime,
	key: CealDiscoveryCacheKey,
): Promise<CealCapabilityEffect | undefined> {
	try {
		const entry = await runtime.loadDiscoveryCache?.();
		// The same file serves one home directory across instances and profiles, and an
		// entry for another instance can call the same capability id a read where
		// this one calls it a write. Trust it only under the identity and freshness
		// the catalog path already requires, or the caution is suppressed for a
		// write whose outcome is unknown.
		const now = runtime.now?.() ?? Date.now();
		const ttlMs = runtime.discoveryCacheTtlMs ?? DEFAULT_DISCOVERY_CACHE_TTL_MS;
		if (!entry || !discoveryCacheEntryUsable(entry, key, now, ttlMs)) return undefined;
		const capabilities = (entry.discovery as { capabilities?: unknown }).capabilities;
		if (!Array.isArray(capabilities)) return undefined;
		const match = capabilities.find(
			(capability) =>
				capability && typeof capability === "object" && (capability as { capability_id?: unknown }).capability_id === capabilityId,
		);
		const effect = match && typeof match === "object" ? (match as { effect?: unknown }).effect : undefined;
		return effect === "read" || effect === "write" ? effect : undefined;
	} catch {
		return undefined;
	}
}

async function runReceipt(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	const parsed = parseReceiptOptions(options);
	if (!parsed) return writeReceiptError("validation_error", "Pass one receipt reference returned by a completed call.", io);
	const resolved = await resolveCallSession(runtime);
	if (!resolved.ok)
		return writeReceiptError(
			resolved.reason,
			"The Gateway receipt could not be read.",
			io,
			isClassifiedClientSessionFailure(resolved.reason) ? classifyClientSessionFailure(resolved.reason) : undefined,
		);
	const profileRef = parsed.profileRef ?? resolved.session.profileRef;
	try {
		const { readback } = await requestReceiptReadback(resolved.session, profileRef, parsed.requestRef, runtime);
		// The Gateway's own failure vocabulary decides the answer: an unknown or
		// not-yet-audited reference is `audit_event_not_found`, which is a real
		// answer about this reference, not a broken receipt route.
		if (!readback.ok) {
			const failure = classifyGatewayFailure(readback.error);
			return writeReceiptError(failure.code, failure.message, io, undefined, failure.nextAction, resolved.session, profileRef);
		}
		return writeYaml(io.stdout, {
			schema_version: "ceal.receipt.v1",
			ok: true,
			status: "verified",
			request_ref: parsed.requestRef,
			...gatewayResultIdentity(resolved.session, profileRef),
			events: readback.value.events.map(projectReceiptEvent),
		});
	} catch (error) {
		const reason =
			error instanceof CealClientSessionError ? error.code : error instanceof CealHttpTransportError ? error.code : "request_failed";
		return writeReceiptError(
			reason,
			"The Gateway receipt could not be read.",
			io,
			isClassifiedClientSessionFailure(reason) ? classifyClientSessionFailure(reason) : undefined,
		);
	}
}

async function requestReceiptReadback(
	initialSession: CealStoredSession,
	profileRef: string,
	requestRef: string,
	runtime: CealCommandRuntime,
) {
	let session = initialSession;
	let client = createCealClient(createCealHttpTransport({ endpoint: session.gatewayEndpoint, accessToken: session.accessToken }));
	let readback = await client.request({
		request_id: `${runtime.nextRequestId?.() ?? "ceal:receipt"}:readback`,
		operation: "readback",
		profile_ref: profileRef,
		body: { request_id: requestRef },
	});
	if (!shouldRetryAuthentication(readback, session)) return { readback, session };
	session = await ensureCurrentSession(session, runtime, true);
	client = createCealClient(createCealHttpTransport({ endpoint: session.gatewayEndpoint, accessToken: session.accessToken }));
	readback = await client.request({
		request_id: `${runtime.nextRequestId?.() ?? "ceal:receipt"}:readback`,
		operation: "readback",
		profile_ref: profileRef,
		body: { request_id: requestRef },
	});
	return { readback, session };
}

function projectReceiptEvent(event: CealGatewayAuditEvent): Record<string, unknown> {
	// A denied or failed call has no call detail, so its negotiated Gateway
	// handling time arrives on the event itself rather than inside `call`.
	// When both carry timing the event envelope stays authoritative; call
	// detail remains a backward-compatible fallback for older successful data.
	// The call-detail guard is load-bearing, not redundant: the strict decoder
	// integer-checks only the event-level field, while call detail admits any
	// finite number.
	const gatewayElapsedMs = safeGatewayElapsed(event.gateway_elapsed_ms) ?? safeGatewayElapsed(event.call?.gateway_elapsed_ms);
	return {
		ref: event.event_ref,
		operation: event.operation,
		outcome: event.outcome,
		authorization: event.policy_decision,
		...(event.error_code === null ? {} : { error_code: event.error_code, non_claims: [...event.non_claims] }),
		...(event.connector_route_failure
			? {
					connector_route_failure: {
						connector_kind: event.connector_route_failure.connector_kind,
						phase: event.connector_route_failure.phase,
					},
				}
			: {}),
		...(event.grant_snapshot
			? {
					capability: event.grant_snapshot.capability_id,
					target: event.grant_snapshot.target_ref,
					grant: { ref: event.grant_snapshot.grant_ref, revision: event.grant_snapshot.grant_revision },
				}
			: {}),
		...(gatewayElapsedMs === undefined ? {} : { timing: { gateway_elapsed_ms: gatewayElapsedMs } }),
	};
}

function safeGatewayElapsed(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function writeReceiptError(
	kind: string,
	message: string,
	io: CealCliIo,
	sessionFailure?: ReturnType<typeof classifyClientSessionFailure>,
	nextAction?: string,
	session?: CealStoredSession,
	profileRef?: string,
): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.receipt.v1",
		ok: false,
		status: "error",
		...gatewayResultIdentity(session ?? null, profileRef),
		error: sessionFailure
			? {
					kind: sessionFailure.kind,
					retryable: sessionFailure.retryable,
					message: sessionFailure.message,
					next_action: sessionFailure.nextAction,
				}
			: {
					kind,
					message,
					// Only a session/route problem is fixed by re-checking the session. When
					// the Gateway answered about the reference itself, pass its answer
					// through instead of overwriting it with generic advice.
					next_action: nextAction ?? "Use a receipt reference from a completed call after confirming the client session.",
				},
	});
	return 3;
}

// Best-effort receipt-spool recorder: projects the emitted result envelope
// through the spool's allowlist and appends it. Every failure is swallowed so
// a broken spool can never change a call's output or exit code, and a
// receipt-less envelope (pre-issue failure) projects to nothing.
function callResultRecorder(runtime: CealCommandRuntime): CealCallResultRecorder | undefined {
	const record = runtime.recordReceiptSpool;
	if (!record) return undefined;
	const drop = runtime.recordReceiptSpoolDrop;
	return (envelope) => {
		try {
			const entry = receiptSpoolEntryFromCallResult(envelope, runtime.now?.() ?? Date.now());
			if (entry) return record(entry);
			// A receipt this client could not project is a lost receipt, not an
			// absent one, so it is counted rather than passed over. Without this
			// the observer renders a short history with nothing marking the gap.
			if (callResultCarriesReceipt(envelope)) drop?.();
		} catch {
			/* spool failure must never change call behavior */
			drop?.();
		}
	};
}

async function executeCall(
	initialSession: CealStoredSession,
	profileRef: string,
	parsed: Extract<ParsedCallOptions, { ok: true }>,
	requestId: string,
	io: CealCliIo,
	runtime: CealCommandRuntime,
	capabilityEffect?: CealCapabilityEffect,
): Promise<number> {
	const record = callResultRecorder(runtime);
	let completed: { value: CealGatewayCallValue; events: unknown; session: CealStoredSession } | null = null;
	try {
		const { call, client, session } = await requestCapabilityCall(initialSession, profileRef, parsed, requestId, runtime);
		if (!call.ok) return writeCallGatewayFailure(call, io, session, parsed, requestId, record);
		const readback = await client.request({
			request_id: `${runtime.nextRequestId?.() ?? "ceal:readback"}:readback`,
			operation: "readback",
			profile_ref: profileRef,
			body: { request_id: requestId },
		});
		if (!readback.ok) return writeCallIncomplete(call.value, requestId, "audit_readback_rejected", io, session, parsed, record);
		completed = { value: call.value, events: readback.value.events, session };
	} catch (error) {
		if (error instanceof CealKnownPreProviderCallError) {
			const reason = error.cause instanceof CealClientSessionError ? error.cause.code : "session_renewal_failed";
			return writeCallUnavailable(reason, io, initialSession, parsed, undefined, undefined, capabilityEffect);
		}
		// A session renewal is attempted only after the Gateway explicitly
		// returned authentication_failed. It is therefore a known pre-provider
		// rejection, not an unknown call outcome; do not ask an agent to look up
		// or preserve a receipt for an action the Gateway did not authorize.
		if (error instanceof CealClientSessionError)
			return writeCallUnavailable(error.code, io, initialSession, parsed, undefined, undefined, capabilityEffect);
		const reason = error instanceof CealHttpTransportError ? error.code : "request_failed";
		return writeCallUnavailable(reason, io, initialSession, parsed, requestId, record, capabilityEffect);
	}
	return writeCallCompleted(completed.value, completed.events, requestId, io, completed.session, parsed, record);
}

type CallSessionResolution = { ok: true; session: CealStoredSession } | { ok: false; reason: string };

async function resolveCallSession(runtime: CealCommandRuntime): Promise<CallSessionResolution> {
	if (!runtime.loadSession) return { ok: false, reason: "session_unavailable" };
	try {
		const loaded = await runtime.loadSession();
		const session = loaded ? await ensureCurrentSession(loaded, runtime) : null;
		return session ? { ok: true, session } : { ok: false, reason: "session_unavailable" };
	} catch (error) {
		const reason = error instanceof CealClientSessionError ? error.code : "session_load_failed";
		return { ok: false, reason };
	}
}

function requestCapability(
	client: ReturnType<typeof createCealClient>,
	profileRef: string,
	parsed: Extract<ParsedCallOptions, { ok: true }>,
	requestId: string,
) {
	return client.request({
		request_id: requestId,
		operation: "call",
		profile_ref: profileRef,
		body: {
			capability_id: parsed.capabilityId,
			target_ref: parsed.targetRef,
			arguments: parsed.arguments,
			purpose: parsed.purpose,
		},
	});
}

async function requestCapabilityCall(
	initialSession: CealStoredSession,
	profileRef: string,
	parsed: Extract<ParsedCallOptions, { ok: true }>,
	requestId: string,
	runtime: CealCommandRuntime,
) {
	let session = initialSession;
	let client = createCealClient(createCealHttpTransport({ endpoint: session.gatewayEndpoint, accessToken: session.accessToken }));
	let call = await requestCapability(client, profileRef, parsed, requestId);
	if (!shouldRetryAuthentication(call, session)) return { call, client, session };
	try {
		session = await ensureCurrentSession(session, runtime, true);
	} catch (error) {
		throw new CealKnownPreProviderCallError(error);
	}
	client = createCealClient(createCealHttpTransport({ endpoint: session.gatewayEndpoint, accessToken: session.accessToken }));
	call = await requestCapability(client, profileRef, parsed, requestId);
	return { call, client, session };
}

type ParsedCallOptions = CealParsedCapabilityCall | { ok: false };

function parseCallOptions(options: readonly string[]): ParsedCallOptions {
	if (options.length < 3 || options.length > 67) return { ok: false };
	const capabilityId = options[0];
	if (!validCapabilityId(capabilityId)) return { ok: false };
	const parsed = parseNamedOptions(options.slice(1), new Set(["--target", "--profile"]), new Set());
	if (!parsed) return { ok: false };
	const targetRef = parsed.values.get("--target");
	if (!validTargetRef(targetRef)) return { ok: false };
	const profileRef = parsed.values.get("--profile");
	if (profileRef !== undefined && !isSafeProfileRef(profileRef)) return { ok: false };
	const operands = parseKeyValueOperands(parsed.operands);
	if (!operands) return { ok: false };
	const arguments_ = Object.fromEntries(operands);
	return {
		ok: true,
		capabilityId,
		targetRef,
		arguments: arguments_,
		...(profileRef ? { profileRef } : {}),
		purpose: `Invoke approved capability '${capabilityId}' for the current task.`,
	};
}

function isSafeRequestRef(value: string | undefined): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

type ReceiptRouteParser = (rest: readonly string[]) => { requestRef: string; profileRef?: string } | null;

// `receipt` declares one route today, so "a declared subcommand means `show`" was
// still correct — and would have stopped being correct, silently, on the next row.
const RECEIPT_ROUTES: CealSubcommandHandlers<"receipt", ReceiptRouteParser> = {
	show: parseReceiptShowOptions,
};

function parseReceiptOptions(options: readonly string[]): { requestRef: string; profileRef?: string } | null {
	const resolved = resolveSubcommandRoute("receipt", options, RECEIPT_ROUTES);
	return resolved ? resolved.handler(resolved.rest) : null;
}

function parseReceiptShowOptions(rest: readonly string[]): { requestRef: string; profileRef?: string } | null {
	if (!isSafeRequestRef(rest[0])) return null;
	const profile = extractProfileOption(rest.slice(1));
	return profile && profile.remaining.length === 0
		? { requestRef: rest[0]!, ...(profile.value ? { profileRef: profile.value } : {}) }
		: null;
}

function storedProfileOption(options: readonly string[]): string | null {
	const profile = extractProfileOption(options);
	return profile && profile.remaining.length === 0 ? (profile.value ?? null) : null;
}

function extractProfileOption(options: readonly string[]): { value?: string; remaining: string[] } | null {
	const remaining: string[] = [];
	let value: string | undefined;
	for (let index = 0; index < options.length; index += 1) {
		const option = options[index];
		if (option !== "--profile") {
			remaining.push(option!);
			continue;
		}
		const candidate = options[index + 1];
		if (value !== undefined || !isSafeProfileRef(candidate)) return null;
		value = candidate;
		index += 1;
	}
	return { ...(value ? { value } : {}), remaining };
}

function isSafeProfileRef(value: string | undefined): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function parseKeyValueOperands(operands: readonly string[]): Map<string, string> | null {
	const parsed = new Map<string, string>();
	for (const operand of operands) {
		const separator = operand.indexOf("=");
		const key = separator > 0 ? operand.slice(0, separator) : "";
		if (!/^[a-z][a-z0-9_]{0,63}$/u.test(key) || parsed.has(key)) return null;
		parsed.set(key, operand.slice(separator + 1));
	}
	return parsed;
}

function writeCallValidationFailure(io: CealCliIo): number {
	return writeCallUnavailable("validation_error", io, null, null);
}

function writeCapabilitiesUnavailable(io: CealCliIo): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.capabilities.v1",
		command: "ceal",
		ok: false,
		status: "unavailable",
		gateway_required: true,
		credential_context: CREDENTIAL_CONTEXT,
		capabilities: [] as readonly never[],
		proof_level: "surface",
		live_gateway_checked: false,
		claims_allowed: [] as readonly never[],
		non_claims: ["No live Gateway discovery, authorization, provider action, or audit readback was reached."],
		// This is the most-hit failure state on this surface — fresh install, no
		// session, logged out — so it owes the same `ok`/`error.kind` shape as
		// every other failure. It previously answered `ok: false` with no error
		// object and exit 0, which is the exact "failure that looks like success"
		// this release exists to remove.
		error: {
			kind: "client_session_unavailable",
			message: "No Gateway-issued client session is configured for this client.",
			next_action: commandRecovery("session"),
		},
	});
	return 3;
}

type ParsedGatewayOptions = { ok: true; endpoint: string; profileRef: string; requestId: string } | { ok: false; message: string };

function parseGatewayOptions(options: readonly string[]): ParsedGatewayOptions {
	const parsed = parseNamedOptions(options, new Set(["--endpoint", "--profile", "--request-id"]), new Set(["--token-stdin"]));
	if (parsed?.operands.length !== 0 || !parsed.flags.has("--token-stdin")) return invalidGatewayOptions();
	const endpoint = parsed.values.get("--endpoint");
	const profileRef = parsed.values.get("--profile");
	const requestId = parsed.values.get("--request-id");
	if (!endpoint || !profileRef || !requestId) return invalidGatewayOptions();
	if (!/^profile:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(profileRef)) return invalidGatewayOptions();
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,117}$/u.test(requestId)) return invalidGatewayOptions();
	return { ok: true, endpoint, profileRef, requestId };
}

function invalidGatewayOptions(): ParsedGatewayOptions {
	return { ok: false, message: "Invalid capabilities Gateway options." };
}

function writeGatewayFailure(response: { error: unknown }, io: CealCliIo): number {
	const failure = classifyGatewayFailure(response.error);
	writeYaml(io.stdout, {
		schema_version: "ceal.capabilities.v1",
		command: "ceal",
		ok: false,
		status: failure.denial ? "denied" : "unavailable",
		gateway_required: true,
		credential_context: CREDENTIAL_CONTEXT,
		capabilities: [],
		proof_level: "host_decision",
		live_gateway_checked: true,
		claims_allowed: [failure.denial ? "gateway_denial" : "gateway_rejection"],
		// `kind` is the one error key on every Ceal surface. This surface published
		// `code` first, and a caller that read only `kind` therefore saw discovery
		// failures as no error at all — a 36-call sweep lost 16 calls and reported
		// none of them (ceal-cli#2). `code` is gone rather than carried alongside:
		// one key, no reader left guessing which one a given surface speaks.
		error: { kind: failure.code, message: failure.message, next_action: failure.nextAction },
		non_claims: ["No provider action or production audit custody was reached."],
	});
	return 3;
}

function writeGatewayUnavailable(reason: string, io: CealCliIo): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.capabilities.v1",
		command: "ceal",
		ok: false,
		status: "unavailable",
		gateway_required: true,
		credential_context: CREDENTIAL_CONTEXT,
		capabilities: [],
		proof_level: "surface",
		live_gateway_checked: false,
		claims_allowed: [],
		error: {
			kind: reason,
			message: "The Gateway capability request could not be completed.",
			next_action: "Check network reachability, TLS, and the Gateway-issued client session, then retry.",
		},
	});
	return 3;
}

// `nextAction` defaults to the top-level help, but a refusal that already knows
// which route was typed should name that route's help instead: the top-level
// help does not list a leaf's options, so it cannot answer the question a
// rejected option raises.
// The refusals this route can reach are about the installed layout, not about
// arguments, so they carry their own codes rather than being flattened into
// `invalid_argument`. A caller pasting the result into an evidence thread should
// see which of the three digest statements disagreed.
function writeAcceptanceRefusal(kind: string, message: string, io: CealCliIo, nextAction?: string): number {
	writeYaml(io.stdout, {
		// The command's own schema covers its failures too, the way
		// `ceal capabilities` does. A caller parses one shape and reads `ok`;
		// switching schemas on failure would make the unhappy path the one nobody
		// wrote a reader for.
		schema_version: "ceal.worker_acceptance_result.v1",
		command: "ceal",
		ok: false,
		status: "error",
		credential_context: CREDENTIAL_CONTEXT,
		error: {
			kind,
			message,
			next_action: nextAction ?? "Install a signed release with the published installer, then run 'ceal acceptance emit' from that install.",
		},
	});
	return 3;
}

function writeError(
	kind: "unknown_command" | "invalid_argument",
	message: string,
	io: CealCliIo,
	nextAction = "Run 'ceal --help'.",
): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.error.v1",
		command: "ceal",
		ok: false,
		status: "error",
		credential_context: CREDENTIAL_CONTEXT,
		error: { kind, message, next_action: nextAction },
	});
	return 2;
}

function isHelpToken(value: string | undefined): boolean {
	return value === "--help" || value === "-h";
}
