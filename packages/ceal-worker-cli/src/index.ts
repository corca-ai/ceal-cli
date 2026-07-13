import {
	CEAL_GATEWAY_POLICY_DENIAL_MESSAGE,
	CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION,
	CEAL_PROTOCOL_VERSION,
	CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE,
} from "@corca-ai/ceal-protocol";
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
import type { CealStoredProfile } from "./profile-store.js";
import { writeHelp, writeYaml } from "./output.js";

export { renderPlainYamlDocument } from "./yaml.js";

const CEAL_PACKAGE_VERSION = "0.64.0" as const;
const CREDENTIAL_CONTEXT = "gateway_issued_client_profile" as const;
const PROTOCOL_VERSION = CEAL_PROTOCOL_VERSION;

export interface CealCliIo {
	stdout: { write(chunk: string): unknown };
	stderr: { write(chunk: string): unknown };
}

export interface CealCommandRuntime {
	readSecret?: () => Promise<string>;
	loadProfile?: () => Promise<CealStoredProfile | null>;
	saveProfile?: (profile: CealStoredProfile) => Promise<void>;
	removeProfile?: () => Promise<void>;
	nextRequestId?: () => string;
	now?: () => number;
}

export interface CealCommandDefinition {
	name: "version" | "commands" | "capabilities" | "profiles" | "call";
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
		name: "profiles",
		description: "Enroll and inspect the local Gateway-issued profile.",
		usage: "ceal profiles [enroll --gateway <https-url> --code-stdin | logout]",
		effect: "local_write",
		evidence: "surface_or_host_decision",
		result_schema: "ceal.profiles.v1",
		recovery: "Ask a Gateway administrator for a new one-time enrollment code, then retry.",
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
	return options.length === 0 || command === "capabilities" || command === "profiles" || command === "call";
}

async function runKnownCommand(
	command: CealCommandDefinition["name"],
	options: readonly string[],
	io: CealCliIo,
	runtime: CealCommandRuntime,
): Promise<number> {
	if (command === "version") return writeVersion(io);
	if (command === "commands") return writeCommands(io);
	if (command === "profiles") return runProfiles(options, io, runtime);
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
		: command.name === "profiles" ? [
			"  enroll                 Exchange a one-time code for a local profile.",
			"  logout                 Revoke the renewable session and remove the local profile.",
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
		if (error instanceof CealProfileSessionError) return writeProfileSessionUnavailable(error.code, io);
		const reason = error instanceof CealHttpTransportError ? error.code : "request_failed";
		return writeGatewayUnavailable(reason, io);
	}
}

interface GatewayAccess {
	endpoint: string;
	profileRef: string;
	requestId: string;
	accessToken: string;
	storedProfile: CealStoredProfile | null;
}

type GatewayAccessResolution = { ok: true; value: GatewayAccess } | { ok: false; exitCode: number };

async function resolveGatewayAccess(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<GatewayAccessResolution> {
	return options.length === 0 ? resolveStoredGatewayAccess(io, runtime) : resolveExplicitGatewayAccess(options, io, runtime);
}

async function resolveStoredGatewayAccess(io: CealCliIo, runtime: CealCommandRuntime): Promise<GatewayAccessResolution> {
	if (!runtime.loadProfile) return { ok: false, exitCode: writeCapabilitiesUnavailable(io) };
	try {
		const loaded = await runtime.loadProfile();
		const profile = loaded ? await ensureCurrentProfile(loaded, runtime) : null;
		if (!profile) return { ok: false, exitCode: writeCapabilitiesUnavailable(io) };
		return { ok: true, value: {
			endpoint: profile.gatewayEndpoint, profileRef: profile.profileRef, accessToken: profile.accessToken,
			storedProfile: profile, requestId: runtime.nextRequestId?.() ?? "ceal:capabilities",
		} };
	} catch (error) {
		const exitCode = error instanceof CealProfileSessionError
			? writeProfileSessionUnavailable(error.code, io) : writeGatewayUnavailable("profile_load_failed", io);
		return { ok: false, exitCode };
	}
}

async function resolveExplicitGatewayAccess(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<GatewayAccessResolution> {
	const parsed = parseGatewayOptions(options);
	if (!parsed.ok) return { ok: false, exitCode: writeError("invalid_argument", parsed.message, io) };
	if (!runtime.readSecret) return { ok: false, exitCode: writeGatewayUnavailable("credential_input_unavailable", io) };
	try {
		return { ok: true, value: { ...parsed, accessToken: await runtime.readSecret(), storedProfile: null } };
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
	const storedProfile = access.storedProfile;
	if (!shouldRetryAuthentication(handshake, storedProfile)) return { client, handshake };
	const profile = await ensureCurrentProfile(storedProfile, runtime, true);
	client = createCealClient(createCealHttpTransport({ endpoint: access.endpoint, accessToken: profile.accessToken }));
	handshake = await requestHandshake(client, access);
	return { client, handshake };
}

function shouldRetryAuthentication(
	response: { ok: boolean; error?: unknown }, profile: CealStoredProfile | null,
): profile is CealStoredProfile & { refreshToken: string } {
	return !response.ok && gatewayFailureCode(response.error) === "authentication_failed" && Boolean(profile?.refreshToken);
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
			profile_ref: handshake.value.profile_ref, registration_ref: handshake.value.registration_ref,
			client_ref: handshake.value.client_ref, runner_ref: handshake.value.runner_ref,
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
	const resolved = await resolveCallProfile(runtime);
	if (!resolved.ok) return writeCallUnavailable(resolved.reason, io, null, parsed);
	const requestId = `${runtime.nextRequestId?.() ?? "ceal:call"}:call`;
	return executeCall(resolved.profile, parsed, requestId, io, runtime);
}

async function executeCall(
	initialProfile: CealStoredProfile,
	parsed: Extract<ParsedCallOptions, { ok: true }>,
	requestId: string,
	io: CealCliIo,
	runtime: CealCommandRuntime,
): Promise<number> {
	let completed: { value: CealGatewayCallValue; events: unknown; profile: CealStoredProfile } | null = null;
	try {
		const { call, client, profile } = await requestCapabilityCall(initialProfile, parsed, requestId, runtime);
		if (!call.ok) return writeCallGatewayFailure(call, io, profile, parsed, requestId);
		const readback = await client.request({
			request_id: `${runtime.nextRequestId?.() ?? "ceal:readback"}:readback`,
			operation: "readback",
			profile_ref: profile.profileRef,
			body: { request_id: requestId },
		});
		if (!readback.ok) return writeCallIncomplete(call.value, requestId, "audit_readback_rejected", io, profile, parsed);
		completed = { value: call.value, events: readback.value.events, profile };
	} catch (error) {
		if (error instanceof CealProfileSessionError) return writeCallUnavailable(error.code, io, initialProfile, parsed);
		const reason = error instanceof CealHttpTransportError ? error.code : "request_failed";
		return writeCallUnavailable(reason, io, initialProfile, parsed);
	}
	return writeCallCompleted(completed.value, completed.events, requestId, io, completed.profile, parsed);
}

type CallProfileResolution = { ok: true; profile: CealStoredProfile } | { ok: false; reason: string };

async function resolveCallProfile(runtime: CealCommandRuntime): Promise<CallProfileResolution> {
	if (!runtime.loadProfile) return { ok: false, reason: "profile_unavailable" };
	try {
		const loaded = await runtime.loadProfile();
		const profile = loaded ? await ensureCurrentProfile(loaded, runtime) : null;
		return profile ? { ok: true, profile } : { ok: false, reason: "profile_unavailable" };
	} catch (error) {
		const reason = error instanceof CealProfileSessionError ? error.code : "profile_load_failed";
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
	initialProfile: CealStoredProfile,
	parsed: Extract<ParsedCallOptions, { ok: true }>,
	requestId: string,
	runtime: CealCommandRuntime,
) {
	let profile = initialProfile;
	let client = createCealClient(createCealHttpTransport({ endpoint: profile.gatewayEndpoint, accessToken: profile.accessToken }));
	let call = await requestCapability(client, profile.profileRef, parsed, requestId);
	if (!shouldRetryAuthentication(call, profile)) return { call, client, profile };
	profile = await ensureCurrentProfile(profile, runtime, true);
	client = createCealClient(createCealHttpTransport({ endpoint: profile.gatewayEndpoint, accessToken: profile.accessToken }));
	call = await requestCapability(client, profile.profileRef, parsed, requestId);
	return { call, client, profile };
}

function writeCallCompleted(
	value: CealGatewayCallValue, events: unknown, requestId: string, io: CealCliIo,
	profile: CealStoredProfile, parsed: Extract<ParsedCallOptions, { ok: true }>,
): number {
	const eventRefs = Array.isArray(events) ? events.flatMap((event) => event && typeof event === "object" && "event_ref" in event ? [String(event.event_ref)] : []) : [];
	return writeYaml(io.stdout, {
		schema: "ceal.result.v1", command: "ceal", ok: true, status: "ok", ...resultIdentity(profile),
		request: resultRequest(parsed, requestId), authorization: { result: "allowed" },
		capability_backend_ref: value.capability_backend_ref,
		evidence: { requirement: "gateway_audit", reached: "gateway_audit", refs: [...eventRefs] },
		claim: { allowed: true }, warnings: [], data: value.data,
		audit: { state: "recorded", refs: [...eventRefs] }, redaction: value.redaction,
		usage: { state: "not_applicable", reason: "no_model_or_metered_component" },
		error: null, proof_level: "host_decision", non_claims: value.non_claims,
	});
}

type ParsedCallOptions = {
	ok: true; capabilityId: string; targetRef: string; arguments: Record<string, string | number>; purpose: string;
} | { ok: false };

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

function writeCallGatewayFailure(
	response: { error: unknown; proof_ref_or_unavailable?: unknown }, io: CealCliIo, profile: CealStoredProfile,
	parsed: Extract<ParsedCallOptions, { ok: true }>, requestId: string,
): number {
	const failure = classifyGatewayFailure(response.error);
	const proofRefs = typeof response.proof_ref_or_unavailable === "string" ? [response.proof_ref_or_unavailable] : [];
	writeYaml(io.stdout, {
		schema: "ceal.result.v1", command: "ceal", ok: false, status: failure.denial ? "blocked" : "error",
		...resultIdentity(profile), request: resultRequest(parsed, requestId),
		authorization: { result: failure.denial ? "denied" : "not_evaluated" },
		evidence: { requirement: "gateway_audit", reached: "host_decision", refs: proofRefs },
		claim: { allowed: false }, warnings: [], data: null,
		audit: proofRefs.length ? { state: "recorded", refs: proofRefs } : { state: "unavailable", reason: "readback_not_reached", scope: "runtime" },
		redaction: { state: "unavailable", reason: "capability_did_not_complete", scope: "runtime" },
		usage: { state: "unavailable", reason: "capability_did_not_complete", scope: "runtime" },
		error: { kind: failure.denial ? "authorization_denied" : failure.code, message: failure.message, next_action: failure.nextAction },
		proof_level: "host_decision",
		non_claims: ["No successful capability result or audit completion readback was reached."],
	});
	return 3;
}

function writeCallIncomplete(
	value: CealGatewayCallValue, requestId: string, reason: string, io: CealCliIo,
	profile: CealStoredProfile, parsed: Extract<ParsedCallOptions, { ok: true }>,
): number {
	writeYaml(io.stdout, {
		schema: "ceal.result.v1", command: "ceal", ok: false, status: "error", ...resultIdentity(profile),
		request: resultRequest(parsed, requestId), authorization: { result: "allowed" },
		capability_backend_ref: value.capability_backend_ref,
		evidence: { requirement: "gateway_audit", reached: "host_decision", refs: [] },
		claim: { allowed: false }, warnings: [], data: value.data,
		audit: { state: "unavailable", reason, scope: "runtime" }, redaction: value.redaction,
		usage: { state: "unavailable", reason: "completion_unverified", scope: "runtime" }, proof_level: "host_decision",
		error: { kind: reason, message: "The Gateway returned a result but its audit event was not read back.", next_action: "Retry audit readback with the request ID before claiming verified completion." },
	});
	return 3;
}

function writeCallUnavailable(
	reason: string, io: CealCliIo, profile: CealStoredProfile | null,
	parsed: Extract<ParsedCallOptions, { ok: true }> | null,
): number {
	writeYaml(io.stdout, {
		schema: "ceal.result.v1", command: "ceal", ok: false, status: "error", ...resultIdentity(profile),
		request: parsed ? resultRequest(parsed, null) : null, authorization: { result: "not_evaluated" },
		evidence: { requirement: "gateway_audit", reached: "surface", refs: [] }, claim: { allowed: false }, warnings: [], data: null,
		audit: { state: "unavailable", reason: "pre_instance", scope: "local_cli" },
		redaction: { state: "not_applicable", reason: "no_instance_data_handling" },
		usage: { state: "not_applicable", reason: "no_model_or_metered_component" }, proof_level: "surface",
		error: { kind: reason, message: "The capability call could not be completed.", next_action: "Run 'ceal capabilities' and verify the stored profile and target grant." },
	});
	return 3;
}

function writeCallValidationFailure(io: CealCliIo): number {
	return writeCallUnavailable("validation_error", io, null, null);
}

function resultIdentity(profile: CealStoredProfile | null): Record<string, string | null> {
	return {
		profile: profile?.profileRef ?? null, instance: profile?.instanceRef ?? null,
		subject: profile?.subjectRef ?? null, client: profile?.clientRef ?? null,
	};
}

function resultRequest(parsed: Extract<ParsedCallOptions, { ok: true }>, requestId: string | null): Record<string, string | null> {
	return {
		request_id: requestId, command_family: "capability.call", capability_id: parsed.capabilityId,
		target_ref: parsed.targetRef, purpose: parsed.purpose,
	};
}

async function runProfiles(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	if (options.length === 0) return showProfile(io, runtime);
	if (options.length === 1 && options[0] === "logout") return runProfileLogout(io, runtime);
	return enrollProfile(options, io, runtime);
}

async function showProfile(io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	let profile: CealStoredProfile | null;
	try { profile = runtime.loadProfile ? await runtime.loadProfile() : null; }
	catch { return writeEnrollmentUnavailable("profile_load_failed", io); }
	const now = runtime.now?.() ?? Date.now();
	return writeYaml(io.stdout, profile ? configuredProfileSummary(profile, now) : unconfiguredProfileSummary());
}

function configuredProfileSummary(profile: CealStoredProfile, now: number): Record<string, unknown> {
	return {
		schema_version: "ceal.profiles.v1", command: "ceal", status: "configured",
		gateway_endpoint: profile.gatewayEndpoint, profile_ref: profile.profileRef,
		registration_ref: profile.registrationRef, client_ref: profile.clientRef,
		runner_ref: profile.runnerRef, subject_ref: profile.subjectRef,
		instance_ref: profile.instanceRef, expires_at: profile.expiresAt,
		access_status: Date.parse(profile.expiresAt) > now ? "current" : "expired",
		renewal_available: Boolean(profile.refreshToken),
		refresh_token_idle_expires_at: profile.refreshTokenIdleExpiresAt ?? null,
		refresh_token_absolute_expires_at: profile.refreshTokenAbsoluteExpiresAt ?? null,
		raw_token_visible: false, proof_level: "local_state",
		next_action: "Run 'ceal capabilities' to verify live Gateway access.",
	};
}

function unconfiguredProfileSummary(): Record<string, unknown> {
	return {
		schema_version: "ceal.profiles.v1", command: "ceal", status: "unconfigured",
		gateway_endpoint: null, profile_ref: null, registration_ref: null, client_ref: null,
		runner_ref: null, subject_ref: null, instance_ref: null, expires_at: null, access_status: null,
		renewal_available: false, refresh_token_idle_expires_at: null, refresh_token_absolute_expires_at: null,
		raw_token_visible: false, proof_level: "local_state", next_action: "Run 'ceal profiles enroll --help'.",
	};
}

async function enrollProfile(options: readonly string[], io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	const parsed = parseEnrollmentOptions(options);
	if (!parsed.ok) return writeError("invalid_argument", "Invalid profile enrollment options.", io);
	if (!runtime.readSecret || !runtime.saveProfile) return writeEnrollmentUnavailable("profile_runtime_unavailable", io);
	let code: string;
	try { code = await runtime.readSecret(); } catch { return writeEnrollmentUnavailable("enrollment_code_input_failed", io); }
	try {
		const response = await createCealEnrollmentClient({ endpoint: parsed.gateway }).exchange(code);
		if (!response.ok) return writeEnrollmentRejected(response.error.code, io);
		const stored = toStoredProfile(parsed.gateway, response);
		await runtime.saveProfile(stored);
		return writeEnrollmentSuccess(parsed.gateway, stored, io);
	} catch (error) {
		const reason = error instanceof CealEnrollmentClientError ? error.code : "profile_save_failed";
		return writeEnrollmentUnavailable(reason, io);
	}
}

function toStoredProfile(gatewayEndpoint: string, response: {
	profile_ref: string; registration_ref: string; client_ref: string; runner_ref: string; subject_ref: string;
	instance_ref: string; access_token: string; expires_at: string; refresh_token?: string;
	refresh_token_idle_expires_at?: string; refresh_token_absolute_expires_at?: string;
}): CealStoredProfile {
	return {
		gatewayEndpoint, profileRef: response.profile_ref, registrationRef: response.registration_ref,
		clientRef: response.client_ref, runnerRef: response.runner_ref, subjectRef: response.subject_ref,
		instanceRef: response.instance_ref, accessToken: response.access_token, expiresAt: response.expires_at,
		...(response.refresh_token ? {
			refreshToken: response.refresh_token, refreshTokenIdleExpiresAt: response.refresh_token_idle_expires_at,
			refreshTokenAbsoluteExpiresAt: response.refresh_token_absolute_expires_at,
		} : {}),
	};
}

function writeEnrollmentSuccess(gateway: string, response: ReturnType<typeof toStoredProfile>, io: CealCliIo): number {
	return writeYaml(io.stdout, {
		schema_version: "ceal.profile_enrollment.v1", command: "ceal", status: "enrolled",
		gateway_endpoint: gateway, profile_ref: response.profileRef, registration_ref: response.registrationRef,
		client_ref: response.clientRef, runner_ref: response.runnerRef, subject_ref: response.subjectRef,
		instance_ref: response.instanceRef, expires_at: response.expiresAt,
		renewal_available: Boolean(response.refreshToken),
		refresh_token_idle_expires_at: response.refreshTokenIdleExpiresAt ?? null,
		refresh_token_absolute_expires_at: response.refreshTokenAbsoluteExpiresAt ?? null,
		raw_token_visible: false, proof_level: "host_decision",
		next_action: "Run 'ceal capabilities' to verify the stored profile and Gateway binding.",
	});
}

async function runProfileLogout(io: CealCliIo, runtime: CealCommandRuntime): Promise<number> {
	if (!runtime.loadProfile || !runtime.removeProfile) return writeEnrollmentUnavailable("profile_runtime_unavailable", io);
	let profile: CealStoredProfile | null;
	try { profile = await runtime.loadProfile(); } catch { return writeEnrollmentUnavailable("profile_load_failed", io); }
	if (!profile) return writeAlreadyLoggedOut(io);
	const revokeFailure = await revokeProfileSession(profile);
	if (revokeFailure) return writeProfileSessionUnavailable(revokeFailure, io);
	try { await runtime.removeProfile(); } catch { return writeProfileSessionUnavailable("profile_remove_failed", io); }
	return writeLoggedOut(profile, io);
}

function writeAlreadyLoggedOut(io: CealCliIo): number {
	return writeYaml(io.stdout, {
		schema_version: "ceal.profile_logout.v1", command: "ceal", status: "already_logged_out",
		server_session_revoked: false, local_profile_removed: false, raw_token_visible: false,
		proof_level: "local_state", next_action: "Run 'ceal profiles enroll --help' to configure a profile.",
	});
}

async function revokeProfileSession(profile: CealStoredProfile): Promise<string | null> {
	if (!profile.refreshToken) return null;
	try {
		const response = await createCealPersonalClientSessionClient({ endpoint: profile.gatewayEndpoint }).revoke(profile.refreshToken);
		return !response.ok && response.error.code !== "refresh_revoked" ? response.error.code : null;
	} catch (error) {
		return error instanceof CealPersonalClientSessionError ? error.code : "request_failed";
	}
}

function writeLoggedOut(profile: CealStoredProfile, io: CealCliIo): number {
	return writeYaml(io.stdout, {
		schema_version: "ceal.profile_logout.v1", command: "ceal", status: "logged_out",
		server_session_revoked: Boolean(profile.refreshToken), local_profile_removed: true, raw_token_visible: false,
		proof_level: profile.refreshToken ? "host_decision" : "local_state",
		next_action: "Run 'ceal profiles enroll --help' to configure another profile.",
	});
}

class CealProfileSessionError extends Error {
	constructor(readonly code: string) { super("Ceal profile session unavailable."); }
}

async function ensureCurrentProfile(profile: CealStoredProfile, runtime: CealCommandRuntime, force = false): Promise<CealStoredProfile> {
	const now = runtime.now?.() ?? Date.now();
	if (!force && profileIsCurrent(profile, now)) return profile;
	const refresh = requireRefreshContext(profile, runtime, now);
	const response = await refreshProfile(profile, refresh.token);
	if (!response.ok) throw new CealProfileSessionError(response.error.code);
	assertProfileBindings(profile, response);
	const rotated = rotatedProfile(profile, response);
	await refresh.save(rotated);
	return rotated;
}

function profileIsCurrent(profile: CealStoredProfile, now: number): boolean {
	return Date.parse(profile.expiresAt) > now + 60_000;
}

function requireRefreshContext(
	profile: CealStoredProfile, runtime: CealCommandRuntime, now: number,
): { token: string; save: NonNullable<CealCommandRuntime["saveProfile"]> } {
	if (!profile.refreshToken || !runtime.saveProfile) throw new CealProfileSessionError("reenrollment_required");
	if (profile.refreshTokenAbsoluteExpiresAt && Date.parse(profile.refreshTokenAbsoluteExpiresAt) <= now) {
		throw new CealProfileSessionError("refresh_expired");
	}
	return { token: profile.refreshToken, save: runtime.saveProfile };
}

async function refreshProfile(profile: CealStoredProfile, refreshToken: string) {
	try {
		return await createCealPersonalClientSessionClient({ endpoint: profile.gatewayEndpoint }).refresh(refreshToken);
	} catch (error) {
		throw new CealProfileSessionError(error instanceof CealPersonalClientSessionError ? error.code : "request_failed");
	}
}

function assertProfileBindings(profile: CealStoredProfile, response: CealClientRefreshResult): void {
	const bindings = [
		[response.profile_ref, profile.profileRef], [response.registration_ref, profile.registrationRef],
		[response.client_ref, profile.clientRef], [response.runner_ref, profile.runnerRef],
		[response.subject_ref, profile.subjectRef], [response.instance_ref, profile.instanceRef],
	];
	if (bindings.some(([actual, expected]) => actual !== expected)) throw new CealProfileSessionError("binding_changed");
}

function rotatedProfile(profile: CealStoredProfile, response: CealClientRefreshResult): CealStoredProfile {
	return {
		...profile, accessToken: response.access_token, expiresAt: response.expires_at,
		refreshToken: response.refresh_token,
		refreshTokenIdleExpiresAt: response.refresh_token_idle_expires_at,
		refreshTokenAbsoluteExpiresAt: response.refresh_token_absolute_expires_at,
	};
}

function gatewayFailureCode(error: unknown): string | null {
	return error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
		? (error as { code: string }).code : null;
}

function writeProfileSessionUnavailable(reason: string, io: CealCliIo): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.profile_session.v1", command: "ceal", status: "unavailable",
		credential_context: CREDENTIAL_CONTEXT, proof_level: "surface", raw_token_visible: false,
		error: {
			kind: reason,
			message: "The stored Gateway session could not be renewed or revoked safely.",
			next_action: "Run 'ceal profiles' to inspect expiry, then request a new enrollment code if renewal is unavailable.",
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
		schema_version: "ceal.profile_enrollment.v1",
		command: "ceal",
		status: "denied",
		proof_level: "host_decision",
		error: { code, message: "The Gateway rejected the enrollment code.", next_action: "Ask a Gateway administrator for a new one-time enrollment code." },
	});
	return 3;
}

function writeEnrollmentUnavailable(reason: string, io: CealCliIo): number {
	writeYaml(io.stdout, {
		schema_version: "ceal.profile_enrollment.v1",
		command: "ceal",
		status: "unavailable",
		proof_level: "surface",
		error: { kind: reason, message: "The profile enrollment could not be completed.", next_action: "Check the Gateway URL and request a new one-time enrollment code." },
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

function isHelpToken(value: string | undefined): boolean {
	return value === "--help" || value === "-h";
}
