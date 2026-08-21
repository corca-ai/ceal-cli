import { existsSync, lstatSync } from "node:fs";

/**
 * Whether a path exists as a regular, non-symlink directory.
 *
 * `lstatSync` does not follow, so a symlink -- to a directory or to anything
 * else -- reports `isDirectory() === false` and is refused by that test alone.
 * A trailing `&& !metadata.isSymbolicLink()` conjunct was therefore always true
 * wherever it was reached, and it is gone. The non-symlink half of this
 * function's name is carried by `lstatSync`, not by a second test.
 */
export function isRegularNonSymlinkDirectory(target: string): boolean {
	if (!existsSync(target)) return false;
	return lstatSync(target).isDirectory();
}
