#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isJsonRecord } from "../packages/ceal-worker-cli/src/json-record.ts";
import { isGitObject } from "./lib/git-object.ts";
import { isLowercaseHexDigest } from "./lib/hex-digest.ts";
import { isStringMap } from "./lib/string-map.ts";
import { verifyGatewayLeasedConsumerCallHandoff } from "./verify-gateway-leased-consumer-call-handoff.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = "gateway-leased-consumer-call-handoff-lock.json";
const HANDOFF_PATH = "vendor/gateway-leased-consumer-call/gateway-leased-consumer-call-conformance.json";
const PROTOCOL_MANIFEST_PATH = "packages/ceal-protocol/package.json";
const OUTPUT_PATH = "packages/ceal-worker-cli/src/generated/leased-consumer-handoff.ts";
const CARRIER_CONTRACT_PATH = "packages/ceal-worker-cli/leased-consumer-carrier-contract.json";
const CARRIER_CONTRACT_OUTPUT_PATH = "packages/ceal-worker-cli/src/generated/leased-consumer-carrier-contract.ts";
const CONTROL_SESSION_CONTRACT_PATH = "packages/ceal-worker-cli/leased-consumer-control-session-contract.json";
const CONTROL_SESSION_CONTRACT_OUTPUT_PATH = "packages/ceal-worker-cli/src/generated/leased-consumer-control-session-contract.ts";

type JsonRecord = Record<string, unknown>;
type JsonDecoder = (value: unknown) => unknown;
type ContractBytes = { bytes: Buffer; value: JsonRecord; sha256: string };
type CarrierContract = JsonRecord & {
	schema_version: string;
	argv: string[];
	stdin: JsonRecord & { schema_version: string; maximum_bytes: number };
	service_channel: JsonRecord & { child_fd: number; schema_versions: string[]; maximum_bytes: number; deadline_ms: number };
	service_call: JsonRecord & { deadline_ms: number };
	result: JsonRecord & { schema_version: string; maximum_bytes: number; allowed_error_codes: string[] };
	non_claims: string[];
};
type ControlSessionContract = JsonRecord & {
	schema_version: string;
	argv: string[];
	protected_session: JsonRecord & { child_fd: number; schema_version: string; maximum_bytes: number; deadline_ms: number };
	notification_channel: JsonRecord & { child_fd: number; schema_version: string; framing: string; maximum_frame_bytes: number };
	agent_ipc: JsonRecord & {
		transport: string;
		request_schema_version: string;
		response_schema_version: string;
		maximum_frame_bytes: number;
		serial: boolean;
	};
	gateway: JsonRecord & {
		transport: string;
		operation_deadline_bounds_ms: JsonRecord & { minimum: number; maximum: number };
		routes: Record<string, string>;
	};
	gateway_protocol_handoff: JsonRecord & {
		lock_file: string;
		gateway_tag: string;
		gateway_commit: string;
		protocol_tree: string;
		archive_sha256: string;
	};
	non_claims: string[];
};
type ConformanceOperation = JsonRecord & {
	operation: string;
	path: string;
	request: JsonRecord & { schema_version: string };
	response: JsonRecord & { schema_version: string };
};
type Conformance = JsonRecord & { operations: ConformanceOperation[] };
type HandoffLock = JsonRecord & {
	archive: JsonRecord & { control_routes_sha256: string; sha256: string };
	protocol: JsonRecord & { version: string };
	gateway: JsonRecord & { tag: string; commit: string; protocol_tree: string };
};
type ProjectionContract = JsonRecord & {
	agent_ipc: JsonRecord;
	gateway: JsonRecord & { routes: Record<string, string> };
	gateway_protocol_handoff?: JsonRecord;
};

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry): entry is string => typeof entry === "string");
}

function isHandoffLock(value: unknown): value is HandoffLock {
	return (
		isJsonRecord(value) &&
		isJsonRecord(value.archive) &&
		typeof value.archive.control_routes_sha256 === "string" &&
		typeof value.archive.sha256 === "string" &&
		isJsonRecord(value.protocol) &&
		typeof value.protocol.version === "string" &&
		isJsonRecord(value.gateway) &&
		typeof value.gateway.tag === "string" &&
		/^gateway-protocol-handoff-v\d+[.]\d+[.]\d+$/u.test(value.gateway.tag) &&
		isGitObject(value.gateway.commit) &&
		isGitObject(value.gateway.protocol_tree) &&
		isLowercaseHexDigest(value.archive.sha256, 64)
	);
}

function isProjectionContract(value: unknown): value is ProjectionContract {
	return isJsonRecord(value) && isJsonRecord(value.agent_ipc) && isJsonRecord(value.gateway) && isStringMap(value.gateway.routes);
}

function isDecoderOptions(value: unknown): value is { decodeRequest: JsonDecoder; decodeResponse: JsonDecoder } {
	return isJsonRecord(value) && typeof value.decodeRequest === "function" && typeof value.decodeResponse === "function";
}

function isCarrierContract(value: unknown): value is CarrierContract {
	if (
		!isJsonRecord(value) ||
		typeof value.schema_version !== "string" ||
		!isStringArray(value.argv) ||
		!isJsonRecord(value.stdin) ||
		!isJsonRecord(value.service_channel) ||
		!isJsonRecord(value.service_call) ||
		!isJsonRecord(value.result) ||
		!isStringArray(value.non_claims)
	)
		return false;
	return (
		typeof value.stdin.schema_version === "string" &&
		typeof value.stdin.maximum_bytes === "number" &&
		typeof value.service_channel.child_fd === "number" &&
		isStringArray(value.service_channel.schema_versions) &&
		typeof value.service_channel.maximum_bytes === "number" &&
		typeof value.service_channel.deadline_ms === "number" &&
		typeof value.service_call.deadline_ms === "number" &&
		typeof value.result.schema_version === "string" &&
		typeof value.result.maximum_bytes === "number" &&
		isStringArray(value.result.allowed_error_codes)
	);
}

function isControlSessionContract(value: unknown): value is ControlSessionContract {
	if (
		!isJsonRecord(value) ||
		typeof value.schema_version !== "string" ||
		!isStringArray(value.argv) ||
		!isJsonRecord(value.protected_session) ||
		!isJsonRecord(value.notification_channel) ||
		!isJsonRecord(value.agent_ipc) ||
		!isJsonRecord(value.gateway) ||
		!isJsonRecord(value.gateway_protocol_handoff) ||
		!isStringArray(value.non_claims)
	)
		return false;
	const bounds = value.gateway.operation_deadline_bounds_ms;
	return (
		typeof value.protected_session.child_fd === "number" &&
		typeof value.protected_session.schema_version === "string" &&
		typeof value.protected_session.maximum_bytes === "number" &&
		typeof value.protected_session.deadline_ms === "number" &&
		typeof value.notification_channel.child_fd === "number" &&
		typeof value.notification_channel.schema_version === "string" &&
		typeof value.notification_channel.framing === "string" &&
		typeof value.notification_channel.maximum_frame_bytes === "number" &&
		typeof value.agent_ipc.transport === "string" &&
		typeof value.agent_ipc.request_schema_version === "string" &&
		typeof value.agent_ipc.response_schema_version === "string" &&
		typeof value.agent_ipc.maximum_frame_bytes === "number" &&
		typeof value.agent_ipc.serial === "boolean" &&
		typeof value.gateway.transport === "string" &&
		isJsonRecord(bounds) &&
		typeof bounds.minimum === "number" &&
		typeof bounds.maximum === "number" &&
		isJsonRecord(value.gateway.routes) &&
		Object.values(value.gateway.routes).every((route): route is string => typeof route === "string") &&
		typeof value.gateway_protocol_handoff.lock_file === "string" &&
		typeof value.gateway_protocol_handoff.gateway_tag === "string" &&
		typeof value.gateway_protocol_handoff.gateway_commit === "string" &&
		typeof value.gateway_protocol_handoff.protocol_tree === "string" &&
		typeof value.gateway_protocol_handoff.archive_sha256 === "string"
	);
}

function isConformance(value: unknown): value is Conformance {
	return (
		isJsonRecord(value) &&
		Array.isArray(value.operations) &&
		value.operations.every(
			(entry): entry is ConformanceOperation =>
				isJsonRecord(entry) &&
				typeof entry.operation === "string" &&
				typeof entry.path === "string" &&
				isJsonRecord(entry.request) &&
				typeof entry.request.schema_version === "string" &&
				isJsonRecord(entry.response) &&
				typeof entry.response.schema_version === "string",
		)
	);
}

/**
 * Materialize the exact, already-verified handoff bytes into the worker package.
 * The released binary has no checkout to reread, so it must carry this input;
 * this generator is intentionally a no-op if the checked-in generated source
 * already represents the verified bytes.
 */
export function generateLeasedConsumerHandoffRuntime({ repoRoot = ROOT }: { repoRoot?: string } = {}) {
	const root = path.resolve(repoRoot);
	const verification = verifyGatewayLeasedConsumerCallHandoff({ repoRoot: root });
	const lock = readFileSync(path.join(root, LOCK_PATH), "utf8");
	const handoff = readFileSync(path.join(root, HANDOFF_PATH), "utf8");
	const carrierContract = readCarrierContract(path.join(root, CARRIER_CONTRACT_PATH));
	const controlSessionContract = readControlSessionContract(path.join(root, CONTROL_SESSION_CONTRACT_PATH), { repoRoot: root });
	const rendered = [
		"// Generated by scripts/generate-leased-consumer-handoff-runtime.ts; do not edit by hand.",
		"// The generator first runs the SHA-locked Gateway handoff verifier.",
		`export const GATEWAY_LEASED_CONSUMER_HANDOFF_LOCK_JSON = ${JSON.stringify(lock)} as const;`,
		`export const GATEWAY_LEASED_CONSUMER_HANDOFF_JSON = ${JSON.stringify(handoff)} as const;`,
		`export const GATEWAY_LEASED_CONSUMER_HANDOFF_SHA256 = ${JSON.stringify(verification.handoff.sha256)} as const;`,
		"",
	].join("\n");
	const wrote = [
		writeIfChanged(path.join(root, OUTPUT_PATH), rendered),
		writeIfChanged(
			path.join(root, CARRIER_CONTRACT_OUTPUT_PATH),
			contractModule("The private carrier release contract is validated before it is embedded.", "LEASED_CONSUMER_CARRIER", carrierContract),
		),
		writeIfChanged(
			path.join(root, CONTROL_SESSION_CONTRACT_OUTPUT_PATH),
			contractModule(
				"The private control-session release contract is validated before it is embedded.",
				"LEASED_CONSUMER_CONTROL_SESSION",
				controlSessionContract,
			),
		),
	];
	return Object.freeze({
		output_path: OUTPUT_PATH,
		carrier_contract_output_path: CARRIER_CONTRACT_OUTPUT_PATH,
		control_session_contract_output_path: CONTROL_SESSION_CONTRACT_OUTPUT_PATH,
		changed: wrote.some(Boolean),
		handoff_sha256: verification.handoff.sha256,
		carrier_contract_sha256: carrierContract.sha256,
		control_session_contract_sha256: controlSessionContract.sha256,
	});
}

export function readCarrierContract(file: string): ContractBytes & { value: CarrierContract } {
	const { bytes, value: parsed } = readJsonContract(file, "invalid_carrier_contract");
	if (!isCarrierContract(parsed)) throw new Error("invalid_carrier_contract");
	const value = parsed;
	const errors = ["invalid_request", "leased_consumer_call_unavailable", "service_call_failed", "service_channel_unavailable"];
	if (
		!exact(value, ["schema_version", "argv", "stdin", "service_channel", "service_call", "result", "non_claims"]) ||
		value.schema_version !== "ceal.worker_private_leased_consumer_carrier_contract.v2" ||
		!Array.isArray(value.argv) ||
		value.argv.length !== 1 ||
		value.argv[0] !== "--internal-leased-consumer-carrier" ||
		!exact(value.stdin, ["schema_version", "maximum_bytes"]) ||
		value.stdin.schema_version !== "ceal.gateway_leased_consumer_call_request.v1" ||
		value.stdin.maximum_bytes !== 32 * 1024 ||
		!exact(value.service_channel, ["child_fd", "schema_versions", "maximum_bytes", "deadline_ms"]) ||
		value.service_channel.child_fd !== 4 ||
		!Array.isArray(value.service_channel.schema_versions) ||
		value.service_channel.schema_versions.length !== 2 ||
		value.service_channel.schema_versions[0] !== "ceal.leased_consumer_service_channel.v1" ||
		value.service_channel.schema_versions[1] !== "ceal.leased_consumer_service_channel.v2" ||
		value.service_channel.maximum_bytes !== 8 * 1024 ||
		value.service_channel.deadline_ms !== 2_000 ||
		// The outbound service call is a different concept from the FD4 channel read
		// and carries its own deadline; the carrier has no launcher-injected one.
		!exact(value.service_call, ["deadline_ms"]) ||
		value.service_call.deadline_ms !== 30_000 ||
		!exact(value.result, ["schema_version", "maximum_bytes", "allowed_error_codes"]) ||
		value.result.schema_version !== "ceal.leased_consumer_call_result.v1" ||
		value.result.maximum_bytes !== 32 * 1024 ||
		!Array.isArray(value.result.allowed_error_codes) ||
		value.result.allowed_error_codes.length !== errors.length ||
		!errors.every((error) => value.result.allowed_error_codes.includes(error)) ||
		!Array.isArray(value.non_claims) ||
		value.non_claims.length < 1 ||
		!value.non_claims.every((claim) => typeof claim === "string")
	)
		throw new Error("invalid_carrier_contract");
	return Object.freeze({ bytes, value: Object.freeze(value), sha256: createHash("sha256").update(bytes).digest("hex") });
}

export function readControlSessionContract(
	file: string,
	{ repoRoot = ROOT }: { repoRoot?: string } = {},
): ContractBytes & { value: ControlSessionContract } {
	const { bytes, value: parsed } = readJsonContract(file, "invalid_control_session_contract");
	if (!isControlSessionContract(parsed)) throw new Error("invalid_control_session_contract");
	const value = parsed;
	const routeEntries = Object.entries(value?.gateway?.routes ?? {});
	const fixedRoutes =
		routeEntries.length >= 5 &&
		routeEntries.every(
			([operation, route]) =>
				typeof operation === "string" &&
				/^[a-z][a-z0-9_]*$/u.test(operation) &&
				typeof route === "string" &&
				/^\/api\/ceal\/agent\/v1\/[a-z0-9][a-z0-9_/-]*$/u.test(route),
		) &&
		new Set(routeEntries.map(([, route]) => route)).size === routeEntries.length;
	let lock: HandoffLock;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path.join(repoRoot, "gateway-protocol-handoff-lock.json"), "utf8"));
		if (!isHandoffLock(parsed)) throw new Error("invalid_control_session_contract");
		lock = parsed;
	} catch {
		throw new Error("invalid_control_session_contract");
	}
	// The signed handoff lock and the vendored package manifest are two sides of
	// one release input. Compare them here so a new handoff cannot be consumed
	// by a stale vendored Protocol copy, or vice versa.
	const protocolVersion = readProtocolPackageVersion(repoRoot);
	const current =
		exact(value, [
			"schema_version",
			"argv",
			"protected_session",
			"notification_channel",
			"agent_ipc",
			"gateway",
			"gateway_protocol_handoff",
			"non_claims",
		]) &&
		value.schema_version === "ceal.worker_private_leased_consumer_control_session_contract.v3" &&
		exact(value.notification_channel, ["child_fd", "schema_version", "framing", "maximum_frame_bytes"]) &&
		value.notification_channel.child_fd === 5 &&
		value.notification_channel.schema_version === "ceal.leased_consumer_capability_notification.v5" &&
		value.notification_channel.framing === "ndjson" &&
		value.notification_channel.maximum_frame_bytes === 4 * 1024 &&
		value.agent_ipc?.request_schema_version === "ceal.leased_consumer_capability_control_request.v6" &&
		value.agent_ipc?.response_schema_version === "ceal.leased_consumer_capability_control_response.v6" &&
		routeEntries.length === 7 &&
		lock?.archive?.control_routes_sha256 === sha256ControlRoutes(value.gateway.routes) &&
		fixedRoutes &&
		lock?.protocol?.version === protocolVersion;
	if (
		!current ||
		!Array.isArray(value.argv) ||
		value.argv.length !== 1 ||
		value.argv[0] !== "--internal-leased-consumer-control-session" ||
		!exact(value.protected_session, ["child_fd", "schema_version", "maximum_bytes", "deadline_ms"]) ||
		value.protected_session.child_fd !== 4 ||
		value.protected_session.schema_version !== "ceal.leased_consumer_control_session.v1" ||
		value.protected_session.maximum_bytes !== 8 * 1024 ||
		value.protected_session.deadline_ms !== 2_000 ||
		!exact(value.agent_ipc, ["transport", "request_schema_version", "response_schema_version", "maximum_frame_bytes", "serial"]) ||
		value.agent_ipc.transport !== "stdin_stdout_ndjson" ||
		value.agent_ipc.maximum_frame_bytes !== 32 * 1024 ||
		value.agent_ipc.serial !== true ||
		!exact(value.gateway, ["transport", "operation_deadline_bounds_ms", "routes"]) ||
		value.gateway.transport !== "unix_socket" ||
		!exact(value.gateway.operation_deadline_bounds_ms, ["minimum", "maximum"]) ||
		value.gateway.operation_deadline_bounds_ms.minimum !== 30_000 ||
		value.gateway.operation_deadline_bounds_ms.maximum !== 600_000 ||
		value.gateway.operation_deadline_bounds_ms.minimum > value.gateway.operation_deadline_bounds_ms.maximum ||
		!exact(value.gateway_protocol_handoff, ["lock_file", "gateway_tag", "gateway_commit", "protocol_tree", "archive_sha256"]) ||
		value.gateway_protocol_handoff.lock_file !== "gateway-protocol-handoff-lock.json" ||
		value.gateway_protocol_handoff.gateway_tag !== lock?.gateway?.tag ||
		value.gateway_protocol_handoff.gateway_commit !== lock?.gateway?.commit ||
		value.gateway_protocol_handoff.protocol_tree !== lock?.gateway?.protocol_tree ||
		value.gateway_protocol_handoff.archive_sha256 !== lock?.archive?.sha256 ||
		!Array.isArray(value.non_claims) ||
		value.non_claims.length < 1 ||
		!value.non_claims.every((claim) => typeof claim === "string")
	)
		throw new Error("invalid_control_session_contract");
	return Object.freeze({ bytes, value: Object.freeze(value), sha256: createHash("sha256").update(bytes).digest("hex") });
}

/**
 * Projects the operation-to-route table from one control conformance sidecar
 * whose bytes have already passed the reviewed Gateway archive consumer.  The
 * sidecar remains the authority: this function owns no operation names, route
 * literals, or capability semantics.  Canonical Protocol decoders supplied by
 * the caller prove that every signed request/response vector names the same
 * operation before its route can enter the worker contract.
 */
export function projectVerifiedControlConformanceRoutes(bytes: Uint8Array, options: unknown): Readonly<Record<string, string>> {
	let value: unknown;
	try {
		value = JSON.parse(Buffer.from(bytes).toString("utf8"));
	} catch {
		throw new Error("invalid_control_conformance");
	}
	if (!isConformance(value) || value.operations.length === 0 || !isDecoderOptions(options)) throw new Error("invalid_control_conformance");
	const { decodeRequest, decodeResponse } = options;
	const routes: Record<string, string> = {};
	for (const entry of value.operations) {
		if (
			!exact(entry, ["operation", "path", "request", "response"]) ||
			typeof entry.operation !== "string" ||
			!/^[a-z][a-z0-9_]*$/u.test(entry.operation) ||
			typeof entry.path !== "string" ||
			!/^\/api\/ceal\/agent\/v1\/[a-z0-9][a-z0-9_/-]*$/u.test(entry.path) ||
			Object.hasOwn(routes, entry.operation)
		)
			throw new Error("invalid_control_conformance");
		let request: unknown;
		let response: unknown;
		try {
			request = decodeRequest(entry.request);
			response = decodeResponse(entry.response);
		} catch {
			throw new Error("invalid_control_conformance");
		}
		if (!isJsonRecord(request) || !isJsonRecord(response) || request.operation !== entry.operation || response.operation !== entry.operation)
			throw new Error("invalid_control_conformance");
		routes[entry.operation] = entry.path;
	}
	return Object.freeze(routes);
}

/**
 * Produces (or verifies) the worker-owned projection only from the already
 * authenticated sidecar.  A missing or drifted operation is therefore a hard
 * refusal rather than a locally invented fallback route.
 */
export function controlSessionContractFromVerifiedConformance(
	contract: unknown,
	conformanceBytes: Uint8Array,
	decoders: unknown,
	options: unknown = {},
): ProjectionContract {
	if (!isProjectionContract(contract) || !isDecoderOptions(decoders) || !isJsonRecord(options))
		throw new Error("invalid_control_session_contract");
	const materialize = options.materialize === true;
	let handoff: JsonRecord | undefined;
	if (options.handoff !== undefined) {
		if (!isJsonRecord(options.handoff)) throw new Error("invalid_control_session_contract");
		handoff = options.handoff;
	}
	const routes = projectVerifiedControlConformanceRoutes(conformanceBytes, decoders);
	const projected: ProjectionContract = structuredClone(contract);
	if (materialize) projected.gateway.routes = { ...routes };
	if (materialize) {
		const conformance = parseConformance(conformanceBytes);
		const requestSchemas = new Set(conformance.operations.map((entry) => entry.request.schema_version));
		const responseSchemas = new Set(conformance.operations.map((entry) => entry.response.schema_version));
		if (requestSchemas.size !== 1 || responseSchemas.size !== 1) throw new Error("invalid_control_session_contract");
		projected.agent_ipc.request_schema_version = [...requestSchemas][0];
		projected.agent_ipc.response_schema_version = [...responseSchemas][0];
		projected.gateway_protocol_handoff = controlSessionHandoff(handoff);
	}
	if (!materialize && handoff) {
		const expected = controlSessionHandoff(handoff);
		if (JSON.stringify(projected.gateway_protocol_handoff) !== JSON.stringify(expected)) throw new Error("invalid_control_session_contract");
	}
	if (!exact(projected.gateway.routes, Object.keys(routes))) throw new Error("invalid_control_session_contract");
	for (const [operation, route] of Object.entries(routes)) {
		if (projected.gateway.routes[operation] !== route) throw new Error("invalid_control_session_contract");
	}
	return Object.freeze(projected);
}

// Both contract readers assert exact key sets rather than "has at least these",
// so an added field is a refusal instead of a silently ignored one. It was a
// local closure in each of them, byte-identical; it captures nothing, so the
// name stays and every call site is unchanged.
function exact(object: unknown, keys: string[]): object is JsonRecord {
	return (
		!!object &&
		typeof object === "object" &&
		!Array.isArray(object) &&
		Object.keys(object).length === keys.length &&
		keys.every((key) => key in object)
	);
}

function sha256ControlRoutes(routes: Record<string, string>) {
	return createHash("sha256").update(JSON.stringify(routes)).digest("hex");
}

function readJsonContract(file: string, errorCode: string): { bytes: Buffer; value: unknown } {
	try {
		const bytes = readFileSync(file);
		return { bytes, value: JSON.parse(bytes.toString("utf8")) };
	} catch {
		throw new Error(errorCode);
	}
}

function readProtocolPackageVersion(repoRoot: string): string {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path.join(repoRoot, PROTOCOL_MANIFEST_PATH), "utf8"));
		if (
			!isJsonRecord(parsed) ||
			parsed.name !== "@corca-ai/ceal-protocol" ||
			typeof parsed.version !== "string" ||
			!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(parsed.version)
		)
			throw new Error("invalid_protocol_manifest");
		return parsed.version;
	} catch {
		throw new Error("invalid_control_session_contract");
	}
}

function parseConformance(bytes: Uint8Array): Conformance {
	let value: unknown;
	try {
		value = JSON.parse(Buffer.from(bytes).toString("utf8"));
	} catch {
		throw new Error("invalid_control_session_contract");
	}
	if (!isConformance(value)) throw new Error("invalid_control_session_contract");
	return value;
}

function controlSessionHandoff(
	handoff: unknown,
): JsonRecord & { lock_file: string; gateway_tag: string; gateway_commit: string; protocol_tree: string; archive_sha256: string } {
	const gatewayTag = isJsonRecord(handoff) && typeof handoff.gateway_tag === "string" ? handoff.gateway_tag : undefined;
	const gatewayCommit = isJsonRecord(handoff) && typeof handoff.gateway_commit === "string" ? handoff.gateway_commit : undefined;
	const protocolTree = isJsonRecord(handoff) && typeof handoff.protocol_tree === "string" ? handoff.protocol_tree : undefined;
	const archiveSha256 = isJsonRecord(handoff) && typeof handoff.archive_sha256 === "string" ? handoff.archive_sha256 : undefined;
	if (
		gatewayTag === undefined ||
		gatewayCommit === undefined ||
		protocolTree === undefined ||
		archiveSha256 === undefined ||
		!/^gateway-protocol-handoff-v\d+[.]\d+[.]\d+$/u.test(gatewayTag) ||
		!isGitObject(gatewayCommit) ||
		!isGitObject(protocolTree) ||
		!isLowercaseHexDigest(archiveSha256, 64)
	)
		throw new Error("invalid_control_session_contract");
	return {
		lock_file: "gateway-protocol-handoff-lock.json",
		gateway_tag: gatewayTag,
		gateway_commit: gatewayCommit,
		protocol_tree: protocolTree,
		archive_sha256: archiveSha256,
	};
}

// The two embedded contracts render the same module shape around a different
// constant prefix, and each was spelled out in full beside its own read-compare-
// write. That is the pair the digest guard depends on: text and digest are
// emitted together so a generated module whose halves disagree is refusable.
export function contractModule<T extends JsonRecord>(
	description: string,
	constPrefix: string,
	contract: ContractBytes & { value: T },
): string {
	if (!isStringArray(contract.value.argv) || contract.value.argv.length === 0) throw new Error("invalid_control_session_contract");
	const lines = [
		"// Generated by scripts/generate-leased-consumer-handoff-runtime.ts; do not edit by hand.",
		`// ${description}`,
		`export const ${constPrefix}_ENTRYPOINT_ARGV = ${JSON.stringify(contract.value.argv[0])} as const;`,
		`export const ${constPrefix}_CONTRACT_JSON = ${JSON.stringify(contract.bytes.toString("utf8"))} as const;`,
		`export const ${constPrefix}_CONTRACT_SHA256 = ${JSON.stringify(contract.sha256)} as const;`,
	];
	const gateway = isJsonRecord(contract.value.gateway) ? contract.value.gateway : undefined;
	if (gateway && isStringMap(gateway.routes)) {
		lines.push(`export const ${constPrefix}_ROUTES_SHA256 = ${JSON.stringify(sha256ControlRoutes(gateway.routes))} as const;`);
	}
	return [...lines, ""].join("\n");
}

// Write only on change, so a regeneration that produces identical bytes does not
// touch the file and make a clean tree look dirty. Returns whether it wrote,
// which is what the result's `changed` is the disjunction of.
function writeIfChanged(file: string, rendered: string): boolean {
	let prior: string | null = null;
	try {
		prior = readFileSync(file, "utf8");
	} catch {
		prior = null;
	}
	if (prior === rendered) return false;
	writeFileSync(file, rendered);
	return true;
}

/**
 * A native artifact is bundled from the checked-in generated source, not from
 * the workspace contract JSON. Refuse source drift before that generated
 * source can become a release input.
 */
export function verifyEmbeddedCarrierContractSource({ repoRoot = ROOT } = {}) {
	const root = path.resolve(repoRoot);
	return verifyEmbeddedContractSource({
		expected: readCarrierContract(path.join(root, CARRIER_CONTRACT_PATH)),
		generatedPath: path.join(root, CARRIER_CONTRACT_OUTPUT_PATH),
		constPrefix: "LEASED_CONSUMER_CARRIER",
		missingCode: "embedded_carrier_contract_missing",
		driftCode: "embedded_carrier_contract_drift",
	});
}

/** The native worker may bundle only the exact generated control-session contract. */
export function verifyEmbeddedControlSessionContractSource({ repoRoot = ROOT } = {}) {
	const root = path.resolve(repoRoot);
	const expected = readControlSessionContract(path.join(root, CONTROL_SESSION_CONTRACT_PATH), { repoRoot: root });
	return verifyEmbeddedContractSource({
		expected,
		generatedPath: path.join(root, CONTROL_SESSION_CONTRACT_OUTPUT_PATH),
		constPrefix: "LEASED_CONSUMER_CONTROL_SESSION",
		missingCode: "embedded_control_session_contract_missing",
		driftCode: "embedded_control_session_contract_drift",
		routesSha256: sha256ControlRoutes(expected.value.gateway.routes),
	});
}

function verifyEmbeddedContractSource({
	expected,
	generatedPath,
	constPrefix,
	missingCode,
	driftCode,
	routesSha256,
}: {
	expected: ContractBytes & { value: CarrierContract | ControlSessionContract };
	generatedPath: string;
	constPrefix: string;
	missingCode: string;
	driftCode: string;
	routesSha256?: string;
}): { contract: CarrierContract | ControlSessionContract; sha256: string } {
	let generated = "";
	try {
		generated = readFileSync(generatedPath, "utf8");
	} catch {
		throw new Error(missingCode);
	}
	const constant = (suffix: string): string | undefined =>
		new RegExp(`^export const ${constPrefix}_${suffix} = (.+) as const;$`, "mu").exec(generated)?.[1];
	const json = constant("CONTRACT_JSON");
	const sha256 = constant("CONTRACT_SHA256");
	const argv = constant("ENTRYPOINT_ARGV");
	const embeddedRoutesSha256 = routesSha256 === undefined ? undefined : constant("ROUTES_SHA256");
	try {
		if (
			typeof json !== "string" ||
			typeof sha256 !== "string" ||
			typeof argv !== "string" ||
			JSON.parse(json) !== expected.bytes.toString("utf8") ||
			JSON.parse(argv) !== expected.value.argv[0] ||
			JSON.parse(sha256) !== expected.sha256 ||
			(routesSha256 !== undefined && (typeof embeddedRoutesSha256 !== "string" || JSON.parse(embeddedRoutesSha256) !== routesSha256))
		)
			throw new Error(driftCode);
	} catch {
		throw new Error(driftCode);
	}
	return Object.freeze({ contract: expected.value, sha256: expected.sha256 });
}

/**
 * Native artifacts bundle the generated handoff module, so a fresh release
 * builder must reject it when it no longer represents the checked-in,
 * SHA-locked Gateway handoff. Running the generator on only some CI platforms
 * is not sufficient: the other platforms package the committed source too.
 */
export function verifyEmbeddedGatewayLeasedConsumerHandoffSource({ repoRoot = ROOT } = {}) {
	const root = path.resolve(repoRoot);
	const verification = verifyGatewayLeasedConsumerCallHandoff({ repoRoot: root });
	const expectedLock = readFileSync(path.join(root, LOCK_PATH), "utf8");
	const expectedHandoff = readFileSync(path.join(root, HANDOFF_PATH), "utf8");
	let generated = "";
	try {
		generated = readFileSync(path.join(root, OUTPUT_PATH), "utf8");
	} catch {
		throw new Error("embedded_gateway_leased_consumer_handoff_missing");
	}
	const lock = /^export const GATEWAY_LEASED_CONSUMER_HANDOFF_LOCK_JSON = (.+) as const;$/mu.exec(generated)?.[1];
	const handoff = /^export const GATEWAY_LEASED_CONSUMER_HANDOFF_JSON = (.+) as const;$/mu.exec(generated)?.[1];
	const sha256 = /^export const GATEWAY_LEASED_CONSUMER_HANDOFF_SHA256 = "([a-f0-9]{64})" as const;$/mu.exec(generated)?.[1];
	try {
		if (
			typeof lock !== "string" ||
			typeof handoff !== "string" ||
			typeof sha256 !== "string" ||
			JSON.parse(lock) !== expectedLock ||
			JSON.parse(handoff) !== expectedHandoff ||
			sha256 !== verification.handoff.sha256
		)
			throw new Error("embedded_gateway_leased_consumer_handoff_drift");
	} catch {
		throw new Error("embedded_gateway_leased_consumer_handoff_drift");
	}
	return verification.handoff;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		if (process.argv.length !== 2) throw new Error("invalid_arguments");
		console.log(JSON.stringify(generateLeasedConsumerHandoffRuntime()));
	} catch {
		console.error(JSON.stringify({ ok: false, error_code: "handoff_generation_failed" }));
		process.exitCode = 2;
	}
}
