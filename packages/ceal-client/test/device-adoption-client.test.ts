import "../../../test/require-source-lane.ts";
import { required as requiredValue } from "../../../test/required.ts";
import { CealDeviceAdoptionClientError, createCealDeviceAdoptionClient } from "../src/index.ts";
import { close, json, listen, readBody, serverPort } from "./client-response-test-support.ts";
import {
	CEAL_GATEWAY_DECODE_GENERATION_HEADER,
	type CealDeviceEnrollmentPollRequest,
	type CealDeviceEnrollmentStartRequest,
} from "@corca-ai/ceal-protocol";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import test from "node:test";

// Driven against a real loopback socket rather than an injected fetch, because
// the failures worth catching here are transport failures: a redirect, a wrong
// content type, a body that never ends. An injected fetch would let this file
// pass while none of those were handled.

const NONCE = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA";
const HANDLE = "ISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A";
const PROOF_KEY = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVpbXF1eX2A";
const RECIPIENT_KEY = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1-f4A";
const SIGNATURE = "a".repeat(86);

test("start and poll reach their own routes and return decoded Protocol values", async () => {
	const seen: Array<{
		url: string | undefined;
		method: string | undefined;
		contentType: string | undefined;
		decodeGeneration: string | undefined;
		body: string;
	}> = [];
	await withServer(
		(req, res) => {
			readBody(req).then((body) => {
				seen.push({
					url: req.url,
					method: req.method,
					contentType: req.headers["content-type"],
					decodeGeneration:
						typeof req.headers[CEAL_GATEWAY_DECODE_GENERATION_HEADER] === "string"
							? req.headers[CEAL_GATEWAY_DECODE_GENERATION_HEADER]
							: undefined,
					body,
				});
				json(res, req.url?.endsWith("/adopt/start") ? startResult() : { schema_version: POLL_SCHEMA, status: "pending", retry_after_ms: 1000 });
			});
		},
		async (endpoint) => {
			const client = createCealDeviceAdoptionClient({ endpoint });
			const started = await client.start(startRequest());
			assert.equal(started.status, "pending");
			assert.equal(started.transaction_ref, "adoption:1");
			const polled = await client.poll({
				schema_version: POLL_REQUEST_SCHEMA,
				registration_ref: "registration:1",
				nonce_ref: "nonce:1",
				signature: SIGNATURE,
			});
			assert.equal(polled.status, "pending");
			assert.equal(polled.retry_after_ms, 1000);
		},
	);
	assert.deepEqual(
		seen.map((entry) => entry.url),
		["/api/ceal/v1/adopt/start", "/api/ceal/v1/adopt/poll"],
	);
	assert.ok(seen.every((entry) => entry.method === "POST" && entry.contentType === "application/json"));
	assert.ok(seen.every((entry) => entry.decodeGeneration === undefined));
	assert.equal(JSON.parse(requiredValue(seen[0], "adoption_start_request").body).email, "employee@example.test");
	assert.deepEqual(JSON.parse(requiredValue(seen[1], "adoption_poll_request").body), {
		schema_version: "ceal.device_enrollment_poll.v1",
		registration_ref: "registration:1",
		nonce_ref: "nonce:1",
		signature: SIGNATURE,
	});
});

test("a redirect is refused rather than followed", async () => {
	await withServer(
		(req, res) => {
			req.resume();
			res.writeHead(302, { location: "https://attacker.example.test/adopt/start" });
			res.end();
		},
		async (endpoint) => {
			await assert.rejects(
				() => createCealDeviceAdoptionClient({ endpoint }).start(startRequest()),
				(error) => error instanceof CealDeviceAdoptionClientError && error.code === "request_failed",
				"a redirect would move an email address and a proof key to an unpinned origin",
			);
		},
	);
});

test("a non-JSON body, a wrong content type, and an off-Protocol shape are all invalid responses", async () => {
	for (const responder of [
		(res: ServerResponse) => {
			res.writeHead(200, { "content-type": "text/html" });
			res.end("<html>ok</html>");
		},
		(res: ServerResponse) => {
			res.writeHead(200, { "content-type": "application/json" });
			res.end("not json");
		},
		(res: ServerResponse) => {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ schema_version: "ceal.device_enrollment_start_result.v1", status: "approved" }));
		},
	]) {
		await withServer(
			(req, res) => {
				req.resume();
				responder(res);
			},
			async (endpoint) => {
				await assert.rejects(
					() => createCealDeviceAdoptionClient({ endpoint }).start(startRequest()),
					(error) => error instanceof CealDeviceAdoptionClientError && error.code === "invalid_response",
				);
			},
		);
	}
});

test("start preserves only the Gateway's exact typed availability failures", async () => {
	for (const [status, errorCode] of [
		[404, "adoption_not_available"],
		[503, "gateway_unavailable"],
		[429, "rate_limited"],
	] as const) {
		await withServer(
			(req, res) => {
				req.resume();
				json(res, { ok: false, error_code: errorCode }, status);
			},
			async (endpoint) =>
				assert.rejects(
					() => createCealDeviceAdoptionClient({ endpoint }).start(startRequest()),
					(error) => error instanceof CealDeviceAdoptionClientError && error.code === errorCode,
				),
		);
	}
	await withServer(
		(req, res) => {
			req.resume();
			json(res, { ok: false, error_code: "adoption_not_available" }, 503);
		},
		async (endpoint) =>
			assert.rejects(
				() => createCealDeviceAdoptionClient({ endpoint }).start(startRequest()),
				(error) => error instanceof CealDeviceAdoptionClientError && error.code === "invalid_response",
			),
	);
});

test("poll rejects start-only typed failures as invalid responses", async () => {
	for (const [status, errorCode] of [
		[404, "adoption_not_available"],
		[503, "gateway_unavailable"],
		[429, "rate_limited"],
	] as const) {
		await withServer(
			(req, res) => {
				req.resume();
				json(res, { ok: false, error_code: errorCode }, status);
			},
			async (endpoint) =>
				assert.rejects(
					() =>
						createCealDeviceAdoptionClient({ endpoint }).poll({
							schema_version: POLL_REQUEST_SCHEMA,
							registration_ref: "registration:1",
							nonce_ref: "nonce:1",
							signature: SIGNATURE,
						}),
					(error) => error instanceof CealDeviceAdoptionClientError && error.code === "invalid_response",
				),
		);
	}
});

test("a Gateway that never answers is bounded by the configured timeout", async () => {
	await withServer(
		(req) => {
			req.resume();
		},
		async (endpoint) => {
			await assert.rejects(
				() => createCealDeviceAdoptionClient({ endpoint, timeoutMs: 50 }).start(startRequest()),
				(error) => error instanceof CealDeviceAdoptionClientError && error.code === "request_timeout",
			);
		},
	);
});

test("an oversized response is cut off instead of being buffered", async () => {
	await withServer(
		(req, res) => {
			req.resume();
			res.writeHead(200, { "content-type": "application/json" });
			// Streamed without a content-length so the bound has to come from the
			// reader rather than from a header the Gateway could simply omit.
			const chunk = "x".repeat(64 * 1024);
			for (let index = 0; index < 4; index += 1) res.write(chunk);
			res.end();
		},
		async (endpoint) => {
			await assert.rejects(
				() => createCealDeviceAdoptionClient({ endpoint }).start(startRequest()),
				(error) => error instanceof CealDeviceAdoptionClientError && error.code === "invalid_response",
			);
		},
	);
});

test("unusable endpoints and malformed requests never leave the process", async () => {
	for (const endpoint of [
		"http://ceal.example.test/api/ceal/v1",
		"https://user:pass@ceal.example.test/api/ceal/v1",
		"https://ceal.example.test/api/ceal/v1?token=x",
		"https://ceal.example.test/api/ceal/v1#fragment",
		"ftp://ceal.example.test",
		"not a url",
	]) {
		assert.throws(
			() => createCealDeviceAdoptionClient({ endpoint }),
			(error) => error instanceof CealDeviceAdoptionClientError && error.code === "invalid_configuration",
			`${endpoint} must be refused before any request`,
		);
	}
	// A local request the Protocol would reject fails here rather than reaching
	// the Gateway with an address attached to it.
	const client = createCealDeviceAdoptionClient({
		endpoint: "https://ceal.example.test/api/ceal/v1",
		fetchFn: async () => assert.fail("an invalid request must not fetch"),
	});
	await assert.rejects(
		() => client.start({ ...startRequest(), email: "not-an-address" }),
		(error) => error instanceof CealDeviceAdoptionClientError && error.code === "invalid_configuration",
	);
	await assert.rejects(
		() => client.poll({ schema_version: POLL_REQUEST_SCHEMA, registration_ref: "registration:1", nonce_ref: "nonce:1", signature: "" }),
		(error) => error instanceof CealDeviceAdoptionClientError && error.code === "invalid_configuration",
	);
	for (const request of [
		{ schema_version: POLL_REQUEST_SCHEMA, registration_ref: "", nonce_ref: "nonce:1", signature: SIGNATURE },
		{ schema_version: POLL_REQUEST_SCHEMA, registration_ref: "registration:1", nonce_ref: "", signature: SIGNATURE },
		{ schema_version: POLL_REQUEST_SCHEMA, registration_ref: "registration:1", nonce_ref: "nonce:1", signature: "x" },
		{ schema_version: POLL_REQUEST_SCHEMA, registration_ref: "registration:1", nonce_ref: "nonce:1", signature: SIGNATURE, extra: "leak" },
	]) {
		await assert.rejects(
			() => client.poll(request as CealDeviceEnrollmentPollRequest),
			(error) => error instanceof CealDeviceAdoptionClientError && error.code === "invalid_configuration",
		);
	}
});

const POLL_SCHEMA = "ceal.device_enrollment_poll_result.v1";
const POLL_REQUEST_SCHEMA = "ceal.device_enrollment_poll.v1";

function startRequest(): CealDeviceEnrollmentStartRequest {
	return {
		schema_version: "ceal.device_enrollment_start.v1",
		email: "employee@example.test",
		proof_suite: "Ed25519",
		proof_public_key: PROOF_KEY,
		recipient_suite: "X25519",
		recipient_public_key: RECIPIENT_KEY,
		client: { name: "ceal", version: "0.69.0", protocol_version: "1.3.0", features: ["device_enrollment_sealed_v1"] },
	};
}

function startResult() {
	return {
		schema_version: "ceal.device_enrollment_start_result.v1",
		status: "pending",
		transaction_ref: "adoption:1",
		registration_ref: "registration:1",
		gateway_origin: "https://ceal.example.test",
		proof_key_sha256: "a".repeat(64),
		recipient_key_sha256: "b".repeat(64),
		challenge_handle: HANDLE,
		browser_session_url: `https://ceal.example.test/adopt/verify/${encodeURIComponent("adoption:1")}`,
		challenge: {
			schema_version: "ceal.device_enrollment_challenge.v1",
			registration_ref: "registration:1",
			nonce_ref: "nonce:1",
			nonce: NONCE,
			gateway_origin: "https://ceal.example.test",
			proof_suite: "Ed25519",
			protocol_version: "1.3.0",
			expires_at: "2126-07-29T12:10:00.000Z",
		},
	};
}

async function withServer(
	handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
	action: (endpoint: string) => Promise<void>,
): Promise<void> {
	const server = createServer(handler);
	await listen(server);
	try {
		await action(`http://127.0.0.1:${serverPort(server)}/api/ceal/v1`);
	} finally {
		await close(server);
	}
}
