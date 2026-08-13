import { createHash } from "node:crypto";
import { isCealPublicSafeDisplayName, isCealPublicSafeText, RAW_PROVIDER_REF, SAFE_REF as VALIDATION_SAFE_REF, SECRET_MATERIAL } from "./gateway-validation-primitives.js";

/**
 * Provider-neutral, read-only result custody. This vocabulary is deliberately
 * not an attachment, artifact, or upload vocabulary: a result can be read by
 * a consumer, but it cannot be replayed as a write-capable artifact handle.
 */
export const CEAL_RESULT_MATERIALIZATION_MANIFEST_SCHEMA = "ceal.result_materialization_manifest.v1";
export const CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA = "ceal.result_materialization_frame.v1";

/** The encoded chunk ceiling is the wire grain; the raw ceiling is derived. */
export const CEAL_RESULT_MATERIALIZATION_MAX_CHUNK_BASE64_BYTES = 12 * 1024;
export const CEAL_RESULT_MATERIALIZATION_MAX_CHUNK_BYTES = Math.floor(CEAL_RESULT_MATERIALIZATION_MAX_CHUNK_BASE64_BYTES / 4) * 3;
export const CEAL_RESULT_MATERIALIZATION_MAX_FILES = 16;
export const CEAL_RESULT_MATERIALIZATION_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const CEAL_RESULT_MATERIALIZATION_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const CEAL_RESULT_MATERIALIZATION_MAX_CHUNKS_PER_FILE = Math.ceil(CEAL_RESULT_MATERIALIZATION_MAX_FILE_BYTES / CEAL_RESULT_MATERIALIZATION_MAX_CHUNK_BYTES);
export const CEAL_RESULT_MATERIALIZATION_MAX_MANIFEST_BYTES = 24 * 1024;
export const CEAL_RESULT_MATERIALIZATION_MAX_PREVIEW_BYTES = 4 * 1024;

const SAFE_MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const SAFE_MEDIA_PATH = /^media\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const RESULT_MATERIALIZATION_REF = /^result:[a-f0-9]{64}$/u;

export type CealResultMaterializationUnreadReason =
	| "blocked"
	| "unavailable"
	| "too_large"
	| "unsupported"
	| "download_failed"
	| "permission_denied";

export interface CealResultMaterializedFile {
	slot: number;
	path: string;
	display_name: string;
	media_type: string;
	status: "materialized";
	byte_count: number;
	sha256: string;
}

export interface CealResultTypedUnreadFile {
	slot: number;
	path: string;
	display_name: string;
	media_type: string;
	status: "typed_unread";
	unread_reason: CealResultMaterializationUnreadReason;
}

export type CealResultMaterializationFile = CealResultMaterializedFile | CealResultTypedUnreadFile;

export interface CealResultMaterializationManifest {
	schema_version: typeof CEAL_RESULT_MATERIALIZATION_MANIFEST_SCHEMA;
	materialization_ref: string;
	format: "markdown";
	preview: string;
	complete: boolean;
	files: readonly CealResultMaterializationFile[];
}

export type CealResultMaterializationFrame =
	| {
		schema_version: typeof CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA;
		kind: "manifest";
		manifest: CealResultMaterializationManifest;
		manifest_sha256: string;
	}
	| {
		schema_version: typeof CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA;
		kind: "chunk";
		slot: number;
		chunk_index: number;
		chunk_count: number;
		bytes_base64: string;
	}
	| {
		schema_version: typeof CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA;
		kind: "terminal";
		manifest_sha256: string;
		file_count: number;
	};

export interface CealLeasedConsumerResultMaterializationInput {
	event_ref: string;
	lease_ref: string;
	lease_fence: number;
	result_ref: string;
	frame_index: number;
}

export type CealLeasedConsumerResultMaterializationResult =
	| { status: "frame"; frame: CealResultMaterializationFrame }
	| { status: "materialization_unavailable" | "lease_lost" | "lease_expired" | "event_settled" | "authentication_failed" | "control_unavailable" };

export function decodeResultMaterializationInput(value: unknown): void {
	const record = plainRecord(value);
	if (!exactKeys(record, ["event_ref", "frame_index", "lease_fence", "lease_ref", "result_ref"])
		|| !safeControlRef(record.event_ref) || !safeControlRef(record.lease_ref) || !isPositiveInteger(record.lease_fence)
		|| !isSafeRef(record.result_ref) || !isNonNegativeInteger(record.frame_index)) invalidFrame();
}

export function decodeResultMaterializationResult(value: unknown): void {
	const record = plainRecord(value);
	if (record.status === "frame") {
		if (!exactKeys(record, ["frame", "status"])) invalidFrame();
		decodeCealResultMaterializationFrame(record.frame);
		return;
	}
	if (!exactKeys(record, ["status"])
		|| !["materialization_unavailable", "lease_lost", "lease_expired", "event_settled", "authentication_failed", "control_unavailable"].includes(String(record.status))) invalidFrame();
}

export function sha256CealResultMaterializationBytes(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** Canonical JSON is the digest input; object keys are sorted recursively. */
export function canonicalCealResultMaterializationJson(value: unknown): string {
	return JSON.stringify(sortJson(value));
}

export function sha256CealResultMaterializationJson(value: unknown): string {
	return sha256CealResultMaterializationBytes(new TextEncoder().encode(canonicalCealResultMaterializationJson(value)));
}

/** The sole owner of result materialization's deterministic file-slot paths. */
export function cealResultMaterializationSlotPath(slot: number): string {
	if (!Number.isSafeInteger(slot) || slot < 0 || slot >= CEAL_RESULT_MATERIALIZATION_MAX_FILES) throw new RangeError("Result materialization slot is invalid");
	return slot === 0 ? "document.md" : `media/file-${String(slot).padStart(3, "0")}.bin`;
}

/** Strict protocol decoder for the manifest, independent of any Gateway authority. */
export function decodeCealResultMaterializationManifest(value: unknown): CealResultMaterializationManifest {
	const record = plainRecord(value);
	validateManifestRecord(record);
	const files = parseFiles(record.files);
	const manifest: CealResultMaterializationManifest = {
		schema_version: CEAL_RESULT_MATERIALIZATION_MANIFEST_SCHEMA,
		materialization_ref: record.materialization_ref,
		format: "markdown",
		preview: record.preview,
		complete: record.complete,
		files,
	};
	validateManifestSize(manifest);
	return manifest;
}

/** Frame-shape decoder. Ordering, byte counts, and digests are owned by Core. */
export function decodeCealResultMaterializationFrame(value: unknown): CealResultMaterializationFrame {
	const record = plainRecord(value);
	if (record.schema_version !== CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA) invalidFrame();
	if (typeof record.kind !== "string") invalidFrame();
	if (record.kind === "manifest") return parseManifestFrame(record);
	if (record.kind === "chunk") return parseChunkFrame(record);
	if (record.kind === "terminal") return parseTerminalFrame(record);
	invalidFrame();
}

export function isCealResultMaterializationSafePath(value: unknown): value is string {
	return value === "document.md" || (typeof value === "string" && SAFE_MEDIA_PATH.test(value));
}

function parseFile(value: unknown, expectedSlot: number): CealResultMaterializationFile {
	const record = plainRecord(value);
	validateFileBase(record, expectedSlot);
	if (record.status === "materialized") return parseMaterializedFile(record);
	if (record.status === "typed_unread") return parseUnreadFile(record);
	invalidManifest();
}

function validateManifestRecord(record: Record<string, unknown>): asserts record is Record<string, unknown> & { materialization_ref: string; preview: string; complete: boolean; files: unknown[] } {
	if (!exactKeys(record, ["schema_version", "materialization_ref", "format", "preview", "complete", "files"])) invalidManifest();
	if (record.schema_version !== CEAL_RESULT_MATERIALIZATION_MANIFEST_SCHEMA) invalidManifest();
	if (!isSafeRef(record.materialization_ref)) invalidManifest();
	if (record.format !== "markdown") invalidManifest();
	if (!isSafePreview(record.preview)) invalidManifest();
	if (typeof record.complete !== "boolean") invalidManifest();
	if (!Array.isArray(record.files) || record.files.length === 0 || record.files.length > CEAL_RESULT_MATERIALIZATION_MAX_FILES) invalidManifest();
}

function parseFiles(values: readonly unknown[]): CealResultMaterializationFile[] {
	const files = values.map((candidate, index) => parseFile(candidate, index));
	if (new Set(files.map((file) => file.path)).size !== files.length) invalidManifest();
	const totalBytes = files.reduce((total, file) => total + (file.status === "materialized" ? file.byte_count : 0), 0);
	if (totalBytes > CEAL_RESULT_MATERIALIZATION_MAX_TOTAL_BYTES) invalidManifest();
	return files;
}

function validateManifestSize(manifest: CealResultMaterializationManifest): void {
	if (new TextEncoder().encode(canonicalCealResultMaterializationJson(manifest)).byteLength > CEAL_RESULT_MATERIALIZATION_MAX_MANIFEST_BYTES) invalidManifest();
}

function validateFileBase(record: Record<string, unknown>, expectedSlot: number): void {
	if (record.slot !== expectedSlot) invalidManifest();
	if (!isNonNegativeInteger(record.slot)) invalidManifest();
	if (!isCealResultMaterializationSafePath(record.path)) invalidManifest();
	validateFileMetadata(record);
	validateSlotPath(record, expectedSlot);
}

function validateFileMetadata(record: Record<string, unknown>): void {
	if (!isSafeDisplayName(record.display_name)) invalidManifest();
	if (!isSafeMediaType(record.media_type)) invalidManifest();
}

function validateSlotPath(record: Record<string, unknown>, expectedSlot: number): void {
	if (record.path !== cealResultMaterializationSlotPath(expectedSlot)) invalidManifest();
	if (expectedSlot === 0) {
		if (record.status !== "materialized") invalidManifest();
		if (record.media_type !== "text/markdown") invalidManifest();
	}
}

function parseMaterializedFile(record: Record<string, unknown>): CealResultMaterializedFile {
	if (!exactKeys(record, ["slot", "path", "display_name", "media_type", "status", "byte_count", "sha256"])) invalidManifest();
	if (!isNonNegativeInteger(record.byte_count)) invalidManifest();
	if (record.byte_count > CEAL_RESULT_MATERIALIZATION_MAX_FILE_BYTES || !isSha256(record.sha256)) invalidManifest();
	return { slot: record.slot as number, path: record.path as string, display_name: record.display_name as string, media_type: record.media_type as string, status: "materialized", byte_count: record.byte_count, sha256: record.sha256 };
}

function parseUnreadFile(record: Record<string, unknown>): CealResultTypedUnreadFile {
	if (!exactKeys(record, ["slot", "path", "display_name", "media_type", "status", "unread_reason"]) || !isUnreadReason(record.unread_reason)) invalidManifest();
	return { slot: record.slot as number, path: record.path as string, display_name: record.display_name as string, media_type: record.media_type as string, status: "typed_unread", unread_reason: record.unread_reason };
}

function parseManifestFrame(record: Record<string, unknown>): CealResultMaterializationFrame {
	if (!exactKeys(record, ["schema_version", "kind", "manifest", "manifest_sha256"]) || !isSha256(record.manifest_sha256)) invalidFrame();
	const manifest = decodeCealResultMaterializationManifest(record.manifest);
	if (record.manifest_sha256 !== sha256CealResultMaterializationJson(manifest)) invalidFrame();
	return { schema_version: CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA, kind: "manifest", manifest, manifest_sha256: record.manifest_sha256 };
}

function parseChunkFrame(record: Record<string, unknown>): CealResultMaterializationFrame {
	if (!exactKeys(record, ["schema_version", "kind", "slot", "chunk_index", "chunk_count", "bytes_base64"])) invalidFrame();
	if (!isNonNegativeInteger(record.slot) || !isNonNegativeInteger(record.chunk_index) || !isPositiveInteger(record.chunk_count)) invalidFrame();
	if (record.chunk_count > CEAL_RESULT_MATERIALIZATION_MAX_CHUNKS_PER_FILE) invalidFrame();
	if (record.chunk_index >= record.chunk_count || !isBase64Chunk(record.bytes_base64)) invalidFrame();
	return { schema_version: CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA, kind: "chunk", slot: record.slot, chunk_index: record.chunk_index, chunk_count: record.chunk_count, bytes_base64: record.bytes_base64 };
}

function parseTerminalFrame(record: Record<string, unknown>): CealResultMaterializationFrame {
	if (!exactKeys(record, ["schema_version", "kind", "manifest_sha256", "file_count"]) || !isSha256(record.manifest_sha256)) invalidFrame();
	if (!isPositiveInteger(record.file_count) || record.file_count > CEAL_RESULT_MATERIALIZATION_MAX_FILES) invalidFrame();
	return { schema_version: CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA, kind: "terminal", manifest_sha256: record.manifest_sha256, file_count: record.file_count };
}

function isSafeRef(value: unknown): value is string {
	return typeof value === "string" && RESULT_MATERIALIZATION_REF.test(value) && VALIDATION_SAFE_REF.test(value) && !SECRET_MATERIAL.test(value) && !RAW_PROVIDER_REF.test(value);
}

function safeControlRef(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function isSafeDisplayName(value: unknown): value is string {
	return isCealPublicSafeDisplayName(value);
}

function isSafePreview(value: unknown): value is string {
	return isCealPublicSafeText(value, CEAL_RESULT_MATERIALIZATION_MAX_PREVIEW_BYTES);
}

function isSafeMediaType(value: unknown): value is string {
	return typeof value === "string" && SAFE_MEDIA_TYPE.test(value);
}

function isSha256(value: unknown): value is string {
	return typeof value === "string" && SHA256.test(value);
}

function isBase64Chunk(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= CEAL_RESULT_MATERIALIZATION_MAX_CHUNK_BASE64_BYTES && value.length % 4 === 0 && BASE64.test(value);
}

function isUnreadReason(value: unknown): value is CealResultMaterializationUnreadReason {
	return value === "blocked" || value === "unavailable" || value === "too_large" || value === "unsupported" || value === "download_failed" || value === "permission_denied";
}

function isPositiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function plainRecord(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) invalidFrame();
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(record).length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson);
	if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, sortJson(child)]));
	return value;
}

function invalidManifest(): never {
	throw new TypeError("Ceal result materialization manifest is invalid");
}

function invalidFrame(): never {
	throw new TypeError("Ceal result materialization frame is invalid");
}
