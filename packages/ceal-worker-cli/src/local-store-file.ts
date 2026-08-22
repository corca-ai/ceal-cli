import { assertFile, type UnsafeStore } from "./local-store-guards.js";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// The write half of the local-store contract, next to the shape guards that are
// its read half: replace a file under HOME without ever exposing a partial or
// world-readable one, and clean up after a writer that did not survive its own
// write.
//
// This was three hand-copied copies of the same six lines. They had already
// diverged on the part that matters least visibly and most: only the spool swept
// the temporaries a crash leaves behind, so the two stores that did not — the
// credential store among them — kept a 0o600 file holding an access token and a
// refresh token forever, in the directory the operator has no reason to inspect.
// One owner is what stops the safest copy from being the one nobody needed.

const FILE_MODE = 0o600;

// A crash between the temp write and the rename orphans a .tmp file; sweep only
// this store's own naming pattern and only well after any live writer would have
// renamed, so a concurrent write's in-flight temporary is never touched.
//
// The age is measured against `mtime`, so the comparison reads the wall clock
// and never a caller's logical one. The spool injects a clock for retention, and
// borrowing it here would make a fixture's past date silently disable the sweep
// and a future-skewed one delete a live writer's temporary — the single outcome
// this threshold exists to prevent.
const STALE_TEMPORARY_AGE_MS = 60 * 60 * 1000;

export interface CealLocalStoreWrite {
	/** The store directory holding both the temporary and the target file. */
	directory: string;
	/** The file being replaced, inside `directory`. */
	file: string;
	/**
	 * Names this store's temporaries so it never sweeps a sibling store's. Must
	 * be lowercase letters, digits, and dashes: the sweep matches it as a literal
	 * delimited by dots, so a prefix containing a dot would prefix-match a
	 * sibling's temporaries, and one containing a slash would place the temporary
	 * outside the directory the sweep scans.
	 */
	prefix: string;
	/** Serialized contents, written whole. */
	contents: string;
	/** The calling store's own `unsafe_store` refusal. */
	unsafe: UnsafeStore;
	/** When true, a pre-existing target whose mode is not 0o600 is refused. */
	requireMode?: boolean;
}

const SAFE_PREFIX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Replace `file` atomically: sweep this store's stale temporaries, refuse a
 * target that is not a plain file, write a fresh temporary with `wx` so it can
 * never adopt a planted path, rename it into place, and hold 0o600.
 *
 * The caller still owns its directory: `prepareDirectory` runs before this,
 * because only the caller knows whether it holds a lock across the write.
 */
export function writeCealLocalStoreFile({ directory, file, prefix, contents, unsafe, requireMode = false }: CealLocalStoreWrite): void {
	if (!SAFE_PREFIX.test(prefix)) unsafe();
	sweepStaleTemporaries(directory, prefix, Date.now());
	if (existsSync(file)) assertFile(file, unsafe, requireMode);
	const temporary = path.join(directory, `.${prefix}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
	let created = false;
	try {
		writeFileSync(temporary, contents, { encoding: "utf8", flag: "wx", mode: FILE_MODE });
		created = true;
		// Mode is repaired on the temporary, not on the target after the rename:
		// `chmod` follows symlinks, so widening the target by path reopens for one
		// instant exactly the planted-path window that `wx` and the random name
		// close. `rename` carries the mode across, so this is the same result
		// without the window. (`writeFileSync`'s mode is masked by umask and never
		// widened, which is why the repair is needed at all.)
		chmodSync(temporary, FILE_MODE);
		renameSync(temporary, file);
	} finally {
		// Only a temporary this call created: `wx` failing means the path was
		// somebody else's, and the cleanup must not adopt it.
		if (created) rmSync(temporary, { force: true });
	}
}

function sweepStaleTemporaries(directory: string, prefix: string, now: number): void {
	let names: string[];
	try {
		names = readdirSync(directory);
	} catch {
		return;
	}
	// Matched as literal text rather than a built regular expression: a prefix is
	// a caller-supplied string, and the sweep decides what gets deleted.
	const marker = `.${prefix}.`;
	for (const name of names) {
		if (!name.startsWith(marker) || !name.endsWith(".tmp") || name.length <= marker.length + ".tmp".length) continue;
		const stale = path.join(directory, name);
		try {
			const stat = lstatSync(stale);
			// Affirmative form of the same redundancy: `!stat.isSymbolicLink() &&` led
			// this test, but under `lstatSync` `isFile()` is already false for a symlink,
			// so the conjunct was true wherever it was reached.
			if (stat.isFile() && now - stat.mtimeMs > STALE_TEMPORARY_AGE_MS) rmSync(stale, { force: true });
		} catch {
			/* best effort; never block the write */
		}
	}
}
