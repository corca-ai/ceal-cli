import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import { createCealClient } from "../dist/index.js";

test("client adds the public protocol version without assuming a Gateway transport", async () => {
	let observed;
	const transport = {
		async send(request) {
			observed = request;
			return {
				ok: true,
				request_id: request.request_id,
				protocol_version: "1.2.0",
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
		protocol_version: "1.2.0",
		operation: "call",
		profile_ref: "profile:test",
		body: { capability: "message.search" },
	});
	assert.deepEqual(response, { ok: true, request_id: "request:test-001", protocol_version: "1.2.0", value: { accepted: true } });
});

test("client rejects request identifiers that are unsafe to correlate", async () => {
	const client = createCealClient({ send: async () => { throw new Error("must not send"); } });
	await assert.rejects(
		client.request({ request_id: "contains whitespace", operation: "discover", body: {} }),
		/redaction-safe identifier/u,
	);
});

test("wire DTO ownership stays in protocol while client re-exports the public types", async () => {
	const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
	const declarations = await readFile(new URL("../dist/index.d.ts", import.meta.url), "utf8");
	const transportDeclarations = await readFile(new URL("../dist/http-transport.d.ts", import.meta.url), "utf8");
	assert.match(source, /export type \{[\s\S]*CealClientRequest[\s\S]*\} from "@corca-ai\/ceal-protocol";/u);
	assert.match(source, /import \{ CEAL_PROTOCOL_VERSION \} from "@corca-ai\/ceal-protocol";/u);
	assert.doesNotMatch(source, /export (?:interface|type) CealClient(?:Request|Response|Success|Failure|Operation)\b/u);
	assert.doesNotMatch(source, /export (?:interface|type) CealProof(?:ReferenceOrUnavailable|Unavailable)\b/u);
	assert.doesNotMatch(source, /(?:const|let|var)\s+\w*PROTOCOL_VERSION\s*=|["']1\.0\.0["']/u);
	assert.match(declarations, /request<I extends CealGatewayRequestInput>\([\s\S]*CealGatewayResponseFor<CealGatewayRequestForInput<I>>/u);
	assert.match(transportDeclarations, /send<R extends CealGatewayRequest>\([\s\S]*CealGatewayResponseFor<R>/u);
	assert.doesNotMatch(declarations, /\bTValue\b/u);
});
