import { createHash } from "node:crypto";
import { fstatSync } from "node:fs";
import * as CealProtocol from "@corca-ai/ceal-protocol";
import { CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES, CEAL_LEASED_CONSUMER_CONTROL_MAX_SESSION_BYTES } from "@corca-ai/ceal-protocol";
import {
	LEASED_CONSUMER_CONTROL_SESSION_CONTRACT_JSON,
	LEASED_CONSUMER_CONTROL_SESSION_CONTRACT_SHA256,
	LEASED_CONSUMER_CONTROL_SESSION_ENTRYPOINT_ARGV,
	LEASED_CONSUMER_CONTROL_SESSION_ROUTES_SHA256,
} from "./generated/leased-consumer-control-session-contract.js";
import { readLeasedConsumerProtectedSession, resolveLeasedConsumerOperationDeadlineMs } from "./leased-consumer-protected-session.js";
import {
	closeReadable,
	isJsonContentType,
	openInheritedReadable,
	postUnixSocket,
	raceDeadline,
	type UnixSocketErrorNames,
	type UnixSocketResponse,
} from "./private-worker-transport.js";
import { parseStrictJson } from "./strict-json.js";

/**
 * The generator emits the contract text and its digest together, and the native
 * build refuses a generated module whose two halves disagree
 * (`embedded_control_session_contract_drift`). That check reads the source file
 * as text, so it says nothing about the pair this module actually parsed — and
 * this module used to parse the text without ever reading the digest beside it,
 * while `leased-consumer-carrier.ts` verified its own before parsing. The
 * asymmetry was the whole finding: one of the two embedded contracts was
 * checked at runtime and the other was not.
 */
function verifiedControlSessionContractJson(): string {
	const digest = createHash("sha256").update(new TextEncoder().encode(LEASED_CONSUMER_CONTROL_SESSION_CONTRACT_JSON)).digest("hex");
	if (digest !== LEASED_CONSUMER_CONTROL_SESSION_CONTRACT_SHA256) throw new Error("invalid_control_session_contract");
	return LEASED_CONSUMER_CONTROL_SESSION_CONTRACT_JSON;
}

/** Not a public command: a service wrapper may invoke only this fixed token. */
const CONTROL_SESSION_CONTRACT = JSON.parse(verifiedControlSessionContractJson()) as Readonly<{
	schema_version: string;
	argv: readonly [string];
	protected_session: Readonly<{ child_fd: number; schema_version: string; maximum_bytes: number; deadline_ms: number }>;
	notification_channel?: Readonly<{
		child_fd: number;
		schema_version: string;
		framing: string;
		maximum_frame_bytes: number;
	}>;
	agent_ipc: Readonly<{
		transport: string;
		request_schema_version: string;
		response_schema_version: string;
		maximum_frame_bytes: number;
		serial: boolean;
	}>;
	gateway: Readonly<{
		transport: string;
		operation_deadline_bounds_ms: Readonly<{ minimum: number; maximum: number }>;
		routes: Readonly<Record<string, string>>;
	}>;
}>;
export const LEASED_CONSUMER_CONTROL_SESSION_ARGV = LEASED_CONSUMER_CONTROL_SESSION_ENTRYPOINT_ARGV;
const OPERATION_DEADLINE_BOUNDS_MS = CONTROL_SESSION_CONTRACT.gateway.operation_deadline_bounds_ms;
/** The Gateway launcher injects the operative deadline; the contract keeps only its bounds. */
const LEASED_CONSUMER_OPERATION_DEADLINE_ENV = "CEAL_LEASED_CONSUMER_OPERATION_DEADLINE_MS";
const MAX_FRAME_BYTES = CONTROL_SESSION_CONTRACT.agent_ipc.maximum_frame_bytes;
const ROUTES = Object.freeze(CONTROL_SESSION_CONTRACT.gateway.routes);

type ControlSession = Readonly<{ dispatch: (frame: Uint8Array, signal?: AbortSignal) => Promise<Uint8Array> }>;
type DecodedControlFrame = Readonly<{ operation: string }> & Record<string, unknown>;
type NotificationDecoder = (value: unknown) => Record<string, unknown>;
type FrameEmitter = (frame: Uint8Array, signal?: AbortSignal) => void | Promise<void>;

type CandidateProtocol = Readonly<{
	decodeCealLeasedConsumerCapabilityNotification?: NotificationDecoder;
	decodeCealLeasedConsumerNotificationControlRequest?: (value: unknown) => DecodedControlFrame;
	decodeCealLeasedConsumerNotificationControlResponse?: (value: unknown) => DecodedControlFrame;
	decodeCealLeasedConsumerDispositionControlRequest?: (value: unknown) => DecodedControlFrame;
	decodeCealLeasedConsumerDispositionControlResponse?: (value: unknown) => DecodedControlFrame;
}>;
const CANDIDATE_PROTOCOL = CealProtocol as unknown as CandidateProtocol;
assertEmbeddedControlSessionContract(CONTROL_SESSION_CONTRACT);

export interface LeasedConsumerNotificationChannel {
	readonly stream: AsyncIterable<Uint8Array>;
	readonly close: () => Promise<void>;
}

export interface LeasedConsumerNotificationRuntime {
	/** Test seam only. Production resolves the decoder from the selected protocol package. */
	readonly decodeNotification?: NotificationDecoder;
}

interface AbortableWritable {
	write(frame: Uint8Array, callback?: (error?: Error | null) => void): boolean;
	destroy(): void;
}

/**
 * The one rejection a shared-signal abort produces on its own. It is a distinct
 * type rather than a message because the notification loop has to tell this
 * apart from every other failure by identity: a string compare against
 * `control_aborted` would also match an error a decoder or the Gateway happened
 * to word that way.
 */
class ControlAbortedError extends Error {
	constructor() {
		super("control_aborted");
		this.name = "ControlAbortedError";
	}
}

function isOwnedNotificationShutdownError(error: unknown): boolean {
	if (error instanceof ControlAbortedError) return true;
	// Destroying the production inherited `net.Socket` while its async iterator
	// is pending rejects that iterator with Node's typed premature-close error.
	// Accept the code only after the transport has entered its own normal-
	// shutdown path: the same error from FD5 ending first remains unowned and
	// therefore fails the pair.
	return error instanceof Error && "code" in error && error.code === "ERR_STREAM_PREMATURE_CLOSE";
}

/**
 * v4 writes one response per request and retains its established non-blocking
 * behavior. v5 can emit unsolicited notifications, so its selected transport
 * supplies a lifecycle signal and waits for the shared stream to drain.
 */
export function writeLeasedConsumerAgentFrame(stream: AbortableWritable, frame: Uint8Array, signal?: AbortSignal): void | Promise<void> {
	if (!signal) {
		stream.write(frame);
		return;
	}
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const finish = (action: () => void) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", abortWrite);
			action();
		};
		// Settle BEFORE destroying. `destroy()` can invoke a pending write
		// callback with its own error, and if that callback reaches `finish`
		// first the promise rejects with `ERR_STREAM_DESTROYED` — an error this
		// function caused, which the notification loop then reads as an
		// independent failure and reports a clean shutdown as exit 3. Settling
		// first makes the teardown's own error unreachable by construction
		// rather than by trusting Node to defer the callback.
		//
		// A write error that lands strictly AFTER this point is dropped, and that
		// is the intended answer, not a gap: past here the stream has been
		// destroyed by this very path, so a late error cannot be told apart from
		// the teardown's own. An error that was already in flight settles the
		// promise on its own and stays a failure, which is the case the
		// classification actually turns on.
		const abortWrite = () => {
			finish(() => reject(new ControlAbortedError()));
			stream.destroy();
		};
		if (signal.aborted) return abortWrite();
		signal.addEventListener("abort", abortWrite, { once: true });
		stream.write(frame, (error) => finish(() => (error ? reject(error) : resolve())));
	});
}

export interface LeasedConsumerControlSessionRuntime {
	/** Test seam only. The shipped carrier reads and closes protected FD 4. */
	readonly readProtectedSession?: () => Promise<Uint8Array>;
	/** Test seam only. The shipped carrier closes protected FD 4 exactly once. */
	readonly closeProtectedSession?: () => Promise<void>;
	/** Test seam only. The shipped carrier makes one fixed-route Unix-socket POST. */
	readonly requestUnixSocket?: (
		input: Readonly<{
			socketPath: string;
			path: string;
			method: string;
			body: string;
			credential: string;
			deadlineMs: number;
			maximumResponseBytes: number;
			errors: UnixSocketErrorNames;
			signal?: AbortSignal;
		}>,
	) => Promise<UnixSocketResponse>;
	/** Test seam only. The shipped carrier gives protected FD 4 two seconds. */
	readonly monotonicNow?: () => number;
	/** Test seam only. */
	readonly setTimer?: (callback: () => void, milliseconds: number) => unknown;
	/** Test seam only. */
	readonly clearTimer?: (timer: unknown) => void;
	/** Test seam only. The shipped carrier reads the launcher-injected deadline from process.env. */
	readonly env?: Readonly<Record<string, string | undefined>>;
	/** Test seam only. Production resolves the request decoder from the selected signed Protocol package. */
	readonly decodeControlRequest?: (value: unknown) => DecodedControlFrame;
	/** Test seam only. Production resolves the response decoder from the selected signed Protocol package. */
	readonly decodeControlResponse?: (value: unknown) => DecodedControlFrame;
}

/**
 * Resolves the operative per-operation Gateway deadline at session start.
 * Absent launcher input keeps the contract minimum (today's behavior); a
 * present but non-integer or out-of-bounds value fails closed before any
 * operation is served.
 *
 * Exported for the suite that drives its bounds directly; no other module calls
 * it.
 *
 * @testOnly
 */
export function resolveOperationDeadlineMs(env: Readonly<Record<string, string | undefined>> = process.env): number {
	return resolveLeasedConsumerOperationDeadlineMs(env, LEASED_CONSUMER_OPERATION_DEADLINE_ENV, OPERATION_DEADLINE_BOUNDS_MS);
}

/**
 * Opens one credential-bearing Gateway control session. The returned object
 * accepts canonical Agent frames only; it never exposes the credential, socket
 * path, or a caller-selectable route to its caller.
 */
export async function openLeasedConsumerControlSession(runtime: LeasedConsumerControlSessionRuntime = {}): Promise<ControlSession> {
	const operationDeadlineMs = resolveOperationDeadlineMs(runtime.env);
	const session = await readLeasedConsumerProtectedSession(CONTROL_SESSION_CONTRACT.protected_session, runtime);
	return Object.freeze({
		dispatch: async (frame, signal) => dispatch(session.socket_path, session.service_credential, frame, runtime, operationDeadlineMs, signal),
	});
}

/**
 * Consumes one serial newline-framed inherited Agent stream. A malformed,
 * oversized, or transport-failed frame closes without a response and never
 * retries through a public/client session path.
 */
async function runLeasedConsumerControlSession(
	stream: AsyncIterable<Uint8Array>,
	session: ControlSession,
	emit: FrameEmitter,
	signal?: AbortSignal,
): Promise<boolean> {
	let pending = "";
	const decoder = new TextDecoder("utf-8", { fatal: true });
	try {
		for await (const chunk of stream) {
			if (!(chunk instanceof Uint8Array)) throw new Error("invalid_stream");
			pending += decoder.decode(chunk, { stream: true });
			for (;;) {
				const newline = pending.indexOf("\n");
				if (newline < 0) break;
				const text = pending.slice(0, newline);
				pending = pending.slice(newline + 1);
				if (text.length === 0 || text.endsWith("\r")) throw new Error("invalid_frame");
				if (Buffer.byteLength(text, "utf8") > MAX_FRAME_BYTES) throw new Error("frame_too_large");
				const response = await session.dispatch(new TextEncoder().encode(text), signal);
				if (signal?.aborted) throw new Error("control_aborted");
				await emit(response, signal);
			}
			// The ceiling belongs to one frame, not to whatever a writer happened to
			// hand over in a single chunk. Measured on the accumulated buffer it
			// refused two legal frames batched into one write — and refused them
			// before dispatching the first, so the Agent got neither answer — and
			// refused a frame of exactly the maximum, which `parseStrictJson`
			// accepts. `consumeNdjson` below is the shape this now matches.
			if (Buffer.byteLength(pending, "utf8") > MAX_FRAME_BYTES) throw new Error("frame_too_large");
		}
		pending += decoder.decode();
		if (pending.length !== 0) throw new Error("unterminated_frame");
		return true;
	} catch (error) {
		// The Agent receives no oracle for malformed frames or local transport
		// failures. Its inherited stream is simply closed by the caller. The
		// error NAME still lands on stderr (never frame content): a silent
		// exit-3 was indistinguishable from a crash at the serving pair.
		process.stderr.write(`ceal-worker control-session failed: ${error instanceof Error ? error.message : "unknown"}\n`);
		return false;
	}
}

/**
 * Validates bounded FD5 NDJSON with the selected Gateway protocol decoder, then
 * forwards only the canonical notification value to the existing Agent stdout.
 * This function owns no credential, route, or provider payload.
 */
async function runLeasedConsumerNotificationStream(
	stream: AsyncIterable<Uint8Array>,
	emit: FrameEmitter,
	runtime: LeasedConsumerNotificationRuntime = {},
	signal?: AbortSignal,
	isOwnedShutdown: () => boolean = () => false,
): Promise<boolean> {
	const maximum = CONTROL_SESSION_CONTRACT.notification_channel?.maximum_frame_bytes ?? 4 * 1024;
	const decodeNotification = runtime.decodeNotification ?? CANDIDATE_PROTOCOL.decodeCealLeasedConsumerCapabilityNotification;
	try {
		if (!decodeNotification) throw new Error("notification_protocol_unavailable");
		await consumeNdjson(stream, maximum, async (text) => {
			const decoded = decodeNotification(parseStrictJson(new TextEncoder().encode(text), maximum));
			await emit(new TextEncoder().encode(`${JSON.stringify(decoded)}\n`), signal);
		});
		return true;
	} catch (error) {
		// Two questions, not one. The shared signal is aborted for either of the
		// transport's two reasons, so `signal.aborted` alone says nothing about
		// what ended THIS loop: a malformed frame, an FD5/EPIPE read, or a
		// shared-stdout failure that merely raced with the owner's abort would be
		// reported as a successful worker exit. Clean requires both that the
		// worker's own normal-shutdown path ran and that the cancellation it
		// raised is the error in hand.
		if (isOwnedShutdown() && isOwnedNotificationShutdownError(error)) return true;
		process.stderr.write(`ceal-worker notification-session failed: ${error instanceof Error ? error.message : "unknown"}\n`);
		return false;
	}
}

/**
 * Runs the request/response and notification halves as one fail-closed pair.
 * Agent stdin is the lifecycle owner: its close ends FD5; FD5 ending first
 * closes Agent stdin and makes the pair unsuccessful.
 */
export async function runLeasedConsumerControlTransport(
	agentStream: AsyncIterable<Uint8Array>,
	session: ControlSession,
	emit: FrameEmitter,
	notificationChannel: LeasedConsumerNotificationChannel | undefined,
	closeAgentStream: () => Promise<void>,
	notificationRuntime: LeasedConsumerNotificationRuntime = {},
): Promise<boolean> {
	if (!notificationChannel) return runLeasedConsumerControlSession(agentStream, session, emit);
	const abort = new AbortController();
	let emitting = Promise.resolve();
	let emissionFailed = false;
	let emissionFailure: unknown;
	const serialEmit: FrameEmitter = (frame) => {
		const next = emitting.then(() => {
			if (emissionFailed) throw emissionFailure;
			return emit(frame, abort.signal);
		});
		emitting = next.then(
			() => undefined,
			(error) => {
				emissionFailed = true;
				emissionFailure = error;
			},
		);
		return next;
	};
	let agentFinished = false;
	let notificationEndedEarly = false;
	// Set only on the normal-shutdown path below, and read by the notification
	// loop's classifier. The other `abort.abort()` in this function fires because
	// the notification loop already ended, so it can never mark its own end clean.
	let ownedShutdown = false;
	const notification = runLeasedConsumerNotificationStream(
		notificationChannel.stream,
		serialEmit,
		notificationRuntime,
		abort.signal,
		() => ownedShutdown,
	).then(async (clean) => {
		if (!agentFinished) {
			notificationEndedEarly = true;
			abort.abort();
			await closeAgentStream();
		}
		return clean;
	});
	const controlClean = await runLeasedConsumerControlSession(agentStream, session, serialEmit, abort.signal);
	agentFinished = true;
	ownedShutdown = true;
	abort.abort();
	await notificationChannel.close();
	const notificationClean = await notification;
	return controlClean && notificationClean && !notificationEndedEarly;
}

/**
 * Whether FD5 is an inherited byte stream this worker may read as the
 * notification channel.
 *
 * Gateway launches the worker with a child-stdio `pipe`, which on Linux is a
 * Unix socketpair rather than a named FIFO, so a FIFO-only check refuses the
 * one channel production actually supplies. A supervisor or a test may still
 * hand over a real FIFO. Both are streams with no seek and no path.
 *
 * A regular file and a device descriptor stay refused. That is the point of
 * asking at all: they are the substitutions that would let FD5 name something
 * on disk, and this predicate is the only place that says so.
 *
 * Exported so the suite can put real descriptors of each kind in front of it —
 * the mistake this fixes was an assumption about what a "pipe" is, which only a
 * real descriptor can settle. No other module imports it.
 *
 * @testOnly
 */
export function isInheritedNotificationChannelFd(fd: number): boolean {
	const stat = fstatSync(fd);
	return stat.isFIFO() || stat.isSocket();
}

/** Opens inherited FD5 only when the embedded selected contract declares it. */
export function openLeasedConsumerNotificationChannel(): LeasedConsumerNotificationChannel | undefined {
	const contract = CONTROL_SESSION_CONTRACT.notification_channel;
	if (!contract) return undefined;
	if (!isInheritedNotificationChannelFd(contract.child_fd)) throw new Error("missing_notification_channel");
	const stream = openInheritedReadable(contract.child_fd);
	return Object.freeze({
		stream,
		close: () => closeReadable(stream),
	});
}

async function consumeNdjson(
	stream: AsyncIterable<Uint8Array>,
	maximum: number,
	consume: (text: string) => void | Promise<void>,
): Promise<void> {
	let pending = "";
	const decoder = new TextDecoder("utf-8", { fatal: true });
	for await (const chunk of stream) {
		if (!(chunk instanceof Uint8Array)) throw new Error("invalid_stream");
		pending += decoder.decode(chunk, { stream: true });
		for (;;) {
			const newline = pending.indexOf("\n");
			if (newline < 0) break;
			const text = pending.slice(0, newline);
			pending = pending.slice(newline + 1);
			if (text.length === 0 || text.endsWith("\r") || Buffer.byteLength(text, "utf8") > maximum) throw new Error("invalid_frame");
			await consume(text);
		}
		if (Buffer.byteLength(pending, "utf8") > maximum) throw new Error("frame_too_large");
	}
	pending += decoder.decode();
	if (pending.length !== 0) throw new Error("unterminated_frame");
}

async function dispatch(
	socketPath: string,
	credential: string,
	frame: Uint8Array,
	runtime: LeasedConsumerControlSessionRuntime,
	operationDeadlineMs: number,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	const request = decodeControlRequest(parseStrictJson(frame, MAX_FRAME_BYTES), runtime);
	const route = ROUTES[request.operation];
	if (typeof route !== "string") throw new Error("operation_unavailable");
	const body = JSON.stringify(request);
	const response = await requestControlBeforeDeadline(
		runtime,
		operationDeadlineMs,
		() =>
			(runtime.requestUnixSocket ?? postUnixSocket)({
				socketPath,
				path: route,
				method: "POST",
				body,
				credential,
				deadlineMs: operationDeadlineMs,
				maximumResponseBytes: MAX_FRAME_BYTES,
				errors: SHIPPED_SOCKET_ERROR_NAMES,
				...(signal === undefined ? {} : { signal }),
			}),
		signal,
	);
	if (response.status !== 200 || !isJsonContentType(response.contentType) || response.bytes.byteLength > MAX_FRAME_BYTES)
		throw new Error("control_unavailable");
	const decoded = decodeControlResponse(parseStrictJson(response.bytes, MAX_FRAME_BYTES), runtime);
	if (decoded.operation !== request.operation) throw new Error("operation_mismatch");
	return new TextEncoder().encode(`${JSON.stringify(decoded)}\n`);
}

function decodeControlRequest(value: unknown, runtime: LeasedConsumerControlSessionRuntime): DecodedControlFrame {
	if (runtime.decodeControlRequest) return runtime.decodeControlRequest(value);
	const decode = CANDIDATE_PROTOCOL.decodeCealLeasedConsumerDispositionControlRequest;
	if (!decode) throw new Error("disposition_protocol_unavailable");
	return decode(value);
}

function decodeControlResponse(value: unknown, runtime: LeasedConsumerControlSessionRuntime): DecodedControlFrame {
	if (runtime.decodeControlResponse) return runtime.decodeControlResponse(value);
	const decode = CANDIDATE_PROTOCOL.decodeCealLeasedConsumerDispositionControlResponse;
	if (!decode) throw new Error("disposition_protocol_unavailable");
	return decode(value);
}

/**
 * `leased-consumer-control-session` writes `error.message` to stderr verbatim on
 * the shipped path, so these five names are shipped output, not internals.
 */
const SHIPPED_SOCKET_ERROR_NAMES = Object.freeze({
	aborted: "control_aborted",
	deadlineExceeded: "request_deadline_exceeded",
	responseTooLarge: "response_too_large",
	responseFailed: "response_failed",
	requestFailed: "request_failed",
});

async function requestControlBeforeDeadline(
	runtime: LeasedConsumerControlSessionRuntime,
	operationDeadlineMs: number,
	request: () => Promise<UnixSocketResponse>,
	signal?: AbortSignal,
): Promise<UnixSocketResponse> {
	if (signal?.aborted) throw new Error("control_aborted");
	const outcome = await raceDeadline(runtime, operationDeadlineMs, request(), undefined, signal);
	if (signal?.aborted) throw new Error("control_aborted");
	// `outcome.value` is typed non-null, but a test seam may hand back anything;
	// the pre-extraction code treated a null response as a lost deadline and the
	// caller dereferences `.status` immediately.
	if (!outcome.settled || outcome.value === null) throw new Error("control_deadline_exceeded");
	return outcome.value;
}

function assertEmbeddedControlSessionContract(
	value: Readonly<{
		schema_version: string;
		argv: readonly [string];
		protected_session: Readonly<{ child_fd: number; schema_version: string; maximum_bytes: number; deadline_ms: number }>;
		notification_channel?: Readonly<{
			child_fd: number;
			schema_version: string;
			framing: string;
			maximum_frame_bytes: number;
		}>;
		agent_ipc: Readonly<{
			transport: string;
			request_schema_version: string;
			response_schema_version: string;
			maximum_frame_bytes: number;
			serial: boolean;
		}>;
		gateway: Readonly<{
			transport: string;
			operation_deadline_bounds_ms: Readonly<{ minimum: number; maximum: number }>;
			routes: Readonly<Record<string, string>>;
		}>;
	}>,
): void {
	const routeEntries = Object.entries(value.gateway.routes);
	const fixedRoutes =
		routeEntries.length >= 5 &&
		routeEntries.every(
			([operation, route]) =>
				/^[a-z][a-z0-9_]*$/u.test(operation) && typeof route === "string" && /^\/api\/ceal\/agent\/v1\/[a-z0-9][a-z0-9_/-]*$/u.test(route),
		) &&
		new Set(routeEntries.map(([, route]) => route)).size === routeEntries.length;
	const current =
		value.schema_version === "ceal.worker_private_leased_consumer_control_session_contract.v3" &&
		value.notification_channel?.child_fd === 5 &&
		value.notification_channel.schema_version === "ceal.leased_consumer_capability_notification.v5" &&
		value.notification_channel.framing === "ndjson" &&
		value.notification_channel.maximum_frame_bytes === 4 * 1024 &&
		value.agent_ipc.request_schema_version === "ceal.leased_consumer_capability_control_request.v6" &&
		value.agent_ipc.response_schema_version === "ceal.leased_consumer_capability_control_response.v6" &&
		routeEntries.length === 7 &&
		LEASED_CONSUMER_CONTROL_SESSION_ROUTES_SHA256 === createHash("sha256").update(JSON.stringify(value.gateway.routes)).digest("hex") &&
		fixedRoutes &&
		typeof CANDIDATE_PROTOCOL.decodeCealLeasedConsumerCapabilityNotification === "function" &&
		typeof CANDIDATE_PROTOCOL.decodeCealLeasedConsumerNotificationControlRequest === "function" &&
		typeof CANDIDATE_PROTOCOL.decodeCealLeasedConsumerNotificationControlResponse === "function" &&
		typeof CANDIDATE_PROTOCOL.decodeCealLeasedConsumerDispositionControlRequest === "function" &&
		typeof CANDIDATE_PROTOCOL.decodeCealLeasedConsumerDispositionControlResponse === "function";
	if (
		!current ||
		value.argv[0] !== LEASED_CONSUMER_CONTROL_SESSION_ENTRYPOINT_ARGV ||
		value.protected_session.child_fd !== 4 ||
		value.protected_session.schema_version !== "ceal.leased_consumer_control_session.v1" ||
		value.protected_session.maximum_bytes !== CEAL_LEASED_CONSUMER_CONTROL_MAX_SESSION_BYTES ||
		value.protected_session.deadline_ms !== 2_000 ||
		value.agent_ipc.transport !== "stdin_stdout_ndjson" ||
		value.agent_ipc.maximum_frame_bytes !== CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES ||
		value.agent_ipc.serial !== true ||
		value.gateway.transport !== "unix_socket" ||
		value.gateway.operation_deadline_bounds_ms.minimum !== 30_000 ||
		value.gateway.operation_deadline_bounds_ms.maximum !== 600_000 ||
		value.gateway.operation_deadline_bounds_ms.minimum > value.gateway.operation_deadline_bounds_ms.maximum
	)
		throw new Error("invalid_embedded_control_session_contract");
}
