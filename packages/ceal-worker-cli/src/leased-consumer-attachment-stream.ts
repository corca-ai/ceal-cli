import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { type FileHandle, lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
	attachmentStreamExceedsSafety,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAGIC,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_ATTACHMENT_BYTES,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_HEADER_BYTES,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_RECORD_BYTES,
	CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES,
	type CealLeasedConsumerAttachmentStreamBinding,
	type CealLeasedConsumerAttachmentStreamManifest,
	type CealLeasedConsumerAttachmentStreamUnreadReason,
	decodeCealLeasedConsumerAttachmentStreamRecord,
	CealLeasedConsumerAttachmentStreamError as ProtocolAttachmentStreamError,
} from "@corca-ai/ceal-protocol";
import { isJsonRecord } from "./json-record.js";
import { CEAL_SAFE_REQUEST_REF } from "./safe-ref.js";

/** @testOnly */
export const CEAL_AGENT_ATTACHMENT_MATERIALIZATION_SCHEMA = "ceal.agent.attachment_materialization.v1" as const;
/** @testOnly */
export const CEAL_AGENT_ATTACHMENT_HANDOFF_MANIFEST_NAME = "manifest.json" as const;

const CREATE_FILE_FLAGS = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW;
const BINDING_KEYS = [
	"attachment_set_ref",
	"consumer_generation",
	"consumer_ref",
	"event_ref",
	"event_revision",
	"lease_fence",
	"lease_ref",
	"normalized_projection_revision",
	"requester_subject_ref",
] as const;

export interface CealAgentAttachmentMaterializationBinding extends CealLeasedConsumerAttachmentStreamBinding {}

interface AgentAttachmentBase {
	attachment_ref: string;
	slot: number;
	display_name: string;
	declared_media_type: string;
	observed_media_type: string;
}

interface CealAgentMaterializedAttachment extends AgentAttachmentBase {
	status: "materialized";
	relative_path: `attachments/${number}.bin`;
	size_bytes: number;
	sha256: string;
}

interface CealAgentUnreadAttachment extends AgentAttachmentBase {
	status: "unread";
	unread_reason: CealLeasedConsumerAttachmentStreamUnreadReason;
}

type CealAgentAttachmentMaterializationAttachment = CealAgentMaterializedAttachment | CealAgentUnreadAttachment;

interface CealAgentAttachmentMaterializationManifest {
	schema_version: typeof CEAL_AGENT_ATTACHMENT_MATERIALIZATION_SCHEMA;
	binding: CealAgentAttachmentMaterializationBinding;
	materialization_ref: string;
	attachments: readonly CealAgentAttachmentMaterializationAttachment[];
}

export interface CealAgentAttachmentHandoff {
	handoff_root: string;
	manifest_path: string;
	manifest: CealAgentAttachmentMaterializationManifest;
}

export class LeasedConsumerAttachmentStreamError extends Error {
	readonly code: string;

	constructor(code: string) {
		super("The leased-consumer attachment stream could not be converted into a verified handoff");
		this.name = "LeasedConsumerAttachmentStreamError";
		this.code = code;
	}
}

export interface ReceiveLeasedConsumerAttachmentStreamInput {
	readonly stream: AsyncIterable<Uint8Array>;
	readonly expected_binding: Readonly<CealAgentAttachmentMaterializationBinding>;
	/** Trusted Worker-owned factory. The stream grammar never carries this path. */
	readonly createHandoffRoot: () => string | Promise<string>;
	/** Test-only post-write fault seam; it receives no filesystem path. */
	readonly afterAttachmentWrite?: (input: Readonly<{ slot: number }>) => void | Promise<void>;
	/** Test-only manifest-write fault seam; it receives no filesystem path. */
	readonly afterManifestWrite?: () => void | Promise<void>;
}

/**
 * Verifies one complete Gateway attachment stream and publishes an
 * Agent-shaped handoff only after the terminal proof has arrived. The root
 * factory is the sole filesystem authority supplied by the Worker owner; no
 * stream field can choose a path, slot filename, or provider locator.
 */
export async function receiveLeasedConsumerAttachmentStream(
	input: ReceiveLeasedConsumerAttachmentStreamInput,
): Promise<CealAgentAttachmentHandoff> {
	assertLeasedConsumerAttachmentStreamBinding(input.expected_binding);
	let handoffRoot: string | undefined;
	let rootOwned = false;
	try {
		const records = readAttachmentStreamRecords(input.stream);
		const first = await records.next();
		if (first.done) fail("missing_manifest");
		if (first.value.header.kind !== "manifest") fail("manifest_required");
		const manifest = first.value.header.manifest;
		if (!sameBinding(manifest.binding, input.expected_binding)) fail("attachment_binding_mismatch");
		if (attachmentStreamExceedsSafety(manifest)) fail("attachment_stream_over_budget");

		handoffRoot = await input.createHandoffRoot();
		await assertFreshOwnerOnlyRoot(handoffRoot);
		rootOwned = true;
		const attachmentsRoot = join(handoffRoot, "attachments");
		await mkdir(attachmentsRoot, { mode: 0o700 });
		await assertOwnerOnlyDirectory(attachmentsRoot);

		const materialized = manifest.attachments.filter((attachment) => attachment.status === "materialized");
		let materializedIndex = 0;
		let terminalSeen = false;
		for await (const record of records) {
			if (terminalSeen) fail("trailing_stream_data");
			if (record.header.kind === "manifest") fail("duplicate_manifest");
			if (record.header.kind === "attachment") {
				const expected = materialized[materializedIndex];
				if (!expected || record.header.slot !== expected.slot) fail("attachment_slot_mismatch");
				if (record.payload.byteLength !== expected.size_bytes || sha256(record.payload) !== expected.sha256) fail("attachment_digest_mismatch");
				await writeCreateOnly(join(attachmentsRoot, `${expected.slot}.bin`), record.payload);
				await input.afterAttachmentWrite?.({ slot: expected.slot });
				materializedIndex += 1;
				continue;
			}
			if (record.header.manifest_sha256 !== first.value.header.manifest_sha256 || record.header.slot_count !== manifest.attachments.length)
				fail("terminal_mismatch");
			if (materializedIndex !== materialized.length) fail("incomplete_attachment_stream");
			terminalSeen = true;
		}
		if (!terminalSeen) fail("incomplete_attachment_stream");

		const outputManifest = agentManifest(manifest);
		const manifestPath = join(handoffRoot, CEAL_AGENT_ATTACHMENT_HANDOFF_MANIFEST_NAME);
		await writeCreateOnly(manifestPath, new TextEncoder().encode(`${JSON.stringify(outputManifest)}\n`));
		await input.afterManifestWrite?.();
		return { handoff_root: handoffRoot, manifest_path: manifestPath, manifest: outputManifest };
	} catch (error) {
		if (rootOwned && handoffRoot !== undefined) {
			try {
				await rm(handoffRoot, { recursive: true, force: true });
			} catch {
				throw new LeasedConsumerAttachmentStreamError("handoff_cleanup_failed");
			}
		}
		if (error instanceof LeasedConsumerAttachmentStreamError || error instanceof ProtocolAttachmentStreamError) throw error;
		throw new LeasedConsumerAttachmentStreamError("handoff_write_failed");
	}
}

async function* readAttachmentStreamRecords(
	stream: AsyncIterable<Uint8Array>,
): AsyncGenerator<ReturnType<typeof decodeCealLeasedConsumerAttachmentStreamRecord>> {
	const queue = new ByteQueue();
	const state = { magic_checked: false };
	for await (const chunk of stream) {
		if (!(chunk instanceof Uint8Array)) fail("invalid_stream_chunk");
		let offset = 0;
		while (offset < chunk.byteLength) {
			for (const record of drainRecords(queue, state)) yield record;
			const required = nextRequiredBytes(queue, state);
			const count = Math.min(required, chunk.byteLength - offset);
			queue.push(chunk.subarray(offset, offset + count));
			offset += count;
		}
		for (const record of drainRecords(queue, state)) yield record;
	}
	if (!state.magic_checked) fail("invalid_stream_magic");
	if (queue.length !== 0) fail("stream_truncated");
}

function* drainRecords(
	queue: ByteQueue,
	state: { magic_checked: boolean },
): Generator<ReturnType<typeof decodeCealLeasedConsumerAttachmentStreamRecord>> {
	if (!state.magic_checked) {
		if (queue.length < CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAGIC.byteLength) return;
		if (!sameBytes(queue.take(CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAGIC.byteLength), CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAGIC))
			fail("invalid_stream_magic");
		state.magic_checked = true;
	}
	while (queue.length >= CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES) {
		const recordBytes = readRecordLength(queue);
		if (queue.length < recordBytes) return;
		yield decodeCealLeasedConsumerAttachmentStreamRecord(queue.take(recordBytes));
	}
}

function nextRequiredBytes(queue: ByteQueue, state: { magic_checked: boolean }): number {
	if (!state.magic_checked) return CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAGIC.byteLength - queue.length;
	if (queue.length < CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES)
		return CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES - queue.length;
	return Math.max(1, readRecordLength(queue) - queue.length);
}

function readRecordLength(queue: ByteQueue): number {
	const prefix = queue.peek(CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES);
	const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
	const headerBytes = view.getUint32(0);
	const payloadBytes = view.getUint32(4);
	if (
		headerBytes === 0 ||
		headerBytes > CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_HEADER_BYTES ||
		payloadBytes > CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_ATTACHMENT_BYTES ||
		headerBytes + payloadBytes > CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_MAX_RECORD_BYTES
	)
		fail("record_too_large");
	return CEAL_LEASED_CONSUMER_ATTACHMENT_STREAM_RECORD_PREFIX_BYTES + headerBytes + payloadBytes;
}

function agentManifest(manifest: CealLeasedConsumerAttachmentStreamManifest): CealAgentAttachmentMaterializationManifest {
	return {
		schema_version: CEAL_AGENT_ATTACHMENT_MATERIALIZATION_SCHEMA,
		binding: { ...manifest.binding },
		materialization_ref: manifest.materialization_ref,
		attachments: manifest.attachments.map((attachment) =>
			attachment.status === "materialized"
				? { ...attachment, relative_path: `attachments/${attachment.slot}.bin` as `attachments/${number}.bin` }
				: { ...attachment },
		),
	};
}

async function assertFreshOwnerOnlyRoot(root: string): Promise<void> {
	if (!isAbsolute(root)) fail("unsafe_handoff_root");
	await assertOwnerOnlyDirectory(root);
	if ((await readdir(root)).length !== 0) fail("handoff_root_not_fresh");
}

async function assertOwnerOnlyDirectory(directory: string): Promise<void> {
	const stat = await lstat(directory);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) fail("unsafe_handoff_root");
}

async function writeCreateOnly(filePath: string, bytes: Uint8Array): Promise<void> {
	let handle: FileHandle | undefined;
	try {
		handle = await open(filePath, CREATE_FILE_FLAGS, 0o600);
		let offset = 0;
		while (offset < bytes.byteLength) {
			const result = await handle.write(bytes, offset, bytes.byteLength - offset, null);
			if (result.bytesWritten < 1) throw new Error("zero_byte_write");
			offset += result.bytesWritten;
		}
		await handle.sync();
	} finally {
		await handle?.close();
	}
}

export function assertLeasedConsumerAttachmentStreamBinding(
	binding: unknown,
): asserts binding is CealAgentAttachmentMaterializationBinding {
	if (!isJsonRecord(binding)) fail("invalid_expected_binding");
	const actual = Object.keys(binding).sort();
	const expected = [...BINDING_KEYS].sort();
	if (actual.length !== expected.length || !actual.every((key, index) => key === expected[index])) fail("invalid_expected_binding");
	if (
		![binding.event_ref, binding.requester_subject_ref, binding.lease_ref, binding.consumer_ref, binding.attachment_set_ref].every(
			(value) => typeof value === "string" && CEAL_SAFE_REQUEST_REF.test(value),
		) ||
		![binding.event_revision, binding.normalized_projection_revision, binding.lease_fence, binding.consumer_generation].every(positiveInteger)
	)
		fail("invalid_expected_binding");
}

function sameBinding(
	left: Readonly<CealLeasedConsumerAttachmentStreamBinding>,
	right: Readonly<CealAgentAttachmentMaterializationBinding>,
): boolean {
	return BINDING_KEYS.every((key) => left[key] === right[key]);
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}
function fail(code: string): never {
	throw new LeasedConsumerAttachmentStreamError(code);
}

function positiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

class ByteQueue {
	private readonly chunks: Uint8Array[] = [];
	private buffered = 0;

	get length(): number {
		return this.buffered;
	}

	push(chunk: Uint8Array): void {
		this.chunks.push(new Uint8Array(chunk));
		this.buffered += chunk.byteLength;
	}

	peek(length: number): Uint8Array {
		if (length > this.buffered) throw new Error("queue_underflow");
		return this.copy(length, false);
	}

	take(length: number): Uint8Array {
		if (length > this.buffered) throw new Error("queue_underflow");
		return this.copy(length, true);
	}

	private copy(length: number, consume: boolean): Uint8Array {
		const output = new Uint8Array(length);
		let remaining = length;
		let outputOffset = 0;
		let chunkIndex = 0;
		let chunkOffset = 0;
		while (remaining > 0) {
			const chunk = this.chunks[chunkIndex];
			if (!chunk) throw new Error("queue_underflow");
			const count = Math.min(remaining, chunk.byteLength - chunkOffset);
			output.set(chunk.subarray(chunkOffset, chunkOffset + count), outputOffset);
			outputOffset += count;
			remaining -= count;
			if (consume) {
				if (chunkOffset + count === chunk.byteLength) this.chunks.shift();
				else this.chunks[0] = chunk.subarray(chunkOffset + count);
			} else {
				chunkOffset += count;
				if (chunkOffset === chunk.byteLength) {
					chunkIndex += 1;
					chunkOffset = 0;
				}
			}
		}
		if (consume) this.buffered -= length;
		return output;
	}
}
