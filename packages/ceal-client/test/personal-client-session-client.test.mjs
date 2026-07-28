import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import { CealPersonalClientSessionError, createCealPersonalClientSessionClient } from "../dist/index.js";

const REFRESH = `ceal_refresh_${"R".repeat(43)}`;

test("personal-client session client rotates and revokes only through derived Gateway routes", async () => {
	const requests = [];
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		requests.push({ url: request.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
		response.writeHead(200, { "content-type": "application/json" });
		if (request.url?.endsWith("/refresh")) {
			response.end(
				JSON.stringify({
					schema_version: "ceal.client_refresh_result.v1",
					ok: true,
					profile_ref: "profile:work",
					membership_ref: "membership:narnia",
					registration_ref: "registration:narnia",
					client_ref: "client:narnia",
					subject_ref: "subject:hwidong",
					instance_ref: "instance:ceal-dev",
					access_token: `ceal_personal_${"A".repeat(43)}`,
					expires_at: "2026-07-13T06:15:00.000Z",
					refresh_token: `ceal_refresh_${"N".repeat(43)}`,
					refresh_token_idle_expires_at: "2026-08-12T06:00:00.000Z",
					refresh_token_absolute_expires_at: "2026-10-11T06:00:00.000Z",
				}),
			);
		} else {
			response.end(JSON.stringify({ schema_version: "ceal.client_revoke_result.v1", ok: true, revoked: true }));
		}
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("missing address");
	try {
		const client = createCealPersonalClientSessionClient({ endpoint: `http://127.0.0.1:${address.port}/api/ceal/v1` });
		const refreshed = await client.refresh(REFRESH);
		assert.equal(refreshed.ok, true);
		const revoked = await client.revoke(REFRESH);
		assert.equal(revoked.ok, true);
		assert.deepEqual(
			requests.map((item) => item.url),
			["/api/ceal/v1/refresh", "/api/ceal/v1/revoke"],
		);
		assert.equal(requests[0].body.refresh_token, REFRESH);
		assert.equal(requests[1].body.refresh_token, REFRESH);
		// Drift guard: the hardcoded client-identification version must track
		// the client package manifest.
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		assert.deepEqual(requests[0].body.client, { name: "ceal", version: manifest.version });
	} finally {
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
});

test("personal-client session client rejects unsafe endpoints and token drift before fetch", async () => {
	assert.throws(
		() => createCealPersonalClientSessionClient({ endpoint: "http://gateway.example.test/api/ceal/v1" }),
		(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_configuration",
	);
	let fetched = false;
	const client = createCealPersonalClientSessionClient({
		endpoint: "https://gateway.example.test/api/ceal/v1",
		fetchFn: async () => {
			fetched = true;
			throw new Error("must not fetch");
		},
	});
	await assert.rejects(
		() => client.refresh("short"),
		(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_configuration",
	);
	assert.equal(fetched, false);
});

// Same shape of gap as the enrollment client: the guards that make this safe to
// point at an arbitrary endpoint carried no coverage. Each case asserts its own
// refusal code rather than merely that something threw.
const SESSION_ENDPOINT = "https://gateway.example/api/ceal/v1";

function neverCalled() {
	return async () => assert.fail("a refusal must happen before any request");
}

test("session client construction refuses an unusable transport or timeout", () => {
	assert.throws(
		() => createCealPersonalClientSessionClient({ endpoint: SESSION_ENDPOINT, fetchFn: "not-a-function" }),
		(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_configuration",
	);
	for (const timeoutMs of [0, -1, 2.5, 120_001, Number.NaN]) {
		assert.throws(
			() => createCealPersonalClientSessionClient({ endpoint: SESSION_ENDPOINT, fetchFn: neverCalled(), timeoutMs }),
			(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_configuration",
			`timeoutMs ${String(timeoutMs)} must be refused`,
		);
	}
	assert.throws(
		() => createCealPersonalClientSessionClient({ endpoint: "not a url", fetchFn: neverCalled() }),
		(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_configuration",
	);
});

function sessionRespondWith({ body, contentType = "application/json", contentLength, stream }) {
	return async () =>
		new globalThis.Response(stream ?? body, {
			status: 200,
			headers: {
				"content-type": contentType,
				...(contentLength === undefined ? {} : { "content-length": String(contentLength) }),
			},
		});
}

test("a session response this client cannot trust is invalid_response on both routes", async () => {
	const cases = [
		[{ body: "{}", contentType: "text/html" }, "a non-JSON content type"],
		[{ body: "{oops" }, "a malformed JSON body"],
		[{ body: '{"unexpected":true}' }, "well-formed JSON of the wrong shape"],
		[{ body: "{}", contentLength: "abc" }, "an unparseable content-length"],
		[{ body: "{}", contentLength: 64 * 1024 + 1 }, "a declared length over the cap"],
	];
	// Both routes share the request path, so both must refuse identically; a
	// guard that only covered `refresh` would leave revocation trusting bytes.
	for (const route of ["refresh", "revoke"]) {
		for (const [options, why] of cases) {
			const client = createCealPersonalClientSessionClient({ endpoint: SESSION_ENDPOINT, fetchFn: sessionRespondWith(options) });
			await assert.rejects(
				() => client[route](REFRESH),
				(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_response",
				`${route}: ${why} must be invalid_response`,
			);
		}
	}
});

test("an undeclared oversized session body is refused mid-stream and cancelled", async () => {
	let cancelled = false;
	const stream = new globalThis.ReadableStream({
		pull(controller) {
			controller.enqueue(new Uint8Array(32 * 1024));
		},
		cancel() {
			cancelled = true;
		},
	});
	const client = createCealPersonalClientSessionClient({ endpoint: SESSION_ENDPOINT, fetchFn: sessionRespondWith({ stream }) });
	await assert.rejects(
		() => client.refresh(REFRESH),
		(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_response",
	);
	assert.equal(cancelled, true, "the oversized body must be cancelled, not drained");
});

test("a session timeout and a transport failure are told apart", async () => {
	const timedOut = createCealPersonalClientSessionClient({
		endpoint: SESSION_ENDPOINT,
		timeoutMs: 1,
		fetchFn: (_url, init) =>
			new Promise((_resolve, reject) => {
				init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
			}),
	});
	await assert.rejects(
		() => timedOut.refresh(REFRESH),
		(error) => error instanceof CealPersonalClientSessionError && error.code === "request_timeout",
	);

	const broken = createCealPersonalClientSessionClient({
		endpoint: SESSION_ENDPOINT,
		fetchFn: async () => {
			throw new Error("connection reset");
		},
	});
	await assert.rejects(
		() => broken.revoke(REFRESH),
		(error) => error instanceof CealPersonalClientSessionError && error.code === "request_failed",
	);
});
