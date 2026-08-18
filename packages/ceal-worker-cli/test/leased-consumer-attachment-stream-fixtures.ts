import { createHash } from "node:crypto";
import {
	attachmentStreamManifestSha256,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_EFFECTIVE_LIMITS,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAGIC,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_SAFETY_LIMITS,
	type CealLeasedConsumerAttachmentStreamBinding,
	type CealLeasedConsumerAttachmentStreamManifest,
	encodeCealLeasedConsumerAttachmentStreamRecord,
} from "@corca-ai/ceal-protocol";

type ManifestOverrides = Partial<CealLeasedConsumerAttachmentStreamManifest["limits"]>;
type AttachmentPayload = readonly [slot: number, bytes: Uint8Array];
type StreamOptions = ManifestOverrides & {
	omit_terminal?: boolean;
	terminal_manifest_sha256?: string;
};

export const binding: CealLeasedConsumerAttachmentStreamBinding = {
	event_ref: "event:attachment-1",
	event_revision: 2,
	normalized_projection_revision: 3,
	requester_subject_ref: "subject:alice",
	lease_ref: "lease:attachment-1",
	lease_fence: 4,
	consumer_ref: "consumer:worker-1",
	consumer_generation: 5,
	attachment_set_ref: "attachment-set:1",
};
export const image = Buffer.from([0, 1, 255, 2]);
export const document = Buffer.from("pdf bytes\n");

export function completeManifest(overrides: ManifestOverrides = {}): CealLeasedConsumerAttachmentStreamManifest {
	return {
		schema_version: "ceal.leased_consumer_attachment_stream_manifest.v1",
		binding,
		materialization_ref: "materialization:attachment-1",
		limits: {
			effective: overrides.effective ?? CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_EFFECTIVE_LIMITS,
			safety: overrides.safety ?? CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_SAFETY_LIMITS,
		},
		attachments: [
			{
				attachment_ref: "attachment:image",
				slot: 0,
				display_name: "photo.png",
				declared_media_type: "image/png",
				observed_media_type: "image/png",
				status: "materialized",
				size_bytes: image.byteLength,
				sha256: digest(image),
			},
			{
				attachment_ref: "attachment:document",
				slot: 1,
				display_name: "notes.pdf",
				declared_media_type: "application/pdf",
				observed_media_type: "application/pdf",
				status: "materialized",
				size_bytes: document.byteLength,
				sha256: digest(document),
			},
			{
				attachment_ref: "attachment:blocked",
				slot: 2,
				display_name: "blocked.docx",
				declared_media_type: "application/octet-stream",
				observed_media_type: "application/octet-stream",
				status: "unread",
				unread_reason: "blocked",
			},
		],
	};
}

export function streamBytes(
	manifest: CealLeasedConsumerAttachmentStreamManifest,
	payloads: readonly AttachmentPayload[],
	options: StreamOptions = {},
): Buffer {
	const manifestSha256 = attachmentStreamManifestSha256(manifest);
	const records = [
		Buffer.from(CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAGIC),
		Buffer.from(
			encodeCealLeasedConsumerAttachmentStreamRecord({
				schema_version: CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA,
				kind: "manifest",
				manifest,
				manifest_sha256: manifestSha256,
			}),
		),
		...payloads.map(([slot, bytes]) =>
			Buffer.from(
				encodeCealLeasedConsumerAttachmentStreamRecord(
					{ schema_version: CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA, kind: "attachment", slot, byte_length: bytes.byteLength },
					bytes,
				),
			),
		),
	];
	if (!options.omit_terminal)
		records.push(
			Buffer.from(
				encodeCealLeasedConsumerAttachmentStreamRecord({
					schema_version: CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA,
					kind: "terminal",
					manifest_sha256: options.terminal_manifest_sha256 ?? manifestSha256,
					slot_count: manifest.attachments.length,
				}),
			),
		);
	return Buffer.concat(records);
}

export async function* chunked(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
	const sizes = [1, 2, 7, 3, 19, 5, 11];
	let offset = 0;
	let index = 0;
	while (offset < bytes.byteLength) {
		const size = sizes[index % sizes.length];
		yield bytes.subarray(offset, offset + size);
		offset += size;
		index += 1;
	}
}

export function digest(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}
