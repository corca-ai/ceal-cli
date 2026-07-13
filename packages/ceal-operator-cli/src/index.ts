import {
	CEAL_PROTOCOL_VERSION,
	CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE,
} from "@corca-ai/ceal-protocol";
import { stringify } from "yaml";
import { CealEnrollmentAdminClientError, createCealEnrollment } from "./enrollment-admin-client.js";
import {
	currentOperatorSession,
	operatorProfilesPayload,
	OperatorSessionStoreError,
	redactSession,
	removeOperatorSession,
	saveOperatorSession,
	selectOperatorSession,
} from "./operator-session-store.js";
import {
	loginOperator,
	OperatorSessionClientError,
	refreshOperatorSession,
	revokeOperatorSession,
} from "./operator-session-client.js";

export const CEAL_OPERATOR_CLI_VERSION = "0.64.0" as const;
export const CEALCTL_CREDENTIAL_CONTEXT = "cealctl_operator_admin_profile" as const;

export interface CealctlIo {
	stdout: { write(chunk: string): unknown };
	stderr: { write(chunk: string): unknown };
}

export interface CealctlRuntime {
	homeDir?: string;
	fetchFn?: typeof globalThis.fetch;
	sleepFn?: (milliseconds: number) => Promise<void>;
}

export interface CealctlCommandDefinition {
	name: "version" | "commands" | "login" | "profiles" | "logout" | "enrollments" | "doctor";
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
		description: "Authenticate this operator through the Gateway Admin API.",
		usage: "cealctl login <admin-url> [--profile <name>]",
		effect: "control_write",
		evidence: "host_decision",
		result_schema: "cealctl.login.v1",
		recovery: "Approve the displayed code in the same-origin browser page, then retry if it expires.",
	},
	{
		name: "profiles",
		description: "Inspect or select stored operator profiles without exposing tokens.",
		usage: "cealctl profiles [use <name>]",
		effect: "control_write",
		evidence: "surface",
		result_schema: "cealctl.profiles.v1",
		recovery: "Run 'cealctl login <admin-url> --profile <name>' when no profile exists.",
	},
	{
		name: "logout",
		description: "Revoke one operator session before removing its local profile.",
		usage: "cealctl logout [--profile <name>]",
		effect: "control_write",
		evidence: "host_decision",
		result_schema: "cealctl.logout.v1",
		recovery: "If revoke fails, preserve local state and retry after checking Gateway reachability.",
	},
	{
		name: "enrollments",
		description: "Create one-time personal-client enrollment material.",
		usage: "cealctl enrollments create --name <name> --profile <name> --subject <name> --instance <name> [--operator-profile <name>]",
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
	return runKnownCommand(command.name, options, io, runtime);
}

function runKnownCommand(command: CealctlCommandDefinition["name"], options: readonly string[], io: CealctlIo, runtime: CealctlRuntime): number | Promise<number> {
	if (command === "version") return options.length === 0 ? writeVersion(io) : writeError("invalid_argument", "Invalid cealctl version options.", io);
	if (command === "commands") return options.length === 0 ? writeCommands(io) : writeError("invalid_argument", "Invalid cealctl commands options.", io);
	if (command === "login") return runLogin(options, io, runtime);
	if (command === "profiles") return runProfiles(options, io, runtime);
	if (command === "logout") return runLogout(options, io, runtime);
	if (command === "enrollments") return runEnrollments(options, io, runtime);
	if (options.length !== 0) return writeError("invalid_argument", "Invalid cealctl command options.", io);
	return writeDoctor(io);
}

function writeRequestedHelp(args: readonly string[], io: CealctlIo): number {
	if (args.length !== 1) return writeError("invalid_argument", "Help requires one public command name.", io);
	const command = COMMAND_BY_NAME.get(args[0] as CealctlCommandDefinition["name"]);
	return command ? writeHelp(commandHelp(command), io) : writeError("unknown_command", "Unknown cealctl command.", io);
}

function commandHelp(command: CealctlCommandDefinition): string {
	const options = command.name === "login" ? [
		"  <admin-url>                   Canonical HTTPS organization or instance Admin API base.",
		"  --profile <safe-name>         Local operator profile name (default: default).",
	] : command.name === "profiles" ? [
		"  use <safe-name>               Select one stored operator profile.",
	] : command.name === "logout" ? [
		"  --profile <safe-name>         Revoke a named profile instead of the current profile.",
	] : command.name === "enrollments" ? [
		"  create                         Create one short-lived, one-time enrollment code.",
		"  --name <safe-name>            Registration, client, and runner name.",
		"  --profile <safe-name>         Profile name bound by the Gateway.",
		"  --subject <safe-name>         User identity bound by the Gateway.",
		"  --instance <safe-name>        Customer instance bound by the Gateway.",
		"  --operator-profile <name>     Use a named stored admin profile.",
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

async function runLogin(options: readonly string[], io: CealctlIo, runtime: CealctlRuntime): Promise<number> {
	if (options.length === 0) {
		return writeYaml(io.stdout, {
			schema_version: "cealctl.login.v1", command: "cealctl", status: "ready", proof_level: "surface",
			credential_context: CEALCTL_CREDENTIAL_CONTEXT, authenticated: false,
			next_action: "Run 'cealctl login <admin-url> --profile <name>'.",
		});
	}
	const parsed = parseLoginOptions(options);
	if (!parsed) return writeError("invalid_argument", "Invalid cealctl login options.", io);
	try {
		const session = await loginOperator({
			adminOrigin: parsed.adminOrigin,
			profile: parsed.profile,
			fetchFn: runtime.fetchFn,
			sleepFn: runtime.sleepFn,
			onChallenge: (challenge) => {
				io.stderr.write(`Open ${challenge.verification_url}\nEnter code: ${challenge.user_code}\nExpires at: ${challenge.expires_at}\nWaiting for approval...\n`);
			},
		});
		saveOperatorSession(session, runtime.homeDir);
		return writeYaml(io.stdout, {
			schema_version: "cealctl.login.v1", command: "cealctl", status: "authenticated",
			profile: redactSession(session), raw_token_visible: false, proof_level: "host_decision",
			next_action: "Run 'cealctl enrollments --help' to issue a personal-client enrollment.",
		});
	} catch (error) {
		return writeSessionFailure("cealctl.login.v1", sessionErrorCode(error), "The operator login could not be completed.", io);
	}
}

function runProfiles(options: readonly string[], io: CealctlIo, runtime: CealctlRuntime): number {
	try {
		if (options.length === 0) return writeYaml(io.stdout, operatorProfilesPayload(runtime.homeDir));
		if (options.length === 2 && options[0] === "use" && options[1]) {
			const session = selectOperatorSession(options[1], runtime.homeDir);
			return writeYaml(io.stdout, {
				schema_version: "cealctl.profiles.v1", command: "cealctl", status: "selected",
				current_profile: session.name, profile: redactSession(session), raw_token_visible: false, proof_level: "local_state",
			});
		}
		return writeError("invalid_argument", "Invalid cealctl profiles options.", io);
	} catch (error) {
		return writeSessionFailure("cealctl.profiles.v1", sessionErrorCode(error), "The operator profile could not be read.", io);
	}
}

async function runLogout(options: readonly string[], io: CealctlIo, runtime: CealctlRuntime): Promise<number> {
	const profile = parseOptionalProfile(options);
	if (profile === null) return writeError("invalid_argument", "Invalid cealctl logout options.", io);
	try {
		const session = currentOperatorSession(runtime.homeDir, profile || undefined);
		await revokeOperatorSession({ session, fetchFn: runtime.fetchFn });
		removeOperatorSession(runtime.homeDir, session.name);
		return writeYaml(io.stdout, {
			schema_version: "cealctl.logout.v1", command: "cealctl", status: "revoked",
			profile: session.name, server_revoked: true, local_profile_removed: true,
			raw_token_visible: false, proof_level: "host_decision",
		});
	} catch (error) {
		return writeSessionFailure("cealctl.logout.v1", sessionErrorCode(error), "The operator session could not be revoked.", io);
	}
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
		const current = currentOperatorSession(runtime.homeDir, parsed.operatorProfile);
		const refreshed = await refreshOperatorSession({ session: current, homeDir: runtime.homeDir, fetchFn: runtime.fetchFn });
		const result = await createCealEnrollment({
			adminEndpoint: `${refreshed.session.admin_api_origin}/api/cealctl/v1/enrollments`,
			adminToken: refreshed.accessToken,
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
			gateway_endpoint: result.gatewayEndpoint,
			enrollment_code: result.code,
			expires_at: result.expiresAt,
			one_time: true,
			sensitive_material_visible: true,
			transfer_warning: "Transfer privately. Do not place this code in logs, tickets, or shared chat.",
			credential_context: CEALCTL_CREDENTIAL_CONTEXT,
			proof_level: "host_decision",
			next_action: `On the user machine, send this code through stdin to 'ceal profiles enroll --gateway ${result.gatewayEndpoint} --code-stdin'.`,
		});
	} catch (error) {
		const code = error instanceof CealEnrollmentAdminClientError ? error.code : sessionErrorCode(error);
		return writeEnrollmentFailure(code, io);
	}
}

interface ParsedEnrollmentCreateOptions {
	name: string;
	profile: string;
	subject: string;
	instance: string;
	operatorProfile?: string;
}

function parseEnrollmentCreateOptions(options: readonly string[]): ParsedEnrollmentCreateOptions | null {
	if (options[0] !== "create") return null;
	const values = new Map<string, string>();
	for (let index = 1; index < options.length; index += 1) {
		const option = options[index];
		if (!option || !new Set(["--name", "--profile", "--subject", "--instance", "--operator-profile"]).has(option) || values.has(option)) return null;
		const value = options[++index];
		if (!value) return null;
		values.set(option, value);
	}
	if (!["--name", "--profile", "--subject", "--instance"].every((option) => values.has(option))) return null;
	const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
	for (const value of values.values()) if (!safeName.test(value)) return null;
	return {
		name: values.get("--name") ?? "",
		profile: values.get("--profile") ?? "",
		subject: values.get("--subject") ?? "",
		instance: values.get("--instance") ?? "",
		operatorProfile: values.get("--operator-profile"),
	};
}

function parseLoginOptions(options: readonly string[]): { adminOrigin: string; profile: string } | null {
	if (options.length < 1 || !options[0] || options[0].startsWith("-")) return null;
	let profile = "default";
	for (let index = 1; index < options.length; index += 1) {
		if (options[index] !== "--profile" || !options[index + 1] || index + 2 !== options.length) return null;
		profile = options[index + 1] ?? "";
		index += 1;
	}
	return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(profile) ? { adminOrigin: options[0], profile } : null;
}

function parseOptionalProfile(options: readonly string[]): string | null {
	if (options.length === 0) return "";
	if (options.length !== 2 || options[0] !== "--profile" || !options[1]) return null;
	return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(options[1]) ? options[1] : null;
}

function sessionErrorCode(error: unknown): string {
	if (error instanceof OperatorSessionClientError || error instanceof OperatorSessionStoreError) return error.code;
	return "request_failed";
}

function writeSessionFailure(schemaVersion: string, kind: string, message: string, io: CealctlIo): number {
	writeYaml(io.stdout, {
		schema_version: schemaVersion, command: "cealctl", status: "unavailable", proof_level: "surface",
		credential_context: CEALCTL_CREDENTIAL_CONTEXT, raw_token_visible: false,
		error: { kind, message, next_action: "Check the Admin API URL, operator approval, stored profile, and Gateway status, then retry." },
	});
	return 3;
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
