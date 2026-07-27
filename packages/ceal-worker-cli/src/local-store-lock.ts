import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync, type Stats, writeFileSync } from "node:fs";
import path from "node:path";

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
// The lock is a directory: `mkdir` is atomic on every filesystem this CLI
// targets, unlike an exclusive-create file over NFS. The owner record inside it
// carries the holder's pid so a lock orphaned by a killed process is reclaimed
// instead of blocking every later run until the wait expires.

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
	/** Throws the calling store's own `unsafe_store` error. Must not return. */
	onUnsafe: () => never;
	/** Throws the calling store's own busy/contended error. Must not return. */
	onBusy: () => never;
}

/**
 * Runs `action` while holding `lockPath`, releasing it on every exit path.
 *
 * The caller must have prepared the containing directory first: the lock does
 * not create it, because the two stores hold different mode contracts on it.
 */
export async function withLocalStoreLock<T>(options: LocalStoreLockOptions, action: () => Promise<T>): Promise<T> {
	const release = await acquireLock(options);
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

async function acquireLock(options: LocalStoreLockOptions): Promise<() => void> {
	const deadline = Date.now() + options.maxWaitMs;
	while (true) {
		const nonce = createLock(options);
		if (nonce)
			return () => {
				releaseLock(options.lockPath, nonce);
			};
		await waitForLock(options, deadline);
	}
}

function createLock(options: LocalStoreLockOptions): string | null {
	try {
		mkdirSync(options.lockPath, { mode: 0o700 });
	} catch (error) {
		if (nodeErrorCode(error) === "EEXIST") return null;
		options.onUnsafe();
	}
	const nonce = randomBytes(16).toString("hex");
	try {
		writeFileSync(path.join(options.lockPath, LOCK_OWNER), `${JSON.stringify({ pid: process.pid, nonce })}\n`, { flag: "wx", mode: 0o600 });
		return nonce;
	} catch {
		rmSync(options.lockPath, { recursive: true, force: true });
		options.onUnsafe();
	}
}

async function waitForLock(options: LocalStoreLockOptions, deadline: number): Promise<void> {
	if (removeStaleLock(options)) return;
	if (Date.now() >= deadline) options.onBusy();
	await sleep(LOCK_POLL_MS);
}

function releaseLock(lockPath: string, nonce: string): void {
	// Release only our own lock: a lock reclaimed as stale by another process
	// may already be held by someone else, and removing it would hand the same
	// state file to two writers at once.
	const owner = readLockOwner(lockPath);
	if (!owner || owner.nonce !== nonce) return;
	rmSync(lockPath, { recursive: true, force: true });
}

function removeStaleLock(options: LocalStoreLockOptions): boolean {
	const owner = staleLockOwner(options);
	if (owner === "initializing") return false;
	if (owner === null || processMissing(owner.pid, options)) {
		rmSync(options.lockPath, { recursive: true, force: true });
		return true;
	}
	return false;
}

function staleLockOwner(options: LocalStoreLockOptions): { pid: number; nonce: string } | "initializing" | null {
	const lock = readSafeLockDirectory(options);
	if (!lock) return null;
	const ownerPath = path.join(options.lockPath, LOCK_OWNER);
	let owner: Stats;
	try {
		owner = lstatSync(ownerPath);
	} catch {
		return Date.now() - lock.mtimeMs < LOCK_INITIALIZATION_GRACE_MS ? "initializing" : null;
	}
	if (!owner.isFile() || owner.isSymbolicLink() || (owner.mode & 0o077) !== 0) options.onUnsafe();
	const parsed = readLockOwner(options.lockPath);
	if (!parsed) options.onUnsafe();
	return parsed;
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
		options.onUnsafe();
	}
}

function readLockOwner(lockPath: string): { pid: number; nonce: string } | null {
	try {
		const value = JSON.parse(readFileSync(path.join(lockPath, LOCK_OWNER), "utf8"));
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
