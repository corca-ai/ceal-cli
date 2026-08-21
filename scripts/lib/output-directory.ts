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

import { assertNoSymlinkComponents } from "./safe-output-path.ts";
import { existsSync, lstatSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

type OutputFailure = (code: string, message: string) => never;
type OutputInspection = { directory: string; force: boolean };
type OutputInspectionOptions = {
	repoRoot: string;
	force: boolean;
	subject: string;
	marker: string;
	fail: OutputFailure;
};

export function createSiblingTemporaryDirectory(directory: string, label: string): string {
	return mkdtempSync(path.join(path.dirname(directory), `.${path.basename(directory)}.${label}-`));
}

/**
 * Resolve and vet a composer's output directory.
 *
 * Returns `{ directory, force }`, where `force` is true only when an existing,
 * marked directory is being deliberately replaced. `--force` alone is not
 * enough: the marker is what says the tree was written by this lane, so the flag
 * can never point at a directory the composer did not create.
 */
export function inspectOutputDirectory(
	value: unknown,
	{ repoRoot, force, subject, marker, fail }: OutputInspectionOptions,
): OutputInspection {
	if (typeof value !== "string") return fail("invalid_output", `${subject} must be an absolute directory.`);
	if (!path.isAbsolute(value)) return fail("invalid_output", `${subject} must be an absolute directory.`);
	const candidate: string = value;
	const directory = path.resolve(candidate);
	if ([path.parse(directory).root, repoRoot, path.resolve(repoRoot, "..")].includes(directory))
		fail("unsafe_output", `${subject} is too broad.`);
	assertNoSymlinkComponents(directory, fail, subject);
	if (!existsSync(directory)) return { directory, force: false };
	// A trailing `|| lstatSync(directory).isSymbolicLink()` operand stood here and
	// was dead twice over. `assertNoSymlinkComponents` above walks EVERY component
	// of the path including the leaf, so a symlink at `directory` already failed
	// there with a different message and never reached this line at all; and even
	// if it had, `lstatSync` does not follow, so a symlink reports
	// `isDirectory() === false` and is refused by the operand that remains.
	// It also cost a second `lstatSync` of the same path.
	if (!lstatSync(directory).isDirectory()) fail("unsafe_output", `${subject} must be a regular directory.`);
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
export function publishOutputDirectory(staging: string, output: OutputInspection): void {
	if (!output.force) {
		renameSync(staging, output.directory);
		return;
	}
	const backupPlaceholder = createSiblingTemporaryDirectory(output.directory, "ceal-output-backup");
	rmSync(backupPlaceholder, { recursive: true, force: true });
	let previousMoved = false;
	let published = false;
	try {
		renameSync(output.directory, backupPlaceholder);
		previousMoved = true;
		renameSync(staging, output.directory);
		published = true;
	} catch (error) {
		if (previousMoved && !existsSync(output.directory) && existsSync(backupPlaceholder)) {
			try {
				renameSync(backupPlaceholder, output.directory);
				previousMoved = false;
			} catch (restoreError) {
				throw new Error(`Could not restore the previous output directory; backup retained at ${backupPlaceholder}.`, { cause: restoreError });
			}
		}
		throw error;
	} finally {
		if (published || !previousMoved) rmSync(backupPlaceholder, { recursive: true, force: true });
	}
}
