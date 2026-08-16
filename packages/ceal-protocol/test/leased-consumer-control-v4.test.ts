import assert from "node:assert/strict";
import test from "node:test";
import {
	CEAL_LEASED_CONSUMER_REPLY_CONTROL_RESPONSE_SCHEMA,
	CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
	CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA,
	CEAL_LEASED_CONSUMER_CAPABILITY_NOTIFICATION_SCHEMA,
	CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_REQUEST_SCHEMA,
	CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_RESPONSE_SCHEMA,
	CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_CREATE_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_UPDATE_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_WRITE_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_NOTION_SEARCH_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_NOTION_PAGE_GET_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_DOCUMENT_READ_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_DOCUMENT_CREATE_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_DOCUMENT_CREATE_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_PRESENTATION_V2_SCHEMA,
	CEAL_LEASED_CONSUMER_SHEETS_VALUES_READ_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_SHEETS_VALUES_UPDATE_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_SHEETS_VALUES_CLEAR_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_SHEETS_VALUES_READ_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_SHEETS_VALUES_UPDATE_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_SHEETS_VALUES_CLEAR_DATA_SCHEMA,
	decodeCealLeasedConsumerReplyControlResponse,
	decodeCealLeasedConsumerCapabilityControlRequest,
	decodeCealLeasedConsumerCapabilityControlResponse,
	decodeCealLeasedConsumerCapabilityNotification,
	decodeCealLeasedConsumerNotificationControlRequest,
	decodeCealLeasedConsumerNotificationControlResponse,
} from "../dist/index.js";
import {
	capabilityCatalog,
	lease,
	leaseInput,
	nest,
	notificationBinding,
} from "./leased-consumer-control-test-support.ts";


test("capability control v4 write results carry one target and an ordered continuation message group", () => {
	const messages = (count: number) => Array.from({ length: count }, (_, index) => ({ kind: "message", ref: `message:${index.toString(16).padStart(64, "0")}` }));
	const result = (handles: unknown[]) => ({
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
	const response = (result: unknown) => ({ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "recheck", result });
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
		(value: Record<string, unknown>) => { value.notification_sequence = 0; },
		(value: Record<string, unknown>) => { value.event_revision = 0; },
		(value: Record<string, unknown>) => { value.consumer_generation = 0; },
		(value: Record<string, unknown>) => { value.kind = "provider_abort"; },
		(value: Record<string, unknown>) => { value.runner_ref = "U01234567"; },
		(value: Record<string, unknown>) => { value.channel_id = "C01234567"; },
		(value: Record<string, unknown>) => { value.payload = { text: "stop" }; },
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
		requester: { subject_ref: "subject:alice" }, attachments: { count: 0, set_ref: null },
		projection: controlProjection, capability_catalog: capabilityCatalog,
	};
	const v5 = { schema_version: CEAL_LEASED_CONSUMER_NOTIFICATION_CONTROL_RESPONSE_SCHEMA, operation: "projection", result };
	const v4 = { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "projection", result };
	assert.equal(decodeCealLeasedConsumerNotificationControlResponse(v5).operation, "projection");
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(v4), TypeError);
	for (const mutate of [
		(value: unknown) => { nest(value, "projection", "control").handler_id = "exit"; },
		(value: unknown) => { nest(value, "projection", "control").authority = "operator"; },
		(value: unknown) => { nest(value, "projection", "control", "origin").event_revision = 0; },
		(value: unknown) => { nest(value).capability_contexts = [{ capability_id: "message.create" }]; },
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
		(value: unknown) => { nest(value, "control_effect").effect = "message.delete"; },
		(value: unknown) => { nest(value, "control_effect").handler_id = "exit"; },
		(value: unknown) => { nest(value).disposition = "failed"; },
	]) {
		const bad = structuredClone(v5); mutate(bad.input);
		assert.throws(() => decodeCealLeasedConsumerNotificationControlRequest(bad), TypeError);
	}
});

test("capability control v4 declares enumerate/resolve/presentation with display-name resolve reads", () => {
	const call = (capability_id: string, arguments_: unknown, idempotency_key?: string) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA, operation: "call",
		input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id, target_ref: `target:${"e".repeat(64)}`, purpose: "declared", arguments: arguments_, ...(idempotency_key ? { idempotency_key } : {}) },
	});
	// `message.enumerate` was folded into `message.search` (2026-08-12). Every
	// filter is optional, because the motivating question carries no query term.
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call("message.search", { schema_version: "ceal.gateway_leased_agent_message_search_arguments.v1", limit: 20 })).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call("message.search", { schema_version: "ceal.gateway_leased_agent_message_search_arguments.v1" })).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call("message.search", { schema_version: "ceal.gateway_leased_agent_message_search_arguments.v1", query: "launch", limit: 20, author_ref: `author:${"1".repeat(64)}`, since: "2026-08-01T00:00:00Z", until: "2026-08-08T00:00:00Z", include_replies: true })).operation, "call");
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
		call("message.search", { schema_version: "ceal.gateway_leased_agent_message_search_arguments.v1", limit: 129 }),
		call("message.search", { schema_version: "ceal.gateway_leased_agent_message_search_arguments.v1", author_ref: "author:U0123456789" }),
		call("message.search", { schema_version: "ceal.gateway_leased_agent_message_search_arguments.v1", include_replies: "yes" }),
		call("message.search", { schema_version: "ceal.gateway_leased_agent_message_search_arguments.v1", since: "2026-02-31T00:00:00Z" }),
		call("message.search", { schema_version: "ceal.gateway_leased_agent_message_search_arguments.v1", since: "2026-08-12T00:00:00Z", until: "2026-08-01T00:00:00Z" }),
		call("message.search", { schema_version: "ceal.gateway_leased_agent_message_search_arguments.v1", offset: 0 }),
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

	const response = (result: unknown) => ({ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result } });
	const resolveResult = (items: unknown, handles: unknown) => ({
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
		const effect = (CEAL_LEASED_CONSUMER_V4_READ_CAPABILITY_IDS as readonly string[]).includes(id) ? "read" : "write";
		assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse({
			schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call",
			result: { status: "result", result: { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: id, effect, result_ref: `result:${"a".repeat(64)}`, handles: [], data: { schema_version: "ceal.unknown_data.v1" } } },
		}), TypeError, id);
	}
});

test("Sheets leased calls require exact bounded ranges, rectangular preconditions, and terminal result schemas", () => {
	const call = (capability_id: string, arguments_: unknown, effect = capability_id === "sheets.values.read" ? "read" : "write") => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA, operation: "call",
		input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id, target_ref: `target:${"a".repeat(64)}`, purpose: "bounded Sheets", arguments: arguments_, ...(effect === "write" ? { idempotency_key: `${capability_id}:outer` } : {}) },
	});
	const read = { schema_version: CEAL_LEASED_CONSUMER_SHEETS_VALUES_READ_ARGUMENTS_SCHEMA, range: "Sheet1!A1:B2" };
	const expected = [["old", ""], ["same", 3]];
	const update = { schema_version: CEAL_LEASED_CONSUMER_SHEETS_VALUES_UPDATE_ARGUMENTS_SCHEMA, range: "Sheet1!A1:B2", values: [["new", "value"], ["next", 4]], expected_before_values: expected, idempotency_key: "sheets-update:one" };
	const clear = { schema_version: CEAL_LEASED_CONSUMER_SHEETS_VALUES_CLEAR_ARGUMENTS_SCHEMA, range: "Sheet1!A1:B2", expected_before_values: expected, idempotency_key: "sheets-clear:one" };
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call("sheets.values.read", read)).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call("sheets.values.update", update)).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call("sheets.values.clear", clear)).operation, "call");
	const invalidSheets: Array<[string, unknown]> = [
		["sheets.values.read", { ...read, range: "Sheet1!A:A" }], ["sheets.values.read", { ...read, range: "unsafe\u0000sheet!A1:B2" }], ["sheets.values.read", { ...read, extra: true }],
		["sheets.values.update", { ...update, values: [["new"]] }], ["sheets.values.update", { ...update, require_empty: true }],
		["sheets.values.clear", { ...clear, expected_before_values: [["old"]] }], ["sheets.values.clear", { ...clear, expected_before_values: [["old", "\u0000"], ["same", 3]] }],
	];
	for (const [capability_id, bad] of invalidSheets) assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest(call(capability_id, bad)), TypeError);

	const response = (capability_id: string, effect: string, data: unknown, handles: unknown[] = []) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call",
		result: { status: "result", result: { schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id, effect, result_ref: `result:${"b".repeat(64)}`, handles, data } },
	});
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response("sheets.values.read", "read", { schema_version: CEAL_LEASED_CONSUMER_SHEETS_VALUES_READ_DATA_SCHEMA, range: "Sheet1!A1:B2", values: [["old", ""], ["same", 3]] })).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response("sheets.values.update", "write", { schema_version: CEAL_LEASED_CONSUMER_SHEETS_VALUES_UPDATE_DATA_SCHEMA, terminal: "readback_confirmed" })).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response("sheets.values.clear", "write", { schema_version: CEAL_LEASED_CONSUMER_SHEETS_VALUES_CLEAR_DATA_SCHEMA, terminal: "idempotency_replayed" })).operation, "call");
	for (const bad of [
		response("sheets.values.read", "write", { schema_version: CEAL_LEASED_CONSUMER_SHEETS_VALUES_READ_DATA_SCHEMA, range: "Sheet1!A1:B2", values: [["old", ""], ["same", 3]] }),
		response("sheets.values.clear", "write", { schema_version: CEAL_LEASED_CONSUMER_SHEETS_VALUES_CLEAR_DATA_SCHEMA, terminal: "readback_confirmed" }, [{ kind: "target", ref: `target:${"c".repeat(64)}` }]),
		response("sheets.values.update", "write", { schema_version: CEAL_LEASED_CONSUMER_SHEETS_VALUES_UPDATE_DATA_SCHEMA, terminal: "readback_confirmed", extra: true }),
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(bad), TypeError);
});

test("Notion calls use strict provider-neutral document grammar and one outer result identity", () => {
	const request = (capabilityId: string, arguments_: unknown) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA, operation: "call",
		input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id: capabilityId, target_ref: `target:${"1".repeat(64)}`, purpose: "read governed Notion", arguments: arguments_ },
	});
	for (const arguments_ of [
		{ schema_version: CEAL_LEASED_CONSUMER_NOTION_SEARCH_ARGUMENTS_SCHEMA, query: "roadmap" },
		{ schema_version: CEAL_LEASED_CONSUMER_NOTION_SEARCH_ARGUMENTS_SCHEMA, query: "roadmap", limit: 10, offset: 90 },
	]) assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(request("notion.search", arguments_)).operation, "call");
	for (const arguments_ of [
		{ schema_version: CEAL_LEASED_CONSUMER_NOTION_SEARCH_ARGUMENTS_SCHEMA, query: "", limit: 1 },
		{ schema_version: CEAL_LEASED_CONSUMER_NOTION_SEARCH_ARGUMENTS_SCHEMA, query: "roadmap", limit: 11 },
		{ schema_version: CEAL_LEASED_CONSUMER_NOTION_SEARCH_ARGUMENTS_SCHEMA, query: "roadmap", offset: 91 },
		{ schema_version: CEAL_LEASED_CONSUMER_NOTION_SEARCH_ARGUMENTS_SCHEMA, query: "roadmap", cursor: "provider-cursor" },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest(request("notion.search", arguments_)), TypeError);
	const documentRef = `document:${"2".repeat(64)}`;
	for (const arguments_ of [
		{ schema_version: CEAL_LEASED_CONSUMER_NOTION_PAGE_GET_ARGUMENTS_SCHEMA, ref: documentRef },
	]) assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(request("notion.page.get", arguments_)).operation, "call");
	for (const arguments_ of [
		{ schema_version: CEAL_LEASED_CONSUMER_NOTION_PAGE_GET_ARGUMENTS_SCHEMA, ref: "notion-page:00000000-0000-0000-0000-000000000000" },
		{ schema_version: CEAL_LEASED_CONSUMER_NOTION_PAGE_GET_ARGUMENTS_SCHEMA, ref: documentRef, with_blocks: true },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest(request("notion.page.get", arguments_)), TypeError);

	const response = (data: unknown, extra: Record<string, unknown> = {}) => ({ schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call", result: { status: "result", result: {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "notion.page.get", effect: "read", result_ref: `result:${"3".repeat(64)}`, handles: [], data, ...extra,
	} } });
	const data = { schema_version: CEAL_LEASED_CONSUMER_DOCUMENT_READ_DATA_SCHEMA, format: "enhanced_markdown", preview: "# Roadmap\n\nNext", complete: false, file_count: 2 };
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response(data)).operation, "call");
	for (const invalid of [
		{ ...data, materialization_ref: `result:${"4".repeat(64)}` },
		{ ...data, format: "markdown" }, { ...data, file_count: 0 }, { ...data, file_count: 17 },
		{ ...data, preview: "x".repeat(4097) }, { ...data, body: "full body" },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(response(invalid)), TypeError);
});

test("document.create uses an opaque parent handle and returns one opaque page handle", () => {
	const parentRef = `document:${"4".repeat(64)}`;
	const createdRef = `document:${"5".repeat(64)}`;
	const request = {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA, operation: "call",
		input: {
			schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput,
			capability_id: "document.create", target_ref: `target:${"6".repeat(64)}`, purpose: "create a governed Notion document",
			idempotency_key: "document-create:outer",
			arguments: { schema_version: CEAL_LEASED_CONSUMER_DOCUMENT_CREATE_ARGUMENTS_SCHEMA, parent_ref: parentRef, title: "Release note", body: "One paragraph", idempotency_key: "document-create:inner" },
		},
	};
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(request).operation, "call");
	for (const arguments_ of [
		{ ...request.input.arguments, parent_ref: "notion-page:provider-id" },
		{ ...request.input.arguments, body: "" },
		{ ...request.input.arguments, provider_page_id: "secret" },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest({ ...request, input: { ...request.input, arguments: arguments_ } }), TypeError);
	const response = {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call",
		result: { status: "result", result: {
			schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "document.create", effect: "write", result_ref: `result:${"7".repeat(64)}`,
			handles: [{ kind: "document", ref: createdRef }], data: { schema_version: CEAL_LEASED_CONSUMER_DOCUMENT_CREATE_DATA_SCHEMA, terminal: "readback_confirmed" },
		} },
	};
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response).operation, "call");
	for (const bad of [
		{ ...response.result.result, handles: [] },
		{ ...response.result.result, handles: [{ kind: "target", ref: `target:${"8".repeat(64)}` }] },
		{ ...response.result.result, data: { schema_version: CEAL_LEASED_CONSUMER_DOCUMENT_CREATE_DATA_SCHEMA, terminal: "unknown" } },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse({ ...response, result: { status: "result", result: bad } }), TypeError);
});

test("capability result materialization pulls one strictly framed result chunk under the active lease", () => {
	const resultRef = `result:${"5".repeat(64)}`;
	const request = {
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
		operation: "materialization",
		input: { ...leaseInput, result_ref: resultRef, frame_index: 1 },
	};
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(request).operation, "materialization");
	for (const input of [
		{ ...request.input, frame_index: -1 },
		{ ...request.input, frame_index: 1.5 },
		{ ...request.input, result_ref: "result:not-a-digest" },
		{ ...request.input, capability_id: "notion.page.get" },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest({ ...request, input }), TypeError);

	const response = (result: unknown) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA,
		operation: "materialization",
		result,
	});
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response({ status: "frame", frame: {
		schema_version: "ceal.result_materialization_frame.v1", kind: "chunk", slot: 0,
		chunk_index: 0, chunk_count: 1, bytes_base64: "ZG9jdW1lbnQ=",
	} })).operation, "materialization");
	for (const status of ["materialization_unavailable", "lease_lost", "lease_expired", "event_settled", "authentication_failed", "control_unavailable"]) {
		assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response({ status })).operation, "materialization");
	}
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(response({ status: "frame", frame: {
		schema_version: "ceal.result_materialization_frame.v1", kind: "chunk", slot: 0,
		chunk_index: 1, chunk_count: 1, bytes_base64: "ZG9jdW1lbnQ=",
	} })), TypeError);
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(response({ status: "result_not_replayable" })), TypeError);
});

test("generic reply intake admits one optional safe correlation ref and rejects provider-shaped free text", () => {
	const request = (correlationRef: string | undefined) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA,
		operation: "call",
		input: {
			schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput,
			capability_id: "workflow.reply_intake.register", target_ref: `target:${"d".repeat(64)}`,
			purpose: "register workflow response", idempotency_key: "reply-intake:one",
			arguments: {
				schema_version: "ceal.gateway_leased_agent_reply_intake_arguments.v1",
				root_ref: `message:${"e".repeat(64)}`, workflow_name: "survey", skill_name: "survey",
				routing: "skill", mode: "human_replies", ...(correlationRef === undefined ? {} : { correlation_ref: correlationRef }),
			},
		},
	});
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(request("survey-reply:one")).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(request(undefined)).operation, "call");
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest(request("unsafe correlation")), TypeError);
});

test("the people directory carries an addressable subject ref without ever carrying a provider identity", async () => {
	const { CEAL_LEASED_CONSUMER_PEOPLE_SEARCH_ARGUMENTS_SCHEMA } = await import("../dist/index.js");
	const call = (arguments_: unknown) => ({
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

	const response = (items: unknown, truncated?: unknown) => ({
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

test("the file noun carries filename, mimetype and size, and only a file item may", async () => {
	const { CEAL_LEASED_CONSUMER_FILE_SEARCH_ARGUMENTS_SCHEMA } = await import("../dist/index.js");
	const call = (arguments_: unknown) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_REQUEST_SCHEMA, operation: "call",
		input: { schema_version: "ceal.gateway_leased_consumer_call_request.v1", ...leaseInput, capability_id: "file.search", target_ref: `target:${"e".repeat(64)}`, purpose: "declared", arguments: arguments_ },
	});
	const schema_version = CEAL_LEASED_CONSUMER_FILE_SEARCH_ARGUMENTS_SCHEMA;
	for (const good of [
		{ schema_version, limit: 1 }, { schema_version, limit: 50 }, { schema_version, limit: 20, filetype: "pdf" },
		{ schema_version, limit: 20, query: "quarterly" },
		{ schema_version, limit: 20, since: "2026-08-01T00:00:00Z", until: "2026-08-12T00:00:00Z" },
	]) assert.equal(decodeCealLeasedConsumerCapabilityControlRequest(call(good)).operation, "call");
	for (const bad of [
		// `limit` is required (an unbounded page is what the carrier ceiling
		// exists to refuse), and the filter is a bounded lowercase family token
		// rather than a mimetype, a glob, or a provider query fragment.
		{ schema_version }, { schema_version, limit: 0 }, { schema_version, limit: 51 }, { schema_version, limit: 1.5 }, { schema_version, limit: "20" },
		{ schema_version, limit: 20, filetype: "PDFS" }, { schema_version, limit: 20, filetype: "application/pdf" }, { schema_version, limit: 20, filetype: "*" },
		{ schema_version, limit: 20, filetype: "" }, { schema_version, limit: 20, filetype: "p".repeat(33) }, { schema_version, limit: 20, channel: "C0AAAAAAAAA" },
		{ schema_version, limit: 20, query: "" }, { schema_version, limit: 20, query: "   " }, { schema_version, limit: 20, query: "q".repeat(513) },
		// A time bound crosses to the provider, so a value that only LOOKS like a
		// date must not widen the read, and a reversed window is an empty read
		// wearing a provider fault's clothes.
		{ schema_version, limit: 20, since: "2026-02-31T00:00:00Z" }, { schema_version, limit: 20, until: "2026-08-01" },
		{ schema_version, limit: 20, since: "2026-08-12T00:00:00Z", until: "2026-08-01T00:00:00Z" },
		{ schema_version, limit: 20, since: "2026-08-01T00:00:00Z", until: "2026-08-01T00:00:00Z" },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlRequest(call(bad)), TypeError);

	const response = (items: unknown, handles: unknown[] = []) => ({
		schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CONTROL_RESPONSE_SCHEMA, operation: "call",
		result: { status: "result", result: {
			schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_SCHEMA, capability_id: "file.search", effect: "read", result_ref: `result:${"a".repeat(64)}`,
			handles, data: { schema_version: "ceal.gateway_leased_agent_resource_read_data.v2", items },
		} },
	});
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response([{ kind: "file", display_name: "Q3 report", filename: "q3.pdf", mimetype: "application/pdf", size_bytes: 91_233 }])).operation, "call");
	// The three fields are each independently optional: a provider that reports
	// only a name must still project a usable row.
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response([{ kind: "file", display_name: "q3.pdf", filename: "q3.pdf" }])).operation, "call");
	assert.equal(decodeCealLeasedConsumerCapabilityControlResponse(response([{ kind: "file", display_name: "q3.pdf", size_bytes: 0 }])).operation, "call");
	for (const items of [
		// File detail is file-only: no other noun may smuggle it.
		[{ kind: "message", display_name: "hello", filename: "q3.pdf" }],
		[{ kind: "identity", display_name: "Alice", mimetype: "application/pdf" }],
		[{ kind: "conversation", display_name: "ceal-dev", size_bytes: 12 }],
		// A file item stays inside the identity/message field discipline too.
		[{ kind: "file", display_name: "q3.pdf", subject_ref: "subject:alice" }],
		[{ kind: "file", display_name: "q3.pdf", actor_kind: "human" }],
		// The mimetype is a bare restricted type/subtype: no parameters, no
		// wildcard, no raw provider URL smuggled through the field.
		[{ kind: "file", display_name: "q3.pdf", mimetype: "application/pdf; charset=utf-8" }],
		[{ kind: "file", display_name: "q3.pdf", mimetype: "*/*" }],
		[{ kind: "file", display_name: "q3.pdf", mimetype: "application" }],
		[{ kind: "file", display_name: "q3.pdf", mimetype: "https://files.slack.com/q3.pdf" }],
		[{ kind: "file", display_name: "q3.pdf", size_bytes: -1 }],
		[{ kind: "file", display_name: "q3.pdf", size_bytes: 1.5 }],
		[{ kind: "file", display_name: "q3.pdf", size_bytes: "91233" }],
		[{ kind: "file", display_name: "q3.pdf", filename: "" }],
		[{ kind: "file", display_name: "q3.pdf", filename: "a".repeat(513) }],
		[{ kind: "file", display_name: "q3.pdf", file_id: "F0AAAAAAAAA" }],
		[{ kind: "attachment", display_name: "q3.pdf" }],
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(response(items)), TypeError);
	// handle_index still has to index into the typed handles array, and the rule
	// moved next to the item interface — so prove it from a file item too.
	assert.throws(() => decodeCealLeasedConsumerCapabilityControlResponse(response([{ kind: "file", display_name: "q3.pdf", handle_index: 0 }])), TypeError);
});

test("the shared search filter vocabulary is the one place a filter's rule lives", async () => {
	const { CEAL_LEASED_CONSUMER_SEARCH_FILTERS, cealLeasedConsumerSearchArgumentsDecoder } = await import("../dist/index.js");
	// The vocabulary is the whole admissible set. `message.search`'s merge adds
	// its author filter and reply-coverage expansion HERE, as one row each.
	assert.deepEqual([...CEAL_LEASED_CONSUMER_SEARCH_FILTERS], ["query", "limit", "since", "until", "filetype", "author_ref", "include_replies"]);
	// A capability that names a filter this vocabulary does not own fails when
	// the package is imported, not on the first call that happens to use it.
	assert.throws(() => cealLeasedConsumerSearchArgumentsDecoder("ceal.test_arguments.v1", { optional: ["thread_ref"] as unknown as "query"[] }), TypeError);
	// Admission is per-capability: a filter the vocabulary owns is still refused
	// for a capability that did not declare it, which is what keeps one shared
	// table from becoming one shared grammar every capability must accept.
	const decode = cealLeasedConsumerSearchArgumentsDecoder("ceal.test_arguments.v1", { required: ["limit"], optional: ["since"] });
	decode({ schema_version: "ceal.test_arguments.v1", limit: 3, since: "2026-08-01T00:00:00Z" });
	for (const bad of [
		{ schema_version: "ceal.test_arguments.v1", limit: 3, query: "pdf" },
		{ schema_version: "ceal.test_arguments.v1", limit: 3, filetype: "pdf" },
		{ schema_version: "ceal.test_arguments.v1", limit: 3, until: "2026-08-02T00:00:00Z" },
		{ schema_version: "ceal.other_arguments.v1", limit: 3 },
		{ schema_version: "ceal.test_arguments.v1" },
	]) assert.throws(() => decode(bad), TypeError);
});
