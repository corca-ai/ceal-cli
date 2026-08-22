import "../../../test/require-source-lane.ts";
import { renderCapabilityTargets } from "../dist/index.js";
import type { CealGatewayDiscoveryCapability, CealGatewayDiscoveryTarget, CealGatewayRateLimitPolicy } from "@corca-ai/ceal-protocol";
import assert from "node:assert/strict";
import test from "node:test";

const capabilities: CealGatewayDiscoveryCapability[] = [
	{
		capability_id: "sheets.values.read",
		label: "Read sheet values",
		effect: "read",
		target_requirement: "required",
		input_contract: {},
		evidence_requirement: "provider_result",
	},
	{
		capability_id: "sheets.values.clear",
		label: "Clear sheet values",
		effect: "write",
		target_requirement: "required",
		input_contract: {},
		evidence_requirement: "provider_result",
	},
];

const rateLimit: CealGatewayRateLimitPolicy = {
	schema_version: "ceal.gateway_rate_limit_policy.v1",
	counted_unit: "governed_call",
	scope: "authenticated_principal",
	window_model: "rolling",
	max_calls: 10,
	window_ms: 60_000,
};

test("target rendering exposes safe kinds and joins per-capability effect without widening access", () => {
	const targets: CealGatewayDiscoveryTarget[] = [
		{
			connector_kind: "google-workspace",
			target_kind: "sheet",
			target_ref: "target:budget-sheet",
			label: "Budget sheet",
			access: "granted",
			capability_ids: ["sheets.values.read", "sheets.values.clear"],
			capability_access: [
				{
					schema_version: "ceal.capability_access.v1",
					capability_id: "sheets.values.read",
					grant_ref: "grant:budget-read",
					grant_revision: 3,
					readiness: "ready",
				},
				{
					schema_version: "ceal.capability_access.v1",
					capability_id: "sheets.values.clear",
					grant_ref: "grant:budget-clear",
					grant_revision: 2,
					readiness: "degraded",
					rate_limit: rateLimit,
				},
			],
		},
	];

	assert.deepEqual(renderCapabilityTargets(targets, capabilities), [
		{
			connector_kind: "google-workspace",
			target_kind: "sheet",
			target_ref: "target:budget-sheet",
			label: "Budget sheet",
			access: "granted",
			capability_ids: ["sheets.values.read", "sheets.values.clear"],
			capability_access: [
				{
					schema_version: "ceal.capability_access.v1",
					capability_id: "sheets.values.read",
					grant_ref: "grant:budget-read",
					grant_revision: 3,
					readiness: "ready",
					effect: "read",
					writable: false,
				},
				{
					schema_version: "ceal.capability_access.v1",
					capability_id: "sheets.values.clear",
					grant_ref: "grant:budget-clear",
					grant_revision: 2,
					readiness: "degraded",
					rate_limit: rateLimit,
					effect: "write",
					writable: true,
				},
			],
		},
	]);
});

test("target rendering refuses missing metadata or an access row absent from the catalog", () => {
	const target: CealGatewayDiscoveryTarget = {
		connector_kind: "google-workspace",
		target_kind: "sheet",
		target_ref: "target:budget-sheet",
		label: "Budget sheet",
		access: "granted",
		capability_ids: ["sheets.values.read"],
		capability_access: [],
	};
	const missingConnectorKindTarget: CealGatewayDiscoveryTarget = { ...target };
	Reflect.deleteProperty(missingConnectorKindTarget, "connector_kind");
	assert.throws(() => renderCapabilityTargets([missingConnectorKindTarget], capabilities), /missing safe 'connector_kind'/u);
	const unsafeConnectorKindTarget: CealGatewayDiscoveryTarget = {
		...target,
		connector_kind: "provider:internal",
	};
	assert.throws(() => renderCapabilityTargets([unsafeConnectorKindTarget], capabilities), /missing safe 'connector_kind'/u);

	const undiscoveredCapabilityTarget: CealGatewayDiscoveryTarget = {
		...target,
		capability_access: [
			{
				schema_version: "ceal.capability_access.v1",
				capability_id: "not-in-catalog",
				grant_ref: "grant:unknown",
				grant_revision: 1,
				readiness: "unknown",
			},
		],
	};
	assert.throws(() => renderCapabilityTargets([undiscoveredCapabilityTarget], capabilities), /undiscovered capability/u);
});
