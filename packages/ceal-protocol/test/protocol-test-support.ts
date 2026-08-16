import { CealProtocolValidationError, type CealClientFailure, type CealClientSuccess } from "../dist/index.js";

/**
 * JSON fixture tree mutated before decode. The decoder takes `unknown`; this is
 * the one named untyped shape instead of scattering assertions through tests.
 */
export type JsonRecord = any;
export type JsonValue = JsonRecord;

export function cloneJson(value: unknown): JsonRecord {
	return JSON.parse(JSON.stringify(value)) as JsonRecord;
}

export function requireString(value: string | undefined, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
}

export function asJsonRecord(value: unknown): JsonRecord {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("expected a JSON object");
	}
	return value as JsonRecord;
}

export function asJsonArray(value: unknown): JsonValue[] {
	if (!Array.isArray(value)) throw new Error("expected a JSON array");
	return value;
}

export function hasCode(code: string): (error: unknown) => boolean {
	return (error: unknown) => error instanceof CealProtocolValidationError && error.code === code;
}

export function requireClientSuccess<T>(result: { ok: boolean }): CealClientSuccess<T> {
	if (result.ok !== true) throw new Error("expected a successful client response");
	return result as CealClientSuccess<T>;
}

export function requireClientFailure(result: { ok: boolean }): CealClientFailure {
	if (result.ok !== false) throw new Error("expected a failed client response");
	return result as CealClientFailure;
}

export function isErrorWithCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && (error as { code: unknown }).code === code;
}

export function nonCanonicalBase64urlAlias(value: string): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	const index = alphabet.indexOf(value.at(-1) ?? "");
	const unusedBits = (value.length * 6) % 8;
	if (index < 0 || unusedBits === 0) throw new TypeError("A padded base64url value is required");
	const aliasIndex = index + 1;
	if (aliasIndex >= alphabet.length || index >> unusedBits !== aliasIndex >> unusedBits) {
		throw new TypeError("The base64url value is not in canonical padded-bit form");
	}
	return `${value.slice(0, -1)}${alphabet[aliasIndex]}`;
}
