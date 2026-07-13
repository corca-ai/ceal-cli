import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createCealPersonalClientSessionClient, CealPersonalClientSessionError } from "../dist/index.js";

const REFRESH = `ceal_refresh_${"R".repeat(43)}`;

test("personal-client session client rotates and revokes only through derived Gateway routes", async () => {
	const requests = [];
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		requests.push({ url: request.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
		response.writeHead(200, { "content-type": "application/json" });
		if (request.url?.endsWith("/refresh")) {
			response.end(JSON.stringify({
				schema_version: "ceal.client_refresh_result.v1", ok: true,
				profile_ref: "profile:work", registration_ref: "registration:narnia", client_ref: "client:narnia",
				runner_ref: "runner:narnia", subject_ref: "subject:hwidong", instance_ref: "instance:ceal-dev",
				access_token: `ceal_personal_${"A".repeat(43)}`, expires_at: "2026-07-13T06:15:00.000Z",
				refresh_token: `ceal_refresh_${"N".repeat(43)}`,
				refresh_token_idle_expires_at: "2026-08-12T06:00:00.000Z",
				refresh_token_absolute_expires_at: "2026-10-11T06:00:00.000Z",
			}));
		} else {
			response.end(JSON.stringify({ schema_version: "ceal.client_revoke_result.v1", ok: true, revoked: true }));
		}
	});
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("missing address");
	try {
		const client = createCealPersonalClientSessionClient({ endpoint: `http://127.0.0.1:${address.port}/api/ceal/v1` });
		const refreshed = await client.refresh(REFRESH);
		assert.equal(refreshed.ok, true);
		const revoked = await client.revoke(REFRESH);
		assert.equal(revoked.ok, true);
		assert.deepEqual(requests.map((item) => item.url), ["/api/ceal/v1/refresh", "/api/ceal/v1/revoke"]);
		assert.equal(requests[0].body.refresh_token, REFRESH);
		assert.equal(requests[1].body.refresh_token, REFRESH);
	} finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

test("personal-client session client rejects unsafe endpoints and token drift before fetch", async () => {
	assert.throws(
		() => createCealPersonalClientSessionClient({ endpoint: "http://gateway.example.test/api/ceal/v1" }),
		(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_configuration",
	);
	let fetched = false;
	const client = createCealPersonalClientSessionClient({
		endpoint: "https://gateway.example.test/api/ceal/v1",
		fetchFn: async () => { fetched = true; throw new Error("must not fetch"); },
	});
	await assert.rejects(
		() => client.refresh("short"),
		(error) => error instanceof CealPersonalClientSessionError && error.code === "invalid_configuration",
	);
	assert.equal(fetched, false);
});
