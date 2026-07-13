import {
	CEAL_PROTOCOL_VERSION,
	CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE,
} from "@corca-ai/ceal-protocol";
import { stringify } from "yaml";
import { CealEnrollmentAdminClientError, createCealEnrollment } from "./enrollment-admin-client.js";

export const CEAL_OPERATOR_CLI_VERSION = "0.64.0" as const;
export const CEALCTL_CREDENTIAL_CONTEXT = "cealctl_operator_admin_profile" as const;

export interface CealctlIo {
	stdout: { write(chunk: string): unknown };
	stderr: { write(chunk: string): unknown };
}

export interface CealctlRuntime {
	readSecret?: () => Promise<string>;
}

export interface CealctlCommandDefinition {
	name: "version" | "commands" | "doctor" | "enrollments";
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
		name: "enrollments",
		description: "Create one-time personal-client enrollment material.",
		usage: "cealctl enrollments create [options]",
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

export function runCealctlCommand(args: readonly string[], io: CealctlIo, runtime: CealctlRuntime = {}): number | Promise<number> {
	if (args.length === 0 || (args.length === 1 && (isHelpToken(args[0]) || args[0] === "help"))) {
		return writeHelp(TOP_LEVEL_HELP, io);
	}
	if (args[0] === "help") return writeRequestedHelp(args.slice(1), io);
	const command = COMMAND_BY_NAME.get(args[0] as CealctlCommandDefinition["name"]);
	if (!command) return writeError("unknown_command", "Unknown cealctl command.", io);
	const options = args.slice(1);
	if (options.length === 1 && isHelpToken(options[0])) return writeHelp(commandHelp(command), io);
	if (options.length !== 0 && command.name !== "enrollments") return writeError("invalid_argument", "Invalid cealctl command options.", io);
	return runKnownCommand(command.name, options, io, runtime);
}

function runKnownCommand(command: CealctlCommandDefinition["name"], options: readonly string[], io: CealctlIo, runtime: CealctlRuntime): number | Promise<number> {
	if (command === "version") return writeVersion(io);
	if (command === "commands") return writeCommands(io);
	if (command === "enrollments") return runEnrollments(options, io, runtime);
	return writeDoctor(io);
}

function writeRequestedHelp(args: readonly string[], io: CealctlIo): number {
	if (args.length !== 1) return writeError("invalid_argument", "Help requires one public command name.", io);
	const command = COMMAND_BY_NAME.get(args[0] as CealctlCommandDefinition["name"]);
	return command ? writeHelp(commandHelp(command), io) : writeError("unknown_command", "Unknown cealctl command.", io);
}

function commandHelp(command: CealctlCommandDefinition): string {
	const options = command.name === "enrollments" ? [
		"  create                         Create one short-lived, one-time enrollment code.",
		"  --admin-endpoint <https-url>  Gateway administrator API endpoint.",
		"  --gateway <https-url>         Client endpoint given to the enrolling user.",
		"  --name <safe-name>            Registration, client, and runner name.",
		"  --profile <safe-name>         Profile name bound by the Gateway.",
		"  --subject <safe-name>         User identity bound by the Gateway.",
		"  --instance <safe-name>        Customer instance bound by the Gateway.",
		"  --admin-token-stdin           Read the administrator session from stdin.",
	] : [];
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
		...options,
		"  -h, --help  Show this help without performing work.",
	].join("\n");
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
	if (!runtime.readSecret) return writeEnrollmentFailure("credential_input_unavailable", io);
	let adminToken: string;
	try { adminToken = await runtime.readSecret(); } catch { return writeEnrollmentFailure("credential_input_failed", io); }
	try {
		const result = await createCealEnrollment({
			adminEndpoint: parsed.adminEndpoint,
			adminToken,
			profileRef: `profile:${parsed.profile}`,
			registrationRef: `registration:${parsed.name}`,
			clientRef: `client:${parsed.name}`,
			runnerRef: `runner:${parsed.name}`,
			subjectRef: `subject:${parsed.subject}`,
			instanceRef: `instance:${parsed.instance}`,
		});
		return writeYaml(io.stdout, {
			schema_version: "cealctl.enrollment_created.v1",
			command: "cealctl",
			status: "created",
			gateway_endpoint: parsed.gateway,
			enrollment_code: result.code,
			expires_at: result.expiresAt,
			one_time: true,
			credential_context: CEALCTL_CREDENTIAL_CONTEXT,
			proof_level: "host_decision",
			next_action: `On the user machine, send this code through stdin to 'ceal profiles enroll --gateway ${parsed.gateway} --code-stdin'.`,
		});
	} catch (error) {
		return writeEnrollmentFailure(error instanceof CealEnrollmentAdminClientError ? error.code : "request_failed", io);
	}
}

interface ParsedEnrollmentCreateOptions {
	adminEndpoint: string;
	gateway: string;
	name: string;
	profile: string;
	subject: string;
	instance: string;
}

function parseEnrollmentCreateOptions(options: readonly string[]): ParsedEnrollmentCreateOptions | null {
	if (options[0] !== "create") return null;
	const values = new Map<string, string>();
	let tokenStdin = false;
	for (let index = 1; index < options.length; index += 1) {
		const option = options[index];
		if (option === "--admin-token-stdin") { if (tokenStdin) return null; tokenStdin = true; continue; }
		if (!option || !new Set(["--admin-endpoint", "--gateway", "--name", "--profile", "--subject", "--instance"]).has(option) || values.has(option)) return null;
		const value = options[++index];
		if (!value) return null;
		values.set(option, value);
	}
	if (!tokenStdin || values.size !== 6) return null;
	const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
	for (const option of ["--name", "--profile", "--subject", "--instance"]) if (!safeName.test(values.get(option) ?? "")) return null;
	const gateway = values.get("--gateway") ?? "";
	if (!safeGatewayEndpoint(gateway)) return null;
	return {
		adminEndpoint: values.get("--admin-endpoint") ?? "",
		gateway,
		name: values.get("--name") ?? "",
		profile: values.get("--profile") ?? "",
		subject: values.get("--subject") ?? "",
		instance: values.get("--instance") ?? "",
	};
}

function safeGatewayEndpoint(value: string): boolean {
	try {
		const endpoint = new URL(value);
		const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
		return !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash
			&& (endpoint.protocol === "https:" || (endpoint.protocol === "http:" && (host === "127.0.0.1" || host === "::1")));
	} catch { return false; }
}

function writeEnrollmentFailure(kind: string, io: CealctlIo): number {
	writeYaml(io.stdout, {
		schema_version: "cealctl.enrollment_created.v1", command: "cealctl", status: "unavailable", proof_level: "surface",
		credential_context: CEALCTL_CREDENTIAL_CONTEXT,
		error: { kind, message: "The Gateway enrollment code could not be created.", next_action: "Check the administrator session and Gateway status, then retry." },
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
