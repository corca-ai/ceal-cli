import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	attachmentStreamManifestSha256,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_EFFECTIVE_LIMITS,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_FRAME_SCHEMA,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAGIC,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_SAFETY_LIMITS,
	encodeCealLeasedConsumerAttachmentStreamRecord,
} from "@corca-ai/ceal-protocol";
import {
	CEAL_AGENT_ATTACHMENT_HANDOFF_MANIFEST_NAME,
	CEAL_AGENT_ATTACHMENT_MATERIALIZATION_SCHEMA,
	receiveLeasedConsumerAttachmentStream,
} from "../dist/leased-consumer-attachment-stream.js";

const binding = {
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
const image = Buffer.from([0, 1, 255, 2]);
const document = Buffer.from("pdf bytes\n");

test("Worker verifies a chunked complete-set stream and writes an Agent-shaped handoff last", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "ceal-worker-attachment-handoff-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const manifest = completeManifest();
	const output = await receiveLeasedConsumerAttachmentStream({
		stream: chunked(
			streamBytes(manifest, [
				[0, image],
				[1, document],
			]),
		),
		expected_binding: binding,
		createHandoffRoot: () => mkdtemp(join(root, "run-")),
	});

	assert.equal(output.manifest.schema_version, CEAL_AGENT_ATTACHMENT_MATERIALIZATION_SCHEMA);
	assert.equal(output.manifest_path, join(output.handoff_root, CEAL_AGENT_ATTACHMENT_HANDOFF_MANIFEST_NAME));
	assert.deepEqual(
		output.manifest.attachments.map((entry) => [entry.slot, entry.status]),
		[
			[0, "materialized"],
			[1, "materialized"],
			[2, "unread"],
		],
	);
	assert.equal(output.manifest.attachments[0].relative_path, "attachments/0.bin");
	assert.equal("relative_path" in output.manifest.attachments[2], false);
	assert.equal(JSON.stringify(output.manifest).includes("source:"), false);
	assert.equal(JSON.stringify(output.manifest).includes("provider"), false);
	assert.deepEqual(await readFile(join(output.handoff_root, "attachments/0.bin")), image);
	assert.deepEqual(await readFile(join(output.handoff_root, "attachments/1.bin")), document);
	assert.deepEqual(JSON.parse(await readFile(output.manifest_path, "utf8")), output.manifest);
	assert.equal((await stat(join(output.handoff_root, "attachments/0.bin"))).mode & 0o077, 0);
	assert.equal((await stat(output.manifest_path)).mode & 0o077, 0);
});

test("Worker rejects binding, ordering, digest, terminal, truncation, and budget drift before leaving a usable handoff", async () => {
	const cases = [
		["binding", (manifest) => ({ manifest, expected_binding: { ...binding, lease_fence: 99 } }), "attachment_binding_mismatch"],
		[
			"reordered",
			(manifest) => ({
				manifest,
				payloads: [
					[1, document],
					[0, image],
				],
			}),
			"attachment_slot_mismatch",
		],
		[
			"digest",
			(manifest) => ({
				manifest,
				payloads: [
					[0, Buffer.from("tampered")],
					[1, document],
				],
			}),
			"attachment_digest_mismatch",
		],
		["terminal", (manifest) => ({ manifest, terminal_manifest_sha256: "0".repeat(64) }), "terminal_mismatch"],
		["truncated", (manifest) => ({ manifest, omit_terminal: true }), "incomplete_attachment_stream"],
	];
	for (const [name, mutate, code] of cases) {
		let created;
		const manifest = completeManifest();
		const options = mutate(manifest);
		await assert.rejects(
			receiveLeasedConsumerAttachmentStream({
				stream: chunked(
					streamBytes(
						options.manifest,
						options.payloads ?? [
							[0, image],
							[1, document],
						],
						options,
					),
				),
				expected_binding: options.expected_binding ?? binding,
				createHandoffRoot: async () => {
					created = await mkdtemp(join(tmpdir(), `ceal-worker-attachment-${name}-`));
					return created;
				},
			}),
			(error) => error?.code === code,
		);
		if (created !== undefined) await assert.rejects(stat(created), { code: "ENOENT" });
	}

	let rootCalls = 0;
	const overBudget = completeManifest({ safety: { ...CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_SAFETY_LIMITS, max_total_bytes: 1 } });
	await assert.rejects(
		receiveLeasedConsumerAttachmentStream({
			stream: chunked(
				streamBytes(overBudget, [
					[0, image],
					[1, document],
				]),
			),
			expected_binding: binding,
			createHandoffRoot: async () => {
				rootCalls += 1;
				return mkdtemp(join(tmpdir(), "ceal-worker-attachment-over-budget-"));
			},
		}),
		(error) => error?.code === "attachment_stream_over_budget",
	);
	assert.equal(rootCalls, 0);
});

test("Worker removes a fresh handoff root when an attachment or final manifest write fails", async () => {
	for (const fault of ["attachment", "manifest"]) {
		let created;
		await assert.rejects(
			receiveLeasedConsumerAttachmentStream({
				stream: chunked(
					streamBytes(completeManifest(), [
						[0, image],
						[1, document],
					]),
				),
				expected_binding: binding,
				createHandoffRoot: async () => {
					created = await mkdtemp(join(tmpdir(), `ceal-worker-attachment-fault-${fault}-`));
					return created;
				},
				afterAttachmentWrite:
					fault === "attachment"
						? ({ slot }) => {
								if (slot === 0) throw new Error("simulated attachment write fault");
							}
						: undefined,
				afterManifestWrite:
					fault === "manifest"
						? () => {
								throw new Error("simulated manifest write fault");
							}
						: undefined,
			}),
			(error) => error?.code === "handoff_write_failed",
		);
		await assert.rejects(stat(created), { code: "ENOENT" });
	}
});

function completeManifest(overrides = {}) {
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

function streamBytes(manifest, payloads, options = {}) {
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

async function* chunked(bytes) {
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

function digest(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
