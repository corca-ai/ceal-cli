import { isJsonRecord } from "./json-record.js";
import { assertLeasedConsumerAttachmentStreamBinding, LeasedConsumerAttachmentStreamError } from "./leased-consumer-attachment-stream.js";
import {
	consumeLeasedConsumerAttachmentStream,
	LEASED_CONSUMER_ATTACHMENT_STREAM_ENTRYPOINT_CONTRACT,
	LeasedConsumerAttachmentStreamCarrierError,
	type LeasedConsumerAttachmentStreamCarrierRuntime,
} from "./leased-consumer-attachment-stream-carrier.js";
import { sameObjectKeys } from "./object-keys.js";
import { readBoundedStream } from "./private-worker-transport.js";
import { parseStrictJson } from "./strict-json.js";
import { type CealLeasedConsumerAttachmentStreamBinding, decodeCealLeasedConsumerAttachmentStreamRequest } from "@corca-ai/ceal-protocol";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRYPOINT_KEYS = ["expected_binding", "request", "schema_version"] as const;
const ENTRYPOINT_RUNTIME_FAILURES = new Set(["session_unavailable", "transport_failed", "handoff_cleanup_failed", "handoff_write_failed"]);
const ENTRYPOINT_CONTRACT = LEASED_CONSUMER_ATTACHMENT_STREAM_ENTRYPOINT_CONTRACT;

interface JsonOutput {
	write(chunk: string): unknown;
}

export interface LeasedConsumerAttachmentStreamEntrypointRuntime extends LeasedConsumerAttachmentStreamCarrierRuntime {
	/** Test-only root seam; production creates a fresh root under the system temporary directory. */
	readonly createHandoffRoot?: () => string | Promise<string>;
}

/** Executes the Worker-owned private stdin/stdout JSON boundary for the attachment stream. */
export async function runLeasedConsumerAttachmentStreamEntrypoint(
	input: AsyncIterable<Uint8Array> = process.stdin,
	output: JsonOutput = process.stdout,
	runtime: LeasedConsumerAttachmentStreamEntrypointRuntime = {},
): Promise<number> {
	try {
		let bytes: Uint8Array;
		try {
			bytes = await readBoundedStream(input, ENTRYPOINT_CONTRACT.stdin.maximum_bytes);
		} catch {
			throw new EntrypointInputError("invalid_request");
		}
		const decoded = decodeEntrypointRequest(bytes);
		const handoff = await consumeLeasedConsumerAttachmentStream(
			{
				request: decoded.request,
				expected_binding: decoded.expected_binding,
				createHandoffRoot: runtime.createHandoffRoot ?? (() => mkdtemp(join(tmpdir(), "ceal-worker-attachment-handoff-"))),
			},
			runtime,
		);
		const result = { schema_version: ENTRYPOINT_CONTRACT.result.schema_version, ok: true, status: "handoff_ready", handoff };
		if (!writeJson(output, result)) {
			const cleanupSucceeded = await cleanupOversizedHandoff(handoff);
			return writeRuntimeFailure(output, cleanupSucceeded ? "handoff_write_failed" : "handoff_cleanup_failed");
		}
		return 0;
	} catch (error) {
		const errorCode = publicErrorCode(error);
		const result = {
			schema_version: ENTRYPOINT_CONTRACT.result.schema_version,
			ok: false,
			status: ENTRYPOINT_RUNTIME_FAILURES.has(errorCode) ? "unavailable" : "error",
			error_code: errorCode,
		};
		if (!writeJson(output, result)) return writeRuntimeFailure(output, "handoff_write_failed");
		return ENTRYPOINT_RUNTIME_FAILURES.has(errorCode) ? 3 : 2;
	}
}

function decodeEntrypointRequest(bytes: Uint8Array): Readonly<{
	readonly request: ReturnType<typeof decodeCealLeasedConsumerAttachmentStreamRequest>;
	readonly expected_binding: CealLeasedConsumerAttachmentStreamBinding;
}> {
	let value: unknown;
	try {
		value = parseStrictJson(bytes, ENTRYPOINT_CONTRACT.stdin.maximum_bytes);
	} catch {
		throw new EntrypointInputError("invalid_request");
	}
	if (!isJsonRecord(value) || !sameObjectKeys(value, ENTRYPOINT_KEYS) || value.schema_version !== ENTRYPOINT_CONTRACT.stdin.schema_version)
		throw new EntrypointInputError("invalid_request");
	let request: ReturnType<typeof decodeCealLeasedConsumerAttachmentStreamRequest>;
	try {
		request = decodeCealLeasedConsumerAttachmentStreamRequest(value.request);
	} catch {
		throw new EntrypointInputError("invalid_request");
	}
	try {
		assertLeasedConsumerAttachmentStreamBinding(value.expected_binding);
	} catch {
		throw new EntrypointInputError("invalid_expected_binding");
	}
	return { request, expected_binding: value.expected_binding };
}

function publicErrorCode(error: unknown): string {
	if (error instanceof EntrypointInputError) return error.code;
	const candidate =
		error instanceof LeasedConsumerAttachmentStreamCarrierError || error instanceof LeasedConsumerAttachmentStreamError
			? error.code
			: "transport_failed";
	return ENTRYPOINT_CONTRACT.result.allowed_error_codes.includes(candidate) ? candidate : "stream_invalid";
}

function writeJson(output: JsonOutput, value: Readonly<Record<string, unknown>>): boolean {
	const serialized = serializeLeasedConsumerAttachmentStreamResult(value);
	if (serialized === null) return false;
	output.write(serialized);
	return true;
}

function writeRuntimeFailure(output: JsonOutput, errorCode: "handoff_cleanup_failed" | "handoff_write_failed"): number {
	const written = writeJson(output, {
		schema_version: ENTRYPOINT_CONTRACT.result.schema_version,
		ok: false,
		status: "unavailable",
		error_code: errorCode,
	});
	if (!written) throw new Error("attachment_stream_result_contract_unwritable");
	return 3;
}

/** @testOnly */
export function serializeLeasedConsumerAttachmentStreamResult(value: Readonly<Record<string, unknown>>): string | null {
	const json = JSON.stringify(value);
	if (json === undefined) return null;
	const serialized = `${json}\n`;
	return new TextEncoder().encode(serialized).byteLength <= ENTRYPOINT_CONTRACT.result.maximum_bytes ? serialized : null;
}

async function cleanupOversizedHandoff(value: unknown): Promise<boolean> {
	if (!isJsonRecord(value) || typeof value.handoff_root !== "string") return false;
	try {
		await rm(value.handoff_root, { recursive: true, force: true });
		return true;
	} catch {
		return false;
	}
}

class EntrypointInputError extends Error {
	readonly code: "invalid_request" | "invalid_expected_binding";

	constructor(code: "invalid_request" | "invalid_expected_binding") {
		super("The private leased-consumer attachment-stream request is invalid");
		this.name = "EntrypointInputError";
		this.code = code;
	}
}
