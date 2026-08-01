import { createReadStream, fstatSync } from "node:fs";
import { request as httpRequest } from "node:http";
import {
	CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES,
	CEAL_LEASED_CONSUMER_CONTROL_MAX_SESSION_BYTES,
	type CealLeasedConsumerControlOperation,
	decodeCealLeasedConsumerControlRequest,
	decodeCealLeasedConsumerControlResponse,
	decodeCealLeasedConsumerControlSession,
} from "@corca-ai/ceal-protocol";

/** Not a public command: a service wrapper may invoke only this fixed token. */
export const LEASED_CONSUMER_CONTROL_SESSION_ARGV = "--internal-leased-consumer-control-session";

const SOCKET_PATH = "/run/ceal/leased-consumer-control-v1.sock";
const ROUTES: Readonly<Record<CealLeasedConsumerControlOperation, string>> = Object.freeze({
	acquire: "/api/ceal/agent/v1/control/acquire",
	projection: "/api/ceal/agent/v1/control/projection",
	recheck: "/api/ceal/agent/v1/control/recheck",
	call: "/api/ceal/agent/v1/call",
	complete: "/api/ceal/agent/v1/control/complete",
});

type ControlSession = Readonly<{ dispatch: (frame: Uint8Array) => Promise<Uint8Array> }>;
type UnixSocketResponse = Readonly<{ status: number; contentType: string | string[] | undefined; bytes: Uint8Array }>;

export interface LeasedConsumerControlSessionRuntime {
	/** Test seam only. The shipped carrier reads and closes protected FD 4. */
	readonly readProtectedSession?: () => Promise<Uint8Array>;
	/** Test seam only. The shipped carrier closes protected FD 4 exactly once. */
	readonly closeProtectedSession?: () => Promise<void>;
	/** Test seam only. The shipped carrier makes one fixed-route Unix-socket POST. */
	readonly requestUnixSocket?: (
		input: Readonly<{ socketPath: string; path: string; body: string; credential: string }>,
	) => Promise<UnixSocketResponse>;
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
		const bytes = await (runtime.readProtectedSession ?? (() => fd4?.read() ?? Promise.reject(new Error("missing_session"))))();
		const session = decodeCealLeasedConsumerControlSession(parseStrictJson(bytes, CEAL_LEASED_CONSUMER_CONTROL_MAX_SESSION_BYTES));
		if (session.socket_path !== SOCKET_PATH) throw new Error("unexpected_socket");
		return Object.freeze({
			dispatch: async (frame) => dispatch(session.service_credential, frame, runtime),
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
): Promise<void> {
	let pending = "";
	const decoder = new TextDecoder("utf-8", { fatal: true });
	try {
		for await (const chunk of stream) {
			if (!(chunk instanceof Uint8Array)) throw new Error("invalid_stream");
			pending += decoder.decode(chunk, { stream: true });
			if (Buffer.byteLength(pending, "utf8") > CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES) throw new Error("frame_too_large");
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
	} catch {
		// The Agent receives no oracle for malformed frames or local transport
		// failures. Its inherited stream is simply closed by the caller.
	}
}

async function dispatch(credential: string, frame: Uint8Array, runtime: LeasedConsumerControlSessionRuntime): Promise<Uint8Array> {
	const request = decodeCealLeasedConsumerControlRequest(parseStrictJson(frame, CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES));
	const body = JSON.stringify(request);
	const response = await (runtime.requestUnixSocket ?? postUnixSocket)({
		socketPath: SOCKET_PATH,
		path: ROUTES[request.operation],
		body,
		credential,
	});
	if (
		response.status !== 200 ||
		!isJsonContentType(response.contentType) ||
		response.bytes.byteLength > CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES
	)
		throw new Error("control_unavailable");
	const decoded = decodeCealLeasedConsumerControlResponse(parseStrictJson(response.bytes, CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES));
	if (decoded.operation !== request.operation) throw new Error("operation_mismatch");
	return new TextEncoder().encode(`${JSON.stringify(decoded)}\n`);
}

function createProtectedFd4(): Readonly<{ read: () => Promise<Uint8Array>; close: () => Promise<void> }> {
	if (!fstatSync(4).isFIFO()) throw new Error("missing_session");
	const stream = createReadStream("/dev/null", { fd: 4, autoClose: true, highWaterMark: CEAL_LEASED_CONSUMER_CONTROL_MAX_SESSION_BYTES });
	return Object.freeze({
		read: () => readBoundedStream(stream, CEAL_LEASED_CONSUMER_CONTROL_MAX_SESSION_BYTES, () => stream.destroy()),
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
	input: Readonly<{ socketPath: string; path: string; body: string; credential: string }>,
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
					if (total > CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES) {
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
function isJsonContentType(value: string | string[] | undefined): boolean {
	return typeof value === "string" && /^(?:application\/json)(?:\s*;|\s*$)/iu.test(value);
}
