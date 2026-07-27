import { closeSync, constants, existsSync, fchmodSync, lstatSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { writeCealLocalStoreFile } from "./local-store-file.js";
import { prepareDirectory, removableFile, safeExistingFile } from "./local-store-guards.js";
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
// Drops are counted in their own file, not in the spool, because a drop is by
// definition a moment when the spool could not be written. One byte is appended
// per drop with O_APPEND, which POSIX makes atomic below PIPE_BUF, so the
// counter needs no lock of its own — the size is the count.
const DROPS_FILE = "receipt-spool-drops";
// A pathological caller cannot grow the counter without bound; past this the
// observer reports "at least" rather than an exact figure, which is the honest
// reading of a truncated count anyway.
const MAX_RECORDED_DROPS = 4096;
const NO_DROPS = { count: 0, atLeast: false } as const;
const { O_APPEND, O_CREAT, O_NOFOLLOW, O_WRONLY } = constants;
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
	/** Receipt appends this client is known to have lost, and whether more were not counted. */
	drops: { count: number; atLeast: boolean };
	/**
	 * Whether a spool file backs this state. False means every entry this client
	 * ever tried to record was lost — a much stronger statement than an empty
	 * history, which retention alone produces, so the two may not be flattened
	 * into `entries.length === 0`.
	 */
	spoolPresent: boolean;
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
	/**
	 * Record that one receipt append was lost. The recording call site swallows
	 * every append failure so a spool cannot change call behavior, which used to
	 * mean a lost receipt left no trace at all — the observer then under-reported
	 * without being able to say so. This must never throw for the same reason.
	 */
	recordDrop(): Promise<void>;
	remove(): Promise<void>;
}

export function createCealReceiptSpoolStore(home: string | undefined, now: () => number = Date.now): CealReceiptSpoolStore {
	if (!home || !path.isAbsolute(home)) throw new CealReceiptSpoolStoreError("home_unavailable");
	const directory = path.join(home, ".ceal");
	const file = path.join(directory, SPOOL_FILE);
	return {
		async load() {
			const drops = readDrops(path.join(directory, DROPS_FILE));
			const state = readSpool(directory, file, now(), drops);
			// A present-but-unusable file is an anomaly the observer should show
			// as unreadable, not an empty history; append still soft-misses.
			if (state === null && existsSync(file)) throw new CealReceiptSpoolStoreError("unsafe_store");
			// Drops with no spool file is not "no calls yet": the first receipt can
			// be the one that was lost, and returning null there would let the
			// observer state the strongest possible false claim — that this client
			// made no calls — on the strength of a file that failed to be written.
			if (state === null && drops.count > 0)
				return {
					entries: [],
					bounds: { maxEntries: RECEIPT_SPOOL_MAX_ENTRIES, retentionMs: RECEIPT_SPOOL_RETENTION_MS },
					drops,
					spoolPresent: false,
				};
			return state;
		},
		async append(entry) {
			await appendEntry(directory, file, entry, now());
		},
		async recordDrop() {
			recordDrop(directory, path.join(directory, DROPS_FILE));
		},
		async remove() {
			removeSpool(file);
			removeSpool(path.join(directory, DROPS_FILE));
		},
	};
}

/**
 * Whether this envelope carried a receipt at all.
 *
 * `receiptSpoolEntryFromCallResult` returns null for two unlike reasons: the
 * call never got a receipt (a pre-issue failure, deliberately not spooled), or
 * it did and a field fell outside the safe vocabulary. Only the second is a lost
 * receipt, and it is the loss most likely to happen in practice — it fires on a
 * Gateway vocabulary the client does not know yet, not on contention. Separating
 * them is what lets the recorder count one and ignore the other.
 */
export function callResultCarriesReceipt(envelope: Record<string, unknown>): boolean {
	return envelope.schema_version === CALL_RESULT_SCHEMA_VERSION && isRecord(envelope.receipt);
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
// It narrows the window rather than closing it. The critical section is one
// small local write, not the session store's Gateway roundtrip, so the wait is
// short — but an append that still cannot get in past it raises `spool_busy`,
// which the recording call site swallows like any other spool failure, and the
// receipt is gone. What changed is that the loss is no longer invisible: the
// call site records it through `recordDrop`, so `ceal observe` can say the
// history it is rendering is incomplete instead of quietly under-reporting.
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
	const existing = readSpool(directory, file, now, NO_DROPS)?.entries ?? [];
	// Size and retention bounds are enforced on every append (and read applies
	// the same retention window), so the spool cannot grow past its declared
	// bounds even if the clock or an old file disagrees.
	const entries = [...existing, entry]
		.filter((candidate) => withinRetention(candidate.recordedAt, Math.max(now, entry.recordedAt)))
		.slice(-RECEIPT_SPOOL_MAX_ENTRIES);
	writeCealLocalStoreFile({
		directory,
		file,
		prefix: "receipt-spool",
		contents: `${JSON.stringify(serializeSpool(entries), null, 2)}\n`,
		unsafe: unsafeReceiptSpool,
		now,
	});
}

function recordDrop(directory: string, file: string): void {
	try {
		prepareDirectory(directory, unsafeReceiptSpool);
		const existing = dropsFileStat(file);
		if (existing && existing.size >= MAX_RECORDED_DROPS) return;
		// O_NOFOLLOW rather than an existence check: `existsSync` follows symlinks
		// and reports false for a dangling one, so a planted link would have been
		// created and written through — the one write in this module that could
		// leave the store, since the spool's own write goes to a random temp name
		// with `wx` and renames. The kernel refuses the link instead.
		const handle = openSync(file, O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW, 0o600);
		try {
			writeSync(handle, ".");
			// Shape is checked before the write and mode is repaired right after,
			// which is the spool's stated write-path contract: refusing a
			// wrong-mode file here would silently stop counting forever instead.
			fchmodSync(handle, 0o600);
		} finally {
			closeSync(handle);
		}
	} catch {
		/* The drop counter exists to describe a failure; it may not become one. */
	}
}

function readDrops(file: string): { count: number; atLeast: boolean } {
	const stat = dropsFileStat(file);
	if (!stat) return NO_DROPS;
	return { count: stat.size, atLeast: stat.size >= MAX_RECORDED_DROPS };
}

/**
 * The drops file's stat, or null if it is absent or not a plain file.
 *
 * Shape only, deliberately: this is not `safeExistingFile`, whose mode assertions
 * are a *read* guard. Applying them here would let one drifted mode stop the
 * counter permanently and silently, which is the failure this counter exists to
 * make visible.
 */
function dropsFileStat(file: string): { size: number } | null {
	try {
		const stat = lstatSync(file);
		return !stat.isSymbolicLink() && stat.isFile() ? { size: stat.size } : null;
	} catch {
		return null;
	}
}

function readSpool(directory: string, file: string, now: number, drops: { count: number; atLeast: boolean }): CealReceiptSpoolState | null {
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
	return { entries, bounds: { maxEntries: RECEIPT_SPOOL_MAX_ENTRIES, retentionMs: RECEIPT_SPOOL_RETENTION_MS }, drops, spoolPresent: true };
}

function withinRetention(recordedAt: number, now: number): boolean {
	return recordedAt > now - RECEIPT_SPOOL_RETENTION_MS && recordedAt <= now + FUTURE_SKEW_TOLERANCE_MS;
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
