import {
	CEAL_PROTOCOL_VERSION,
	CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE,
} from "@corca-ai/ceal-protocol";
import { parse, stringify } from "yaml";
import {
	applyCealAccess,
	CealAccessAdminClientError,
	decodeCealAccessRegistry,
	showCealAccess,
} from "./access-admin-client.js";
import {
	applyCealProfileConnectors,
	checkCealProfileConnectors,
	CealProfileConnectorAdminClientError,
	decodeCealProfileConnectorRegistry,
	showCealProfileConnectors,
} from "./profile-connector-admin-client.js";
import { CealEnrollmentAdminClientError, createCealEnrollment } from "./enrollment-admin-client.js";
import {
	currentOperatorSession,
	operatorProfilesPayload,
	OperatorSessionStoreError,
	redactSession,
	saveOperatorSession,
	selectOperatorSession,
} from "./operator-session-store.js";
import type { OperatorSession } from "./operator-session-store.js";
import {
	OperatorSessionClientError,
	refreshOperatorSession,
	revokeAndRemoveOperatorSession,
} from "./operator-session-client.js";
import { LocalGatewayOwnerLoginError, loginLocalGatewayOwner } from "./local-gateway-owner-login-client.js";
import { AdminApiContractClientError, requireCompatibleAdminApiContract } from "./admin-api-contract-client.js";

export const CEAL_OPERATOR_CLI_VERSION = "0.65.0" as const;
export const CEALCTL_CREDENTIAL_CONTEXT = "cealctl_operator_admin_session" as const;

export interface CealctlIo {
	stdout: { write(chunk: string): unknown };
	stderr: { write(chunk: string): unknown };
}

export interface CealctlRuntime {
	homeDir?: string;
	fetchFn?: typeof globalThis.fetch;
	sleepFn?: (milliseconds: number) => Promise<void>;
	readStdin?: () => Promise<string>;
	localGatewayOwnerSocketPath?: string;
	localGatewayOwnerLogin?: (input: { adminOrigin: string; profile: string; socketPath?: string }) => Promise<OperatorSession>;
}

export interface CealctlCommandDefinition {
	name: "version" | "commands" | "login" | "sessions" | "logout" | "access" | "connectors" | "enrollments" | "doctor";
	description: string;
	usage: string;
	effect: "read_only" | "control_write";
	evidence: "surface" | "host_decision";
	result_schema: string;
	recovery: string;
}

export const CEALCTL_COMMANDS: readonly CealctlCommandDefinition[] = [
	{
		name: "version",
		description: "Show package and protocol compatibility.",
		usage: "cealctl version",
		effect: "read_only",
		evidence: "surface",
		result_schema: "cealctl.version.v1",
		recovery: "Run 'cealctl version' again after installing or updating the CLI.",
	},
	{
		name: "commands",
		description: "Discover the public operator command surface.",
		usage: "cealctl commands",
		effect: "read_only",
		evidence: "surface",
		result_schema: "cealctl.command_discovery.v1",
		recovery: "Descend with 'cealctl <command> --help' before invoking a command.",
	},
	{
		name: "login",
		description: "Authenticate this Gateway-host operator through its local control channel.",
		usage: "cealctl login <admin-url> [--session <name>]",
		effect: "control_write",
		evidence: "host_decision",
		result_schema: "cealctl.login.v1",
		recovery: "Run this on the Gateway admin host as its service-owning Unix account, then retry after checking Gateway readiness.",
	},
	{
		name: "sessions",
		description: "Inspect or select stored operator sessions without exposing tokens.",
		usage: "cealctl sessions [use <name>]",
		effect: "control_write",
		evidence: "surface",
		result_schema: "cealctl.sessions.v1",
		recovery: "Run 'cealctl login <admin-url> --session <name>' when no session exists.",
	},
	{
		name: "logout",
		description: "Revoke one operator session before removing its local state.",
		usage: "cealctl logout [--session <name>]",
		effect: "control_write",
		evidence: "host_decision",
		result_schema: "cealctl.logout.v1",
		recovery: "If revoke fails, preserve local state and retry after checking Gateway reachability.",
	},
	{
		name: "access",
		description: "Inspect or apply Profile memberships, approved client devices, and grants.",
		usage: "cealctl access [show | apply --stdin [--dry-run] [--operator-session <name>]]",
		effect: "control_write",
		evidence: "host_decision",
		result_schema: "cealctl.access.v1",
		recovery: "Run 'cealctl access --help', inspect the current registry, then validate a complete replacement before applying it.",
	},
	{
		name: "connectors",
		description: "Inspect or apply Profile connector-principal bindings without resource lists.",
		usage: "cealctl connectors [show | check | apply --stdin [--dry-run] [--operator-session <name>]]",
		effect: "control_write",
		evidence: "host_decision",
		result_schema: "cealctl.profile_connectors.v1",
		recovery: "Run 'cealctl connectors --help', inspect connector readiness or the current binding registry, then validate a complete replacement before applying it.",
	},
	{
		name: "enrollments",
		description: "Create one-time pre-approved client-device enrollment material.",
		usage: "cealctl enrollments create --client <name> --profile <name> --subject <name> --instance <name> [--operator-session <name>]",
		effect: "control_write",
		evidence: "host_decision",
		result_schema: "cealctl.enrollments.v1",
		recovery: "Inspect this command, then create a replacement code if enrollment does not complete before expiry.",
	},
	{
		name: "doctor",
		description: "Check this binary and protocol surface without setup or runtime access.",
		usage: "cealctl doctor",
		effect: "read_only",
		evidence: "surface",
		result_schema: "cealctl.doctor.v1",
		recovery: "Use setup or runtime-specific status commands only after this surface is ready.",
	},
];

// Same contract as the worker CLI: an operator route the dispatcher accepts is a
// leaf, so it renders its own four fields instead of borrowing the parent's.
export interface CealctlSubcommandDefinition {
	parent: CealctlCommandDefinition["name"];
	route: readonly string[];
	description: string;
	usage: string;
	effect: CealctlCommandDefinition["effect"];
	evidence: CealctlCommandDefinition["evidence"];
	result_schema: string;
	recovery: string;
	options?: readonly string[];
}

const OPERATOR_SESSION_OPTION = "  --operator-session <name>      Use a named stored admin session." as const;
const DRY_RUN_OPTION = "  --dry-run                      Validate the replacement without changing Gateway state." as const;

export const CEALCTL_SUBCOMMANDS: readonly CealctlSubcommandDefinition[] = [
	{
		parent: "sessions",
		route: ["use"],
		description: "Select one stored operator session as current.",
		usage: "cealctl sessions use <safe-name>",
		effect: "control_write",
		evidence: "surface",
		result_schema: "cealctl.sessions.v1",
		recovery: "Run 'cealctl sessions' to read back which stored session is current.",
		options: ["  <safe-name>                    Existing stored operator session name."],
	},
	{
		parent: "access",
		route: ["show"],
		description: "Read the current Gateway access registry without changing it.",
		usage: "cealctl access show [--operator-session <name>]",
		effect: "read_only",
		evidence: "host_decision",
		result_schema: "cealctl.access.v1",
		recovery: "Run 'cealctl login <admin-url>' when no current session exists, then re-read the registry.",
		options: [OPERATOR_SESSION_OPTION],
	},
	{
		parent: "access",
		route: ["apply"],
		description: "Validate or atomically replace the complete Gateway access registry from stdin.",
		usage: "cealctl access apply --stdin [--dry-run] [--operator-session <name>]",
		effect: "control_write",
		evidence: "host_decision",
		result_schema: "cealctl.access.v1",
		recovery: "Re-run with '--dry-run' to validate, then read back the applied registry with 'cealctl access show'.",
		options: [
			"  --stdin                        Read one ceal.gateway_access_registry.v1 YAML document.",
			DRY_RUN_OPTION,
			OPERATOR_SESSION_OPTION,
		],
	},
	{
		parent: "connectors",
		route: ["show"],
		description: "Read the current Profile connector-principal binding registry without changing it.",
		usage: "cealctl connectors show [--operator-session <name>]",
		effect: "read_only",
		evidence: "host_decision",
		result_schema: "cealctl.profile_connectors.v1",
		recovery: "Run 'cealctl login <admin-url>' when no current session exists, then re-read the bindings.",
		options: [OPERATOR_SESSION_OPTION],
	},
	{
		parent: "connectors",
		route: ["check"],
		description: "Run one bounded, read-only connector operation check for every active Profile binding.",
		usage: "cealctl connectors check [--operator-session <name>]",
		effect: "read_only",
		evidence: "host_decision",
		result_schema: "cealctl.profile_connector_check.v1",
		recovery: "Repair the reported binding with 'cealctl connectors apply', then re-run this check.",
		options: [OPERATOR_SESSION_OPTION],
	},
	{
		parent: "connectors",
		route: ["apply"],
		description: "Validate or atomically replace complete Profile connector-principal bindings from stdin.",
		usage: "cealctl connectors apply --stdin [--dry-run] [--operator-session <name>]",
		effect: "control_write",
		evidence: "host_decision",
		result_schema: "cealctl.profile_connectors.v1",
		recovery: "Re-run with '--dry-run' to validate, then prove the result with 'cealctl connectors check'.",
		options: [
			"  --stdin                        Read one ceal.gateway_profile_connector_registry.v1 YAML document.",
			DRY_RUN_OPTION,
			OPERATOR_SESSION_OPTION,
		],
	},
	{
		parent: "enrollments",
		route: ["create"],
		description: "Create one short-lived, one-time device-enrollment code.",
		usage: "cealctl enrollments create --client <name> --profile <name> --subject <name> --instance <name> [--operator-session <name>]",
		effect: "control_write",
		evidence: "host_decision",
		result_schema: "cealctl.enrollment_created.v1",
		recovery: "Create a replacement code if enrollment does not complete before expiry; never re-send an expired code.",
		options: [
			"  --client <safe-name>           Existing pre-approved client device name.",
			"  --profile <safe-name>          Profile name bound by the Gateway.",
			"  --subject <safe-name>          Existing Subject bound by the Gateway.",
			"  --instance <safe-name>         Customer instance bound by the Gateway.",
			OPERATOR_SESSION_OPTION,
		],
	},
];

const COMMAND_BY_NAME = new Map(CEALCTL_COMMANDS.map((command) => [command.name, command]));
const TOP_LEVEL_HELP = [
	"Usage: cealctl <command> [options]",
	"",
	"Operator-facing Ceal control client. Worker credentials are outside this command surface.",
	"Non-help command results are one YAML document; --json is not supported.",
	"",
	"Commands:",
	...CEALCTL_COMMANDS.map((command) => `  ${command.name.padEnd(14)} ${command.description}`),
	"",
	"Run: cealctl <command> --help",
].join("\n");

const COMMAND_HELP_OPTIONS: Partial<Record<CealctlCommandDefinition["name"], readonly string[]>> = {
	login: [
		"  <admin-url>                   Canonical private Gateway base: https://<host>/<org>/<instance>.",
		"  --session <safe-name>         Local operator session name (default: default).",
	],
	logout: ["  --session <safe-name>         Revoke a named session instead of the current session."],
};

export function runCealctlCommand(args: readonly string[], io: CealctlIo, runtime: CealctlRuntime = {}): number | Promise<number> {
	if (args.length === 0 || (args.length === 1 && (isHelpToken(args[0]) || args[0] === "help"))) {
		return writeHelp(TOP_LEVEL_HELP, io);
	}
	if (args[0] === "help") return writeRequestedHelp(args.slice(1), io);
	const command = COMMAND_BY_NAME.get(args[0] as CealctlCommandDefinition["name"]);
	if (!command) return writeError("unknown_command", "Unknown cealctl command.", io);
	const options = args.slice(1);
	const requestedHelp = helpRequest(command, options);
	if (requestedHelp !== undefined) return writeHelp(requestedHelp, io);
	return runKnownCommand(command.name, options, io, runtime);
}

// A help token anywhere in the tail is a read-only help request, never an
// operand: an operator probing a partially typed line must not reach a runner
// that authorizes an effect, and a guessed route should land on the parent leaf
// whose `Subcommands:` block names the routes that do exist.
function helpRequest(command: CealctlCommandDefinition, options: readonly string[]): string | undefined {
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

function subcommandsOf(parent: CealctlCommandDefinition["name"]): readonly CealctlSubcommandDefinition[] {
	return CEALCTL_SUBCOMMANDS.filter((subcommand) => subcommand.parent === parent);
}

function findSubcommand(parent: CealctlCommandDefinition["name"], route: readonly string[]): CealctlSubcommandDefinition | undefined {
	return subcommandsOf(parent).find((subcommand) => subcommand.route.length === route.length
		&& subcommand.route.every((token, index) => token === route[index]));
}

function runKnownCommand(command: CealctlCommandDefinition["name"], options: readonly string[], io: CealctlIo, runtime: CealctlRuntime): number | Promise<number> {
	return COMMAND_RUNNERS[command](options, io, runtime);
}

type CealctlCommandRunner = (options: readonly string[], io: CealctlIo, runtime: CealctlRuntime) => number | Promise<number>;

const COMMAND_RUNNERS: Record<CealctlCommandDefinition["name"], CealctlCommandRunner> = {
	version: (options, io) => writeReadOnlyCommand(options, io, writeVersion, "version"),
	commands: (options, io) => writeReadOnlyCommand(options, io, writeCommands, "commands"),
	login: runLogin,
	sessions: runSessions,
	logout: runLogout,
	access: runAccess,
	connectors: runProfileConnectors,
	enrollments: runEnrollments,
	doctor: (options, io) => writeReadOnlyCommand(options, io, writeDoctor, "doctor"),
};

function writeReadOnlyCommand(
	options: readonly string[],
	io: CealctlIo,
	writeCommand: (io: CealctlIo) => number,
	name: "version" | "commands" | "doctor",
): number {
	return options.length === 0 ? writeCommand(io) : writeError("invalid_argument", `Invalid cealctl ${name} options.`, io);
}

function writeRequestedHelp(args: readonly string[], io: CealctlIo): number {
	if (args.length === 0) return writeError("invalid_argument", "Help requires one public command name.", io);
	const command = COMMAND_BY_NAME.get(args[0] as CealctlCommandDefinition["name"]);
	if (!command) return writeError("unknown_command", "Unknown cealctl command.", io);
	if (args.length === 1) return writeHelp(commandHelp(command), io);
	const subcommand = findSubcommand(command.name, args.slice(1));
	return subcommand ? writeHelp(subcommandHelp(subcommand), io)
		: writeError("invalid_argument", "Help requires one public command name or subcommand route.", io);
}

function commandHelp(command: CealctlCommandDefinition): string {
	const options = COMMAND_HELP_OPTIONS[command.name] ?? [];
	const subcommands = subcommandsOf(command.name);
	return [
		`Usage: ${command.usage}`,
		"",
		command.description,
		"",
		`Effect: ${command.effect}`,
		`Evidence: ${command.evidence}`,
		`Result schema: ${command.result_schema}`,
		"Output: one YAML document on stdout; --json is not supported.",
		`Recovery/readback: ${command.recovery}`,
		"",
		...(subcommands.length === 0 ? [] : [
			"Subcommands:",
			...subcommandRows(subcommands),
			`Run: cealctl ${command.name} <subcommand> --help for that leaf's own contract.`,
			"",
		]),
		"Options:",
		...options,
		"  -h, --help  Show this help without performing work.",
	].join("\n");
}

// Align on the widest route so every row keeps a two-space column separator.
function subcommandRows(subcommands: readonly CealctlSubcommandDefinition[]): readonly string[] {
	const width = Math.max(...subcommands.map((subcommand) => subcommand.route.join(" ").length));
	return subcommands.map((subcommand) => `  ${subcommand.route.join(" ").padEnd(width)}  ${subcommand.description}`);
}

function subcommandHelp(subcommand: CealctlSubcommandDefinition): string {
	return [
		`Usage: ${subcommand.usage}`,
		"",
		subcommand.description,
		"",
		`Effect: ${subcommand.effect}`,
		`Evidence: ${subcommand.evidence}`,
		`Result schema: ${subcommand.result_schema}`,
		"Output: one YAML document on stdout; --json is not supported.",
		`Recovery/readback: ${subcommand.recovery}`,
		"",
		"Options:",
		...(subcommand.options ?? []),
		"  -h, --help  Show this help without performing work.",
	].join("\n");
}

async function runLogin(options: readonly string[], io: CealctlIo, runtime: CealctlRuntime): Promise<number> {
	if (options.length === 0) {
		return writeYaml(io.stdout, {
			schema_version: "cealctl.login.v1", command: "cealctl", status: "ready", proof_level: "surface",
			credential_context: CEALCTL_CREDENTIAL_CONTEXT, authenticated: false,
			next_action: "Run 'cealctl login <admin-url> --session <name>'.",
		});
	}
	const parsed = parseLoginOptions(options);
	if (!parsed) return writeError("invalid_argument", "Invalid cealctl login options.", io);
	try {
		const session = await (runtime.localGatewayOwnerLogin ?? loginLocalGatewayOwner)({
			adminOrigin: parsed.adminOrigin,
			profile: parsed.profile,
			socketPath: runtime.localGatewayOwnerSocketPath,
		});
		await saveOperatorSession(session, runtime.homeDir);
		return writeYaml(io.stdout, {
			schema_version: "cealctl.login.v1", command: "cealctl", status: "authenticated",
			session: redactSession(session), raw_token_visible: false, proof_level: "host_decision",
			next_action: "Run 'cealctl enrollments --help' to issue a personal-client enrollment.",
		});
	} catch (error) {
		const kind = await classifyLoginFailure(sessionErrorCode(error), parsed.adminOrigin, runtime);
		return writeSessionFailure("cealctl.login.v1", kind, "The operator login could not be completed.", io);
	}
}

// Gateway-version recovery: a missing local-owner socket looks identical for
// "old Gateway without the local control channel" and "wrong host/account".
// One bounded read-only probe of the public contract endpoint separates them —
// a Gateway that cannot state a compatible contract is old, so the operator
// gets the explicit upgrade-required recovery instead of a host-locality hint.
async function classifyLoginFailure(kind: string, adminOrigin: string, runtime: CealctlRuntime): Promise<string> {
	if (kind !== "local_authorization_unavailable") return kind;
	try {
		await requireCompatibleAdminApiContract({ adminOrigin, fetchFn: runtime.fetchFn });
		return kind;
	} catch (probeError) {
		return probeError instanceof AdminApiContractClientError && probeError.code === "control_plane_upgrade_required"
			? "control_plane_upgrade_required"
			: kind;
	}
}

async function runSessions(options: readonly string[], io: CealctlIo, runtime: CealctlRuntime): Promise<number> {
	try {
		if (options.length === 0) return writeYaml(io.stdout, operatorProfilesPayload(runtime.homeDir));
		if (options.length === 2 && options[0] === "use" && options[1]) {
			const session = await selectOperatorSession(options[1], runtime.homeDir);
			return writeYaml(io.stdout, {
				schema_version: "cealctl.sessions.v1", command: "cealctl", status: "selected",
				current_session: session.name, session: redactSession(session), raw_token_visible: false, proof_level: "local_state",
			});
		}
		return writeError("invalid_argument", "Invalid cealctl sessions options.", io);
	} catch (error) {
		return writeSessionFailure("cealctl.sessions.v1", sessionErrorCode(error), "The operator session could not be read.", io);
	}
}

async function runLogout(options: readonly string[], io: CealctlIo, runtime: CealctlRuntime): Promise<number> {
	const profile = parseOptionalProfile(options);
	if (profile === null) return writeError("invalid_argument", "Invalid cealctl logout options.", io);
	try {
		const selected = currentOperatorSession(runtime.homeDir, profile || undefined);
		const session = await revokeAndRemoveOperatorSession({ session: selected, homeDir: runtime.homeDir, fetchFn: runtime.fetchFn });
		return writeYaml(io.stdout, {
			schema_version: "cealctl.logout.v1", command: "cealctl", status: "revoked",
			session: session.name, server_revoked: true, local_session_removed: true,
			raw_token_visible: false, proof_level: "host_decision",
		});
	} catch (error) {
		return writeSessionFailure("cealctl.logout.v1", sessionErrorCode(error), "The operator session could not be revoked.", io);
	}
}

function runAccess(options: readonly string[], io: CealctlIo, runtime: CealctlRuntime): number | Promise<number> {
	if (options.length === 0) return writeYaml(io.stdout, {
		schema_version: "cealctl.access.v1", command: "cealctl", status: "ready", proof_level: "surface",
		writes_external: false, next_action: "Run 'cealctl access show' or inspect 'cealctl access --help'.",
	});
	const parsed = parseAccessOptions(options);
	if (!parsed) return writeError("invalid_argument", "Invalid access options.", io);
	return executeAccess(parsed, io, runtime);
}

function runProfileConnectors(options: readonly string[], io: CealctlIo, runtime: CealctlRuntime): number | Promise<number> {
	if (options.length === 0) return writeYaml(io.stdout, {
		schema_version: "cealctl.profile_connectors.v1", command: "cealctl", status: "ready", proof_level: "surface",
		writes_external: false, next_action: "Run 'cealctl connectors show' or inspect 'cealctl connectors --help'.",
	});
	const parsed = parseProfileConnectorOptions(options);
	if (!parsed) return writeError("invalid_argument", "Invalid connector options.", io);
	return executeProfileConnectors(parsed, io, runtime);
}


async function executeProfileConnectors(
	parsed: { action: "show" | "check" | "apply"; dryRun: boolean; operatorSession?: string },
	io: CealctlIo,
	runtime: CealctlRuntime,
): Promise<number> {
	try {
		const registry = parsed.action === "apply" ? await readProfileConnectorRegistryFromStdin(runtime) : null;
		const common = await currentProfileConnectorRequest(runtime, parsed.operatorSession);
		if (parsed.action === "check") return executeProfileConnectorCheck(common, io);
		if (parsed.action === "show") return executeProfileConnectorRegistryAction({ action: "show", dryRun: false }, common, registry!, io);
		return executeProfileConnectorRegistryAction({ action: "apply", dryRun: parsed.dryRun }, common, registry!, io);
	} catch (error) {
		return writeProfileConnectorFailure(parsed.action, error, io);
	}
}

type ProfileConnectorRequest = { adminEndpoint: string; adminToken: string; fetchFn: CealctlRuntime["fetchFn"] };

async function currentProfileConnectorRequest(runtime: CealctlRuntime, operatorSession?: string): Promise<ProfileConnectorRequest> {
	const current = currentOperatorSession(runtime.homeDir, operatorSession);
	const refreshed = await refreshOperatorSession({ session: current, homeDir: runtime.homeDir, fetchFn: runtime.fetchFn });
	await requireCompatibleAdminApiContract({
		adminOrigin: refreshed.session.admin_api_origin,
		expectedDeploymentId: refreshed.session.deployment_id,
		fetchFn: runtime.fetchFn,
	});
	return { adminEndpoint: refreshed.session.admin_api_origin, adminToken: refreshed.accessToken, fetchFn: runtime.fetchFn };
}

async function executeProfileConnectorCheck(common: ProfileConnectorRequest, io: CealctlIo): Promise<number> {
	const result = await checkCealProfileConnectors(common);
	const requiresRepair = result.checks.some((check) => check.readiness !== "ready"
		&& !(check.readiness === "degraded" && check.diagnostic_code === "bounded_projection"));
	return writeYaml(io.stdout, {
		schema_version: "cealctl.profile_connector_check.v1", command: "cealctl", status: result.status,
		checks: result.checks, raw_token_visible: false, proof_level: result.proof_level,
		next_action: requiresRepair
			? "Resolve the reported connector condition, then run 'cealctl connectors check' again."
			: "Use 'ceal capabilities' from an approved client to discover the current Gateway catalog.",
	});
}

async function executeProfileConnectorRegistryAction(
	parsed: { action: "show" | "apply"; dryRun: boolean },
	common: ProfileConnectorRequest,
	registry: ReturnType<typeof decodeCealProfileConnectorRegistry>,
	io: CealctlIo,
): Promise<number> {
	const result = parsed.action === "show"
		? await showCealProfileConnectors(common)
		: await applyCealProfileConnectors({ ...common, registry, dryRun: parsed.dryRun });
	return writeYaml(io.stdout, {
		schema_version: "cealctl.profile_connectors.v1", command: "cealctl", status: result.status,
		dry_run: result.dry_run, registry: result.registry, raw_token_visible: false,
		proof_level: result.proof_level,
		next_action: result.status === "validated"
			? "Run the same command without --dry-run to apply these complete Profile connector bindings."
			: "Connector-native scope is derived from the current Profile principal, not a resource list.",
	});
}

function writeProfileConnectorFailure(action: "show" | "check" | "apply", error: unknown, io: CealctlIo): number {
	const kind = error instanceof CealProfileConnectorAdminClientError ? error.code : sessionErrorCode(error);
	if (action === "check") return writeSessionFailure("cealctl.profile_connector_check.v1", kind, "The Gateway Profile connector readiness check could not be completed.", io);
	return writeSessionFailure("cealctl.profile_connectors.v1", kind, "The Gateway Profile connector registry could not be read or applied.", io);
}

function parseProfileConnectorOptions(options: readonly string[]): { action: "show" | "check" | "apply"; dryRun: boolean; operatorSession?: string } | null {
	if (options[0] === "check") {
		const parsed = parseAccessShowOptions(options.slice(1));
		return parsed ? { action: "check", dryRun: false, ...(parsed.operatorSession ? { operatorSession: parsed.operatorSession } : {}) } : null;
	}
	return parseAccessOptions(options);
}

async function readProfileConnectorRegistryFromStdin(runtime: CealctlRuntime) {
	if (typeof runtime.readStdin !== "function") throw new CealProfileConnectorAdminClientError("invalid_configuration");
	const input = await runtime.readStdin();
	if (Buffer.byteLength(input, "utf8") > 64 * 1024) throw new CealProfileConnectorAdminClientError("invalid_configuration");
	try { return decodeCealProfileConnectorRegistry(parse(input, { maxAliasCount: 0 })); }
	catch (error) {
		if (error instanceof CealProfileConnectorAdminClientError) throw error;
		throw new CealProfileConnectorAdminClientError("invalid_configuration");
	}
}


async function executeAccess(
	parsed: { action: "show" | "apply"; dryRun: boolean; operatorSession?: string },
	io: CealctlIo,
	runtime: CealctlRuntime,
): Promise<number> {
	try {
		const registry = parsed.action === "apply" ? await readAccessRegistryFromStdin(runtime) : null;
		const current = currentOperatorSession(runtime.homeDir, parsed.operatorSession);
		const refreshed = await refreshOperatorSession({ session: current, homeDir: runtime.homeDir, fetchFn: runtime.fetchFn });
		await requireCompatibleAdminApiContract({
			adminOrigin: refreshed.session.admin_api_origin,
			expectedDeploymentId: refreshed.session.deployment_id,
			fetchFn: runtime.fetchFn,
		});
		const common = {
			adminEndpoint: `${refreshed.session.admin_api_origin}/api/cealctl/v1/access`,
			adminToken: refreshed.accessToken,
			fetchFn: runtime.fetchFn,
		};
		const result = parsed.action === "show"
			? await showCealAccess(common)
			: await applyCealAccess({ ...common, registry: registry!, dryRun: parsed.dryRun });
		return writeYaml(io.stdout, {
			schema_version: "cealctl.access.v1", command: "cealctl", status: result.status,
			dry_run: result.dry_run, registry: result.registry, raw_token_visible: false,
			proof_level: result.proof_level,
			next_action: result.status === "validated" ? "Run the same command without --dry-run to apply this complete registry." : "Use 'cealctl enrollments create' only for a client declared active in this registry.",
		});
	} catch (error) {
		const kind = error instanceof CealAccessAdminClientError ? error.code : sessionErrorCode(error);
		return writeSessionFailure("cealctl.access.v1", kind, "The Gateway access registry could not be read or applied.", io);
	}
}

async function readAccessRegistryFromStdin(runtime: CealctlRuntime) {
	if (typeof runtime.readStdin !== "function") throw new CealAccessAdminClientError("invalid_configuration");
	const input = await runtime.readStdin();
	if (Buffer.byteLength(input, "utf8") > 64 * 1024) throw new CealAccessAdminClientError("invalid_configuration");
	try { return decodeCealAccessRegistry(parse(input, { maxAliasCount: 0 })); }
	catch (error) {
		if (error instanceof CealAccessAdminClientError) throw error;
		throw new CealAccessAdminClientError("invalid_configuration");
	}
}

function parseAccessOptions(options: readonly string[]): { action: "show" | "apply"; dryRun: boolean; operatorSession?: string } | null {
	if (options[0] === "show") return parseAccessShowOptions(options.slice(1));
	return options[0] === "apply" ? parseAccessApplyOptions(options.slice(1)) : null;
}

function parseAccessShowOptions(options: readonly string[]): { action: "show"; dryRun: false; operatorSession?: string } | null {
	if (options.length === 0) return { action: "show", dryRun: false };
	const operatorSession = options[1];
	return options.length === 2 && options[0] === "--operator-session" && SAFE_LOCAL_NAME.test(operatorSession ?? "")
		? { action: "show", dryRun: false, operatorSession }
		: null;
}

function parseAccessApplyOptions(options: readonly string[]): { action: "apply"; dryRun: boolean; operatorSession?: string } | null {
	const stdinCount = countToken(options, "--stdin");
	const dryRunCount = countToken(options, "--dry-run");
	const sessionCount = countToken(options, "--operator-session");
	const sessionIndex = options.indexOf("--operator-session");
	const operatorSession = sessionIndex < 0 ? undefined : options[sessionIndex + 1];
	const expectedLength = 1 + dryRunCount + (sessionCount * 2);
	if (stdinCount !== 1 || dryRunCount > 1 || sessionCount > 1 || options.length !== expectedLength) return null;
	if (operatorSession !== undefined && !SAFE_LOCAL_NAME.test(operatorSession)) return null;
	return { action: "apply", dryRun: dryRunCount === 1, ...(operatorSession ? { operatorSession } : {}) };
}

function countToken(options: readonly string[], token: string): number {
	return options.filter((option) => option === token).length;
}

function runEnrollments(options: readonly string[], io: CealctlIo, runtime: CealctlRuntime): number | Promise<number> {
	if (options.length === 0) {
		return writeYaml(io.stdout, {
			schema_version: "cealctl.enrollments.v1", command: "cealctl", status: "ready", proof_level: "surface",
			credential_context: CEALCTL_CREDENTIAL_CONTEXT, code_created: false,
			next_action: "Run 'cealctl enrollments --help' before creating one-time material.",
		});
	}
	return createEnrollmentCommand(options, io, runtime);
}

async function createEnrollmentCommand(options: readonly string[], io: CealctlIo, runtime: CealctlRuntime): Promise<number> {
	const parsed = parseEnrollmentCreateOptions(options);
	if (!parsed) return writeError("invalid_argument", "Invalid enrollment creation options.", io);
	try {
		const current = currentOperatorSession(runtime.homeDir, parsed.operatorSession);
		const refreshed = await refreshOperatorSession({ session: current, homeDir: runtime.homeDir, fetchFn: runtime.fetchFn });
		await requireCompatibleAdminApiContract({
			adminOrigin: refreshed.session.admin_api_origin,
			expectedDeploymentId: refreshed.session.deployment_id,
			fetchFn: runtime.fetchFn,
		});
		const result = await createCealEnrollment({
			adminEndpoint: `${refreshed.session.admin_api_origin}/api/cealctl/v1/enrollments`,
			adminToken: refreshed.accessToken,
			profileRef: `profile:${parsed.profile}`,
			clientRef: `client:${parsed.client}`,
			subjectRef: `subject:${parsed.subject}`,
			instanceRef: `instance:${parsed.instance}`,
		});
		return writeYaml(io.stdout, {
			schema_version: "cealctl.enrollment_created.v1",
			command: "cealctl",
			status: "created",
			gateway_endpoint: result.gatewayEndpoint,
			enrollment_kind: "preapproved_client_device",
			device_enrollment_code: result.code,
			expires_at: result.expiresAt,
			one_time: true,
			sensitive_material_visible: true,
			transfer_warning: "Transfer privately. Do not place this code in logs, tickets, or shared chat.",
			credential_context: CEALCTL_CREDENTIAL_CONTEXT,
			proof_level: "host_decision",
			next_action: `On the approved personal client machine, run 'ceal session enroll --gateway ${result.gatewayEndpoint}' in a terminal; it will prompt for this code with hidden input. Use --code-stdin only for approved automation.`,
		});
	} catch (error) {
		const code = error instanceof CealEnrollmentAdminClientError ? error.code : sessionErrorCode(error);
		return writeEnrollmentFailure(code, io);
	}
}

interface ParsedEnrollmentCreateOptions {
	client: string;
	profile: string;
	subject: string;
	instance: string;
	operatorSession?: string;
}

const ENROLLMENT_CREATE_FLAGS = new Set(["--client", "--profile", "--subject", "--instance", "--operator-session"]);
const REQUIRED_ENROLLMENT_CREATE_FLAGS = ["--client", "--profile", "--subject", "--instance"] as const;
const SAFE_LOCAL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

function parseEnrollmentCreateOptions(options: readonly string[]): ParsedEnrollmentCreateOptions | null {
	if (options[0] !== "create") return null;
	const values = parseNamedValues(options.slice(1), ENROLLMENT_CREATE_FLAGS);
	if (!values || !REQUIRED_ENROLLMENT_CREATE_FLAGS.every((option) => values.has(option))) return null;
	if (![...values.values()].every((value) => SAFE_LOCAL_NAME.test(value))) return null;
	return enrollmentOptionsFrom(values);
}

function parseNamedValues(options: readonly string[], allowed: ReadonlySet<string>): Map<string, string> | null {
	const values = new Map<string, string>();
	for (let index = 0; index < options.length; index += 2) {
		const option = options[index];
		const value = options[index + 1];
		if (!option || !allowed.has(option) || values.has(option) || !value) return null;
		values.set(option, value);
	}
	return values;
}

function enrollmentOptionsFrom(values: ReadonlyMap<string, string>): ParsedEnrollmentCreateOptions {
	return {
		client: values.get("--client") ?? "",
		profile: values.get("--profile") ?? "",
		subject: values.get("--subject") ?? "",
		instance: values.get("--instance") ?? "",
		operatorSession: values.get("--operator-session"),
	};
}

function parseLoginOptions(options: readonly string[]): { adminOrigin: string; profile: string } | null {
	if (options.length < 1 || !options[0] || options[0].startsWith("-")) return null;
	let profile = "default";
	for (let index = 1; index < options.length; index += 1) {
		if (options[index] !== "--session" || !options[index + 1] || index + 2 !== options.length) return null;
		profile = options[index + 1] ?? "";
		index += 1;
	}
	return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(profile) ? { adminOrigin: options[0], profile } : null;
}

function parseOptionalProfile(options: readonly string[]): string | null {
	if (options.length === 0) return "";
	if (options.length !== 2 || options[0] !== "--session" || !options[1]) return null;
	return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(options[1]) ? options[1] : null;
}

function sessionErrorCode(error: unknown): string {
	if (error instanceof LocalGatewayOwnerLoginError || error instanceof OperatorSessionClientError || error instanceof OperatorSessionStoreError || error instanceof AdminApiContractClientError) return error.code;
	return "request_failed";
}

function writeSessionFailure(schemaVersion: string, kind: string, message: string, io: CealctlIo): number {
	writeYaml(io.stdout, {
		schema_version: schemaVersion, command: "cealctl", status: "unavailable", proof_level: "surface",
		credential_context: CEALCTL_CREDENTIAL_CONTEXT, raw_token_visible: false,
		error: {
			kind,
			message,
			next_action: kind === "refresh_busy"
				? "Another local Ceal process is changing this operator session. Wait briefly, then retry the same command."
				: kind === "instance_route_required"
				? "Use the canonical organization/instance route: cealctl login https://<host>/<org>/<instance> --session <name>. Bare-apex and organization-only control targets are retired."
				: kind === "control_plane_upgrade_required"
				? "The running Gateway is older than this CLI. Install/apply the matching Gateway release on the Gateway admin host, verify its local control channel, then retry."
				: kind === "local_authorization_unavailable"
				? "Run this command on the Gateway admin host as the Unix account that owns the Gateway service, then verify the local control channel is ready."
				: "Check the private Gateway URL, local operator authority, stored profile, and Gateway status, then retry.",
		},
	});
	return 3;
}

function writeEnrollmentFailure(kind: string, io: CealctlIo): number {
	writeYaml(io.stdout, {
		schema_version: "cealctl.enrollment_created.v1", command: "cealctl", status: "unavailable", proof_level: "surface",
		credential_context: CEALCTL_CREDENTIAL_CONTEXT,
		error: { kind, message: "The Gateway device-enrollment code could not be created.", next_action: "Check the administrator session, approved access registry, and Gateway status, then retry." },
	});
	return 3;
}

function writeVersion(io: CealctlIo): number {
	return writeYaml(io.stdout, {
		schema_version: "cealctl.version.v1",
		command: "cealctl",
		version: CEAL_OPERATOR_CLI_VERSION,
		protocol_version: CEAL_PROTOCOL_VERSION,
		supported_gateway_protocol_range: CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE,
		credential_context: CEALCTL_CREDENTIAL_CONTEXT,
	});
}

function writeCommands(io: CealctlIo): number {
	return writeYaml(io.stdout, {
		schema_version: "cealctl.command_discovery.v1",
		command: "cealctl",
		credential_context: CEALCTL_CREDENTIAL_CONTEXT,
		commands: CEALCTL_COMMANDS,
		// Keep the machine-readable inventory at the same depth as installed help.
		subcommands: CEALCTL_SUBCOMMANDS.map((subcommand) => ({
			parent: subcommand.parent, route: [...subcommand.route], description: subcommand.description,
			usage: subcommand.usage, effect: subcommand.effect, evidence: subcommand.evidence,
			result_schema: subcommand.result_schema, recovery: subcommand.recovery,
		})),
		worker_command_surface_included: false,
	});
}

function writeDoctor(io: CealctlIo): number {
	return writeYaml(io.stdout, {
		schema_version: "cealctl.doctor.v1",
		command: "cealctl",
		status: "surface_ready",
		proof_level: "surface",
		binary: { status: "ready", version: CEAL_OPERATOR_CLI_VERSION },
		protocol: {
			status: "ready",
			version: CEAL_PROTOCOL_VERSION,
			supported_gateway_protocol_range: CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE,
		},
		setup: { status: "not_checked" },
		runtime: { status: "not_checked" },
		credential_context: CEALCTL_CREDENTIAL_CONTEXT,
		writes_local_state: false,
		writes_external: false,
		network_accessed: false,
	});
}

function writeError(kind: "unknown_command" | "invalid_argument", message: string, io: CealctlIo): number {
	writeYaml(io.stdout, {
		schema_version: "cealctl.error.v1",
		command: "cealctl",
		ok: false,
		status: "error",
		credential_context: CEALCTL_CREDENTIAL_CONTEXT,
		error: { kind, message, next_action: "Run 'cealctl --help'." },
	});
	return 2;
}

function writeHelp(help: string, io: CealctlIo): number {
	io.stdout.write(`${help}\n`);
	return 0;
}

function isHelpToken(value: string | undefined): boolean {
	return value === "-h" || value === "--help";
}

function writeYaml(stream: CealctlIo["stdout"], value: unknown): 0 {
	stream.write(renderPlainYamlDocument(value));
	return 0;
}

export function renderPlainYamlDocument(value: unknown): string {
	assertPlainValue(value, new WeakSet<object>());
	return stringify(value, { aliasDuplicateObjects: false, lineWidth: 0 });
}

function assertPlainValue(value: unknown, seen: WeakSet<object>): void {
	if (isPlainScalar(value)) return;
	if (typeof value !== "object" || value === null) throw new TypeError("YAML results require JSON-compatible values.");
	assertPlainObject(value, seen);
}

function isPlainScalar(value: unknown): boolean {
	return value === null || typeof value === "string" || typeof value === "boolean"
		|| (typeof value === "number" && Number.isFinite(value));
}

function assertPlainObject(value: object, seen: WeakSet<object>): void {
	if (seen.has(value)) throw new TypeError("YAML results cannot contain cycles or shared object references.");
	seen.add(value);
	if (Array.isArray(value)) {
		for (const item of value) assertPlainValue(item, seen);
		return;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError("YAML results require plain mappings.");
	for (const item of Object.values(value)) assertPlainValue(item, seen);
}
