// The output-directory contract the three release composers share.
//
// Each of them writes a tree the release lane then signs, and each guards the
// destination the same way before writing: absolute, not the filesystem root and
// not the checkout or its parent, no symlink anywhere in the path, and — when
// replacing — an existing directory carrying that composer's own marker file.
// The three copies had drifted only in the noun they put in the message, which
// is the one part that must differ, and that is the shape a guard should be
// parameterized on rather than copied for.
//
// The copies are the risk this removes. A guard reproduced three times is one
// that gets fixed once: `assertNoSymlinkComponents` landed in all three, but
// nothing would have failed if it had landed in two.
//
// `fail` and `marker` are injected because each composer keeps its own coded
// error class and its own marker filename, and neither belongs to a shared
// module.

import { existsSync, lstatSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { assertNoSymlinkComponents } from "./safe-output-path.mjs";

/**
 * Resolve and vet a composer's output directory.
 *
 * Returns `{ directory, force }`, where `force` is true only when an existing,
 * marked directory is being deliberately replaced. `--force` alone is not
 * enough: the marker is what says the tree was written by this lane, so the flag
 * can never point at a directory the composer did not create.
 */
export function inspectOutputDirectory(value, { repoRoot, force, subject, marker, fail }) {
	if (typeof value !== "string" || !path.isAbsolute(value)) fail("invalid_output", `${subject} must be an absolute directory.`);
	const directory = path.resolve(value);
	if ([path.parse(directory).root, repoRoot, path.resolve(repoRoot, "..")].includes(directory))
		fail("unsafe_output", `${subject} is too broad.`);
	assertNoSymlinkComponents(directory, fail, subject);
	if (!existsSync(directory)) return { directory, force: false };
	if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
		fail("unsafe_output", `${subject} must be a regular directory.`);
	const markerPath = path.join(directory, marker);
	if (!force || !existsSync(markerPath) || lstatSync(markerPath).isSymbolicLink())
		fail("output_not_replaceable", `Use --force only with a marked ${subject.toLowerCase()}.`);
	return { directory, force: true };
}

/**
 * Move a fully written staging tree into place, replacing a marked directory
 * only when `inspectOutputDirectory` already approved that. Staging then
 * renaming is what keeps a partial tree from ever being visible at the
 * destination.
 */
export function publishOutputDirectory(staging, output) {
	if (output.force) rmSync(output.directory, { recursive: true, force: true });
	renameSync(staging, output.directory);
}
