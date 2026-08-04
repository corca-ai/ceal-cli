import { createReadStream, fstatSync } from "node:fs";
import { request as httpRequest } from "node:http";
import {
	CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES,
	CEAL_LEASED_CONSUMER_CONTROL_MAX_SESSION_BYTES,
	type CealLeasedConsumerCapabilityControlOperation,
	decodeCealLeasedConsumerCapabilityControlRequest,
	decodeCealLeasedConsumerCapabilityControlResponse,
	decodeCealLeasedConsumerControlSession,
} from "@corca-ai/ceal-protocol";
import { LEASED_CONSUMER_CONTROL_SESSION_CONTRACT_JSON } from "./generated/leased-consumer-control-session-contract.js";

/** Not a public command: a service wrapper may invoke only this fixed token. */
const CONTROL_SESSION_CONTRACT = JSON.parse(LEASED_CONSUMER_CONTROL_SESSION_CONTRACT_JSON) as Readonly<{
	argv: readonly [string];
	protected_session: Readonly<{ child_fd: number; schema_version: string; maximum_bytes: number; deadline_ms: number }>;
	agent_ipc: Readonly<{
		transport: string;
		request_schema_version: string;
		response_schema_version: string;
		maximum_frame_bytes: number;
		serial: boolean;
	}>;
	gateway: Readonly<{
		transport: string;
		operation_deadline_ms: number;
		routes: Record<CealLeasedConsumerCapabilityControlOperation, string>;
	}>;
}>;
export const LEASED_CONSUMER_CONTROL_SESSION_ARGV = CONTROL_SESSION_CONTRACT.argv[0];
const PROTECTED_SESSION_DEADLINE_MS = CONTROL_SESSION_CONTRACT.protected_session.deadline_ms;
const OPERATION_DEADLINE_MS = CONTROL_SESSION_CONTRACT.gateway.operation_deadline_ms;
const PROTECTED_SESSION_FD = CONTROL_SESSION_CONTRACT.protected_session.child_fd;
const MAX_SESSION_BYTES = CONTROL_SESSION_CONTRACT.protected_session.maximum_bytes;
const MAX_FRAME_BYTES = CONTROL_SESSION_CONTRACT.agent_ipc.maximum_frame_bytes;
const ROUTES: Readonly<Record<CealLeasedConsumerCapabilityControlOperation, string>> = Object.freeze(
	CONTROL_SESSION_CONTRACT.gateway.routes,
);
assertEmbeddedControlSessionContract(CONTROL_SESSION_CONTRACT);

type ControlSession = Readonly<{ dispatch: (frame: Uint8Array) => Promise<Uint8Array> }>;
type UnixSocketResponse = Readonly<{ status: number; contentType: string | string[] | undefined; bytes: Uint8Array }>;

export interface LeasedConsumerControlSessionRuntime {
	/** Test seam only. The shipped carrier reads and closes protected FD 4. */
	readonly readProtectedSession?: () => Promise<Uint8Array>;
	/** Test seam only. The shipped carrier closes protected FD 4 exactly once. */
	readonly closeProtectedSession?: () => Promise<void>;
	/** Test seam only. The shipped carrier makes one fixed-route Unix-socket POST. */
	readonly requestUnixSocket?: (
		input: Readonly<{ socketPath: string; path: string; body: string; credential: string; deadlineMs: number }>,
	) => Promise<UnixSocketResponse>;
	/** Test seam only. The shipped carrier gives protected FD 4 two seconds. */
	readonly monotonicNow?: () => number;
	/** Test seam only. */
	readonly setTimer?: (callback: () => void, milliseconds: number) => unknown;
	/** Test seam only. */
	readonly clearTimer?: (timer: unknown) => void;
}

/**
 * Opens one credential-bearing Gateway control session. The returned object
 * accepts canonical Agent frames only; it never exposes the credential, socket
 * path, or a caller-selectable route to its caller.
 */
export async function openLeasedConsumerControlSession(runtime: LeasedConsumerControlSessionRuntime = {}): Promise<ControlSession> {
	let close = onceAsync(async () => {});
	try {
		const fd4 = runtime.readProtectedSession ? null : createProtectedFd4();
		close = onceAsync(runtime.closeProtectedSession ?? (() => fd4?.close() ?? Promise.resolve()));
		const bytes = await readProtectedSessionBeforeDeadline(
			runtime,
			runtime.readProtectedSession ?? (() => fd4?.read() ?? Promise.reject(new Error("missing_session"))),
			close,
		);
		if (bytes === null) throw new Error("session_unavailable");
		const session = decodeCealLeasedConsumerControlSession(parseStrictJson(bytes, MAX_SESSION_BYTES));
		return Object.freeze({
			dispatch: async (frame) => dispatch(session.socket_path, session.service_credential, frame, runtime),
		});
	} finally {
		await close();
	}
}

/**
 * Consumes one serial newline-framed inherited Agent stream. A malformed,
 * oversized, or transport-failed frame closes without a response and never
 * retries through a public/client session path.
 */
export async function runLeasedConsumerControlSession(
	stream: AsyncIterable<Uint8Array>,
	session: ControlSession,
	emit: (frame: Uint8Array) => void,
): Promise<boolean> {
	let pending = "";
	const decoder = new TextDecoder("utf-8", { fatal: true });
	try {
		for await (const chunk of stream) {
			if (!(chunk instanceof Uint8Array)) throw new Error("invalid_stream");
			pending += decoder.decode(chunk, { stream: true });
			if (Buffer.byteLength(pending, "utf8") > MAX_FRAME_BYTES) throw new Error("frame_too_large");
			for (;;) {
				const newline = pending.indexOf("\n");
				if (newline < 0) break;
				const text = pending.slice(0, newline);
				pending = pending.slice(newline + 1);
				if (text.length === 0 || text.endsWith("\r")) throw new Error("invalid_frame");
				const response = await session.dispatch(new TextEncoder().encode(text));
				emit(response);
			}
		}
		pending += decoder.decode();
		if (pending.length !== 0) throw new Error("unterminated_frame");
		return true;
	} catch {
		// The Agent receives no oracle for malformed frames or local transport
		// failures. Its inherited stream is simply closed by the caller.
		return false;
	}
}

async function readProtectedSessionBeforeDeadline(
	runtime: LeasedConsumerControlSessionRuntime,
	read: () => Promise<Uint8Array>,
	close: () => Promise<void>,
): Promise<Uint8Array | null> {
	const now = runtime.monotonicNow ?? monotonicNow;
	const setTimer = runtime.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
	const clearTimer = runtime.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
	const started = now();
	let timedOut = false;
	let timer: unknown;
	try {
		const pending = read();
		pending.catch(() => undefined);
		const timeout = new Promise<null>((resolve) => {
			timer = setTimer(() => {
				timedOut = true;
				void close();
				resolve(null);
			}, PROTECTED_SESSION_DEADLINE_MS);
		});
		const value = await Promise.race([pending, timeout]);
		if (timedOut || now() - started > PROTECTED_SESSION_DEADLINE_MS) return null;
		return value;
	} catch {
		return null;
	} finally {
		if (timer !== undefined) clearTimer(timer);
		await close();
	}
}

async function dispatch(
	socketPath: string,
	credential: string,
	frame: Uint8Array,
	runtime: LeasedConsumerControlSessionRuntime,
): Promise<Uint8Array> {
	const request = decodeCealLeasedConsumerCapabilityControlRequest(parseStrictJson(frame, MAX_FRAME_BYTES));
	const body = JSON.stringify(request);
	const response = await requestControlBeforeDeadline(runtime, () =>
		(runtime.requestUnixSocket ?? postUnixSocket)({
			socketPath,
			path: ROUTES[request.operation],
			body,
			credential,
			deadlineMs: OPERATION_DEADLINE_MS,
		}),
	);
	if (response.status !== 200 || !isJsonContentType(response.contentType) || response.bytes.byteLength > MAX_FRAME_BYTES)
		throw new Error("control_unavailable");
	const decoded = decodeCealLeasedConsumerCapabilityControlResponse(parseStrictJson(response.bytes, MAX_FRAME_BYTES));
	if (decoded.operation !== request.operation) throw new Error("operation_mismatch");
	return new TextEncoder().encode(`${JSON.stringify(decoded)}\n`);
}

async function requestControlBeforeDeadline(
	runtime: LeasedConsumerControlSessionRuntime,
	request: () => Promise<UnixSocketResponse>,
): Promise<UnixSocketResponse> {
	const now = runtime.monotonicNow ?? monotonicNow;
	const setTimer = runtime.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
	const clearTimer = runtime.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
	const started = now();
	let timedOut = false;
	let timer: unknown;
	try {
		const pending = request();
		pending.catch(() => undefined);
		const timeout = new Promise<null>((resolve) => {
			timer = setTimer(() => {
				timedOut = true;
				resolve(null);
			}, OPERATION_DEADLINE_MS);
		});
		const result = await Promise.race([pending, timeout]);
		if (timedOut || now() - started > OPERATION_DEADLINE_MS || result === null) throw new Error("control_deadline_exceeded");
		return result;
	} finally {
		if (timer !== undefined) clearTimer(timer);
	}
}

function createProtectedFd4(): Readonly<{ read: () => Promise<Uint8Array>; close: () => Promise<void> }> {
	if (!fstatSync(PROTECTED_SESSION_FD).isFIFO()) throw new Error("missing_session");
	const stream = createReadStream("/dev/null", { fd: PROTECTED_SESSION_FD, autoClose: true, highWaterMark: MAX_SESSION_BYTES });
	return Object.freeze({
		read: () => readBoundedStream(stream, MAX_SESSION_BYTES, () => stream.destroy()),
		close: () =>
			stream.destroyed
				? Promise.resolve()
				: new Promise<void>((resolve) => {
						stream.once("close", () => resolve());
						stream.destroy();
					}),
	});
}

async function readBoundedStream(stream: AsyncIterable<Uint8Array>, maximum: number, abort: () => void): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let total = 0;
	for await (const chunk of stream) {
		if (!(chunk instanceof Uint8Array) || chunk.byteLength > maximum - total) {
			abort();
			throw new Error("input_too_large");
		}
		total += chunk.byteLength;
		chunks.push(chunk);
	}
	const value = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		value.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return value;
}

function postUnixSocket(
	input: Readonly<{ socketPath: string; path: string; body: string; credential: string; deadlineMs: number }>,
): Promise<UnixSocketResponse> {
	const body = Buffer.from(input.body, "utf8");
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (action: () => void) => {
			if (!settled) {
				settled = true;
				action();
			}
		};
		const request = httpRequest(
			{
				socketPath: input.socketPath,
				path: input.path,
				method: "POST",
				headers: { Authorization: `Bearer ${input.credential}`, "Content-Type": "application/json", "Content-Length": String(body.byteLength) },
			},
			(response) => {
				const chunks: Buffer[] = [];
				let total = 0;
				response.on("data", (chunk: Buffer) => {
					total += chunk.byteLength;
					if (total > MAX_FRAME_BYTES) {
						request.destroy();
						finish(() => reject(new Error("response_too_large")));
						return;
					}
					chunks.push(chunk);
				});
				response.once("error", () => finish(() => reject(new Error("response_failed"))));
				response.once("end", () =>
					finish(() =>
						resolve({
							status: response.statusCode ?? 0,
							contentType: response.headers["content-type"],
							bytes: new Uint8Array(Buffer.concat(chunks)),
						}),
					),
				);
			},
		);
		request.setTimeout(input.deadlineMs, () => {
			request.destroy();
			finish(() => reject(new Error("request_deadline_exceeded")));
		});
		request.once("error", () => finish(() => reject(new Error("request_failed"))));
		request.end(body);
	});
}

function parseStrictJson(bytes: Uint8Array, maximum: number): unknown {
	if (bytes.byteLength === 0 || bytes.byteLength > maximum) throw new Error("invalid_json");
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	const value = JSON.parse(text) as unknown;
	assertNoDuplicateJsonKeys(text);
	return value;
}

function assertNoDuplicateJsonKeys(text: string): void {
	let index = 0;
	const space = () => {
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
		space();
		if (text[index] === "{") {
			index += 1;
			const keys = new Set<string>();
			space();
			if (text[index] === "}") {
				index += 1;
				return;
			}
			for (;;) {
				space();
				const key = string();
				if (keys.has(key)) throw new Error("duplicate_json_key");
				keys.add(key);
				space();
				if (text[index++] !== ":") throw new Error("invalid_json");
				value();
				space();
				if (text[index] === "}") {
					index += 1;
					return;
				}
				if (text[index++] !== ",") throw new Error("invalid_json");
			}
		}
		if (text[index] === "[") {
			index += 1;
			space();
			if (text[index] === "]") {
				index += 1;
				return;
			}
			for (;;) {
				value();
				space();
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
	space();
	if (index !== text.length) throw new Error("invalid_json");
}

function onceAsync(action: () => Promise<void>): () => Promise<void> {
	let pending: Promise<void> | undefined;
	return () => {
		pending ??= action().catch(() => undefined);
		return pending;
	};
}

function monotonicNow(): number {
	return performance.now();
}
function isJsonContentType(value: string | string[] | undefined): boolean {
	return typeof value === "string" && /^(?:application\/json)(?:\s*;|\s*$)/iu.test(value);
}

function assertEmbeddedControlSessionContract(
	value: Readonly<{
		argv: readonly [string];
		protected_session: Readonly<{ child_fd: number; schema_version: string; maximum_bytes: number; deadline_ms: number }>;
		agent_ipc: Readonly<{
			transport: string;
			request_schema_version: string;
			response_schema_version: string;
			maximum_frame_bytes: number;
			serial: boolean;
		}>;
		gateway: Readonly<{
			transport: string;
			operation_deadline_ms: number;
			routes: Record<CealLeasedConsumerCapabilityControlOperation, string>;
		}>;
	}>,
): void {
	if (
		value.argv[0] !== "--internal-leased-consumer-control-session" ||
		value.protected_session.child_fd !== 4 ||
		value.protected_session.schema_version !== "ceal.leased_consumer_control_session.v1" ||
		value.protected_session.maximum_bytes !== CEAL_LEASED_CONSUMER_CONTROL_MAX_SESSION_BYTES ||
		value.protected_session.deadline_ms !== 2_000 ||
		value.agent_ipc.transport !== "stdin_stdout_ndjson" ||
		value.agent_ipc.request_schema_version !== "ceal.leased_consumer_capability_control_request.v4" ||
		value.agent_ipc.response_schema_version !== "ceal.leased_consumer_capability_control_response.v4" ||
		value.agent_ipc.maximum_frame_bytes !== CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES ||
		value.agent_ipc.serial !== true ||
		value.gateway.transport !== "unix_socket" ||
		value.gateway.operation_deadline_ms !== 30_000 ||
		Object.keys(value.gateway.routes).length !== 5 ||
		Object.entries(ROUTES).some(
			([operation, route]) => value.gateway.routes[operation as CealLeasedConsumerCapabilityControlOperation] !== route,
		)
	)
		throw new Error("invalid_embedded_control_session_contract");
}
