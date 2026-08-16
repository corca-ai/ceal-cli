import assert from "node:assert/strict";
import test from "node:test";
import {
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_EFFECTIVE_LIMITS,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MANIFEST_SCHEMA,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_SAFETY_LIMITS,
	attachmentStreamManifestSha256,
	decodeCealLeasedConsumerAttachmentStreamFrameHeader,
	decodeCealLeasedConsumerAttachmentStreamRecord,
	decodeCealLeasedConsumerAttachmentStreamRequest,
	encodeCealLeasedConsumerAttachmentStreamRecord,
	validateCealLeasedConsumerAttachmentStreamManifest,
} from "../dist/index.js";

const binding = {
	event_ref: "event:stream-1", event_revision: 1, normalized_projection_revision: 1,
	requester_subject_ref: "subject:stream-1", lease_ref: "lease:stream-1", lease_fence: 1,
	consumer_ref: "consumer:stream-1", consumer_generation: 1, attachment_set_ref: "attachment-set:stream-1",
};
const manifest = {
	schema_version: CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MANIFEST_SCHEMA,
	binding,
	materialization_ref: "materialization:stream-1",
	limits: { effective: CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_EFFECTIVE_LIMITS, safety: CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_SAFETY_LIMITS },
	attachments: [
		{ attachment_ref: "attachment:image-1", slot: 0, display_name: "image.png", declared_media_type: "image/png", observed_media_type: "image/png", status: "materialized", size_bytes: 3, sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccce5c9b7e6bdb9e3a7a6b9e" },
		{ attachment_ref: "attachment:document-1", slot: 1, display_name: "notes.pdf", declared_media_type: "application/pdf", observed_media_type: "application/pdf", status: "unread", unread_reason: "unsupported" },
	],
};

test("attachment stream protocol keeps a complete manifest and raw binary payload separate", () => {
	const digest = attachmentStreamManifestSha256(manifest);
	const header = decodeCealLeasedConsumerAttachmentStreamFrameHeader({
		schema_version: CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA,
		kind: "manifest", manifest, manifest_sha256: digest,
	});
	const payload = new Uint8Array([1, 2, 3]);
	const record = encodeCealLeasedConsumerAttachmentStreamRecord({
		schema_version: CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA,
		kind: "attachment", slot: 0, byte_length: payload.byteLength,
	}, payload);
	const decoded = decodeCealLeasedConsumerAttachmentStreamRecord(record);
	assert.equal(header.kind, "manifest");
	assert.deepEqual([...decoded.payload], [...payload]);
	assert.equal(decoded.header.kind, "attachment");
	assert.equal(validateCealLeasedConsumerAttachmentStreamManifest(manifest).attachments.length, 2);
});

test("attachment stream protocol rejects result frames, path/provider leakage, and crossed lengths", () => {
	assert.deepEqual(decodeCealLeasedConsumerAttachmentStreamRequest({
		schema_version: "ceal.leased_consumer_attachment_stream_request.v1",
		event_ref: "event:stream-1", lease_ref: "lease:stream-1", lease_fence: 1,
	}), { schema_version: "ceal.leased_consumer_attachment_stream_request.v1", event_ref: "event:stream-1", lease_ref: "lease:stream-1", lease_fence: 1 });
	assert.throws(() => validateCealLeasedConsumerAttachmentStreamManifest({ ...manifest, gateway_path: "/tmp/provider" }), (error) => error?.code === "invalid_manifest");
	assert.throws(() => decodeCealLeasedConsumerAttachmentStreamFrameHeader({ schema_version: "ceal.result_materialization_frame.v1", kind: "chunk", slot: 0, chunk_index: 0, chunk_count: 1, bytes_base64: "YQ==" }), (error) => error?.code === "invalid_frame");
	assert.throws(() => encodeCealLeasedConsumerAttachmentStreamRecord({ schema_version: CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA, kind: "attachment", slot: 0, byte_length: 3 }, new Uint8Array([1])), (error) => error?.code === "attachment_length_mismatch");
	assert.throws(() => decodeCealLeasedConsumerAttachmentStreamRecord(new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0])), (error) => error?.code === "invalid_record_length");
});

test("attachment stream protocol enforces the declared effective total and hard ceiling", () => {
	const tooSmall = {
		...manifest,
		limits: {
			effective: { ...manifest.limits.effective, max_total_bytes: 2 },
			safety: { ...manifest.limits.safety, max_total_bytes: 2 },
		},
	};
	assert.throws(() => validateCealLeasedConsumerAttachmentStreamManifest(tooSmall), (error) => error?.code === "invalid_manifest");
	assert.throws(() => validateCealLeasedConsumerAttachmentStreamManifest({
		...manifest,
		limits: {
			effective: { ...manifest.limits.effective, max_total_bytes: 16 * 50 * 1024 * 1024 + 1 },
			safety: manifest.limits.safety,
		},
	}), (error) => error?.code === "invalid_limits");
});
