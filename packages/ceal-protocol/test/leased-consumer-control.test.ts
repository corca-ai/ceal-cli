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
	CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA,
	CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES,
	CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_MAX_BYTES,
	CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_V2_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_GET_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_CONVERSATION_THREAD_GET_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_DELETE_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_DELETE_DATA_SCHEMA,
	decodeCealLeasedConsumerControlRequest,
	decodeCealLeasedConsumerControlResponse,
	decodeCealLeasedConsumerControlSession,
	decodeCealLeasedConsumerResultControlRequest,
	decodeCealLeasedConsumerResultControlResponse,
	decodeCealLeasedConsumerReplyControlRequest,
	decodeCealLeasedConsumerReplyControlResponse,
	decodeCealLeasedConsumerCapabilityControlRequest,
	decodeCealLeasedConsumerCapabilityControlResponse,
} from "../dist/index.js";
import {
	capabilityCatalog,
	lease,
	leaseInput,
	notionCatalog,
} from "./leased-consumer-control-test-support.ts";

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
		// The merged message read (2026-08-12) is a RESOLVE-family result: each row
		// carries a handle_index into the message handles it just minted, which is
		// what the retired `message.enumerate` was worth keeping for.
		{ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "message.search", effect: "read", result_ref: `result:${"b".repeat(64)}`, handles: [{ kind: "message", ref: `message:${"c".repeat(64)}` }], data: { schema_version: "ceal.gateway_leased_agent_resource_read_data.v2", items: [{ kind: "message", display_name: "2026-07-15T00:00:00.000Z", handle_index: 0, text: "bounded", reply_count: 40, author: { author_ref: `author:${"1".repeat(64)}`, display_name: "Alice", actor_kind: "human" } }] } },
		{ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "message.get", effect: "read", result_ref: `result:${"9".repeat(64)}`, handles: [], data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA, items: [{ text: "bounded", reply_count: 40, author: { author_ref: `author:${"1".repeat(64)}`, display_name: "Alice", actor_kind: "human" } }] } },
		{ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "message.update", effect: "write", result_ref: `result:${"d".repeat(64)}`, handles: [{ kind: "target", ref: `target:${"e".repeat(64)}` }, { kind: "message", ref: `message:${"f".repeat(64)}` }], data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA, terminal: "readback_confirmed", text: "updated" } },
		{ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "message.delete", effect: "write", result_ref: `result:${"f".repeat(64)}`, handles: [{ kind: "message", ref: `message:${"7".repeat(64)}` }], data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_DELETE_DATA_SCHEMA, terminal: "readback_confirmed" } },
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
		// `message.get` carries the message-read data family; `message.search` moved
		// to the resolve family when enumerate was folded into it (2026-08-12).
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "message.get", effect: "read", result_ref: `result:${"b".repeat(64)}`, handles: [],
		data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA, items: [{ text: "bounded", author: { author_ref: "author:U0123456789", actor_kind: "human" } as Record<string, unknown> }] },
	} } };
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(unsafeAuthorResult), TypeError);
	unsafeAuthorResult.result.result.data.items[0].author = { author_ref: `author:${"1".repeat(64)}`, display_name: "Alice (U0123456789)", actor_kind: "human" };
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(unsafeAuthorResult), TypeError);
	// The addressable substitute crosses only in the opaque Gateway form; a
	// provider-shaped one behind the prefix is a refused response, not a
	// stripped key, because the author descriptor is exact-keyed.
	unsafeAuthorResult.result.result.data.items[0].author = { author_ref: `author:${"1".repeat(64)}`, actor_kind: "human", subject_ref: "subject:U0123456789" };
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(unsafeAuthorResult), TypeError);
	unsafeAuthorResult.result.result.data.items[0].author = { author_ref: `author:${"1".repeat(64)}`, actor_kind: "human", subject_ref: `subject:${"2".repeat(64)}` };
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(unsafeAuthorResult).operation, "call");
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
			requester: { subject_ref: "subject:alice", display_name: "Alice", provider_identity: { provider: "slack", account_id: "U0ALICE0001" } },
			attachments: { count: 0, set_ref: null },
			projection: { schema_version: "ceal.gateway_normalized_projection.v1", text: "bounded" },
			capability_catalog: capabilityCatalog,
			messenger_context: {
				conversation_ref: `conversation:${"9".repeat(64)}`,
				capability_contexts: [
					{ capability_id: "message.search", target_ref: `target:${"3".repeat(64)}`, message_ref: `message:${"4".repeat(64)}`, thread_ref: `thread:${"5".repeat(64)}` },
					{ capability_id: "message.create", target_ref: `target:${"5".repeat(64)}`, message_ref: `message:${"6".repeat(64)}`, thread_ref: `thread:${"7".repeat(64)}` },
				],
			},
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

test("reply_count is message-only leased metadata with a strict nonnegative integer rule", () => {
	const response = (capability_id: "message.search" | "message.get", data: unknown) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA,
		operation: "call",
		result: { status: "result", result: {
			schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id, effect: "read", result_ref: `result:${"a".repeat(64)}`,
			handles: [], data,
		} },
	});
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response("message.search", {
		schema_version: "ceal.gateway_leased_agent_resource_read_data.v2", items: [{ kind: "message", display_name: "thread", reply_count: 40 }],
	})).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response("message.get", {
		schema_version: CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA, items: [{ text: "thread", reply_count: 40 }],
	})).operation, "call");
	for (const data of [
		{ schema_version: "ceal.gateway_leased_agent_resource_read_data.v2", items: [{ kind: "identity", display_name: "Alice", reply_count: 1 }] },
		{ schema_version: "ceal.gateway_leased_agent_resource_read_data.v2", items: [{ kind: "message", display_name: "thread", reply_count: -1 }] },
		{ schema_version: "ceal.gateway_leased_agent_resource_read_data.v2", items: [{ kind: "message", display_name: "thread", reply_count: 1.5 }] },
		{ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA, items: [{ text: "thread", reply_count: -1 }] },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(response(data.schema_version === CEAL_LEASED_CONSUMER_MESSAGE_READ_DATA_SCHEMA ? "message.get" : "message.search", data)), TypeError);
});

test("message.search v2 exposes an opaque continuation with exact completion invariants", () => {
	const continuation = "enumeration:123e4567-e89b-12d3-a456-426614174000";
	const handle = { kind: "message", ref: `message:${"b".repeat(64)}` };
	const item = { kind: "message", display_name: "message", handle_index: 0, text: "bounded" };
	const response = (data: unknown) => decodeCealLeasedConsumerCapabilityControlResponse({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA,
		operation: "call",
		result: { status: "result", result: {
			schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA,
			capability_id: "message.search", effect: "read", result_ref: `result:${"a".repeat(64)}`,
			handles: [handle], data,
		} },
	});
	assert.equal(response({ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_DATA_SCHEMA, completeness: "complete", items: [item] }).operation, "call");
	const available = response({
		schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_DATA_SCHEMA, completeness: "continuation_available", items: [item],
		next_action: { capability_id: "message.search", target_ref: `target:${"c".repeat(64)}`, arguments: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_V2_SCHEMA, continuation } },
	});
	assert.equal(available.operation, "call");
	for (const invalid of [
		{ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_DATA_SCHEMA, completeness: "complete", items: [item], next_action: {} },
		{ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_DATA_SCHEMA, completeness: "continuation_available", items: [item] },
		{ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_DATA_SCHEMA, completeness: "continuation_available", items: [item], next_action: { capability_id: "message.search", target_ref: `target:${"c".repeat(64)}`, arguments: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_V2_SCHEMA, continuation: "provider:cursor" } } },
		{ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_DATA_SCHEMA, completeness: "complete", items: [item], extra: true },
	]) assert.throws(() => response(invalid), TypeError);

	const call = (arguments_: unknown) => decodeCealLeasedConsumerCapabilityControlRequest({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
		operation: "call",
		input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id: "message.search", target_ref: `target:${"c".repeat(64)}`, purpose: "find messages", arguments: arguments_ },
	});
	assert.equal(call({ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_V2_SCHEMA, query: "bounded", include_replies: false }).operation, "call");
	assert.equal(call({ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_V2_SCHEMA, continuation }).operation, "call");
	for (const invalid of [
		{ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_V2_SCHEMA, continuation, query: "changed" },
		{ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_V2_SCHEMA, include_replies: true },
		{ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_V2_SCHEMA, continuation: "enumeration:not-a-uuid" },
	]) assert.throws(() => call(invalid), TypeError);
	// The old wire remains a valid one-page request during the rollout.
	assert.equal(call({ schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_SCHEMA, query: "bounded" }).operation, "call");
});

test("leased capability custody pins the nested result byte boundary independently of the carrier", () => {
	const makeResponse = (textLengths: readonly number[]) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA,
		operation: "call",
		result: { status: "result", result: {
			schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA,
			capability_id: "message.search", effect: "read", result_ref: `result:${"a".repeat(64)}`,
			handles: [
				{ kind: "message", ref: `message:${"b".repeat(64)}` },
				{ kind: "message", ref: `message:${"c".repeat(64)}` },
			],
			data: {
				schema_version: CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_DATA_SCHEMA,
				completeness: "complete",
				items: textLengths.map((length, handle_index) => ({ kind: "message", display_name: "m", handle_index, text: "x".repeat(length) })),
			},
		} },
	});
	const exact = makeResponse([11_959, 11_959]);
	assert.equal(Buffer.byteLength(JSON.stringify(exact.result.result), "utf8"), CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_MAX_BYTES);
	assert.ok(Buffer.byteLength(JSON.stringify(exact), "utf8") < CEAL_LEASED_CONSUMER_CONTROL_MAX_FRAME_BYTES);
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(exact).operation, "call");

	const oversized = makeResponse([11_959, 11_960]);
	assert.equal(Buffer.byteLength(JSON.stringify(oversized.result.result), "utf8"), CEAL_LEASED_CONSUMER_DELEGATED_READ_RESULT_MAX_BYTES + 1);
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(oversized), TypeError);
});

test("capability control v4 rejects provider-shaped handles and custody fields", () => {
	const result = {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA,
		capability_id: "message.update", effect: "write", result_ref: `result:${"a".repeat(64)}`,
		handles: [{ kind: "message", ref: `message:${"b".repeat(64)}` }], data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA, terminal: "readback_confirmed", text: "updated" },
	};
	const response = (candidate: unknown) => ({ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: candidate } });
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
		handles: [], data: { schema_version: CEAL_LEASED_CONSUMER_MESSAGE_DELETE_DATA_SCHEMA, terminal: "readback_confirmed" },
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
			requester: { subject_ref: "subject:alice", display_name: "Alice" },
			attachments: { count: 0, set_ref: null },
			projection: { schema_version: "ceal.gateway_normalized_projection.v1", text: "bounded" },
			capability_catalog: capabilityCatalog,
			messenger_context: { conversation_ref: `conversation:${"9".repeat(64)}`, capability_contexts: [{ capability_id: "message.search", target_ref: `target:${"1".repeat(64)}`, message_ref: `message:${"2".repeat(64)}`, thread_ref: `thread:${"3".repeat(64)}` }] },
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
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse({ ...projection, result: { ...projection.result, messenger_context: { ...projection.result.messenger_context, capability_contexts } } }), TypeError);
});

test("capability projection requires the catalog and rejects the retired top-level messenger fields", () => {
	const notionOnly = {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA,
		operation: "projection",
		result: {
			status: "available", event_ref: "event:notion", event_revision: 1,
			normalized_projection_ref: "projection:notion", normalized_projection_revision: 1,
			requester: { subject_ref: "subject:alice" }, attachments: { count: 0, set_ref: null },
			projection: { schema_version: "ceal.gateway_normalized_projection.v1", text: "Read the page" },
			capability_catalog: notionCatalog,
		},
	};
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(notionOnly).operation, "projection");
	for (const legacyField of [
		{ conversation_ref: `conversation:${"a".repeat(64)}` },
		{ capability_contexts: [] },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse({
		...notionOnly, result: { ...notionOnly.result, ...legacyField },
	}), TypeError);
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse({
		...notionOnly, result: { ...notionOnly.result, capability_catalog: { ...notionCatalog, capabilities: [] } },
	}).operation, "projection");
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse({
		...notionOnly,
		result: {
			...notionOnly.result,
			capability_catalog: {
				...notionCatalog,
				capabilities: [{ ...notionCatalog.capabilities[0], targets: [{ target_ref: "target:not-opaque", label: "Notion", connector_kind: "notion", target_kind: "workspace", readiness: "ready" }] }],
			},
		},
	}), TypeError);
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse({
		...notionOnly, result: { ...notionOnly.result, messenger_context: { conversation_ref: `conversation:${"a".repeat(64)}`, capability_contexts: [] } },
	}), TypeError);
});

test("projection context accepts the scheduled trigger marker and rejects any other trigger", () => {
	// Regression (ceal-dev S7 rehearsal, 2026-08-06): the projection store and
	// consumer resolver admitted context.trigger="scheduled" while this decoder
	// still rejected it, collapsing the serving response into a silent
	// control_unavailable supervisor halt.
	const capabilityProjection = (context: unknown) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA,
		operation: "projection",
		result: {
			status: "available", event_ref: "event:one", event_revision: 1,
			normalized_projection_ref: "projection:one", normalized_projection_revision: 1,
			requester: { subject_ref: "subject:alice" },
			attachments: { count: 0, set_ref: null },
			projection: { schema_version: "ceal.gateway_normalized_projection.v1", text: "bounded", context },
			capability_catalog: capabilityCatalog,
			messenger_context: { conversation_ref: `conversation:${"9".repeat(64)}`, capability_contexts: [{ capability_id: "message.search", target_ref: `target:${"1".repeat(64)}`, message_ref: `message:${"2".repeat(64)}`, thread_ref: `thread:${"3".repeat(64)}` }] },
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
