import "../../../test/require-source-lane.ts";
import { required as requiredValue } from "../../../test/required.ts";
import { CealEnrollmentClientError, createCealEnrollmentClient } from "../src/index.ts";
import {
	abortingFetch,
	brokenFetch,
	close,
	ignoringAbortFetch,
	listen,
	mustNotFetch,
	nonTerminatingBodyFetch,
	oversizedStreamFetch,
	parseJsonRecord,
	readBody,
	responseFetch,
	untrustedResponseCases,
} from "./client-response-test-support.ts";
import { CEAL_GATEWAY_DECODE_GENERATION_HEADER } from "@corca-ai/ceal-protocol";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

test("enrollment client exchanges one code over the derived loopback route", async () => {
	const requests: Array<{ url: string | undefined; decodeGeneration: string | undefined; body: ReturnType<typeof parseJsonRecord> }> = [];
	const server = createServer(async (request, response) => {
		requests.push({
			url: request.url,
			decodeGeneration:
				typeof request.headers[CEAL_GATEWAY_DECODE_GENERATION_HEADER] === "string"
					? request.headers[CEAL_GATEWAY_DECODE_GENERATION_HEADER]
					: undefined,
			body: parseJsonRecord(await readBody(request)),
		});
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(enrollmentResult()));
	});
	await listen(server);
	const address = server.address();
	try {
		if (address === null || typeof address === "string") throw new Error("server did not bind");
		const client = createCealEnrollmentClient({ endpoint: `http://127.0.0.1:${address.port}/api/ceal/v1` });
		const result = await client.exchange("A".repeat(43));
		assert.equal(result.ok, true);
		assert.equal(result.profile_ref, "profile:narnia");
		const request = requiredValue(requests[0], "enrollment_request");
		assert.equal(request.url, "/api/ceal/v1/enroll");
		assert.equal(request.body.code, "A".repeat(43));
		assert.equal(request.decodeGeneration, undefined);
		// Drift guard: the hardcoded client-identification version must track
		// the client package manifest.
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		assert.deepEqual(request.body.client, { name: "ceal", version: manifest.version });
	} finally {
		await close(server);
	}
});

test("enrollment client rejects plaintext remote, malformed codes, and unsafe responses", async () => {
	assert.throws(
		() => createCealEnrollmentClient({ endpoint: "http://gateway.example.test/api/ceal/v1" }),
		(error) => error instanceof CealEnrollmentClientError && error.code === "invalid_configuration",
	);
	const client = createCealEnrollmentClient({
		endpoint: "https://gateway.example.test/api/ceal/v1",
		fetchFn: async () => globalThis.Response.json({ ok: true, access_token: "unsafe" }),
	});
	await assert.rejects(
		client.exchange("short"),
		(error) => error instanceof CealEnrollmentClientError && error.code === "invalid_configuration",
	);
	await assert.rejects(
		client.exchange("A".repeat(43)),
		(error) => error instanceof CealEnrollmentClientError && error.code === "invalid_response",
	);
});

test("enrollment client preserves a typed Protocol failure carried by non-2xx", async () => {
	const failure = {
		schema_version: "ceal.enrollment_result.v1",
		ok: false,
		error: {
			code: "enrollment_expired",
			message: "The enrollment code expired.",
			next_action: "Request a new enrollment code.",
		},
	};
	const client = createCealEnrollmentClient({
		endpoint: ENDPOINT,
		fetchFn: async () =>
			new globalThis.Response(JSON.stringify(failure), {
				status: 410,
				headers: { "content-type": "application/json; charset=utf-8" },
			}),
	});
	assert.deepEqual(await client.exchange(VALID_CODE), failure);
});

test("enrollment client refuses a non-2xx response whose body claims success", async () => {
	const client = createCealEnrollmentClient({
		endpoint: ENDPOINT,
		fetchFn: async () => globalThis.Response.json(enrollmentResult(), { status: 500 }),
	});
	await assert.rejects(
		() => client.exchange(VALID_CODE),
		(error) => error instanceof CealEnrollmentClientError && error.code === "invalid_response",
	);
});

// The refusal paths carried no coverage, which meant the guards that make this
// client safe to point at an arbitrary endpoint were unexercised. Each case
// below is a distinct reason to refuse, asserted by its own error code rather
// than by "it threw".
const VALID_CODE = "A".repeat(48);
const ENDPOINT = "https://gateway.example/api/ceal/v1";

test("construction refuses an unusable transport or timeout before any request", () => {
	assert.throws(
		() => createCealEnrollmentClient({ endpoint: ENDPOINT, fetchFn: "not-a-function" as never }),
		(error) => error instanceof CealEnrollmentClientError && error.code === "invalid_configuration",
	);
	// A timeout outside the bounded window is a configuration error, not a value
	// to clamp: silently clamping would let a caller believe it set a deadline.
	for (const timeoutMs of [0, -1, 1.5, 120_001, Number.NaN, Number.MAX_SAFE_INTEGER]) {
		assert.throws(
			() => createCealEnrollmentClient({ endpoint: ENDPOINT, fetchFn: mustNotFetch(), timeoutMs }),
			(error) => error instanceof CealEnrollmentClientError && error.code === "invalid_configuration",
			`timeoutMs ${String(timeoutMs)} must be refused`,
		);
	}
});

test("the endpoint is refused before it can be dialled", () => {
	const refused: Array<[string, string]> = [
		["not a url", "an unparseable endpoint"],
		["https://user:pw@gateway.example/api", "embedded credentials"],
		["https://gateway.example/api?token=x", "a query string"],
		["https://gateway.example/api#frag", "a fragment"],
		["http://gateway.example/api", "plaintext to a non-loopback host"],
		["ftp://gateway.example/api", "a non-HTTP scheme"],
	];
	for (const [endpoint, why] of refused) {
		assert.throws(
			() => createCealEnrollmentClient({ endpoint, fetchFn: mustNotFetch() }),
			(error) => error instanceof CealEnrollmentClientError && error.code === "invalid_configuration",
			`${why} must be refused`,
		);
	}
	// Loopback over plaintext is the one allowed exception, for local Gateways.
	for (const endpoint of ["http://127.0.0.1:8080/api", "http://[::1]:8080/api"]) {
		assert.doesNotThrow(() => createCealEnrollmentClient({ endpoint, fetchFn: mustNotFetch() }));
	}
});

test("a malformed enrollment code never reaches the network", async () => {
	const client = createCealEnrollmentClient({ endpoint: ENDPOINT, fetchFn: mustNotFetch() });
	for (const code of ["", "short", `${"A".repeat(31)}`, "A".repeat(257), `${"A".repeat(40)} space`, "has/slash".padEnd(40, "A")]) {
		await assert.rejects(
			() => client.exchange(code),
			(error) => error instanceof CealEnrollmentClientError && error.code === "invalid_configuration",
			`code ${JSON.stringify(code)} must be refused locally`,
		);
	}
});

test("a response this client cannot trust is invalid_response, not a parsed guess", async () => {
	for (const [options, why] of untrustedResponseCases(enrollmentResult())) {
		const client = createCealEnrollmentClient({ endpoint: ENDPOINT, fetchFn: responseFetch(options) });
		await assert.rejects(
			() => client.exchange(VALID_CODE),
			(error) => error instanceof CealEnrollmentClientError && error.code === "invalid_response",
			`${why} must be invalid_response`,
		);
	}
});

test("an undeclared body over the cap is refused mid-stream rather than buffered whole", async () => {
	// No content-length, so the only defence is the running total while reading.
	// A client that trusted the header alone would buffer this to exhaustion.
	const oversized = oversizedStreamFetch();
	const client = createCealEnrollmentClient({ endpoint: ENDPOINT, fetchFn: oversized.fetchFn });
	await assert.rejects(
		() => client.exchange(VALID_CODE),
		(error) => error instanceof CealEnrollmentClientError && error.code === "invalid_response",
	);
	assert.equal(oversized.wasCancelled(), true, "the oversized body must be cancelled, not drained");
});

test("a timeout and a transport failure are told apart", async () => {
	const timedOut = createCealEnrollmentClient({
		endpoint: ENDPOINT,
		timeoutMs: 1,
		fetchFn: abortingFetch,
	});
	await assert.rejects(
		() => timedOut.exchange(VALID_CODE),
		(error) => error instanceof CealEnrollmentClientError && error.code === "request_timeout",
	);

	const broken = createCealEnrollmentClient({
		endpoint: ENDPOINT,
		fetchFn: brokenFetch,
	});
	await assert.rejects(
		() => broken.exchange(VALID_CODE),
		(error) => error instanceof CealEnrollmentClientError && error.code === "request_failed",
	);
});

test("the lifecycle deadline wins when injected fetch or body ignores abort", async () => {
	for (const [why, fetchFn] of [
		["fetch", ignoringAbortFetch],
		["response body", nonTerminatingBodyFetch],
	] as const) {
		const client = createCealEnrollmentClient({ endpoint: ENDPOINT, timeoutMs: 5, fetchFn });
		await assert.rejects(
			() => client.exchange(VALID_CODE),
			(error) => error instanceof CealEnrollmentClientError && error.code === "request_timeout",
			why,
		);
	}
});

function enrollmentResult() {
	return {
		schema_version: "ceal.enrollment_result.v1",
		ok: true,
		profile_ref: "profile:narnia",
		membership_ref: "membership:narnia",
		registration_ref: "registration:narnia",
		client_ref: "client:narnia",
		subject_ref: "subject:hwidong",
		instance_ref: "instance:corca",
		access_token: `ceal_personal_${"B".repeat(43)}`,
		expires_at: "2026-07-14T00:00:00.000Z",
		refresh_token: `ceal_refresh_${"R".repeat(43)}`,
		refresh_token_idle_expires_at: "2026-08-12T06:00:00.000Z",
		refresh_token_absolute_expires_at: "2026-10-11T06:00:00.000Z",
	};
}
