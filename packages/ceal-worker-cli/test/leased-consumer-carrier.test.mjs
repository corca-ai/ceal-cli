import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LEASED_CONSUMER_CARRIER_ARGV, readLeasedConsumerRequest, runLeasedConsumerCarrier } from "../dist/leased-consumer-carrier.js";

const handoff = JSON.parse(
	readFileSync(
		new URL("../../../vendor/gateway-leased-consumer-call/gateway-leased-consumer-call-conformance.json", import.meta.url),
		"utf8",
	),
);
const carrierContract = JSON.parse(readFileSync(new URL("../leased-consumer-carrier-contract.json", import.meta.url), "utf8"));
const request = handoff.vectors.find((vector) => vector.id === "admitted-owner-result-is-unavailable-external-response").request_body;
const encoder = new TextEncoder();
const requestBytes = encoder.encode(JSON.stringify(request));
const channel = encoder.encode(
	JSON.stringify({
		schema_version: "ceal.leased_consumer_service_channel.v1",
		service_call_url: "https://gateway.example/api/ceal/agent/v1/call",
		service_credential: "private-service-credential",
	}),
);

test("private carrier derives its one POST from the embedded handoff and decodes only the unavailable vector", async () => {
	const calls = [];
	const result = await runLeasedConsumerCarrier(requestBytes, {
		readChannel: async () => channel,
		closeChannel: async () => {},
		fetchFn: async (url, init) => {
			calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body, redirect: init.redirect });
			return new globalThis.Response(JSON.stringify({ ok: false, error_code: "leased_consumer_call_unavailable" }), {
				status: 503,
				headers: { "content-type": "application/json" },
			});
		},
	});
	assert.deepEqual(result, {
		schema_version: "ceal.leased_consumer_call_result.v1",
		ok: false,
		status: "unavailable",
		error_code: "leased_consumer_call_unavailable",
	});
	assert.deepEqual(calls, [
		{
			url: "https://gateway.example/api/ceal/agent/v1/call",
			method: "POST",
			headers: { Authorization: "Bearer private-service-credential", "Content-Type": "application/json" },
			body: JSON.stringify(request),
			redirect: "error",
		},
	]);
	assert.equal(LEASED_CONSUMER_CARRIER_ARGV, carrierContract.argv[0]);
});

test("v2 protected channel uses only its fixed Unix socket path and never falls back to fetch", async () => {
	const localChannel = encoder.encode(
		JSON.stringify({
			schema_version: "ceal.leased_consumer_service_channel.v2",
			transport: "unix_socket",
			socket_path: "/run/user/1000/ceal/leased-consumer-call-v2.sock",
			service_credential: "private-service-credential",
		}),
	);
	let fetchCalls = 0;
	const calls = [];
	const result = await runLeasedConsumerCarrier(requestBytes, {
		readChannel: async () => localChannel,
		closeChannel: async () => {},
		fetchFn: async () => {
			fetchCalls += 1;
			throw new Error("v2 must not fetch");
		},
		requestUnixSocket: async (input) => {
			calls.push(input);
			return {
				status: 503,
				contentType: "application/json",
				bytes: encoder.encode(JSON.stringify({ ok: false, error_code: "leased_consumer_call_unavailable" })),
			};
		},
	});
	assert.equal(fetchCalls, 0);
	assert.deepEqual(calls, [
		{
			socketPath: "/run/user/1000/ceal/leased-consumer-call-v2.sock",
			path: "/api/ceal/agent/v1/call",
			method: "POST",
			credential: "private-service-credential",
			body: JSON.stringify(request),
		},
	]);
	assert.equal(result.error_code, "leased_consumer_call_unavailable");
});

test("v2 shipped transport performs the bounded fixed-route post over a Unix socket", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "ceal-worker-v2-socket-"));
	const socketPath = join(root, "leased-consumer-call-v2.sock");
	let observed = null;
	const server = createServer(async (incoming, response) => {
		let body = "";
		for await (const chunk of incoming) body += String(chunk);
		observed = {
			method: incoming.method,
			path: incoming.url,
			authorization: incoming.headers.authorization,
			contentType: incoming.headers["content-type"],
			body,
		};
		response.writeHead(503, { "content-type": "application/json" });
		response.end(JSON.stringify({ ok: false, error_code: "leased_consumer_call_unavailable" }));
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, resolve);
	});
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		await rm(root, { recursive: true, force: true });
	});
	const localChannel = encoder.encode(
		JSON.stringify({
			schema_version: "ceal.leased_consumer_service_channel.v2",
			transport: "unix_socket",
			socket_path: socketPath,
			service_credential: "private-service-credential",
		}),
	);
	const result = await runLeasedConsumerCarrier(requestBytes, {
		readChannel: async () => localChannel,
		closeChannel: async () => {},
		fetchFn: async () => {
			throw new Error("v2 must not fetch");
		},
	});
	assert.equal(result.error_code, "leased_consumer_call_unavailable");
	assert.deepEqual(observed, {
		method: "POST",
		path: "/api/ceal/agent/v1/call",
		authorization: "Bearer private-service-credential",
		contentType: "application/json",
		body: JSON.stringify(request),
	});
});

test("bad request bytes and every protected-channel failure make zero HTTP requests", async () => {
	const badRequests = [
		encoder.encode(
			'{"schema_version":"ceal.gateway_leased_consumer_call_request.v1","schema_version":"ceal.gateway_leased_consumer_call_request.v1"}',
		),
		encoder.encode(
			JSON.stringify({
				schema_version: "ceal.leased_consumer_service_channel.v2",
				transport: "unix_socket",
				socket_path: "/run/user/1000/ceal/admin-gateway.sock",
				service_credential: "secret",
			}),
		),
		encoder.encode(
			JSON.stringify({
				schema_version: "ceal.leased_consumer_service_channel.v2",
				transport: "unix_socket",
				socket_path: "https://gateway.example/api/ceal/agent/v1/call",
				service_credential: "secret",
			}),
		),
		encoder.encode(JSON.stringify({ ...request, runner_ref: "runner:spoofed" })),
		new Uint8Array(32 * 1024 + 1),
		new Uint8Array([0xc3]),
	];
	for (const input of badRequests) {
		let calls = 0;
		const result = await runLeasedConsumerCarrier(input, {
			readChannel: async () => channel,
			closeChannel: async () => {},
			fetchFn: async () => {
				calls += 1;
				throw new Error("must not fetch");
			},
		});
		assert.equal(result.error_code, "invalid_request");
		assert.equal(calls, 0);
	}
	for (const protectedInput of [
		encoder.encode('{"schema_version":"ceal.leased_consumer_service_channel.v1","schema_version":"ceal.leased_consumer_service_channel.v1"}'),
		encoder.encode(
			JSON.stringify({
				schema_version: "ceal.leased_consumer_service_channel.v1",
				service_call_url: "http://127.0.0.1/api/ceal/agent/v1/call",
				service_credential: "secret",
			}),
		),
		new Uint8Array(8 * 1024 + 1),
	]) {
		let calls = 0;
		const result = await runLeasedConsumerCarrier(requestBytes, {
			readChannel: async () => protectedInput,
			closeChannel: async () => {},
			fetchFn: async () => {
				calls += 1;
				throw new Error("must not fetch");
			},
		});
		assert.equal(result.error_code, "service_channel_unavailable");
		assert.equal(calls, 0);
	}
});

test("the protected channel has an exact injected monotonic 2,000ms deadline and is closed once", async () => {
	let timerMs = null;
	let closed = 0;
	const result = await runLeasedConsumerCarrier(requestBytes, {
		readChannel: async () => new Promise(() => {}),
		closeChannel: async () => {
			closed += 1;
		},
		monotonicNow: () => 0,
		setTimer: (callback, ms) => {
			timerMs = ms;
			callback();
			return "timer";
		},
		clearTimer: () => {},
		fetchFn: async () => {
			throw new Error("must not fetch");
		},
	});
	assert.equal(timerMs, 2_000);
	assert.equal(closed, 1);
	assert.equal(result.error_code, "service_channel_unavailable");
});

test("every pre-channel failure closes the one-shot descriptor and cannot fetch", async () => {
	for (const runtime of [
		{},
		{
			loadHandoff: () => {
				throw new Error("invalid embedded handoff");
			},
		},
	]) {
		let closed = 0;
		let calls = 0;
		const result = await runLeasedConsumerCarrier(encoder.encode("not-json"), {
			...runtime,
			readChannel: async () => channel,
			closeChannel: async () => {
				closed += 1;
			},
			fetchFn: async () => {
				calls += 1;
				throw new Error("must not fetch");
			},
		});
		assert.equal(calls, 0);
		assert.equal(closed, 1);
		assert.ok(result.error_code === "invalid_request" || result.error_code === "service_call_failed");
	}
});

test("only the exact handoff 503 JSON result crosses the private boundary", async () => {
	for (const response of [
		new globalThis.Response(JSON.stringify({ ok: false, error_code: "leased_consumer_call_unavailable", extra: "no" }), {
			status: 503,
			headers: { "content-type": "application/json" },
		}),
		new globalThis.Response("not-json", { status: 503, headers: { "content-type": "application/json" } }),
		new globalThis.Response(JSON.stringify({ ok: false, error_code: "leased_consumer_call_unavailable" }), {
			status: 500,
			headers: { "content-type": "application/json" },
		}),
		new globalThis.Response("x".repeat(32 * 1024 + 1), { status: 503, headers: { "content-type": "application/json" } }),
	]) {
		const result = await runLeasedConsumerCarrier(requestBytes, {
			readChannel: async () => channel,
			closeChannel: async () => {},
			fetchFn: async () => response.clone(),
		});
		assert.deepEqual(result, {
			schema_version: "ceal.leased_consumer_call_result.v1",
			ok: false,
			status: "error",
			error_code: "service_call_failed",
		});
		assert.doesNotMatch(JSON.stringify(result), /leased_consumer_call_unavailable|private-service-credential|extra/u);
	}
});

test("test injection may supply a loopback URL validator but the shipped parser never does", async () => {
	const loopback = encoder.encode(
		JSON.stringify({
			schema_version: "ceal.leased_consumer_service_channel.v1",
			service_call_url: "http://127.0.0.1/api/ceal/agent/v1/call",
			service_credential: "test-only",
		}),
	);
	let calls = 0;
	const result = await runLeasedConsumerCarrier(requestBytes, {
		readChannel: async () => loopback,
		closeChannel: async () => {},
		validateServiceUrl: (value) => new URL(value),
		fetchFn: async () => {
			calls += 1;
			return new globalThis.Response(JSON.stringify({ ok: false, error_code: "leased_consumer_call_unavailable" }), {
				status: 503,
				headers: { "content-type": "application/json" },
			});
		},
	});
	assert.equal(calls, 1);
	assert.equal(result.error_code, "leased_consumer_call_unavailable");
});

test("stdin reader caps before retaining an unbounded request", async () => {
	async function* chunks() {
		yield new Uint8Array(32 * 1024);
		yield new Uint8Array([1]);
	}
	await assert.rejects(() => readLeasedConsumerRequest(chunks()), /input_too_large/u);
});

test("the shipped private mode rejects a non-pipe FD 4 without a libuv abort", async () => {
	const binary = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
	const child = await runCarrierProcess(binary, JSON.stringify(request));
	assert.equal(child.status, 3, child.stderr);
	assert.equal(child.stderr, "");
	assert.deepEqual(JSON.parse(child.stdout), {
		schema_version: "ceal.leased_consumer_call_result.v1",
		ok: false,
		status: "unavailable",
		error_code: "service_channel_unavailable",
	});
});

function runCarrierProcess(binary, input) {
	return new Promise((resolve, reject) => {
		const devNull = openSync("/dev/null", "r");
		let child;
		try {
			child = spawn(process.execPath, [binary, LEASED_CONSUMER_CARRIER_ARGV], {
				stdio: ["pipe", "pipe", "pipe", devNull, devNull],
			});
		} finally {
			closeSync(devNull);
		}
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("leased consumer carrier child timed out"));
		}, 5_000);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("close", (exitCode) => {
			clearTimeout(timeout);
			resolve({ status: exitCode, stdout, stderr });
		});
		child.stdin.end(input);
	});
}
