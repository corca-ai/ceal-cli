import { createHash } from "node:crypto";
import {
	CEAL_GATEWAY_POLICY_DENIAL_MESSAGE,
	CEAL_GATEWAY_POLICY_DENIAL_NEXT_ACTION,
	decodeCealClientResponse,
} from "../dist/index.js";
import type { CealGatewayRequest, CealGatewayResponseFor } from "../dist/index.js";
import { hasCode, requireClientFailure, requireClientSuccess, type JsonRecord, type JsonValue } from "./protocol-test-support.ts";

export type GatewayTestOperation = "handshake" | "discover" | "call" | "readback";

export interface GatewayTestRequest {
	request_id: string;
	protocol_version: string;
	operation: GatewayTestOperation;
	profile_ref: string;
	body: JsonRecord;
}
export interface DiscoveryTargetFixture extends JsonRecord {
	target_ref: string;
	capability_ids: string[];
	capability_access?: JsonRecord[];
}

export interface DiscoveryValueFixture extends JsonRecord {
	capabilities: JsonRecord[];
	targets: DiscoveryTargetFixture[];
	target_catalog: JsonRecord;
}

export interface SuccessFixture<TValue extends JsonRecord = JsonRecord> extends JsonRecord {
	ok: true;
	request_id: string;
	protocol_version: string;
	proof_ref_or_unavailable: JsonValue;
	value: TValue;
}

export interface FailureFixture extends JsonRecord {
	ok: false;
	request_id: string;
	protocol_version: string;
	error: JsonRecord;
}

export type DiscoveryFixture = SuccessFixture<DiscoveryValueFixture>;
export type CallFixture = SuccessFixture<JsonRecord>;
export type HandshakeFixture = SuccessFixture<JsonRecord>;
export type ReadbackFixture = SuccessFixture<JsonRecord>;

export function envelope(operation: GatewayTestOperation, body: JsonRecord): GatewayTestRequest {
	return {
		request_id: `request:${operation}:001`,
		protocol_version: "1.3.0",
		operation,
		profile_ref: "profile:test",
		body,
	};
}

export function decodeClientResponse(
	value: unknown,
	request: GatewayTestRequest,
): CealGatewayResponseFor<CealGatewayRequest> {
	return decodeCealClientResponse(value, request as never);
}

export function decodedValue<T>(value: unknown, request: GatewayTestRequest): T {
	return requireClientSuccess<T>(decodeClientResponse(value, request)).value;
}

export function decodedError(value: unknown, request: GatewayTestRequest) {
	return requireClientFailure(decodeClientResponse(value, request)).error;
}

export function responseEnvelope(request: GatewayTestRequest, body: JsonRecord): JsonRecord {
	return {
		...body,
		request_id: request.request_id,
		protocol_version: "1.3.0",
		proof_ref_or_unavailable: `proof:${request.request_id}`,
	};
}

export function matureCapabilityAccess(): JsonRecord {
	return {
		schema_version: "ceal.capability_access.v1",
		capability_id: "message.search",
		grant_ref: "grant:workspace-message-search",
		grant_revision: 1,
		readiness: "ready",
	};
}

export function matureSearchCoverage(): JsonRecord {
	return {
		schema_version: "ceal.message_search_coverage.v1",
		source: "authoritative_index",
		match_semantics: "backend_ranked",
		reply_coverage: "included",
		completeness: "bounded",
		truncated: false,
	};
}

export function announcementPolicy(): JsonRecord {
	return {
		schema_version: "ceal.gateway_announcement_policy.v1",
		scope_statement_kind: "github_app_installation_repositories",
		scope_statement: "Repositories in the installed GitHub App installation.",
		provider_application_authority: { kind: "github_app", granted_permissions: ["metadata:read"] },
		explicit_request_required: false,
		provenance_requirement: "gateway_receipt_audit",
		non_claims: [
			"policy_projection_does_not_authorize",
			"provider_roundtrip_not_established_by_discovery",
			"target_specific_scope_not_declared",
		],
	};
}

export function readAnnouncementPolicy(
	scopeStatementKind: string,
	scopeStatement: string,
	providerApplicationAuthority: JsonRecord,
): JsonRecord {
	return {
		...announcementPolicy(),
		scope_statement_kind: scopeStatementKind,
		scope_statement: scopeStatement,
		provider_application_authority: providerApplicationAuthority,
	};
}

export function writeAnnouncementPolicy(): JsonRecord {
	return {
		...announcementPolicy(),
		explicit_request_required: true,
		provenance_requirement: "explicit_requester_event_gateway_receipt_audit_provider_readback",
	};
}

export function attestedWriteContract(): JsonRecord {
	return {
		side_effect_class: "append_reply",
		idempotency: "required",
		provider_readback: "required",
		attribution: "requester_event",
		provenance_binding: "gateway_attested_requester_event_v1",
	};
}

export function firstTarget(
	response: DiscoveryFixture,
): DiscoveryTargetFixture & { capability_access: JsonRecord[] } {
	const target = response.value.targets[0];
	if (target === undefined) throw new Error("discovery fixture is missing its target row");
	target.capability_access ??= [];
	return target as DiscoveryTargetFixture & { capability_access: JsonRecord[] };
}

export function firstAccess(response: DiscoveryFixture): JsonRecord {
	const access = firstTarget(response).capability_access[0];
	if (access === undefined) throw new Error("discovery fixture is missing capability access");
	return access;
}

export function discoveryResponse(request: GatewayTestRequest): DiscoveryFixture {
	const selected = request.body.capability_id === "message.search"
		|| (Array.isArray(request.body.capability_ids) && request.body.capability_ids.includes("message.search"));
	const bare = !selected && request.body.capability_id === undefined && request.body.capability_ids === undefined;
	return responseEnvelope(request, {
		ok: true,
		value: {
			schema_version: "ceal.gateway_discovery.v2",
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
			targets: selected || bare ? [{
				target_ref: "target:workspace",
				label: "Team inbox",
				connector_kind: "slack",
				target_kind: "conversation",
				access: "granted",
				capability_ids: ["message.search"],
				capability_access: [matureCapabilityAccess()],
			}] : [],
			target_catalog: selected || bare
				? { target_count: 1, returned_count: 1, complete: true }
				: { target_count: 1, returned_count: 0, complete: false },
			host_decision: "accepted",
			proof_level: "host_decision",
			non_claims: ["provider_execution_not_reached", "production_audit_not_reached"],
		},
	});
}

export function callResponse(request: GatewayTestRequest): CallFixture {
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

export function policyDenialResponse(request: GatewayTestRequest): FailureFixture {
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

export function handshakeResponse(request: GatewayTestRequest): HandshakeFixture {
	return responseEnvelope(request, {
		ok: true,
		value: {
			schema_version: "ceal.gateway_handshake.v1",
			negotiated_protocol_version: "1.3.0",
			supported_gateway_protocol_range: { minimum: "1.3.0", maximum: "1.3.0" },
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

export function scopedIdentityProjection(handshake: JsonRecord): JsonRecord {
	return {
		schema_version: "ceal.gateway_scoped_identity_projection.v1",
		instance_ref: handshake.instance_ref,
		profile_ref: handshake.profile_ref,
		profile_audience_revision: 7,
		graph_revision: "a".repeat(64),
		subject_key_revision: "b".repeat(64),
		projection_revision: "c".repeat(64),
		issued_at: "2026-08-12T00:00:00.000Z",
		expires_at: "2026-08-12T00:05:00.000Z",
		people: [{
			subject_ref: "subject:profile-person",
			display_name: "Alice",
			actor_kind: "human",
			providers: ["github", "slack"],
		}],
		truncated: false,
	};
}

export function readbackResponse(request: GatewayTestRequest, targetRequestId: string): ReadbackFixture {
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
				grant_snapshot: {
					schema_version: "ceal.gateway_authorization_snapshot.v1",
					capability_id: "message.search",
					target_ref: "target:workspace",
					grant_ref: "grant:workspace-message-search",
					grant_revision: 1,
				},
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

export function discoveryWithWriteContract(overrides: JsonRecord): {
	request: GatewayTestRequest;
	response: DiscoveryFixture;
} {
	const request = envelope("discover", { capability_id: "message.search" });
	const response = discoveryResponse(request);
	response.value.capabilities.push({
		capability_id: "message.create",
		label: "Send one governed message",
		effect: "write",
		target_requirement: "required",
		input_contract: { schema_version: "ceal.message_create_input.v1", required: ["text"] },
		evidence_requirement: "gateway_audit",
		write_contract: {
			side_effect_class: "append_message",
			idempotency: "required",
			provider_readback: "required",
			...overrides,
		},
	});
	const target = firstTarget(response);
	target.capability_ids.push("message.create");
	target.capability_access.push({
		...matureCapabilityAccess(),
		capability_id: "message.create",
		grant_ref: "grant:workspace-message-create",
	});
	return { request, response };
}

export function atPath(value: JsonValue, path: readonly (string | number)[]): JsonRecord {
	let node: JsonValue = value;
	for (const step of path) {
		if (node === null || typeof node !== "object") {
			throw new Error(`path miss at ${String(step)}`);
		}
		node = Array.isArray(node) ? node[Number(step)] : node[String(step)];
	}
	if (node === null || typeof node !== "object" || Array.isArray(node)) {
		throw new Error("path did not resolve to an object");
	}
	return node;
}

const RETAIN_SITE_BENIGN_KEY = "gateway_hint";
const RETAIN_SITE_AUTHORITY_KEYS = ["policy_ref", "grant_revision", "scope_ref"] as const;

export { hasCode, RETAIN_SITE_AUTHORITY_KEYS, RETAIN_SITE_BENIGN_KEY };

export function retainSiteMatrix(): Array<{
	id: string;
	request: GatewayTestRequest;
	response: JsonRecord;
	path: readonly (string | number)[];
}> {
	const callRequest = envelope("call", {
		capability_id: "message.search",
		target_ref: "target:workspace",
		arguments: { query: "quarterly plan" },
		purpose: "Search",
	});
	const discoverRequest = envelope("discover", { capability_id: "message.search", match: "Team", limit: 1 });
	const plainDiscoverRequest = envelope("discover", {});
	const handshakeRequest = envelope("handshake", { client: { name: "ceal", version: "0.65.0" } });
	const readbackRequest = envelope("readback", { request_id: callRequest.request_id });
	const writeRequestRef = "gateway-write-request:123e4567-e89b-12d3-a456-426614174000";
	const receiptRequest = envelope("readback", { write_request_ref: writeRequestRef });
	const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
	const failureRequest = envelope("call", {
		capability_id: "message.search",
		target_ref: "target:workspace",
		arguments: { query: "q" },
		purpose: "Search",
	});
	const failureResponse = responseEnvelope(failureRequest, {
		ok: false,
		error: {
			code: "connector_unavailable",
			message: "The connector is unavailable.",
			next_action: "Retry shortly.",
			recovery: { kind: "retry", retry_after_ms: 1000 },
		},
	});
	return [
		{ id: "success envelope", request: callRequest, response: callResponse(callRequest), path: [] },
		{ id: "handshake value", request: handshakeRequest, response: handshakeResponse(handshakeRequest), path: ["value"] },
		{ id: "discovery value", request: plainDiscoverRequest, response: discoveryResponse(plainDiscoverRequest), path: ["value"] },
		{ id: "discovery capability", request: plainDiscoverRequest, response: discoveryResponse(plainDiscoverRequest), path: ["value", "capabilities", 0] },
		{ id: "discovery target", request: discoverRequest, response: discoveryResponse(discoverRequest), path: ["value", "targets", 0] },
		{ id: "call value", request: callRequest, response: callResponse(callRequest), path: ["value"] },
		{ id: "call redaction", request: callRequest, response: callResponse(callRequest), path: ["value", "redaction"] },
		{ id: "readback value", request: readbackRequest, response: readbackResponse(readbackRequest, callRequest.request_id), path: ["value"] },
		{ id: "readback event", request: readbackRequest, response: readbackResponse(readbackRequest, callRequest.request_id), path: ["value", "events", 0] },
		{
			id: "write receipt",
			request: receiptRequest,
			response: responseEnvelope(receiptRequest, {
				ok: true,
				value: {
					schema_version: "ceal.gateway_write_receipt_readback.v1",
					receipt: {
						schema_version: "ceal.gateway_write_request_receipt.v1",
						write_request_sha256: sha256(writeRequestRef),
						source_kind: "authenticated_registered_client",
						source_evidence_sha256: sha256("client-binding"),
						idempotency_claim_sha256: sha256("idempotency"),
						normalized_mutation_sha256: sha256("mutation"),
						provider_state: "verified",
						provider_readback: "verified",
					},
				},
			}),
			path: ["value", "receipt"],
		},
		{ id: "failure envelope", request: failureRequest, response: failureResponse, path: [] },
		{ id: "failure error", request: failureRequest, response: failureResponse, path: ["error"] },
		{ id: "failure recovery", request: failureRequest, response: failureResponse, path: ["error", "recovery"] },
	];
}
