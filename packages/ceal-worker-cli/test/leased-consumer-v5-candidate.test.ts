import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as protocol from "@corca-ai/ceal-protocol";
import { openLeasedConsumerControlSession, runLeasedConsumerControlTransport } from "../dist/leased-consumer-control-session.js";
import { deferredVoid } from "./deferred-test-support.ts";

const fixturePath = process.env.CEAL_GATEWAY_V5_CONTROL_FIXTURE;
const candidateAvailable =
	typeof protocol.decodeCealLeasedConsumerCapabilityNotification === "function" &&
	typeof protocol.decodeCealLeasedConsumerNotificationControlRequest === "function" &&
	typeof protocol.decodeCealLeasedConsumerNotificationControlResponse === "function";

test("Gateway-packed v5 drives FD5 forwarding and all six fixed worker routes", { skip: !fixturePath || !candidateAvailable }, async () => {
	const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const calls = [];
	const control = await openLeasedConsumerControlSession({
		readProtectedSession: async () => encoder.encode(JSON.stringify(fixture.protected_session)),
		closeProtectedSession: async () => {},
		requestUnixSocket: async (input) => {
			const operation = fixture.operations.find((entry) => entry.path === input.path);
			assert.ok(operation, `unexpected route ${input.path}`);
			assert.deepEqual(JSON.parse(input.body), operation.request);
			calls.push({ path: input.path, credential: input.credential });
			return {
				status: 200,
				contentType: "application/json",
				bytes: encoder.encode(JSON.stringify(operation.response)),
			};
		},
	});
	const notificationsClosed = deferredVoid();
	async function* agentInput() {
		yield encoder.encode(`${fixture.operations.map((entry) => JSON.stringify(entry.request)).join("\n")}\n`);
	}
	async function* notificationInput() {
		yield encoder.encode(`${JSON.stringify(fixture.notification_transport.fixture)}\n`);
		await notificationsClosed.promise;
	}
	const output = [];
	assert.equal(
		await runLeasedConsumerControlTransport(
			agentInput(),
			control,
			(frame) => output.push(JSON.parse(decoder.decode(frame))),
			{ stream: notificationInput(), close: async () => notificationsClosed.resolve() },
			async () => {},
		),
		true,
	);
	assert.deepEqual(
		calls.map((call) => call.path),
		fixture.operations.map((entry) => entry.path),
	);
	assert.ok(calls.every((call) => call.credential === fixture.protected_session.service_credential));
	assert.deepEqual(
		output.filter((entry) => entry.schema_version === fixture.notification_transport.fixture.schema_version),
		[fixture.notification_transport.fixture],
	);
	assert.deepEqual(
		output.filter((entry) => entry.operation),
		fixture.operations.map((entry) => entry.response),
	);
	assert.doesNotMatch(JSON.stringify(output), /service_credential|socket_path|protected-service-credential/u);
});

test("Gateway-packed v5 decoder rejects malformed notification authority fields before Agent output", {
	skip: !fixturePath || !candidateAvailable,
}, async () => {
	const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
	for (const mutate of [
		(value) => (value.kind = "stop_requested"),
		(value) => delete value.lease_ref,
		(value) => (value.provider_user_id = "U-private"),
		(value) => (value.notification_sequence = 0),
	]) {
		const invalid = structuredClone(fixture.notification_transport.fixture);
		mutate(invalid);
		async function* input() {
			yield new TextEncoder().encode(`${JSON.stringify(invalid)}\n`);
		}
		const output = [];
		const agentClosed = deferredVoid();
		async function* agentInput() {
			await agentClosed.promise;
			yield new Uint8Array();
		}
		assert.equal(
			await runLeasedConsumerControlTransport(
				agentInput(),
				{ dispatch: async () => assert.fail("no Agent frame expected") },
				(frame) => output.push(frame),
				{ stream: input(), close: async () => {} },
				async () => agentClosed.resolve(),
			),
			false,
		);
		assert.deepEqual(output, []);
	}
});
