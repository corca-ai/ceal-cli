import assert from "node:assert/strict";

export const UNTRUSTED_RESPONSE_CASES = [
	[{ body: "{}", contentType: "text/plain" }, "a non-JSON content type"],
	[{ body: "{not json" }, "a malformed JSON body"],
	[{ body: '{"unexpected":true}' }, "well-formed JSON of the wrong shape"],
	[{ body: "{}", contentLength: "not-a-number" }, "an unparseable content-length"],
	[{ body: "{}", contentLength: 64 * 1024 + 1 }, "a declared length over the cap"],
];

export function mustNotFetch() {
	return async () => assert.fail("a refusal must happen before any request");
}

export function responseFetch({ body, contentType = "application/json", contentLength, stream }) {
	return async () =>
		new globalThis.Response(stream ?? body, {
			status: 200,
			headers: {
				"content-type": contentType,
				...(contentLength === undefined ? {} : { "content-length": String(contentLength) }),
			},
		});
}

export function oversizedStreamFetch() {
	let cancelled = false;
	const stream = new globalThis.ReadableStream({
		pull(controller) {
			controller.enqueue(new Uint8Array(32 * 1024));
		},
		cancel() {
			cancelled = true;
		},
	});
	return { fetchFn: responseFetch({ stream }), wasCancelled: () => cancelled };
}

export function abortingFetch(_url, init) {
	return new Promise((_resolve, reject) => {
		init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
	});
}

export async function brokenFetch() {
	throw new Error("connection reset");
}
