import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CealLeasedConsumerAttachmentStreamBinding, decodeCealLeasedConsumerAttachmentStreamRequest } from "@corca-ai/ceal-protocol";
import { assertLeasedConsumerAttachmentStreamBinding, LeasedConsumerAttachmentStreamError } from "./leased-consumer-attachment-stream.js";
import {
	consumeLeasedConsumerAttachmentStream,
	LEASED_CONSUMER_ATTACHMENT_STREAM_ENTRYPOINT_CONTRACT,
	LeasedConsumerAttachmentStreamCarrierError,
	type LeasedConsumerAttachmentStreamCarrierRuntime,
} from "./leased-consumer-attachment-stream-carrier.js";
import { readBoundedStream } from "./private-worker-transport.js";
import { parseStrictJson } from "./strict-json.js";

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
		writeJson(output, { schema_version: ENTRYPOINT_CONTRACT.result.schema_version, ok: true, status: "handoff_ready", handoff });
		return 0;
	} catch (error) {
		const errorCode = publicErrorCode(error);
		writeJson(output, {
			schema_version: ENTRYPOINT_CONTRACT.result.schema_version,
			ok: false,
			status: ENTRYPOINT_RUNTIME_FAILURES.has(errorCode) ? "unavailable" : "error",
			error_code: errorCode,
		});
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
	if (!isRecord(value) || !sameKeys(value, ENTRYPOINT_KEYS) || value.schema_version !== ENTRYPOINT_CONTRACT.stdin.schema_version)
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

function writeJson(output: JsonOutput, value: Readonly<Record<string, unknown>>): void {
	output.write(`${JSON.stringify(value)}\n`);
}

function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	return Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

class EntrypointInputError extends Error {
	readonly code: "invalid_request" | "invalid_expected_binding";

	constructor(code: "invalid_request" | "invalid_expected_binding") {
		super("The private leased-consumer attachment-stream request is invalid");
		this.name = "EntrypointInputError";
		this.code = code;
	}
}
