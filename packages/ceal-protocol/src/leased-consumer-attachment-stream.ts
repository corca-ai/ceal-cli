import { createHash } from "node:crypto";

/**
 * Candidate-only Worker attachment carrier. It is deliberately separate from
 * result materialization: the latter carries result_ref/chunk custody, while
 * this family carries one complete lease-bound attachment set.
 */
export const CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_REQUEST_SCHEMA = "ceal.leased_consumer_attachment_stream_request.v1" as const;
export const CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MANIFEST_SCHEMA = "ceal.leased_consumer_attachment_stream_manifest.v1" as const;
export const CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA = "ceal.leased_consumer_attachment_stream_frame.v1" as const;
export const CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_TRANSPORT_SCHEMA = "ceal.leased_consumer_attachment_stream_transport.v1" as const;

/** Eight bytes: the stream is not a JSON response and must fail closed on a wrong route. */
export const CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAGIC = new Uint8Array([0x43, 0x45, 0x41, 0x4c, 0x41, 0x53, 0x31, 0x00]);
export const CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES = 8;
export const CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_HEADER_BYTES = 16 * 1024;
export const CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_RECORD_BYTES =
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_HEADER_BYTES + CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_ATTACHMENT_BYTES;

export const CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_EFFECTIVE_LIMITS = Object.freeze({
	max_attachment_count: 16,
	max_attachment_bytes: 50 * 1024 * 1024,
	max_total_bytes: 16 * 50 * 1024 * 1024,
});
export const CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_SAFETY_LIMITS = Object.freeze({
	max_attachment_count: 16,
	max_attachment_bytes: 50 * 1024 * 1024,
	max_total_bytes: 100 * 1024 * 1024,
});

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const UNREAD_REASONS = new Set(["blocked", "unavailable", "too_large", "unsupported", "download_failed", "digest_mismatch"]);

export type CealLeasedConsumerAttachmentStreamUnreadReason =
	| "blocked"
	| "unavailable"
	| "too_large"
	| "unsupported"
	| "download_failed"
	| "digest_mismatch";

export interface CealLeasedConsumerAttachmentStreamRequest {
	schema_version: typeof CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_REQUEST_SCHEMA;
	event_ref: string;
	lease_ref: string;
	lease_fence: number;
}

export interface CealLeasedConsumerAttachmentStreamBinding {
	event_ref: string;
	event_revision: number;
	normalized_projection_revision: number;
	requester_subject_ref: string;
	lease_ref: string;
	lease_fence: number;
	consumer_ref: string;
	consumer_generation: number;
	attachment_set_ref: string;
}

export interface CealLeasedConsumerAttachmentStreamLimits {
	max_attachment_count: number;
	max_attachment_bytes: number;
	max_total_bytes: number;
}

interface AttachmentBase {
	attachment_ref: string;
	slot: number;
	display_name: string;
	declared_media_type: string;
	observed_media_type: string;
}

export interface CealLeasedConsumerAttachmentStreamMaterializedAttachment extends AttachmentBase {
	status: "materialized";
	size_bytes: number;
	sha256: string;
}

export interface CealLeasedConsumerAttachmentStreamUnreadAttachment extends AttachmentBase {
	status: "unread";
	unread_reason: CealLeasedConsumerAttachmentStreamUnreadReason;
}

export type CealLeasedConsumerAttachmentStreamAttachment =
	| CealLeasedConsumerAttachmentStreamMaterializedAttachment
	| CealLeasedConsumerAttachmentStreamUnreadAttachment;

export interface CealLeasedConsumerAttachmentStreamManifest {
	schema_version: typeof CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MANIFEST_SCHEMA;
	binding: CealLeasedConsumerAttachmentStreamBinding;
	materialization_ref: string;
	limits: {
		effective: CealLeasedConsumerAttachmentStreamLimits;
		safety: CealLeasedConsumerAttachmentStreamLimits;
	};
	attachments: readonly CealLeasedConsumerAttachmentStreamAttachment[];
}

export type CealLeasedConsumerAttachmentStreamFrameHeader =
	| {
		schema_version: typeof CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA;
		kind: "manifest";
		manifest: CealLeasedConsumerAttachmentStreamManifest;
		manifest_sha256: string;
	}
	| {
		schema_version: typeof CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA;
		kind: "attachment";
		slot: number;
		byte_length: number;
	}
	| {
		schema_version: typeof CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA;
		kind: "terminal";
		manifest_sha256: string;
		slot_count: number;
	};

export interface DecodedCealLeasedConsumerAttachmentStreamRecord {
	header: CealLeasedConsumerAttachmentStreamFrameHeader;
	payload: Uint8Array;
}

export class CealLeasedConsumerAttachmentStreamError extends TypeError {
	readonly code: string;

	constructor(code: string) {
		super("Ceal leased-consumer attachment stream record is invalid");
		this.name = "CealLeasedConsumerAttachmentStreamError";
		this.code = code;
	}
}

export function decodeCealLeasedConsumerAttachmentStreamRequest(value: unknown): CealLeasedConsumerAttachmentStreamRequest {
	const record = requireRecord(value, "invalid_request");
	requireExactKeys(record, ["event_ref", "lease_fence", "lease_ref", "schema_version"], "invalid_request");
	if (record.schema_version !== CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_REQUEST_SCHEMA
		|| !safeRef(record.event_ref) || !safeRef(record.lease_ref) || !positiveInteger(record.lease_fence)) {
		invalid("invalid_request");
	}
	return { schema_version: CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_REQUEST_SCHEMA, event_ref: record.event_ref, lease_ref: record.lease_ref, lease_fence: record.lease_fence };
}

export function validateCealLeasedConsumerAttachmentStreamManifest(value: unknown): CealLeasedConsumerAttachmentStreamManifest {
	const record = requireRecord(value, "invalid_manifest");
	requireExactKeys(record, ["attachments", "binding", "limits", "materialization_ref", "schema_version"], "invalid_manifest");
	if (record.schema_version !== CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MANIFEST_SCHEMA || !safeRef(record.materialization_ref)) invalid("invalid_manifest");
	const binding = validateBinding(record.binding);
	const limits = validateLimits(record.limits);
	if (!Array.isArray(record.attachments) || record.attachments.length < 1 || record.attachments.length > limits.effective.max_attachment_count) invalid("invalid_manifest");
	const refs = new Set<string>();
	const slots = new Set<number>();
	const attachments = record.attachments.map((candidate) => validateAttachment(candidate, limits.effective.max_attachment_bytes));
	for (const attachment of attachments) {
		if (refs.has(attachment.attachment_ref) || slots.has(attachment.slot)) invalid("duplicate_attachment");
		refs.add(attachment.attachment_ref); slots.add(attachment.slot);
	}
	if (!attachments.every((attachment, index) => index === 0 || attachments[index - 1]!.slot < attachment.slot)) invalid("invalid_manifest");
	if (attachments.reduce((total, attachment) => total + (attachment.status === "materialized" ? attachment.size_bytes : 0), 0) > limits.effective.max_total_bytes) invalid("invalid_manifest");
	return { schema_version: CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MANIFEST_SCHEMA, binding, materialization_ref: record.materialization_ref, limits, attachments };
}

export function attachmentStreamManifestSha256(manifest: CealLeasedConsumerAttachmentStreamManifest): string {
	return sha256Hex(new TextEncoder().encode(stableJson(manifest)));
}

export function attachmentStreamMaterializedBytes(manifest: CealLeasedConsumerAttachmentStreamManifest): number {
	return manifest.attachments.reduce((total, attachment) => total + (attachment.status === "materialized" ? attachment.size_bytes : 0), 0);
}

export function attachmentStreamExceedsSafety(manifest: CealLeasedConsumerAttachmentStreamManifest): boolean {
	const safety = manifest.limits.safety;
	return manifest.attachments.length > safety.max_attachment_count
		|| manifest.attachments.some((attachment) => attachment.status === "materialized" && attachment.size_bytes > safety.max_attachment_bytes)
		|| attachmentStreamMaterializedBytes(manifest) > safety.max_total_bytes;
}

export function decodeCealLeasedConsumerAttachmentStreamFrameHeader(value: unknown): CealLeasedConsumerAttachmentStreamFrameHeader {
	const record = requireRecord(value, "invalid_frame");
	if (record.schema_version !== CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA || typeof record.kind !== "string") invalid("invalid_frame");
	switch (record.kind) {
		case "manifest": return decodeManifestFrame(record);
		case "attachment": return decodeAttachmentFrame(record);
		case "terminal": return decodeTerminalFrame(record);
		default: invalid("invalid_frame");
	}
}

export function encodeCealLeasedConsumerAttachmentStreamRecord(
	header: CealLeasedConsumerAttachmentStreamFrameHeader,
	payload: Uint8Array = new Uint8Array(),
): Uint8Array {
	const decoded = decodeCealLeasedConsumerAttachmentStreamFrameHeader(header);
	if (!(payload instanceof Uint8Array)) invalid("invalid_payload");
	if (decoded.kind !== "attachment" && payload.byteLength !== 0) invalid("unexpected_payload");
	if (decoded.kind === "attachment" && payload.byteLength !== decoded.byte_length) invalid("attachment_length_mismatch");
	const headerBytes = new TextEncoder().encode(stableJson(decoded));
	if (headerBytes.byteLength > CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_HEADER_BYTES
		|| headerBytes.byteLength + payload.byteLength > CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_RECORD_BYTES) invalid("frame_too_large");
	const record = new Uint8Array(CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES + headerBytes.byteLength + payload.byteLength);
	const view = new DataView(record.buffer);
	view.setUint32(0, headerBytes.byteLength);
	view.setUint32(4, payload.byteLength);
	record.set(headerBytes, CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES);
	record.set(payload, CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES + headerBytes.byteLength);
	return record;
}

export function decodeCealLeasedConsumerAttachmentStreamRecord(value: Uint8Array): DecodedCealLeasedConsumerAttachmentStreamRecord {
	if (!(value instanceof Uint8Array) || value.byteLength < CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES) invalid("invalid_record");
	const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
	const headerBytes = view.getUint32(0);
	const payloadBytes = view.getUint32(4);
	validateRecordLengths(headerBytes, payloadBytes, value.byteLength);
	const header = parseFrameJson(value.subarray(CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES, CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES + headerBytes));
	const decoded = decodeCealLeasedConsumerAttachmentStreamFrameHeader(header);
	validateDecodedPayloadLength(decoded, payloadBytes);
	return { header: decoded, payload: new Uint8Array(value.subarray(8 + headerBytes)) };
}

export function sha256Hex(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value: unknown): string {
	return JSON.stringify(sortJson(value));
}

function validateBinding(value: unknown): CealLeasedConsumerAttachmentStreamBinding {
	const record = requireRecord(value, "invalid_binding");
	requireExactKeys(record, ["attachment_set_ref", "consumer_generation", "consumer_ref", "event_ref", "event_revision", "lease_fence", "lease_ref", "normalized_projection_revision", "requester_subject_ref"], "invalid_binding");
	if (!safeRef(record.event_ref) || !positiveInteger(record.event_revision) || !positiveInteger(record.normalized_projection_revision)
		|| !safeRef(record.requester_subject_ref) || !safeRef(record.lease_ref) || !positiveInteger(record.lease_fence)
		|| !safeRef(record.consumer_ref) || !positiveInteger(record.consumer_generation) || !safeRef(record.attachment_set_ref)) invalid("invalid_binding");
	return record as unknown as CealLeasedConsumerAttachmentStreamBinding;
}

function validateLimits(value: unknown): { effective: CealLeasedConsumerAttachmentStreamLimits; safety: CealLeasedConsumerAttachmentStreamLimits } {
	const record = requireRecord(value, "invalid_limits");
	requireExactKeys(record, ["effective", "safety"], "invalid_limits");
	const effective = validateLimitSet(record.effective);
	const safety = validateLimitSet(record.safety);
	if (safety.max_attachment_count > effective.max_attachment_count || safety.max_attachment_bytes > effective.max_attachment_bytes || safety.max_total_bytes > effective.max_total_bytes) invalid("invalid_limits");
	return { effective, safety };
}

function validateLimitSet(value: unknown): CealLeasedConsumerAttachmentStreamLimits {
	const record = requireRecord(value, "invalid_limits");
	requireExactKeys(record, ["max_attachment_bytes", "max_attachment_count", "max_total_bytes"], "invalid_limits");
	if (!positiveInteger(record.max_attachment_count) || record.max_attachment_count > 16 || !positiveInteger(record.max_attachment_bytes)
		|| record.max_attachment_bytes > CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_ATTACHMENT_BYTES || !positiveInteger(record.max_total_bytes)
		|| record.max_total_bytes > CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_EFFECTIVE_LIMITS.max_total_bytes) invalid("invalid_limits");
	return record as unknown as CealLeasedConsumerAttachmentStreamLimits;
}

function validateAttachment(value: unknown, effectiveMaxBytes: number): CealLeasedConsumerAttachmentStreamAttachment {
	const record = requireRecord(value, "invalid_attachment");
	if (record.status === "materialized") {
		requireExactKeys(record, ["attachment_ref", "declared_media_type", "display_name", "observed_media_type", "sha256", "size_bytes", "slot", "status"], "invalid_attachment");
		if (!baseAttachment(record) || !positiveInteger(record.size_bytes) || record.size_bytes > effectiveMaxBytes || !sha256Value(record.sha256)) invalid("invalid_attachment");
		return record as unknown as CealLeasedConsumerAttachmentStreamMaterializedAttachment;
	}
	if (record.status === "unread") {
		requireExactKeys(record, ["attachment_ref", "declared_media_type", "display_name", "observed_media_type", "slot", "status", "unread_reason"], "invalid_attachment");
		if (!baseAttachment(record) || !UNREAD_REASONS.has(String(record.unread_reason))) invalid("invalid_attachment");
		return record as unknown as CealLeasedConsumerAttachmentStreamUnreadAttachment;
	}
	invalid("invalid_attachment");
}

function baseAttachment(record: Record<string, unknown>): boolean {
	return safeRef(record.attachment_ref) && nonNegativeInteger(record.slot) && safeDisplayName(record.display_name)
		&& mediaType(record.declared_media_type) && mediaType(record.observed_media_type);
}
function safeDisplayName(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.length > 255) return false;
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code <= 0x1f || character === "/" || character === "\\") return false;
	}
	return true;
}
function mediaType(value: unknown): value is string { return typeof value === "string" && MEDIA_TYPE.test(value); }
function safeRef(value: unknown): value is string { return typeof value === "string" && SAFE_REF.test(value); }
function sha256Value(value: unknown): value is string { return typeof value === "string" && SHA256.test(value); }
function positiveInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 1; }
function nonNegativeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function requireRecord(value: unknown, code: string): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(code); return value as Record<string, unknown>; }
function requireExactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
	const actual = Object.keys(value).sort(); const keys = [...expected].sort();
	if (actual.length !== keys.length || !actual.every((key, index) => key === keys[index])) invalid(code);
}
function decodeManifestFrame(record: Record<string, unknown>): CealLeasedConsumerAttachmentStreamFrameHeader {
	requireExactKeys(record, ["kind", "manifest", "manifest_sha256", "schema_version"], "invalid_frame");
	const manifest = validateCealLeasedConsumerAttachmentStreamManifest(record.manifest);
	if (!sha256Value(record.manifest_sha256) || record.manifest_sha256 !== attachmentStreamManifestSha256(manifest)) invalid("manifest_digest_mismatch");
	return { schema_version: CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA, kind: "manifest", manifest, manifest_sha256: record.manifest_sha256 };
}
function decodeAttachmentFrame(record: Record<string, unknown>): CealLeasedConsumerAttachmentStreamFrameHeader {
	requireExactKeys(record, ["byte_length", "kind", "schema_version", "slot"], "invalid_frame");
	if (!nonNegativeInteger(record.slot) || !positiveInteger(record.byte_length) || record.byte_length > CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_ATTACHMENT_BYTES) invalid("invalid_attachment_frame");
	return { schema_version: CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA, kind: "attachment", slot: record.slot, byte_length: record.byte_length };
}
function decodeTerminalFrame(record: Record<string, unknown>): CealLeasedConsumerAttachmentStreamFrameHeader {
	requireExactKeys(record, ["kind", "manifest_sha256", "schema_version", "slot_count"], "invalid_frame");
	if (!sha256Value(record.manifest_sha256) || !nonNegativeInteger(record.slot_count)) invalid("invalid_terminal");
	return { schema_version: CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA, kind: "terminal", manifest_sha256: record.manifest_sha256, slot_count: record.slot_count };
}
function validateRecordLengths(headerBytes: number, payloadBytes: number, recordBytes: number): void {
	if (headerBytes === 0 || headerBytes > CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_HEADER_BYTES
		|| payloadBytes > CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_ATTACHMENT_BYTES
		|| headerBytes + payloadBytes + CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES !== recordBytes) invalid("invalid_record_length");
}
function parseFrameJson(value: Uint8Array): unknown {
	try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)); }
	catch { invalid("invalid_frame_json"); }
}
function validateDecodedPayloadLength(decoded: CealLeasedConsumerAttachmentStreamFrameHeader, payloadBytes: number): void {
	if (decoded.kind !== "attachment" && payloadBytes !== 0) invalid("unexpected_payload");
	if (decoded.kind === "attachment" && decoded.byte_length !== payloadBytes) invalid("attachment_length_mismatch");
}
function invalid(code: string): never { throw new CealLeasedConsumerAttachmentStreamError(code); }
function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson);
	if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortJson(child)]));
	return value;
}
