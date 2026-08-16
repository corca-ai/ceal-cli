import { opaqueArtifactRef } from "./leased-consumer-opaque-refs.ts";

export const CEAL_LEASED_CONSUMER_FILE_UPLOAD_ARGUMENTS_SCHEMA = "ceal.gateway_leased_agent_file_upload_arguments.v1" as const;
export const CEAL_LEASED_CONSUMER_FILE_UPLOAD_DATA_SCHEMA = "ceal.gateway_leased_agent_file_upload_data.v1" as const;

export interface CealLeasedConsumerFileUploadArguments {
	schema_version: typeof CEAL_LEASED_CONSUMER_FILE_UPLOAD_ARGUMENTS_SCHEMA;
	artifact_ref: string;
	name: string;
}

export interface CealLeasedConsumerFileUploadData {
	schema_version: typeof CEAL_LEASED_CONSUMER_FILE_UPLOAD_DATA_SCHEMA;
	terminal: "readback_confirmed" | "idempotency_replayed";
}

export function decodeCealLeasedConsumerFileUploadArguments(value: unknown): void {
	if (!plainRecord(value) || !exactKeys(value, ["artifact_ref", "name", "schema_version"])) invalid();
	if (value.schema_version !== CEAL_LEASED_CONSUMER_FILE_UPLOAD_ARGUMENTS_SCHEMA
		|| !opaqueArtifactRef(value.artifact_ref) || !safeFileName(value.name)) invalid();
}

export function validCealLeasedConsumerFileUploadData(value: unknown): value is CealLeasedConsumerFileUploadData {
	return plainRecord(value) && exactKeys(value, ["schema_version", "terminal"])
		&& value.schema_version === CEAL_LEASED_CONSUMER_FILE_UPLOAD_DATA_SCHEMA
		&& ["readback_confirmed", "idempotency_replayed"].includes(String(value.terminal));
}

function safeFileName(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).byteLength <= 256
		&& value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\")
		&& ![...value].some((character) => { const code = character.codePointAt(0); return code !== undefined && (code < 32 || code === 127); });
}
function plainRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean { const keys = Object.keys(value).sort(); const ordered = [...expected].sort(); return keys.length === ordered.length && keys.every((key, index) => key === ordered[index]); }
function invalid(): never { throw new TypeError("Ceal leased-consumer control record is invalid"); }
