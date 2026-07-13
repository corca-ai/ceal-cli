import {
	CEAL_GATEWAY_POLICY_DENIAL_MESSAGE,
	CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION,
	CEAL_PROTOCOL_VERSION,
	CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE,
} from "@corca-ai/ceal-protocol";
import {
	CealHttpTransportError,
	createCealClient,
	createCealHttpTransport,
} from "@corca-ai/ceal";
import { stringify } from "yaml";

const CEAL_PACKAGE_VERSION = "0.64.0" as const;
const CREDENTIAL_CONTEXT = "gateway_issued_client_profile" as const;
const PROTOCOL_VERSION = CEAL_PROTOCOL_VERSION;

export interface CealCliIo {
	stdout: { write(chunk: string): unknown };
	stderr: { write(chunk: string): unknown };
}

export interface CealCommandRuntime {
	readSecret?: () => Promise<string>;
}

export interface CealCommandDefinition {
	name: "version" | "commands" | "capabilities";
	description: string;
	usage: string;
	effect: "read_only";
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
		name: "capabilities",
		description: "Discover Gateway-issued capabilities.",
		usage: "ceal capabilities",
		effect: "read_only",
		evidence: "surface_or_host_decision",
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

export async function runCealCommand(args: readonly string[], io: CealCliIo, runtime: CealCommandRuntime = {}): Promise<number> {
	if (args.length === 0 || (args.length === 1 && (isHelpToken(args[0]) || args[0] === "help"))) {
		return writeHelp(TOP_LEVEL_HELP, io);
	}
	if (args[0] === "help") return writeRequestedHelp(args.slice(1), io);
	const command = COMMAND_BY_NAME.get(args[0] as CealCommandDefinition["name"]);
	if (!command) return writeError("unknown_command", "Unknown ceal command.", io);
	const options = args.slice(1);
	if (options.length === 1 && isHelpToken(options[0])) return writeHelp(commandHelp(command), io);
	if (options.length !== 0 && command.name !== "capabilities") return writeError("invalid_argument", "Invalid ceal command options.", io);
	return runKnownCommand(command.name, options, io, runtime);
}

async function runKnownCommand(
	command: CealCommandDefinition["name"],
	options: readonly string[],
	io: CealCliIo,
	runtime: CealCommandRuntime,
): Promise<number> {
	if (command === "version") return writeVersion(io);
	if (command === "commands") return writeCommands(io);
	return runCapabilities(options, io, runtime);
}

function writeRequestedHelp(args: readonly string[], io: CealCliIo): number {
	if (args.length !== 1) return writeError("invalid_argument", "Help requires one public command name.", io);
	const command = COMMAND_BY_NAME.get(args[0] as CealCommandDefinition["name"]);
	return command ? writeHelp(commandHelp(command), io) : writeError("unknown_command", "Unknown ceal command.", io);
}

function commandHelp(command: CealCommandDefinition): string {
	const options = command.name === "capabilities"
		? [
			"  --endpoint <https-url>  Gateway client endpoint.",
			"  --profile <profile-ref> Gateway-issued profile reference.",
			"  --request-id <safe-id>  Correlation prefix for handshake and discovery.",
			"  --token-stdin            Read the Gateway-issued client token from stdin.",
		]
		: [];
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

async function runCapabilities(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	if (options.length === 0) return writeCapabilitiesUnavailable(io);
	const parsed = parseGatewayOptions(options);
	if (!parsed.ok) return writeError("invalid_argument", parsed.message, io);
	if (!runtime.readSecret) return writeGatewayUnavailable("credential_input_unavailable", io);
	let accessToken: string;
	try {
		accessToken = await runtime.readSecret();
	} catch {
		return writeGatewayUnavailable("credential_input_failed", io);
	}
	try {
		const client = createCealClient(createCealHttpTransport({ endpoint: parsed.endpoint, accessToken }));
		const handshake = await client.request({
			request_id: `${parsed.requestId}:handshake`,
			operation: "handshake",
			profile_ref: parsed.profileRef,
			body: { client: { name: "ceal", version: CEAL_PACKAGE_VERSION } },
		});
		if (!handshake.ok) return writeGatewayFailure(handshake, io);
		const discovery = await client.request({
			request_id: `${parsed.requestId}:discover`,
			operation: "discover",
			profile_ref: parsed.profileRef,
			body: {},
		});
		if (!discovery.ok) return writeGatewayFailure(discovery, io);
		return writeYaml(io.stdout, {
			schema_version: "ceal.capabilities.v1",
			command: "ceal",
			status: "available",
			gateway_required: true,
			credential_context: CREDENTIAL_CONTEXT,
			gateway: {
				profile_ref: handshake.value.profile_ref,
				registration_ref: handshake.value.registration_ref,
				client_ref: handshake.value.client_ref,
				runner_ref: handshake.value.runner_ref,
				negotiated_protocol_version: handshake.value.negotiated_protocol_version,
				host_decision: handshake.value.host_decision,
			},
			capabilities: discovery.value.capabilities,
			targets: discovery.value.targets,
			proof_level: discovery.value.proof_level,
			live_gateway_checked: true,
			claims_allowed: ["gateway_handshake", "gateway_discovery"],
			non_claims: discovery.value.non_claims,
			request_ids: {
				handshake: handshake.request_id,
				discovery: discovery.request_id,
			},
		});
	} catch (error) {
		const reason = error instanceof CealHttpTransportError ? error.code : "request_failed";
		return writeGatewayUnavailable(reason, io);
	}
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
	const values: { endpoint?: string; profileRef?: string; requestId?: string; tokenStdin: boolean } = { tokenStdin: false };
	for (let index = 0; index < options.length; index += 1) {
		const option = options[index];
		if (option === "--token-stdin") {
			if (values.tokenStdin) return invalidGatewayOptions();
			values.tokenStdin = true;
			continue;
		}
		const value = options[++index];
		if (!value) return invalidGatewayOptions();
		if (option === "--endpoint" && values.endpoint === undefined) values.endpoint = value;
		else if (option === "--profile" && values.profileRef === undefined) values.profileRef = value;
		else if (option === "--request-id" && values.requestId === undefined) values.requestId = value;
		else return invalidGatewayOptions();
	}
	if (!values.endpoint || !values.profileRef || !values.requestId || !values.tokenStdin) return invalidGatewayOptions();
	if (!/^profile:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(values.profileRef)) return invalidGatewayOptions();
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,117}$/u.test(values.requestId)) return invalidGatewayOptions();
	return { ok: true, endpoint: values.endpoint, profileRef: values.profileRef, requestId: values.requestId };
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

interface SafeGatewayFailure {
	code: string;
	message: string;
	nextAction: string;
	denial: boolean;
}

function classifyGatewayFailure(error: unknown): SafeGatewayFailure {
	const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
	if (code === "policy_denied") {
		return { code, message: CEAL_GATEWAY_POLICY_DENIAL_MESSAGE, nextAction: CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION, denial: true };
	}
	if (code === "authentication_failed") {
		return {
			code,
			message: "The Gateway rejected the client credential.",
			nextAction: "Obtain a current Gateway-issued client profile and retry.",
			denial: true,
		};
	}
	if (code === "profile_binding_denied") {
		return {
			code,
			message: "The Gateway rejected the requested profile binding.",
			nextAction: "Use the profile bound to this Gateway-issued credential and retry.",
			denial: true,
		};
	}
	if (code === "incompatible_protocol") {
		return {
			code,
			message: "The Ceal client and Gateway protocol versions are incompatible.",
			nextAction: "Upgrade the Ceal client or Gateway to compatible releases.",
			denial: false,
		};
	}
	return {
		code: "gateway_request_failed",
		message: "The Gateway rejected the capability request.",
		nextAction: "Check Gateway status and audit readback, then retry with a new request ID.",
		denial: false,
	};
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
			next_action: "Check network reachability, TLS, and the Gateway-issued client profile, then retry.",
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
