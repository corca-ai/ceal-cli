import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_SAFETY_LIMITS } from "@corca-ai/ceal-protocol";
import {
	CEAL_AGENT_ATTACHMENT_HANDOFF_MANIFEST_NAME,
	CEAL_AGENT_ATTACHMENT_MATERIALIZATION_SCHEMA,
	receiveLeasedConsumerAttachmentStream,
} from "../dist/leased-consumer-attachment-stream.js";
import { binding, chunked, completeManifest, document, image, streamBytes } from "./leased-consumer-attachment-stream-fixtures.mjs";

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
