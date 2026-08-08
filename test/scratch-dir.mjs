import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
export function scratchDir(context, prefix) {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}
