import assert from "node:assert/strict";
import test from "node:test";
import { renderCapabilityTargets } from "../dist/index.js";

const capabilities = [
	{ capability_id: "sheets.values.read", effect: "read" },
	{ capability_id: "sheets.values.clear", effect: "write" },
];

const rateLimit = {
	schema_version: "ceal.gateway_rate_limit_policy.v1",
	counted_unit: "governed_call",
	scope: "authenticated_principal",
	window_model: "rolling",
	max_calls: 10,
	window_ms: 60_000,
};

test("target rendering exposes safe kinds and joins per-capability effect without widening access", () => {
	const targets = [
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
	const target = {
		target_ref: "target:budget-sheet",
		label: "Budget sheet",
		access: "granted",
		capability_ids: ["sheets.values.read"],
		capability_access: [],
	};
	assert.throws(() => renderCapabilityTargets([target], capabilities), /missing safe 'connector_kind'/u);
	assert.throws(
		() => renderCapabilityTargets([{ ...target, connector_kind: "provider:internal", target_kind: "sheet" }], capabilities),
		/missing safe 'connector_kind'/u,
	);

	assert.throws(
		() =>
			renderCapabilityTargets(
				[
					{
						...target,
						connector_kind: "google-workspace",
						target_kind: "sheet",
						capability_access: [
							{
								schema_version: "ceal.capability_access.v1",
								capability_id: "not-in-catalog",
								grant_ref: "grant:unknown",
								grant_revision: 1,
								readiness: "unknown",
							},
						],
					},
				],
				capabilities,
			),
		/undiscovered capability/u,
	);
});
