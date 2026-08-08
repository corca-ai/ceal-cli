import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	openLeasedConsumerControlSession,
	resolveOperationDeadlineMs,
	runLeasedConsumerControlTransport,
	writeLeasedConsumerAgentFrame,
} from "../dist/leased-consumer-control-session.js";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const EMBEDDED_CONTRACT = path.join("generated", "leased-consumer-control-session-contract.js");

// The module refuses to parse an embedded contract whose text and digest
// disagree. Proven by falsification rather than by calling the check: a test
// that only asserts the shipped pair agrees would stay green with the whole
// guard deleted, which is how a guard nobody can turn red gets written.
//
// Deleting the guard turns this red. Confirm that by hand before trusting it:
// remove the digest comparison in `verifiedControlSessionContractJson`, rebuild,
// and this test must fail.
test("the embedded control-session contract is refused when its digest does not match", async (context) => {
	// Inside the package rather than in `tmpdir()`: the copied module imports
	// `@corca-ai/ceal-protocol`, and Node resolves that by walking up from the
	// importing file. A copy outside the workspace fails to load for a reason
	// that has nothing to do with the guard under test.
	const scratch = mkdtempSync(path.join(DIST, "..", "ceal-embedded-contract-"));
	context.after(() => rmSync(scratch, { recursive: true, force: true }));
	// Two independent copies rather than one file rewritten between imports: the
	// generated module is imported by path with no query, so Node's module cache
	// would hand the second import the first copy's already-evaluated digest.
	const entryIn = (name) => {
		cpSync(DIST, path.join(scratch, name), { recursive: true });
		return path.join(scratch, name, "leased-consumer-control-session.js");
	};
	const tamperedEntry = entryIn("tampered");
	const intactEntry = entryIn("intact");
	const embedded = path.join(scratch, "tampered", EMBEDDED_CONTRACT);
	const source = readFileSync(embedded, "utf8");
	// Only the digest changes, so the failure can be nothing but the mismatch —
	// the contract text the module parses is byte-identical to the shipped one.
	const tampered = source.replace(/CONTRACT_SHA256 = "[a-f0-9]{64}"/u, `CONTRACT_SHA256 = "${"0".repeat(64)}"`);
	assert.notEqual(tampered, source, "the embedded module must carry a digest for this test to falsify");
	writeFileSync(embedded, tampered);

	await assert.rejects(
		import(tamperedEntry),
		/invalid_control_session_contract/u,
		"a contract whose digest disagrees with its text must not be parsed",
	);

	// The positive control: an untouched copy in the same place loads. Without it,
	// the rejection above would also be satisfied by a copy that cannot load at
	// all — which is exactly what the first attempt at this test did.
	const restored = await import(intactEntry);
	assert.equal(typeof restored.runLeasedConsumerControlTransport, "function");
});

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
	assert.equal(await runControlSessionForTest(input(), carrier, (frame) => output.push(JSON.parse(new TextDecoder().decode(frame)))), true);
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

test("candidate notifications are protocol-decoded and forwarded as bounded canonical Agent frames", async () => {
	const notification = notificationFixture();
	const emitted = [];
	const decodeNotification = (value) => {
		assert.deepEqual(value, notification);
		return value;
	};
	async function* input() {
		// The chunk deliberately exceeds one frame's 4 KiB cap while every one
		// of its 20 newline-delimited frames remains individually bounded.
		yield encoder.encode(`${Array.from({ length: 20 }, () => JSON.stringify(notification)).join("\n")}\n`);
	}
	assert.equal(
		await runNotificationStreamForTest(input(), (frame) => emitted.push(new TextDecoder().decode(frame)), {
			decodeNotification,
		}),
		true,
	);
	assert.equal(emitted.length, 20);
	assert.ok(emitted.every((frame) => frame === `${JSON.stringify(notification)}\n`));
});

test("notification input stops reading until the prior Agent stdout frame drains", async () => {
	let decoded = 0;
	let releaseFirst;
	const firstDrained = new Promise((resolve) => {
		releaseFirst = resolve;
	});
	async function* input() {
		yield encoder.encode(`${JSON.stringify(notificationFixture())}\n${JSON.stringify(notificationFixture())}\n`);
	}
	const running = runNotificationStreamForTest(
		input(),
		async () => {
			if (decoded === 1) await firstDrained;
		},
		{
			decodeNotification: (value) => {
				decoded += 1;
				return value;
			},
		},
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(decoded, 1);
	releaseFirst();
	assert.equal(await running, true);
	assert.equal(decoded, 2);
});

test("malformed, duplicate-key, oversized, and unterminated notification frames fail closed", async () => {
	const cases = [
		'{"schema_version":"ceal.leased_consumer_capability_notification.v5","schema_version":"ceal.leased_consumer_capability_notification.v5"}\n',
		`${"x".repeat(4 * 1024 + 1)}\n`,
		JSON.stringify(notificationFixture()),
	];
	for (const frame of cases) {
		const emitted = [];
		async function* input() {
			yield encoder.encode(frame);
		}
		assert.equal(
			await runNotificationStreamForTest(input(), (value) => emitted.push(value), {
				decodeNotification: (value) => value,
			}),
			false,
		);
		assert.deepEqual(emitted, []);
	}
});

test("FD5 notification forwarding does not consume or wait for the pending serial Agent response", async () => {
	let resolveDispatch;
	const pendingDispatch = new Promise((resolve) => {
		resolveDispatch = resolve;
	});
	let closeNotifications;
	const notificationsClosed = new Promise((resolve) => {
		closeNotifications = resolve;
	});
	const output = [];
	async function* agentInput() {
		yield encoder.encode(`${JSON.stringify(frames[0])}\n`);
	}
	async function* notificationInput() {
		yield encoder.encode(`${JSON.stringify(notificationFixture())}\n`);
		await notificationsClosed;
	}
	const running = runLeasedConsumerControlTransport(
		agentInput(),
		{ dispatch: () => pendingDispatch },
		(frame) => output.push(JSON.parse(new TextDecoder().decode(frame))),
		{ stream: notificationInput(), close: async () => closeNotifications() },
		async () => {},
		{ decodeNotification: (value) => value },
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(
		output.map((frame) => frame.schema_version),
		["ceal.leased_consumer_capability_notification.v5"],
	);
	resolveDispatch(encoder.encode(`${JSON.stringify(responseFor("acquire"))}\n`));
	assert.equal(await running, true);
	assert.deepEqual(
		output.map((frame) => frame.schema_version),
		["ceal.leased_consumer_capability_notification.v5", "ceal.leased_consumer_capability_control_response.v4"],
	);
});

test("the shared emitter stays failed after its first output failure", async () => {
	let rejectFirstWrite;
	const firstWrite = new Promise((_resolve, reject) => {
		rejectFirstWrite = reject;
	});
	let closeNotifications;
	const notificationsClosed = new Promise((resolve) => {
		closeNotifications = resolve;
	});
	async function* agentInput() {
		yield encoder.encode(`${JSON.stringify(frames[0])}\n`);
	}
	async function* notificationInput() {
		yield encoder.encode(`${JSON.stringify(notificationFixture())}\n`);
		await notificationsClosed;
	}
	let writes = 0;
	const running = runLeasedConsumerControlTransport(
		agentInput(),
		{ dispatch: async () => encoder.encode(`${JSON.stringify(responseFor("acquire"))}\n`) },
		() => {
			writes += 1;
			return firstWrite;
		},
		{ stream: notificationInput(), close: async () => closeNotifications() },
		async () => {},
		{ decodeNotification: (value) => value },
	);
	await new Promise((resolve) => setImmediate(resolve));
	rejectFirstWrite(new Error("stdout_failed"));
	assert.equal(await running, false);
	assert.equal(writes, 1);
});

test("FD5 ending before Agent stdin closes the pair and cannot be reported clean", async () => {
	let closeAgent;
	const agentClosed = new Promise((resolve) => {
		closeAgent = resolve;
	});
	async function* agentInput() {
		await agentClosed;
		yield new Uint8Array();
	}
	async function* notificationInput() {
		yield encoder.encode(`${JSON.stringify(notificationFixture())}\n`);
	}
	assert.equal(
		await runLeasedConsumerControlTransport(
			agentInput(),
			{ dispatch: async () => assert.fail("no Agent frame expected") },
			() => {},
			{ stream: notificationInput(), close: async () => {} },
			async () => closeAgent(),
			{ decodeNotification: (value) => value },
		),
		false,
	);
});

test("FD5 ending aborts an outstanding Gateway request before its operation deadline and emits no late response", async () => {
	const carrier = await openLeasedConsumerControlSession({
		readProtectedSession: async () => session,
		closeProtectedSession: async () => {},
		requestUnixSocket: () => new Promise(() => {}),
	});
	let closeAgent;
	const agentClosed = new Promise((resolve) => {
		closeAgent = resolve;
	});
	async function* agentInput() {
		yield encoder.encode(`${JSON.stringify(frames[0])}\n`);
		await agentClosed;
	}
	async function* notificationInput() {
		yield new Uint8Array();
	}
	const output = [];
	const running = runLeasedConsumerControlTransport(
		agentInput(),
		carrier,
		(frame) => output.push(frame),
		{ stream: notificationInput(), close: async () => {} },
		async () => closeAgent(),
		{ decodeNotification: (value) => value },
	);
	const result = await Promise.race([running, new Promise((resolve) => setTimeout(() => resolve("deadline_not_cancelled"), 100))]);
	assert.equal(result, false);
	assert.deepEqual(output, []);
});

test("Agent shutdown aborts a notification write stalled on stdout backpressure", async () => {
	let markWriteStarted;
	const writeStarted = new Promise((resolve) => {
		markWriteStarted = resolve;
	});
	let closeNotifications;
	const notificationsClosed = new Promise((resolve) => {
		closeNotifications = resolve;
	});
	async function* agentInput() {
		await writeStarted;
		yield new Uint8Array();
	}
	async function* notificationInput() {
		yield encoder.encode(`${JSON.stringify(notificationFixture())}\n`);
		await notificationsClosed;
	}
	const running = runLeasedConsumerControlTransport(
		agentInput(),
		{ dispatch: async () => assert.fail("no Agent frame expected") },
		(_frame, signal) =>
			new Promise((_resolve, reject) => {
				markWriteStarted();
				signal.addEventListener("abort", () => reject(new Error("control_aborted")), { once: true });
			}),
		{ stream: notificationInput(), close: async () => closeNotifications() },
		async () => {},
		{ decodeNotification: (value) => value },
	);
	assert.equal(await Promise.race([running, new Promise((resolve) => setTimeout(() => resolve("stdout_not_cancelled"), 100))]), false);
});

test("the shipped Agent writer destroys a backpressured stdout stream and rejects exactly once on abort", async () => {
	let callback;
	let destroys = 0;
	const stream = {
		write: (_frame, next) => {
			callback = next;
			return false;
		},
		destroy: () => {
			destroys += 1;
		},
	};
	const abort = new AbortController();
	const writing = writeLeasedConsumerAgentFrame(stream, encoder.encode("frame"), abort.signal);
	abort.abort();
	await assert.rejects(writing, /control_aborted/u);
	assert.equal(destroys, 1);
	callback?.();
	assert.equal(destroys, 1);

	let v4Writes = 0;
	assert.equal(
		writeLeasedConsumerAgentFrame(
			{
				write: () => {
					v4Writes += 1;
					return false;
				},
				destroy: () => assert.fail("v4 does not own a notification shutdown signal"),
			},
			encoder.encode("v4 response"),
		),
		undefined,
	);
	assert.equal(v4Writes, 1);
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
		assert.equal(await runControlSessionForTest(input(), carrier, () => {}), true);
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
	assert.equal(await runControlSessionForTest(malformed(), carrier, (frame) => output.push(frame)), false);
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
		assert.equal(await runControlSessionForTest(input(), carrier, (value) => output.push(value)), false);
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
	assert.equal(await runControlSessionForTest(input(), carrier, (frame) => output.push(frame)), false);
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
	assert.equal(await runControlSessionForTest(input(), carrier, () => {}), true);
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

function runControlSessionForTest(stream, control, emit) {
	return runLeasedConsumerControlTransport(stream, control, emit, undefined, async () => {});
}

async function runNotificationStreamForTest(stream, emit, runtime) {
	let finishAgent;
	let closeNotifications;
	let markSourceFinished;
	const agentFinished = new Promise((resolve) => {
		finishAgent = resolve;
	});
	const notificationsClosed = new Promise((resolve) => {
		closeNotifications = resolve;
	});
	const sourceFinished = new Promise((resolve) => {
		markSourceFinished = resolve;
	});
	async function* agentInput() {
		await agentFinished;
		yield new Uint8Array();
	}
	async function* heldNotificationInput() {
		try {
			for await (const chunk of stream) yield chunk;
			markSourceFinished();
			await notificationsClosed;
		} finally {
			markSourceFinished();
		}
	}
	const running = runLeasedConsumerControlTransport(
		agentInput(),
		{ dispatch: async () => assert.fail("no Agent control frame expected") },
		emit,
		{ stream: heldNotificationInput(), close: async () => closeNotifications() },
		async () => finishAgent(),
		runtime,
	);
	await Promise.race([running, sourceFinished]);
	finishAgent();
	return running;
}

function leaseInput() {
	return { event_ref: "event:fixture", lease_ref: "lease:fixture", lease_fence: 1 };
}
function notificationFixture() {
	return {
		schema_version: "ceal.leased_consumer_capability_notification.v5",
		kind: "abort_requested",
		notification_sequence: 1,
		event_ref: "event:fixture",
		event_revision: 1,
		runner_ref: "runner:fixture",
		consumer_ref: "consumer:fixture",
		consumer_generation: 1,
		lease_ref: "lease:fixture",
		lease_fence: 1,
	};
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
