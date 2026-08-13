import assert from "node:assert/strict";
import test from "node:test";
import {
	CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA,
	CEAL_RESULT_MATERIALIZATION_MANIFEST_SCHEMA,
	CEAL_RESULT_MATERIALIZATION_MAX_CHUNK_BASE64_BYTES,
	CEAL_RESULT_MATERIALIZATION_MAX_CHUNKS_PER_FILE,
	CEAL_RESULT_MATERIALIZATION_MAX_FILE_BYTES,
	cealResultMaterializationSlotPath,
	decodeCealResultMaterializationFrame,
	decodeCealResultMaterializationManifest,
	sha256CealResultMaterializationJson,
} from "../dist/index.js";

const RESULT_REF = `result:${"a".repeat(64)}`;

const manifest = {
	schema_version: CEAL_RESULT_MATERIALIZATION_MANIFEST_SCHEMA,
	materialization_ref: RESULT_REF,
	format: "markdown",
	preview: "Protocol-only bounded preview.",
	complete: true,
	files: [{
		slot: 0, path: "document.md", display_name: "document.md", media_type: "text/markdown", status: "materialized",
		byte_count: 3, sha256: "a".repeat(64),
	}],
};

test("result materialization protocol accepts only its own manifest and frame schemas", () => {
	const digest = sha256CealResultMaterializationJson(manifest);
	const frame = decodeCealResultMaterializationFrame({
		schema_version: CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA,
		kind: "manifest", manifest, manifest_sha256: digest,
	});
	assert.equal(frame.kind, "manifest");
	assert.equal(decodeCealResultMaterializationManifest(manifest).files[0].path, "document.md");
	assert.equal(cealResultMaterializationSlotPath(0), "document.md");
	assert.equal(cealResultMaterializationSlotPath(1), "media/file-001.bin");
	assert.equal(cealResultMaterializationSlotPath(15), "media/file-015.bin");
	assert.throws(() => decodeCealResultMaterializationFrame({ schema_version: "ceal.gateway_event_attachment_materialization.v1", kind: "attachment", slot: 0, bytes: new Uint8Array([1]) }), TypeError);
	assert.throws(() => decodeCealResultMaterializationFrame({ schema_version: CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA, kind: "chunk", slot: 0, chunk_index: 0, chunk_count: 1, bytes: "YQ==" }), TypeError);
});

test("result materialization protocol rejects unsafe paths, forged digest, and oversized encoded chunks", () => {
	for (const materialization_ref of ["artifact:abc", "upload:abc", "result:abc", "result:" + "A".repeat(64)]) {
		assert.throws(() => decodeCealResultMaterializationManifest({ ...manifest, materialization_ref }), TypeError);
	}
	assert.throws(() => decodeCealResultMaterializationManifest({ ...manifest, files: [{ ...manifest.files[0], path: "../../private" }] }), TypeError);
	assert.throws(() => decodeCealResultMaterializationManifest({
		...manifest,
		files: [
			manifest.files[0],
			{ slot: 1, path: "media/file-001.bin", display_name: "one.bin", media_type: "application/octet-stream", status: "materialized", byte_count: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
			{ slot: 2, path: "media/file-001.bin", display_name: "duplicate.bin", media_type: "application/octet-stream", status: "materialized", byte_count: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
		],
	}), TypeError);
	assert.doesNotThrow(() => decodeCealResultMaterializationManifest({ ...manifest, files: [{ ...manifest.files[0], byte_count: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }] }));
	assert.throws(() => decodeCealResultMaterializationManifest({ ...manifest, files: [{ ...manifest.files[0], byte_count: CEAL_RESULT_MATERIALIZATION_MAX_FILE_BYTES + 1 }] }), TypeError);
	assert.throws(() => decodeCealResultMaterializationFrame({
		schema_version: CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA,
		kind: "manifest", manifest, manifest_sha256: "0".repeat(64),
	}), TypeError);
	assert.throws(() => decodeCealResultMaterializationFrame({
		schema_version: CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA,
		kind: "chunk", slot: 0, chunk_index: 0, chunk_count: 1, bytes_base64: "A".repeat(CEAL_RESULT_MATERIALIZATION_MAX_CHUNK_BASE64_BYTES + 4),
	}), TypeError);
	assert.doesNotThrow(() => decodeCealResultMaterializationFrame({
		schema_version: CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA,
		kind: "chunk", slot: 0, chunk_index: CEAL_RESULT_MATERIALIZATION_MAX_CHUNKS_PER_FILE - 1, chunk_count: CEAL_RESULT_MATERIALIZATION_MAX_CHUNKS_PER_FILE, bytes_base64: "YQ==",
	}));
	assert.throws(() => decodeCealResultMaterializationFrame({
		schema_version: CEAL_RESULT_MATERIALIZATION_FRAME_SCHEMA,
		kind: "chunk", slot: 0, chunk_index: 0, chunk_count: CEAL_RESULT_MATERIALIZATION_MAX_CHUNKS_PER_FILE + 1, bytes_base64: "YQ==",
	}), TypeError);
});
