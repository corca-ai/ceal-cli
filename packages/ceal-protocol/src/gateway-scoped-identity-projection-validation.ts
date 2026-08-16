import { CEAL_GATEWAY_SCOPED_IDENTITY_PROJECTION_SCHEMA } from "./gateway-response-types.ts";
import {
	invalidResponse,
	requireExactKeys,
	requireRecord,
	requireSafeRef,
	requireSafeText,
} from "./gateway-validation-primitives.ts";

export function validateCealGatewayScopedIdentityProjection(value: unknown, handshake: Record<string, unknown>): void {
	const projection = requireRecord(value);
	requireExactKeys(projection, [
		"expires_at", "graph_revision", "instance_ref", "issued_at", "people", "profile_audience_revision",
		"profile_ref", "projection_revision", "schema_version", "subject_key_revision", "truncated",
	]);
	validateEnvelope(projection, handshake);
	if (!Array.isArray(projection.people) || projection.people.length > 128) invalidResponse();
	const subjectRefs = new Set<string>();
	let previous: { displayName: string; subjectRef: string } | null = null;
	for (const person of projection.people) {
		const current = validatePerson(person, subjectRefs);
		if (previous && comparePeople(previous, current) >= 0) invalidResponse();
		previous = current;
	}
}

function validateEnvelope(projection: Record<string, unknown>, handshake: Record<string, unknown>): void {
	if (projection.schema_version !== CEAL_GATEWAY_SCOPED_IDENTITY_PROJECTION_SCHEMA
		|| projection.instance_ref !== handshake.instance_ref
		|| projection.profile_ref !== handshake.profile_ref
		|| typeof projection.truncated !== "boolean") invalidResponse();
	if (!Number.isSafeInteger(projection.profile_audience_revision) || Number(projection.profile_audience_revision) < 1) invalidResponse();
	for (const field of ["graph_revision", "subject_key_revision", "projection_revision"] as const) validateSha256(projection[field]);
	const lifetimeMs = exactIsoTimestamp(projection.expires_at) - exactIsoTimestamp(projection.issued_at);
	if (lifetimeMs < 1_000 || lifetimeMs > 15 * 60 * 1_000) invalidResponse();
}

function validatePerson(value: unknown, subjectRefs: Set<string>): { displayName: string; subjectRef: string } {
	const person = requireRecord(value);
	requireExactKeys(person, ["actor_kind", "display_name", "providers", "subject_ref"]);
	requireSafeRef(person.subject_ref);
	requireSafeText(person.display_name, 256);
	if (person.actor_kind !== "human" || subjectRefs.has(person.subject_ref)) invalidResponse();
	subjectRefs.add(person.subject_ref);
	validateProviders(person.providers);
	return { displayName: person.display_name, subjectRef: person.subject_ref };
}

function comparePeople(left: { displayName: string; subjectRef: string }, right: { displayName: string; subjectRef: string }): number {
	return left.displayName < right.displayName ? -1
		: left.displayName > right.displayName ? 1
		: left.subjectRef < right.subjectRef ? -1
		: left.subjectRef > right.subjectRef ? 1 : 0;
}

function validateProviders(value: unknown): void {
	if (!Array.isArray(value) || value.length < 1 || value.length > 16) invalidResponse();
	const providers = value.map((provider) => {
		if (typeof provider !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/u.test(provider)) invalidResponse();
		return provider;
	});
	if (new Set(providers).size !== providers.length || providers.some((provider, index) => index > 0 && providers[index - 1]! >= provider)) invalidResponse();
}

function validateSha256(value: unknown): void {
	if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) invalidResponse();
}

function exactIsoTimestamp(value: unknown): number {
	if (typeof value !== "string") invalidResponse();
	const milliseconds = Date.parse(value);
	if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) invalidResponse();
	return milliseconds;
}
