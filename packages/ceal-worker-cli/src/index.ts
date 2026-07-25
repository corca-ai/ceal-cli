import { CEAL_PROTOCOL_VERSION, CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE } from "@corca-ai/ceal-protocol";
import type {
	CealGatewayAuditEvent,
	CealGatewayCallValue,
	CealGatewayDiscoveryCapability,
	CealGatewayDiscoveryValue,
	CealGatewayHandshakeValue,
} from "@corca-ai/ceal-protocol";
import {
	CealHttpTransportError,
	createCealClient,
	createCealHttpTransport,
} from "@corca-ai/ceal";
import type { CealCliIo, CealCommandRuntime, CealStableUpdateResult } from "./cli-runtime.js";
import { discoveryCacheEntryUsable, type CealDiscoveryCacheKey } from "./discovery-cache.js";
import type { CealStoredSession } from "./profile-store.js";
import { validCapabilityId, validTargetRef } from "./capability-arguments.js";
import { parseNamedOptions } from "./named-options.js";
import { createCealObserverServer } from "./observer.js";
import { writeHelp, writeYaml } from "./output.js";
import { CealClientSessionError, ensureCurrentSession, runSession, writeClientSessionUnavailable } from "./client-session.js";
import {
	classifyGatewayFailure,
	gatewayFailureCode,
	type CealCallResultRecorder,
	type CealParsedCapabilityCall,
	writeCallCompleted,
	writeCallGatewayFailure,
	writeCallIncomplete,
	writeCallUnavailable,
} from "./call-result-output.js";
import { receiptSpoolEntryFromCallResult } from "./receipt-spool.js";

export { renderPlainYamlDocument } from "./yaml.js";

const CEAL_PACKAGE_VERSION = "0.65.5" as const;
const CREDENTIAL_CONTEXT = "gateway_issued_client_session" as const;
const PROTOCOL_VERSION = CEAL_PROTOCOL_VERSION;

// Conservative default freshness for a served discovery-catalog cache entry.
// The catalog is advisory (calls re-validate live), so a few minutes trades a
// small staleness window for eliding the ~4.3s discovery probe on repeat use;
// `--fresh` forces a live probe and `CEAL_DISCOVERY_CACHE_TTL_MS` overrides it.
const DEFAULT_DISCOVERY_CACHE_TTL_MS = 300_000;

// 0xCEA1: a stable, unregistered default so the printed observer URL is
// predictable across sessions; --port 0 selects an ephemeral port instead.
const DEFAULT_OBSERVER_PORT = 52897;

type CatalogProvenance =
	| { source: "live_discovery" }
	| { source: "cached_discovery"; cachedAt: number; expiresAt: number };

// The first call received an explicit authentication rejection, so no provider
// invocation happened. Keep a failed renewal distinct from a transport loss
// after a call was actually dispatched.
class CealKnownPreProviderCallError extends Error {
	constructor(readonly cause: unknown) { super("The Gateway rejected the call before provider execution."); }
}

export type { CealCliIo, CealCommandRuntime, CealStableUpdateResult } from "./cli-runtime.js";

export interface CealCommandDefinition {
	name: "version" | "commands" | "update" | "guide" | "capabilities" | "session" | "call" | "receipt" | "observe";
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
		usage: "ceal guide [status | register codex]",
		effect: "read_only_or_local_write",
		evidence: "surface",
		result_schema: "ceal.guide.v1",
		recovery: "Run 'ceal guide status', then register only through an explicitly supported local agent host.",
	},
	{
		name: "capabilities",
		description: "Discover Gateway-issued capabilities and select bounded targets.",
		usage: "ceal capabilities [--profile <profile-ref>] [--fresh] [--detail] | ceal capabilities targets [--profile <profile-ref>] --capability <id> [--match <text-or-url> | --cursor <opaque>] [--limit <1-64>]",
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
		recovery: "Run 'ceal capabilities', then select a target for that same capability with 'ceal capabilities targets --capability <capability-id>'. Do not mix a target returned for another capability.",
	},
	{
		name: "receipt",
		description: "Inspect safe Gateway evidence for one completed capability call.",
		usage: "ceal receipt show <request-ref> [--profile <profile-ref>]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.receipt.v1",
		recovery: "Use the receipt reference returned by a completed call, then retry after renewing the client session if needed.",
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
];

// A subcommand the dispatcher accepts is a leaf an agent is told to descend
// into, so it owes the same four-field contract as a top-level command. Keeping
// the children declarative next to `CEAL_COMMANDS` is what lets one gate assert
// "every advertised route renders its own Effect/Evidence/Result schema/
// Recovery" instead of patching help per route (issue #1).
export interface CealSubcommandDefinition {
	parent: CealCommandDefinition["name"];
	route: readonly string[];
	description: string;
	usage: string;
	effect: CealCommandDefinition["effect"];
	evidence: CealCommandDefinition["evidence"];
	result_schema: string;
	recovery: string;
	notes?: readonly string[];
	options?: readonly string[];
}

export const CEAL_SUBCOMMANDS: readonly CealSubcommandDefinition[] = [
	{
		parent: "guide",
		route: ["status"],
		description: "Inspect the signed guide and its Codex registration.",
		usage: "ceal guide status",
		effect: "read_only",
		evidence: "surface",
		result_schema: "ceal.guide.v1",
		recovery: "Reinstall a signed Ceal worker release, then run 'ceal guide status' again.",
	},
	{
		parent: "guide",
		route: ["register", "codex"],
		description: "Link the update-safe signed guide into the configured Codex skill directory.",
		usage: "ceal guide register codex",
		effect: "local_write",
		evidence: "surface",
		result_schema: "ceal.guide.v1",
		recovery: "Run 'ceal guide status' to read back the registration this command claims.",
	},
	{
		parent: "session",
		route: ["enroll"],
		description: "Exchange a pre-approved one-time device-enrollment code for a local session.",
		usage: "ceal session enroll --gateway <https-url> [--code-stdin]",
		effect: "local_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.session_enrollment.v1",
		recovery: "Ask the organization administrator to confirm approved access and issue a replacement device-enrollment code, then retry.",
		notes: [
			"The code is never a command operand: it is read through a hidden terminal",
			"prompt, or from stdin only for approved non-interactive automation.",
		],
		options: [
			"  --gateway <https-url>   Gateway client endpoint that approved this device.",
			"  --code-stdin            Read the code from stdin only for non-interactive approved automation.",
			"  (default)               On a safe terminal, prompt for the code with hidden input.",
		],
	},
	{
		parent: "session",
		route: ["logout"],
		description: "Revoke the Gateway session, then remove local session and cached state.",
		usage: "ceal session logout",
		effect: "local_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.session_logout.v1",
		recovery: "Run 'ceal session' to confirm the local session is gone; a revoke failure preserves local state for a retry.",
	},
	{
		parent: "capabilities",
		route: ["targets"],
		description: "Select bounded targets for one discovered capability.",
		usage: "ceal capabilities targets --capability <id> [--profile <profile-ref>] [--match <text-or-url> | --cursor <opaque>] [--limit <1-64>]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.capabilities.v1",
		recovery: "Run 'ceal capabilities' to re-read current capability ids, re-select for that same capability, and continue one page only with the 'target_catalog.next_cursor' this route returned.",
		notes: [
			"An unfiltered page is permitted: omit --match to request the Gateway's own",
			"bounded page, and constrain it with --limit <1-64>. The Gateway stays",
			"authoritative: when it needs a narrower selection it answers",
			"'target_catalog.selection_required' with no targets and no cursor, so follow",
			"the returned 'next_action' rather than assuming a page is always available.",
			"--match and --cursor are mutually exclusive. This route is always a live",
			"query and is never served from the client discovery cache; the catalog-only",
			"cache flag is rejected here.",
		],
		options: [
			"  --capability <id>       Capability returned by 'ceal capabilities'.",
			"  --profile <profile-ref> Select one assigned Profile for target discovery.",
			"  --match <text-or-url>   Select current target labels, or an approved source URL.",
			"  --cursor <opaque>       Continue one Gateway-issued selected target page.",
			"  --limit <1-64>          Bound one selected target page (default: Gateway choice).",
		],
	},
	{
		parent: "receipt",
		route: ["show"],
		description: "Read the caller's safe Gateway audit receipt for one completed call.",
		usage: "ceal receipt show <request-ref> [--profile <profile-ref>]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.receipt.v1",
		recovery: "Use the request reference returned by a completed 'ceal call', then retry after renewing the client session if needed.",
		options: [
			"  <request-ref>           Request reference returned by a completed call.",
			"  --profile <profile-ref> Select the Profile that issued the receipt request.",
		],
	},
];

const COMMAND_BY_NAME = new Map(CEAL_COMMANDS.map((command) => [command.name, command]));
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
	return options.length === 0 || command === "guide" || command === "capabilities" || command === "session" || command === "call" || command === "receipt" || command === "observe";
}

// A help token anywhere in the tail is a read-only help request, never an
// operand. Position-sensitive handling let `ceal session enroll --gateway
// --help` reach the enrollment runner, which prompts for a credential before it
// can fail — and let a guessed route dead-end at the top of the tree. Resolve
// the longest declared route the leading positionals name, and fall back to the
// parent leaf, whose `Subcommands:` block names the routes that do exist.
function helpRequest(command: CealCommandDefinition, options: readonly string[]): string | undefined {
	if (!options.some(isHelpToken)) return undefined;
	const leading: string[] = [];
	for (const option of options) {
		if (option.startsWith("-")) break;
		leading.push(option);
	}
	for (let length = leading.length; length > 0; length -= 1) {
		const subcommand = findSubcommand(command.name, leading.slice(0, length));
		if (subcommand) return subcommandHelp(subcommand);
	}
	return commandHelp(command);
}

function subcommandsOf(parent: CealCommandDefinition["name"]): readonly CealSubcommandDefinition[] {
	return CEAL_SUBCOMMANDS.filter((subcommand) => subcommand.parent === parent);
}

function findSubcommand(parent: CealCommandDefinition["name"], route: readonly string[]): CealSubcommandDefinition | undefined {
	return subcommandsOf(parent).find((subcommand) => subcommand.route.length === route.length
		&& subcommand.route.every((token, index) => token === route[index]));
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
	return runCapabilities(options, io, runtime);
}

async function runObserve(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	const parsed = parseNamedOptions(options, new Set(["--port"]), new Set());
	if (!parsed || parsed.operands.length !== 0) return writeError("invalid_argument", "Invalid ceal observe options.", io);
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
		status: "serving",
		url,
		bind_address: "127.0.0.1",
		effect: "read_only",
		boundary: { admin_surface: false, provider_credentials: false, live_refresh: false },
		data_sources: ["client_session_redacted", "client_discovery_cache", "installed_release_generation", "agent_guide_registration", "receipt_spool_metadata", "agent_runtime_transcript_inventory"],
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
	if (!runtime.runStableUpdate) return writeUpdate(io, {
		status: "unavailable",
		error: {
			kind: "update_unavailable",
			message: "This Ceal command is not running from a verified installed worker release.",
			next_action: "Install a signed stable worker release, then run 'ceal update' from that installed command.",
		},
	});
	try {
		return writeUpdate(io, await runtime.runStableUpdate());
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

function writeUpdate(io: CealCliIo, result: CealStableUpdateResult): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.update.v1",
		command: "ceal",
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
	return subcommand ? writeHelp(subcommandHelp(subcommand), io)
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
		...(subcommands.length === 0 ? [] : [
			"Subcommands:",
			...subcommandRows(subcommands),
			`Run: ceal ${command.name} <subcommand> --help for that leaf's own contract.`,
			"",
		]),
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
	if (name === "capabilities") return [
			"  --profile <profile-ref> Select one Profile for this request without re-login.",
			"  --fresh                 Bypass the client discovery cache and probe the Gateway live.",
			"  --detail                Include each capability's full input_contract (default: concise).",
			"  --endpoint <https-url>  Gateway client endpoint.",
			"  --request-id <safe-id>  Correlation prefix for handshake and discovery.",
			"  --token-stdin           Read the Gateway-issued client token from stdin.",
		];
	if (name === "call") return [
			"  <capability-id>          Capability returned by 'ceal capabilities'.",
			"  --target <target-ref>   Target reference returned by 'ceal capabilities'.",
			"  --profile <profile-ref> Select one assigned Profile for this call without re-login.",
			"  key=value               Capability input; repeat only fields in the discovered input contract.",
			"                          Gateway validates capability-specific grammar and current Profile scope.",
		];
	if (name === "observe") return [
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
		credential_context: CREDENTIAL_CONTEXT,
		commands: CEAL_COMMANDS,
		// Keep the machine-readable inventory at the same depth as installed help:
		// an agent that parses this document must not see fewer routes than the
		// prose surface advertises.
		subcommands: CEAL_SUBCOMMANDS.map((subcommand) => ({
			parent: subcommand.parent, route: [...subcommand.route], description: subcommand.description,
			usage: subcommand.usage, effect: subcommand.effect, evidence: subcommand.evidence,
			result_schema: subcommand.result_schema, recovery: subcommand.recovery,
		})),
	});
}

const GUIDE_ACTIONS = new Map<string, "status" | "register">([["[]", "status"], ['["status"]', "status"], ['["register","codex"]', "register"]]);

function runGuide(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): number {
	const action = GUIDE_ACTIONS.get(JSON.stringify(options));
	if (!action) return writeError("invalid_argument", "Invalid guide action.", io);
	const inspect = action === "register" ? runtime.registerAgentGuide : runtime.inspectAgentGuide;
	if (!inspect) return writeAgentGuideUnavailable(io);
	const state = inspect();
	writeYaml(io.stdout, {
		schema_version: "ceal.guide.v1", command: "ceal", action,
		effect: action === "status" ? "read_only" : "local_write", ...state,
	});
	return state.status === "unavailable" ? 3 : 0;
}

function writeAgentGuideUnavailable(io: CealCliIo): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.guide.v1", command: "ceal", action: "status", effect: "read_only", status: "unavailable",
		agent: "codex", guide_id: "ceal-guide", registered: false, update_safe: false,
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
	const wantsFresh = options[0] !== "targets" && options.includes("--fresh");
	const wantsDetail = options.includes("--detail");
	const effectiveOptions = options.filter(
		(option) => option !== "--detail" && !(wantsFresh && option === "--fresh"),
	);
	const selection = parseTargetCatalogOptions(effectiveOptions);
	if (selection === null) return writeError("invalid_argument", "Invalid capabilities target selection.", io);
	const resolved = selection.kind === "targets"
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
		return writeCapabilitiesAvailable(handshake, discovery, selection, wantsDetail, io, { source: "live_discovery" });
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
				selection, wantsDetail, io,
				{ source: "cached_discovery", cachedAt: entry.cachedAt, expiresAt: entry.cachedAt + ttlMs },
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
		await runtime.saveDiscoveryCache({ key, cachedAt: now, discovery: discovery.value as unknown as Record<string, unknown> }).catch(() => undefined);
	}
	return writeCapabilitiesAvailable(handshake, discovery, selection, wantsDetail, io, { source: "live_discovery" });
}

type ParsedTargetCatalogOptions =
	| { kind: "catalog" }
	| { kind: "targets"; profileRef?: string; body: { capability_id: string; match?: string; cursor?: string; limit?: number } }
	| null;

function parseTargetCatalogOptions(options: readonly string[]): ParsedTargetCatalogOptions {
	if (options[0] !== "targets") return parseCapabilityCatalogOptions(options);
	return parseTargetCatalogSelection(options.slice(1));
}

function parseCapabilityCatalogOptions(options: readonly string[]): ParsedTargetCatalogOptions {
	if (options.length === 0) return { kind: "catalog" };
	if (storedProfileOption(options) !== null) return { kind: "catalog" };
	return parseGatewayOptions(options).ok ? { kind: "catalog" } : null;
}

function parseTargetCatalogSelection(options: readonly string[]): ParsedTargetCatalogOptions {
	const parsed = parseNamedOptions(options, new Set(["--capability", "--cursor", "--limit", "--match", "--profile"]), new Set());
	if (!parsed || parsed.operands.length !== 0) return null;
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
		body: { capability_id: selection.capabilityId, ...(selection.match ? { match: selection.match } : {}), ...(selection.cursor ? { cursor: selection.cursor } : {}), ...(limit ? { limit } : {}) },
	};
}

function isValidTargetCatalogSelection(selection: Readonly<{ capabilityId: string | undefined; cursor: string | undefined; match: string | undefined; profileRef: string | undefined; limitText: string | undefined }>): selection is Readonly<{ capabilityId: string; cursor: string | undefined; match: string | undefined; profileRef: string | undefined; limitText: string | undefined }> {
	if (!validCapabilityId(selection.capabilityId)) return false;
	if (selection.cursor !== undefined && !isSafeCursor(selection.cursor)) return false;
	if (selection.match !== undefined && !isSafeTargetMatch(selection.match)) return false;
	if (selection.profileRef !== undefined && !isSafeProfileRef(selection.profileRef)) return false;
	if (selection.cursor !== undefined && selection.match !== undefined) return false;
	return true;
}

function isSafeCursor(value: string): boolean { return /^cursor:[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/u.test(value); }
function isSafeTargetMatch(value: string): boolean {
	return Buffer.byteLength(value, "utf8") >= 1 && Buffer.byteLength(value, "utf8") <= 2048
		&& !hasControlCharacter(value);
}
function hasControlCharacter(value: string): boolean { return [...value].some((character) => character.codePointAt(0)! <= 0x1f || character.codePointAt(0) === 0x7f); }
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

async function resolveGatewayAccess(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<GatewayAccessResolution> {
	const selectedProfile = storedProfileOption(options);
	return selectedProfile ? resolveStoredGatewayAccess(io, runtime, selectedProfile)
		: options.length === 0 ? resolveStoredGatewayAccess(io, runtime) : resolveExplicitGatewayAccess(options, io, runtime);
}

async function resolveStoredGatewayAccess(io: CealCliIo, runtime: CealCommandRuntime, selectedProfile?: string): Promise<GatewayAccessResolution> {
	if (!runtime.loadSession) return { ok: false, exitCode: writeCapabilitiesUnavailable(io) };
	try {
		const loaded = await runtime.loadSession();
		const session = loaded ? await ensureCurrentSession(loaded, runtime) : null;
		if (!session) return { ok: false, exitCode: writeCapabilitiesUnavailable(io) };
		return { ok: true, value: {
			endpoint: session.gatewayEndpoint, profileRef: selectedProfile ?? session.profileRef, accessToken: session.accessToken,
			storedSession: session, requestId: runtime.nextRequestId?.() ?? "ceal:capabilities",
		} };
	} catch (error) {
		const exitCode = error instanceof CealClientSessionError
			? writeClientSessionUnavailable(error.code, io) : writeGatewayUnavailable("session_load_failed", io);
		return { ok: false, exitCode };
	}
}

async function resolveExplicitGatewayAccess(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<GatewayAccessResolution> {
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
		request_id: `${access.requestId}:handshake`, operation: "handshake", profile_ref: access.profileRef,
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
	response: { ok: boolean; error?: unknown }, session: CealStoredSession | null,
): session is CealStoredSession {
	return !response.ok && gatewayFailureCode(response.error) === "authentication_failed" && Boolean(session?.refreshToken);
}

// Concise default: an agent scanning the catalog wants the capability id, label,
// effect, and whether a target is required — not the full input grammar for all
// ~10 capabilities on every `capabilities` call. `--detail` restores the bodies.
// The omitted fields (`input_contract`, `write_contract`) are re-fetched by
// re-running with `--detail`; the concise rows stay a strict subset so nothing
// the caller needs to *select* a capability is dropped.
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
): number {
	const capabilities = detail
		? discovery.value.capabilities
		: discovery.value.capabilities.map(conciseCapability);
	return writeYaml(io.stdout, {
		schema_version: "ceal.capabilities.v1", command: "ceal", status: "available", gateway_required: true,
		credential_context: CREDENTIAL_CONTEXT,
		gateway: {
			profile_ref: handshake.value.profile_ref, membership_ref: handshake.value.membership_ref,
			registration_ref: handshake.value.registration_ref, client_ref: handshake.value.client_ref,
			subject_ref: handshake.value.subject_ref, instance_ref: handshake.value.instance_ref,
			negotiated_protocol_version: handshake.value.negotiated_protocol_version, host_decision: handshake.value.host_decision,
			// Surface the negotiated eligible-Profile catalog so an agent can see
			// which `--profile <profile_ref>` selections this session may pass
			// without re-login. Present only when the Gateway negotiated it; the
			// current selection is `gateway.profile_ref` above.
			...(handshake.value.eligible_profiles ? { eligible_profiles: handshake.value.eligible_profiles } : {}),
		},
		capabilities, targets: discovery.value.targets,
		// Tell an agent the concise rows omit the input grammar and how to get it,
		// so a compact default never reads as "this capability has no contract".
		...(detail ? {} : { capability_detail: "Re-run 'ceal capabilities --detail' for per-capability input_contract." }),
		target_catalog: discovery.value.target_catalog,
		proof_level: discovery.value.proof_level, live_gateway_checked: true,
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
		claims_allowed: provenance.source === "cached_discovery"
			? ["gateway_handshake"] : ["gateway_handshake", "gateway_discovery"],
		non_claims: discovery.value.non_claims,
		request_ids: { handshake: handshake.request_id, discovery: discovery.request_id },
		...(capabilityCatalogNextAction(discovery.value.target_catalog, selection) ? { next_action: capabilityCatalogNextAction(discovery.value.target_catalog, selection) } : {}),
		...(profileSelectionHint(handshake.value) ? { profile_selection: profileSelectionHint(handshake.value) } : {}),
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

function capabilityCatalogNextAction(
	catalog: CealGatewayDiscoveryValue["target_catalog"], selection: Exclude<ParsedTargetCatalogOptions, null>,
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
	return executeCall(resolved.session, parsed.profileRef ?? resolved.session.profileRef, parsed, requestId, io, runtime);
}

async function runReceipt(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	const parsed = parseReceiptOptions(options);
	if (!parsed) return writeReceiptError("validation_error", "Pass one receipt reference returned by a completed call.", io);
	const resolved = await resolveCallSession(runtime);
	if (!resolved.ok) return writeReceiptError(resolved.reason, "The Gateway receipt could not be read.", io);
	try {
		const { readback } = await requestReceiptReadback(resolved.session, parsed.profileRef ?? resolved.session.profileRef, parsed.requestRef, runtime);
		if (!readback.ok) return writeReceiptError(classifyGatewayFailure(readback.error).code, "The Gateway receipt could not be read.", io);
		return writeYaml(io.stdout, {
			schema_version: "ceal.receipt.v1", status: "verified", request_ref: parsed.requestRef,
			events: readback.value.events.map(projectReceiptEvent),
		});
	} catch (error) {
		const reason = error instanceof CealClientSessionError ? error.code
			: error instanceof CealHttpTransportError ? error.code : "request_failed";
		return writeReceiptError(reason, "The Gateway receipt could not be read.", io);
	}
}

async function requestReceiptReadback(initialSession: CealStoredSession, profileRef: string, requestRef: string, runtime: CealCommandRuntime) {
	let session = initialSession;
	let client = createCealClient(createCealHttpTransport({ endpoint: session.gatewayEndpoint, accessToken: session.accessToken }));
	let readback = await client.request({
		request_id: `${runtime.nextRequestId?.() ?? "ceal:receipt"}:readback`, operation: "readback",
		profile_ref: profileRef, body: { request_id: requestRef },
	});
	if (!shouldRetryAuthentication(readback, session)) return { readback, session };
	session = await ensureCurrentSession(session, runtime, true);
	client = createCealClient(createCealHttpTransport({ endpoint: session.gatewayEndpoint, accessToken: session.accessToken }));
	readback = await client.request({
		request_id: `${runtime.nextRequestId?.() ?? "ceal:receipt"}:readback`, operation: "readback",
		profile_ref: profileRef, body: { request_id: requestRef },
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
		ref: event.event_ref, operation: event.operation, outcome: event.outcome,
		authorization: event.policy_decision,
		...(event.error_code === null ? {} : { error_code: event.error_code, non_claims: [...event.non_claims] }),
		...(event.connector_route_failure ? { connector_route_failure: {
			connector_kind: event.connector_route_failure.connector_kind,
			phase: event.connector_route_failure.phase,
		} } : {}),
		...(event.grant_snapshot ? {
			capability: event.grant_snapshot.capability_id, target: event.grant_snapshot.target_ref,
			grant: { ref: event.grant_snapshot.grant_ref, revision: event.grant_snapshot.grant_revision },
		} : {}),
		...(gatewayElapsedMs === undefined ? {} : { timing: { gateway_elapsed_ms: gatewayElapsedMs } }),
	};
}

function safeGatewayElapsed(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function writeReceiptError(kind: string, message: string, io: CealCliIo): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.receipt.v1", status: "error",
		error: { kind, message, next_action: "Use a receipt reference from a completed call after confirming the client session." },
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
	return (envelope) => {
		try {
			const entry = receiptSpoolEntryFromCallResult(envelope, runtime.now?.() ?? Date.now());
			if (entry) record(entry);
		} catch { /* spool failure must never change call behavior */ }
	};
}

async function executeCall(
	initialSession: CealStoredSession,
	profileRef: string,
	parsed: Extract<ParsedCallOptions, { ok: true }>,
	requestId: string,
	io: CealCliIo,
	runtime: CealCommandRuntime,
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
			return writeCallUnavailable(reason, io, initialSession, parsed);
		}
		// A session renewal is attempted only after the Gateway explicitly
		// returned authentication_failed. It is therefore a known pre-provider
		// rejection, not an unknown call outcome; do not ask an agent to look up
		// or preserve a receipt for an action the Gateway did not authorize.
		if (error instanceof CealClientSessionError) return writeCallUnavailable(error.code, io, initialSession, parsed);
		const reason = error instanceof CealHttpTransportError ? error.code : "request_failed";
		return writeCallUnavailable(reason, io, initialSession, parsed, requestId, record);
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
	client: ReturnType<typeof createCealClient>, profileRef: string, parsed: Extract<ParsedCallOptions, { ok: true }>, requestId: string,
) {
	return client.request({
		request_id: requestId, operation: "call", profile_ref: profileRef,
		body: {
				capability_id: parsed.capabilityId, target_ref: parsed.targetRef,
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
	try { session = await ensureCurrentSession(session, runtime, true); }
	catch (error) { throw new CealKnownPreProviderCallError(error); }
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
		ok: true, capabilityId, targetRef, arguments: arguments_, ...(profileRef ? { profileRef } : {}),
		purpose: `Invoke approved capability '${capabilityId}' for the current task.`,
	};
}

function isSafeRequestRef(value: string | undefined): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function parseReceiptOptions(options: readonly string[]): { requestRef: string; profileRef?: string } | null {
	if (options[0] !== "show" || !isSafeRequestRef(options[1])) return null;
	const profile = extractProfileOption(options.slice(2));
	return profile && profile.remaining.length === 0 ? { requestRef: options[1]!, ...(profile.value ? { profileRef: profile.value } : {}) } : null;
}

function storedProfileOption(options: readonly string[]): string | null {
	const profile = extractProfileOption(options);
	return profile && profile.remaining.length === 0 ? profile.value ?? null : null;
}

function extractProfileOption(options: readonly string[]): { value?: string; remaining: string[] } | null {
	const remaining: string[] = [];
	let value: string | undefined;
	for (let index = 0; index < options.length; index += 1) {
		const option = options[index];
		if (option !== "--profile") { remaining.push(option!); continue; }
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
	return writeYaml(io.stdout, {
		schema_version: "ceal.capabilities.v1",
		command: "ceal",
		status: "unavailable",
		gateway_required: true,
		credential_context: CREDENTIAL_CONTEXT,
		capabilities: [] as readonly never[],
		proof_level: "surface",
		live_gateway_checked: false,
		claims_allowed: [] as readonly never[],
		non_claims: ["No live Gateway discovery, authorization, provider action, or audit readback was reached."],
		next_action: CEAL_COMMANDS[2].recovery,
	});
}

type ParsedGatewayOptions =
	| { ok: true; endpoint: string; profileRef: string; requestId: string }
	| { ok: false; message: string };

function parseGatewayOptions(options: readonly string[]): ParsedGatewayOptions {
	const parsed = parseNamedOptions(options, new Set(["--endpoint", "--profile", "--request-id"]), new Set(["--token-stdin"]));
	if (!parsed || parsed.operands.length !== 0 || !parsed.flags.has("--token-stdin")) return invalidGatewayOptions();
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
		status: failure.denial ? "denied" : "unavailable",
		gateway_required: true,
		credential_context: CREDENTIAL_CONTEXT,
		capabilities: [],
		proof_level: "host_decision",
		live_gateway_checked: true,
		claims_allowed: [failure.denial ? "gateway_denial" : "gateway_rejection"],
		error: { code: failure.code, message: failure.message, next_action: failure.nextAction },
		non_claims: ["No provider action or production audit custody was reached."],
	});
	return 3;
}

function writeGatewayUnavailable(reason: string, io: CealCliIo): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.capabilities.v1",
		command: "ceal",
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

function writeError(kind: "unknown_command" | "invalid_argument", message: string, io: CealCliIo): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.error.v1",
		command: "ceal",
		ok: false,
		status: "error",
		credential_context: CREDENTIAL_CONTEXT,
		error: { kind, message, next_action: "Run 'ceal --help'." },
	});
	return 2;
}

function isHelpToken(value: string | undefined): boolean {
	return value === "--help" || value === "-h";
}
