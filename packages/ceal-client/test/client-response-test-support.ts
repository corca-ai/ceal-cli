import assert from "node:assert/strict";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

export type ResponseFetchOptions = {
	body?: BodyInit | null;
	contentType?: string;
	contentLength?: string | number;
	stream?: ReadableStream<Uint8Array>;
};

export function untrustedResponseCases(validResponse: unknown): Array<readonly [ResponseFetchOptions, string]> {
	const validBody = JSON.stringify(validResponse);
	return [
		[{ body: validBody, contentType: "text/plain" }, "a non-JSON content type"],
		[{ body: validBody, contentType: "application/jsonp" }, "a JSON-prefix media type"],
		[{ body: validBody, contentType: "application/json-seq" }, "a distinct JSON sequence media type"],
		[{ body: "{not json" }, "a malformed JSON body"],
		[{ body: '{"unexpected":true}' }, "well-formed JSON of the wrong shape"],
		[{ body: validBody, contentLength: "not-a-number" }, "an unparseable content-length"],
		[{ body: validBody, contentLength: 64 * 1024 + 1 }, "a declared length over the cap"],
	];
}

export type JsonRecord = Record<string, unknown>;

export async function readBody(request: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return Buffer.concat(chunks).toString("utf8");
}

export function parseJsonRecord(body: string): JsonRecord {
	const parsed: unknown = JSON.parse(body);
	if (!isJsonRecord(parsed)) throw new Error("expected JSON object");
	return parsed;
}

function isJsonRecord(value: unknown): value is JsonRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function json(response: ServerResponse, body: unknown, status = 200): void {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

export function serverPort(server: Server): number {
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("server did not bind to a TCP address");
	return address.port;
}

export function listen(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
}

export function close(server: Server): Promise<void> {
	return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

export function mustNotFetch() {
	return async () => assert.fail("a refusal must happen before any request");
}

export function responseFetch({
	body = null,
	contentType = "application/json",
	contentLength,
	stream,
}: ResponseFetchOptions): typeof globalThis.fetch {
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

export function abortingFetch(_url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	return new Promise((_resolve, reject) => {
		if (!init?.signal) throw new Error("missing abort signal");
		init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
	});
}

export async function ignoringAbortFetch(): Promise<Response> {
	return new Promise(() => {});
}

export async function nonTerminatingBodyFetch(): Promise<Response> {
	return new globalThis.Response(
		new globalThis.ReadableStream({
			pull: () => new Promise(() => {}),
		}),
		{ headers: { "content-type": "application/json" } },
	);
}

export async function brokenFetch(): Promise<Response> {
	throw new Error("connection reset");
}
