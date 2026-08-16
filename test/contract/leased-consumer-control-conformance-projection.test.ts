import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	decodeCealLeasedConsumerDispositionControlRequest,
	decodeCealLeasedConsumerDispositionControlResponse,
} from "../../packages/ceal-protocol/src/leased-consumer-disposition-control.ts";
import { openLeasedConsumerControlSession } from "../../packages/ceal-worker-cli/src/leased-consumer-control-session.ts";
import {
	controlSessionContractFromVerifiedConformance,
	projectVerifiedControlConformanceRoutes,
	readControlSessionContract,
} from "../../scripts/generate-leased-consumer-handoff-runtime.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");

const REQUEST_SCHEMA = "ceal.leased_consumer_capability_control_request.v5";
const RESPONSE_SCHEMA = "ceal.leased_consumer_capability_control_response.v5";
const HANDOFF = {
	gateway_tag: "gateway-protocol-handoff-v0.72.21",
	gateway_commit: "a".repeat(40),
	protocol_tree: "b".repeat(40),
	archive_sha256: "c".repeat(64),
};

type JsonRecord = Record<string, unknown>;
type Decoded = JsonRecord & { operation: string };
type Operation = JsonRecord & {
	operation: string;
	path: string;
	request: JsonRecord & { schema_version: string; operation: string };
	response: JsonRecord & { schema_version: string; operation: string };
};

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asRecord(value: unknown): JsonRecord {
	if (!isRecord(value)) throw new Error("invalid_decoder_input");
	return value;
}
function asDecoded(value: unknown): Decoded {
	const record = asRecord(value);
	if (typeof record.operation !== "string") throw new Error("invalid_decoder_input");
	return { ...record, operation: record.operation };
}

function operation(operation: string, route: string): Operation {
	return {
		operation,
		path: route,
		request: { schema_version: REQUEST_SCHEMA, operation, input: { fixture: operation } },
		response: { schema_version: RESPONSE_SCHEMA, operation, result: { fixture: operation } },
	};
}

function conformanceBytes(
	operations: Operation[] = [
		operation("call", "/api/ceal/agent/v1/call"),
		operation("materialization", "/api/ceal/agent/v1/control/materialization"),
	],
) {
	return Buffer.from(
		JSON.stringify({
			schema_version: "ceal.gateway_leased_consumer_control_conformance_handoff.fixture",
			operations,
		}),
	);
}

const decoders = {
	decodeRequest(value: unknown) {
		const record = asDecoded(value);
		assert.deepEqual(Object.keys(record).sort(), ["input", "operation", "schema_version"]);
		assert.equal(record.schema_version, REQUEST_SCHEMA);
		assert.deepEqual(record.input, { fixture: record.operation });
		return record;
	},
	decodeResponse(value: unknown) {
		const record = asDecoded(value);
		assert.deepEqual(Object.keys(record).sort(), ["operation", "result", "schema_version"]);
		assert.equal(record.schema_version, RESPONSE_SCHEMA);
		assert.deepEqual(record.result, { fixture: record.operation });
		return record;
	},
};

test("verified control conformance is the sole operation and fixed-route authority", () => {
	const bytes = conformanceBytes();
	assert.deepEqual(projectVerifiedControlConformanceRoutes(bytes, decoders), {
		call: "/api/ceal/agent/v1/call",
		materialization: "/api/ceal/agent/v1/control/materialization",
	});
	const base: JsonRecord & { gateway: JsonRecord; agent_ipc?: JsonRecord } = {
		gateway: { transport: "unix_socket", routes: { call: "/api/ceal/agent/v1/call" } },
	};
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
	const omitted: JsonRecord = { gateway: { routes: { call: "/api/ceal/agent/v1/call" } } };
	assert.throws(() => controlSessionContractFromVerifiedConformance(omitted, bytes, decoders), /invalid_control_session_contract/u);
	const drifted: JsonRecord = {
		gateway: {
			routes: {
				call: "/api/ceal/agent/v1/call",
				materialization: "/api/ceal/agent/v1/control/caller-selected",
			},
		},
	};
	assert.throws(() => controlSessionContractFromVerifiedConformance(drifted, bytes, decoders), /invalid_control_session_contract/u);
	assert.throws(
		() => controlSessionContractFromVerifiedConformance({ gateway: { routes: {} } }, bytes, decoders, { materialize: true }),
		/invalid_control_session_contract/u,
	);
	assert.throws(() => projectVerifiedControlConformanceRoutes(bytes, undefined), /invalid_control_conformance/u);
	assert.throws(() => projectVerifiedControlConformanceRoutes(bytes, null), /invalid_control_conformance/u);
});

test("control-session lock identity is validated before route projection is accepted", (t) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-control-session-lock-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const contractPath = path.join(root, "leased-consumer-control-session-contract.json");
	writeFileSync(contractPath, readFileSync(path.join(ROOT, "packages/ceal-worker-cli/leased-consumer-control-session-contract.json")));
	const lockPath = path.join(root, "gateway-protocol-handoff-lock.json");
	const malformed = readFileSync(path.join(ROOT, "gateway-protocol-handoff-lock.json"), "utf8").replace(
		/"commit": "[a-f0-9]{40}"/u,
		'"commit": "not-a-commit"',
	);
	writeFileSync(lockPath, malformed);
	assert.throws(() => readControlSessionContract(contractPath, { repoRoot: root }), /invalid_control_session_contract/u);
});

test("a changed reviewed archive identity cannot reuse an old projected contract", () => {
	const base: JsonRecord = { agent_ipc: {}, gateway: { routes: {} }, gateway_protocol_handoff: {} };
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

test("materialization forwarding keeps the protected session and signed fixed route", async () => {
	const calls: JsonRecord[] = [];
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
