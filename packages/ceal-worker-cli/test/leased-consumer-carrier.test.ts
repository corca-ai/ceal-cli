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
import {
	LEASED_CONSUMER_CARRIER_ARGV,
	type LeasedConsumerCarrierRuntime,
	readLeasedConsumerRequest,
	runLeasedConsumerCarrier,
} from "../dist/leased-consumer-carrier.js";
import { postUnixSocket } from "../dist/private-worker-transport.js";

type HandoffFixture = { vectors: Array<{ id: string; request_body: Record<string, unknown> }> };
type FetchCall = {
	url: string;
	method: string | undefined;
	headers: HeadersInit | undefined;
	body: BodyInit | null | undefined;
	redirect: RequestRedirect | undefined;
	aborts: boolean;
};
type UnixSocketCall = Omit<Parameters<NonNullable<LeasedConsumerCarrierRuntime["requestUnixSocket"]>>[0], "signal"> & {
	signal: boolean;
};
type CarrierProcessResult = { status: number | null; stdout: string; stderr: string };

const handoff: HandoffFixture = JSON.parse(
	readFileSync(
		new URL("../../../vendor/gateway-leased-consumer-call/gateway-leased-consumer-call-conformance.json", import.meta.url),
		"utf8",
	),
);
const carrierContract = JSON.parse(readFileSync(new URL("../leased-consumer-carrier-contract.json", import.meta.url), "utf8"));
const requestVector = handoff.vectors.find((vector) => vector.id === "admitted-owner-result-is-unavailable-external-response");
assert.ok(requestVector);
const request = requestVector.request_body;
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
	const calls: FetchCall[] = [];
	const result = await runLeasedConsumerCarrier(requestBytes, {
		readChannel: async () => channel,
		closeChannel: async () => {},
		fetchFn: async (url, init) => {
			assert.ok(init);
			calls.push({
				url: String(url),
				method: init.method,
				headers: init.headers,
				body: init.body,
				redirect: init.redirect,
				aborts: init.signal instanceof AbortSignal,
			});
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
			aborts: true,
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
	const calls: UnixSocketCall[] = [];
	const result = await runLeasedConsumerCarrier(requestBytes, {
		readChannel: async () => localChannel,
		closeChannel: async () => {},
		fetchFn: async () => {
			fetchCalls += 1;
			throw new Error("v2 must not fetch");
		},
		requestUnixSocket: async (input) => {
			calls.push({ ...input, signal: input.signal instanceof AbortSignal });
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
			deadlineMs: carrierContract.service_call.deadline_ms,
			maximumResponseBytes: carrierContract.result.maximum_bytes,
			errors: {
				aborted: "socket_request_aborted",
				deadlineExceeded: "socket_request_deadline_exceeded",
				responseTooLarge: "response_too_large",
				responseFailed: "socket_response_failed",
				requestFailed: "socket_request_failed",
			},
			signal: true,
		},
	]);
	assert.equal(result.error_code, "leased_consumer_call_unavailable");
});

test("v2 shipped transport performs the bounded fixed-route post over a Unix socket", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "ceal-worker-v2-socket-"));
	const socketPath = join(root, "leased-consumer-call-v2.sock");
	let observed: {
		method: string | undefined;
		path: string | undefined;
		authorization: string | undefined;
		contentType: string | string[] | undefined;
		body: string;
	} | null = null;
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
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, resolve);
	});
	t.after(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
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

test("a service that accepts and never answers loses the call to the deadline instead of hanging the worker", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "ceal-worker-v2-stall-"));
	const socketPath = join(root, "leased-consumer-call-v2.sock");
	const sockets: import("node:net").Socket[] = [];
	// Accepts the connection, reads the request, and never writes a response.
	const server = createServer(() => {});
	server.on("connection", (socket) => sockets.push(socket));
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, resolve);
	});
	t.after(async () => {
		for (const socket of sockets) socket.destroy();
		await new Promise<void>((resolve) => server.close(() => resolve()));
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
	// Only the service-call deadline is collapsed; the FD4 channel read keeps its own.
	const serviceCallDeadlineMs = carrierContract.service_call.deadline_ms;
	let firedServiceCallTimer = false;
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const carrier = runLeasedConsumerCarrier(requestBytes, {
		readChannel: async () => localChannel,
		closeChannel: async () => {},
		fetchFn: async () => {
			throw new Error("v2 must not fetch");
		},
		setTimer: (callback, ms) => {
			const timer = setTimeout(
				() => {
					firedServiceCallTimer = true;
					callback();
				},
				ms === serviceCallDeadlineMs ? 0 : ms,
			);
			timers.add(timer);
			return timer;
		},
		clearTimer: () => {
			for (const timer of timers) clearTimeout(timer);
			timers.clear();
		},
	});
	const stillHanging = Symbol("still_hanging");
	const guard = new Promise<typeof stillHanging>((resolve) => setTimeout(() => resolve(stillHanging), 5_000).unref());
	const result = await Promise.race([carrier, guard]);
	assert.notEqual(result, stillHanging, "the outbound service call never settled — its deadline is not applied");
	if (result === stillHanging) throw new Error("the outbound service call never settled");
	assert.equal(firedServiceCallTimer, true);
	assert.deepEqual(result, {
		schema_version: "ceal.leased_consumer_call_result.v1",
		ok: false,
		status: "error",
		error_code: "service_call_failed",
	});
});

test("the Unix-socket deadline is absolute even while a peer trickles response bytes", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "ceal-worker-v2-trickle-"));
	const socketPath = join(root, "leased-consumer-call-v2.sock");
	const sockets: import("node:net").Socket[] = [];
	const intervals: ReturnType<typeof setInterval>[] = [];
	const server = createServer((_incoming, response) => {
		response.writeHead(200, { "content-type": "application/json" });
		response.write(" ");
		const interval = setInterval(() => response.write(" "), 20);
		intervals.push(interval);
	});
	server.on("connection", (socket) => sockets.push(socket));
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, resolve);
	});
	t.after(async () => {
		for (const interval of intervals) clearInterval(interval);
		for (const socket of sockets) socket.destroy();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(root, { recursive: true, force: true });
	});
	await assert.rejects(
		postUnixSocket({
			socketPath,
			path: "/api/ceal/agent/v1/call",
			method: "POST",
			credential: "private-service-credential",
			body: JSON.stringify(request),
			deadlineMs: 100,
			maximumResponseBytes: 1024,
			errors: {
				aborted: "aborted",
				deadlineExceeded: "absolute_deadline_exceeded",
				responseTooLarge: "too_large",
				responseFailed: "response_failed",
				requestFailed: "request_failed",
			},
		}),
		/absolute_deadline_exceeded/u,
	);
});

test("an https service that never answers loses the call to the same deadline", async () => {
	const serviceCallDeadlineMs = carrierContract.service_call.deadline_ms;
	const observed: { signal?: AbortSignal } = {};
	let firedServiceCallTimer = false;
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const carrier = runLeasedConsumerCarrier(requestBytes, {
		readChannel: async () => channel,
		closeChannel: async () => {},
		// Never resolves on its own; only the deadline's abort can end this call.
		fetchFn: (_url, init) =>
			new Promise((_resolve, reject) => {
				assert.ok(init);
				assert.ok(init.signal);
				observed.signal = init.signal;
				init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
			}),
		setTimer: (callback, ms) => {
			const timer = setTimeout(
				() => {
					firedServiceCallTimer = true;
					callback();
				},
				ms === serviceCallDeadlineMs ? 0 : ms,
			);
			timers.add(timer);
			return timer;
		},
		clearTimer: () => {
			for (const timer of timers) clearTimeout(timer);
			timers.clear();
		},
	});
	const stillHanging = Symbol("still_hanging");
	const guard = new Promise<typeof stillHanging>((resolve) => setTimeout(() => resolve(stillHanging), 5_000).unref());
	const result = await Promise.race([carrier, guard]);
	assert.notEqual(result, stillHanging, "the https service call never settled — its deadline is not applied");
	if (result === stillHanging) throw new Error("the https service call never settled");
	assert.equal(firedServiceCallTimer, true);
	const signal = observed.signal;
	assert.ok(signal);
	assert.equal(signal.aborted, true, "expiry must abort the fetch, not only lose the race");
	assert.equal(result.error_code, "service_call_failed");
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

test("request classification precedes inherited channel acquisition", async () => {
	const malformed = await runLeasedConsumerCarrier(encoder.encode("not-json"));
	assert.equal(malformed.error_code, "invalid_request");

	const validWithoutChannel = await runLeasedConsumerCarrier(requestBytes, {
		readChannel: async () => {
			throw new Error("missing_channel");
		},
		closeChannel: async () => {},
	});
	assert.equal(validWithoutChannel.error_code, "service_channel_unavailable");
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
	const cases: ReadonlyArray<{
		readonly runtime: LeasedConsumerCarrierRuntime;
		readonly expected: "invalid_request" | "service_call_failed";
	}> = [
		{ runtime: {}, expected: "invalid_request" },
		{
			runtime: {
				loadHandoff: () => {
					throw new Error("invalid embedded handoff");
				},
			},
			expected: "service_call_failed",
		},
	];
	for (const { runtime, expected } of cases) {
		let closed = 0;
		let reads = 0;
		let calls = 0;
		const result = await runLeasedConsumerCarrier(encoder.encode("not-json"), {
			...runtime,
			readChannel: async () => {
				reads += 1;
				return channel;
			},
			closeChannel: async () => {
				closed += 1;
			},
			fetchFn: async () => {
				calls += 1;
				throw new Error("must not fetch");
			},
		});
		assert.equal(result.error_code, expected);
		assert.equal(reads, 0);
		assert.equal(calls, 0);
		assert.equal(closed, 1);
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

	const malformed = await runCarrierProcess(binary, "not-json");
	assert.deepEqual(malformed, {
		status: 2,
		stdout:
			JSON.stringify({
				schema_version: "ceal.leased_consumer_call_result.v1",
				ok: false,
				status: "error",
				error_code: "invalid_request",
			}) + "\n",
		stderr: "",
	});
});

function runCarrierProcess(binary: string, input: string): Promise<CarrierProcessResult> {
	return new Promise<CarrierProcessResult>((resolve, reject) => {
		const devNull = openSync("/dev/null", "r");
		const child = spawn(process.execPath, [binary, LEASED_CONSUMER_CARRIER_ARGV], {
			stdio: ["pipe", "pipe", "pipe", devNull, devNull],
		});
		try {
			assert.ok(child.stdin);
			assert.ok(child.stdout);
			assert.ok(child.stderr);
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
