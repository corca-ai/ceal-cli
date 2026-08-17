import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
	CealProtocolValidationError,
	decodeCealGatewayRequest,
	isCealPublicSafeText,
	redactCealPublicUnsafeText,
} from "../dist/index.js";
import { type JsonRecord } from "./protocol-test-support.ts";
import {
	announcementPolicy,
	attestedWriteContract,
	decodeClientResponse,
	discoveryResponse,
	envelope,
	firstAccess,
	firstTarget,
	hasCode,
	matureCapabilityAccess,
	readAnnouncementPolicy,
	responseEnvelope,
	writeAnnouncementPolicy,
} from "./wire-boundary-test-support.ts";

test("public safe-text policy redacts every credential, provider, opaque, and control class", () => {
	const unsafe = [
		["g", "hp_exampleCredential1234567890"].join(""),
		["ntn", "_exampleCredential1234567890"].join(""),
		["AI", "zaExampleGoogleCredential12"].join(""),
		["AK", "IAEXAMPLECREDENTIAL1"].join(""),
		["BEGIN ", "PRIVATE KEY"].join(""),
		"1AbCdEfGhIjKlMnOpQrStUvWxYz",
		"slack:C123456789",
		"line\nbreak",
	];
	for (const value of unsafe) {
		assert.equal(isCealPublicSafeText(value, 1024), false, value);
		const redacted = redactCealPublicUnsafeText(`safe ${value} tail`);
		assert.equal(isCealPublicSafeText(redacted, 1024), true, redacted);
		assert.equal(redacted.includes(value), false, value);
	}
});

test("Gateway request decoder accepts the four exact semantic operations", () => {
	const requests = [
		envelope("handshake", { client: { name: "ceal", version: "0.65.0" } }),
		envelope("discover", {}),
		envelope("discover", { capability_id: "message.search", match: "Team inbox", limit: 1 }),
		envelope("discover", { capability_ids: ["message.get", "message.search"], match: "Team inbox", limit: 1 }),
		envelope("discover", { capability_id: "message.search", cursor: "cursor:continuation_001" }),
		envelope("discover", { cursor: "cursor:bare-continuation_001" }),
		envelope("call", {
			capability_id: "message.search",
			target_ref: "target:workspace",
			arguments: { query: "quarterly plan", limit: 5 },
			purpose: "Find an approved workspace document",
		}),
		envelope("readback", { request_id: "request:call:001" }),
		envelope("readback", { write_request_ref: "gateway-write-request:123e4567-e89b-12d3-a456-426614174000" }),
	];

	for (const request of requests) assert.deepEqual(decodeCealGatewayRequest(request), request);
	assert.equal(decodeCealGatewayRequest({ ...requests[0], protocol_version: "2.0.0" }).protocol_version, "2.0.0");
});

test("Gateway request decoder rejects malformed, extra, unsafe, and authority-bearing input without echoing it", () => {
	const secret = ["xoxb", "secret", "material"].join("-");
	const invalid = [
		{ ...envelope("discover", {}), extra: true },
		envelope("discover", { unexpected: true }),
		envelope("discover", { match: "Team inbox" }),
		envelope("discover", { capability_id: "message.search", capability_ids: ["message.get"], match: "Team inbox" }),
		envelope("discover", { capability_ids: [], match: "Team inbox" }),
		envelope("discover", { capability_ids: ["message.get", "message.get"], match: "Team inbox" }),
		envelope("discover", { capability_ids: ["message.get", "bad capability"], match: "Team inbox" }),
		envelope("discover", { capability_id: "message.search", match: "Team inbox", cursor: "cursor:continuation_001" }),
		envelope("discover", { capability_id: "message.search", cursor: "not-a-cursor" }),
		envelope("discover", { capability_id: "message.search", limit: 65 }),
		envelope("discover", { capability_id: "message.search", match: "https://workspace.example.test/path?token=forbidden" }),
		envelope("handshake", { client: { name: "ceal", version: "0.65.0", token: secret } }),
		envelope("call", { capability_id: "message.search", target_ref: "slack:C123456789", arguments: {}, purpose: "Search" }),
		envelope("call", { capability_id: "message.search", target_ref: "target:test", arguments: { access_token: secret }, purpose: "Search" }),
		envelope("call", { capability_id: "message.search", target_ref: "target:test", arguments: { token: "opaque-gateway-secret" }, purpose: "Search" }),
		envelope("call", { capability_id: "message.search", target_ref: "target:test", arguments: { refresh_token: "opaque-refresh-secret" }, purpose: "Search" }),
		envelope("call", { capability_id: "message.search", target_ref: "target:test", arguments: { api_key: "opaque-api-secret" }, purpose: "Search" }),
		envelope("call", { capability_id: "message.search", target_ref: "target:test", arguments: { authToken: "opaque-auth-secret" }, purpose: "Search" }),
		envelope("call", { capability_id: "message.search", target_ref: "target:test", arguments: { nested: { policy_decision: "allowed" } }, purpose: "Search" }),
		envelope("readback", { request_id: "contains whitespace" }),
		envelope("readback", { write_request_ref: "gateway-write-request:not-a-uuid" }),
		{ ...envelope("discover", {}), protocol_version: "latest" },
		{ ...envelope("discover", {}), profile_ref: "profile with spaces" },
	];

	for (const request of invalid) {
		assert.throws(
			() => decodeCealGatewayRequest(request),
			(error) => error instanceof CealProtocolValidationError
				&& error.code === "invalid_gateway_request"
				&& !error.message.includes(secret),
		);
	}
	assert.throws(
		() => decodeCealGatewayRequest(envelope("call", {
			capability_id: "message.search",
			target_ref: "target:test",
			arguments: { value: "x".repeat(17 * 1024) },
			purpose: "Search",
		})),
		hasCode("invalid_gateway_request"),
	);
});

test("write receipt readback validates a bound, redacted receipt and rejects raw or inconsistent projections", () => {
	const writeRequestRef = "gateway-write-request:123e4567-e89b-12d3-a456-426614174000";
	const request = envelope("readback", { write_request_ref: writeRequestRef });
	const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
	const receipt = {
		schema_version: "ceal.gateway_write_request_receipt.v1",
		write_request_sha256: sha256(writeRequestRef),
		source_kind: "authenticated_registered_client",
		source_evidence_sha256: sha256("client-binding"),
		admission_context_sha256: sha256("admission"),
		idempotency_claim_sha256: sha256("idempotency"),
		normalized_mutation_sha256: sha256("mutation"),
		provider_state: "verified",
		provider_readback: "verified",
		provider_result_sha256: sha256("provider-result"),
	};
	const response = responseEnvelope(request, {
		ok: true,
		value: { schema_version: "ceal.gateway_write_receipt_readback.v1", receipt },
	});
	assert.deepEqual(decodeClientResponse(response, request), response);
	for (const mutate of [
		(value: JsonRecord) => { value.value.receipt.write_request_sha256 = sha256("different"); },
		(value: JsonRecord) => { value.value.receipt.write_request_ref = writeRequestRef; },
		(value: JsonRecord) => { value.value.receipt.provider_readback = "outcome_unknown"; },
		(value: JsonRecord) => { value.value.receipt.source_evidence_sha256 = "not-a-digest"; },
	]) {
		const invalid = structuredClone(response);
		mutate(invalid);
		assert.throws(() => decodeClientResponse(invalid, request), hasCode("invalid_client_response"));
	}
});

test("discovery target catalogs make bounded selection and continuation explicit", () => {
	const request = envelope("discover", { capability_id: "message.search", match: "Team", limit: 1 });
	const paged = discoveryResponse(request);
	paged.value.target_catalog = {
		target_count: 333,
		returned_count: 1,
		complete: false,
		next_cursor: "cursor:continuation_001",
	};
	paged.value.targets[0].connector_kind = "google-workspace";
	paged.value.targets[0].target_kind = "drive.folder";
	assert.deepEqual(decodeClientResponse(paged, request), paged);

	for (const mutate of [
		(value: JsonRecord) => { value.value.target_catalog.returned_count = 2; },
		(value: JsonRecord) => { value.value.target_catalog.complete = true; },
		(value: JsonRecord) => { value.value.target_catalog.next_cursor = "cursor:unsafe secret=material"; },
		(value: JsonRecord) => { value.value.targets[0].capability_ids = []; },
		(value: JsonRecord) => { value.value.targets[0].connector_kind = "provider:internal"; },
		(value: JsonRecord) => { value.value.targets[0].target_kind = "provider:scope"; },
	]) {
		const invalid = structuredClone(paged);
		mutate(invalid);
		assert.throws(() => decodeClientResponse(invalid, request), hasCode("invalid_client_response"));
	}
});

test("bare discovery exposes callable target rows and rejects malformed paging", () => {
	const request = envelope("discover", {});
	const bare = discoveryResponse(request);
	assert.deepEqual(decodeClientResponse(bare, request), bare);
	assert.deepEqual(bare.value.targets[0], {
		target_ref: "target:workspace", label: "Team inbox", connector_kind: "slack", target_kind: "conversation", access: "granted",
		capability_ids: ["message.search"], capability_access: [matureCapabilityAccess()],
	});
	const ungranted = structuredClone(bare);
	ungranted.value.targets[0].access = "ungranted";
	ungranted.value.targets[0].capability_ids = [];
	ungranted.value.targets[0].capability_access = [];
	assert.throws(() => decodeClientResponse(ungranted, request), hasCode("invalid_client_response"));
	for (const mutate of [
		(value: JsonRecord) => { value.value.target_catalog.unknown_catalog_field = true; },
		(value: JsonRecord) => { value.value.target_catalog.returned_count = 0; },
		(value: JsonRecord) => { value.value.target_catalog.complete = false; },
	]) {
		const invalid = structuredClone(bare);
		mutate(invalid);
		assert.throws(() => decodeClientResponse(invalid, request), hasCode("invalid_client_response"));
	}
	const continuationRequest = envelope("discover", { cursor: "cursor:bare-terminal" });
	const terminal = discoveryResponse(continuationRequest);
	terminal.value.target_catalog = { target_count: 65, returned_count: 1, complete: true };
	assert.deepEqual(decodeClientResponse(terminal, continuationRequest), terminal);
	const falseFirstPage = structuredClone(bare);
	falseFirstPage.value.target_catalog = { target_count: 65, returned_count: 1, complete: true };
	assert.throws(() => decodeClientResponse(falseFirstPage, request), hasCode("invalid_client_response"));
});

// corca-ai/ceal-cli#13: an empty complete page could not say whether a selector
// produced it, so it read as "no authorization here".
test("the selector disclosure is an optional boolean a Gateway may not fabricate", () => {
	const narrowedRequest = envelope("discover", { capability_id: "message.search", match: "Team" });
	const silent = discoveryResponse(narrowedRequest);
	assert.deepEqual(decodeClientResponse(silent, narrowedRequest), silent, "absence stays valid: an installed client keeps today's exact shape");

	const narrowed = discoveryResponse(narrowedRequest);
	narrowed.value.target_catalog.match_applied = true;
	assert.deepEqual(decodeClientResponse(narrowed, narrowedRequest), narrowed);

	for (const fabricated of [true, false]) {
		const continuation = envelope("discover", { capability_id: "message.search", cursor: "cursor:continuation_001" });
		const continued = discoveryResponse(continuation);
		continued.value.target_catalog.match_applied = fabricated;
		assert.deepEqual(decodeClientResponse(continued, continuation), continued, "a continuation reports its snapshot's selector, carrying no match of its own");
	}

	for (const value of ["true", 1, null, {}]) {
		const invalid = structuredClone(narrowed);
		invalid.value.target_catalog.match_applied = value;
		assert.throws(() => decodeClientResponse(invalid, narrowedRequest), hasCode("invalid_client_response"));
	}

	const unfilteredRequest = envelope("discover", { capability_id: "message.search" });
	const unfiltered = discoveryResponse(unfilteredRequest);
	unfiltered.value.target_catalog.match_applied = true;
	assert.throws(() => decodeClientResponse(unfiltered, unfilteredRequest), hasCode("invalid_client_response"),
		"a filter claimed for a request that carried no selector is a refused response, not guidance");
	unfiltered.value.target_catalog.match_applied = false;
	assert.deepEqual(decodeClientResponse(unfiltered, unfilteredRequest), unfiltered);
});

test("discovery retains provider-neutral capability navigation for a URL-refusal workflow", () => {
	const request = envelope("discover", { capability_id: "message.search" });
	const response = discoveryResponse(request);
	response.value.capabilities[0].navigation = {
		target_selector: "opaque_catalog_target", url_target_selector: "unsupported",
		required_argument_source: { argument: "message_ref", handle_kind: "message", issued_by: ["message.search", "resource.resolve"] },
	};
	assert.deepEqual(decodeClientResponse(response, request), response);
	for (const navigation of [
		{ ...response.value.capabilities[0].navigation, url_target_selector: "supported" },
		{ ...response.value.capabilities[0].navigation, required_argument_source: { argument: "unsafe argument", handle_kind: "message", issued_by: ["message.search"] } },
		{ ...response.value.capabilities[0].navigation, required_argument_source: { argument: "message_ref", handle_kind: "message", issued_by: [] } },
	]) {
		const invalid = structuredClone(response); invalid.value.capabilities[0].navigation = navigation;
		assert.throws(() => decodeClientResponse(invalid, request), hasCode("invalid_client_response"));
	}
});

test("multi-capability discovery rejects an unrequested capability or grant projection", () => {
	const request = envelope("discover", { capability_ids: ["message.search"], match: "Team" });
	const response = discoveryResponse(request);
	response.value.targets = [{
		...response.value.targets[0],
		capability_ids: ["message.search", "message.get"],
		capability_access: [
			...firstTarget(response).capability_access,
			{ ...matureCapabilityAccess(), capability_id: "message.get", grant_ref: "grant:workspace-message-get" },
		],
	}];
	response.value.capabilities.push({
		capability_id: "message.get",
		label: "Read one message",
		effect: "read",
		target_requirement: "required",
		input_contract: { schema_version: "ceal.message_get_input.v1", required: ["ref"], ref: { type: "string" } },
		evidence_requirement: "gateway_audit",
	});
	assert.throws(() => decodeClientResponse(response, request), hasCode("invalid_client_response"));
});

test("discovery accepts only the bounded negotiated rate-limit policy shape", () => {
	const request = envelope("discover", { capability_id: "message.search", match: "Team" });
	const response = discoveryResponse(request);
	firstAccess(response).rate_limit = {
		schema_version: "ceal.gateway_rate_limit_policy.v1",
		counted_unit: "governed_call",
		scope: "authenticated_principal",
		window_model: "rolling",
		max_calls: 3,
		window_ms: 60_000,
	};
	assert.deepEqual(decodeClientResponse(response, request), response);

	for (const mutate of [
		(value: JsonRecord) => { value.value.targets[0].capability_access[0].rate_limit.counted_unit = "returned_record"; },
		(value: JsonRecord) => { value.value.targets[0].capability_access[0].rate_limit.max_calls = 0; },
		(value: JsonRecord) => { value.value.targets[0].capability_access[0].rate_limit.window_ms = 24 * 60 * 60 * 1000 + 1; },
		(value: JsonRecord) => { value.value.targets[0].capability_access[0].rate_limit.remaining_calls = 1; },
	]) {
		const invalid = structuredClone(response);
		mutate(invalid);
		assert.throws(() => decodeClientResponse(invalid, request), hasCode("invalid_client_response"));
	}
});

test("discovery accepts an optional non-authorizing announcement policy and rejects leaks", () => {
	const request = envelope("discover", {});
	const response = discoveryResponse(request);
	response.value.capabilities[0].capability_id = "github.repository.get";
	response.value.targets = [];
	response.value.target_catalog = { target_count: 0, returned_count: 0, complete: true };
	response.value.capabilities[0].announcement_policy = announcementPolicy();
	assert.deepEqual(decodeClientResponse(response, request), response);

	// Legacy responses omit the negotiated field and remain exactly valid.
	const legacy = discoveryResponse(request);
	assert.deepEqual(decodeClientResponse(legacy, request), legacy);

	for (const mutate of [
		(value: JsonRecord) => { value.value.capabilities[0].announcement_policy.provider_application_authority.granted_permissions = ["metadata:read", "credential:read"]; },
		(value: JsonRecord) => { value.value.capabilities[0].announcement_policy.scope_statement = "target:private-resource"; },
		(value: JsonRecord) => { value.value.capabilities[0].announcement_policy.scope_statement_kind = "unknown_scope"; },
		(value: JsonRecord) => { value.value.capabilities[0].announcement_policy.non_claims = ["policy_projection_does_not_authorize", "policy_projection_does_not_authorize"]; },
		(value: JsonRecord) => { value.value.capabilities[0].announcement_policy.explicit_request_required = true; },
		(value: JsonRecord) => { value.value.capabilities[0].announcement_policy.provenance_requirement = "invented"; },
		(value: JsonRecord) => { value.value.capabilities[0].announcement_policy.grant_ref = "grant:leak"; },
	]) {
		const invalid = structuredClone(response);
		mutate(invalid);
		assert.throws(() => decodeClientResponse(invalid, request), hasCode("invalid_client_response"));
	}

	const write = discoveryResponse(request);
	write.value.capabilities[0] = { ...write.value.capabilities[0], effect: "write", write_contract: { side_effect_class: "append_reply", idempotency: "required", provider_readback: "required" }, announcement_policy: announcementPolicy() };
	assert.throws(() => decodeClientResponse(write, request), hasCode("invalid_client_response"));

	const attestedWrite = discoveryResponse(request);
	attestedWrite.value.targets = [];
	attestedWrite.value.target_catalog = { target_count: 0, returned_count: 0, complete: true };
	attestedWrite.value.capabilities[0] = {
		...attestedWrite.value.capabilities[0],
		capability_id: "sheets.values.update",
		effect: "write",
		write_contract: {
			side_effect_class: "append_reply", idempotency: "required", provider_readback: "required",
			attribution: "requester_event", provenance_binding: "gateway_attested_requester_event_v1",
		},
		announcement_policy: {
			...writeAnnouncementPolicy(),
			scope_statement_kind: "google_workspace_ceal_drive_or_direct_share_editable_sheet_ranges",
			scope_statement: "Bounded values updates in governed editable Google Sheets in the organization shared drive named Ceal Drive and directly shared files; Docs, Slides, and other Drive file mutation are not declared.",
			provider_application_authority: { kind: "google_service_account", requested_api_scopes: ["https://www.googleapis.com/auth/spreadsheets"] },
		},
	};
	assert.deepEqual(decodeClientResponse(attestedWrite, request), attestedWrite);
	for (const mutate of [
		(value: JsonRecord) => { value.value.capabilities[0].write_contract.idempotency = "optional"; },
		(value: JsonRecord) => { value.value.capabilities[0].write_contract.provider_readback = "best_effort"; },
		(value: JsonRecord) => { value.value.capabilities[0].write_contract.attribution = "subject"; },
		(value: JsonRecord) => { delete value.value.capabilities[0].write_contract.provenance_binding; },
	]) {
		const invalid = structuredClone(attestedWrite);
		mutate(invalid);
		assert.throws(() => decodeClientResponse(invalid, request), hasCode("invalid_client_response"));
	}

	const mismatchedCapability = discoveryResponse(request);
	mismatchedCapability.value.capabilities[0].announcement_policy = announcementPolicy();
	assert.throws(() => decodeClientResponse(mismatchedCapability, request), hasCode("invalid_client_response"));

});

test("announcement policy accepts each exact declared provider capability projection", () => {
	const request = envelope("discover", {});
	for (const { capabilityId, effect, writeContract, policy } of [
		{ capabilityId: "github.repository.get", effect: "read", writeContract: undefined, policy: announcementPolicy() },
		...(["collection.search", "github.issue.get", "github.pull_request.get", "github.workflow_run.get"].map((capabilityId) => ({ capabilityId, effect: "read", writeContract: undefined, policy: announcementPolicy() }))),
		...(["message.search", "message.get", "resource.resolve", "conversation.thread.get"].map((capabilityId) => ({ capabilityId, effect: "read", writeContract: undefined, policy: readAnnouncementPolicy("slack_public_app_member_channels_only", "Public channels where the installed Slack app is a member; private channels, direct messages, multi-person direct messages, and requester membership are not declared by this connector.", { kind: "slack_app", oauth_scope_observation: "not_exposed_by_current_connector" }) }))),
		...(["notion.search", "notion.page.get", "resource.resolve"].map((capabilityId) => ({ capabilityId, effect: "read", writeContract: undefined, policy: readAnnouncementPolicy("notion_connected_logical_area", "Connected Notion logical area under provider-enforced sharing; descendant inventory is not declared.", { kind: "notion_integration", sharing: "provider_enforced", descendant_inventory: "not_enumerable" }) }))),
		...(["calendar.availability", "calendar.event.search", "calendar.event.get"].map((capabilityId) => ({ capabilityId, effect: "read", writeContract: undefined, policy: readAnnouncementPolicy("google_workspace_calendar_read_only", "Approved Calendar availability and event reads only; Calendar mutation is not declared.", { kind: "google_service_account", requested_api_scopes: ["https://www.googleapis.com/auth/calendar.readonly"] }) }))),
		{ capabilityId: "file.search", effect: "read", writeContract: undefined, policy: readAnnouncementPolicy("google_workspace_ceal_drive_or_direct_share_metadata", "Metadata search for files in the organization shared drive named Ceal Drive and files directly shared with the provider application; file-content read and mutation are not declared.", { kind: "google_service_account", requested_api_scopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"] }) },
		{ capabilityId: "sheets.values.read", effect: "read", writeContract: undefined, policy: readAnnouncementPolicy("google_workspace_ceal_drive_or_direct_share_sheet_ranges", "Bounded values reads from governed Google Sheets in the organization shared drive named Ceal Drive and directly shared files; file mutation is not declared.", { kind: "google_service_account", requested_api_scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] }) },
		{ capabilityId: "sheets.values.update", effect: "write", writeContract: attestedWriteContract(), policy: { ...writeAnnouncementPolicy(), scope_statement_kind: "google_workspace_ceal_drive_or_direct_share_editable_sheet_ranges", scope_statement: "Bounded values updates in governed editable Google Sheets in the organization shared drive named Ceal Drive and directly shared files; Docs, Slides, and other Drive file mutation are not declared.", provider_application_authority: { kind: "google_service_account", requested_api_scopes: ["https://www.googleapis.com/auth/spreadsheets"] } } },
		{ capabilityId: "sheets.values.clear", effect: "write", writeContract: attestedWriteContract(), policy: { ...writeAnnouncementPolicy(), scope_statement_kind: "google_workspace_ceal_drive_or_direct_share_editable_sheet_clear_ranges", scope_statement: "Bounded values clears in governed editable Google Sheets in the organization shared drive named Ceal Drive and directly shared files; Docs, Slides, and other Drive file mutation are not declared.", provider_application_authority: { kind: "google_service_account", requested_api_scopes: ["https://www.googleapis.com/auth/spreadsheets"] } } },
	]) {
		const response = discoveryResponse(request);
		response.value.targets = [];
		response.value.target_catalog = { target_count: 0, returned_count: 0, complete: true };
		response.value.capabilities[0] = { ...response.value.capabilities[0], capability_id: capabilityId, effect, ...(writeContract ? { write_contract: writeContract } : {}), announcement_policy: policy };
		assert.deepEqual(decodeClientResponse(response, request), response);
	}
});

test("announcement policy binds an ambiguous capability ID to its exact provider authority", () => {
	const request = envelope("discover", {});
	const response = discoveryResponse(request);
	response.value.capabilities[0] = {
		...response.value.capabilities[0], capability_id: "resource.resolve", effect: "read",
		announcement_policy: readAnnouncementPolicy("slack_public_app_member_channels_only", "Public channels where the installed Slack app is a member; private channels, direct messages, multi-person direct messages, and requester membership are not declared by this connector.", { kind: "notion_integration", sharing: "provider_enforced", descendant_inventory: "not_enumerable" }),
	};
	assert.throws(() => decodeClientResponse(response, request), hasCode("invalid_client_response"));
});
