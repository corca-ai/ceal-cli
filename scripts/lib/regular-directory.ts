import { existsSync, lstatSync } from "node:fs";

/** Whether a path exists as a regular, non-symlink directory. */
export function isRegularNonSymlinkDirectory(target: string): boolean {
	if (!existsSync(target)) return false;
	const metadata = lstatSync(target);
	return metadata.isDirectory() && !metadata.isSymbolicLink();
}
