import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	decodeCealLeasedConsumerDispositionControlRequest,
	decodeCealLeasedConsumerDispositionControlResponse,
} from "../../packages/ceal-protocol/src/leased-consumer-disposition-control.ts";
import {
	controlSessionContractFromVerifiedConformance,
	projectVerifiedControlConformanceRoutes,
} from "../../scripts/generate-leased-consumer-handoff-runtime.mjs";

const REQUEST_SCHEMA = "ceal.leased_consumer_capability_control_request.v5";
const RESPONSE_SCHEMA = "ceal.leased_consumer_capability_control_response.v5";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HANDOFF = {
	gateway_tag: "gateway-protocol-handoff-v0.72.21",
	gateway_commit: "a".repeat(40),
	protocol_tree: "b".repeat(40),
	archive_sha256: "c".repeat(64),
};

function operation(operation, route) {
	return {
		operation,
		path: route,
		request: { schema_version: REQUEST_SCHEMA, operation, input: { fixture: operation } },
		response: { schema_version: RESPONSE_SCHEMA, operation, result: { fixture: operation } },
	};
}

function conformanceBytes(
	operations = [operation("call", "/api/ceal/agent/v1/call"), operation("materialization", "/api/ceal/agent/v1/control/materialization")],
) {
	return Buffer.from(
		JSON.stringify({
			schema_version: "ceal.gateway_leased_consumer_control_conformance_handoff.fixture",
			operations,
		}),
	);
}

const decoders = {
	decodeRequest(value) {
		assert.deepEqual(Object.keys(value).sort(), ["input", "operation", "schema_version"]);
		assert.equal(value.schema_version, REQUEST_SCHEMA);
		assert.deepEqual(value.input, { fixture: value.operation });
		return value;
	},
	decodeResponse(value) {
		assert.deepEqual(Object.keys(value).sort(), ["operation", "result", "schema_version"]);
		assert.equal(value.schema_version, RESPONSE_SCHEMA);
		assert.deepEqual(value.result, { fixture: value.operation });
		return value;
	},
};

test("verified control conformance is the sole operation and fixed-route authority", () => {
	const bytes = conformanceBytes();
	assert.deepEqual(projectVerifiedControlConformanceRoutes(bytes, decoders), {
		call: "/api/ceal/agent/v1/call",
		materialization: "/api/ceal/agent/v1/control/materialization",
	});
	const base = { gateway: { transport: "unix_socket", routes: { call: "/api/ceal/agent/v1/call" } } };
	base.agent_ipc = {};
	const projected = controlSessionContractFromVerifiedConformance(base, bytes, decoders, { materialize: true, handoff: HANDOFF });
	assert.deepEqual(projected.gateway.routes, {
		call: "/api/ceal/agent/v1/call",
		materialization: "/api/ceal/agent/v1/control/materialization",
	});
	assert.deepEqual(controlSessionContractFromVerifiedConformance(projected, bytes, decoders), projected);
});

test("route omission and route drift from the verified sidecar are refused", () => {
	const bytes = conformanceBytes();
	const omitted = { gateway: { routes: { call: "/api/ceal/agent/v1/call" } } };
	assert.throws(() => controlSessionContractFromVerifiedConformance(omitted, bytes, decoders), /invalid_control_session_contract/u);
	const drifted = {
		gateway: {
			routes: {
				call: "/api/ceal/agent/v1/call",
				materialization: "/api/ceal/agent/v1/control/caller-selected",
			},
		},
	};
	assert.throws(() => controlSessionContractFromVerifiedConformance(drifted, bytes, decoders), /invalid_control_session_contract/u);
});

test("a changed reviewed archive identity cannot reuse an old projected contract", () => {
	const base = { agent_ipc: {}, gateway: { routes: {} }, gateway_protocol_handoff: {} };
	const bytes = conformanceBytes();
	const first = controlSessionContractFromVerifiedConformance(base, bytes, decoders, { materialize: true, handoff: HANDOFF });
	const changed = controlSessionContractFromVerifiedConformance(base, bytes, decoders, {
		materialize: true,
		handoff: { ...HANDOFF, archive_sha256: "d".repeat(64) },
	});
	assert.notDeepEqual(changed.gateway_protocol_handoff, first.gateway_protocol_handoff);
	assert.notEqual(
		createHash("sha256")
			.update(`${JSON.stringify(changed, null, "\t")}\n`)
			.digest("hex"),
		createHash("sha256")
			.update(`${JSON.stringify(first, null, "\t")}\n`)
			.digest("hex"),
	);
	assert.throws(
		() =>
			controlSessionContractFromVerifiedConformance(first, bytes, decoders, {
				handoff: { ...HANDOFF, archive_sha256: "d".repeat(64) },
			}),
		/invalid_control_session_contract/u,
		"the old projection cannot verify against the changed archive identity",
	);
});

test("each signed request and response must pass the exact canonical decoder", () => {
	const malformedRequest = operation("materialization", "/api/ceal/agent/v1/control/materialization");
	malformedRequest.request.endpoint = "/caller-selected";
	assert.throws(
		() => projectVerifiedControlConformanceRoutes(conformanceBytes([malformedRequest]), decoders),
		/invalid_control_conformance/u,
	);
	const malformedResponse = operation("materialization", "/api/ceal/agent/v1/control/materialization");
	malformedResponse.response.authorization = "Bearer caller-selected";
	assert.throws(
		() => projectVerifiedControlConformanceRoutes(conformanceBytes([malformedResponse]), decoders),
		/invalid_control_conformance/u,
	);
	const duplicate = operation("materialization", "/api/ceal/agent/v1/control/materialization");
	assert.throws(
		() => projectVerifiedControlConformanceRoutes(conformanceBytes([duplicate, duplicate]), decoders),
		/invalid_control_conformance/u,
	);
});

test("the signed v6 disposition decoders admit the exact materialization vector", () => {
	const materialization = {
		operation: "materialization",
		path: "/api/ceal/agent/v1/control/materialization",
		request: {
			schema_version: "ceal.leased_consumer_capability_control_request.v6",
			operation: "materialization",
			input: {
				event_ref: "event:interop-1",
				lease_ref: "lease:interop-1",
				lease_fence: 1,
				result_ref: `result:${"f".repeat(64)}`,
				frame_index: 0,
			},
		},
		response: {
			schema_version: "ceal.leased_consumer_capability_control_response.v6",
			operation: "materialization",
			result: {
				status: "frame",
				frame: {
					schema_version: "ceal.result_materialization_frame.v1",
					kind: "chunk",
					slot: 0,
					chunk_index: 0,
					chunk_count: 1,
					bytes_base64: "ZG9jdW1lbnQ=",
				},
			},
		},
	};
	assert.deepEqual(
		projectVerifiedControlConformanceRoutes(
			Buffer.from(
				JSON.stringify({ schema_version: "ceal.gateway_leased_consumer_control_conformance_handoff.v6", operations: [materialization] }),
			),
			{
				decodeRequest: decodeCealLeasedConsumerDispositionControlRequest,
				decodeResponse: decodeCealLeasedConsumerDispositionControlResponse,
			},
		),
		{ materialization: "/api/ceal/agent/v1/control/materialization" },
	);
});

test("materialization forwarding keeps the protected session and signed fixed route", async (context) => {
	// Keep the copied module under the workspace package so its bare Protocol
	// import resolves through the same node_modules authority as the real build.
	const scratch = mkdtempSync(path.join(ROOT, "packages/ceal-worker-cli/ceal-materialization-control-session-"));
	context.after(() => rmSync(scratch, { recursive: true, force: true }));
	const copiedDist = path.join(scratch, "dist");
	cpSync(path.join(ROOT, "packages/ceal-worker-cli/dist"), copiedDist, { recursive: true });
	const generated = path.join(copiedDist, "generated", "leased-consumer-control-session-contract.js");
	const generatedSource = readFileSync(generated, "utf8");
	const encodedContract = /CONTRACT_JSON = ("(?:[^"\\]|\\.)*")/u.exec(generatedSource)?.[1];
	assert.ok(encodedContract, "the copied artifact must embed its control-session contract");
	const baseContract = JSON.parse(JSON.parse(encodedContract));
	const signedBytes = conformanceBytes([
		...Object.entries(baseContract.gateway.routes).map(([name, route]) => operation(name, route)),
		operation("materialization", "/api/ceal/agent/v1/control/materialization"),
	]);
	const projected = controlSessionContractFromVerifiedConformance(baseContract, signedBytes, decoders, {
		materialize: true,
		handoff: HANDOFF,
	});
	const contractJson = `${JSON.stringify(projected, null, "\t")}\n`;
	const digest = createHash("sha256").update(Buffer.from(contractJson)).digest("hex");
	const rewritten = generatedSource
		.replace(/CONTRACT_JSON = "(?:[^"\\]|\\.)*"/u, `CONTRACT_JSON = ${JSON.stringify(contractJson)}`)
		.replace(/CONTRACT_SHA256 = "[a-f0-9]{64}"/u, `CONTRACT_SHA256 = "${digest}"`);
	assert.notEqual(rewritten, generatedSource);
	writeFileSync(generated, rewritten);

	const { openLeasedConsumerControlSession } = await import(pathToFileURL(path.join(copiedDist, "leased-consumer-control-session.js")));
	const calls = [];
	const session = await openLeasedConsumerControlSession({
		readProtectedSession: async () =>
			Buffer.from(
				JSON.stringify({
					schema_version: "ceal.leased_consumer_control_session.v1",
					transport: "unix_socket",
					socket_path: "/run/user/1001/ceal/protected.sock",
					service_credential: "protected-only",
				}),
			),
		closeProtectedSession: async () => {},
		decodeControlRequest: decoders.decodeRequest,
		decodeControlResponse: decoders.decodeResponse,
		requestUnixSocket: async (input) => {
			calls.push(input);
			return {
				status: 200,
				contentType: "application/json",
				bytes: Buffer.from(
					JSON.stringify({
						schema_version: RESPONSE_SCHEMA,
						operation: "materialization",
						result: { fixture: "materialization" },
					}),
				),
			};
		},
	});
	const request = {
		schema_version: REQUEST_SCHEMA,
		operation: "materialization",
		input: { fixture: "materialization" },
	};
	const response = JSON.parse(new TextDecoder().decode(await session.dispatch(Buffer.from(JSON.stringify(request)))).trim());
	assert.equal(response.operation, "materialization");
	assert.deepEqual(
		calls.map(({ socketPath, path: route, method, credential }) => ({ socketPath, route, method, credential })),
		[
			{
				socketPath: "/run/user/1001/ceal/protected.sock",
				route: "/api/ceal/agent/v1/control/materialization",
				method: "POST",
				credential: "protected-only",
			},
		],
	);
	await assert.rejects(
		session.dispatch(Buffer.from(JSON.stringify({ ...request, endpoint: "/caller-selected", authorization: "Bearer forged" }))),
	);
	assert.equal(calls.length, 1, "caller endpoint/header fields must fail before transport");
});
