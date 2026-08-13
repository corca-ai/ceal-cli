import type { CealCapabilityAccessDescriptor, CealGatewayDiscoveryCapability, CealGatewayDiscoveryTarget } from "@corca-ai/ceal-protocol";
import { isCealPublicSafeText } from "@corca-ai/ceal-protocol";

/** The additive target identity facts supplied by the signed Gateway contract. */
export interface CealDiscoveryTargetMetadata {
	connector_kind: string;
	target_kind: string;
}

type DiscoveryTargetWithMetadata = CealGatewayDiscoveryTarget & CealDiscoveryTargetMetadata;
const CONNECTOR_KIND = /^[a-z][a-z0-9-]{0,63}$/u;
const TARGET_KIND = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/u;

export type CealRenderedCapabilityAccess = CealCapabilityAccessDescriptor & {
	effect: CealGatewayDiscoveryCapability["effect"];
	writable: boolean;
};

export type CealRenderedDiscoveryTarget = Omit<CealGatewayDiscoveryTarget, "capability_access"> &
	CealDiscoveryTargetMetadata & {
		capability_access: CealRenderedCapabilityAccess[];
	};

/**
 * Join target-granted access with the catalog descriptor that owns the effect.
 *
 * The metadata intersection is intentional: the currently pinned Protocol
 * decoder removes these additive fields, so callers must fail closed until the
 * signed handoff that declares them is consumed. There is no guessed kind or
 * legacy target projection here.
 */
export function renderCapabilityTargets(
	targets: readonly DiscoveryTargetWithMetadata[],
	capabilities: readonly CealGatewayDiscoveryCapability[],
): CealRenderedDiscoveryTarget[] {
	const descriptorById = new Map<string, CealGatewayDiscoveryCapability>();
	for (const capability of capabilities) {
		if (descriptorById.has(capability.capability_id)) {
			throw new TypeError(`Duplicate capability descriptor '${capability.capability_id}'.`);
		}
		descriptorById.set(capability.capability_id, capability);
	}

	return targets.map((target) => {
		const connectorKind = requiredTargetMetadata(target.connector_kind, "connector_kind", CONNECTOR_KIND);
		const targetKind = requiredTargetMetadata(target.target_kind, "target_kind", TARGET_KIND);
		const capabilityAccess = target.capability_access.map((access) => {
			const descriptor = descriptorById.get(access.capability_id);
			if (!descriptor) {
				throw new TypeError(`Target '${target.target_ref}' names an undiscovered capability '${access.capability_id}'.`);
			}
			return {
				...access,
				effect: descriptor.effect,
				writable: descriptor.effect === "write",
			};
		});
		return {
			connector_kind: connectorKind,
			target_kind: targetKind,
			target_ref: target.target_ref,
			label: target.label,
			access: target.access,
			capability_ids: [...target.capability_ids],
			capability_access: capabilityAccess,
		};
	});
}

function requiredTargetMetadata(value: unknown, field: string, pattern: RegExp): string {
	if (!isCealPublicSafeText(value, 64) || !pattern.test(value)) {
		throw new TypeError(`Gateway target is missing safe '${field}' metadata.`);
	}
	return value;
}
