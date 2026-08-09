import { CEAL_SAFE_REF, CEAL_SAFE_TARGET_REF } from "./safe-ref.js";

export function validCapabilityId(value: string | undefined): value is string {
	return typeof value === "string" && CEAL_SAFE_REF.test(value);
}

export function validTargetRef(value: string | undefined): value is string {
	return typeof value === "string" && CEAL_SAFE_TARGET_REF.test(value);
}
