import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";

// The filesystem safety checks every local store under HOME performs before it
// reads or writes: refuse a symlink, refuse the wrong file type, and hold the
// 0o700 directory / 0o600 file contract.
//
// These lived as twelve hand-copied functions across profile-store,
// receipt-spool, discovery-cache, and agent-audit. Copies had already drifted:
// only one carried the comment explaining why the directory mode is checked at
// all, and their strictness diverged with no statement of which difference was
// deliberate.
//
// Strictness is a parameter here rather than an accident of which file you are
// reading. The two shapes that exist, and why:
//
//   - The credential store (profile-store) asserts modes on its read paths *and*
//     before its write, so a wrong-mode directory or file is a refusal either
//     way: nothing has repaired it yet, and a credential directory that is
//     suddenly group-readable is a reason to stop rather than to quietly fix.
//     The consequence is deliberate but sharp — with a drifted-mode
//     `client-session.json`, both `save` and `remove` refuse, so an operator has
//     to repair the mode by hand before any route will touch the file again.
//   - The cache and spool assert only shape before a write and then `chmod` the
//     result immediately, so mode is enforced a line later. Asking them to
//     refuse a pre-existing wrong-mode file would break an install that already
//     has one, for a file the 0o700 parent already protects.

/** Throws the calling store's own `unsafe_store` error. Must not return. */
export type UnsafeStore = () => never;

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

function modeOf(stat: { mode: number }): number {
	return stat.mode & 0o777;
}

/**
 * Whether `file` inside `directory` is safe to read: both must be non-symlinks
 * of the right type, the directory at 0o700 and the file at 0o600.
 *
 * Never throws — a store that cannot vouch for the path treats it as absent and
 * falls back to a live probe, which is always correct if slower.
 */
export function safeExistingFile(directory: string, file: string, requireFileMode = true): boolean {
	try {
		const dir = lstatSync(directory);
		// The directory guarantee is checked here and not only in the session
		// store's assertDirectory, because the explicit-gateway path reaches this
		// function without running that store at all. A wider-mode directory
		// soft-fails to a live probe rather than being trusted.
		if (dir.isSymbolicLink() || !dir.isDirectory() || modeOf(dir) !== DIRECTORY_MODE) return false;
		const stat = lstatSync(file);
		if (stat.isSymbolicLink() || !stat.isFile()) return false;
		// `requireFileMode: false` is for a caller that is about to *rewrite* this
		// file at 0o600 and would otherwise discard its contents over a mode bit.
		// It stays safe because the directory check above is unconditional: inside a
		// 0o700 directory nobody else can traverse to the file, let alone replace
		// it, so a widened file mode exposes nothing and the rewrite repairs it.
		return !requireFileMode || modeOf(stat) === FILE_MODE;
	} catch {
		return false;
	}
}

/**
 * Creates `directory` at 0o700 when absent, then holds the contract on it.
 *
 * @param requireMode when true, a pre-existing directory whose mode is not 0o700
 *   is refused instead of repaired. The credential store requires it.
 */
export function prepareDirectory(directory: string, unsafe: UnsafeStore, requireMode = false): void {
	// Create unconditionally and classify the error, rather than checking
	// existence first. The check-then-create form had a window: two processes
	// starting against a not-yet-created `~/.ceal` both passed the check, and the
	// loser's `EEXIST` was reported as `unsafe_store` — a refusal naming a
	// security condition for what is just a race one of them had to lose. For the
	// spool that meant a silently dropped receipt outside its own lock; for the
	// session store, a user-visible refusal on a write that should have
	// succeeded. `EEXIST` is the ordinary case here, not a failure.
	try {
		mkdirSync(directory, { mode: DIRECTORY_MODE });
	} catch (error) {
		if (nodeErrorCode(error) !== "EEXIST") unsafe();
	}
	// A symlink that already pointed somewhere else also raises EEXIST, so the
	// shape check below is what refuses it — not the create.
	assertDirectory(directory, unsafe, requireMode);
	chmodSync(directory, DIRECTORY_MODE);
}

function nodeErrorCode(error: unknown): string | undefined {
	return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

/** Refuses `directory` unless it is a real directory, and 0o700 if required. */
export function assertDirectory(directory: string, unsafe: UnsafeStore, requireMode = false): void {
	const stat = lstatSync(directory);
	if (stat.isSymbolicLink() || !stat.isDirectory()) unsafe();
	if (requireMode && modeOf(stat) !== DIRECTORY_MODE) unsafe();
}

/** Refuses `file` unless it is a real file, and 0o600 if required. */
export function assertFile(file: string, unsafe: UnsafeStore, requireMode = false): void {
	const stat = lstatSync(file);
	if (stat.isSymbolicLink() || !stat.isFile()) unsafe();
	if (requireMode && modeOf(stat) !== FILE_MODE) unsafe();
}

/**
 * Whether a path may be removed: it must exist and be a plain file we own.
 *
 * Anything unexpected — a symlink, a directory — is left untouched rather than
 * deleted, so a store cleaning up after itself can never remove a target it did
 * not create.
 */
export function removableFile(file: string): boolean {
	if (!existsSync(file)) return false;
	const stat = lstatSync(file);
	return !stat.isSymbolicLink() && stat.isFile();
}
