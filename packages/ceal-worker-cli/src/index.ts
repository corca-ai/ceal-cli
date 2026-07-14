import { CEAL_PROTOCOL_VERSION, CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE } from "@corca-ai/ceal-protocol";
import type {
	CealClientRefreshResult,
	CealGatewayCallValue,
	CealGatewayDiscoveryValue,
	CealGatewayHandshakeValue,
} from "@corca-ai/ceal-protocol";
import {
	CealEnrollmentClientError,
	CealHttpTransportError,
	CealPersonalClientSessionError,
	createCealClient,
	createCealEnrollmentClient,
	createCealHttpTransport,
	createCealPersonalClientSessionClient,
} from "@corca-ai/ceal";
import type { CealStoredSession } from "./profile-store.js";
import { writeHelp, writeYaml } from "./output.js";
import {
	classifyGatewayFailure,
	gatewayFailureCode,
	type CealParsedCapabilityCall,
	writeCallCompleted,
	writeCallGatewayFailure,
	writeCallIncomplete,
	writeCallUnavailable,
} from "./call-result-output.js";

export { renderPlainYamlDocument } from "./yaml.js";

const CEAL_PACKAGE_VERSION = "0.64.0" as const;
const CREDENTIAL_CONTEXT = "gateway_issued_client_session" as const;
const PROTOCOL_VERSION = CEAL_PROTOCOL_VERSION;

export interface CealCliIo {
	stdout: { write(chunk: string): unknown };
	stderr: { write(chunk: string): unknown };
}

export interface CealCommandRuntime {
	readSecret?: () => Promise<string>;
	loadSession?: () => Promise<CealStoredSession | null>;
	saveSession?: (session: CealStoredSession) => Promise<void>;
	removeSession?: () => Promise<void>;
	nextRequestId?: () => string;
	now?: () => number;
}

export interface CealCommandDefinition {
	name: "version" | "commands" | "capabilities" | "session" | "call";
	description: string;
	usage: string;
	effect: "read_only" | "local_write";
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
		name: "session",
		description: "Enroll and inspect this client's renewable Gateway session.",
		usage: "ceal session [enroll --gateway <https-url> --code-stdin | logout]",
		effect: "local_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.client_session.v1",
		recovery: "Ask a Gateway administrator for a new one-time enrollment code, then retry.",
	},
	{
		name: "capabilities",
		description: "Discover Gateway-issued capabilities.",
		usage: "ceal capabilities",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.capabilities.v1",
		recovery: "Configure a Gateway-issued client session, then run 'ceal capabilities' again.",
	},
	{
		name: "call",
		description: "Invoke an approved capability and read back its Gateway audit event.",
		usage: "ceal call <capability-id> --target <target-ref> [key=value ...]",
		effect: "read_only",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.result.v1",
		recovery: "Run 'ceal capabilities', then use one granted capability and target exactly as discovered.",
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
	if (topLevelHelpRequested(args)) return writeHelp(TOP_LEVEL_HELP, io);
	if (args[0] === "help") return writeRequestedHelp(args.slice(1), io);
	const command = COMMAND_BY_NAME.get(args[0] as CealCommandDefinition["name"]);
	if (!command) return writeError("unknown_command", "Unknown ceal command.", io);
	const options = args.slice(1);
	if (options.length === 1 && isHelpToken(options[0])) return writeHelp(commandHelp(command), io);
	if (!commandAcceptsOptions(command.name, options)) return writeError("invalid_argument", "Invalid ceal command options.", io);
	return runKnownCommand(command.name, options, io, runtime);
}

function topLevelHelpRequested(args: readonly string[]): boolean {
	return args.length === 0 || (args.length === 1 && (isHelpToken(args[0]) || args[0] === "help"));
}

function commandAcceptsOptions(command: CealCommandDefinition["name"], options: readonly string[]): boolean {
	return options.length === 0 || command === "capabilities" || command === "session" || command === "call";
}

async function runKnownCommand(
	command: CealCommandDefinition["name"],
	options: readonly string[],
	io: CealCliIo,
	runtime: CealCommandRuntime,
): Promise<number> {
	if (command === "version") return writeVersion(io);
	if (command === "commands") return writeCommands(io);
	if (command === "session") return runSession(options, io, runtime);
	if (command === "call") return runCall(options, io, runtime);
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
		: command.name === "session" ? [
			"  enroll                 Exchange a one-time code for a local session.",
			"  logout                 Revoke and remove the local session.",
			"  --gateway <https-url>  Gateway client endpoint.",
			"  --code-stdin            Read the one-time enrollment code from stdin.",
		] : command.name === "call" ? [
			"  <capability-id>          Capability returned by 'ceal capabilities'.",
			"  --target <target-ref>   Target reference returned by 'ceal capabilities'.",
			"  key=value               Capability input; repeat for each discovered field.",
			"  message.search          Requires query=<text>; optional limit=<1-10>.",
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
	const resolved = await resolveGatewayAccess(options, io, runtime);
	if (!resolved.ok) return resolved.exitCode;
	try {
		const { client, handshake } = await requestCapabilityHandshake(resolved.value, runtime);
		if (!handshake.ok) return writeGatewayFailure(handshake, io);
		const discovery = await client.request({
			request_id: `${resolved.value.requestId}:discover`,
			operation: "discover",
			profile_ref: resolved.value.profileRef,
			body: {},
		});
		if (!discovery.ok) return writeGatewayFailure(discovery, io);
		return writeCapabilitiesAvailable(handshake, discovery, io);
	} catch (error) {
		if (error instanceof CealClientSessionError) return writeClientSessionUnavailable(error.code, io);
		const reason = error instanceof CealHttpTransportError ? error.code : "request_failed";
		return writeGatewayUnavailable(reason, io);
	}
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
	return options.length === 0 ? resolveStoredGatewayAccess(io, runtime) : resolveExplicitGatewayAccess(options, io, runtime);
}

async function resolveStoredGatewayAccess(io: CealCliIo, runtime: CealCommandRuntime): Promise<GatewayAccessResolution> {
	if (!runtime.loadSession) return { ok: false, exitCode: writeCapabilitiesUnavailable(io) };
	try {
		const loaded = await runtime.loadSession();
		const session = loaded ? await ensureCurrentSession(loaded, runtime) : null;
		if (!session) return { ok: false, exitCode: writeCapabilitiesUnavailable(io) };
		return { ok: true, value: {
			endpoint: session.gatewayEndpoint, profileRef: session.profileRef, accessToken: session.accessToken,
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

function writeCapabilitiesAvailable(
	handshake: { request_id: string; value: CealGatewayHandshakeValue },
	discovery: { request_id: string; value: CealGatewayDiscoveryValue },
	io: CealCliIo,
): number {
	return writeYaml(io.stdout, {
		schema_version: "ceal.capabilities.v1", command: "ceal", status: "available", gateway_required: true,
		credential_context: CREDENTIAL_CONTEXT,
		gateway: {
			profile_ref: handshake.value.profile_ref, membership_ref: handshake.value.membership_ref,
			registration_ref: handshake.value.registration_ref, client_ref: handshake.value.client_ref,
			subject_ref: handshake.value.subject_ref, instance_ref: handshake.value.instance_ref,
			negotiated_protocol_version: handshake.value.negotiated_protocol_version, host_decision: handshake.value.host_decision,
		},
		capabilities: discovery.value.capabilities, targets: discovery.value.targets,
		proof_level: discovery.value.proof_level, live_gateway_checked: true,
		claims_allowed: ["gateway_handshake", "gateway_discovery"], non_claims: discovery.value.non_claims,
		request_ids: { handshake: handshake.request_id, discovery: discovery.request_id },
	});
}

async function runCall(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	const parsed = parseCallOptions(options);
	if (!parsed.ok) return writeCallValidationFailure(io);
	const resolved = await resolveCallSession(runtime);
	if (!resolved.ok) return writeCallUnavailable(resolved.reason, io, null, parsed);
	const requestId = `${runtime.nextRequestId?.() ?? "ceal:call"}:call`;
	return executeCall(resolved.session, parsed, requestId, io, runtime);
}

async function executeCall(
	initialSession: CealStoredSession,
	parsed: Extract<ParsedCallOptions, { ok: true }>,
	requestId: string,
	io: CealCliIo,
	runtime: CealCommandRuntime,
): Promise<number> {
	let completed: { value: CealGatewayCallValue; events: unknown; session: CealStoredSession } | null = null;
	try {
		const { call, client, session } = await requestCapabilityCall(initialSession, parsed, requestId, runtime);
		if (!call.ok) return writeCallGatewayFailure(call, io, session, parsed, requestId);
		const readback = await client.request({
			request_id: `${runtime.nextRequestId?.() ?? "ceal:readback"}:readback`,
			operation: "readback",
			profile_ref: session.profileRef,
			body: { request_id: requestId },
		});
		if (!readback.ok) return writeCallIncomplete(call.value, requestId, "audit_readback_rejected", io, session, parsed);
		completed = { value: call.value, events: readback.value.events, session };
	} catch (error) {
		if (error instanceof CealClientSessionError) return writeCallUnavailable(error.code, io, initialSession, parsed);
		const reason = error instanceof CealHttpTransportError ? error.code : "request_failed";
		return writeCallUnavailable(reason, io, initialSession, parsed);
	}
	return writeCallCompleted(completed.value, completed.events, requestId, io, completed.session, parsed);
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
	parsed: Extract<ParsedCallOptions, { ok: true }>,
	requestId: string,
	runtime: CealCommandRuntime,
) {
	let session = initialSession;
	let client = createCealClient(createCealHttpTransport({ endpoint: session.gatewayEndpoint, accessToken: session.accessToken }));
	let call = await requestCapability(client, session.profileRef, parsed, requestId);
	if (!shouldRetryAuthentication(call, session)) return { call, client, session };
	session = await ensureCurrentSession(session, runtime, true);
	client = createCealClient(createCealHttpTransport({ endpoint: session.gatewayEndpoint, accessToken: session.accessToken }));
	call = await requestCapability(client, session.profileRef, parsed, requestId);
	return { call, client, session };
}

type ParsedCallOptions = CealParsedCapabilityCall | { ok: false };

function parseCallOptions(options: readonly string[]): ParsedCallOptions {
	if (!validCallPrefix(options)) return { ok: false };
	const capabilityId = options[0];
	const targetRef = options[2];
	if (!validCapabilityId(capabilityId)) return { ok: false };
	if (!validTargetRef(targetRef)) return { ok: false };
	const operands = parseKeyValueOperands(options.slice(3));
	if (!operands) return { ok: false };
	const arguments_ = Object.fromEntries(operands);
	if (capabilityId === "message.search" && !normalizeMessageSearchArguments(arguments_)) return { ok: false };
	return {
		ok: true, capabilityId, targetRef: targetRef as string, arguments: arguments_,
		purpose: `Invoke approved capability '${capabilityId}' for the current task.`,
	};
}

function validCallPrefix(options: readonly string[]): boolean {
	return options.length >= 3 && options.length <= 67 && options[1] === "--target";
}

function validCapabilityId(value: string | undefined): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function validTargetRef(value: string | undefined): boolean {
	return typeof value === "string" && /^target:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(value);
}

function normalizeMessageSearchArguments(arguments_: Record<string, string | number>): boolean {
	if (!Object.keys(arguments_).every((key) => key === "query" || key === "limit")) return false;
	const query = arguments_.query;
	if (typeof query !== "string" || query.trim() === "" || new TextEncoder().encode(query).byteLength > 512) return false;
	const limit = arguments_.limit === undefined ? 5 : Number(arguments_.limit);
	if (!Number.isInteger(limit) || limit < 1 || limit > 10) return false;
	arguments_.limit = limit;
	return true;
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

async function runSession(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	if (options.length === 0) return showSession(io, runtime);
	if (options.length === 1 && options[0] === "logout") return runSessionLogout(io, runtime);
	return enrollSession(options, io, runtime);
}

async function showSession(io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	let session: CealStoredSession | null;
	try { session = runtime.loadSession ? await runtime.loadSession() : null; }
	catch { return writeEnrollmentUnavailable("session_load_failed", io); }
	const now = runtime.now?.() ?? Date.now();
	return writeYaml(io.stdout, session ? configuredSessionSummary(session, now) : unconfiguredSessionSummary());
}

function configuredSessionSummary(session: CealStoredSession, now: number): Record<string, unknown> {
	return {
		schema_version: "ceal.client_session.v1", command: "ceal", status: "configured",
		gateway_endpoint: session.gatewayEndpoint, profile_ref: session.profileRef,
		membership_ref: session.membershipRef, registration_ref: session.registrationRef, client_ref: session.clientRef,
		subject_ref: session.subjectRef, instance_ref: session.instanceRef, expires_at: session.expiresAt,
		access_status: Date.parse(session.expiresAt) > now ? "current" : "expired",
		renewal_available: true,
		refresh_token_idle_expires_at: session.refreshTokenIdleExpiresAt,
		refresh_token_absolute_expires_at: session.refreshTokenAbsoluteExpiresAt,
		raw_token_visible: false, proof_level: "local_state",
		next_action: "Run 'ceal capabilities' to verify live Gateway access.",
	};
}

function unconfiguredSessionSummary(): Record<string, unknown> {
	return {
		schema_version: "ceal.client_session.v1", command: "ceal", status: "unconfigured",
		gateway_endpoint: null, profile_ref: null, membership_ref: null, registration_ref: null, client_ref: null,
		subject_ref: null, instance_ref: null, expires_at: null, access_status: null,
		renewal_available: false, refresh_token_idle_expires_at: null, refresh_token_absolute_expires_at: null,
		raw_token_visible: false, proof_level: "local_state", next_action: "Run 'ceal session enroll --help'.",
	};
}

async function enrollSession(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	const parsed = parseEnrollmentOptions(options);
	if (!parsed.ok) return writeError("invalid_argument", "Invalid session enrollment options.", io);
	if (!runtime.readSecret || !runtime.saveSession) return writeEnrollmentUnavailable("session_runtime_unavailable", io);
	let code: string;
	try { code = await runtime.readSecret(); } catch { return writeEnrollmentUnavailable("enrollment_code_input_failed", io); }
	try {
		const response = await createCealEnrollmentClient({ endpoint: parsed.gateway }).exchange(code);
		if (!response.ok) return writeEnrollmentRejected(response.error.code, io);
		const stored = toStoredSession(parsed.gateway, response);
		await runtime.saveSession(stored);
		return writeEnrollmentSuccess(parsed.gateway, stored, io);
	} catch (error) {
		const reason = error instanceof CealEnrollmentClientError ? error.code : "session_save_failed";
		return writeEnrollmentUnavailable(reason, io);
	}
}

function toStoredSession(gatewayEndpoint: string, response: {
	profile_ref: string; membership_ref: string; registration_ref: string; client_ref: string; subject_ref: string;
	instance_ref: string; access_token: string; expires_at: string; refresh_token: string;
	refresh_token_idle_expires_at: string; refresh_token_absolute_expires_at: string;
}): CealStoredSession {
	return {
		gatewayEndpoint, profileRef: response.profile_ref, membershipRef: response.membership_ref,
		registrationRef: response.registration_ref, clientRef: response.client_ref, subjectRef: response.subject_ref,
		instanceRef: response.instance_ref, accessToken: response.access_token, expiresAt: response.expires_at,
		refreshToken: response.refresh_token, refreshTokenIdleExpiresAt: response.refresh_token_idle_expires_at,
		refreshTokenAbsoluteExpiresAt: response.refresh_token_absolute_expires_at,
	};
}

function writeEnrollmentSuccess(gateway: string, response: ReturnType<typeof toStoredSession>, io: CealCliIo): number {
	return writeYaml(io.stdout, {
		schema_version: "ceal.session_enrollment.v1", command: "ceal", status: "enrolled",
		gateway_endpoint: gateway, profile_ref: response.profileRef, membership_ref: response.membershipRef,
		registration_ref: response.registrationRef, client_ref: response.clientRef, subject_ref: response.subjectRef,
		instance_ref: response.instanceRef, expires_at: response.expiresAt,
		renewal_available: true,
		refresh_token_idle_expires_at: response.refreshTokenIdleExpiresAt,
		refresh_token_absolute_expires_at: response.refreshTokenAbsoluteExpiresAt,
		raw_token_visible: false, proof_level: "host_decision",
		next_action: "Run 'ceal capabilities' to verify the stored session, Profile membership, and Gateway binding.",
	});
}


async function runSessionLogout(io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	if (!runtime.loadSession || !runtime.removeSession) return writeEnrollmentUnavailable("session_runtime_unavailable", io);
	let session: CealStoredSession | null;
	try { session = await runtime.loadSession(); } catch { return writeEnrollmentUnavailable("session_load_failed", io); }
	if (!session) return writeAlreadyLoggedOut(io);
	const revokeFailure = await revokeClientSession(session);
	if (revokeFailure) return writeClientSessionUnavailable(revokeFailure, io);
	try { await runtime.removeSession(); } catch { return writeClientSessionUnavailable("session_remove_failed", io); }
	return writeLoggedOut(session, io);
}

function writeAlreadyLoggedOut(io: CealCliIo): number {
	return writeYaml(io.stdout, {
		schema_version: "ceal.session_logout.v1", command: "ceal", status: "already_logged_out",
		server_session_revoked: false, local_session_removed: false, raw_token_visible: false,
		proof_level: "local_state", next_action: "Run 'ceal session enroll --help' to configure a session.",
	});
}

async function revokeClientSession(session: CealStoredSession): Promise<string | null> {
	try {
		const response = await createCealPersonalClientSessionClient({ endpoint: session.gatewayEndpoint }).revoke(session.refreshToken);
		return !response.ok && response.error.code !== "refresh_revoked" ? response.error.code : null;
	} catch (error) {
		return error instanceof CealPersonalClientSessionError ? error.code : "request_failed";
	}
}

function writeLoggedOut(_session: CealStoredSession, io: CealCliIo): number {
	return writeYaml(io.stdout, {
		schema_version: "ceal.session_logout.v1", command: "ceal", status: "logged_out",
		server_session_revoked: true, local_session_removed: true, raw_token_visible: false,
		proof_level: "host_decision",
		next_action: "Run 'ceal session enroll --help' to configure another session.",
	});
}

class CealClientSessionError extends Error {
	constructor(readonly code: string) { super("Ceal client session unavailable."); }
}

async function ensureCurrentSession(session: CealStoredSession, runtime: CealCommandRuntime, force = false): Promise<CealStoredSession> {
	const now = runtime.now?.() ?? Date.now();
	if (!force && sessionIsCurrent(session, now)) return session;
	const refresh = requireRefreshContext(session, runtime, now);
	const response = await refreshSession(session, refresh.token);
	if (!response.ok) throw new CealClientSessionError(response.error.code);
	assertSessionBindings(session, response);
	const rotated = rotatedSession(session, response);
	await refresh.save(rotated);
	return rotated;
}

function sessionIsCurrent(session: CealStoredSession, now: number): boolean {
	return Date.parse(session.expiresAt) > now + 60_000;
}

function requireRefreshContext(
	session: CealStoredSession, runtime: CealCommandRuntime, now: number,
): { token: string; save: NonNullable<CealCommandRuntime["saveSession"]> } {
	if (!runtime.saveSession) throw new CealClientSessionError("reenrollment_required");
	if (Date.parse(session.refreshTokenAbsoluteExpiresAt) <= now) {
		throw new CealClientSessionError("refresh_expired");
	}
	return { token: session.refreshToken, save: runtime.saveSession };
}

async function refreshSession(session: CealStoredSession, refreshToken: string) {
	try {
		return await createCealPersonalClientSessionClient({ endpoint: session.gatewayEndpoint }).refresh(refreshToken);
	} catch (error) {
		throw new CealClientSessionError(error instanceof CealPersonalClientSessionError ? error.code : "request_failed");
	}
}

function assertSessionBindings(session: CealStoredSession, response: CealClientRefreshResult): void {
	const bindings = [
		[response.profile_ref, session.profileRef], [response.membership_ref, session.membershipRef],
		[response.registration_ref, session.registrationRef], [response.client_ref, session.clientRef],
		[response.subject_ref, session.subjectRef], [response.instance_ref, session.instanceRef],
	];
	if (bindings.some(([actual, expected]) => actual !== expected)) throw new CealClientSessionError("binding_changed");
}

function rotatedSession(session: CealStoredSession, response: CealClientRefreshResult): CealStoredSession {
	return {
		...session, accessToken: response.access_token, expiresAt: response.expires_at,
		refreshToken: response.refresh_token,
		refreshTokenIdleExpiresAt: response.refresh_token_idle_expires_at,
		refreshTokenAbsoluteExpiresAt: response.refresh_token_absolute_expires_at,
	};
}

function writeClientSessionUnavailable(reason: string, io: CealCliIo): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.client_session.v1", command: "ceal", status: "unavailable",
		credential_context: CREDENTIAL_CONTEXT, proof_level: "surface", raw_token_visible: false,
		error: {
			kind: reason,
			message: "The stored Gateway session could not be renewed or revoked safely.",
			next_action: "Run 'ceal session' to inspect expiry, then request a new enrollment code if renewal is unavailable.",
		},
	});
	return 3;
}

function parseEnrollmentOptions(options: readonly string[]): { ok: true; gateway: string } | { ok: false } {
	if (options.length !== 4 || options[0] !== "enroll" || options[1] !== "--gateway" || options[3] !== "--code-stdin") return { ok: false };
	return options[2] ? { ok: true, gateway: options[2] } : { ok: false };
}

function writeEnrollmentRejected(code: string, io: CealCliIo): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.session_enrollment.v1",
		command: "ceal",
		status: "denied",
		proof_level: "host_decision",
		error: { code, message: "The Gateway rejected the enrollment code.", next_action: "Ask a Gateway administrator for a new one-time enrollment code." },
	});
	return 3;
}

function writeEnrollmentUnavailable(reason: string, io: CealCliIo): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.session_enrollment.v1",
		command: "ceal",
		status: "unavailable",
		proof_level: "surface",
		error: { kind: reason, message: "The session enrollment could not be completed.", next_action: "Check the Gateway URL and request a new one-time enrollment code." },
	});
	return 3;
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
	if (!parsed || !parsed.flags.has("--token-stdin")) return invalidGatewayOptions();
	const endpoint = parsed.values.get("--endpoint");
	const profileRef = parsed.values.get("--profile");
	const requestId = parsed.values.get("--request-id");
	if (!endpoint || !profileRef || !requestId) return invalidGatewayOptions();
	if (!/^profile:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(profileRef)) return invalidGatewayOptions();
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,117}$/u.test(requestId)) return invalidGatewayOptions();
	return { ok: true, endpoint, profileRef, requestId };
}

function parseNamedOptions(
	options: readonly string[], valueOptions: ReadonlySet<string>, flagOptions: ReadonlySet<string>,
): { values: Map<string, string>; flags: Set<string> } | null {
	const values = new Map<string, string>();
	const flags = new Set<string>();
	for (let index = 0; index < options.length; index += 1) {
		const option = options[index];
		if (flagOptions.has(option)) {
			if (flags.has(option)) return null;
			flags.add(option);
			continue;
		}
		if (!valueOptions.has(option) || values.has(option)) return null;
		const value = options[index + 1];
		if (!value) return null;
		values.set(option, value);
		index += 1;
	}
	return { values, flags };
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
