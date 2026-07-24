import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import { createCealEnrollmentClient, CealEnrollmentClientError } from "../dist/index.js";

test("enrollment client exchanges one code over the derived loopback route", async () => {
	const requests = [];
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		requests.push({ url: request.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({
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
		}));
	});
	await listen(server);
	const address = server.address();
	try {
		const client = createCealEnrollmentClient({ endpoint: `http://127.0.0.1:${address.port}/api/ceal/v1` });
		const result = await client.exchange("A".repeat(43));
		assert.equal(result.ok, true);
		assert.equal(result.profile_ref, "profile:narnia");
		assert.equal(requests[0].url, "/api/ceal/v1/enroll");
		assert.equal(requests[0].body.code, "A".repeat(43));
		// Drift guard: the hardcoded client-identification version must track
		// the client package manifest.
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		assert.deepEqual(requests[0].body.client, { name: "ceal", version: manifest.version });
	} finally { await close(server); }
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
	await assert.rejects(client.exchange("short"), (error) => error.code === "invalid_configuration");
	await assert.rejects(client.exchange("A".repeat(43)), (error) => error.code === "invalid_response");
});

function listen(server) {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
}

function close(server) {
	return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
