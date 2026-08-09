/**
 * The one home for the bounds every outbound request in this package is held to.
 *
 * Four transports live here — the Gateway HTTP transport and the enrollment,
 * device-adoption and personal-session clients — and each used to spell its own
 * timeout default, its own `1 <= ms <= 120_000` bound and its own byte-capped
 * response reader. Nothing tied them together, so raising the timeout an operator
 * actually waits meant finding four literals in four files and a green gate
 * either way. The worker's private modes had the same shape and it is how one of
 * them shipped with no deadline at all.
 *
 * Each transport still owns its own default and its own cap, because a session
 * exchange and a capability call are not the same request. What they share, and
 * what lives here, is the ceiling on a configured timeout and the shape of a
 * bounded read.
 */

/** The longest any caller may configure. A request that outlives this is a hang, not a slow call. */
export const CEAL_MAX_CONFIGURED_TIMEOUT_MS = 120_000;

/** The default for the three session-lifecycle clients; the Gateway transport is longer and says so at its own site. */
export const CEAL_SESSION_CLIENT_TIMEOUT_MS = 10_000;

/** The response cap for the three session-lifecycle clients. Their documents are small and bounded by the protocol. */
export const CEAL_SESSION_CLIENT_MAX_RESPONSE_BYTES = 64 * 1024;

/** True when `value` is a usable configured timeout. The one place the ceiling is applied. */
function isConfigurableTimeoutMs(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= CEAL_MAX_CONFIGURED_TIMEOUT_MS;
}

/**
 * Resolves the two things every transport in this package needs before it can
 * send anything, and refuses through the caller's own error type — each client
 * answers a different one and those names reach its callers.
 */
export function resolveRequestBounds(
	options: Readonly<{ fetchFn?: typeof globalThis.fetch; timeoutMs?: number }>,
	defaultTimeoutMs: number,
	refuse: () => never,
): { readonly fetchFn: typeof globalThis.fetch; readonly timeoutMs: number } {
	const fetchFn = options.fetchFn ?? globalThis.fetch;
	if (typeof fetchFn !== "function") refuse();
	const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
	if (!isConfigurableTimeoutMs(timeoutMs)) refuse();
	return { fetchFn, timeoutMs };
}

/** The one spelling of the content type every Gateway response must declare. */
export function declaresJsonContentType(response: Response): boolean {
	return response.headers.get("content-type")?.toLowerCase().startsWith("application/json") === true;
}

/** Joins already-bounded chunks into the one buffer their reader promised. */
function mergeChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

/**
 * Reads a response body to EOF without ever retaining more than `maximum` bytes,
 * refusing before the first read when the declared `content-length` already says
 * it will not fit.
 *
 * The two refusals are separate parameters because the transports genuinely
 * disagree about whether they are one outcome: the Gateway transport answers
 * `response_too_large` distinctly from `invalid_response`, while the three
 * session clients collapse both into one code on purpose. Passing the same
 * callback twice is how a caller says it collapses them, rather than the
 * distinction going missing by accident.
 */
export async function readBoundedResponseBody(
	response: Response,
	maximum: number,
	refuseMalformed: () => never,
	refuseTooLarge: () => never = refuseMalformed,
): Promise<Uint8Array> {
	const declared = response.headers.get("content-length");
	if (declared !== null) {
		if (!/^\d+$/u.test(declared)) refuseMalformed();
		if (Number(declared) > maximum) refuseTooLarge();
	}
	if (!response.body) refuseMalformed();
	const reader = response.body.getReader();
	try {
		const chunks: Uint8Array[] = [];
		let total = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > maximum) {
				await reader.cancel();
				refuseTooLarge();
			}
			chunks.push(value);
		}
		return mergeChunks(chunks, total);
	} finally {
		reader.releaseLock();
	}
}
