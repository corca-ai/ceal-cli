import { request as httpRequest } from "node:http";

/**
 * The one home for the two private worker modes' shared transport shape: the
 * clock/timer seams, the deadline race, and the fixed-route Unix socket POST.
 *
 * `leased-consumer-carrier` and `leased-consumer-control-session` are separate
 * release contracts with separate authority surfaces, and each still owns its own
 * deadline values, response caps, and error vocabulary. What they must not own
 * separately is *how* a deadline is enforced — four hand-copied races and two
 * hand-copied socket posts is how one of them ended up with no deadline at all.
 */

export interface TransportTimerSeams {
	readonly monotonicNow?: () => number;
	readonly setTimer?: (callback: () => void, ms: number) => unknown;
	readonly clearTimer?: (timer: unknown) => void;
}

export interface UnixSocketResponse {
	readonly status: number;
	readonly contentType: string | string[] | undefined;
	readonly bytes: Uint8Array;
}

/** Derived from the seam declaration above so the two shapes cannot drift apart. */
type ResolvedTimerSeams = Readonly<{ now: () => number }> & Required<Omit<TransportTimerSeams, "monotonicNow">>;

/** The three timer/clock seams, resolved once so no caller spells a default twice. */
function resolveTimerSeams(runtime: TransportTimerSeams): ResolvedTimerSeams {
	return {
		now: runtime.monotonicNow ?? (() => performance.now()),
		setTimer: runtime.setTimer ?? ((callback, ms) => setTimeout(callback, ms)),
		clearTimer: runtime.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)),
	};
}

/** `settled` distinguishes "the operation answered" from "the wait was cut short", so a caller whose own `T` includes `null` cannot confuse the two. */
export type DeadlineOutcome<T> = { readonly settled: true; readonly value: T } | { readonly settled: false };

/**
 * Races one already-started operation against `deadlineMs` and an optional abort.
 * The caller decides what losing means — a null result, a typed throw — because
 * that word belongs to its own contract; this function only guarantees the wait
 * is bounded.
 *
 * `onDeadline` runs when the deadline wins and is where a caller releases the
 * underlying resource, so an expired wait frees the process rather than only this
 * promise.
 */
export async function raceDeadline<T>(
	seams: TransportTimerSeams,
	deadlineMs: number,
	pending: Promise<T>,
	onDeadline?: () => void,
	signal?: AbortSignal,
): Promise<DeadlineOutcome<T>> {
	const { now, setTimer, clearTimer } = resolveTimerSeams(seams);
	const started = now();
	const cutShort = Symbol("cut_short");
	let timedOut = false;
	let timer: unknown;
	let abortListener: (() => void) | undefined;
	pending.catch(() => undefined);
	try {
		const timeout = new Promise<typeof cutShort>((resolve) => {
			timer = setTimer(() => {
				timedOut = true;
				onDeadline?.();
				resolve(cutShort);
			}, deadlineMs);
		});
		const aborted = new Promise<typeof cutShort>((resolve) => {
			if (!signal) return;
			abortListener = () => resolve(cutShort);
			signal.addEventListener("abort", abortListener, { once: true });
		});
		const value = await Promise.race([pending, timeout, aborted]);
		if (value === cutShort || timedOut || now() - started > deadlineMs) return { settled: false };
		return { settled: true, value };
	} finally {
		if (timer !== undefined) clearTimer(timer);
		if (abortListener) signal?.removeEventListener("abort", abortListener);
	}
}

/**
 * The one-shot protected-descriptor read both private modes perform: race the
 * read against the caller's deadline, close the descriptor on every exit, and
 * answer `null` for every way of not getting bytes. Each caller still names its
 * own deadline and its own failure code.
 */
export async function readBeforeDeadline(
	seams: TransportTimerSeams,
	deadlineMs: number,
	read: () => Promise<Uint8Array>,
	close: () => Promise<void>,
): Promise<Uint8Array | null> {
	try {
		const outcome = await raceDeadline(seams, deadlineMs, read(), () => void close());
		return outcome.settled ? outcome.value : null;
	} catch {
		return null;
	} finally {
		await close();
	}
}

/** Destroys a readable and resolves only once it has actually closed. */
export function closeReadable(stream: {
	readonly destroyed?: boolean;
	destroy: () => void;
	once: (event: string, listener: () => void) => unknown;
}): Promise<void> {
	if (stream.destroyed) return Promise.resolve();
	return new Promise<void>((resolve) => {
		stream.once("close", resolve);
		stream.destroy();
	});
}

/** Reads a stream to EOF while never retaining more than `maximum` bytes. */
export async function readBoundedStream(stream: AsyncIterable<Uint8Array>, maximum: number, abort?: () => void): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let total = 0;
	for await (const chunk of stream) {
		if (!(chunk instanceof Uint8Array) || chunk.byteLength > maximum - total) {
			abort?.();
			throw new Error("input_too_large");
		}
		total += chunk.byteLength;
		chunks.push(chunk);
	}
	return concatBytes(chunks, total);
}

/** Joins already-bounded chunks into the one buffer their reader promised. */
export function concatBytes(chunks: readonly Uint8Array[], total: number): Uint8Array {
	const value = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		value.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return value;
}

/** Collapses repeat calls of a teardown into the first one's promise, so a close cannot run twice. */
export function onceAsync(action: () => Promise<void>): () => Promise<void> {
	let pending: Promise<void> | undefined;
	return () => {
		pending ??= action().catch(() => undefined);
		return pending;
	};
}

/** The one spelling of the JSON content-type both private modes require of a response. */
export function isJsonContentType(value: string | string[] | null | undefined): boolean {
	return typeof value === "string" && /^(?:application\/json)(?:\s*;|\s*$)/iu.test(value);
}

/**
 * The five ways this POST can fail, named by the caller. These strings are not
 * internal: `leased-consumer-control-session.ts` writes `error.message` straight
 * to stderr on the shipped path, so each mode's vocabulary is part of what it
 * ships and this module must not pick one for it.
 */
export interface UnixSocketErrorNames {
	readonly aborted: string;
	readonly deadlineExceeded: string;
	readonly responseTooLarge: string;
	readonly responseFailed: string;
	readonly requestFailed: string;
}

/**
 * One fixed-route POST over a Unix socket, bounded by its caller's deadline and
 * abort. The socket is destroyed on every losing path, so no branch leaves a
 * half-open connection behind.
 */
export function postUnixSocket(
	input: Readonly<{
		socketPath: string;
		path: string;
		method: string;
		credential: string;
		body: string;
		deadlineMs: number;
		maximumResponseBytes: number;
		errors: UnixSocketErrorNames;
		signal?: AbortSignal;
	}>,
): Promise<UnixSocketResponse> {
	const body = Buffer.from(input.body, "utf8");
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (action: () => void) => {
			if (settled) return;
			settled = true;
			input.signal?.removeEventListener("abort", abortRequest);
			action();
		};
		const abortRequest = () => {
			request.destroy();
			finish(() => reject(new Error(input.errors.aborted)));
		};
		const request = httpRequest(
			{
				socketPath: input.socketPath,
				path: input.path,
				method: input.method,
				headers: {
					Authorization: `Bearer ${input.credential}`,
					"Content-Type": "application/json",
					"Content-Length": String(body.byteLength),
				},
			},
			(response) => {
				const chunks: Buffer[] = [];
				let total = 0;
				response.on("data", (chunk: Buffer) => {
					total += chunk.byteLength;
					if (total > input.maximumResponseBytes) {
						request.destroy();
						finish(() => reject(new Error(input.errors.responseTooLarge)));
						return;
					}
					chunks.push(chunk);
				});
				response.once("error", () => finish(() => reject(new Error(input.errors.responseFailed))));
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
			finish(() => reject(new Error(input.errors.deadlineExceeded)));
		});
		request.once("error", () => finish(() => reject(new Error(input.errors.requestFailed))));
		if (input.signal?.aborted) return abortRequest();
		input.signal?.addEventListener("abort", abortRequest, { once: true });
		request.end(body);
	});
}
