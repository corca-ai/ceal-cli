import {
	CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_SCHEMA,
} from "../dist/index.js";

export const lease = {
	event_ref: "event:one",
	lease_ref: "lease:one",
	lease_fence: 1,
	delivery_attempt: 1,
	expires_at: "2026-08-01T00:00:30.000Z",
};

export const leaseInput = {
	event_ref: lease.event_ref,
	lease_ref: lease.lease_ref,
	lease_fence: lease.lease_fence,
};

export const notificationBinding = {
	kind: "abort_requested",
	notification_sequence: 1,
	event_ref: "event:one",
	event_revision: 3,
	runner_ref: "runner:agent",
	consumer_ref: "consumer:worker",
	consumer_generation: 7,
	lease_ref: "lease:one",
	lease_fence: 5,
};

export const capabilityCatalog = {
	schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_SCHEMA,
	capabilities: [{
		capability_id: "message.search",
		label: "Search messages",
		effect: "read",
		target_requirement: "required",
		input_contract: { type: "object" },
		evidence_requirement: "provider_result",
		targets: [{
			target_ref: `target:${"8".repeat(64)}`,
			label: "Workspace",
			connector_kind: "slack",
			target_kind: "conversation",
			readiness: "ready",
		}],
	}],
};

export const notionCatalog = {
	schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_SCHEMA,
	capabilities: [{
		capability_id: "notion.search",
		label: "Search Notion",
		effect: "read",
		target_requirement: "required",
		input_contract: { type: "object", properties: { query: { type: "string" } } },
		evidence_requirement: "provider_result",
		targets: [{
			target_ref: `target:${"9".repeat(64)}`,
			label: "Notion workspace",
			connector_kind: "notion",
			target_kind: "workspace",
			readiness: "ready",
		}],
	}],
};

export function asRecord(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("expected object");
	}
	return value as Record<string, unknown>;
}

export function nest(value: unknown, ...keys: string[]): Record<string, unknown> {
	return keys.reduce<unknown>((current, key) => asRecord(current)[key], value) as Record<string, unknown>;
}
