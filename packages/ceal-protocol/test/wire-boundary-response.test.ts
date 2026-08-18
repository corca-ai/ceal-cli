import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { required as requiredValue } from "../../../test/required.ts";
import {
	SAFE_JSON_MIN_BYTES_PER_NODE,
	safeJsonNodeBudgetForBytes,
} from "../dist/index.js";
import { type JsonRecord } from "./protocol-test-support.ts";
import {
	atPath,
	callResponse,
	decodedError,
	decodedValue,
	decodeClientResponse,
	discoveryResponse,
	discoveryWithWriteContract,
	envelope,
	firstAccess,
	firstTarget,
	handshakeResponse,
	hasCode,
	matureCapabilityAccess,
	policyDenialResponse,
	readbackResponse,
	RETAIN_SITE_AUTHORITY_KEYS,
	RETAIN_SITE_BENIGN_KEY,
	responseEnvelope,
	retainSiteMatrix,
	scopedIdentityProjection,
} from "./wire-boundary-test-support.ts";

test("client response decoder accepts exact operation-correlated Gateway results", () => {
	const callRequest = envelope("call", {
		capability_id: "message.search",
		target_ref: "target:workspace",
		arguments: { query: "quarterly plan", limit: 5 },
		purpose: "Search",
	});
	const handshakeRequest = envelope("handshake", { client: { name: "ceal", version: "0.65.0" } });
	const handshake = handshakeResponse(handshakeRequest);
	assert.deepEqual(decodeClientResponse(handshake, handshakeRequest), handshake);

	const discoverRequest = envelope("discover", {});
	const discovery = discoveryResponse(discoverRequest);
	assert.deepEqual(decodeClientResponse(discovery, discoverRequest), discovery);

	const call = callResponse(callRequest);
	assert.deepEqual(decodeClientResponse(call, callRequest), call);
	const liveCall = structuredClone(call);
	liveCall.value.non_claims = ["production_audit_not_reached"];
	assert.deepEqual(decodeClientResponse(liveCall, callRequest), liveCall);

	const emptyCall = callResponse(callRequest);
	emptyCall.value.data.result_count = 0;
	emptyCall.value.data.results = [];
	assert.deepEqual(decodeClientResponse(emptyCall, callRequest), emptyCall);

	const denial = policyDenialResponse(callRequest);
	assert.deepEqual(decodeClientResponse(denial, callRequest), denial);
});

test("client failure recoveries stay closed and strip additive recovery keys", () => {
	const handshakeRequest = envelope("handshake", { client: { name: "ceal", version: "0.65.0" } });
	const failure: JsonRecord = {
		ok: false,
		request_id: handshakeRequest.request_id,
		protocol_version: "1.3.0",
		proof_ref_or_unavailable: { state: "unavailable", reason: "Audit is pending", owner_surface: "Gateway audit" },
		error: { code: "incompatible_protocol", message: "The protocol is incompatible.", next_action: "Upgrade the client." },
	};
	assert.deepEqual(decodeClientResponse(failure, handshakeRequest), failure);

	const recoveredFailure = structuredClone(failure);
	recoveredFailure.error.recovery = { kind: "upgrade_client" };
	assert.deepEqual(decodeClientResponse(recoveredFailure, handshakeRequest), recoveredFailure);
	const retryFailure = structuredClone(failure);
	retryFailure.error.code = "rate_limited";
	retryFailure.error.recovery = { kind: "retry", retry_after_ms: 30_000 };
	assert.deepEqual(decodeClientResponse(retryFailure, handshakeRequest), retryFailure);
	for (const recovery of [
		{ kind: "reboot_universe" },
		{ kind: "retry", retry_after_ms: -1 },
		{ kind: "retry", retry_after_ms: 24 * 60 * 60 * 1000 },
		{ kind: "retry", retry_after_ms: 5.5 },
		"retry",
	]) {
		const invalidRecovery = structuredClone(failure);
		invalidRecovery.error.recovery = recovery;
		assert.throws(() => decodeClientResponse(invalidRecovery, handshakeRequest), hasCode("invalid_client_response"));
	}

	// #700: an additive non-authority key on a response object is removed, not
	// rejected. Removed rather than tolerated, so a consumer cannot read a field
	// this decoder never validated. The closed `kind` vocabulary above is
	// unaffected -- a new enum MEMBER is still breaking.
	const additiveRecovery = structuredClone(failure);
	additiveRecovery.error.recovery = { kind: "retry", retry_after_ms: 1000, note: "additive guidance" };
	assert.deepEqual(decodedError(additiveRecovery, handshakeRequest).recovery, { kind: "retry", retry_after_ms: 1000 });
});

test("client readback failures keep the provider-reach allowlist closed", () => {
	const callRequest = envelope("call", {
		capability_id: "message.search",
		target_ref: "target:workspace",
		arguments: { query: "quarterly plan", limit: 5 },
		purpose: "Search",
	});
	const readbackRequest = envelope("readback", { request_id: callRequest.request_id });
	const readback = readbackResponse(readbackRequest, callRequest.request_id);
	assert.deepEqual(decodeClientResponse(readback, readbackRequest), readback);
	const liveReadback = structuredClone(readback);
	liveReadback.value.events[0].non_claims = ["production_audit_not_reached"];
	assert.deepEqual(decodeClientResponse(liveReadback, readbackRequest), liveReadback);
	const ambiguousProviderFailure = structuredClone(readback);
	ambiguousProviderFailure.value.events[0].outcome = "failed";
	ambiguousProviderFailure.value.events[0].error_code = "connector_unavailable";
	ambiguousProviderFailure.value.events[0].non_claims = ["production_audit_not_reached"];
	delete ambiguousProviderFailure.value.events[0].call;
	assert.deepEqual(decodeClientResponse(ambiguousProviderFailure, readbackRequest), ambiguousProviderFailure);
	const wrongResourceKindFailure = structuredClone(ambiguousProviderFailure);
	wrongResourceKindFailure.value.events[0].error_code = "wrong_resource_kind";
	assert.deepEqual(decodeClientResponse(wrongResourceKindFailure, readbackRequest), wrongResourceKindFailure);
	wrongResourceKindFailure.value.events[0].non_claims.push("provider_execution_not_reached");
	assert.throws(() => decodeClientResponse(wrongResourceKindFailure, readbackRequest), hasCode("invalid_client_response"));
	// The provider-reach allowlist is closed, so a NEW client error code is
	// pre-provider by default. `duplicate_write_refused` (the append-class
	// cross-key duplicate guard) is refused before any connector data work, so
	// dropping the honest non-claim under it must stay a decode failure exactly
	// as it is for argument validation — this is the assertion that keeps the
	// code out of the reached allowlist rather than trusting the omission.
	for (const errorCode of ["invalid_arguments", "duplicate_write_refused"]) {
		const preProviderOmission = structuredClone(ambiguousProviderFailure);
		preProviderOmission.value.events[0].error_code = errorCode;
		assert.throws(() => decodeClientResponse(preProviderOmission, readbackRequest), hasCode("invalid_client_response"), errorCode);
		const preProviderHonest = structuredClone(preProviderOmission);
		preProviderHonest.value.events[0].non_claims = ["provider_execution_not_reached", "production_audit_not_reached"];
		assert.deepEqual(decodeClientResponse(preProviderHonest, readbackRequest), preProviderHonest, errorCode);
	}
	const preProviderFailure = structuredClone(ambiguousProviderFailure);
	preProviderFailure.value.events[0].error_code = "invalid_arguments";
	const preRouteInvalid = structuredClone(preProviderFailure);
	preRouteInvalid.value.events[0].policy_decision = "not_evaluated";
	delete preRouteInvalid.value.events[0].grant_snapshot;
	preRouteInvalid.value.events[0].non_claims = ["provider_execution_not_reached", "production_audit_not_reached"];
	assert.deepEqual(decodeClientResponse(preRouteInvalid, readbackRequest), preRouteInvalid);
	const forgedPreRouteGrant = structuredClone(preRouteInvalid);
	forgedPreRouteGrant.value.events[0].grant_snapshot = structuredClone(readback.value.events[0].grant_snapshot);
	assert.throws(() => decodeClientResponse(forgedPreRouteGrant, readbackRequest), hasCode("invalid_client_response"));
	const routedConnectorFailure = structuredClone(ambiguousProviderFailure);
	routedConnectorFailure.value.events[0].policy_decision = "not_evaluated";
	delete routedConnectorFailure.value.events[0].grant_snapshot;
	routedConnectorFailure.value.events[0].non_claims = ["provider_execution_not_reached", "production_audit_not_reached"];
	routedConnectorFailure.value.events[0].connector_route_failure = {
		schema_version: "ceal.gateway_connector_route_failure.v1",
		connector_kind: "google-workspace",
		phase: "scope_observation",
	};
	assert.deepEqual(decodeClientResponse(routedConnectorFailure, readbackRequest), routedConnectorFailure);
	const spoofedProviderReach = structuredClone(routedConnectorFailure);
	spoofedProviderReach.value.events[0].non_claims = ["production_audit_not_reached"];
	assert.throws(() => decodeClientResponse(spoofedProviderReach, readbackRequest), hasCode("invalid_client_response"));
	const unsafeConnectorKind = structuredClone(routedConnectorFailure);
	unsafeConnectorKind.value.events[0].connector_route_failure.connector_kind = "Notion credential";
	assert.throws(() => decodeClientResponse(unsafeConnectorKind, readbackRequest), hasCode("invalid_client_response"));
	// A throttled scope read is audited under the retryable code and may carry
	// a bounded cause; an unlisted or zero-information cause stays fail-closed.
	const throttledConnectorFailure = structuredClone(routedConnectorFailure);
	throttledConnectorFailure.value.events[0].error_code = "rate_limited";
	throttledConnectorFailure.value.events[0].connector_route_failure.cause = "provider_throttled";
	assert.deepEqual(decodeClientResponse(throttledConnectorFailure, readbackRequest), throttledConnectorFailure);
	for (const cause of ["operator_asleep", "unknown"]) {
		const rejectedCause = structuredClone(throttledConnectorFailure);
		rejectedCause.value.events[0].connector_route_failure.cause = cause;
		assert.throws(() => decodeClientResponse(rejectedCause, readbackRequest), hasCode("invalid_client_response"));
	}
	const unavailableResourceFailure = structuredClone(ambiguousProviderFailure);
	unavailableResourceFailure.value.events[0].error_code = "resource_not_available";
	assert.throws(() => decodeClientResponse(unavailableResourceFailure, readbackRequest), hasCode("invalid_client_response"));
});

test("handshake decoder tolerates the optional negotiated eligible-Profile catalog without weakening the unchanged shape", () => {
	const handshakeRequest = envelope("handshake", { client: { name: "ceal", version: "0.65.0" } });

	// Unchanged shape (field absent, e.g. non-negotiating client / older Gateway)
	// must still decode as before.
	const absent = handshakeResponse(handshakeRequest);
	assert.deepEqual(decodeClientResponse(absent, handshakeRequest), absent);

	// A refs-only catalog is accepted and round-trips unchanged.
	const negotiated = structuredClone(absent);
	negotiated.value.eligible_profiles = [
		{ profile_ref: "profile:ax-team", membership_ref: "membership:local-alice-ax" },
		{ profile_ref: handshakeRequest.profile_ref, membership_ref: "membership:test-work" },
	];
	assert.deepEqual(decodeClientResponse(negotiated, handshakeRequest), negotiated);

	// An empty catalog (subject with no other eligible Profile) is tolerated.
	const empty = structuredClone(absent);
	empty.value.eligible_profiles = [];
	assert.deepEqual(decodeClientResponse(empty, handshakeRequest), empty);

	// A malformed catalog is rejected without echoing the payload.
	for (const eligible of [
		"profile:ax-team",
		[{ profile_ref: "profile:ax-team" }],
		[{ profile_ref: "profile:ax-team", membership_ref: "membership:x", extra: "leak" }],
		[{ profile_ref: 42, membership_ref: "membership:x" }],
		[{ profile_ref: "profile:ax-team", membership_ref: "not a safe ref!" }],
	]) {
		const malformed = structuredClone(absent);
		malformed.value.eligible_profiles = eligible;
		assert.throws(() => decodeClientResponse(malformed, handshakeRequest), hasCode("invalid_client_response"));
	}
});

test("handshake decoder exact-validates the freshness-bound scoped identity projection", () => {
	const request = envelope("handshake", { client: { name: "ceal", version: "0.77.0" } });
	const response = handshakeResponse(request);
	response.value.identity_projection = scopedIdentityProjection(response.value);
	assert.deepEqual(decodeClientResponse(response, request), response);

	for (const mutate of [
		(value: JsonRecord) => { value.profile_ref = "profile:other"; },
		(value: JsonRecord) => { value.instance_ref = "instance:other"; },
		(value: JsonRecord) => { value.graph_revision = "not-a-digest"; },
		(value: JsonRecord) => { value.expires_at = "2026-08-12T00:20:00.000Z"; },
		(value: JsonRecord) => { value.people[0].actor_kind = "bot"; },
		(value: JsonRecord) => { value.people[0].providers = ["slack", "github"]; },
		(value: JsonRecord) => { value.people = [
			{ subject_ref: "subject:z", display_name: "Zed", actor_kind: "human", providers: ["slack"] },
			{ subject_ref: "subject:a", display_name: "Alice", actor_kind: "human", providers: ["slack"] },
		]; },
		(value: JsonRecord) => { value.people = Array.from({ length: 129 }, (_, index) => ({
			subject_ref: `subject:${index}`, display_name: `Person ${String(index).padStart(3, "0")}`,
			actor_kind: "human", providers: ["slack"],
		})); },
		(value: JsonRecord) => { value.people[0].provider_account_id = "U_PRIVATE"; },
	]) {
		const malformed = structuredClone(response);
		mutate(malformed.value.identity_projection);
		assert.throws(() => decodeClientResponse(malformed, request), hasCode("invalid_client_response"));
	}
});

test("public capability evidence exposes policy and readiness without private backend or credential vocabulary", () => {
	const discoveryRequest = envelope("discover", {});
	const callRequest = envelope("call", {
		capability_id: "message.search",
		target_ref: "target:workspace",
		arguments: { query: "quarterly plan", limit: 5 },
		purpose: "Find approved planning context",
	});
	const readbackRequest = envelope("readback", { request_id: callRequest.request_id });
	const rendered = JSON.stringify([
		discoveryResponse(discoveryRequest),
		callResponse(callRequest),
		readbackResponse(readbackRequest, callRequest.request_id),
	]);
	assert.match(rendered, /grant:workspace-message-search/u);
	assert.match(rendered, /authoritative_index/u);
	assert.doesNotMatch(rendered, /capability_backend|credential_identity|delegated|mature_search|degraded_fallback|\bbot\b|provider_search|recent_channel_history|provider_ranked|provider_truncated/u);
});

test("public discovery, call, and audit envelopes admit provider-neutral capability extensions", () => {
	const discoveryRequest = envelope("discover", { capability_id: "message.search" });
	const discovery = discoveryResponse(discoveryRequest);
	discovery.value.capabilities.push({
		capability_id: "file.search", label: "Search files", effect: "read", target_requirement: "required",
		input_contract: { schema_version: "ceal.file_search_input.v1", required: ["query"] },
		evidence_requirement: "gateway_audit",
	});
	firstTarget(discovery).capability_ids.push("file.search");
	firstTarget(discovery).capability_access.push({
		...matureCapabilityAccess(), capability_id: "file.search", grant_ref: "grant:workspace-file-search",
	});
	assert.equal(decodedValue<{ capabilities: unknown[] }>(discovery, discoveryRequest).capabilities.length, 2);

	const callRequest = envelope("call", {
		capability_id: "file.search", target_ref: "target:workspace", arguments: { query: "roadmap" }, purpose: "Find approved files",
	});
	const call = responseEnvelope(callRequest, { ok: true, value: {
		schema_version: "ceal.gateway_call_result.v1", capability_id: "file.search",
		grant_ref: "grant:workspace-file-search", grant_revision: 1, target_ref: "target:workspace",
		data: { schema_version: "ceal.file_search_result.v1", results: [{ ref: "file:roadmap", label: "Roadmap" }] },
		redaction: { state: "applied", omitted_classes: ["raw_provider_ids"] },
		host_decision: "accepted", proof_level: "host_decision", non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	} });
	assert.equal(decodedValue<{ capability_id: string }>(call, callRequest).capability_id, "file.search");

	const readbackRequest = envelope("readback", { request_id: callRequest.request_id });
	const readback = readbackResponse(readbackRequest, callRequest.request_id);
	readback.value.events[0].grant_snapshot = {
		schema_version: "ceal.gateway_authorization_snapshot.v1", capability_id: "file.search",
		grant_ref: "grant:workspace-file-search", grant_revision: 1, target_ref: "target:workspace",
	};
	readback.value.events[0].call = {
		schema_version: "ceal.gateway_audit_call_detail.v1", capability_id: "file.search",
		grant_ref: "grant:workspace-file-search", grant_revision: 1, target_ref: "target:workspace",
		input_summary: { field_count: 1 }, output_summary: { result_count: 1 },
	};
	assert.equal(decodedValue<{ events: Array<{ call: { capability_id: string } }> }>(readback, readbackRequest).events[0]?.call.capability_id, "file.search");
});

test("legacy message fixtures remain safe generic result envelopes", () => {
	const request = envelope("call", {
		capability_id: "message.get", target_ref: "target:workspace",
		arguments: { ref: "message:approved_001", offset: 0, limit_bytes: 4096 }, purpose: "Read an approved message",
	});
	const response = responseEnvelope(request, { ok: true, value: {
		schema_version: "ceal.gateway_call_result.v1", capability_id: "message.get",
		grant_ref: "grant:workspace-message-get", grant_revision: 2, target_ref: "target:workspace",
		data: {
			schema_version: "ceal.message_get_result.v1", ref: "message:approved_001", source_label: "Team inbox",
			source: { provider: "slack", url: "https://workspace.slack.com/archives/C0123456789/p1720000000000100" },
			text: "Approved source text may contain slack:C0123456789 without becoming audit data.", offset: 0,
		},
		redaction: { state: "applied", omitted_classes: ["credential_material"] },
		host_decision: "accepted", proof_level: "host_decision", non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	} });
	assert.deepEqual(decodeClientResponse(response, request), response);

	const arbitraryLeak = structuredClone(response);
	arbitraryLeak.value.data.extra = ["xoxb", "not-authorized-outside-message-text"].join("-");
	assert.throws(() => decodeClientResponse(arbitraryLeak, request), hasCode("invalid_client_response"));
	const unsafeSource = structuredClone(response);
	unsafeSource.value.data.source.url += "?token=forbidden";
	assert.throws(() => decodeClientResponse(unsafeSource, request), hasCode("invalid_client_response"));
});

test("compact message source_url cells use the same safe HTTPS boundary as source citations", () => {
	const request = envelope("call", {
		capability_id: "message.search", target_ref: "target:workspace",
		arguments: { query: "approved", fields: "ref,source_url" }, purpose: "Find approved messages",
	});
	const response = responseEnvelope(request, { ok: true, value: {
		schema_version: "ceal.gateway_call_result.v1", capability_id: "message.search",
		grant_ref: "grant:workspace-message-search", grant_revision: 2, target_ref: "target:workspace",
		data: {
			schema_version: "ceal.message_search_result.v2", fields: ["ref", "source_url"],
			rows: [["message:approved_001", "https://workspace.slack.com/archives/C0123456789/p1720000000000100"]],
		},
		redaction: { state: "applied", omitted_classes: ["raw_messages"] },
		host_decision: "accepted", proof_level: "host_decision", non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	} });
	assert.deepEqual(decodeClientResponse(response, request), response);
	const unsafe = structuredClone(response);
	unsafe.value.data.rows[0][1] += "?token=forbidden";
	assert.throws(() => decodeClientResponse(unsafe, request), hasCode("invalid_client_response"));
});

test("legacy link fixtures accept only safe URL transport while leaving resource shape to the Gateway", () => {
	const sourceUrl = "https://workspace.slack.com/archives/C0123456789/p1720000000000100";
	const url = `${sourceUrl}?thread_ts=1720000000.000100&channel=C0123456789&message_ts=1720000000.000100`;
	const request = envelope("call", {
		capability_id: "resource.resolve", target_ref: "target:workspace", arguments: { url }, purpose: "Read the linked approved message",
	});
	const response = responseEnvelope(request, { ok: true, value: {
		schema_version: "ceal.gateway_call_result.v1", capability_id: "resource.resolve",
		grant_ref: "grant:workspace-resource-resolve", grant_revision: 2, target_ref: "target:workspace",
		data: { schema_version: "ceal.resource_resolve_result.v1", resource: {
			ref: "message:approved_001", kind: "message", source: { provider: "slack", url: sourceUrl },
		} },
		redaction: { state: "applied", omitted_classes: ["credential_material"] },
		host_decision: "accepted", proof_level: "host_decision", non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	} });
	assert.deepEqual(decodeClientResponse(response, request), response);
	for (const mutate of [
		(value: JsonRecord) => { value.value.data.resource.source.url += "?token=forbidden"; },
		(value: JsonRecord) => { value.value.data.resource.ref = "slack:C0123456789"; },
	]) {
		const malformed = structuredClone(response);
		mutate(malformed);
		assert.throws(() => decodeClientResponse(malformed, request), hasCode("invalid_client_response"));
	}
	const connectorNativeKind = structuredClone(response);
	connectorNativeKind.value.data.resource.kind = "thread";
	assert.deepEqual(decodeClientResponse(connectorNativeKind, request), connectorNativeKind);
	// A non-slack connector kind plus a bounded integer sub-resource address
	// (github issue) decodes additively — the resource shape is left to the Gateway.
	const subResource = structuredClone(response);
	subResource.value.data.resource = {
		ref: "target:github-repository:183f6a7c0b67550c47076237", kind: "issue",
		source: { provider: "github", url: "https://github.com/octocat/hello-world/issues/42" }, address: { number: 42 },
	};
	assert.deepEqual(decodeClientResponse(subResource, request), subResource);
});

test("legacy write fixtures keep only generic write-boundary validation in the public protocol", () => {
	const request = envelope("call", {
		capability_id: "message.create", target_ref: "target:workspace",
		arguments: { reply_to: "message:approved_001", text: "Acknowledged.", idempotency_key: "reply-001" },
		purpose: "Reply to the approved message",
	});
	const response = responseEnvelope(request, { ok: true, value: {
		schema_version: "ceal.gateway_call_result.v1", capability_id: "message.create",
		grant_ref: "grant:workspace-message-create", grant_revision: 2, target_ref: "target:workspace",
		data: {
			schema_version: "ceal.message_create_result.v1", delivery: "verified",
			message_ref: "message:created_001", reply_to: "message:approved_001", text: "Provider-confirmed reply",
		},
		redaction: { state: "applied", omitted_classes: ["message_text", "idempotency_key", "provider_locator", "provider_identity"] },
		host_decision: "accepted", proof_level: "host_decision", non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	} });
	assert.deepEqual(decodeClientResponse(response, request), response);
	const discoverRequest = envelope("discover", { capability_id: "message.search" });
	const discovery = discoveryResponse(discoverRequest);
	discovery.value.capabilities.push({
		capability_id: "message.create", label: "Send or reply with one governed message", effect: "write", target_requirement: "required",
		input_contract: {
			schema_version: "ceal.message_create_input.v1", required: ["text", "idempotency_key"],
			reply_to: { type: "string", format: "message_ref" },
			text: { type: "string", min_bytes: 1, max_bytes: 8192 },
			idempotency_key: { type: "string", format: "safe_idempotency_key", min_bytes: 1, max_bytes: 128 },
		},
		evidence_requirement: "gateway_audit",
		write_contract: {
			side_effect_class: "append_message", idempotency: "required", dry_run: "unsupported",
			attribution: "subject", compensation: "irreversible", provider_readback: "required",
		},
	});
	firstTarget(discovery).capability_ids.push("message.create");
	firstTarget(discovery).capability_access.push({
		...matureCapabilityAccess(), capability_id: "message.create", grant_ref: "grant:workspace-message-create",
	});
	assert.equal(decodedValue<{ capabilities: Array<{ write_contract?: { idempotency?: string } }> }>(discovery, discoverRequest).capabilities.at(-1)?.write_contract?.idempotency, "required");
	delete discovery.value.capabilities.at(-1).write_contract;
	assert.throws(() => decodeClientResponse(discovery, discoverRequest), hasCode("invalid_client_response"));
});

// `compensation` and `dry_run` crossed this boundary carried only by the write
// contract's index signature: no type, no member check, no grammar. They are
// split here on ownership rather than on taste — a connector names its own undo
// mechanism, while a caller BRANCHES on whether it may preview a mutation, and a
// value it cannot interpret is worse than a refusal.
test("the write contract closes the Gateway-guaranteed vocabularies and leaves the connector-owned ones open", () => {
	const accepted = [
		{ dry_run: "unsupported" },
		{ dry_run: "supported" },
		{ compensation: "irreversible" },
		{ compensation: "replace_with_new_text" },
		{ compensation: "overwrite_not_reversible" },
		{ compensation: "a_mechanism_no_connector_has_declared_yet" },
		{ attribution: "subject" },
		{ attribution: "connector_integration" },
		{ attribution: "requester_event", provenance_binding: "gateway_attested_requester_event_v1" },
	];
	for (const overrides of accepted) {
		const { request, response } = discoveryWithWriteContract(overrides);
		assert.deepEqual(decodedValue<{ capabilities: Array<{ write_contract?: unknown }> }>(response, request).capabilities.at(-1)?.write_contract, {
			side_effect_class: "append_message", idempotency: "required", provider_readback: "required", ...overrides,
		});
	}
	const refused = [
		{ dry_run: "provider_simulated" },
		{ dry_run: true },
		{ attribution: "installed_app" },
		{ idempotency: "recommended" },
		{ provider_readback: "eventual" },
		{ provenance_binding: "gateway_attested_requester_event_v2", attribution: "requester_event" },
		// A provenance binding attests a requester EVENT; there is none to attest
		// on a subject- or connector-attributed mutation.
		{ provenance_binding: "gateway_attested_requester_event_v1", attribution: "subject" },
		{ provenance_binding: "gateway_attested_requester_event_v1" },
		// Open does not mean unvalidated: both connector-owned fields keep the
		// safe-ref grammar, which also refuses raw provider and secret material.
		{ compensation: "reverse via https://example.test/undo" },
		{ compensation: 3 },
		{ side_effect_class: "append message" },
	];
	for (const overrides of refused) {
		const { request, response } = discoveryWithWriteContract(overrides);
		assert.throws(() => decodeClientResponse(response, request), hasCode("invalid_client_response"), JSON.stringify(overrides));
	}
});

test("legacy search fixtures use the generic response envelope", () => {
	const request = envelope("call", {
		capability_id: "message.search", target_ref: "target:workspace", arguments: { query: "launch" }, purpose: "Find approved messages",
	});
	const response = responseEnvelope(request, { ok: true, value: {
		schema_version: "ceal.gateway_call_result.v1", capability_id: "message.search",
		grant_ref: "grant:workspace-message-search", grant_revision: 2, target_ref: "target:workspace",
		data: {
			schema_version: "ceal.message_search_result.v1", query: { redacted: true, utf8_bytes: 6, empty: false },
			offset: 0, result_count: 1, results: [{
				ref: "message:approved_001", target_ref: "target:workspace", created_at: "2026-07-15T00:00:00.000Z",
				source_label: "Team inbox", text_preview: "Approved launch note.",
				source: { provider: "slack", url: "https://workspace.slack.com/archives/C0123456789/p1720000000000100" },
			}],
			coverage: { schema_version: "ceal.message_search_coverage.v1", source: "bounded_projection", match_semantics: "token_and_case_insensitive", reply_coverage: "included", completeness: "incomplete", truncated: false },
			minimization: { raw_provider_ids_included: true, raw_messages_included: false, credential_material_included: false },
		},
		redaction: { state: "applied", omitted_classes: ["query_text", "raw_messages"] },
		host_decision: "accepted", proof_level: "host_decision", non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
	} });
	assert.deepEqual(decodeClientResponse(response, request), response);
	const falseMinimization = structuredClone(response);
	falseMinimization.value.data.minimization.raw_provider_ids_included = false;
	assert.deepEqual(decodeClientResponse(falseMinimization, request), falseMinimization);
});

test("discovery admits an authenticated Profile with no active grants", () => {
	const request = envelope("discover", {});
	const discovery = discoveryResponse(request);
	discovery.value.capabilities = [];
	discovery.value.targets = [];
	discovery.value.target_catalog = { target_count: 0, returned_count: 0, complete: true };
	assert.deepEqual(decodeClientResponse(discovery, request), discovery);
});

test("discovery decoder rejects drift, authority promotion, and target visibility ambiguity", () => {
	const request = envelope("discover", { capability_id: "message.search" });
	const exact = discoveryResponse(request);
	const cases = [];

	const wrongProfile = structuredClone(exact);
	wrongProfile.value.profile_ref = "profile:other";
	cases.push(wrongProfile);

	const duplicateTarget = structuredClone(exact);
	duplicateTarget.value.targets.push(structuredClone(requiredValue(duplicateTarget.value.targets[0], "duplicate_target")));
	cases.push(duplicateTarget);

	const rawTarget = structuredClone(exact);
	requiredValue(rawTarget.value.targets[0], "raw_target").target_ref = "slack:C123456789";
	cases.push(rawTarget);

	const missingAccess = structuredClone(exact);
	delete requiredValue(missingAccess.value.targets[0], "missing_access_target").capability_access;
	cases.push(missingAccess);

	const contradictoryAccess = structuredClone(exact);
	firstAccess(contradictoryAccess).readiness = "broken";
	cases.push(contradictoryAccess);

	const authorityPromotion = structuredClone(exact);
		authorityPromotion.value.registration_ref = "registration:test";
	cases.push(authorityPromotion);

	for (const value of cases) {
		assert.throws(() => decodeClientResponse(value, request), hasCode("invalid_client_response"));
	}
});

test("call decoder rejects envelope mismatch and unsafe material while leaving capability semantics to the Gateway", () => {
	const callRequest = envelope("call", {
		capability_id: "message.search",
		target_ref: "target:workspace",
		arguments: { query: "quarterly plan" },
		purpose: "Search",
	});
	const exact = callResponse(callRequest);
	const cases = [
		{ ...exact, request_id: "request:other" },
		{ ...exact, protocol_version: "2.0.0" },
		{ ...exact, proof_ref_or_unavailable: { state: "unavailable", reason: "pending", owner_surface: "Gateway audit" } },
	];

	const wrongCapability = structuredClone(exact);
	wrongCapability.value.capability_id = "message.read";
	cases.push(wrongCapability);

	const wrongTarget = structuredClone(exact);
	wrongTarget.value.target_ref = "target:other";
	cases.push(wrongTarget);

	const apiSecret = structuredClone(exact);
	apiSecret.value.data.results[0].text_preview = "credential sk-proj-abcdefghijklmnop";
	cases.push(apiSecret);

	const oversizedPreview = structuredClone(exact);
	oversizedPreview.value.data.results[0].text_preview = "x".repeat(1025);
	cases.push(oversizedPreview);

	const unsafeCredentialClaim = structuredClone(exact);
	unsafeCredentialClaim.value.data.minimization.credential_material_included = true;
	cases.push(unsafeCredentialClaim);

	const rawCoverageScope = structuredClone(exact);
	rawCoverageScope.value.data.coverage.provider_channel_id = "C123456789";
	cases.push(rawCoverageScope);

	const authorityPromotion = structuredClone(exact);
	authorityPromotion.value.policy_ref = "policy:test";
	cases.push(authorityPromotion);

	// Reproduced by the ceal-cli consumer against the built 0.72.14 decoder: the
	// authority-shaped suffix matcher anchored at `$`, so an authority noun
	// carrying its own generation counter fell through and was STRIPPED as
	// ordinary guidance. A grant does not stop naming authority because a
	// revision number follows it.
	// Placed on the ENVELOPE, which declares only ok/proof/protocol/request/value:
	// `grant_revision` is a DECLARED key of the call response value and is
	// retained there by contract, so asserting it inside `value` would have
	// tested the wrong surface.
	for (const versionedAuthorityKey of ["grant_revision", "policy_version", "scope_revision", "credential_version", "role_id", "permissions_generation"]) {
		const versionedAuthority = structuredClone(exact);
		versionedAuthority[versionedAuthorityKey] = 99;
		cases.push(versionedAuthority);
	}

	for (const [index, value] of cases.entries()) {
		assert.throws(() => decodeClientResponse(value, callRequest), hasCode("invalid_client_response"), `case ${index}`);
	}

	// #700 on the success envelope: a benign additive top-level key is removed,
	// while `policy_ref` above proves an authority-shaped one is still refused.
	// The two together are the whole boundary -- guidance is additive, authority
	// is a release event.
	const additiveEnvelope = { ...exact, gateway_hint: "additive guidance" };
	assert.equal(Object.hasOwn(decodeClientResponse(additiveEnvelope, callRequest), "gateway_hint"), false);

	const malformedInputRequest = structuredClone(callRequest);
	malformedInputRequest.body.arguments.extra = true;
	assert.deepEqual(
		decodeClientResponse(callResponse(malformedInputRequest), malformedInputRequest),
		callResponse(malformedInputRequest),
	);
});

test("policy denial decoder requires exact stable caller-safe policy evidence", () => {
	const request = envelope("call", {
		capability_id: "message.search",
		target_ref: "target:customer-health",
		arguments: { query: "health" },
		purpose: "Search",
	});
	const exact = policyDenialResponse(request);
	const cases = [];

	const changedMessage = structuredClone(exact);
	changedMessage.error.message = "Denied by policy details.";
	cases.push(changedMessage);

	const changedAction = structuredClone(exact);
	changedAction.error.next_action = "Retry now.";
	cases.push(changedAction);

	const mismatchedTarget = structuredClone(exact);
	mismatchedTarget.error.decision.target_ref = "target:other";
	cases.push(mismatchedTarget);

	const missingProof = structuredClone(exact);
	delete missingProof.proof_ref_or_unavailable;
	cases.push(missingProof);

	const policyRefLeak = structuredClone(exact);
	policyRefLeak.error.decision.policy_ref = "policy:private";
	cases.push(policyRefLeak);

	for (const value of cases) {
		assert.throws(() => decodeClientResponse(value, request), hasCode("invalid_client_response"));
	}

	const discoverRequest = envelope("discover", {});
	const crossOperation = { ...exact, request_id: discoverRequest.request_id };
	assert.throws(() => decodeClientResponse(crossOperation, discoverRequest), hasCode("invalid_client_response"));
});

test("client response decoder rejects malformed envelopes and audit proof drift", () => {
	const callRequest = envelope("call", {
		capability_id: "message.search",
		target_ref: "target:workspace",
		arguments: { query: "quarterly plan" },
		purpose: "Search",
	});
	const exact = callResponse(callRequest);
	for (const value of [
		{ ok: false, request_id: exact.request_id, protocol_version: "1.3.0", error: { code: "bad-code", message: "No." } },
		{ ok: false, request_id: exact.request_id, protocol_version: "1.3.0", error: { code: "denied", message: "No.", next_action: "Retry.", policy_decision: "Leak." } },
	]) assert.throws(() => decodeClientResponse(value, callRequest), hasCode("invalid_client_response"));

	// The benign sibling of that authority-shaped key is removed instead, so the
	// undeclared field cannot reach a consumer either way.
	const additiveError = { ok: false, request_id: exact.request_id, protocol_version: "1.3.0", error: { code: "denied", message: "No.", next_action: "Retry.", another_action: "guidance" } };
	assert.deepEqual(decodedError(additiveError, callRequest), { code: "denied", message: "No.", next_action: "Retry." });

	const handshakeRequest = envelope("handshake", { client: { name: "ceal", version: "0.65.0" } });
	const handshake = handshakeResponse(handshakeRequest);
	for (const value of [
		{ ...handshake, proof_ref_or_unavailable: undefined },
		{ ...handshake, value: { host_decision: "accepted" } },
		{ ...handshake, value: { ...handshake.value, profile_ref: "profile:other" } },
		{ ...handshake, value: { ...handshake.value, non_claims: ["production_audit_not_reached", "provider_execution_not_reached"] } },
	]) assert.throws(() => decodeClientResponse(value, handshakeRequest), hasCode("invalid_client_response"));

	const readbackRequest = envelope("readback", { request_id: callRequest.request_id });
	const readback = readbackResponse(readbackRequest, callRequest.request_id);
	for (const value of [
		{ ...readback, value: { ...readback.value, events: [] } },
		{ ...readback, value: { ...readback.value, request_id: "request:other" } },
		{ ...readback, value: { ...readback.value, events: [{ ...readback.value.events[0], error_code: "denied" }] } },
	]) assert.throws(() => decodeClientResponse(value, readbackRequest), hasCode("invalid_client_response"));

	const missingCallDetail = structuredClone(readback);
	delete missingCallDetail.value.events[0].call;
	assert.throws(() => decodeClientResponse(missingCallDetail, readbackRequest), hasCode("invalid_client_response"));

	const rawQueryLeak = structuredClone(readback);
	rawQueryLeak.value.events[0].call.query = "quarterly plan";
	assert.throws(() => decodeClientResponse(rawQueryLeak, readbackRequest), hasCode("invalid_client_response"));

	for (const decision of [
		{ auth_decision: "denied", policy_decision: "allowed", outcome: "succeeded", error_code: null },
		{ auth_decision: "allowed", policy_decision: "denied", outcome: "succeeded", error_code: null },
		{ auth_decision: "denied", policy_decision: "allowed", outcome: "failed", error_code: "internal_error" },
	]) {
		const contradictory = structuredClone(readback);
		Object.assign(contradictory.value.events[0], decision);
		assert.throws(() => decodeClientResponse(contradictory, readbackRequest), hasCode("invalid_client_response"));
	}

	const authenticationDenial = structuredClone(readback);
	Object.assign(authenticationDenial.value.events[0], {
		auth_decision: "denied",
		policy_decision: "not_evaluated",
		outcome: "denied",
		error_code: "authentication_failed",
	});
	delete authenticationDenial.value.events[0].call;
	delete authenticationDenial.value.events[0].grant_snapshot;
	assert.deepEqual(decodeClientResponse(authenticationDenial, readbackRequest), authenticationDenial);
});

test("a discovery response whose catalog exceeds 512 JSON nodes still decodes inside the byte cap (2026-08-05 live incident)", () => {
	const request = envelope("discover", {});
	request.request_id = "request:node-budget:d";
	request.profile_ref = "profile:work";
	const capabilities = Array.from({ length: 40 }, (_, index) => ({
		capability_id: `probe.capability.${index}`,
		label: `Probe capability ${index}`,
		effect: "read",
		target_requirement: "required",
		evidence_requirement: "provider_readback",
		input_contract: { schema_version: `ceal.probe_input_${index}.v1`, required: ["query"], query: { type: "string", max_bytes: 512 } },
	}));
	const value = {
		schema_version: "ceal.gateway_discovery.v2",
		profile_ref: "profile:work",
		membership_ref: "membership:alice-work",
		host_decision: "accepted",
		proof_level: "host_decision",
		non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		capabilities,
		targets: [],
		target_catalog: { target_count: 0, returned_count: 0, complete: true },
	};
	const decoded = decodedValue<{ capabilities: unknown[] }>({ ok: true, request_id: request.request_id, protocol_version: "1.3.0", value, proof_ref_or_unavailable: "gateway-audit-request:request:node-budget:d" }, request);
	assert.equal(decoded.capabilities.length, 40);
});

test("safe-JSON node budgets derive from their enforced byte caps", () => {
	assert.equal(safeJsonNodeBudgetForBytes(64 * 1024), 16_384);
	assert.equal(safeJsonNodeBudgetForBytes(SAFE_JSON_MIN_BYTES_PER_NODE), 1);
	assert.throws(() => safeJsonNodeBudgetForBytes(0), RangeError);
	assert.throws(() => safeJsonNodeBudgetForBytes(3.5), RangeError);
});

// #700 acceptance proof requested by the ceal-cli consumer: the additive
// response contract must hold at EVERY `retainDeclaredResponseKeys` site, not
// only at the representative envelope/error/recovery ones the suite already
// covered. Each site gets the same two assertions, because together they ARE
// the contract: a benign undeclared key is removed, an authority-shaped one is
// refused. The count guard below fails when a new site is added to the source
// without a row here, so "every site" stays true rather than true-on-the-day.
test("every retainDeclaredResponseKeys site strips a benign additive key and refuses an authority-shaped one", () => {
	const sites = retainSiteMatrix();
	for (const site of sites) {
		const additive = structuredClone(site.response);
		atPath(additive, site.path)[RETAIN_SITE_BENIGN_KEY] = "additive guidance";
		const decoded = decodeClientResponse(additive, site.request);
		assert.equal(Object.hasOwn(atPath(decoded as JsonRecord, site.path), RETAIN_SITE_BENIGN_KEY), false, `${site.id}: benign additive key must be removed`);
		// The unmutated response still decodes, so a site row cannot pass by being
		// invalid for an unrelated reason.
		assert.ok(decodeClientResponse(structuredClone(site.response), site.request), site.id);
		for (const authorityKey of RETAIN_SITE_AUTHORITY_KEYS) {
			const promoted = structuredClone(site.response);
			atPath(promoted, site.path)[authorityKey] = "authority:test";
			assert.throws(
				() => decodeClientResponse(promoted, site.request),
				hasCode("invalid_client_response"),
				`${site.id}: undeclared ${authorityKey} must be refused, not stripped`,
			);
		}
	}
});

test("the retain-site matrix covers every site declared in the protocol source", () => {
	const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
	const declaredSites = [...source.matchAll(/retainDeclaredResponseKeys\(/gu)].length;
	assert.equal(
		retainSiteMatrix().length,
		declaredSites,
		"a retainDeclaredResponseKeys site was added or removed without updating retainSiteMatrix; every site needs its own additive/authority proof",
	);
});
