import { randomBytes } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	type Stats,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { permissionMode } from "./filesystem-mode.js";
import { resolveAnchoredDirectory } from "./local-store-anchor.js";
import { defaultMonotonicNow } from "./monotonic-clock.js";

// The mutual exclusion every local store under HOME uses to make a
// read-modify-write of its state file atomic across separate `ceal` processes.
//
// This lived only in profile-store, where it guarded the single-use refresh
// token. The receipt spool needs the same guarantee for a different reason: its
// append is a read-modify-write of one JSON file, so two concurrent `ceal call`
// processes would each read the same prior state and the later rename would
// silently drop the earlier receipt — the exact under-report `ceal observe`
// exists to surface. Rather than a second hand-copied lock, the primitive is
// shared and the store supplies what differs.
//
// What a caller owns, and why each is a parameter rather than a constant:
//
//   - `lockPath`: one lock per protected file, not one per store directory.
//     The session store and the spool share `~/.ceal`, and serializing a spool
//     append behind a network-bound token refresh would be a latency bug.
//   - `maxWaitMs`: how long a contending process waits before it gives up. The
//     session refresh holds the lock across a Gateway roundtrip; a spool append
//     holds it for one small local write. A shared number would be wrong for
//     one of them.
//   - `onUnsafe` / `onBusy`: each store raises its own error type, so the lock
//     never has to know which store called it.
//
// The lock is a directory published by an atomic same-parent rename. Its owner
// record is completed in a private candidate first, so no observer can see the
// open-before-write gap of `writeFileSync(..., "wx")`. The record carries the
// holder's pid so a lock orphaned by a killed process is reclaimed instead of
// blocking every later run until the wait expires.

const LOCK_OWNER = "owner.json";
const LOCK_POLL_MS = 25;
// A lock directory exists for a moment before its owner record does. Within
// this window an owner-less lock is treated as live rather than stale, so two
// racing acquirers cannot both decide the other's fresh lock is abandoned.
const LOCK_INITIALIZATION_GRACE_MS = 1_000;

export interface LocalStoreLockOptions {
	/** Absolute path of the lock directory guarding one state file. */
	lockPath: string;
	/** Bounded wait before a contending caller is told the lock is busy. */
	maxWaitMs: number;
	/** Optional tighter polling for a tiny critical section on a hot failure path. */
	pollMs?: number;
	/** Throws the calling store's own `unsafe_store` error. Must not return. */
	onUnsafe: () => never;
	/** Throws the calling store's own busy/contended error. Must not return. */
	onBusy: () => never;
	/** Observation-only callback after this generation owns the lock. */
	onAcquired?: (waitedMs: number) => void;
	/** @testOnly Monotonic deadline source; production uses performance.now. */
	monotonicNow?: () => number;
}

/**
 * Runs `action` while holding `lockPath`, releasing it on every exit path.
 *
 * The caller must have prepared the containing directory first: the lock does
 * not create it, because the two stores hold different mode contracts on it.
 */
export async function withLocalStoreLock<T>(options: LocalStoreLockOptions, action: () => Promise<T>): Promise<T> {
	const monotonicNow = options.monotonicNow ?? defaultMonotonicNow;
	const startedAt = monotonicNow();
	const release = await acquireLock(options, monotonicNow);
	try {
		options.onAcquired?.(Math.max(0, monotonicNow() - startedAt));
	} catch {
		/* diagnostics may never change whether the protected operation runs */
	}
	try {
		return await action();
	} finally {
		try {
			release();
		} catch {
			/* A stale lock fails closed and expires within the bounded wait. */
		}
	}
}

async function acquireLock(options: LocalStoreLockOptions, monotonicNow: () => number): Promise<() => void> {
	const anchored = anchorLockParent(options);
	try {
		const deadline = monotonicNow() + options.maxWaitMs;
		while (true) {
			const nonce = createLock(anchored.options);
			if (nonce)
				return () => {
					try {
						releaseLock(anchored.options, nonce);
					} finally {
						closeSync(anchored.parentHandle);
					}
				};
			await waitForLock(anchored.options, deadline, monotonicNow);
		}
	} catch (error) {
		closeSync(anchored.parentHandle);
		throw error;
	}
}

function anchorLockParent(options: LocalStoreLockOptions): { options: LocalStoreLockOptions; parentHandle: number } {
	const parent = path.dirname(options.lockPath);
	const name = path.basename(options.lockPath);
	if (parent === options.lockPath || name === "." || name === "..") options.onUnsafe();
	let parentHandle: number;
	try {
		parentHandle = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
	} catch {
		options.onUnsafe();
	}
	try {
		const stat = fstatSync(parentHandle);
		if (!stat.isDirectory() || permissionMode(stat) !== 0o700) options.onUnsafe();
		const anchoredOptions = { ...options };
		Object.defineProperty(anchoredOptions, "lockPath", {
			enumerable: true,
			get: () => path.join(resolveAnchoredDirectory(parentHandle, parent, stat, 0o700, options.onUnsafe), name),
		});
		return {
			options: anchoredOptions,
			parentHandle,
		};
	} catch (error) {
		closeSync(parentHandle);
		throw error;
	}
}

function createLock(options: LocalStoreLockOptions): string | null {
	// A visible empty directory can only be a pre-atomic-publish legacy holder
	// between mkdir and opening owner.json. Replacing it with a fully initialized
	// candidate is safe: a legacy writer that has not opened the file loses to
	// our already-present owner record, while one that has opened it makes the
	// directory non-empty before this check can authorize replacement.
	if (!lockPathAbsentOrEmpty(options)) return null;

	const nonce = randomBytes(16).toString("hex");
	const candidate = () => `${options.lockPath}.candidate-${process.pid}-${nonce}`;
	try {
		mkdirSync(candidate(), { mode: 0o700 });
		writeFileSync(path.join(candidate(), LOCK_OWNER), `${JSON.stringify({ pid: process.pid, nonce })}\n`, { flag: "wx", mode: 0o600 });
	} catch {
		// The candidate name includes a fresh nonce and is never shared, so this is
		// the one cleanup in acquisition whose path identity is self-authenticating.
		rmSync(candidate(), { recursive: true, force: true });
		options.onUnsafe();
	}
	try {
		renameSync(candidate(), options.lockPath);
		return nonce;
	} catch (error) {
		rmSync(candidate(), { recursive: true, force: true });
		if (nodeErrorCode(error) === "EEXIST" || nodeErrorCode(error) === "ENOTEMPTY") return null;
		options.onUnsafe();
	}
}

function lockPathAbsentOrEmpty(options: LocalStoreLockOptions): boolean {
	const lock = readSafeLockDirectory(options);
	if (!lock) return true;
	try {
		return readdirSync(options.lockPath).length === 0;
	} catch (error) {
		// The holder can release between the lstat above and this read. That is the
		// ordinary transition a waiter is looking for, not an unsafe lock shape.
		if (nodeErrorCode(error) === "ENOENT") return true;
		options.onUnsafe();
	}
}

async function waitForLock(options: LocalStoreLockOptions, deadline: number, monotonicNow: () => number): Promise<void> {
	if (removeStaleLock(options)) return;
	if (monotonicNow() >= deadline) options.onBusy();
	await sleep(options.pollMs ?? LOCK_POLL_MS);
}

function releaseLock(options: LocalStoreLockOptions, nonce: string): void {
	// Release only our own lock: a lock reclaimed as stale by another process
	// may already be held by someone else, and removing it would hand the same
	// state file to two writers at once.
	const owner = readLockOwner(() => options.lockPath);
	if (!owner || owner.nonce !== nonce) return;
	rmSync(options.lockPath, { recursive: true, force: true });
}

function removeStaleLock(options: LocalStoreLockOptions): boolean {
	const owner = staleLockOwner(options);
	if (owner === "initializing") return false;
	if (owner === "absent") return true;
	if ("invalidGeneration" in owner || processMissing(owner.pid, options)) {
		return quarantineStaleLock(options, owner);
	}
	return false;
}

type StaleLockGeneration = { pid: number; nonce: string } | { invalidGeneration: string };

function quarantineStaleLock(options: LocalStoreLockOptions, owner: StaleLockGeneration): boolean {
	// Tombstones are generation-specific and deliberately retained. Two waiters
	// can both classify one old holder as stale, but only the first can move that
	// generation to its fixed destination. A late waiter then collides with the
	// non-empty tombstone instead of renaming the successor that now occupies the
	// stable lock path.
	const suffix = "nonce" in owner ? owner.nonce : `invalid-${owner.invalidGeneration}`;
	const quarantine = () => `${options.lockPath}.reclaimed-${suffix}`;
	try {
		renameSync(options.lockPath, quarantine());
		return true;
	} catch (error) {
		if (nodeErrorCode(error) === "ENOENT") return true;
		if (nodeErrorCode(error) !== "EEXIST" && nodeErrorCode(error) !== "ENOTEMPTY") options.onUnsafe();
		assertQuarantine(options, quarantine, owner);
		return false;
	}
}

function assertQuarantine(options: LocalStoreLockOptions, quarantine: () => string, owner: StaleLockGeneration): void {
	let stat: Stats;
	try {
		stat = lstatSync(quarantine());
	} catch {
		options.onUnsafe();
	}
	if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) options.onUnsafe();
	if ("nonce" in owner) {
		const quarantinedOwner = readLockOwner(quarantine);
		if (!quarantinedOwner || quarantinedOwner.pid !== owner.pid || quarantinedOwner.nonce !== owner.nonce) options.onUnsafe();
		return;
	}
	// Retaining the moved directory also retains its inode, so a later invalid
	// generation cannot reuse this destination identity. That is the fact the old
	// delete/recreate design could not obtain from an inode comparison.
	if (lockGeneration(stat) !== owner.invalidGeneration) options.onUnsafe();
	try {
		if (readdirSync(quarantine()).length === 0) options.onUnsafe();
	} catch {
		options.onUnsafe();
	}
}

function staleLockOwner(
	options: LocalStoreLockOptions,
): { pid: number; nonce: string } | { invalidGeneration: string } | "initializing" | "absent" {
	const lock = readSafeLockDirectory(options);
	if (!lock) return "absent";
	let owner: Stats;
	try {
		owner = lstatSync(path.join(options.lockPath, LOCK_OWNER));
	} catch {
		return Date.now() - lock.mtimeMs < LOCK_INITIALIZATION_GRACE_MS ? "initializing" : { invalidGeneration: lockGeneration(lock) };
	}
	if (!owner.isFile() || owner.isSymbolicLink() || (owner.mode & 0o077) !== 0) options.onUnsafe();
	// An owner record with the right shape and the right mode but unreadable
	// content is a holder that died between creating the file and writing it —
	// the same abandonment as a missing owner file, and reclaimable on the same
	// grace. Refusing it outright wedged the store forever instead: a crash
	// between `openSync(…, "wx")` and its write left a zero-byte `owner.json`,
	// and from then on every session refresh, enroll, logout, and receipt append
	// failed as `unsafe_store` with nothing anywhere to clear it. The mode check
	// above is the security one and still refuses.
	const parsed = readLockOwner(() => options.lockPath);
	if (!parsed)
		return Date.now() - lock.mtimeMs < LOCK_INITIALIZATION_GRACE_MS ? "initializing" : { invalidGeneration: lockGeneration(lock) };
	return parsed;
}

function lockGeneration(lock: Stats): string {
	return `${lock.dev.toString(16)}-${lock.ino.toString(16)}`;
}

function readSafeLockDirectory(options: LocalStoreLockOptions): Stats | null {
	// The shape check sits outside the try on purpose: inside it, the store's
	// own refusal would be caught by this catch and reclassified.
	let lock: Stats;
	try {
		lock = lstatSync(options.lockPath);
	} catch (error) {
		if (nodeErrorCode(error) === "ENOENT") return null;
		options.onUnsafe();
	}
	if (!lock.isDirectory() || lock.isSymbolicLink() || (lock.mode & 0o077) !== 0) options.onUnsafe();
	return lock;
}

function processMissing(pid: number, options: LocalStoreLockOptions): boolean {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		if (nodeErrorCode(error) === "ESRCH") return true;
		// EPERM is proof the pid *exists*, just under another user — ordinary pid
		// reuse in a container or a shared host. Reporting that as `unsafe_store`
		// named a security condition for a recycled pid and left the session store
		// refusing every write for as long as that process lived. It is a live
		// holder we cannot signal, so it takes the same path as any other live
		// holder: keep waiting, and fail as `busy` at the deadline.
		if (nodeErrorCode(error) === "EPERM") return false;
		options.onUnsafe();
	}
}

function readLockOwner(lockPath: () => string): { pid: number; nonce: string } | null {
	try {
		const value = JSON.parse(readFileSync(path.join(lockPath(), LOCK_OWNER), "utf8"));
		if (
			!value ||
			typeof value !== "object" ||
			Array.isArray(value) ||
			typeof value.pid !== "number" ||
			!Number.isSafeInteger(value.pid) ||
			value.pid <= 0 ||
			typeof value.nonce !== "string" ||
			!/^[a-f0-9]{32}$/iu.test(value.nonce)
		)
			return null;
		return { pid: value.pid, nonce: value.nonce };
	} catch {
		return null;
	}
}

function nodeErrorCode(error: unknown): string | undefined {
	return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}
