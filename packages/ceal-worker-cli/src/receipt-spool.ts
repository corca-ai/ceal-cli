import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// Client-local receipt spool: the masterplan Workbench's first usage data
// source ("what did this client's token do"). It records an allowlisted
// metadata projection of each receipt-bearing `ceal call` outcome — never
// call arguments, purpose text, provider payloads, or token material — so
// `ceal observe` can render local call history without contacting the Gateway.
// The spool is advisory local evidence, not an audit ledger and not a second
// journal primitive: Gateway readback (`ceal receipt show`) remains the
// authoritative receipt surface. The store is owner-only and bounded by entry
// count and retention; a spool failure must never change call behavior, so the
// recording call sites wrap every append and read anomalies degrade to a miss.

const SPOOL_FILE = "receipt-spool.json";
const SPOOL_SCHEMA_VERSION = "ceal.receipt_spool.v1";
// Mirrors the protocol's safe-ref grammar: every spooled field must already be
// a bounded reference/code token, so free text cannot enter the spool.
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CALL_RESULT_SCHEMA_VERSION = "ceal.result.v2";
const SPOOL_STATUSES = new Set(["completed", "blocked", "error"]);
const SPOOL_EVIDENCE = new Set(["readback_verified", "not_read_back", "readback_unavailable", "outcome_unknown"]);
const MAX_AUDIT_REFS = 8;

export const RECEIPT_SPOOL_MAX_ENTRIES = 200;
export const RECEIPT_SPOOL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface CealReceiptSpoolEntry {
	/** Epoch milliseconds when the client recorded this call outcome. */
	recordedAt: number;
	requestRef: string;
	status: "completed" | "blocked" | "error";
	evidence: "readback_verified" | "not_read_back" | "readback_unavailable" | "outcome_unknown";
	auditRefs: string[];
	capabilityId?: string;
	targetRef?: string;
	errorKind?: string;
}

export interface CealReceiptSpoolState {
	entries: CealReceiptSpoolEntry[];
	bounds: { maxEntries: number; retentionMs: number };
}

export class CealReceiptSpoolStoreError extends Error {
	override readonly name = "CealReceiptSpoolStoreError";
	constructor(readonly code: "home_unavailable" | "unsafe_store") {
		super(`Ceal receipt spool store ${code.replaceAll("_", " ")}.`);
	}
}

export interface CealReceiptSpoolStore {
	/** Load the spooled entries, or null on any absence/anomaly (soft miss). */
	load(): Promise<CealReceiptSpoolState | null>;
	append(entry: CealReceiptSpoolEntry): Promise<void>;
	remove(): Promise<void>;
}

export function createCealReceiptSpoolStore(home: string | undefined): CealReceiptSpoolStore {
	if (!home || !path.isAbsolute(home)) throw new CealReceiptSpoolStoreError("home_unavailable");
	const directory = path.join(home, ".ceal");
	const file = path.join(directory, SPOOL_FILE);
	return {
		async load() { return readSpool(directory, file); },
		async append(entry) { appendEntry(directory, file, entry); },
		async remove() { removeSpool(file); },
	};
}

/**
 * Build the spooled projection of one emitted `ceal call` result envelope.
 * The extraction is allow-by-name against the safe-ref grammar: the envelope's
 * `data` payload, arguments, and any unexpected field can never be copied.
 * Returns null when the envelope carries no receipt (pre-issue failures are
 * deliberately not spooled) or a field falls outside the safe vocabulary.
 */
export function receiptSpoolEntryFromCallResult(envelope: Record<string, unknown>, recordedAt: number): CealReceiptSpoolEntry | null {
	if (envelope.schema_version !== CALL_RESULT_SCHEMA_VERSION || !Number.isFinite(recordedAt)) return null;
	const receipt = envelope.receipt;
	if (!isRecord(receipt)) return null;
	const requestRef = receipt.request_ref;
	const evidence = receipt.evidence;
	const status = envelope.status;
	if (!safeRef(requestRef) || !isSpoolEvidence(evidence) || !isSpoolStatus(status)) return null;
	const auditRefs = Array.isArray(receipt.audit_refs)
		? receipt.audit_refs.filter(safeRef).slice(0, MAX_AUDIT_REFS) : [];
	const error = envelope.error;
	const errorKind = isRecord(error) && safeRef(error.kind) ? error.kind : undefined;
	return {
		recordedAt,
		requestRef,
		status,
		evidence,
		auditRefs,
		...(safeRef(envelope.capability) ? { capabilityId: envelope.capability } : {}),
		...(safeRef(envelope.target) ? { targetRef: envelope.target } : {}),
		...(errorKind === undefined ? {} : { errorKind }),
	};
}

function appendEntry(directory: string, file: string, entry: CealReceiptSpoolEntry): void {
	if (!isValidEntry(entry)) throw new CealReceiptSpoolStoreError("unsafe_store");
	const existing = readSpool(directory, file)?.entries ?? [];
	// Retention and size bounds are enforced on every append relative to the
	// newest entry, so the spool cannot grow past its declared bounds even if
	// the clock or an old file disagrees.
	const entries = [...existing, entry]
		.filter((candidate) => candidate.recordedAt > entry.recordedAt - RECEIPT_SPOOL_RETENTION_MS)
		.slice(-RECEIPT_SPOOL_MAX_ENTRIES);
	prepareDirectory(directory);
	if (existsSync(file)) assertFile(file);
	const temporary = path.join(directory, `.receipt-spool.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
	try {
		writeFileSync(temporary, `${JSON.stringify(serializeSpool(entries), null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
		renameSync(temporary, file);
		chmodSync(file, 0o600);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function readSpool(directory: string, file: string): CealReceiptSpoolState | null {
	if (!existsSync(file)) return null;
	if (!safeExistingFile(directory, file)) return null;
	let parsed: unknown;
	try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
	if (!isRecord(parsed) || parsed.schema_version !== SPOOL_SCHEMA_VERSION || !Array.isArray(parsed.entries)) return null;
	// Individually invalid entries are dropped instead of poisoning the whole
	// spool; the remainder stays serveable local evidence.
	const entries = parsed.entries.flatMap((value) => {
		const entry = parseEntry(value);
		return entry ? [entry] : [];
	}).slice(-RECEIPT_SPOOL_MAX_ENTRIES);
	return { entries, bounds: { maxEntries: RECEIPT_SPOOL_MAX_ENTRIES, retentionMs: RECEIPT_SPOOL_RETENTION_MS } };
}

function removeSpool(file: string): void {
	if (!existsSync(file)) return;
	const stat = lstatSync(file);
	if (stat.isSymbolicLink() || !stat.isFile()) return;
	rmSync(file, { force: true });
}

function serializeSpool(entries: readonly CealReceiptSpoolEntry[]): Record<string, unknown> {
	return {
		schema_version: SPOOL_SCHEMA_VERSION,
		entries: entries.map((entry) => ({
			recorded_at: new Date(entry.recordedAt).toISOString(),
			request_ref: entry.requestRef,
			status: entry.status,
			evidence: entry.evidence,
			audit_refs: entry.auditRefs,
			...(entry.capabilityId === undefined ? {} : { capability_id: entry.capabilityId }),
			...(entry.targetRef === undefined ? {} : { target_ref: entry.targetRef }),
			...(entry.errorKind === undefined ? {} : { error_kind: entry.errorKind }),
		})),
	};
}

function parseEntry(value: unknown): CealReceiptSpoolEntry | null {
	if (!isRecord(value) || typeof value.recorded_at !== "string") return null;
	const recordedAt = Date.parse(value.recorded_at);
	if (!Number.isFinite(recordedAt)) return null;
	const entry = {
		recordedAt,
		requestRef: value.request_ref,
		status: value.status,
		evidence: value.evidence,
		auditRefs: Array.isArray(value.audit_refs) ? value.audit_refs.filter(safeRef).slice(0, MAX_AUDIT_REFS) : [],
		...(safeRef(value.capability_id) ? { capabilityId: value.capability_id } : {}),
		...(safeRef(value.target_ref) ? { targetRef: value.target_ref } : {}),
		...(safeRef(value.error_kind) ? { errorKind: value.error_kind } : {}),
	};
	return isValidEntry(entry) ? entry : null;
}

function isValidEntry(value: unknown): value is CealReceiptSpoolEntry {
	if (!isRecord(value)) return false;
	return Number.isFinite(value.recordedAt)
		&& safeRef(value.requestRef) && isSpoolStatus(value.status) && isSpoolEvidence(value.evidence)
		&& Array.isArray(value.auditRefs) && value.auditRefs.length <= MAX_AUDIT_REFS && value.auditRefs.every(safeRef)
		&& (value.capabilityId === undefined || safeRef(value.capabilityId))
		&& (value.targetRef === undefined || safeRef(value.targetRef))
		&& (value.errorKind === undefined || safeRef(value.errorKind));
}

function safeExistingFile(directory: string, file: string): boolean {
	try {
		const dir = lstatSync(directory);
		if (dir.isSymbolicLink() || !dir.isDirectory() || (dir.mode & 0o777) !== 0o700) return false;
		const stat = lstatSync(file);
		return !stat.isSymbolicLink() && stat.isFile() && (stat.mode & 0o777) === 0o600;
	} catch { return false; }
}

function prepareDirectory(directory: string): void {
	if (!existsSync(directory)) {
		try { mkdirSync(directory, { mode: 0o700 }); } catch { throw new CealReceiptSpoolStoreError("unsafe_store"); }
	}
	const stat = lstatSync(directory);
	if (stat.isSymbolicLink() || !stat.isDirectory()) throw new CealReceiptSpoolStoreError("unsafe_store");
	chmodSync(directory, 0o700);
}

function assertFile(file: string): void {
	const stat = lstatSync(file);
	if (stat.isSymbolicLink() || !stat.isFile()) throw new CealReceiptSpoolStoreError("unsafe_store");
}

function isSpoolStatus(value: unknown): value is CealReceiptSpoolEntry["status"] {
	return typeof value === "string" && SPOOL_STATUSES.has(value);
}

function isSpoolEvidence(value: unknown): value is CealReceiptSpoolEntry["evidence"] {
	return typeof value === "string" && SPOOL_EVIDENCE.has(value);
}

function safeRef(value: unknown): value is string {
	return typeof value === "string" && SAFE_REF.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
