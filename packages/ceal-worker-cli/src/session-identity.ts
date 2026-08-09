import { createHash } from "node:crypto";
import type { CealStoredSession } from "./profile-store.js";

// One home for the bindings that define which operator identity a stored
// session represents. Enrollment replacement and every session-derived local
// store must agree on this population; spelling it twice is how one store can
// retain another subject's data after a replacement.
const SESSION_IDENTITY_BINDINGS = [
	["gateway_endpoint", (session: CealStoredSession) => session.gatewayEndpoint],
	["profile_ref", (session: CealStoredSession) => session.profileRef],
	["membership_ref", (session: CealStoredSession) => session.membershipRef],
	["subject_ref", (session: CealStoredSession) => session.subjectRef],
	["instance_ref", (session: CealStoredSession) => session.instanceRef],
] as const;

export function changedSessionIdentityBindings(current: CealStoredSession, incoming: CealStoredSession): readonly string[] {
	return SESSION_IDENTITY_BINDINGS.filter(([, read]) => read(current) !== read(incoming)).map(([name]) => name);
}

/**
 * Stable, non-reversible key for session-derived advisory state.
 *
 * Registration and client refs deliberately do not participate: a same-identity
 * re-enrollment legitimately replaces those enrollment artifacts. Raw identity
 * values never enter the receipt store.
 */
export function sessionIdentityDiscriminator(session: CealStoredSession): string {
	const identity = SESSION_IDENTITY_BINDINGS.map(([name, read]) => [name, read(session)]);
	return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export function validSessionIdentityDiscriminator(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
