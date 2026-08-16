import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

// Almost every suite here needs a temporary directory that is removed when the
// test ends, and each had written the same three lines: mkdtemp under tmpdir,
// register an `after` that force-removes it, hand back the path. Three lines is
// small enough to retype and exactly big enough to get wrong in a way nothing
// notices — a suite that forgets the `after` leaves a tree in `tmpdir()` on
// every run, and a green suite says nothing about that.
//
// `context` is the node:test context, so cleanup is bound to the test that asked
// for the directory rather than to the file.
//
// Resolved with `realpathSync`, which is the part worth having in one place. On
// macOS `tmpdir()` is `/var/folders/...`, a symlink to `/private/var/folders/...`,
// so a suite that hands the raw path to code which resolves paths gets one form
// back and compares it against the other. Several suites already learned that
// one at a time and open-coded `realpathSync(mkdtempSync(...))`; the ones that
// had not were green on Linux and red on the first macOS run that reached them.
export function scratchDir(context: TestContext, prefix: string): string {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

/**
 * A scratch directory pre-populated with a file map, keyed by repo-relative
 * path. Parent directories are created for you.
 *
 * The analyzer suites all need this and each had written the same loop. The
 * duplicate ratchet caught the second copy on the day `one-fact-one-home` landed
 * — a suite proving two one-fact-one-home detectors reproducing the defect in
 * its own fixtures, which is the pattern those detectors exist to find.
 */
export function scratchTree(context: TestContext, prefix: string, files: Record<string, string>): string {
	const root = scratchDir(context, prefix);
	for (const [relative, contents] of Object.entries(files)) {
		const absolute = path.join(root, relative);
		mkdirSync(path.dirname(absolute), { recursive: true });
		writeFileSync(absolute, contents);
	}
	return root;
}
