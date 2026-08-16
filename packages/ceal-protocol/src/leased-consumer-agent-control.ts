import { decodeCealLeasedConsumerMessengerContext, type CealLeasedConsumerCapabilityProjectionResult, type CealLeasedConsumerNormalizedProjection } from "./leased-consumer-control.ts";
import { decodeCealLeasedConsumerCapabilityCatalog } from "./leased-consumer-capability-catalog.ts";

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const TOKEN = /^ceal-control-v1[.][A-Za-z0-9_-]{43}$/u;

/** Selected-v5-only durable new-turn control; selected v4 never decodes it. */
export interface CealLeasedConsumerAgentControlProjection {
	schema_version: "ceal.gateway_normalized_agent_control_projection.v1";
	control: {
		token: string;
		authority: "original_requester" | "instance_admin";
		actor_subject_ref: string;
		origin: { event_ref: string; event_revision: number; normalized_projection_ref: string; normalized_projection_revision: number };
	};
}

type Available = Extract<CealLeasedConsumerCapabilityProjectionResult, { status: "available" }>;
export type CealLeasedConsumerV5CapabilityProjectionResult =
	| (Omit<Available, "projection"> & { projection: CealLeasedConsumerNormalizedProjection | CealLeasedConsumerAgentControlProjection })
	| Exclude<CealLeasedConsumerCapabilityProjectionResult, { status: "available" }>;

export interface CealLeasedConsumerControlEffect {
	schema_version: "ceal.gateway_leased_agent_control_effect.v1";
	effect: "conversation.lifecycle.exit";
}

export interface CealLeasedConsumerControlEffectCompleteInput {
	event_ref: string;
	lease_ref: string;
	lease_fence: number;
	disposition: "completed";
	agent_run_ref?: string;
	control_effect: CealLeasedConsumerControlEffect;
}

export function isCealLeasedConsumerAgentControlProjectionResultCandidate(value: unknown): boolean {
	return record(value) && record(value.projection) && value.projection.schema_version === "ceal.gateway_normalized_agent_control_projection.v1";
}

export function decodeCealLeasedConsumerAgentControlProjectionResult(value: unknown): CealLeasedConsumerV5CapabilityProjectionResult {
	if (!validResultEnvelope(value) || !validResultBinding(value) || !validResultContext(value)) invalid();
	return value as unknown as CealLeasedConsumerV5CapabilityProjectionResult;
}

export function isCealLeasedConsumerControlEffectCompleteCandidate(value: unknown): boolean { return record(value) && Object.hasOwn(value, "control_effect"); }
export function decodeCealLeasedConsumerControlEffectCompleteInput(value: unknown): CealLeasedConsumerControlEffectCompleteInput {
	if (!record(value) || !exactKeysOptional(value, ["control_effect", "disposition", "event_ref", "lease_fence", "lease_ref"], ["agent_run_ref"]) || value.disposition !== "completed") invalid();
	if (!safeRef(value.event_ref) || !safeRef(value.lease_ref) || !positive(value.lease_fence) || (value.agent_run_ref !== undefined && !safeRef(value.agent_run_ref)) || !validControlEffect(value.control_effect)) invalid();
	return value as unknown as CealLeasedConsumerControlEffectCompleteInput;
}

function validResultEnvelope(value: unknown): value is Record<string, unknown> { return record(value) && exactKeysOptional(value, ["attachments", "capability_catalog", "event_ref", "event_revision", "normalized_projection_ref", "normalized_projection_revision", "projection", "requester", "status"], ["messenger_context"]) && value.status === "available"; }
function validResultBinding(value: Record<string, unknown>): boolean { return safeRef(value.event_ref) && positive(value.event_revision) && safeRef(value.normalized_projection_ref) && positive(value.normalized_projection_revision); }
function validResultContext(value: Record<string, unknown>): boolean {
	return validRequester(value.requester) && validAttachments(value.attachments) && validCatalog(value.capability_catalog)
		&& (value.messenger_context === undefined || validMessengerContext(value.messenger_context)) && validProjection(value.projection);
}
function validCatalog(value: unknown): boolean {
	try { decodeCealLeasedConsumerCapabilityCatalog(value); return true; } catch { return false; }
}
function validMessengerContext(value: unknown): boolean {
	try { decodeCealLeasedConsumerMessengerContext(value); return true; } catch { return false; }
}
function validProjection(value: unknown): boolean { return record(value) && exactKeys(value, ["control", "schema_version"]) && value.schema_version === "ceal.gateway_normalized_agent_control_projection.v1" && validControl(value.control); }
function validControl(value: unknown): boolean { return record(value) && exactKeys(value, ["actor_subject_ref", "authority", "origin", "token"]) && TOKEN.test(String(value.token)) && ["original_requester", "instance_admin"].includes(value.authority as string) && subjectRef(value.actor_subject_ref) && validOrigin(value.origin); }
function validOrigin(value: unknown): boolean { return record(value) && exactKeys(value, ["event_ref", "event_revision", "normalized_projection_ref", "normalized_projection_revision"]) && safeRef(value.event_ref) && positive(value.event_revision) && safeRef(value.normalized_projection_ref) && positive(value.normalized_projection_revision); }
function validRequester(value: unknown): boolean { return record(value) && exactKeys(value, ["subject_ref"]) && subjectRef(value.subject_ref); }
function validAttachments(value: unknown): boolean { return record(value) && exactKeys(value, ["count", "set_ref"]) && value.count === 0 && value.set_ref === null; }
function validControlEffect(value: unknown): boolean { return record(value) && exactKeys(value, ["effect", "schema_version"]) && value.schema_version === "ceal.gateway_leased_agent_control_effect.v1" && value.effect === "conversation.lifecycle.exit"; }
function subjectRef(value: unknown): value is string { return safeRef(value) && value.startsWith("subject:") && !/^subject:(?:[UW][A-Z0-9]{4,})$/u.test(value); }
function safeRef(value: unknown): value is string { return typeof value === "string" && SAFE_REF.test(value); }
function positive(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 1; }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean { const keys = Object.keys(value).sort(); const ordered = [...expected].sort(); return keys.length === ordered.length && keys.every((key, index) => key === ordered[index]); }
function exactKeysOptional(value: Record<string, unknown>, expected: readonly string[], optional: readonly string[]): boolean { const keys = Object.keys(value).sort(); const allowed = [...expected, ...optional].sort(); return keys.length >= expected.length && keys.length <= allowed.length && expected.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.includes(key)); }
function invalid(): never { throw new TypeError("Ceal leased-consumer Agent control projection is invalid"); }
