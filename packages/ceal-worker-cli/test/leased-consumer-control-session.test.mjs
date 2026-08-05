import assert from "node:assert/strict";
import test from "node:test";
import {
	openLeasedConsumerControlSession,
	resolveOperationDeadlineMs,
	runLeasedConsumerControlSession,
} from "../dist/leased-consumer-control-session.js";

const encoder = new TextEncoder();
const sessionPath = "/run/user/1001/ceal/leased-consumer-control-v1.sock";
const session = sessionFor(sessionPath);

function sessionFor(socketPath) {
	return encoder.encode(
		JSON.stringify({
			schema_version: "ceal.leased_consumer_control_session.v1",
			transport: "unix_socket",
			socket_path: socketPath,
			service_credential: "private-service-credential",
		}),
	);
}

const frames = [
	{ schema_version: "ceal.leased_consumer_capability_control_request.v4", operation: "acquire", input: {} },
	{ schema_version: "ceal.leased_consumer_capability_control_request.v4", operation: "projection", input: leaseInput() },
	{ schema_version: "ceal.leased_consumer_capability_control_request.v4", operation: "recheck", input: leaseInput() },
	{
		schema_version: "ceal.leased_consumer_capability_control_request.v4",
		operation: "call",
		input: {
			...leaseInput(),
			schema_version: "ceal.gateway_leased_consumer_call_request.v1",
			capability_id: "message.search",
			target_ref: `target:${"a".repeat(64)}`,
			purpose: "fixture-only governed read",
			arguments: { schema_version: "ceal.gateway_leased_agent_message_search_arguments.v1", query: "fixture" },
		},
	},
	{
		schema_version: "ceal.leased_consumer_capability_control_request.v4",
		operation: "complete",
		input: { ...leaseInput(), disposition: "completed", agent_run_ref: "run:fixture" },
	},
];

test("private control session carries exactly the five canonical v4 capability operations over Gateway-issued UDS routes", async () => {
	const calls = [];
	const carrier = await openLeasedConsumerControlSession({
		readProtectedSession: async () => session,
		closeProtectedSession: async () => {},
		requestUnixSocket: async (input) => {
			calls.push(input);
			const request = JSON.parse(input.body);
			return { status: 200, contentType: "application/json", bytes: encoder.encode(JSON.stringify(responseFor(request.operation))) };
		},
	});
	const output = [];
	async function* input() {
		yield encoder.encode(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`);
	}
	assert.equal(
		await runLeasedConsumerControlSession(input(), carrier, (frame) => output.push(JSON.parse(new TextDecoder().decode(frame)))),
		true,
	);
	assert.deepEqual(
		calls.map((call) => ({ socketPath: call.socketPath, path: call.path, credential: call.credential })),
		[
			{
				socketPath: sessionPath,
				path: "/api/ceal/agent/v1/control/acquire",
				credential: "private-service-credential",
			},
			{
				socketPath: sessionPath,
				path: "/api/ceal/agent/v1/control/projection",
				credential: "private-service-credential",
			},
			{
				socketPath: sessionPath,
				path: "/api/ceal/agent/v1/control/recheck",
				credential: "private-service-credential",
			},
			{ socketPath: sessionPath, path: "/api/ceal/agent/v1/call", credential: "private-service-credential" },
			{
				socketPath: sessionPath,
				path: "/api/ceal/agent/v1/control/complete",
				credential: "private-service-credential",
			},
		],
	);
	assert.deepEqual(
		output.map((value) => value.operation),
		["acquire", "projection", "recheck", "call", "complete"],
	);
	assert.doesNotMatch(JSON.stringify(output), /credential|socket_path|private-service/u);
});

test("each carrier binds only the socket path in its own protected session", async () => {
	const paths = ["/run/user/1001/ceal/one.sock", "/run/user/1001/ceal/two.sock"];
	const observed = [];
	for (const socketPath of paths) {
		const carrier = await openLeasedConsumerControlSession({
			readProtectedSession: async () => sessionFor(socketPath),
			closeProtectedSession: async () => {},
			requestUnixSocket: async (input) => {
				observed.push(input.socketPath);
				return { status: 200, contentType: "application/json", bytes: encoder.encode(JSON.stringify(responseFor("acquire"))) };
			},
		});
		async function* input() {
			yield encoder.encode(`${JSON.stringify(frames[0])}\n`);
		}
		assert.equal(await runLeasedConsumerControlSession(input(), carrier, () => {}), true);
	}
	assert.deepEqual(observed, paths);
});

test("invalid protected session and malformed Agent frames make zero control requests and emit nothing", async () => {
	let calls = 0;
	await assert.rejects(() =>
		openLeasedConsumerControlSession({
			readProtectedSession: async () =>
				encoder.encode(
					'{"schema_version":"ceal.leased_consumer_control_session.v1","schema_version":"ceal.leased_consumer_control_session.v1"}',
				),
			closeProtectedSession: async () => {},
			requestUnixSocket: async () => {
				calls += 1;
				throw new Error("must not run");
			},
		}),
	);
	const carrier = await openLeasedConsumerControlSession({
		readProtectedSession: async () => session,
		closeProtectedSession: async () => {},
		requestUnixSocket: async () => {
			calls += 1;
			throw new Error("must not run");
		},
	});
	const output = [];
	async function* malformed() {
		yield encoder.encode(
			'{"bad":true}\n{"schema_version":"ceal.leased_consumer_capability_control_request.v4","operation":"acquire","input":{}}\n',
		);
	}
	assert.equal(await runLeasedConsumerControlSession(malformed(), carrier, (frame) => output.push(frame)), false);
	assert.equal(calls, 0);
	assert.deepEqual(output, []);
});

test("invalid protected-session socket paths make zero control requests", async () => {
	for (const socketPath of ["relative.sock", "/run/user/1001/ceal/bad\npath.sock", `/${"a".repeat(1024)}`]) {
		let calls = 0;
		await assert.rejects(() =>
			openLeasedConsumerControlSession({
				readProtectedSession: async () => sessionFor(socketPath),
				closeProtectedSession: async () => {},
				requestUnixSocket: async () => {
					calls += 1;
					throw new Error("must not run");
				},
			}),
		);
		assert.equal(calls, 0);
	}
});

test("legacy and unknown private control grammars make zero control requests and emit nothing", async () => {
	for (const frame of [
		{ schema_version: "ceal.leased_consumer_control_request.v1", operation: "acquire", input: {} },
		{ schema_version: "ceal.leased_consumer_result_control_request.v2", operation: "acquire", input: {} },
		{ schema_version: "ceal.leased_consumer_reply_control_request.v3", operation: "acquire", input: {} },
		{
			schema_version: "ceal.leased_consumer_reply_control_request.v3",
			operation: "reply",
			input: { ...leaseInput(), text: "terminal reply" },
		},
		{
			schema_version: "ceal.leased_consumer_capability_control_request.v4",
			operation: "reply",
			input: { ...leaseInput(), text: "terminal reply" },
		},
	]) {
		let calls = 0;
		const carrier = await openLeasedConsumerControlSession({
			readProtectedSession: async () => session,
			closeProtectedSession: async () => {},
			requestUnixSocket: async () => {
				calls += 1;
				throw new Error("must not run");
			},
		});
		const output = [];
		async function* input() {
			yield encoder.encode(`${JSON.stringify(frame)}\n`);
		}
		assert.equal(await runLeasedConsumerControlSession(input(), carrier, (value) => output.push(value)), false);
		assert.equal(calls, 0);
		assert.deepEqual(output, []);
	}
});

test("protected session is closed and refused at its fixed two-second deadline", async () => {
	let closed = 0;
	await assert.rejects(() =>
		openLeasedConsumerControlSession({
			readProtectedSession: () => new Promise(() => {}),
			closeProtectedSession: async () => {
				closed += 1;
			},
			monotonicNow: () => 0,
			setTimer: (callback, milliseconds) => {
				assert.equal(milliseconds, 2_000);
				callback();
				return Symbol("timer");
			},
			clearTimer: () => {},
		}),
	);
	// A read that resolves after the deadline is refused too.
	await assert.rejects(() =>
		openLeasedConsumerControlSession({
			readProtectedSession: async () => session,
			closeProtectedSession: async () => {
				closed += 1;
			},
			monotonicNow: (() => {
				let now = 0;
				return () => (now += 2_001);
			})(),
			setTimer: () => Symbol("timer"),
			clearTimer: () => {},
		}),
	);
	assert.equal(closed, 2);
});

test("a Gateway control operation that never answers is bounded and emits no Agent frame", async () => {
	const carrier = await openLeasedConsumerControlSession({
		readProtectedSession: async () => session,
		closeProtectedSession: async () => {},
		monotonicNow: () => 0,
		setTimer: (callback, milliseconds) => {
			if (milliseconds === 30_000) callback();
			return Symbol("timer");
		},
		clearTimer: () => {},
		requestUnixSocket: () => new Promise(() => {}),
	});
	const output = [];
	async function* input() {
		yield encoder.encode(`${JSON.stringify(frames[0])}\n`);
	}
	assert.equal(await runLeasedConsumerControlSession(input(), carrier, (frame) => output.push(frame)), false);
	assert.deepEqual(output, []);
});

test("operation deadline resolution uses the contract minimum when the launcher injects nothing", () => {
	assert.equal(resolveOperationDeadlineMs({}), 30_000);
	assert.equal(resolveOperationDeadlineMs({ CEAL_LEASED_CONSUMER_OPERATION_DEADLINE_MS: undefined }), 30_000);
});

test("operation deadline resolution honors an in-bounds launcher-injected value", () => {
	assert.equal(resolveOperationDeadlineMs({ CEAL_LEASED_CONSUMER_OPERATION_DEADLINE_MS: "30000" }), 30_000);
	assert.equal(resolveOperationDeadlineMs({ CEAL_LEASED_CONSUMER_OPERATION_DEADLINE_MS: "120000" }), 120_000);
	assert.equal(resolveOperationDeadlineMs({ CEAL_LEASED_CONSUMER_OPERATION_DEADLINE_MS: "600000" }), 600_000);
});

test("operation deadline resolution fails closed on out-of-bounds or non-integer launcher input", () => {
	for (const raw of ["29999", "600001", "0", "-30000", "30000.5", "3e4", "30000ms", "", " 30000", "0x7530"]) {
		assert.throws(() => resolveOperationDeadlineMs({ CEAL_LEASED_CONSUMER_OPERATION_DEADLINE_MS: raw }), /invalid_operation_deadline/u);
	}
});

test("an invalid injected operation deadline refuses the session before any protected read or control request", async () => {
	let reads = 0;
	let calls = 0;
	await assert.rejects(
		() =>
			openLeasedConsumerControlSession({
				env: { CEAL_LEASED_CONSUMER_OPERATION_DEADLINE_MS: "1000" },
				readProtectedSession: async () => {
					reads += 1;
					return session;
				},
				closeProtectedSession: async () => {},
				requestUnixSocket: async () => {
					calls += 1;
					throw new Error("must not run");
				},
			}),
		/invalid_operation_deadline/u,
	);
	assert.equal(reads, 0);
	assert.equal(calls, 0);
});

test("an in-bounds injected operation deadline bounds every Gateway control operation", async () => {
	const deadlines = [];
	const timers = [];
	const carrier = await openLeasedConsumerControlSession({
		env: { CEAL_LEASED_CONSUMER_OPERATION_DEADLINE_MS: "120000" },
		readProtectedSession: async () => session,
		closeProtectedSession: async () => {},
		monotonicNow: () => 0,
		setTimer: (_callback, milliseconds) => {
			timers.push(milliseconds);
			return Symbol("timer");
		},
		clearTimer: () => {},
		requestUnixSocket: async (input) => {
			deadlines.push(input.deadlineMs);
			return { status: 200, contentType: "application/json", bytes: encoder.encode(JSON.stringify(responseFor("acquire"))) };
		},
	});
	async function* input() {
		yield encoder.encode(`${JSON.stringify(frames[0])}\n`);
	}
	assert.equal(await runLeasedConsumerControlSession(input(), carrier, () => {}), true);
	assert.deepEqual(deadlines, [120_000]);
	assert.ok(timers.includes(120_000));
	assert.ok(!timers.includes(30_000));
});

test("a slow governed write that answers within the injected 120s deadline survives as a typed response", async () => {
	const carrier = await openLeasedConsumerControlSession({
		env: { CEAL_LEASED_CONSUMER_OPERATION_DEADLINE_MS: "120000" },
		readProtectedSession: async () => session,
		closeProtectedSession: async () => {},
		monotonicNow: slowWriteClock(),
		setTimer: () => Symbol("timer"),
		clearTimer: () => {},
		requestUnixSocket: async () => ({
			status: 200,
			contentType: "application/json",
			bytes: encoder.encode(JSON.stringify(responseFor("call"))),
		}),
	});
	const response = JSON.parse(new TextDecoder().decode(await carrier.dispatch(encoder.encode(JSON.stringify(frames[3])))));
	assert.equal(response.operation, "call");
	assert.equal(response.result.status, "result");
});

test("the same slow write under the contract-minimum 30s deadline fails closed with control_deadline_exceeded", async () => {
	const carrier = await openLeasedConsumerControlSession({
		readProtectedSession: async () => session,
		closeProtectedSession: async () => {},
		monotonicNow: slowWriteClock(),
		setTimer: () => Symbol("timer"),
		clearTimer: () => {},
		requestUnixSocket: async () => ({
			status: 200,
			contentType: "application/json",
			bytes: encoder.encode(JSON.stringify(responseFor("call"))),
		}),
	});
	await assert.rejects(() => carrier.dispatch(encoder.encode(JSON.stringify(frames[3]))), /control_deadline_exceeded/u);
});

/**
 * Injected clock for the #686 rate-limited-governed-write scenario: the
 * protected-session read is instantaneous, then the single control request
 * takes a virtual 35s (a Slack rate-limit retry serialized in the Gateway),
 * which is inside a 120s configured deadline and past the 30s minimum.
 */
function slowWriteClock() {
	let calls = 0;
	return () => (calls++ < 3 ? 0 : 35_000);
}

function leaseInput() {
	return { event_ref: "event:fixture", lease_ref: "lease:fixture", lease_fence: 1 };
}
function responseFor(operation) {
	const base = { schema_version: "ceal.leased_consumer_capability_control_response.v4", operation };
	if (operation === "acquire") return { ...base, result: { status: "leased", lease: lease() } };
	if (operation === "projection")
		return {
			...base,
			result: {
				status: "available",
				event_ref: "event:fixture",
				event_revision: 1,
				normalized_projection_ref: "projection:fixture",
				normalized_projection_revision: 1,
				conversation_ref: `conversation:${"c".repeat(64)}`,
				requester: { subject_ref: "subject:fixture" },
				attachments: { count: 0, set_ref: null },
				projection: { schema_version: "ceal.gateway_normalized_projection.v1", text: "fixture projection" },
				capability_contexts: [
					{
						capability_id: "message.search",
						target_ref: `target:${"a".repeat(64)}`,
						message_ref: `message:${"b".repeat(64)}`,
						thread_ref: `thread:${"d".repeat(64)}`,
					},
				],
			},
		};
	if (operation === "recheck") return { ...base, result: { status: "active", lease: lease(), abort_requested: false } };
	if (operation === "call")
		return {
			...base,
			result: {
				status: "result",
				result: {
					schema_version: "ceal.gateway_leased_agent_capability_result.v1",
					capability_id: "message.search",
					effect: "read",
					result_ref: `result:${"a".repeat(64)}`,
					handles: [{ kind: "message", ref: `message:${"b".repeat(64)}` }],
					data: { schema_version: "ceal.gateway_leased_agent_message_read_data.v1", items: [{ text: "fixture" }] },
				},
			},
		};
	return { ...base, result: { status: "completed", replayed: false } };
}
function lease() {
	return { ...leaseInput(), delivery_attempt: 1, expires_at: "2026-08-01T00:00:30.000Z" };
}
