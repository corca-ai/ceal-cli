import { createHash } from "node:crypto";
import { createReadStream, fstatSync } from "node:fs";
import {
	LEASED_CONSUMER_CARRIER_CONTRACT_JSON,
	LEASED_CONSUMER_CARRIER_CONTRACT_SHA256,
} from "./generated/leased-consumer-carrier-contract.js";
import {
	GATEWAY_LEASED_CONSUMER_HANDOFF_JSON,
	GATEWAY_LEASED_CONSUMER_HANDOFF_LOCK_JSON,
	GATEWAY_LEASED_CONSUMER_HANDOFF_SHA256,
} from "./generated/leased-consumer-handoff.js";
import {
	closeReadable,
	concatBytes,
	isJsonContentType,
	onceAsync,
	postUnixSocket,
	raceDeadline,
	readBeforeDeadline,
	readBoundedStream,
	type UnixSocketErrorNames,
	type UnixSocketResponse,
} from "./private-worker-transport.js";

const CARRIER_CONTRACT = verifyEmbeddedCarrierContract();
const CHANNEL_SCHEMAS = CARRIER_CONTRACT.serviceChannelSchemas;
const RESULT_SCHEMA = CARRIER_CONTRACT.resultSchema;
const MAX_CHANNEL_BYTES = CARRIER_CONTRACT.maximumChannelBytes;
const MAX_REQUEST_BYTES = CARRIER_CONTRACT.maximumRequestBytes;
const MAX_RESPONSE_BYTES = CARRIER_CONTRACT.maximumResultBytes;
const CHANNEL_DEADLINE_MS = CARRIER_CONTRACT.channelDeadlineMs;
/** Bounds the outbound call, not the FD4 read. Two deadlines, two concepts, two contract keys. */
const SERVICE_CALL_DEADLINE_MS = CARRIER_CONTRACT.serviceCallDeadlineMs;
/** The carrier answers a result envelope rather than stderr, so these stay internal. */
const SOCKET_ERROR_NAMES = Object.freeze({
	aborted: "socket_request_aborted",
	deadlineExceeded: "socket_request_deadline_exceeded",
	responseTooLarge: "response_too_large",
	responseFailed: "socket_response_failed",
	requestFailed: "socket_request_failed",
});
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

/** Internal-only argv token; derived from the signed release contract and absent from the public command registry. */
export const LEASED_CONSUMER_CARRIER_ARGV = CARRIER_CONTRACT.argv;

type JsonRecord = Record<string, unknown>;

export type LeasedConsumerCarrierResult =
	| {
			readonly schema_version: typeof RESULT_SCHEMA;
			readonly ok: false;
			readonly status: "unavailable";
			readonly error_code: "service_channel_unavailable";
	  }
	| {
			readonly schema_version: typeof RESULT_SCHEMA;
			readonly ok: false;
			readonly status: "unavailable";
			readonly error_code: "leased_consumer_call_unavailable";
	  }
	| {
			readonly schema_version: typeof RESULT_SCHEMA;
			readonly ok: false;
			readonly status: "error";
			readonly error_code: "invalid_request" | "service_call_failed";
	  };

export interface LeasedConsumerCarrierRuntime {
	/** Test seam only. The shipped command reads FD 4 and closes it itself. */
	readonly readChannel?: () => Promise<Uint8Array>;
	/** Test seam only. The shipped command closes FD 4. */
	readonly closeChannel?: () => Promise<void>;
	readonly fetchFn?: typeof globalThis.fetch;
	readonly monotonicNow?: () => number;
	readonly setTimer?: (callback: () => void, ms: number) => unknown;
	readonly clearTimer?: (timer: unknown) => void;
	/** Test-only URL validator; the shipped command always requires HTTPS. */
	readonly validateServiceUrl?: (value: string, requiredPath: string) => URL;
	/** Test seam only. The shipped command uses one fixed-path Unix socket POST. */
	readonly requestUnixSocket?: (input: {
		readonly socketPath: string;
		readonly path: string;
		readonly method: string;
		readonly credential: string;
		readonly body: string;
		readonly deadlineMs: number;
		readonly maximumResponseBytes: number;
		readonly errors: UnixSocketErrorNames;
		readonly signal: AbortSignal;
	}) => Promise<UnixSocketResponse>;
	/** Test seam only; the shipped command always verifies the generated handoff. */
	readonly loadHandoff?: () => CarrierHandoff;
}

/**
 * The internal worker mode's whole authority surface. It has neither argv nor
 * environment inputs for the endpoint/credential, and does not receive a
 * session, profile, cache, or public Ceal HTTP transport.
 */
export async function runLeasedConsumerCarrier(
	requestBytes: Uint8Array,
	runtime: LeasedConsumerCarrierRuntime = {},
): Promise<LeasedConsumerCarrierResult> {
	let closeChannel = onceAsync(async () => {});
	try {
		const fd4 = runtime.readChannel ? null : createFd4Channel();
		closeChannel = onceAsync(runtime.closeChannel ?? (() => fd4?.close() ?? Promise.resolve()));
		let handoff: CarrierHandoff;
		try {
			handoff = runtime.loadHandoff?.() ?? verifyEmbeddedHandoff();
		} catch {
			return localFailure("service_call_failed");
		}
		let request: JsonRecord;
		try {
			request = parseCarrierRequest(requestBytes, handoff);
		} catch {
			return localFailure("invalid_request");
		}
		const channelBytes = await readChannelBeforeDeadline({
			...runtime,
			readChannel: runtime.readChannel ?? (() => fd4?.read() ?? Promise.reject(new Error("missing_channel"))),
			closeChannel,
		});
		if (channelBytes === null) return localFailure("service_channel_unavailable");
		let channel: ServiceChannel;
		try {
			channel = parseServiceChannel(channelBytes, handoff.servicePath, runtime.validateServiceUrl ?? validateProductionServiceUrl);
		} catch {
			return localFailure("service_channel_unavailable");
		}
		try {
			const responseBytes = await sendCarrierRequestBeforeDeadline(channel, request, handoff, runtime);
			if (responseBytes === null) return localFailure("service_call_failed");
			const decoded = parseStrictJson(responseBytes);
			if (!sameJson(decoded, handoff.unavailableBody)) return localFailure("service_call_failed");
			return localFailure("leased_consumer_call_unavailable");
		} catch {
			return localFailure("service_call_failed");
		}
	} catch {
		return localFailure("service_channel_unavailable");
	} finally {
		await closeChannel();
	}
}

/** Reads one exact UTF-8 JSON request to EOF without retaining more than 32 KiB. */
export async function readLeasedConsumerRequest(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
	return readBoundedStream(stream, MAX_REQUEST_BYTES);
}

function localFailure(errorCode: LeasedConsumerCarrierResult["error_code"]): LeasedConsumerCarrierResult {
	return errorCode === "leased_consumer_call_unavailable"
		? { schema_version: RESULT_SCHEMA, ok: false, status: "unavailable", error_code: errorCode }
		: errorCode === "service_channel_unavailable"
			? { schema_version: RESULT_SCHEMA, ok: false, status: "unavailable", error_code: errorCode }
			: { schema_version: RESULT_SCHEMA, ok: false, status: "error", error_code: errorCode };
}

async function readChannelBeforeDeadline(runtime: LeasedConsumerCarrierRuntime): Promise<Uint8Array | null> {
	const readChannel = runtime.readChannel ?? (() => Promise.reject(new Error("missing_channel")));
	const closeChannel = onceAsync(runtime.closeChannel ?? (async () => {}));
	return readBeforeDeadline(runtime, CHANNEL_DEADLINE_MS, readChannel, closeChannel);
}

/**
 * Bounds the one outbound service call. Without this the carrier waits forever on
 * a peer that accepts the connection and never answers, and the worker never
 * emits an envelope. Aborting on expiry also tears the socket down, so the
 * deadline releases the process rather than only releasing this promise.
 */
async function sendCarrierRequestBeforeDeadline(
	channel: ServiceChannel,
	request: JsonRecord,
	handoff: CarrierHandoff,
	runtime: LeasedConsumerCarrierRuntime,
): Promise<Uint8Array | null> {
	const controller = new AbortController();
	try {
		const outcome = await raceDeadline(
			runtime,
			SERVICE_CALL_DEADLINE_MS,
			sendCarrierRequest(channel, request, handoff, runtime, controller.signal),
			() => controller.abort(),
		);
		return outcome.settled ? outcome.value : null;
	} finally {
		controller.abort();
	}
}

function createFd4Channel(): { readonly read: () => Promise<Uint8Array>; readonly close: () => Promise<void> } {
	// `fd` prevents opening this placeholder path. A 8KiB high-water mark keeps
	// the pipe reader bounded even before the record cap rejects a second chunk.
	// The stream owns FD 4: destroying it first and waiting for `close` avoids a
	// concurrent raw close while libuv still has a read in flight.
	// Probe before creating a libuv reader. The launch contract supplies a pipe:
	// accepting an arbitrary inherited descriptor would not be a protected
	// one-shot channel, and can make libuv abort when a host-reserved FD closes.
	if (!fstatSync(4).isFIFO()) throw new Error("missing_channel");
	const stream = createReadStream("/dev/null", { fd: 4, autoClose: true, highWaterMark: MAX_CHANNEL_BYTES });
	return {
		read: () => readBoundedStream(stream, MAX_CHANNEL_BYTES, () => stream.destroy()),
		close: () => closeReadable(stream),
	};
}

function parseCarrierRequest(bytes: Uint8Array, handoff: CarrierHandoff): JsonRecord {
	if (bytes.byteLength > MAX_REQUEST_BYTES) throw new Error("request_too_large");
	const value = parseStrictJson(bytes);
	if (!plainRecord(value) || !sameKeys(value, handoff.requestKeys)) throw new Error("invalid_request");
	const template = handoff.requestTemplate;
	for (const key of handoff.requestKeys) {
		if (key === "lease_fence") {
			if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1) throw new Error("invalid_request");
			continue;
		}
		if (key === "arguments") {
			if (!plainJson(value[key])) throw new Error("invalid_request");
			continue;
		}
		if (typeof value[key] !== "string") throw new Error("invalid_request");
		if (key === "purpose") {
			if (
				Buffer.byteLength(value[key] as string, "utf8") < 1 ||
				Buffer.byteLength(value[key] as string, "utf8") > 4096 ||
				hasControlCharacter(value[key] as string)
			)
				throw new Error("invalid_request");
			continue;
		}
		if (!SAFE_REF.test(value[key] as string)) throw new Error("invalid_request");
		if (key === "schema_version" && value[key] !== template[key]) throw new Error("invalid_request");
	}
	return value;
}

async function sendCarrierRequest(
	channel: ServiceChannel,
	request: JsonRecord,
	handoff: CarrierHandoff,
	runtime: LeasedConsumerCarrierRuntime,
	signal: AbortSignal,
): Promise<Uint8Array | null> {
	const body = JSON.stringify(request);
	if (channel.kind === "https") {
		const fetchFn = runtime.fetchFn ?? globalThis.fetch;
		if (typeof fetchFn !== "function") return null;
		const response = await fetchFn(channel.url, {
			method: handoff.method,
			headers: { Authorization: `Bearer ${channel.credential}`, "Content-Type": "application/json" },
			body,
			redirect: "error",
			signal,
		});
		if (response.status !== handoff.unavailableStatus || !isJsonContentType(response.headers.get("content-type"))) return null;
		return readBoundedWebResponse(response, MAX_RESPONSE_BYTES);
	}
	const response = await (runtime.requestUnixSocket ?? postUnixSocket)({
		socketPath: channel.socketPath,
		path: handoff.servicePath,
		method: handoff.method,
		credential: channel.credential,
		body,
		deadlineMs: SERVICE_CALL_DEADLINE_MS,
		maximumResponseBytes: MAX_RESPONSE_BYTES,
		errors: SOCKET_ERROR_NAMES,
		signal,
	});
	if (response.status !== handoff.unavailableStatus || !isJsonContentType(response.contentType)) return null;
	if (response.bytes.byteLength > MAX_RESPONSE_BYTES) return null;
	return response.bytes;
}

function parseServiceChannel(bytes: Uint8Array, requiredPath: string, validateUrl: (value: string, path: string) => URL): ServiceChannel {
	if (bytes.byteLength > MAX_CHANNEL_BYTES) throw new Error("channel_too_large");
	const value = parseStrictJson(bytes);
	if (!plainRecord(value) || typeof value.schema_version !== "string" || !CHANNEL_SCHEMAS.includes(value.schema_version))
		throw new Error("invalid_channel");
	if (value.schema_version === "ceal.leased_consumer_service_channel.v1") {
		if (!sameKeys(value, ["schema_version", "service_call_url", "service_credential"]) || typeof value.service_call_url !== "string")
			throw new Error("invalid_channel");
		return { kind: "https", url: validateUrl(value.service_call_url, requiredPath), credential: validCredential(value.service_credential) };
	}
	if (
		!sameKeys(value, ["schema_version", "service_credential", "socket_path", "transport"]) ||
		value.transport !== "unix_socket" ||
		typeof value.socket_path !== "string"
	)
		throw new Error("invalid_channel");
	return { kind: "unix_socket", socketPath: validSocketPath(value.socket_path), credential: validCredential(value.service_credential) };
}

function validCredential(value: unknown): string {
	if (
		typeof value !== "string" ||
		Buffer.byteLength(value, "utf8") === 0 ||
		Buffer.byteLength(value, "utf8") > 4096 ||
		!/^[\x21-\x7e]+$/u.test(value)
	)
		throw new Error("invalid_channel");
	return value;
}

function validSocketPath(value: string): string {
	if (!value.startsWith("/") || value.length > 1024 || /[\r\n\0]/u.test(value) || value.endsWith("/admin-gateway.sock"))
		throw new Error("invalid_channel");
	return value;
}

function validateProductionServiceUrl(value: string, requiredPath: string): URL {
	const url = new URL(value);
	if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== requiredPath)
		throw new Error("invalid_channel");
	return url;
}

function verifyEmbeddedHandoff(): CarrierHandoff {
	const lock = parseStrictJson(new TextEncoder().encode(GATEWAY_LEASED_CONSUMER_HANDOFF_LOCK_JSON));
	const handoff = parseStrictJson(new TextEncoder().encode(GATEWAY_LEASED_CONSUMER_HANDOFF_JSON));
	if (
		!plainRecord(lock) ||
		!plainRecord(handoff) ||
		!plainRecord(lock.handoff) ||
		lock.schema_version !== "ceal.worker_gateway_leased_consumer_call_handoff_lock.v1"
	)
		throw new Error("invalid_handoff");
	const pinned = lock.handoff;
	if (
		typeof pinned.sha256 !== "string" ||
		pinned.sha256 !== GATEWAY_LEASED_CONSUMER_HANDOFF_SHA256 ||
		createHash("sha256").update(GATEWAY_LEASED_CONSUMER_HANDOFF_JSON).digest("hex") !== pinned.sha256 ||
		typeof pinned.source_repository !== "string" ||
		typeof pinned.source_commit !== "string" ||
		typeof pinned.source_tree !== "string" ||
		!Array.isArray(pinned.vector_ids) ||
		!pinned.vector_ids.every((id) => typeof id === "string")
	)
		throw new Error("invalid_handoff");
	if (
		handoff.schema_version !== "ceal.gateway_leased_consumer_call_conformance_handoff.v1" ||
		!plainRecord(handoff.source) ||
		handoff.source.repository !== pinned.source_repository ||
		handoff.source.commit !== pinned.source_commit ||
		handoff.source.tree !== pinned.source_tree ||
		!plainRecord(handoff.transport) ||
		typeof handoff.transport.method !== "string" ||
		typeof handoff.transport.service_path !== "string" ||
		!plainRecord(handoff.transport.required_headers) ||
		handoff.transport.required_headers.authorization !== "Bearer <protected-service-credential>" ||
		handoff.transport.required_headers.content_type !== "application/json" ||
		!Array.isArray(handoff.vectors)
	)
		throw new Error("invalid_handoff");
	const ids = handoff.vectors.map((vector) => (plainRecord(vector) ? vector.id : null));
	if (!sameStringSet(ids, pinned.vector_ids)) throw new Error("invalid_handoff");
	const positive = handoff.vectors.find(
		(vector) => plainRecord(vector) && plainRecord(vector.external_response) && vector.external_response.status === 503,
	);
	if (
		!plainRecord(positive) ||
		!plainRecord(positive.request_body) ||
		!plainRecord(positive.external_response) ||
		!plainRecord(positive.external_response.body)
	)
		throw new Error("invalid_handoff");
	if (positive.external_response.body.ok !== false || positive.external_response.body.error_code !== "leased_consumer_call_unavailable")
		throw new Error("invalid_handoff");
	return {
		method: handoff.transport.method,
		servicePath: handoff.transport.service_path,
		requestTemplate: positive.request_body,
		requestKeys: Object.keys(positive.request_body).sort(),
		unavailableStatus: positive.external_response.status,
		unavailableBody: positive.external_response.body,
	};
}

function verifyEmbeddedCarrierContract(): CarrierContract {
	const bytes = new TextEncoder().encode(LEASED_CONSUMER_CARRIER_CONTRACT_JSON);
	if (createHash("sha256").update(bytes).digest("hex") !== LEASED_CONSUMER_CARRIER_CONTRACT_SHA256)
		throw new Error("invalid_carrier_contract");
	const value = parseStrictJson(bytes);
	if (
		!plainRecord(value) ||
		!sameKeys(value, ["argv", "non_claims", "result", "schema_version", "service_call", "service_channel", "stdin"]) ||
		value.schema_version !== "ceal.worker_private_leased_consumer_carrier_contract.v2" ||
		!Array.isArray(value.argv) ||
		value.argv.length !== 1 ||
		typeof value.argv[0] !== "string" ||
		!plainRecord(value.stdin) ||
		!sameKeys(value.stdin, ["maximum_bytes", "schema_version"]) ||
		value.stdin.schema_version !== "ceal.gateway_leased_consumer_call_request.v1" ||
		!Number.isSafeInteger(value.stdin.maximum_bytes) ||
		!plainRecord(value.service_channel) ||
		!sameKeys(value.service_channel, ["child_fd", "deadline_ms", "maximum_bytes", "schema_versions"]) ||
		value.service_channel.child_fd !== 4 ||
		!Array.isArray(value.service_channel.schema_versions) ||
		value.service_channel.schema_versions.length !== 2 ||
		value.service_channel.schema_versions[0] !== "ceal.leased_consumer_service_channel.v1" ||
		value.service_channel.schema_versions[1] !== "ceal.leased_consumer_service_channel.v2" ||
		!Number.isSafeInteger(value.service_channel.maximum_bytes) ||
		!Number.isSafeInteger(value.service_channel.deadline_ms) ||
		!plainRecord(value.service_call) ||
		!sameKeys(value.service_call, ["deadline_ms"]) ||
		!Number.isSafeInteger(value.service_call.deadline_ms) ||
		(value.service_call.deadline_ms as number) < 1 ||
		!plainRecord(value.result) ||
		!sameKeys(value.result, ["allowed_error_codes", "maximum_bytes", "schema_version"]) ||
		typeof value.result.schema_version !== "string" ||
		!Number.isSafeInteger(value.result.maximum_bytes) ||
		!Array.isArray(value.result.allowed_error_codes) ||
		!value.result.allowed_error_codes.every((code) => typeof code === "string")
	)
		throw new Error("invalid_carrier_contract");
	const allowedErrors = new Set(value.result.allowed_error_codes);
	if (
		!allowedErrors.has("invalid_request") ||
		!allowedErrors.has("leased_consumer_call_unavailable") ||
		!allowedErrors.has("service_call_failed") ||
		!allowedErrors.has("service_channel_unavailable")
	)
		throw new Error("invalid_carrier_contract");
	return {
		argv: value.argv[0],
		maximumRequestBytes: value.stdin.maximum_bytes as number,
		serviceChannelSchemas: value.service_channel.schema_versions as readonly string[],
		maximumChannelBytes: value.service_channel.maximum_bytes as number,
		channelDeadlineMs: value.service_channel.deadline_ms as number,
		serviceCallDeadlineMs: value.service_call.deadline_ms as number,
		resultSchema: value.result.schema_version,
		maximumResultBytes: value.result.maximum_bytes as number,
	};
}

async function readBoundedWebResponse(response: globalThis.Response, maximum: number): Promise<Uint8Array> {
	if (!response.body) throw new Error("missing_body");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return concatBytes(chunks, total);
			if (!value || value.byteLength > maximum - total) {
				void reader.cancel();
				throw new Error("response_too_large");
			}
			total += value.byteLength;
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
}

function parseStrictJson(bytes: Uint8Array): unknown {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	const value = JSON.parse(text) as unknown;
	assertNoDuplicateJsonKeys(text);
	return value;
}

function assertNoDuplicateJsonKeys(text: string): void {
	let index = 0;
	const whitespace = () => {
		while (/\s/u.test(text[index] ?? "")) index += 1;
	};
	const string = () => {
		const start = index;
		if (text[index] !== '"') throw new Error("invalid_json");
		index += 1;
		while (index < text.length) {
			const character = text[index];
			if (character === "\\") index += 2;
			else {
				index += 1;
				if (character === '"') return JSON.parse(text.slice(start, index)) as string;
			}
		}
		throw new Error("invalid_json");
	};
	const value = (): void => {
		whitespace();
		if (text[index] === "{") {
			index += 1;
			const keys = new Set<string>();
			whitespace();
			if (text[index] === "}") {
				index += 1;
				return;
			}
			for (;;) {
				whitespace();
				const key = string();
				if (keys.has(key)) throw new Error("duplicate_json_key");
				keys.add(key);
				whitespace();
				if (text[index++] !== ":") throw new Error("invalid_json");
				value();
				whitespace();
				if (text[index] === "}") {
					index += 1;
					return;
				}
				if (text[index++] !== ",") throw new Error("invalid_json");
			}
		}
		if (text[index] === "[") {
			index += 1;
			whitespace();
			if (text[index] === "]") {
				index += 1;
				return;
			}
			for (;;) {
				value();
				whitespace();
				if (text[index] === "]") {
					index += 1;
					return;
				}
				if (text[index++] !== ",") throw new Error("invalid_json");
			}
		}
		if (text[index] === '"') {
			string();
			return;
		}
		const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(text.slice(index));
		if (!match) throw new Error("invalid_json");
		index += match[0].length;
	};
	value();
	whitespace();
	if (index !== text.length) throw new Error("invalid_json");
}

function plainRecord(value: unknown): value is JsonRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function plainJson(value: unknown, depth = 0): boolean {
	if (depth > 32 || value === null || typeof value === "string" || typeof value === "boolean") return depth <= 32;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.length <= 1024 && value.every((item) => plainJson(item, depth + 1));
	return plainRecord(value) && Object.keys(value).length <= 1024 && Object.values(value).every((item) => plainJson(item, depth + 1));
}

function sameKeys(value: JsonRecord, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function sameStringSet(left: readonly unknown[], right: readonly unknown[]): boolean {
	return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function sameJson(left: unknown, right: unknown): boolean {
	return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function canonicalJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalJson);
	if (!plainRecord(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonicalJson(value[key])]),
	);
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code <= 0x1f || code === 0x7f;
	});
}

type ServiceChannel =
	| {
			readonly kind: "https";
			readonly url: URL;
			readonly credential: string;
	  }
	| {
			readonly kind: "unix_socket";
			readonly socketPath: string;
			readonly credential: string;
	  };

interface CarrierHandoff {
	readonly method: string;
	readonly servicePath: string;
	readonly requestTemplate: JsonRecord;
	readonly requestKeys: readonly string[];
	readonly unavailableStatus: unknown;
	readonly unavailableBody: JsonRecord;
}

interface CarrierContract {
	readonly argv: string;
	readonly maximumRequestBytes: number;
	readonly serviceChannelSchemas: readonly string[];
	readonly maximumChannelBytes: number;
	readonly channelDeadlineMs: number;
	readonly serviceCallDeadlineMs: number;
	readonly resultSchema: string;
	readonly maximumResultBytes: number;
}
