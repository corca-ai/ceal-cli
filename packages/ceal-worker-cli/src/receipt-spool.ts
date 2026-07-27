import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertFile, prepareDirectory, removableFile, safeExistingFile } from "./local-store-guards.js";
import { withLocalStoreLock } from "./local-store-lock.js";

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
// Tolerated forward clock skew: an entry recorded further in the future could
// never be expired by retention, so it is dropped instead of retained.
const FUTURE_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

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
	constructor(readonly code: "home_unavailable" | "spool_busy" | "unsafe_store") {
		super(`Ceal receipt spool store ${code.replaceAll("_", " ")}.`);
	}
}

export interface CealReceiptSpoolStore {
	/** Load the spooled entries, or null on any absence/anomaly (soft miss). */
	load(): Promise<CealReceiptSpoolState | null>;
	append(entry: CealReceiptSpoolEntry): Promise<void>;
	remove(): Promise<void>;
}

export function createCealReceiptSpoolStore(home: string | undefined, now: () => number = Date.now): CealReceiptSpoolStore {
	if (!home || !path.isAbsolute(home)) throw new CealReceiptSpoolStoreError("home_unavailable");
	const directory = path.join(home, ".ceal");
	const file = path.join(directory, SPOOL_FILE);
	return {
		async load() {
			const state = readSpool(directory, file, now());
			// A present-but-unusable file is an anomaly the observer should show
			// as unreadable, not an empty history; append still soft-misses.
			if (state === null && existsSync(file)) throw new CealReceiptSpoolStoreError("unsafe_store");
			return state;
		},
		async append(entry) {
			await appendEntry(directory, file, entry, now());
		},
		async remove() {
			removeSpool(file);
		},
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
	const auditRefs = Array.isArray(receipt.audit_refs) ? receipt.audit_refs.filter(safeRef).slice(0, MAX_AUDIT_REFS) : [];
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

// A spool append is a read-modify-write of one file, so two concurrent
// `ceal call` processes without this lock would each read the same prior state
// and the later rename would drop the earlier receipt — silently, since a spool
// failure never changes call behavior. That under-report is precisely what
// `ceal observe` exists to surface, so it is the loss this lock exists to stop.
//
// It narrows the window rather than closing it, and the difference matters to
// anyone reading the spool as complete. The critical section is one small local
// write, not the session store's Gateway roundtrip, so the wait is short — but
// an append that still cannot get in past it raises `spool_busy`, which the
// recording call site swallows like any other spool failure. A receipt is then
// lost exactly as before, and nothing counts how often. Closing that would take
// a durable drop counter the observer can render; it is not this lock's job.
const SPOOL_LOCK_DIRECTORY = "receipt-spool.lock";
const SPOOL_LOCK_MAX_WAIT_MS = 5_000;

async function appendEntry(directory: string, file: string, entry: CealReceiptSpoolEntry, now: number): Promise<void> {
	if (!isValidEntry(entry)) throw new CealReceiptSpoolStoreError("unsafe_store");
	prepareDirectory(directory, unsafeReceiptSpool);
	return withLocalStoreLock(
		{
			lockPath: path.join(directory, SPOOL_LOCK_DIRECTORY),
			maxWaitMs: SPOOL_LOCK_MAX_WAIT_MS,
			onUnsafe: unsafeReceiptSpool,
			onBusy: () => {
				throw new CealReceiptSpoolStoreError("spool_busy");
			},
		},
		async () => {
			writeAppendedSpool(directory, file, entry, now);
		},
	);
}

function writeAppendedSpool(directory: string, file: string, entry: CealReceiptSpoolEntry, now: number): void {
	const existing = readSpool(directory, file, now)?.entries ?? [];
	// Size and retention bounds are enforced on every append (and read applies
	// the same retention window), so the spool cannot grow past its declared
	// bounds even if the clock or an old file disagrees.
	const entries = [...existing, entry]
		.filter((candidate) => withinRetention(candidate.recordedAt, Math.max(now, entry.recordedAt)))
		.slice(-RECEIPT_SPOOL_MAX_ENTRIES);
	sweepStaleTemporaries(directory, now);
	if (existsSync(file)) assertFile(file, unsafeReceiptSpool);
	const temporary = path.join(directory, `.receipt-spool.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
	try {
		writeFileSync(temporary, `${JSON.stringify(serializeSpool(entries), null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
		renameSync(temporary, file);
		chmodSync(file, 0o600);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function readSpool(directory: string, file: string, now: number): CealReceiptSpoolState | null {
	if (!existsSync(file)) return null;
	if (!safeExistingFile(directory, file)) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return null;
	}
	if (!isRecord(parsed) || parsed.schema_version !== SPOOL_SCHEMA_VERSION || !Array.isArray(parsed.entries)) return null;
	// Individually invalid or retention-expired entries are dropped instead of
	// poisoning the whole spool; retention applies on read too, so a dormant
	// client cannot serve entries past the advertised window.
	const entries = parsed.entries
		.flatMap((value) => {
			const entry = parseEntry(value);
			return entry && withinRetention(entry.recordedAt, now) ? [entry] : [];
		})
		.slice(-RECEIPT_SPOOL_MAX_ENTRIES);
	return { entries, bounds: { maxEntries: RECEIPT_SPOOL_MAX_ENTRIES, retentionMs: RECEIPT_SPOOL_RETENTION_MS } };
}

function withinRetention(recordedAt: number, now: number): boolean {
	return recordedAt > now - RECEIPT_SPOOL_RETENTION_MS && recordedAt <= now + FUTURE_SKEW_TOLERANCE_MS;
}

// A crash between temp write and rename orphans a .tmp file; sweep only our
// own naming pattern and only well after any live writer would have renamed,
// so a concurrent append's in-flight temp file is never touched.
const STALE_TEMPORARY_AGE_MS = 60 * 60 * 1000;

function sweepStaleTemporaries(directory: string, now: number): void {
	let names: string[];
	try {
		names = readdirSync(directory);
	} catch {
		return;
	}
	for (const name of names) {
		if (!/^[.]receipt-spool[.].+[.]tmp$/u.test(name)) continue;
		const stale = path.join(directory, name);
		try {
			const stat = lstatSync(stale);
			if (!stat.isSymbolicLink() && stat.isFile() && now - stat.mtimeMs > STALE_TEMPORARY_AGE_MS) rmSync(stale, { force: true });
		} catch {
			/* best effort; never block the append */
		}
	}
}

function removeSpool(file: string): void {
	// removableFile refuses anything that is not a plain file we own, so a
	// symlink or directory left in the store is never deleted by cleanup.
	if (removableFile(file)) rmSync(file, { force: true });
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
	return (
		Number.isFinite(value.recordedAt) &&
		safeRef(value.requestRef) &&
		isSpoolStatus(value.status) &&
		isSpoolEvidence(value.evidence) &&
		Array.isArray(value.auditRefs) &&
		value.auditRefs.length <= MAX_AUDIT_REFS &&
		value.auditRefs.every(safeRef) &&
		(value.capabilityId === undefined || safeRef(value.capabilityId)) &&
		(value.targetRef === undefined || safeRef(value.targetRef)) &&
		(value.errorKind === undefined || safeRef(value.errorKind))
	);
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

// Names this store's refusal once so the shared guards can raise it without
// knowing which store called them.
function unsafeReceiptSpool(): never {
	throw new CealReceiptSpoolStoreError("unsafe_store");
}
