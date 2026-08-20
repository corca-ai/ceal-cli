import {
	LEASED_CONSUMER_ATTACHMENT_STREAM_CONTRACT_JSON,
	LEASED_CONSUMER_ATTACHMENT_STREAM_CONTRACT_SHA256,
	LEASED_CONSUMER_ATTACHMENT_STREAM_ENTRYPOINT_ARGV,
	LEASED_CONSUMER_ATTACHMENT_STREAM_ROUTE_SHA256,
} from "./generated/leased-consumer-attachment-stream-contract.js";
import { isJsonRecord } from "./json-record.js";
import { type CealAgentAttachmentHandoff, receiveLeasedConsumerAttachmentStream } from "./leased-consumer-attachment-stream.js";
import {
	type ProtectedSessionRuntime,
	readLeasedConsumerProtectedSession,
	resolveLeasedConsumerOperationDeadlineMs,
} from "./leased-consumer-protected-session.js";
import { sameObjectKeys } from "./object-keys.js";
import { postUnixSocketStream, type UnixSocketErrorNames } from "./private-worker-transport.js";
import {
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAGIC,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_HEADER_BYTES,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES,
	type CealLeasedConsumerAttachmentStreamBinding,
	decodeCealLeasedConsumerAttachmentStreamRequest,
} from "@corca-ai/ceal-protocol";
import { createHash } from "node:crypto";

const OPERATION_DEADLINE_ENV = "CEAL_LEASED_CONSUMER_OPERATION_DEADLINE_MS";
const CONTRACT = readCandidateContract();

export const LEASED_CONSUMER_ATTACHMENT_STREAM_ENTRYPOINT_CONTRACT = CONTRACT;

export class LeasedConsumerAttachmentStreamCarrierError extends Error {
	readonly code: string;

	constructor(code: string) {
		super("The private leased-consumer attachment stream could not be consumed");
		this.name = "LeasedConsumerAttachmentStreamCarrierError";
		this.code = code;
	}
}

export interface LeasedConsumerAttachmentStreamCarrierInput {
	readonly request: unknown;
	readonly expected_binding: Readonly<CealLeasedConsumerAttachmentStreamBinding>;
	/** Trusted Worker-owned handoff root factory; no path crosses the stream. */
	readonly createHandoffRoot: () => string | Promise<string>;
}

export interface LeasedConsumerAttachmentStreamCarrierRuntime extends ProtectedSessionRuntime {
	/** Test seam only. Production uses the fixed contract route and Unix socket. */
	readonly requestUnixSocketStream?: (
		input: Readonly<{
			readonly socketPath: string;
			readonly path: string;
			readonly method: string;
			readonly credential: string;
			readonly body: string;
			readonly deadlineMs: number;
			readonly maximumResponseBytes: number;
			readonly errors: UnixSocketErrorNames;
		}>,
	) => Promise<CandidateStreamResponse>;
}

/**
 * Private Worker-side adapter for the binary candidate route. It owns the
 * protected session and turns the response into the existing Agent-shaped
 * handoff; callers provide only a lease tuple/binding and a trusted root
 * factory. The generated candidate contract supplies route, framing, and
 * deadline identity—there is no caller-selectable route or path.
 */
export async function consumeLeasedConsumerAttachmentStream(
	input: LeasedConsumerAttachmentStreamCarrierInput,
	runtime: LeasedConsumerAttachmentStreamCarrierRuntime = {},
): Promise<CealAgentAttachmentHandoff> {
	const request = decodeRequest(input.request, input.expected_binding);
	let deadlineMs: number;
	try {
		deadlineMs = resolveLeasedConsumerOperationDeadlineMs(
			runtime.env ?? process.env,
			OPERATION_DEADLINE_ENV,
			CONTRACT.operation_deadline_bounds_ms,
		);
	} catch {
		throw new LeasedConsumerAttachmentStreamCarrierError("invalid_operation_deadline");
	}
	let session: Awaited<ReturnType<typeof readLeasedConsumerProtectedSession>>;
	try {
		session = await readLeasedConsumerProtectedSession(CONTRACT.protected_session, runtime);
	} catch {
		throw new LeasedConsumerAttachmentStreamCarrierError("session_unavailable");
	}
	let response: CandidateStreamResponse | undefined;
	try {
		response = await (runtime.requestUnixSocketStream ?? postUnixSocketStream)({
			socketPath: session.socket_path,
			path: CONTRACT.transport.path,
			method: CONTRACT.transport.method,
			body: JSON.stringify(request),
			credential: session.service_credential,
			deadlineMs,
			maximumResponseBytes: maximumResponseBytes(CONTRACT),
			errors: STREAM_ERROR_NAMES,
		});
		if (response.status !== 200 || response.contentType !== CONTRACT.response.content_type)
			throw new LeasedConsumerAttachmentStreamCarrierError("invalid_response");
		return await receiveLeasedConsumerAttachmentStream({
			stream: response.stream,
			expected_binding: input.expected_binding,
			createHandoffRoot: input.createHandoffRoot,
		});
	} catch (error) {
		if (error instanceof LeasedConsumerAttachmentStreamCarrierError) throw error;
		if (error instanceof Error && "code" in error && typeof error.code === "string") throw error;
		throw new LeasedConsumerAttachmentStreamCarrierError("transport_failed");
	} finally {
		response?.close();
	}
}

function decodeRequest(value: unknown, binding: Readonly<CealLeasedConsumerAttachmentStreamBinding>) {
	let request: ReturnType<typeof decodeCealLeasedConsumerAttachmentStreamRequest>;
	try {
		request = decodeCealLeasedConsumerAttachmentStreamRequest(value);
	} catch {
		throw new LeasedConsumerAttachmentStreamCarrierError("invalid_request");
	}
	if (request.event_ref !== binding.event_ref || request.lease_ref !== binding.lease_ref || request.lease_fence !== binding.lease_fence)
		throw new LeasedConsumerAttachmentStreamCarrierError("request_binding_mismatch");
	return request;
}

function maximumResponseBytes(contract: CandidateContract): number {
	const frameOverhead = CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES + CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_HEADER_BYTES;
	return (
		CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAGIC.byteLength +
		contract.limits.safety.max_total_bytes +
		(contract.limits.safety.max_attachment_count + 2) * frameOverhead
	);
}

function readCandidateContract(): CandidateContract {
	const bytes = new TextEncoder().encode(LEASED_CONSUMER_ATTACHMENT_STREAM_CONTRACT_JSON);
	if (createHash("sha256").update(bytes).digest("hex") !== LEASED_CONSUMER_ATTACHMENT_STREAM_CONTRACT_SHA256)
		throw new Error("invalid_attachment_stream_contract");
	let value: CandidateContract;
	try {
		value = JSON.parse(LEASED_CONSUMER_ATTACHMENT_STREAM_CONTRACT_JSON) as CandidateContract;
	} catch {
		throw new Error("invalid_attachment_stream_contract");
	}
	if (
		value.schema_version !== "ceal.worker_private_leased_consumer_attachment_stream_contract.v1" ||
		value.argv?.length !== 1 ||
		value.argv[0] !== LEASED_CONSUMER_ATTACHMENT_STREAM_ENTRYPOINT_ARGV ||
		value.transport?.method !== "POST" ||
		typeof value.transport?.path !== "string" ||
		value.transport.path.length === 0 ||
		createHash("sha256").update(value.transport.path).digest("hex") !== LEASED_CONSUMER_ATTACHMENT_STREAM_ROUTE_SHA256 ||
		value.response?.content_type !== "application/octet-stream" ||
		value.protected_session?.child_fd !== 4 ||
		value.protected_session.schema_version !== "ceal.leased_consumer_control_session.v1" ||
		value.operation_deadline_bounds_ms?.minimum > value.operation_deadline_bounds_ms?.maximum ||
		!isJsonRecord(value.stdin) ||
		!sameObjectKeys(value.stdin, ["maximum_bytes", "schema_version", "transport"]) ||
		value.stdin.transport !== "stdin_stdout_json" ||
		value.stdin.schema_version !== "ceal.worker_private_leased_consumer_attachment_stream_request.v1" ||
		value.stdin.maximum_bytes !== 32 * 1024 ||
		!isJsonRecord(value.result) ||
		!sameObjectKeys(value.result, ["allowed_error_codes", "maximum_bytes", "schema_version"]) ||
		value.result.schema_version !== "ceal.worker_private_leased_consumer_attachment_stream_result.v1" ||
		value.result.maximum_bytes !== 32 * 1024 ||
		!Array.isArray(value.result.allowed_error_codes) ||
		value.result.allowed_error_codes.length < 1 ||
		!value.result.allowed_error_codes.every((code) => typeof code === "string")
	)
		throw new Error("invalid_attachment_stream_contract");
	return value;
}

type CandidateContract = Readonly<{
	schema_version: string;
	argv: readonly [string];
	transport: Readonly<{ method: string; path: string; schema_version: string }>;
	response: Readonly<{ content_type: string }>;
	protected_session: Readonly<{ child_fd: number; schema_version: string; maximum_bytes: number; deadline_ms: number }>;
	operation_deadline_bounds_ms: Readonly<{ minimum: number; maximum: number }>;
	limits: Readonly<{ safety: Readonly<{ max_attachment_count: number; max_total_bytes: number }> }>;
	stdin: Readonly<{ transport: string; schema_version: string; maximum_bytes: number }>;
	result: Readonly<{ schema_version: string; maximum_bytes: number; allowed_error_codes: readonly string[] }>;
}>;

type CandidateStreamResponse = Awaited<ReturnType<typeof postUnixSocketStream>>;

const STREAM_ERROR_NAMES: UnixSocketErrorNames = Object.freeze({
	aborted: "attachment_stream_aborted",
	deadlineExceeded: "attachment_stream_deadline_exceeded",
	responseTooLarge: "attachment_stream_response_too_large",
	responseFailed: "attachment_stream_response_failed",
	requestFailed: "attachment_stream_request_failed",
});
