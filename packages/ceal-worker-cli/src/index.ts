import {
	CEAL_PROTOCOL_VERSION,
	CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE,
} from "@corca-ai/ceal-protocol";
import { stringify } from "yaml";

const CEAL_PACKAGE_VERSION = "0.64.0" as const;
const CREDENTIAL_CONTEXT = "gateway_issued_client_profile" as const;
const PROTOCOL_VERSION = CEAL_PROTOCOL_VERSION;

export interface CealCliIo {
	stdout: { write(chunk: string): unknown };
	stderr: { write(chunk: string): unknown };
}

export interface CealCommandDefinition {
	name: "version" | "commands" | "capabilities";
	description: string;
	usage: string;
	effect: "read_only";
	evidence: "surface";
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
		name: "capabilities",
		description: "Discover Gateway-issued capabilities.",
		usage: "ceal capabilities",
		effect: "read_only",
		evidence: "surface",
		result_schema: "ceal.capabilities.v1",
		recovery: "Configure a Gateway-issued client profile, then run 'ceal capabilities' again.",
	},
];

const COMMAND_BY_NAME = new Map(CEAL_COMMANDS.map((command) => [command.name, command]));
const TOP_LEVEL_HELP = [
	"Usage: ceal <command> [options]",
	"",
	"Worker-facing Ceal client. Organization authority and credentials remain with the Gateway.",
	"",
	"Commands:",
	...CEAL_COMMANDS.map((command) => `  ${command.name.padEnd(14)} ${command.description}`),
	"",
	"Run: ceal <command> --help",
].join("\n");

export function runCealCommand(args: readonly string[], io: CealCliIo): number {
	if (args.length === 0 || (args.length === 1 && (isHelpToken(args[0]) || args[0] === "help"))) {
		return writeHelp(TOP_LEVEL_HELP, io);
	}
	if (args[0] === "help") return writeRequestedHelp(args.slice(1), io);
	const command = COMMAND_BY_NAME.get(args[0] as CealCommandDefinition["name"]);
	if (!command) return writeError("unknown_command", "Unknown ceal command.", io);
	const options = args.slice(1);
	if (options.length === 1 && isHelpToken(options[0])) return writeHelp(commandHelp(command), io);
	if (options.length !== 0) return writeError("invalid_argument", "Invalid ceal command options.", io);
	return runKnownCommand(command.name, io);
}

function runKnownCommand(command: CealCommandDefinition["name"], io: CealCliIo): number {
	if (command === "version") return writeVersion(io);
	if (command === "commands") return writeCommands(io);
	return writeCapabilities(io);
}

function writeRequestedHelp(args: readonly string[], io: CealCliIo): number {
	if (args.length !== 1) return writeError("invalid_argument", "Help requires one public command name.", io);
	const command = COMMAND_BY_NAME.get(args[0] as CealCommandDefinition["name"]);
	return command ? writeHelp(commandHelp(command), io) : writeError("unknown_command", "Unknown ceal command.", io);
}

function commandHelp(command: CealCommandDefinition): string {
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
	});
}

function writeCapabilities(io: CealCliIo): number {
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

function writeHelp(help: string, io: CealCliIo): number {
	io.stdout.write(`${help}\n`);
	return 0;
}

function isHelpToken(value: string | undefined): boolean {
	return value === "--help" || value === "-h";
}

function writeYaml(stream: CealCliIo["stdout"], value: unknown): 0 {
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
