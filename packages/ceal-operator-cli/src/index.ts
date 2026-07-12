import {
	CEAL_PROTOCOL_VERSION,
	CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE,
} from "@corca-ai/ceal-protocol";
import { stringify } from "yaml";

export const CEAL_OPERATOR_CLI_VERSION = "0.64.0" as const;
export const CEALCTL_CREDENTIAL_CONTEXT = "cealctl_operator_admin_profile" as const;

export interface CealctlIo {
	stdout: { write(chunk: string): unknown };
	stderr: { write(chunk: string): unknown };
}

export interface CealctlCommandDefinition {
	name: "version" | "commands" | "doctor";
	description: string;
	usage: string;
	effect: "read_only";
	evidence: "surface";
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
		name: "doctor",
		description: "Check this binary and protocol surface without setup or runtime access.",
		usage: "cealctl doctor",
		effect: "read_only",
		evidence: "surface",
		result_schema: "cealctl.doctor.v1",
		recovery: "Use setup or runtime-specific status commands only after this surface is ready.",
	},
];

const COMMAND_BY_NAME = new Map(CEALCTL_COMMANDS.map((command) => [command.name, command]));
const TOP_LEVEL_HELP = [
	"Usage: cealctl <command> [options]",
	"",
	"Operator-facing Ceal control client. Worker credentials are outside this command surface.",
	"",
	"Commands:",
	...CEALCTL_COMMANDS.map((command) => `  ${command.name.padEnd(14)} ${command.description}`),
	"",
	"Run: cealctl <command> --help",
].join("\n");

export function runCealctlCommand(args: readonly string[], io: CealctlIo): number {
	if (args.length === 0 || (args.length === 1 && (isHelpToken(args[0]) || args[0] === "help"))) {
		return writeHelp(TOP_LEVEL_HELP, io);
	}
	if (args[0] === "help") return writeRequestedHelp(args.slice(1), io);
	const command = COMMAND_BY_NAME.get(args[0] as CealctlCommandDefinition["name"]);
	if (!command) return writeError("unknown_command", "Unknown cealctl command.", io);
	const options = args.slice(1);
	if (options.length === 1 && isHelpToken(options[0])) return writeHelp(commandHelp(command), io);
	if (options.length !== 0) return writeError("invalid_argument", "Invalid cealctl command options.", io);
	return runKnownCommand(command.name, io);
}

function runKnownCommand(command: CealctlCommandDefinition["name"], io: CealctlIo): number {
	if (command === "version") return writeVersion(io);
	if (command === "commands") return writeCommands(io);
	return writeDoctor(io);
}

function writeRequestedHelp(args: readonly string[], io: CealctlIo): number {
	if (args.length !== 1) return writeError("invalid_argument", "Help requires one public command name.", io);
	const command = COMMAND_BY_NAME.get(args[0] as CealctlCommandDefinition["name"]);
	return command ? writeHelp(commandHelp(command), io) : writeError("unknown_command", "Unknown cealctl command.", io);
}

function commandHelp(command: CealctlCommandDefinition): string {
	return [
		`Usage: ${command.usage}`,
		"",
		command.description,
		"",
		`Effect: ${command.effect}`,
		`Evidence: ${command.evidence}`,
		`Result schema: ${command.result_schema}`,
		`Recovery/readback: ${command.recovery}`,
		"",
		"Options:",
		"  -h, --help  Show this help without performing work.",
	].join("\n");
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
