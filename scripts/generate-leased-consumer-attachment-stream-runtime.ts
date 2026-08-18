#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isJsonRecord } from "../packages/ceal-worker-cli/src/json-record.ts";
import { hasExactObjectKeys as exact } from "../packages/ceal-worker-cli/src/object-keys.ts";
import { sha256 } from "../packages/ceal-worker-cli/src/sha256.ts";
import { sameStringArray as sameArray } from "../packages/ceal-worker-cli/src/string-array.ts";
import { isGitObject } from "./lib/git-object.ts";
import { isLowercaseHexDigest } from "./lib/hex-digest.ts";
import { isMainModule } from "./lib/is-main-module.ts";
import { writeIfChanged } from "./lib/write-if-changed.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HANDOFF_PATH = "vendor/gateway-leased-consumer-attachment-stream/gateway-leased-consumer-attachment-stream-conformance.json";
const OUTPUT_PATH = "packages/ceal-worker-cli/src/generated/leased-consumer-attachment-stream-contract.ts";
const SOURCE_INPUT_PATHS = [
	"packages/ceal-protocol/src/index.ts",
	"packages/ceal-protocol/src/leased-consumer-attachment-stream.ts",
	"scripts/agent-runtime/gateway-leased-consumer-attachment-stream-route.ts",
	"scripts/agent-runtime/fixtures/gateway-leased-consumer-attachment-stream-transport.json",
];
const HANDOFF_SCHEMA = "ceal.gateway_leased_consumer_attachment_stream_conformance_handoff.v1";
const CONTRACT_SCHEMA = "ceal.worker_private_leased_consumer_attachment_stream_contract.v1";
const ENTRYPOINT = "--internal-leased-consumer-attachment-stream";
const ROUTE = "/api/ceal/agent/v1/control/attachment-stream";
const REQUEST_SCHEMA = "ceal.leased_consumer_attachment_stream_request.v1";
const RESPONSE_CONTENT_TYPE = "application/octet-stream";
const PROTECTED_SESSION_SCHEMA = "ceal.leased_consumer_control_session.v1";
const ENTRYPOINT_REQUEST_SCHEMA = "ceal.worker_private_leased_consumer_attachment_stream_request.v1";
const ENTRYPOINT_RESULT_SCHEMA = "ceal.worker_private_leased_consumer_attachment_stream_result.v1";
const ENTRYPOINT_MAXIMUM_BYTES = 32 * 1024;
const ENTRYPOINT_ERROR_CODES = [
	"invalid_request",
	"invalid_expected_binding",
	"invalid_operation_deadline",
	"session_unavailable",
	"invalid_response",
	"transport_failed",
	"request_binding_mismatch",
	"stream_invalid",
	"handoff_cleanup_failed",
	"handoff_write_failed",
];
const INVARIANTS = [
	"the request carries only the event and lease tuple; Gateway derives consumer identity",
	"the response is a raw bounded binary stream, never a JSON result-materialization frame",
	"the stream carries one complete manifest, ordered materialized slots, and one terminal digest/count proof",
	"the Worker constructs the Agent handoff root and fixed slot filenames; stream data cannot choose a path",
	"the handoff manifest is published only after terminal proof and every materialized digest passes",
	"provider credentials, URLs, source refs, and provider file identifiers never cross the boundary",
];
const NON_CLAIMS = [
	"This local immutable-source handoff is not a signed release, installed Worker artifact, or live serving proof; local route registration does not prove live availability.",
	"The protected service credential remains a runtime input and is never included in this packet or exposed to Agent IPC.",
	"The route does not select a provider file, authorize an arbitrary path, or prove a successful provider download.",
];

type JsonRecord = Record<string, unknown>;
type SourceInput = JsonRecord & { path: string; sha256: string };
type Source = JsonRecord & { commit: string; inputs: SourceInput[]; protocol_tree: string; repository: string; tree: string };
type Transport = JsonRecord & { authorization: string; content_type: string; method: string; path: string; schema_version: string };
type ResponseContract = JsonRecord & {
	content_type: string;
	frame_schema: string;
	magic_hex: string;
	manifest_schema: string;
	transport_schema: string;
};
type ProtectedSession = JsonRecord & { child_fd: number; deadline_ms: number; maximum_bytes: number; schema_version: string };
type DeadlineBounds = JsonRecord & { maximum: number; minimum: number };
type Handoff = JsonRecord & { manifest_name: string; materialized_path: string; schema_version: string; unread_has_path: boolean };
type LimitSet = JsonRecord & { max_attachment_bytes: number; max_attachment_count: number; max_total_bytes: number };
type Limits = JsonRecord & { effective: LimitSet; safety: LimitSet };
type ConformancePacket = JsonRecord & {
	handoff: Handoff;
	invariants: string[];
	limits: Limits;
	non_claims: string[];
	operation_deadline_bounds_ms: DeadlineBounds;
	proof_level: string;
	protected_session: ProtectedSession;
	response: ResponseContract;
	schema_version: string;
	source: Source;
	transport: Transport;
	writes_external: boolean;
};
type ConformancePacketBytes = { bytes: Buffer; value: Readonly<ConformancePacket>; sha256: string };
type RuntimeOptions = { repoRoot?: string };

export function generateLeasedConsumerAttachmentStreamRuntime({ repoRoot = ROOT }: RuntimeOptions = {}) {
	const root = path.resolve(repoRoot);
	const packet = readCandidateAttachmentStreamConformance(path.join(root, HANDOFF_PATH));
	const contract = projectCandidateContract(packet);
	const bytes = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, "utf8");
	const rendered = contractModule(bytes, sha256(bytes));
	const outputPath = path.join(root, OUTPUT_PATH);
	const changed = writeIfChanged(outputPath, rendered);
	return Object.freeze({ output_path: OUTPUT_PATH, changed, contract_sha256: sha256(bytes) });
}

export function readCandidateAttachmentStreamConformance(file: string): ConformancePacketBytes {
	let bytes: Buffer;
	let value: unknown;
	try {
		bytes = readFileSync(file);
		value = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("invalid_attachment_stream_conformance");
	}
	if (!validPacket(value)) throw new Error("invalid_attachment_stream_conformance");
	return Object.freeze({ bytes, value: Object.freeze(value), sha256: sha256(bytes) });
}

export function projectCandidateContract(packet: ConformancePacketBytes) {
	const value = packet.value;
	if (!validPacket(value)) throw new Error("invalid_attachment_stream_conformance");
	return {
		schema_version: CONTRACT_SCHEMA,
		argv: [ENTRYPOINT],
		source: value.source,
		transport: value.transport,
		response: value.response,
		protected_session: value.protected_session,
		operation_deadline_bounds_ms: value.operation_deadline_bounds_ms,
		stdin: {
			transport: "stdin_stdout_json",
			schema_version: ENTRYPOINT_REQUEST_SCHEMA,
			maximum_bytes: ENTRYPOINT_MAXIMUM_BYTES,
		},
		result: {
			schema_version: ENTRYPOINT_RESULT_SCHEMA,
			maximum_bytes: ENTRYPOINT_MAXIMUM_BYTES,
			allowed_error_codes: ENTRYPOINT_ERROR_CODES,
		},
		handoff: value.handoff,
		limits: value.limits,
		invariants: value.invariants,
		non_claims: value.non_claims,
	};
}

export function contractModule(bytes: Buffer, digest: string): string {
	return [
		"// Generated by scripts/generate-leased-consumer-attachment-stream-runtime.ts; do not edit by hand.",
		"// The Gateway conformance packet is validated before this private contract is embedded.",
		`export const LEASED_CONSUMER_ATTACHMENT_STREAM_ENTRYPOINT_ARGV = ${JSON.stringify(ENTRYPOINT)} as const;`,
		`export const LEASED_CONSUMER_ATTACHMENT_STREAM_CONTRACT_JSON = ${JSON.stringify(bytes.toString("utf8"))} as const;`,
		`export const LEASED_CONSUMER_ATTACHMENT_STREAM_CONTRACT_SHA256 = ${JSON.stringify(digest)} as const;`,
		`export const LEASED_CONSUMER_ATTACHMENT_STREAM_ROUTE_SHA256 = ${JSON.stringify(sha256(ROUTE))} as const;`,
		"",
	].join("\n");
}

function validPacket(value: unknown): value is ConformancePacket {
	return (
		isJsonRecord(value) &&
		exact(value, [
			"handoff",
			"invariants",
			"limits",
			"non_claims",
			"operation_deadline_bounds_ms",
			"proof_level",
			"protected_session",
			"response",
			"schema_version",
			"source",
			"transport",
			"writes_external",
		]) &&
		value.schema_version === HANDOFF_SCHEMA &&
		value.proof_level === "local_state" &&
		value.writes_external === false &&
		validSource(value.source) &&
		validTransport(value.transport) &&
		validResponse(value.response) &&
		validProtectedSession(value.protected_session) &&
		validDeadlineBounds(value.operation_deadline_bounds_ms) &&
		validHandoff(value.handoff) &&
		validLimits(value.limits) &&
		sameArray(value.invariants, INVARIANTS) &&
		sameArray(value.non_claims, NON_CLAIMS)
	);
}

function validSource(value: unknown): value is Source {
	return (
		isJsonRecord(value) &&
		exact(value, ["commit", "inputs", "protocol_tree", "repository", "tree"]) &&
		value.repository === "corca-ai/ceal" &&
		isGitObject(value.commit) &&
		isGitObject(value.tree) &&
		isGitObject(value.protocol_tree) &&
		Array.isArray(value.inputs) &&
		value.inputs.length === SOURCE_INPUT_PATHS.length &&
		value.inputs.every(
			(input: unknown, index: number) =>
				isJsonRecord(input) &&
				exact(input, ["path", "sha256"]) &&
				input.path === SOURCE_INPUT_PATHS[index] &&
				isLowercaseHexDigest(input.sha256, 64),
		)
	);
}

function validTransport(value: unknown): value is Transport {
	return (
		isJsonRecord(value) &&
		exact(value, ["authorization", "content_type", "method", "path", "schema_version"]) &&
		value.method === "POST" &&
		value.path === ROUTE &&
		value.authorization === "Bearer <protected-service-credential>" &&
		value.content_type === "application/json" &&
		value.schema_version === REQUEST_SCHEMA
	);
}

function validResponse(value: unknown): value is ResponseContract {
	return (
		isJsonRecord(value) &&
		exact(value, ["content_type", "frame_schema", "magic_hex", "manifest_schema", "transport_schema"]) &&
		value.content_type === RESPONSE_CONTENT_TYPE &&
		value.magic_hex === "4345414c41533100" &&
		value.transport_schema === "ceal.leased_consumer_attachment_stream_transport.v1" &&
		value.manifest_schema === "ceal.leased_consumer_attachment_stream_manifest.v1" &&
		value.frame_schema === "ceal.leased_consumer_attachment_stream_frame.v1"
	);
}

function validProtectedSession(value: unknown): value is ProtectedSession {
	return (
		isJsonRecord(value) &&
		exact(value, ["child_fd", "deadline_ms", "maximum_bytes", "schema_version"]) &&
		value.child_fd === 4 &&
		value.schema_version === PROTECTED_SESSION_SCHEMA &&
		value.maximum_bytes === 8192 &&
		value.deadline_ms === 2000
	);
}

function validDeadlineBounds(value: unknown): value is DeadlineBounds {
	return (
		isJsonRecord(value) &&
		exact(value, ["maximum", "minimum"]) &&
		value.minimum === 30000 &&
		value.maximum === 600000 &&
		value.minimum <= value.maximum
	);
}

function validHandoff(value: unknown): value is Handoff {
	return (
		isJsonRecord(value) &&
		exact(value, ["manifest_name", "materialized_path", "schema_version", "unread_has_path"]) &&
		value.schema_version === "ceal.agent.attachment_materialization.v1" &&
		value.manifest_name === "manifest.json" &&
		value.materialized_path === "attachments/<slot>.bin" &&
		value.unread_has_path === false
	);
}

function validLimits(value: unknown): value is Limits {
	return (
		isJsonRecord(value) &&
		exact(value, ["effective", "safety"]) &&
		validLimitSet(value.effective, 838860800) &&
		validLimitSet(value.safety, 104857600) &&
		value.safety.max_total_bytes <= value.effective.max_total_bytes
	);
}

function validLimitSet(value: unknown, maxTotal: number): value is LimitSet {
	return (
		isJsonRecord(value) &&
		exact(value, ["max_attachment_bytes", "max_attachment_count", "max_total_bytes"]) &&
		value.max_attachment_count === 16 &&
		value.max_attachment_bytes === 52428800 &&
		value.max_total_bytes === maxTotal
	);
}

if (isMainModule(import.meta.url)) {
	try {
		console.log(JSON.stringify(generateLeasedConsumerAttachmentStreamRuntime(), null, 2));
	} catch (error) {
		console.error(
			JSON.stringify({
				schema_version: "ceal.worker_private_leased_consumer_attachment_stream_contract_error.v1",
				ok: false,
				error_code: error instanceof Error ? error.message : "generation_failed",
			}),
		);
		process.exitCode = 2;
	}
}
