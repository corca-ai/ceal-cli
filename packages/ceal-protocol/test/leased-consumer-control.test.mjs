import assert from "node:assert/strict";
import test from "node:test";
import {
	CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA,
	CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA,
	CEAL_LEASED_CONSUMER_CONTROL_SESSION_SCHEMA,
	CEAL_LEASED_CONSUMER_RESULT_CONTROL_REQUEST_SCHEMA,
	CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA,
	CEAL_LEASED_CONSUMER_REPLY_CONTROL_REQUEST_SCHEMA,
	CEAL_LEASED_CONSUMER_REPLY_CONTROL_RESPONSE_SCHEMA,
	CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_SCHEMA,
	CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
	CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA,
	CEAL_LEASED_CONSUMER_CAPABILITY_NOTIFICATION_SCHEMA,
	CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_REQUEST_SCHEMA,
	CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_RESPONSE_SCHEMA,
	CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_GET_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_CONVERSATION_THREAD_GET_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_DELETE_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_DELETE_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_SURVEY_DISPATCH_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_SURVEY_DISPATCH_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_V2_SCHEMA,
	decodeCealLeasedConsumerControlRequest,
	decodeCealLeasedConsumerControlResponse,
	decodeCealLeasedConsumerControlSession,
	decodeCealLeasedConsumerResultControlRequest,
	decodeCealLeasedConsumerResultControlResponse,
	decodeCealLeasedConsumerReplyControlRequest,
	decodeCealLeasedConsumerReplyControlResponse,
	decodeCealLeasedConsumerCapabilityControlRequest,
	decodeCealLeasedConsumerCapabilityControlResponse,
	decodeCealLeasedConsumerCapabilityNotification,
	decodeCealLeasedConsumerNotificationControlRequest,
	decodeCealLeasedConsumerNotificationControlResponse,
} from "../dist/index.js";

const lease = { event_ref: "event:one", lease_ref: "lease:one", lease_fence: 1, delivery_attempt: 1, expires_at: "2026-08-01T00:00:30.000Z" };
const leaseInput = { event_ref: lease.event_ref, lease_ref: lease.lease_ref, lease_fence: lease.lease_fence };
const notificationBinding = {
	kind: "abort_requested", notification_sequence: 1,
	event_ref: "event:one", event_revision: 3,
	runner_ref: "runner:agent", consumer_ref: "consumer:worker", consumer_generation: 7,
	lease_ref: "lease:one", lease_fence: 5,
};

test("leased-consumer control decoders accept only the protected session and five exact operation shapes", () => {
	assert.deepEqual(decodeCealLeasedConsumerControlSession({
		schema_version: CEAL_LEASED_CONSUMER_CONTROL_SESSION_SCHEMA, transport: "unix_socket", socket_path: "/run/ceal/leased-control.sock", service_credential: "private-service-credential",
	}).transport, "unix_socket");
	for (const request of [
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "acquire", input: {} },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "projection", input: leaseInput },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "recheck", input: leaseInput },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "call", input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id: "github.issue.create", target_ref: "target:issue", purpose: "create issue", arguments: { title: "Hello" } } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "complete", input: { ...leaseInput, disposition: "completed", agent_run_ref: "run:one" } },
	]) assert.equal(decodeCealLeasedConsumerControlRequest(request).operation, request.operation);
});

test("leased-consumer control response projections never return credential, consumer identity, or raw provider fields", () => {
	for (const response of [
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "acquire", result: { status: "leased", lease } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "projection", result: { status: "available", event_ref: "event:one", event_revision: 1, normalized_projection_ref: "projection:one", normalized_projection_revision: 1, projection: { schema_version: "ceal.gateway_normalized_projection.v1", text: "bounded", context: { conversation_kind: "channel", is_thread_reply: false } } } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "recheck", result: { status: "active", lease } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "leased_consumer_call_unavailable" } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "complete", result: { status: "completed", replayed: false } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "acquire", result: { status: "control_unavailable" } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "projection", result: { status: "control_unavailable" } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "recheck", result: { status: "control_unavailable" } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "complete", result: { status: "control_unavailable" } },
	]) assert.equal(decodeCealLeasedConsumerControlResponse(response).operation, response.operation);
});

test("leased-consumer control rejects a public/admin or nonportable socket, caller authority, receipt assertion, and widened result", () => {
	for (const socket_path of ["/run/ceal/admin-gateway.sock", "relative.sock", "/run/ceal/bad\npath.sock", `/${"a".repeat(103)}`]) {
		assert.throws(() => decodeCealLeasedConsumerControlSession({
			schema_version: CEAL_LEASED_CONSUMER_CONTROL_SESSION_SCHEMA, transport: "unix_socket", socket_path, service_credential: "private-service-credential",
		}), TypeError);
	}
	for (const request of [
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "acquire", input: { instance_ref: "instance:prod" } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "projection", input: { ...leaseInput, service_credential: "forged" } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "complete", input: { ...leaseInput, disposition: "completed", receipt_refs: ["receipt:forged"] } },
		{ schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "call", input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id: "github.issue.create", target_ref: "target:issue", purpose: "create issue", arguments: { authorization: "forged" } } },
	]) assert.throws(() => decodeCealLeasedConsumerControlRequest(request), TypeError);
	assert.throws(() => decodeCealLeasedConsumerControlRequest({
		schema_version: CEAL_LEASED_CONSUMER_CONTROL_REQUEST_SCHEMA, operation: "call",
		input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id: "github.issue.create", target_ref: "target:issue", purpose: "create issue", arguments: { text: "x".repeat(32 * 1024) } },
	}), TypeError);
	assert.throws(() => decodeCealLeasedConsumerControlResponse({
		schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "projection",
		result: { status: "available", event_ref: "event:one", event_revision: 1, normalized_projection_ref: "projection:one", normalized_projection_revision: 1, projection: { schema_version: "ceal.gateway_normalized_projection.v1", text: "bounded" }, provider_url: "https://provider.example" },
	}), TypeError);
	assert.throws(() => decodeCealLeasedConsumerControlResponse({
		schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "admitted", service_call_ref: "service-call:private" },
	}), TypeError);
	assert.throws(() => decodeCealLeasedConsumerControlResponse({
		schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "idempotency_not_allowed" },
	}), TypeError);
});

test("result control v2 accepts one bounded projected read result without widening v1", () => {
	const request = { schema_version: CEAL_LEASED_CONSUMER_RESULT_CONTROL_REQUEST_SCHEMA, operation: "call", input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id: "message.search", target_ref: "target:channel", purpose: "answer", arguments: { query: "roadmap" }, idempotency_key: "call:one" } };
	const response = { schema_version: CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: { schema_version: CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_SCHEMA, capability_id: "message.search", data: { items: [{ text: "bounded" }] } } } };
	assert.equal(decodeCealLeasedConsumerResultControlRequest(request).operation, "call");
	assert.equal(decodeCealLeasedConsumerResultControlResponse(response).operation, "call");
	assert.throws(() => decodeCealLeasedConsumerControlResponse(response), TypeError);
});

test("result control v2 rejects raw custody fields, oversized text, and a result lookup operation", () => {
	for (const response of [
		{ schema_version: CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: { schema_version: CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_SCHEMA, capability_id: "message.search", data: { authorization: "forged" } } } },
		{ schema_version: CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: { schema_version: CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_SCHEMA, capability_id: "message.search", data: { locator: "forged" } } } },
		{ schema_version: CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: { schema_version: CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_SCHEMA, capability_id: "message.search", data: { source_url: "https://unsafe.example" } } } },
		{ schema_version: CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: { schema_version: CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_SCHEMA, capability_id: "message.search", data: JSON.parse('{"__proto__":{"x":true}}') } } },
		{ schema_version: CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: { schema_version: CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_SCHEMA, capability_id: "message.search", data: new Date() } } },
		{ schema_version: CEAL_LEASED_CONSUMER_RESULT_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: { schema_version: CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_SCHEMA, capability_id: "message.search", data: { text: "x".repeat(5 * 1024) } } } },
		{ schema_version: CEAL_LEASED_CONSUMER_RESULT_CONTROL_REQUEST_SCHEMA, operation: "result", input: leaseInput },
	]) assert.throws(() => response.operation === "result" ? decodeCealLeasedConsumerResultControlRequest(response) : decodeCealLeasedConsumerResultControlResponse(response), TypeError);
});

test("reply control v3 is the only carrier that admits one bounded terminal text reply", () => {
	const request = {
		schema_version: CEAL_LEASED_CONSUMER_REPLY_CONTROL_REQUEST_SCHEMA,
		operation: "reply",
		input: { ...leaseInput, text: "A bounded Gateway-owned thread reply." },
	};
	const response = {
		schema_version: CEAL_LEASED_CONSUMER_REPLY_CONTROL_RESPONSE_SCHEMA,
		operation: "reply",
		result: { status: "replied", receipt_ref: `reply-receipt:${"a".repeat(64)}`, replayed: false },
	};
	assert.equal(decodeCealLeasedConsumerReplyControlRequest(request).operation, "reply");
	assert.equal(decodeCealLeasedConsumerReplyControlResponse(response).operation, "reply");
	assert.throws(() => decodeCealLeasedConsumerResultControlRequest(request), TypeError);
	assert.throws(() => decodeCealLeasedConsumerReplyControlRequest({ ...request, input: { ...request.input, channel: "Cprivate" } }), TypeError);
	assert.throws(() => decodeCealLeasedConsumerReplyControlRequest({ ...request, input: { ...request.input, text: "" } }), TypeError);
	assert.equal(decodeCealLeasedConsumerReplyControlRequest({ ...request, input: { ...request.input, text: "First line\n\tsecond line" } }).operation, "reply");
	assert.throws(() => decodeCealLeasedConsumerReplyControlRequest({ ...request, input: { ...request.input, text: "x".repeat(16_385) } }), TypeError);
	assert.throws(() => decodeCealLeasedConsumerReplyControlRequest({ ...request, input: { ...request.input, text: "\u0000" } }), TypeError);
	assert.throws(() => decodeCealLeasedConsumerReplyControlResponse({ ...response, result: { ...response.result, message_ts: "unsafe" } }), TypeError);
	assert.throws(() => decodeCealLeasedConsumerReplyControlResponse({ ...response, result: { ...response.result, receipt_ref: "channel:Cprivate" } }), TypeError);
});

test("capability control v4 carries generic read and write results through exact opaque handles", () => {
	const call = {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
		operation: "call",
		input: {
			schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput,
			capability_id: "message.update", target_ref: `target:${"a".repeat(64)}`,
			purpose: "replace progress", arguments: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, message_ref: `message:${"f".repeat(64)}`, text: "done" }, idempotency_key: "write:one",
		},
	};
	for (const result of [
		{ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "message.search", effect: "read", result_ref: `result:${"b".repeat(64)}`, handles: [{ kind: "target", ref: `target:${"c".repeat(64)}` }], data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA, items: [{ text: "bounded", author: { author_ref: `author:${"1".repeat(64)}`, display_name: "Alice", actor_kind: "human" } }] } },
		{ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "message.update", effect: "write", result_ref: `result:${"d".repeat(64)}`, handles: [{ kind: "target", ref: `target:${"e".repeat(64)}` }, { kind: "message", ref: `message:${"f".repeat(64)}` }], data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA, terminal: "readback_confirmed", text: "updated" } },
		{ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "message.delete", effect: "write", result_ref: `result:${"f".repeat(64)}`, handles: [], data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_DELETE_DATA_SCHEMA, terminal: "readback_confirmed" } },
	]) {
		const response = { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result } };
		assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call).operation, "call");
		assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response).operation, "call");
	}
	// #700: the relay forwards a capability the Gateway declares and this table
	// does not. It executes and authorizes nothing, so gating the relay on a
	// fixed table made every new Gateway capability a worker release -- and the
	// failure was a dead session, not a skew message, because a decode throw ends
	// the frame loop.
	const undeclaredCall = {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
		operation: "call",
		input: {
			schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput,
			capability_id: "calendar.event.list", target_ref: `target:${"a".repeat(64)}`,
			purpose: "list events", arguments: { schema_version: "ceal.calendar_event_list_input.v1", window: "week" },
		},
	};
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(undeclaredCall).operation, "call");
	const undeclaredResult = { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "calendar.event.list", effect: "read",
		result_ref: `result:${"a".repeat(64)}`, handles: [], data: { people: [{ display_name: "Alice" }], truncated: false },
	} } };
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(undeclaredResult).operation, "call");

	// What the relay DOES own still holds for an undeclared capability: the id
	// shape, and result JSON free of credential and locator material.
	for (const unsafe of [
		{ capability_id: "Message.Search", data: { ok: true } },
		{ capability_id: "message", data: { ok: true } },
		{ capability_id: "calendar.event.list", data: { credential: "leaked" } },
		{ capability_id: "calendar.event.list", data: { source_url: "https://unsafe.example" } },
		{ capability_id: "calendar.event.list", data: { locator: "C0123456789" } },
	]) {
		const response = { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: {
			schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: unsafe.capability_id, effect: "read",
			result_ref: `result:${"a".repeat(64)}`, handles: [], data: unsafe.data,
		} } };
		assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(response), TypeError, unsafe.capability_id);
	}

	// Reproduced by the ceal-cli consumer against the built 0.72.14 decoder: the
	// undeclared ARGUMENT path used a weaker predicate than the undeclared result
	// path, so it admitted exactly the material the result path refuses, plus
	// authority state carrying its own generation counter. The doc comment on
	// decodeCapabilityArguments already claimed "locator-free"; only the code
	// disagreed.
	// The first three are refused by the RESULT key policy the argument path now
	// shares; the last three isolate the authority-state rule, which is the half
	// that did not exist before. Kept in one loop, distinguished in this comment,
	// so the count is not read as six proofs of one rule.
	for (const unsafeArguments of [
		{ locator: "C0123456789" },
		{ provider_locator: "/private/path" },
		{ permissions: ["admin"] },
		{ grant_revision: 99 },
		{ policy_version: 99 },
		{ credential_version: 99 },
		// Reported by the ceal-cli consumer against 0.72.16: a reference TO
		// authority is still authority, and these four reached the worker's
		// delegated socket seam because the noun was not at the end of the key.
		{ grant_ref: "grant:private" },
		{ policy_ref: "policy:private" },
		{ scope_ref: "scope:private" },
		{ role_ref: "role:admin" },
	]) {
		const call = {
			schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
			operation: "call",
			input: {
				schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput,
				capability_id: "calendar.event.list", target_ref: `target:${"a".repeat(64)}`,
				purpose: "list events", arguments: unsafeArguments,
			},
		};
		assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest(call), TypeError, JSON.stringify(unsafeArguments));
	}

	// Two positive controls, because the boundary had to NARROW without closing.
	// The second one is the one that matters: a bare `*_ref` is this protocol's
	// HANDLE idiom, not authority state, and ten declared capabilities already
	// take one inside `arguments`. Refusing it here would refuse the next
	// capability that takes a Gateway-minted handle, and a decode throw ends the
	// frame loop -- the dead session #700 exists to prevent.
	for (const safeArguments of [
		{ schema_version: "ceal.calendar_event_list_input.v1", window: "week", limit: 10 },
		{ schema_version: "ceal.calendar_event_get_input.v1", event_ref: `event:${"a".repeat(64)}`, message_ref: `message:${"a".repeat(64)}` },
	]) {
		const call = {
			schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
			operation: "call",
			input: {
				schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput,
				capability_id: "calendar.event.list", target_ref: `target:${"a".repeat(64)}`,
				purpose: "list events", arguments: safeArguments,
			},
		};
		assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call).operation, "call", JSON.stringify(safeArguments));
	}

	// A named authority ref stays refused in BOTH directions, so narrowing the
	// handle idiom did not open `actor_ref`/`owner_ref`/`runner_ref`.
	const namedAuthorityRefArguments = {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
		operation: "call",
		input: {
			schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput,
			capability_id: "calendar.event.list", target_ref: `target:${"a".repeat(64)}`,
			purpose: "list events", arguments: { actor_ref: "actor:root" },
		},
	};
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest(namedAuthorityRefArguments), TypeError);

	// Invariant pin for the deliberate ASYMMETRY: the undeclared RESULT policy is
	// NOT widened with the authority rule, because `data` is capability-owned. A
	// later "unify these two predicates" cleanup must fail here rather than start
	// refusing working responses.
	const undeclaredResultWithRefAndRevision = { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "calendar.event.list", effect: "read",
		result_ref: `result:${"a".repeat(64)}`, handles: [], data: { item_ref: "item:one", grant_revision: 1 },
	} } };
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(undeclaredResultWithRefAndRevision).operation, "call");

	// A DECLARED capability keeps its exact result rule, so relaying an unknown
	// one did not loosen the known ones.
	const wrongShapeForDeclared = { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "message.search", effect: "read",
		result_ref: `result:${"a".repeat(64)}`, handles: [], data: { people: [], truncated: false },
	} } };
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(wrongShapeForDeclared), TypeError);

	const unsafeAuthorResult = { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "message.search", effect: "read", result_ref: `result:${"b".repeat(64)}`, handles: [],
		data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA, items: [{ text: "bounded", author: { author_ref: "author:U0123456789", actor_kind: "human" } }] },
	} } };
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(unsafeAuthorResult), TypeError);
	unsafeAuthorResult.result.result.data.items[0].author = { author_ref: `author:${"1".repeat(64)}`, display_name: "Alice (U0123456789)", actor_kind: "human" };
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(unsafeAuthorResult), TypeError);
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
		operation: "call",
		input: {
			schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput,
			capability_id: "message.create", target_ref: `target:${"1".repeat(64)}`,
			purpose: "reply in thread", idempotency_key: "write:create-one",
			arguments: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA, reply_to: `message:${"2".repeat(64)}`, text: "created" },
		},
	}).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
		operation: "call",
		input: {
			schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput,
			capability_id: "message.delete", target_ref: `target:${"3".repeat(64)}`,
			purpose: "remove transient response", idempotency_key: "write:delete-one",
			arguments: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_DELETE_ARGUMENTS_SCHEMA, message_ref: `message:${"4".repeat(64)}` },
		},
	}).operation, "call");
	for (const input of [
		{ capability_id: "message.get", arguments: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_GET_ARGUMENTS_SCHEMA, message_ref: `message:${"7".repeat(64)}` } },
		{ capability_id: "conversation.thread.get", arguments: { schema_version: CEAL_LEASED_CONSUMER_CONVERSATION_THREAD_GET_ARGUMENTS_SCHEMA, thread_ref: `thread:${"8".repeat(64)}`, limit: 64 } },
	]) assert.equal(decodeCealLeasedConsumerCapabilityControlRequest({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA, operation: "call",
		input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, ...input, target_ref: `target:${"9".repeat(64)}`, purpose: "read context" },
	}).operation, "call");
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest({
		schema_version: CEAL_LEASED_CONSUMER_REPLY_CONTROL_REQUEST_SCHEMA, operation: "reply", input: { ...leaseInput, text: "legacy fallback" },
	}), TypeError);
	const projection = {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA,
		operation: "projection",
		result: {
			status: "available", event_ref: "event:one", event_revision: 1,
			normalized_projection_ref: "projection:one", normalized_projection_revision: 1,
			conversation_ref: `conversation:${"9".repeat(64)}`,
			requester: { subject_ref: "subject:alice", display_name: "Alice", provider_identity: { provider: "slack", account_id: "U0ALICE0001" } },
			attachments: { count: 0, set_ref: null },
			projection: { schema_version: "ceal.gateway_normalized_projection.v1", text: "bounded" },
			capability_contexts: [
				{ capability_id: "message.search", target_ref: `target:${"3".repeat(64)}`, message_ref: `message:${"4".repeat(64)}`, thread_ref: `thread:${"5".repeat(64)}` },
				{ capability_id: "message.create", target_ref: `target:${"5".repeat(64)}`, message_ref: `message:${"6".repeat(64)}`, thread_ref: `thread:${"7".repeat(64)}` },
			],
		},
	};
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(projection).operation, "projection");
	for (const provider_identity of [
		{ provider: "Slack", account_id: "U0ALICE0001" },
		{ provider: "slack", account_id: "" },
		{ provider: "slack", account_id: "U0ALICE0001", channel_id: "C0123456789" },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse({
		...projection, result: { ...projection.result, requester: { ...projection.result.requester, provider_identity } },
	}), TypeError);
});

test("capability control v4 rejects provider-shaped handles and custody fields", () => {
	const result = {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA,
		capability_id: "message.update", effect: "write", result_ref: `result:${"a".repeat(64)}`,
		handles: [{ kind: "message", ref: `message:${"b".repeat(64)}` }], data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA, terminal: "readback_confirmed", text: "updated" },
	};
	const response = (candidate) => ({ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: candidate } });
	for (const candidate of [
		{ ...result, handles: [{ kind: "message", ref: "C01234567" }] },
		{ ...result, handles: [{ kind: "message", ref: "1712345678.000100" }] },
		{ ...result, handles: [{ kind: "artifact", ref: "https://files.slack.com/private" }] },
		{ ...result, handles: [{ kind: "channel", ref: `target:${"c".repeat(64)}` }] },
		{ ...result, data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA, terminal: "readback_confirmed", message_ref: `message:${"d".repeat(64)}` } },
		{ ...result, data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA, terminal: "readback_confirmed", channel: "C01234567" } },
		{ ...result, data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA, terminal: "readback_confirmed", provider_response: { channel: "C01234567" } } },
		{ ...result, effect: "unknown" },
		{ ...result, provider_response: {} },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(response(candidate)), TypeError);
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(response({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "message.delete", effect: "write", result_ref: `result:${"a".repeat(64)}`,
		handles: [{ kind: "message", ref: `message:${"b".repeat(64)}` }], data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_DELETE_DATA_SCHEMA, terminal: "readback_confirmed" },
	})), TypeError);
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA, operation: "call",
		input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id: "message.update", target_ref: "C01234567", purpose: "unsafe", arguments: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, message_ref: `message:${"f".repeat(64)}`, text: "done" }, idempotency_key: "write:one" },
	}), TypeError);
	for (const arguments_ of [
		{ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, message_ref: `message:${"f".repeat(64)}`, text: "done", channel: "C01234567" },
		{ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, message_ref: `message:${"f".repeat(64)}`, text: "done", ts: "1712345678.000100" },
		{ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_SCHEMA, query: "roadmap", url: "https://slack.com" },
		{ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_SCHEMA, query: "roadmap", provider_response: {} },
		{ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_GET_ARGUMENTS_SCHEMA, message_ref: "1712345678.000100" },
		{ schema_version: CEAL_LEASED_CONSUMER_CONVERSATION_THREAD_GET_ARGUMENTS_SCHEMA, thread_ref: `thread:${"f".repeat(64)}`, limit: 129 },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA, operation: "call",
		input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id: arguments_.schema_version === CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_SCHEMA ? "message.search" : arguments_.schema_version === CEAL_LEASED_CONSUMER_MESSAGE_GET_ARGUMENTS_SCHEMA ? "message.get" : arguments_.schema_version === CEAL_LEASED_CONSUMER_CONVERSATION_THREAD_GET_ARGUMENTS_SCHEMA ? "conversation.thread.get" : "message.update", target_ref: `target:${"e".repeat(64)}`, purpose: "unsafe", arguments: arguments_, idempotency_key: arguments_.schema_version === CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA ? "write:one" : undefined },
	}), TypeError);
	for (const input of [
		{ capability_id: "message.create", arguments: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA, reply_to: "C01234567", text: "done" }, idempotency_key: "write:one" },
		{ capability_id: "message.update", arguments: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, message_ref: `target:${"f".repeat(64)}`, text: "done" }, idempotency_key: "write:one" },
		{ capability_id: "message.update", arguments: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, message_ref: `message:${"f".repeat(64)}`, text: "done" } },
		{ capability_id: "message.delete", arguments: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_DELETE_ARGUMENTS_SCHEMA, message_ref: `message:${"f".repeat(64)}` } },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA, operation: "call",
		input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, ...input, target_ref: `target:${"e".repeat(64)}`, purpose: "unsafe" },
	}), TypeError);
	const projection = {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA,
		operation: "projection",
		result: {
			status: "available", event_ref: "event:one", event_revision: 1,
			normalized_projection_ref: "projection:one", normalized_projection_revision: 1,
			conversation_ref: `conversation:${"9".repeat(64)}`,
			requester: { subject_ref: "subject:alice", display_name: "Alice" },
			attachments: { count: 0, set_ref: null },
			projection: { schema_version: "ceal.gateway_normalized_projection.v1", text: "bounded" },
			capability_contexts: [{ capability_id: "message.search", target_ref: `target:${"1".repeat(64)}`, message_ref: `message:${"2".repeat(64)}`, thread_ref: `thread:${"3".repeat(64)}` }],
		},
	};
	for (const capability_contexts of [
		[],
		[{ capability_id: "message.search", target_ref: "C01234567", message_ref: `message:${"2".repeat(64)}`, thread_ref: `thread:${"3".repeat(64)}` }],
		[{ capability_id: "message.search", target_ref: `target:${"1".repeat(64)}`, message_ref: "1712345678.000100", thread_ref: `thread:${"3".repeat(64)}` }],
		[{ capability_id: "message.search", target_ref: `target:${"1".repeat(64)}`, message_ref: `message:${"2".repeat(64)}`, thread_ref: "1712345678.000100" }],
		[
			{ capability_id: "message.search", target_ref: `target:${"1".repeat(64)}`, message_ref: `message:${"2".repeat(64)}`, thread_ref: `thread:${"3".repeat(64)}` },
			{ capability_id: "message.search", target_ref: `target:${"3".repeat(64)}`, message_ref: `message:${"4".repeat(64)}`, thread_ref: `thread:${"5".repeat(64)}` },
		],
		[{ capability_id: "message.delete", target_ref: `target:${"1".repeat(64)}`, message_ref: `message:${"2".repeat(64)}`, thread_ref: `thread:${"3".repeat(64)}` }],
		// Update handles bootstrap only from a Gateway-owned create readback;
		// the user-authored ingress projection must never grant one.
		[{ capability_id: "message.update", target_ref: `target:${"1".repeat(64)}`, message_ref: `message:${"2".repeat(64)}`, thread_ref: `thread:${"3".repeat(64)}` }],
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse({ ...projection, result: { ...projection.result, capability_contexts } }), TypeError);
});

test("projection context accepts the scheduled trigger marker and rejects any other trigger", () => {
	// Regression (ceal-dev S7 rehearsal, 2026-08-06): the projection store and
	// consumer resolver admitted context.trigger="scheduled" while this decoder
	// still rejected it, collapsing the serving response into a silent
	// control_unavailable supervisor halt.
	const capabilityProjection = (context) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA,
		operation: "projection",
		result: {
			status: "available", event_ref: "event:one", event_revision: 1,
			normalized_projection_ref: "projection:one", normalized_projection_revision: 1,
			conversation_ref: `conversation:${"9".repeat(64)}`,
			requester: { subject_ref: "subject:alice" },
			attachments: { count: 0, set_ref: null },
			projection: { schema_version: "ceal.gateway_normalized_projection.v1", text: "bounded", context },
			capability_contexts: [{ capability_id: "message.search", target_ref: `target:${"1".repeat(64)}`, message_ref: `message:${"2".repeat(64)}`, thread_ref: `thread:${"3".repeat(64)}` }],
		},
	});
	const scheduled = { conversation_kind: "channel", is_thread_reply: true, trigger: "scheduled" };
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(capabilityProjection(scheduled)).operation, "projection");
	assert.equal(decodeCealLeasedConsumerControlResponse({
		schema_version: CEAL_LEASED_CONSUMER_CONTROL_RESPONSE_SCHEMA, operation: "projection",
		result: { status: "available", event_ref: "event:one", event_revision: 1, normalized_projection_ref: "projection:one", normalized_projection_revision: 1, projection: { schema_version: "ceal.gateway_normalized_projection.v1", text: "bounded", context: scheduled } },
	}).operation, "projection");
	for (const context of [
		{ conversation_kind: "channel", is_thread_reply: true, trigger: "cron" },
		{ conversation_kind: "channel", is_thread_reply: true, trigger: null },
		{ conversation_kind: "channel", trigger: "scheduled" },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(capabilityProjection(context)), TypeError);
});

test("capability control v4 write results carry one target and an ordered continuation message group", () => {
	const messages = (count) => Array.from({ length: count }, (_, index) => ({ kind: "message", ref: `message:${index.toString(16).padStart(64, "0")}` }));
	const result = (handles) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call",
		result: { status: "result", result: {
			schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "message.create", effect: "write", result_ref: `result:${"a".repeat(64)}`,
			handles, data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA, terminal: "readback_confirmed" },
		} },
	});
	const target = { kind: "target", ref: `target:${"c".repeat(64)}` };
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(result([target, ...messages(1)])).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(result([target, ...messages(3)])).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(result([target, ...messages(16)])).operation, "call");
	for (const handles of [
		[target],
		messages(2),
		[target, target, ...messages(1)],
		[target, ...messages(17)],
		[target, ...messages(1), { kind: "thread", ref: `thread:${"d".repeat(64)}` }],
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(result(handles)), TypeError);
});

test("capability control v4 recheck requires the abort_requested transport flag", () => {
	const response = (result) => ({ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "recheck", result });
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response({ status: "active", lease, abort_requested: false })).operation, "recheck");
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response({ status: "active", lease, abort_requested: true })).operation, "recheck");
	for (const result of [
		{ status: "active", lease },
		{ status: "active", lease, abort_requested: "true" },
		{ status: "active", lease, abort_requested: false, abort_reason: "user" },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(response(result)), TypeError);
	// The v3 reply carrier keeps its exact two-key active recheck.
	assert.throws(() => decodeCealLeasedConsumerReplyControlResponse({ schema_version: CEAL_LEASED_CONSUMER_REPLY_CONTROL_RESPONSE_SCHEMA, operation: "recheck", result: { status: "active", lease, abort_requested: false } }), TypeError);
});

test("capability control v5 notification and receipt bind one exact lease without provider payload", () => {
	const notification = { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_NOTIFICATION_SCHEMA, ...notificationBinding };
	assert.deepEqual(decodeCealLeasedConsumerCapabilityNotification(notification), notification);
	const request = {
		schema_version: CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_REQUEST_SCHEMA,
		operation: "notification_receipt", input: notificationBinding,
	};
	const response = {
		schema_version: CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_RESPONSE_SCHEMA,
		operation: "notification_receipt", result: { status: "receipt_recorded" },
	};
	assert.equal(decodeCealLeasedConsumerNotificationControlRequest(request).operation, "notification_receipt");
	assert.equal(decodeCealLeasedConsumerNotificationControlResponse(response).operation, "notification_receipt");
	for (const status of ["receipt_recorded", "receipt_replayed", "notification_stale", "authentication_failed", "control_unavailable"]) {
		assert.equal(decodeCealLeasedConsumerNotificationControlResponse({ ...response, result: { status } }).operation, "notification_receipt");
	}
	for (const mutate of [
		(value) => { value.notification_sequence = 0; },
		(value) => { value.event_revision = 0; },
		(value) => { value.consumer_generation = 0; },
		(value) => { value.kind = "provider_abort"; },
		(value) => { value.runner_ref = "U01234567"; },
		(value) => { value.channel_id = "C01234567"; },
		(value) => { value.payload = { text: "stop" }; },
	]) {
		const bad = structuredClone(notification); mutate(bad);
		assert.throws(() => decodeCealLeasedConsumerCapabilityNotification(bad));
		assert.throws(() => decodeCealLeasedConsumerNotificationControlRequest({ ...request, input: Object.fromEntries(Object.entries(bad).filter(([key]) => key !== "schema_version")) }));
	}
	assert.throws(() => decodeCealLeasedConsumerNotificationControlResponse({ ...response, result: { status: "receipt_recorded", abort_cleared: true } }));
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest(request), TypeError);
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(response), TypeError);
});

test("capability control v5 alone accepts one exact typed Agent-control projection", () => {
	const controlProjection = {
		schema_version: "ceal.gateway_normalized_agent_control_projection.v1",
		control: {
			token: `ceal-control-v1.${"a".repeat(43)}`,
			authority: "original_requester",
			actor_subject_ref: "subject:alice",
			origin: {
				event_ref: "event:origin", event_revision: 2,
				normalized_projection_ref: "projection:origin", normalized_projection_revision: 3,
			},
		},
	};
	const result = {
		status: "available", event_ref: "event:control", event_revision: 1,
		normalized_projection_ref: "projection:control", normalized_projection_revision: 1,
		conversation_ref: `conversation:${"b".repeat(64)}`,
		requester: { subject_ref: "subject:alice" }, attachments: { count: 0, set_ref: null },
		projection: controlProjection, capability_contexts: [],
	};
	const v5 = { schema_version: CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_RESPONSE_SCHEMA, operation: "projection", result };
	const v4 = { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "projection", result };
	assert.equal(decodeCealLeasedConsumerNotificationControlResponse(v5).operation, "projection");
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(v4), TypeError);
	for (const mutate of [
		(value) => { value.projection.control.handler_id = "exit"; },
		(value) => { value.projection.control.authority = "operator"; },
		(value) => { value.projection.control.origin.event_revision = 0; },
		(value) => { value.capability_contexts = [{ capability_id: "message.create" }]; },
	]) {
		const bad = structuredClone(v5); mutate(bad.result);
		assert.throws(() => decodeCealLeasedConsumerNotificationControlResponse(bad), TypeError);
	}
});

test("capability control v5 alone accepts one exact lifecycle effect on control completion", () => {
	const input = {
		...leaseInput, disposition: "completed", agent_run_ref: "agent-run:control-one",
		control_effect: { schema_version: "ceal.gateway_leased_agent_control_effect.v1", effect: "conversation.lifecycle.exit" },
	};
	const v5 = { schema_version: CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_REQUEST_SCHEMA, operation: "complete", input };
	const v4 = { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA, operation: "complete", input };
	assert.equal(decodeCealLeasedConsumerNotificationControlRequest(v5).operation, "complete");
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest(v4), TypeError);
	for (const mutate of [
		(value) => { value.control_effect.effect = "message.delete"; },
		(value) => { value.control_effect.handler_id = "exit"; },
		(value) => { value.disposition = "failed"; },
	]) {
		const bad = structuredClone(v5); mutate(bad.input);
		assert.throws(() => decodeCealLeasedConsumerNotificationControlRequest(bad), TypeError);
	}
});

test("capability control v4 declares enumerate/resolve/presentation with display-name resolve reads", () => {
	const call = (capability_id, arguments_, idempotency_key) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA, operation: "call",
		input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id, target_ref: `target:${"e".repeat(64)}`, purpose: "declared", arguments: arguments_, ...(idempotency_key ? { idempotency_key } : {}) },
	});
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call("message.enumerate", { schema_version: "ceal.gateway_leased_agent_message_enumerate_arguments.v1", limit: 20 })).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call("resource.resolve", { schema_version: "ceal.gateway_leased_agent_resource_resolve_arguments.v1", kind: "conversation", query: "release room" })).operation, "call");
	// Permalink targeting (S1, Goal 2): the user-supplied provider link is a
	// query, never a typed handle; Gateway resolves it privately.
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call("resource.resolve", { schema_version: "ceal.gateway_leased_agent_resource_resolve_arguments.v1", kind: "permalink", query: "https://corca.slack.com/archives/C0AAAAAAA/p1754280000000100" })).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call("presentation.activity.set", { schema_version: "ceal.gateway_leased_agent_presentation_activity_arguments.v1", activity: "typing" }, "run:activity:1")).operation, "call");
	// The closed semantic presentation DTO rides message writes; markup is rejected.
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call("message.create", { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA, reply_to: `message:${"b".repeat(64)}`, text: "working", presentation: { schema_version: "ceal.gateway_leased_agent_message_presentation.v1", intent: "progress", abortable: true, phase: "reading thread" } }, "run:write:1")).operation, "call");
	const neutralControls = [{ token: "agent-token:opaque", label: "종료" }];
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call("message.update", { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, message_ref: `message:${"b".repeat(64)}`, text: "working", presentation: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_V2_SCHEMA, intent: "progress", abortable: true, controls: neutralControls } }, "run:write:2")).operation, "call");
	const completedHistory = { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_V2_SCHEMA, intent: "progress", abortable: true, phase: "work_execution", completed_phases: ["request_review"], controls: [] };
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call("message.update", { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, message_ref: `message:${"b".repeat(64)}`, text: "working", presentation: completedHistory }, "run:write:history")).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call("message.update", { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, message_ref: `message:${"b".repeat(64)}`, text: "working", presentation: { ...completedHistory, phase: undefined, completed_phases: [] } }, "run:write:empty-history")).operation, "call");
	for (const bad of [
		call("message.enumerate", { schema_version: "ceal.gateway_leased_agent_message_enumerate_arguments.v1", limit: 129 }),
		call("resource.resolve", { schema_version: "ceal.gateway_leased_agent_resource_resolve_arguments.v1", kind: "channel", query: "x" }),
		call("presentation.activity.set", { schema_version: "ceal.gateway_leased_agent_presentation_activity_arguments.v1", activity: "typing" }),
		call("message.create", { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA, reply_to: `message:${"b".repeat(64)}`, text: "working", presentation: { schema_version: "ceal.gateway_leased_agent_message_presentation.v1", intent: "progress", abortable: true, blocks: [] } }, "run:write:1"),
		call("message.create", { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA, reply_to: `message:${"b".repeat(64)}`, text: "working", presentation: { schema_version: "ceal.gateway_leased_agent_message_presentation.v1", intent: "progress", abortable: true, controls: neutralControls } }, "run:write:1"),
		call("message.update", { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, message_ref: `message:${"b".repeat(64)}`, text: "working", presentation: { schema_version: "ceal.gateway_leased_agent_message_presentation.v1", intent: "progress", abortable: true, phase: "work_execution", completed_phases: ["request_review"] } }, "run:write:v1-history"),
		...[
			{ completed_phases: ["request_review", "request_review"] },
			{ completed_phases: ["information_gathering", "request_review"] },
			{ completed_phases: ["request_review", "work_execution"] },
			{ completed_phases: ["request_review", "unknown"] },
			{ completed_phases: ["request_review", "information_gathering", "work_execution", "result_check"] },
			{ phase: undefined, completed_phases: ["request_review"] },
			{ intent: "final", completed_phases: [] },
		].map((mutation) => call("message.update", { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, message_ref: `message:${"b".repeat(64)}`, text: "working", presentation: { ...completedHistory, ...mutation } }, "run:write:bad-history")),
		...[
			{ controls: undefined },
			{ controls: Array.from({ length: 9 }, (_, index) => ({ token: `token:${index}`, label: "control" })) },
			{ controls: [{ token: "x".repeat(513), label: "control" }] },
			{ controls: [{ token: "agent-token", label: "" }] },
			{ controls: [{ token: "agent-token", label: "control", handler: "exit" }] },
			{ controls: [{ token: "agent-token", label: "control", action: "exit" }] },
			{ controls: [{ token: "agent-token", label: "control", kind: "exit" }] },
		].map(({ controls }) => call("message.update", { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA, message_ref: `message:${"b".repeat(64)}`, text: "working", presentation: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_V2_SCHEMA, intent: "progress", abortable: true, ...(controls === undefined ? {} : { controls }) } }, "run:write:2")),
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest(bad), TypeError);

	const response = (result) => ({ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result } });
	const resolveResult = (items, handles) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "resource.resolve", effect: "read", result_ref: `result:${"a".repeat(64)}`,
		handles, data: { schema_version: "ceal.gateway_leased_agent_resource_read_data.v2", items },
	});
	const handles = [{ kind: "target", ref: `target:${"c".repeat(64)}` }, { kind: "thread", ref: `thread:${"d".repeat(64)}` }];
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response(resolveResult([{ kind: "conversation", display_name: "Release Room", handle_index: 0 }], handles))).operation, "call");
	for (const items of [
		[{ kind: "conversation", display_name: "Release Room", handle_index: 2 }],
		[{ kind: "conversation", display_name: "", handle_index: 0 }],
		[{ kind: "conversation", display_name: "Release Room", handle_index: 0, ref: "C01234567" }],
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(response(resolveResult(items, handles))), TypeError);
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "presentation.activity.set", effect: "write", result_ref: `result:${"1".repeat(64)}`,
		handles: [], data: { schema_version: "ceal.gateway_leased_agent_presentation_activity_data.v1", terminal: "acknowledged" },
	})).operation, "call");
});

test("the internal v4 decoder and result-rule tables equal the exported ABI sets", async () => {
	const { CEAL_LEASED_CONSUMER_V4_DECLARED_CAPABILITY_IDS, CEAL_LEASED_CONSUMER_V4_READ_CAPABILITY_IDS, CEAL_LEASED_CONSUMER_V4_WRITE_CAPABILITY_IDS } = await import("../dist/index.js");
	const exported = [...CEAL_LEASED_CONSUMER_V4_READ_CAPABILITY_IDS, ...CEAL_LEASED_CONSUMER_V4_WRITE_CAPABILITY_IDS].sort();
	assert.deepEqual([...CEAL_LEASED_CONSUMER_V4_DECLARED_CAPABILITY_IDS].sort(), exported);
	// Every declared id must also have a result rule: a syntactically valid but
	// rule-less result would otherwise fail as an opaque decode error.
	for (const id of exported) {
		const effect = CEAL_LEASED_CONSUMER_V4_READ_CAPABILITY_IDS.includes(id) ? "read" : "write";
		assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse({
			schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call",
			result: { status: "result", result: { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: id, effect, result_ref: `result:${"a".repeat(64)}`, handles: [], data: { schema_version: "ceal.unknown_data.v1" } } },
		}), TypeError, id);
	}
});

test("survey dispatch capability accepts only opaque authority arguments and consistent zero-handle results", () => {
	const request = {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
		operation: "call",
		input: {
			schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput,
			capability_id: "workflow.survey_dispatch.send", target_ref: `target:${"d".repeat(64)}`,
			purpose: "send approved survey", idempotency_key: "survey-dispatch:one",
			arguments: { schema_version: CEAL_LEASED_CONSUMER_SURVEY_DISPATCH_ARGUMENTS_SCHEMA, run_id: "survey-run:one", dispatch_fingerprint: "a".repeat(64) },
		},
	};
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(request).operation, "call");
	for (const mutate of [
		(value) => { value.arguments.recipient_id = "U0123456789"; },
		(value) => { value.arguments.run_id = "unsafe run"; },
		(value) => { value.arguments.dispatch_fingerprint = "A".repeat(64); },
		(value) => { delete value.idempotency_key; },
	]) {
		const bad = structuredClone(request); mutate(bad.input);
		assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest(bad), TypeError);
	}

	const response = (data, handles = []) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call",
		result: { status: "result", result: { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "workflow.survey_dispatch.send", effect: "write", result_ref: `result:${"e".repeat(64)}`, handles, data } },
	});
	const completed = { schema_version: CEAL_LEASED_CONSUMER_SURVEY_DISPATCH_DATA_SCHEMA, terminal: "completed", sent_count: 2, replayed_count: 1, failed_count: 1, uncertain_count: 0 };
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response(completed)).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response({ ...completed, terminal: "ack_uncertain", uncertain_count: 1 })).operation, "call");
	for (const [data, handles] of [
		[{ ...completed, provider_message_id: "171234.0001" }, []],
		[{ ...completed, terminal: "ack_uncertain" }, []],
		[{ ...completed, uncertain_count: 1 }, []],
		[{ ...completed, sent_count: -1 }, []],
		[{ ...completed, sent_count: "1" }, []],
		[{ ...completed, sent_count: 1.5 }, []],
		[{ ...completed, sent_count: Number.NaN }, []],
		[{ ...completed, failed_count: Number.MAX_SAFE_INTEGER + 1 }, []],
		[completed, [{ kind: "message", ref: `message:${"f".repeat(64)}` }]],
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(response(data, handles)), TypeError);
});

test("the people directory carries an addressable subject ref without ever carrying a provider identity", async () => {
	const { CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_ARGUMENTS_SCHEMA } = await import("../dist/index.js");
	const call = (arguments_) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA, operation: "call",
		input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id: "directory.people.search", target_ref: `target:${"e".repeat(64)}`, purpose: "declared", arguments: arguments_ },
	});
	const schema_version = CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_ARGUMENTS_SCHEMA;
	// Listing the whole active Profile is the ordinary first call, so both
	// arguments are optional.
	for (const good of [{ schema_version }, { schema_version, query: "ali" }, { schema_version, limit: 50 }, { schema_version, query: "ali", limit: 1 }]) {
		assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call(good)).operation, "call");
	}
	for (const bad of [{ schema_version, query: " " }, { schema_version, query: "a".repeat(129) }, { schema_version, limit: 0 }, { schema_version, limit: 51 }, { schema_version, limit: 1.5 }, { schema_version, subject_ref: "subject:alice" }]) {
		assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest(call(bad)), TypeError);
	}

	const response = (items, truncated) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call",
		result: { status: "result", result: {
			schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "directory.people.search", effect: "read", result_ref: `result:${"a".repeat(64)}`,
			handles: [], data: { schema_version: "ceal.gateway_leased_agent_resource_read_data.v2", items, ...(truncated === undefined ? {} : { truncated }) },
		} },
	});
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response([{ kind: "identity", display_name: "Alice", subject_ref: "subject:alice", actor_kind: "human", text: "Engineer · Platform" }], true)).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response([{ kind: "identity", display_name: "Alice" }])).operation, "call");
	for (const [items, truncated] of [
		// A Slack-shaped id must never ride the subject ref, the subject ref is
		// identity-only, and truncation is a boolean fact or absent.
		[[{ kind: "identity", display_name: "Alice", subject_ref: "subject:U0AAAAAAAAA" }], false],
		[[{ kind: "identity", display_name: "Alice", subject_ref: "U0AAAAAAAAA" }], false],
		[[{ kind: "identity", display_name: "Alice", subject_ref: "alice" }], false],
		[[{ kind: "usergroup", display_name: "Platform", subject_ref: "subject:alice" }], false],
		[[{ kind: "identity", display_name: "Alice", subject_ref: "subject:B0AAAAAAAAA" }], false],
		// actor_kind is identity-only and closed to its four declared values.
		[[{ kind: "message", display_name: "Alice", actor_kind: "human" }], false],
		[[{ kind: "identity", display_name: "Alice", actor_kind: "colleague" }], false],
		[[{ kind: "identity", display_name: "Alice", subject_ref: "subject:alice", provider_user_id: "U0AAAAAAAAA" }], false],
		[[{ kind: "identity", display_name: "Alice" }], "yes"],
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(response(items, truncated)), TypeError);
});
