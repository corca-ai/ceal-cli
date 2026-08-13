import type { CealCliIo } from "./cli-runtime.js";
import { CEAL_COMMANDS, CEAL_CREDENTIAL_CONTEXT, type CealCommandDefinition } from "./command-definitions.js";
import { writeHelp, writeYaml } from "./output.js";
import { CEAL_SUBCOMMANDS, type CealSubcommandDefinition, splitSubcommandRoute, subcommandsOf } from "./subcommands.js";

const COMMAND_BY_NAME = new Map(CEAL_COMMANDS.map((command) => [command.name, command]));

const TOP_LEVEL_HELP = [
	"Usage: ceal [--timing] <command> [options]",
	"",
	"Worker-facing Ceal client. Organization authority and credentials remain with the Gateway.",
	"Named options follow required positionals, are order-independent, and may be supplied once.",
	"Prefix a public command with --timing to emit secret-free phase timing as JSON Lines on stderr.",
	"",
	"Commands:",
	...CEAL_COMMANDS.map((command) => `  ${command.name.padEnd(14)} ${command.description}`),
	"",
	"Run: ceal <command> --help",
].join("\n");

/**
 * Handles commands whose answer depends only on the declared CLI surface.
 * Returning undefined is the explicit handoff to the stateful dispatcher.
 */
export async function runCealStaticCommand(args: readonly string[], io: CealCliIo): Promise<number | undefined> {
	if (topLevelHelpRequested(args)) return writeHelp(TOP_LEVEL_HELP, io);
	if (args[0] === "help") return writeRequestedHelp(args.slice(1), io);
	const command = findCealCommand(args[0]);
	if (!command) return writeCliError("unknown_command", "Unknown ceal command.", io);
	const options = args.slice(1);
	const requestedHelp = helpRequest(command, options);
	if (requestedHelp !== undefined) return writeHelp(requestedHelp, io);
	if (!commandAcceptsOptions(command.name, options))
		return writeCliError("invalid_argument", "Invalid ceal command options.", io, `Run 'ceal ${command.name} --help'.`);
	if (command.name === "version") {
		const { writeVersion } = await import("./version-surface.js");
		return writeVersion(io);
	}
	if (command.name === "commands") return writeCommands(io);
	return undefined;
}

export function findCealCommand(name: string | undefined): CealCommandDefinition | undefined {
	return COMMAND_BY_NAME.get(name as CealCommandDefinition["name"]);
}

// Read a command's recovery line by the name it is about. A positional index is
// how the wrong one shipped: insertion moved the meaning without a type error.
export function commandRecovery(name: CealCommandDefinition["name"]): string {
	const command = findCealCommand(name);
	if (!command) throw new Error(`no ceal command is named ${name}`);
	return command.recovery;
}

export function writeCliError(
	kind: "unknown_command" | "invalid_argument" | "selector_not_supported",
	message: string,
	io: CealCliIo,
	nextAction = "Run 'ceal --help'.",
): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.error.v1",
		command: "ceal",
		ok: false,
		status: "error",
		credential_context: CEAL_CREDENTIAL_CONTEXT,
		error: { kind, message, next_action: nextAction },
	});
	return 2;
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

function helpRequest(command: CealCommandDefinition, options: readonly string[]): string | undefined {
	if (!options.some(isHelpToken)) return undefined;
	const { subcommand } = splitSubcommandRoute(command.name, options);
	return subcommand ? subcommandHelp(subcommand) : commandHelp(command);
}

function writeRequestedHelp(args: readonly string[], io: CealCliIo): number {
	if (args.length === 0) return writeCliError("invalid_argument", "Help requires one public command name.", io);
	const command = findCealCommand(args[0]);
	if (!command) return writeCliError("unknown_command", "Unknown ceal command.", io);
	if (args.length === 1) return writeHelp(commandHelp(command), io);
	const { subcommand, rest } = splitSubcommandRoute(command.name, args.slice(1));
	return subcommand && rest.length === 0
		? writeHelp(subcommandHelp(subcommand), io)
		: writeCliError(
				"invalid_argument",
				"Help requires one public command name or subcommand route.",
				io,
				`Run 'ceal ${command.name}${subcommand ? ` ${subcommand.route.join(" ")}` : ""} --help'.`,
			);
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
		...(command.lifecycle ? [`Lifecycle: ${command.lifecycle}`] : []),
		`Evidence: ${command.evidence}`,
		`Result schema: ${command.result_schema}`,
		`Recovery/readback: ${command.recovery}`,
		"",
		...(subcommands.length === 0
			? []
			: ["Subcommands:", ...subcommandRows(subcommands), `Run: ceal ${command.name} <subcommand> --help for that leaf's own contract.`, ""]),
		"Options:",
		...options,
		"  --timing    Global diagnostic option; place immediately after 'ceal' and before the command.",
		"  -h, --help  Show this help without performing work.",
	].join("\n");
}

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
		"  --timing    Global diagnostic option; place immediately after 'ceal' and before the command.",
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
			"  --request-ref <ref>     'receipt.request_ref' from a completed 'ceal call'; embeds its Gateway-audit readback.",
			"  --profile <profile-ref> Select one assigned Profile for this read without re-login.",
			"                          This readback does not establish provider state and never performs a provider call.",
		];
	if (name === "observe")
		return [
			"  --port <0|1024-65535>  Loopback port to serve (default: 52897; 0 selects an ephemeral port).",
			"                          Serves cached session/capability/install/guide state and spooled call-outcome metadata.",
			"                          No admin surface, no provider credentials, no live refresh.",
		];
	return [];
}

function writeCommands(io: CealCliIo): number {
	return writeYaml(io.stdout, {
		schema_version: "ceal.commands.v1",
		command: "ceal",
		ok: true,
		credential_context: CEAL_CREDENTIAL_CONTEXT,
		commands: CEAL_COMMANDS,
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

function isHelpToken(value: string | undefined): boolean {
	return value === "--help" || value === "-h";
}
