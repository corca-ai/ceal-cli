import {
	assertSafeJsonValue,
	byteLength,
	isSafeConnectorKind,
	isSafeTargetKind,
	RAW_PROVIDER_REF,
	requireJsonByteSize,
	SECRET_MATERIAL,
} from "./gateway-validation-primitives.js";
import { opaqueTargetRef } from "./leased-consumer-opaque-refs.js";
import { decodeCealCapabilityNavigation, type CealCapabilityNavigation } from "./capability-navigation.js";

export const CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_SCHEMA = "ceal.gateway_leased_agent_capability_catalog.v1" as const;
export const CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_MAX_BYTES = 64 * 1024;
export const CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_MAX_CAPABILITIES = 128;
export const CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_MAX_TARGETS = 256;
// Opaque capability arguments (`message_ref`, `thread_ref`, `artifact_ref`)
// are part of the public call grammar. Deny only Gateway authority coordinates;
// treating every `*_ref` noun as authority made the real catalog undecodable.
const AUTHORITY_SCHEMA_KEY = /^(?:consumer|credential|event|grant|lease|membership|profile|runner|upload)(?:_ref)?$/iu;
const AUTHORITY_SCHEMA_VALUE = /^(?:artifact|consumer|credential|event|grant|lease|membership|message|profile|runner|target|thread|upload):/u;

export interface CealLeasedConsumerCapabilityCatalogTarget {
	target_ref: string;
	label: string;
	connector_kind: string;
	target_kind: string;
	readiness: "ready" | "degraded" | "unavailable" | "unknown";
}

export interface CealLeasedConsumerCapabilityCatalogEntry {
	capability_id: string;
	label: string;
	effect: "read" | "write";
	target_requirement: "required" | "optional" | "none";
	input_contract: Record<string, unknown>;
	evidence_requirement: string;
	navigation?: CealCapabilityNavigation;
	targets: readonly CealLeasedConsumerCapabilityCatalogTarget[];
}

export type CealLeasedConsumerCapabilityNavigation = CealCapabilityNavigation;

export interface CealLeasedConsumerCapabilityCatalog {
	schema_version: typeof CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_SCHEMA;
	capabilities: readonly CealLeasedConsumerCapabilityCatalogEntry[];
}

/**
 * Exact decoder for the provider-neutral catalog handed to a leased Agent.
 * Provider locators and Grant records stay behind the Gateway; every callable
 * target is a capability-bound opaque handle.
 */
export function decodeCealLeasedConsumerCapabilityCatalog(value: unknown): CealLeasedConsumerCapabilityCatalog {
	requireJsonByteSize(value, CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_MAX_BYTES, invalid);
	const record = requireRecord(value);
	requireExactKeys(record, ["capabilities", "schema_version"]);
	if (record.schema_version !== CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_SCHEMA
		|| !Array.isArray(record.capabilities)
		|| record.capabilities.length > CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_MAX_CAPABILITIES) invalid();
	const ids = new Set<string>();
	const targetRefs = new Set<string>();
	let targetCount = 0;
	for (const entry of record.capabilities) {
		const capabilityId = decodeEntry(entry, targetRefs);
		if (ids.has(capabilityId)) invalid();
		ids.add(capabilityId);
		targetCount += (entry as Record<string, unknown>).targets instanceof Array
			? ((entry as Record<string, unknown>).targets as unknown[]).length : 0;
		if (targetCount > CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_MAX_TARGETS) invalid();
	}
	return value as CealLeasedConsumerCapabilityCatalog;
}

function decodeEntry(value: unknown, targetRefs: Set<string>): string {
	const record = requireRecord(value);
	requireExactKeys(record, Object.hasOwn(record, "navigation")
		? ["capability_id", "effect", "evidence_requirement", "input_contract", "label", "navigation", "target_requirement", "targets"]
		: ["capability_id", "effect", "evidence_requirement", "input_contract", "label", "target_requirement", "targets"]);
	decodeEntryDescriptor(record);
	if (record.navigation !== undefined) decodeCealCapabilityNavigation(record.navigation);
	try {
		assertSafeJsonValue(record.input_contract, {
			forbidAuthorityKeys: true,
			maxNodes: Math.floor(CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_MAX_BYTES / 4),
		});
	} catch { invalid(); }
	validateCatalogInputContract(record.input_contract);
	if (record.target_requirement === "required" && record.targets.length === 0) invalid();
	if (record.target_requirement === "none" && record.targets.length !== 0) invalid();
	for (const target of record.targets) decodeTarget(target, targetRefs);
	return record.capability_id;
}

function validateCatalogInputContract(value: unknown): void {
	if (typeof value === "string") {
		if (AUTHORITY_SCHEMA_VALUE.test(value)) invalid();
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) validateCatalogInputContract(entry);
		return;
	}
	if (!plainRecord(value)) return;
	for (const [key, entry] of Object.entries(value)) {
		if (AUTHORITY_SCHEMA_KEY.test(key)) invalid();
		validateCatalogInputContract(entry);
	}
}

function decodeEntryDescriptor(record: Record<string, unknown>): asserts record is Record<string, unknown> & {
	capability_id: string;
	input_contract: Record<string, unknown>;
	target_requirement: "required" | "optional" | "none";
	targets: unknown[];
} {
	if (!capabilityId(record.capability_id)) invalid();
	if (!safeText(record.label, 512)) invalid();
	if (!["read", "write"].includes(String(record.effect))) invalid();
	if (!["required", "optional", "none"].includes(String(record.target_requirement))) invalid();
	if (!safeText(record.evidence_requirement, 256)) invalid();
	if (!plainRecord(record.input_contract)) invalid();
	if (!Array.isArray(record.targets)) invalid();
}

function decodeTarget(value: unknown, targetRefs: Set<string>): void {
	const record = requireRecord(value);
	requireExactKeys(record, ["connector_kind", "label", "readiness", "target_kind", "target_ref"]);
	if (!opaqueTargetRef(record.target_ref) || !safeText(record.label, 512)
		|| !isSafeConnectorKind(record.connector_kind) || !isSafeTargetKind(record.target_kind)
		|| !["ready", "degraded", "unavailable", "unknown"].includes(String(record.readiness))
		|| targetRefs.has(record.target_ref)) invalid();
	targetRefs.add(record.target_ref);
}

function capabilityId(value: unknown): value is string {
	return typeof value === "string" && /^[a-z][a-z0-9_.]{0,127}$/u.test(value);
}

function safeText(value: unknown, maximum: number): value is string {
	return typeof value === "string" && value.length > 0 && byteLength(value) <= maximum
		&& !SECRET_MATERIAL.test(value) && !RAW_PROVIDER_REF.test(value)
		&& ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127);
}

function requireRecord(value: unknown): Record<string, unknown> {
	if (!plainRecord(value)) invalid();
	return value;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
	const actual = Object.keys(value).sort();
	const ordered = [...expected].sort();
	if (actual.length !== ordered.length || actual.some((key, index) => key !== ordered[index])) invalid();
}

function plainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function invalid(): never {
	throw new TypeError("Ceal leased-consumer capability catalog is invalid");
}
