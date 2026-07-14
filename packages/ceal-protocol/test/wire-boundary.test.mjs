import assert from "node:assert/strict";
import test from "node:test";
import {
	CEAL_GATEWAY_POLICY_DENIAL_MESSAGE,
	CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION,
	CealProtocolValidationError,
	decodeCealClientResponse,
	decodeCealGatewayRequest,
	isCealPublicSafeText,
	redactCealPublicUnsafeText,
} from "../dist/index.js";

const envelope = (operation, body) => ({
	request_id: `request:${operation}:001`,
	protocol_version: "1.2.0",
	operation,
	profile_ref: "profile:test",
	body,
});

test("public safe-text policy redacts every credential, provider, opaque, and control class", () => {
	const unsafe = [
		["g", "hp_exampleCredential1234567890"].join(""),
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
		envelope("handshake", { client: { name: "ceal", version: "0.64.0" } }),
		envelope("discover", {}),
		envelope("call", {
			capability_id: "message.search",
			target_ref: "target:workspace",
			arguments: { query: "quarterly plan", limit: 5 },
			purpose: "Find an approved workspace document",
		}),
		envelope("readback", { request_id: "request:call:001" }),
	];

	for (const request of requests) assert.deepEqual(decodeCealGatewayRequest(request), request);
	assert.equal(decodeCealGatewayRequest({ ...requests[0], protocol_version: "2.0.0" }).protocol_version, "2.0.0");
});

test("Gateway request decoder rejects malformed, extra, unsafe, and authority-bearing input without echoing it", () => {
	const secret = "xoxb-secret-material";
	const invalid = [
		{ ...envelope("discover", {}), extra: true },
		envelope("discover", { unexpected: true }),
		envelope("handshake", { client: { name: "ceal", version: "0.64.0", token: secret } }),
		envelope("call", { capability_id: "message.search", target_ref: "slack:C123456789", arguments: {}, purpose: "Search" }),
		envelope("call", { capability_id: "message.search", target_ref: "target:test", arguments: { access_token: secret }, purpose: "Search" }),
		envelope("call", { capability_id: "message.search", target_ref: "target:test", arguments: { token: "opaque-gateway-secret" }, purpose: "Search" }),
		envelope("call", { capability_id: "message.search", target_ref: "target:test", arguments: { refresh_token: "opaque-refresh-secret" }, purpose: "Search" }),
		envelope("call", { capability_id: "message.search", target_ref: "target:test", arguments: { api_key: "opaque-api-secret" }, purpose: "Search" }),
		envelope("call", { capability_id: "message.search", target_ref: "target:test", arguments: { authToken: "opaque-auth-secret" }, purpose: "Search" }),
		envelope("call", { capability_id: "message.search", target_ref: "target:test", arguments: { nested: { policy_decision: "allowed" } }, purpose: "Search" }),
		envelope("readback", { request_id: "contains whitespace" }),
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

test("client response decoder accepts exact operation-correlated Gateway results", () => {
	const callRequest = envelope("call", {
		capability_id: "message.search",
		target_ref: "target:workspace",
		arguments: { query: "quarterly plan", limit: 5 },
		purpose: "Search",
	});
	const handshakeRequest = envelope("handshake", { client: { name: "ceal", version: "0.64.0" } });
	const handshake = handshakeResponse(handshakeRequest);
	assert.deepEqual(decodeCealClientResponse(handshake, handshakeRequest), handshake);

	const discoverRequest = envelope("discover", {});
	const discovery = discoveryResponse(discoverRequest);
	assert.deepEqual(decodeCealClientResponse(discovery, discoverRequest), discovery);

	const call = callResponse(callRequest);
	assert.deepEqual(decodeCealClientResponse(call, callRequest), call);
	const liveCall = structuredClone(call);
	liveCall.value.non_claims = ["production_audit_not_reached"];
	assert.deepEqual(decodeCealClientResponse(liveCall, callRequest), liveCall);

	const emptyCall = callResponse(callRequest);
	emptyCall.value.data.result_count = 0;
	emptyCall.value.data.results = [];
	assert.deepEqual(decodeCealClientResponse(emptyCall, callRequest), emptyCall);

	const denial = policyDenialResponse(callRequest);
	assert.deepEqual(decodeCealClientResponse(denial, callRequest), denial);

	const failure = {
		ok: false,
		request_id: handshakeRequest.request_id,
		protocol_version: "1.2.0",
		proof_ref_or_unavailable: { state: "unavailable", reason: "Audit is pending", owner_surface: "Gateway audit" },
		error: { code: "incompatible_protocol", message: "The protocol is incompatible.", next_action: "Upgrade the client." },
	};
	assert.deepEqual(decodeCealClientResponse(failure, handshakeRequest), failure);

	const readbackRequest = envelope("readback", { request_id: callRequest.request_id });
	const readback = readbackResponse(readbackRequest, callRequest.request_id);
	assert.deepEqual(decodeCealClientResponse(readback, readbackRequest), readback);
	const liveReadback = structuredClone(readback);
	liveReadback.value.events[0].non_claims = ["production_audit_not_reached"];
	assert.deepEqual(decodeCealClientResponse(liveReadback, readbackRequest), liveReadback);
	const ambiguousProviderFailure = structuredClone(readback);
	ambiguousProviderFailure.value.events[0].outcome = "failed";
	ambiguousProviderFailure.value.events[0].error_code = "connector_unavailable";
	ambiguousProviderFailure.value.events[0].non_claims = ["production_audit_not_reached"];
	delete ambiguousProviderFailure.value.events[0].call;
	assert.deepEqual(decodeCealClientResponse(ambiguousProviderFailure, readbackRequest), ambiguousProviderFailure);
	const preProviderFailure = structuredClone(ambiguousProviderFailure);
	preProviderFailure.value.events[0].error_code = "invalid_arguments";
	assert.throws(() => decodeCealClientResponse(preProviderFailure, readbackRequest), hasCode("invalid_client_response"));
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
	assert.doesNotMatch(rendered, /capability_backend|credential_identity|delegated|slack|mature_search|degraded_fallback|\bbot\b|provider_search|recent_channel_history|provider_ranked|provider_truncated/u);
});

test("public discovery, call, and audit envelopes admit provider-neutral capability extensions", () => {
	const discoveryRequest = envelope("discover", {});
	const discovery = discoveryResponse(discoveryRequest);
	discovery.value.capabilities.push({
		capability_id: "file.search", label: "Search files", effect: "read", target_requirement: "required",
		input_contract: { schema_version: "ceal.file_search_input.v1", required: ["query"] },
		evidence_requirement: "gateway_audit",
	});
	discovery.value.targets[0].capability_ids.push("file.search");
	discovery.value.targets[0].capability_access.push({
		...matureCapabilityAccess(), capability_id: "file.search", grant_ref: "grant:workspace-file-search",
	});
	assert.equal(decodeCealClientResponse(discovery, discoveryRequest).value.capabilities.length, 2);

	const callRequest = envelope("call", {
		capability_id: "file.search", target_ref: "target:workspace", arguments: { query: "roadmap" }, purpose: "Find approved files",
	});
	const call = responseEnvelope(callRequest, { ok: true, value: {
		schema_version: "ceal.gateway_call_result.v1", capability_id: "file.search",
		grant_ref: "grant:workspace-file-search", grant_revision: 1, target_ref: "target:workspace",
		data: { schema_version: "ceal.file_search_result.v1", results: [{ ref: "file:roadmap", label: "Roadmap" }] },
		redaction: { state: "applied", omitted_classes: ["raw_provider_ids"] },
		host_decision: "accepted", proof_level: "host_decision", non_claims: ["production_audit_not_reached"],
	} });
	assert.equal(decodeCealClientResponse(call, callRequest).value.capability_id, "file.search");

	const readbackRequest = envelope("readback", { request_id: callRequest.request_id });
	const readback = readbackResponse(readbackRequest, callRequest.request_id);
	readback.value.events[0].call = {
		schema_version: "ceal.gateway_audit_call_detail.v1", capability_id: "file.search",
		grant_ref: "grant:workspace-file-search", grant_revision: 1, target_ref: "target:workspace",
		input_summary: { field_count: 1 }, output_summary: { result_count: 1 },
	};
	assert.equal(decodeCealClientResponse(readback, readbackRequest).value.events[0].call.capability_id, "file.search");
});

test("discovery decoder rejects drift, authority promotion, and target visibility ambiguity", () => {
	const request = envelope("discover", {});
	const exact = discoveryResponse(request);
	const cases = [];

	const wrongProfile = structuredClone(exact);
	wrongProfile.value.profile_ref = "profile:other";
	cases.push(wrongProfile);

	const missingCapability = structuredClone(exact);
	missingCapability.value.capabilities = [];
	cases.push(missingCapability);

	const changedContract = structuredClone(exact);
	changedContract.value.capabilities[0].input_contract.limit.maximum = 20;
	cases.push(changedContract);

	const duplicateTarget = structuredClone(exact);
	duplicateTarget.value.targets.push(structuredClone(duplicateTarget.value.targets[0]));
	cases.push(duplicateTarget);

	const rawTarget = structuredClone(exact);
	rawTarget.value.targets[0].target_ref = "slack:C123456789";
	cases.push(rawTarget);

	const ambiguousGrant = structuredClone(exact);
	ambiguousGrant.value.targets[1].capability_ids = ["message.search"];
	cases.push(ambiguousGrant);

	const missingAccess = structuredClone(exact);
	delete missingAccess.value.targets[0].capability_access;
	cases.push(missingAccess);

	const contradictoryAccess = structuredClone(exact);
	contradictoryAccess.value.targets[0].capability_access[0].readiness = "broken";
	cases.push(contradictoryAccess);

	const deniedAccess = structuredClone(exact);
	deniedAccess.value.targets[1].capability_access = [matureCapabilityAccess()];
	cases.push(deniedAccess);

	const authorityPromotion = structuredClone(exact);
		authorityPromotion.value.registration_ref = "registration:test";
	cases.push(authorityPromotion);

	for (const value of cases) {
		assert.throws(() => decodeCealClientResponse(value, request), hasCode("invalid_client_response"));
	}
});

test("call decoder rejects mismatches, unsafe results, and false minimization claims", () => {
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
		{ ...exact, extra: true },
		{ ...exact, proof_ref_or_unavailable: { state: "unavailable", reason: "pending", owner_surface: "Gateway audit" } },
	];

	const wrongCapability = structuredClone(exact);
	wrongCapability.value.capability_id = "message.read";
	cases.push(wrongCapability);

	const wrongTarget = structuredClone(exact);
	wrongTarget.value.target_ref = "target:other";
	cases.push(wrongTarget);

	const countMismatch = structuredClone(exact);
	countMismatch.value.data.result_count = 0;
	cases.push(countMismatch);

	const queryMetadataMismatch = structuredClone(exact);
	queryMetadataMismatch.value.data.query.utf8_bytes = 13;
	cases.push(queryMetadataMismatch);

	const duplicateResult = structuredClone(exact);
	duplicateResult.value.data.results.push(structuredClone(duplicateResult.value.data.results[0]));
	duplicateResult.value.data.result_count = 2;
	cases.push(duplicateResult);

	const rawProvider = structuredClone(exact);
	rawProvider.value.data.results[0].text_preview = "slack:C123456789";
	cases.push(rawProvider);

	const apiSecret = structuredClone(exact);
	apiSecret.value.data.results[0].text_preview = "credential sk-proj-abcdefghijklmnop";
	cases.push(apiSecret);

	const opaqueProviderId = structuredClone(exact);
	opaqueProviderId.value.data.results[0].text_preview = "provider 1AbCdEfGhIjKlMnOpQrStUvWxYz";
	cases.push(opaqueProviderId);

	const uuidProviderId = structuredClone(exact);
	uuidProviderId.value.data.results[0].text_preview = "provider object 550e8400-e29b-41d4-a716-446655440000";
	cases.push(uuidProviderId);

	const oversizedPreview = structuredClone(exact);
	oversizedPreview.value.data.results[0].text_preview = "x".repeat(1025);
	cases.push(oversizedPreview);

	const unsafeCredentialClaim = structuredClone(exact);
	unsafeCredentialClaim.value.data.minimization.credential_material_included = true;
	cases.push(unsafeCredentialClaim);

	const missingCoverage = structuredClone(exact);
	delete missingCoverage.value.data.coverage;
	cases.push(missingCoverage);

	const falseCompleteness = structuredClone(exact);
	falseCompleteness.value.data.coverage.truncated = true;
	cases.push(falseCompleteness);

	const rawCoverageScope = structuredClone(exact);
	rawCoverageScope.value.data.coverage.provider_channel_id = "C123456789";
	cases.push(rawCoverageScope);

	const authorityPromotion = structuredClone(exact);
	authorityPromotion.value.policy_ref = "policy:test";
	cases.push(authorityPromotion);

	for (const value of cases) {
		assert.throws(() => decodeCealClientResponse(value, callRequest), hasCode("invalid_client_response"));
	}

	const malformedInputRequest = structuredClone(callRequest);
	malformedInputRequest.body.arguments.extra = true;
	assert.throws(
		() => decodeCealClientResponse(callResponse(malformedInputRequest), malformedInputRequest),
		hasCode("invalid_client_response"),
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
		assert.throws(() => decodeCealClientResponse(value, request), hasCode("invalid_client_response"));
	}

	const discoverRequest = envelope("discover", {});
	const crossOperation = { ...exact, request_id: discoverRequest.request_id };
	assert.throws(() => decodeCealClientResponse(crossOperation, discoverRequest), hasCode("invalid_client_response"));
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
		{ ok: false, request_id: exact.request_id, protocol_version: "1.2.0", error: { code: "bad-code", message: "No." } },
		{ ok: false, request_id: exact.request_id, protocol_version: "1.2.0", error: { code: "denied", message: "No.", next_action: "Retry.", another_action: "Leak." } },
	]) assert.throws(() => decodeCealClientResponse(value, callRequest), hasCode("invalid_client_response"));

	const handshakeRequest = envelope("handshake", { client: { name: "ceal", version: "0.64.0" } });
	const handshake = handshakeResponse(handshakeRequest);
	for (const value of [
		{ ...handshake, proof_ref_or_unavailable: undefined },
		{ ...handshake, value: { host_decision: "accepted" } },
		{ ...handshake, value: { ...handshake.value, profile_ref: "profile:other" } },
		{ ...handshake, value: { ...handshake.value, non_claims: ["production_audit_not_reached", "provider_execution_not_reached"] } },
	]) assert.throws(() => decodeCealClientResponse(value, handshakeRequest), hasCode("invalid_client_response"));

	const readbackRequest = envelope("readback", { request_id: callRequest.request_id });
	const readback = readbackResponse(readbackRequest, callRequest.request_id);
	for (const value of [
		{ ...readback, value: { ...readback.value, events: [] } },
		{ ...readback, value: { ...readback.value, request_id: "request:other" } },
		{ ...readback, value: { ...readback.value, events: [{ ...readback.value.events[0], error_code: "denied" }] } },
	]) assert.throws(() => decodeCealClientResponse(value, readbackRequest), hasCode("invalid_client_response"));

	const missingCallDetail = structuredClone(readback);
	delete missingCallDetail.value.events[0].call;
	assert.throws(() => decodeCealClientResponse(missingCallDetail, readbackRequest), hasCode("invalid_client_response"));

	const rawQueryLeak = structuredClone(readback);
	rawQueryLeak.value.events[0].call.query = "quarterly plan";
	assert.throws(() => decodeCealClientResponse(rawQueryLeak, readbackRequest), hasCode("invalid_client_response"));

	const oversizedQueryShape = structuredClone(readback);
	oversizedQueryShape.value.events[0].call.query_utf8_bytes = 513;
	assert.throws(() => decodeCealClientResponse(oversizedQueryShape, readbackRequest), hasCode("invalid_client_response"));

	for (const decision of [
		{ auth_decision: "denied", policy_decision: "allowed", outcome: "succeeded", error_code: null },
		{ auth_decision: "allowed", policy_decision: "denied", outcome: "succeeded", error_code: null },
		{ auth_decision: "denied", policy_decision: "allowed", outcome: "failed", error_code: "internal_error" },
	]) {
		const contradictory = structuredClone(readback);
		Object.assign(contradictory.value.events[0], decision);
		assert.throws(() => decodeCealClientResponse(contradictory, readbackRequest), hasCode("invalid_client_response"));
	}

	const authenticationDenial = structuredClone(readback);
	Object.assign(authenticationDenial.value.events[0], {
		auth_decision: "denied",
		policy_decision: "not_evaluated",
		outcome: "denied",
		error_code: "authentication_failed",
	});
	delete authenticationDenial.value.events[0].call;
	assert.deepEqual(decodeCealClientResponse(authenticationDenial, readbackRequest), authenticationDenial);
});

function discoveryResponse(request) {
	return responseEnvelope(request, {
		ok: true,
			value: {
				schema_version: "ceal.gateway_discovery.v1",
				profile_ref: request.profile_ref,
				membership_ref: "membership:test-work",
			capabilities: [{
				capability_id: "message.search",
				label: "Search messages",
				effect: "read",
				target_requirement: "required",
				input_contract: {
					schema_version: "ceal.message_search_input.v1",
					required: ["query"],
					query: { type: "string", max_bytes: 512 },
					limit: { type: "integer", minimum: 1, maximum: 10, default: 5 },
				},
				evidence_requirement: "gateway_audit",
			}],
			targets: [
					{ target_ref: "target:workspace", label: "Team inbox", access: "granted", capability_ids: ["message.search"], capability_access: [matureCapabilityAccess()] },
					{ target_ref: "target:customer-health", label: "Customer health", access: "request_required", capability_ids: [], capability_access: [] },
			],
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		},
	});
}

function callResponse(request) {
	return responseEnvelope(request, {
		ok: true,
		value: {
			schema_version: "ceal.gateway_call_result.v1",
			capability_id: request.body.capability_id,
				grant_ref: "grant:workspace-message-search",
				grant_revision: 1,
			target_ref: request.body.target_ref,
			data: {
				schema_version: "ceal.message_search_result.v1",
				query: { redacted: true, utf8_bytes: 14, empty: false },
				result_count: 1,
				results: [{
					ref: "message:msg_001",
					thread_ref: "thread:thr_launch_readiness",
					target_ref: request.body.target_ref,
					created_at: "2026-07-10T00:00:00.000Z",
					source_label: "Team inbox",
					text_preview: "Launch readiness is green.",
				}],
				coverage: matureSearchCoverage(),
				minimization: {
					raw_provider_ids_included: false,
					raw_messages_included: false,
					credential_material_included: false,
				},
			},
			redaction: { state: "applied", omitted_classes: ["query_text", "raw_provider_ids", "raw_messages"] },
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		},
	});
}

function policyDenialResponse(request) {
	return responseEnvelope(request, {
		ok: false,
		error: {
			code: "policy_denied",
			message: CEAL_GATEWAY_POLICY_DENIAL_MESSAGE,
			next_action: CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION,
			decision: {
				schema_version: "ceal.gateway_policy_denial.v1",
				capability_id: request.body.capability_id,
				target_ref: request.body.target_ref,
				host_decision: "denied",
				proof_level: "host_decision",
				non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
			},
		},
	});
}

function handshakeResponse(request) {
	return responseEnvelope(request, {
		ok: true,
		value: {
			schema_version: "ceal.gateway_handshake.v1",
				negotiated_protocol_version: "1.2.0",
				supported_gateway_protocol_range: { minimum: "1.2.0", maximum: "1.2.0" },
				profile_ref: request.profile_ref,
				membership_ref: "membership:test-work",
				registration_ref: "registration:test",
				client_ref: "client:test",
				subject_ref: "subject:test",
				instance_ref: "instance:test",
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		},
	});
}

function readbackResponse(request, targetRequestId) {
	return responseEnvelope(request, {
		ok: true,
		value: {
			schema_version: "ceal.gateway_audit_readback.v1",
			request_id: targetRequestId,
			events: [{
				schema_version: "ceal.gateway_audit_event.v1",
				event_ref: "gateway-audit:event:001",
				request_id: targetRequestId,
					profile_ref: request.profile_ref,
					membership_ref: "membership:test-work",
					membership_revision: 1,
					registration_ref: "registration:test",
					client_ref: "client:test",
					client_revision: 1,
					subject_ref: "subject:test",
					instance_ref: "instance:test",
				occurred_at: "2026-07-13T21:00:00.000Z",
				operation: "call",
				auth_decision: "allowed",
				policy_decision: "allowed",
				outcome: "succeeded",
				error_code: null,
				call: {
					schema_version: "ceal.gateway_audit_call_detail.v1",
					capability_id: "message.search",
						grant_ref: "grant:workspace-message-search",
						grant_revision: 1,
					target_ref: "target:workspace",
					requested_limit: 5,
					query_utf8_bytes: 14,
					result_count: 1,
					coverage: matureSearchCoverage(),
				},
				proof_level: "host_decision",
				non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
			}],
		},
	});
}

function matureCapabilityAccess() {
	return {
		schema_version: "ceal.capability_access.v1",
		capability_id: "message.search",
		grant_ref: "grant:workspace-message-search",
		grant_revision: 1,
		readiness: "ready",
	};
}

function matureSearchCoverage() {
	return {
		schema_version: "ceal.message_search_coverage.v1",
		source: "authoritative_index",
		match_semantics: "backend_ranked",
		reply_coverage: "included",
		completeness: "bounded",
		truncated: false,
	};
}

function responseEnvelope(request, body) {
	return {
		...body,
		request_id: request.request_id,
		protocol_version: "1.2.0",
		proof_ref_or_unavailable: `proof:${request.request_id}`,
	};
}

function hasCode(code) {
	return (error) => error instanceof CealProtocolValidationError && error.code === code;
}
