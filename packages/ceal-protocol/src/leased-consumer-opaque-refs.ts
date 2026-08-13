/**
 * Opaque reference grammar for the leased-consumer control carrier.
 *
 * Every reference the Gateway hands an Agent is a kind prefix plus a 32-byte
 * digest: the carrier never transports a provider locator, so a value that does
 * not have this exact shape is not a reference this protocol issued. The
 * predicates are pure and dependency-free, which is why they live apart from
 * the decoders that consume them — that file is at its length limit and these
 * are the piece of it that is genuinely reusable rather than entangled.
 */

const OPAQUE_DIGEST = "[a-f0-9]{64}";

function opaqueRefMatcher(kind: string): (value: unknown) => value is string {
	const pattern = new RegExp(`^${kind}:${OPAQUE_DIGEST}$`, "u");
	return (value: unknown): value is string => typeof value === "string" && pattern.test(value);
}

export const opaqueResultRef = opaqueRefMatcher("result");
export const opaqueTargetRef = opaqueRefMatcher("target");
export const opaqueMessageRef = opaqueRefMatcher("message");
export const opaqueThreadRef = opaqueRefMatcher("thread");
export const opaqueArtifactRef = opaqueRefMatcher("artifact");
export const opaqueDocumentRef = opaqueRefMatcher("document");
export const safeReplyReceiptRef = opaqueRefMatcher("reply-receipt");

export interface CealLeasedConsumerCapabilityHandle {
	kind: "target" | "message" | "thread" | "artifact" | "document";
	ref: string;
}

const CAPABILITY_HANDLE_DECODERS = new Map<string, (value: unknown) => boolean>([
	["target", opaqueTargetRef], ["message", opaqueMessageRef], ["thread", opaqueThreadRef], ["artifact", opaqueArtifactRef], ["document", opaqueDocumentRef],
]);

export function validCealLeasedConsumerCapabilityHandle(value: unknown): value is CealLeasedConsumerCapabilityHandle {
	if (!plainRecord(value) || !exactKeys(value, ["kind", "ref"])) return false;
	return typeof value.kind === "string" && (CAPABILITY_HANDLE_DECODERS.get(value.kind)?.(value.ref) ?? false);
}

function plainRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean { const keys = Object.keys(value).sort(); const ordered = [...expected].sort(); return keys.length === ordered.length && keys.every((key, index) => key === ordered[index]); }
