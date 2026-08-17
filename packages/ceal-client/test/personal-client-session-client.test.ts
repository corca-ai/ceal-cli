import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import { CEAL_GATEWAY_DECODE_GENERATION_HEADER } from "@corca-ai/ceal-protocol";
import { CealPersonalClientSessionError, createCealPersonalClientSessionClient } from "../src/index.ts";
import type { JsonRecord } from "./client-response-test-support.ts";
import {
	abortingFetch,
	brokenFetch,
	close,
	listen,
	mustNotFetch,
	oversizedStreamFetch,
	parseJsonRecord,
	readBody,
	responseFetch,
	serverPort,
	untrustedResponseCases,
} from "./client-response-test-support.ts";

const REFRESH = `ceal_refresh_${"R".repeat(43)}`;

test("personal-client session client rotates and revokes only through derived Gateway routes", async () => {
	const requests: Array<{ url: string | undefined; decodeGeneration: string | undefined; body: JsonRecord }> = [];
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
		if (request.url?.endsWith("/refresh")) {
			response.end(JSON.stringify(refreshResult()));
		} else {
			response.end(JSON.stringify({ schema_version: "ceal.client_revoke_result.v1", ok: true, revoked: true }));
		}
	});
	await listen(server);
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("missing address");
	try {
		const client = createCealPersonalClientSessionClient({ endpoint: `http://127.0.0.1:${serverPort(server)}/api/ceal/v1` });
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
		assert.ok(requests.every((item) => item.decodeGeneration === undefined));
		// Drift guard: the hardcoded client-identification version must track
		// the client package manifest.
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		assert.deepEqual(requests[0].body.client, { name: "ceal", version: manifest.version });
	} finally {
		await close(server);
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

test("session client construction refuses an unusable transport or timeout", () => {
	assert.throws(
		() => createCealPersonalClientSessionClient({ endpoint: SESSION_ENDPOINT, fetchFn: "not-a-function" as never }),
		(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_configuration",
	);
	for (const timeoutMs of [0, -1, 2.5, 120_001, Number.NaN]) {
		assert.throws(
			() => createCealPersonalClientSessionClient({ endpoint: SESSION_ENDPOINT, fetchFn: mustNotFetch(), timeoutMs }),
			(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_configuration",
			`timeoutMs ${String(timeoutMs)} must be refused`,
		);
	}
	assert.throws(
		() => createCealPersonalClientSessionClient({ endpoint: "not a url", fetchFn: mustNotFetch() }),
		(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_configuration",
	);
});

test("a session response this client cannot trust is invalid_response on both routes", async () => {
	// Both routes share the request path, so both must refuse identically; a
	// guard that only covered `refresh` would leave revocation trusting bytes.
	for (const route of ["refresh", "revoke"] as const) {
		const validResponse = route === "refresh" ? refreshResult() : { schema_version: "ceal.client_revoke_result.v1", ok: true, revoked: true };
		for (const [options, why] of untrustedResponseCases(validResponse)) {
			const client = createCealPersonalClientSessionClient({ endpoint: SESSION_ENDPOINT, fetchFn: responseFetch(options) });
			await assert.rejects(
				() => invokeRoute(client, route),
				(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_response",
				`${route}: ${why} must be invalid_response`,
			);
		}
	}
});

test("session client preserves typed Protocol failures carried by non-2xx", async () => {
	for (const [route, schemaVersion] of [
		["refresh", "ceal.client_refresh_result.v1"],
		["revoke", "ceal.client_revoke_result.v1"],
	] as const) {
		const failure = {
			schema_version: schemaVersion,
			ok: false,
			error: {
				code: "refresh_expired",
				message: "The personal-client session expired.",
				next_action: "Enroll the client again.",
			},
		};
		const client = createCealPersonalClientSessionClient({
			endpoint: SESSION_ENDPOINT,
			fetchFn: async () => globalThis.Response.json(failure, { status: 401 }),
		});
		assert.deepEqual(await invokeRoute(client, route), failure, route);
	}
});

test("session client refuses non-2xx responses whose bodies claim success", async () => {
	for (const [route, success] of [
		["refresh", refreshResult()],
		["revoke", { schema_version: "ceal.client_revoke_result.v1", ok: true, revoked: true }],
	] as const) {
		const client = createCealPersonalClientSessionClient({
			endpoint: SESSION_ENDPOINT,
			fetchFn: async () => globalThis.Response.json(success, { status: 500 }),
		});
		await assert.rejects(
			() => invokeRoute(client, route),
			(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_response",
			route,
		);
	}
});

test("an undeclared oversized session body is refused mid-stream and cancelled", async () => {
	const oversized = oversizedStreamFetch();
	const client = createCealPersonalClientSessionClient({ endpoint: SESSION_ENDPOINT, fetchFn: oversized.fetchFn });
	await assert.rejects(
		() => client.refresh(REFRESH),
		(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_response",
	);
	assert.equal(oversized.wasCancelled(), true, "the oversized body must be cancelled, not drained");
});

test("a session timeout and a transport failure are told apart", async () => {
	const timedOut = createCealPersonalClientSessionClient({
		endpoint: SESSION_ENDPOINT,
		timeoutMs: 1,
		fetchFn: abortingFetch,
	});
	await assert.rejects(
		() => timedOut.refresh(REFRESH),
		(error) => error instanceof CealPersonalClientSessionError && error.code === "request_timeout",
	);

	const broken = createCealPersonalClientSessionClient({
		endpoint: SESSION_ENDPOINT,
		fetchFn: brokenFetch,
	});
	await assert.rejects(
		() => broken.revoke(REFRESH),
		(error) => error instanceof CealPersonalClientSessionError && error.code === "request_failed",
	);
});

function refreshResult() {
	return {
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
	};
}

type SessionRoute = "refresh" | "revoke";
type SessionClient = ReturnType<typeof createCealPersonalClientSessionClient>;

function invokeRoute(client: SessionClient, route: SessionRoute): ReturnType<SessionClient[SessionRoute]> {
	return route === "refresh" ? client.refresh(REFRESH) : client.revoke(REFRESH);
}
