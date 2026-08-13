import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import { createCealClient } from "../src/index.ts";

test("client adds the public protocol version without assuming a Gateway transport", async () => {
	let observed;
	const transport = {
		async send(request) {
			observed = request;
			return {
				ok: true,
				request_id: request.request_id,
				protocol_version: "1.3.0",
				value: { accepted: true },
			};
		},
	};
	const client = createCealClient(transport);
	const response = await client.request({
		request_id: "request:test-001",
		operation: "call",
		profile_ref: "profile:test",
		body: { capability: "message.search" },
	});
	assert.deepEqual(observed, {
		request_id: "request:test-001",
		protocol_version: "1.3.0",
		operation: "call",
		profile_ref: "profile:test",
		body: { capability: "message.search" },
	});
	assert.deepEqual(response, { ok: true, request_id: "request:test-001", protocol_version: "1.3.0", value: { accepted: true } });
});

test("client rejects request identifiers that are unsafe to correlate", async () => {
	const client = createCealClient({
		send: async () => {
			throw new Error("must not send");
		},
	});
	await assert.rejects(client.request({ request_id: "contains whitespace", operation: "discover", body: {} }), /redaction-safe identifier/u);
});

test("wire DTO ownership stays in protocol source", async () => {
	const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
	assert.match(source, /export type \{[\s\S]*CealClientRequest[\s\S]*\} from "@corca-ai\/ceal-protocol";/u);
	assert.match(source, /import \{ CEAL_PROTOCOL_VERSION \} from "@corca-ai\/ceal-protocol";/u);
	assert.doesNotMatch(source, /export (?:interface|type) CealClient(?:Request|Response|Success|Failure|Operation)\b/u);
	assert.doesNotMatch(source, /export (?:interface|type) CealProof(?:ReferenceOrUnavailable|Unavailable)\b/u);
	assert.doesNotMatch(source, /(?:const|let|var)\s+\w*PROTOCOL_VERSION\s*=|["']1\.0\.0["']/u);
});
