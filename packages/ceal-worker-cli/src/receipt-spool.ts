import { closeSync, constants, existsSync, fchmodSync, lstatSync, openSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import { writeCealLocalStoreFile } from "./local-store-file.js";
import { assertDirectoryIfPresent, prepareDirectory, removeOwnedFile, safeExistingFile } from "./local-store-guards.js";
import { withLocalStoreLock } from "./local-store-lock.js";
import { CEAL_SAFE_REF } from "./safe-ref.js";
import { validSessionIdentityDiscriminator } from "./session-identity.js";

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
// definition a moment when the spool could not be written. The first line binds
// the file to a session-identity digest; one byte is appended per drop with
// O_APPEND. The append itself is atomic, while the identity-header replacement
// and cap decision are serialized by the counter's separate lock below.
const DROPS_FILE = "receipt-spool-drops";
// A pathological caller cannot grow the counter without bound; past this the
// observer reports "at least" rather than an exact figure, which is the honest
// reading of a truncated count anyway.
const MAX_RECORDED_DROPS = 4096;
const NO_DROPS = { count: 0, atLeast: false } as const;
const { O_APPEND, O_CREAT, O_NOFOLLOW, O_WRONLY } = constants;
const SPOOL_SCHEMA_VERSION = "ceal.receipt_spool.v2";
const DROPS_SCHEMA_VERSION = "ceal.receipt_spool_drops.v2";
// Every spooled field must already be a bounded reference/code token, so free
// text cannot enter the spool. The grammar itself lives in `safe-ref.ts`.
const SAFE_REF = CEAL_SAFE_REF;
const CALL_RESULT_SCHEMA_VERSION = "ceal.result.v2";
const SPOOL_STATUSES = new Set(["completed", "blocked", "error"]);
const SPOOL_EVIDENCE = new Set(["readback_verified", "not_read_back", "readback_unavailable", "outcome_unknown"]);
const MAX_AUDIT_REFS = 8;
const FOREIGN_SPOOL = Symbol("foreign_receipt_spool");

/**
 * The spool bounds. Exported so the suite drives eviction and expiry from the
 * declaration rather than from a copy of the numbers, which would let the two
 * drift apart while the test kept passing against its own stale constant.
 *
 * @testOnly
 */
export const RECEIPT_SPOOL_MAX_ENTRIES = 200;
/** @testOnly The retention half of the bounds above. */
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

/**
 * Exported so the suite can assert `instanceof` rather than a name string.
 *
 * @testOnly
 */
export class CealReceiptSpoolStoreError extends Error {
	override readonly name = "CealReceiptSpoolStoreError";
	constructor(readonly code: "home_unavailable" | "spool_busy" | "unsafe_store") {
		super(`Ceal receipt spool store ${code.replaceAll("_", " ")}.`);
	}
}

export interface CealReceiptSpoolStore {
	/** Load the spooled entries, or null on any absence/anomaly (soft miss). */
	load(identity: string): Promise<CealReceiptSpoolState | null>;
	append(identity: string, entry: CealReceiptSpoolEntry): Promise<void>;
	/**
	 * Record that one receipt append was lost. The recording call site swallows
	 * every append failure so a spool cannot change call behavior, which used to
	 * mean a lost receipt left no trace at all — the observer then under-reported
	 * without being able to say so. This must never throw for the same reason.
	 */
	recordDrop(identity: string): Promise<void>;
	remove(): Promise<void>;
}

interface CealReceiptSpoolLockTiming {
	spoolMaxWaitMs: number;
	dropsMaxWaitMs: number;
	dropsPollMs: number;
}

export function createCealReceiptSpoolStore(
	home: string | undefined,
	now: () => number = Date.now,
	lockTiming: CealReceiptSpoolLockTiming = PRODUCTION_LOCK_TIMING,
): CealReceiptSpoolStore {
	if (!home || !path.isAbsolute(home)) throw new CealReceiptSpoolStoreError("home_unavailable");
	const directory = path.join(home, ".ceal");
	const file = path.join(directory, SPOOL_FILE);
	return {
		async load(identity) {
			assertIdentity(identity);
			const drops = readDrops(path.join(directory, DROPS_FILE), identity);
			const state = readSpool(directory, file, identity, now(), drops);
			if (state === FOREIGN_SPOOL) return drops.count > 0 ? emptySpoolState(drops) : null;
			// A present-but-unusable file is an anomaly the observer should show
			// as unreadable, not an empty history; append still soft-misses.
			if (state === null && existsSync(file)) throw new CealReceiptSpoolStoreError("unsafe_store");
			// Drops with no spool file is not "no calls yet": the first receipt can
			// be the one that was lost, and returning null there would let the
			// observer state the strongest possible false claim — that this client
			// made no calls — on the strength of a file that failed to be written.
			if (state === null && drops.count > 0) return emptySpoolState(drops);
			return state;
		},
		async append(identity, entry) {
			assertIdentity(identity);
			await appendEntry(directory, file, identity, entry, now(), lockTiming);
		},
		async recordDrop(identity) {
			if (!validSessionIdentityDiscriminator(identity)) return;
			await recordDrop(directory, path.join(directory, DROPS_FILE), identity, lockTiming);
		},
		async remove() {
			return removeUnderLock(directory, file, lockTiming);
		},
	};
}

function emptySpoolState(drops: CealReceiptSpoolState["drops"]): CealReceiptSpoolState {
	return {
		entries: [],
		bounds: { maxEntries: RECEIPT_SPOOL_MAX_ENTRIES, retentionMs: RECEIPT_SPOOL_RETENTION_MS },
		drops,
		spoolPresent: false,
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
// This store is advisory and its caller has already emitted the call result.
// Keep ordinary concurrent writers serialized, but never hold process exit for
// seconds behind a stopped process; a miss is recorded by the drop counter.
const SPOOL_LOCK_MAX_WAIT_MS = 250;
// Drop accounting cannot take the spool lock: its primary caller reaches this
// path because that lock was busy. It still needs its own exclusion, because
// the identity header is a first-write replace and the cap is a read-then-append
// decision. A short-polling sibling lock keeps those two facts atomic without
// serializing a completed call behind spool work.
const DROPS_LOCK_DIRECTORY = "receipt-spool-drops.lock";
const DROPS_LOCK_MAX_WAIT_MS = 1_000;
const DROPS_LOCK_POLL_MS = 1;
const PRODUCTION_LOCK_TIMING: CealReceiptSpoolLockTiming = {
	spoolMaxWaitMs: SPOOL_LOCK_MAX_WAIT_MS,
	dropsMaxWaitMs: DROPS_LOCK_MAX_WAIT_MS,
	dropsPollMs: DROPS_LOCK_POLL_MS,
};

// The append takes the lock for its read-modify-write; the removal did not, so a
// clear that raced an in-flight append lost to it — the append's rename recreated
// the file with every pre-removal entry. That is the failure this module's lock
// exists to prevent, reached from the other side. The identity discriminator now
// prevents a resurrected old spool from being attributed to a replacement
// session; the lock still prevents a clear from being immediately undone.
// One home for this store's exclusion, because the append had these terms and the
// removal did not, and the removal is what a clear races. A second spelling is how
// the two drift back apart.
async function underSpoolLock(directory: string, lockTiming: CealReceiptSpoolLockTiming, action: () => void): Promise<void> {
	return withLocalStoreLock(
		{
			lockPath: path.join(directory, SPOOL_LOCK_DIRECTORY),
			maxWaitMs: lockTiming.spoolMaxWaitMs,
			onUnsafe: unsafeReceiptSpool,
			onBusy: () => {
				throw new CealReceiptSpoolStoreError("spool_busy");
			},
		},
		async () => action(),
	);
}

async function removeUnderLock(directory: string, file: string, lockTiming: CealReceiptSpoolLockTiming): Promise<void> {
	if (!assertDirectoryIfPresent(directory, unsafeReceiptSpool, true)) return;
	return underSpoolLock(directory, lockTiming, () => {
		removeSpool(directory, file);
		removeSpool(directory, path.join(directory, DROPS_FILE));
	});
}

async function appendEntry(
	directory: string,
	file: string,
	identity: string,
	entry: CealReceiptSpoolEntry,
	now: number,
	lockTiming: CealReceiptSpoolLockTiming,
): Promise<void> {
	if (!isValidEntry(entry)) throw new CealReceiptSpoolStoreError("unsafe_store");
	prepareDirectory(directory, unsafeReceiptSpool);
	return underSpoolLock(directory, lockTiming, () => writeAppendedSpool(directory, file, identity, entry, now));
}

function writeAppendedSpool(directory: string, file: string, identity: string, entry: CealReceiptSpoolEntry, now: number): void {
	// `requireFileMode: false`: this append is about to rewrite the file at 0o600
	// regardless, so refusing to *read* it over a mode bit would silently replace a
	// valid history with a one-entry spool — and record no drop, because the append
	// succeeded. A `chmod` on the spool destroyed thirty days of receipts that way.
	// Genuinely unusable content still soft-misses, which is the deliberate
	// behaviour pinned in `receipt-spool.test.mjs`; only the repairable anomaly is
	// no longer treated as an empty history.
	const prior = readSpool(directory, file, identity, now, NO_DROPS, false);
	const existing = prior === FOREIGN_SPOOL ? [] : (prior?.entries ?? []);
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
		contents: `${JSON.stringify(serializeSpool(identity, entries), null, 2)}\n`,
		unsafe: unsafeReceiptSpool,
	});
}

// This deliberately uses a lock separate from `underSpoolLock`: a drop is most
// often recorded because that lock was busy. It remains unprotected against a
// clear; a delayed old process can recreate the file after logout or replacement.
// The identity header is the structural boundary for that race, so a current
// reader refuses old bytes and a later current write replaces them.
async function recordDrop(directory: string, file: string, identity: string, lockTiming: CealReceiptSpoolLockTiming): Promise<void> {
	try {
		prepareDirectory(directory, unsafeReceiptSpool);
		await withLocalStoreLock(
			{
				lockPath: path.join(directory, DROPS_LOCK_DIRECTORY),
				maxWaitMs: lockTiming.dropsMaxWaitMs,
				pollMs: lockTiming.dropsPollMs,
				onUnsafe: unsafeReceiptSpool,
				onBusy: () => {
					throw new CealReceiptSpoolStoreError("spool_busy");
				},
			},
			async () => writeDrop(directory, file, identity),
		);
	} catch {
		/* The drop counter exists to describe a failure; it may not become one. */
	}
}

function writeDrop(directory: string, file: string, identity: string): void {
	const existing = readDropFile(file);
	if (!existing || existing.identity !== identity) {
		writeCealLocalStoreFile({
			directory,
			file,
			prefix: "receipt-spool-drops",
			contents: `${DROPS_SCHEMA_VERSION} ${identity}\n.`,
			unsafe: unsafeReceiptSpool,
		});
		return;
	}
	if (existing.count >= MAX_RECORDED_DROPS) return;
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
}

function readDrops(file: string, identity: string): { count: number; atLeast: boolean } {
	const drops = readDropFile(file);
	if (!drops || drops.identity !== identity) return NO_DROPS;
	return { count: drops.count, atLeast: drops.count >= MAX_RECORDED_DROPS };
}

function readDropFile(file: string): { identity: string; count: number } | null {
	if (!dropsFileStat(file)) return null;
	try {
		const [header, body = ""] = readFileSync(file, "utf8").split("\n", 2);
		const [schema, identity, ...extra] = header.split(" ");
		if (schema !== DROPS_SCHEMA_VERSION || !validSessionIdentityDiscriminator(identity) || extra.length > 0 || !/^\.*$/u.test(body))
			return null;
		return { identity, count: body.length };
	} catch {
		return null;
	}
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

function readSpool(
	directory: string,
	file: string,
	identity: string,
	now: number,
	drops: { count: number; atLeast: boolean },
	requireFileMode = true,
): CealReceiptSpoolState | typeof FOREIGN_SPOOL | null {
	if (!existsSync(file)) return null;
	if (!safeExistingFile(directory, file, requireFileMode)) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return null;
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.entries)) return null;
	if (parsed.schema_version === "ceal.receipt_spool.v1") return FOREIGN_SPOOL;
	if (parsed.schema_version !== SPOOL_SCHEMA_VERSION || !validSessionIdentityDiscriminator(parsed.identity)) return null;
	if (parsed.identity !== identity) return FOREIGN_SPOOL;
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

function removeSpool(directory: string, file: string): void {
	removeOwnedFile(directory, file, unsafeReceiptSpool);
}

function serializeSpool(identity: string, entries: readonly CealReceiptSpoolEntry[]): Record<string, unknown> {
	return {
		schema_version: SPOOL_SCHEMA_VERSION,
		identity,
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

function assertIdentity(identity: string): void {
	if (!validSessionIdentityDiscriminator(identity)) throw new CealReceiptSpoolStoreError("unsafe_store");
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
