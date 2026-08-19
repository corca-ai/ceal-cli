import { permissionMode } from "./filesystem-mode.js";
import { lstatSync, type Stats } from "node:fs";
import path from "node:path";

/** Resolve child operations back to one already-open owner-only directory. */
export function resolveAnchoredDirectory(
	directoryHandle: number,
	directory: string,
	expected: Stats,
	expectedMode: number,
	unsafe: () => never,
): string {
	if (process.platform === "linux") return path.join("/proc/self/fd", String(directoryHandle));
	if (process.platform !== "darwin") unsafe();
	let observed: Stats;
	try {
		// Darwin exposes the descriptor but neither traverses children below it nor
		// recovers the opened pathname from it through Node. Verify the caller's
		// visible path against the held descriptor before every path operation;
		// a renamed or substituted parent fails closed instead of being followed.
		observed = lstatSync(directory);
	} catch {
		unsafe();
	}
	if (
		!observed.isDirectory() ||
		observed.isSymbolicLink() ||
		observed.dev !== expected.dev ||
		observed.ino !== expected.ino ||
		permissionMode(observed) !== expectedMode
	)
		unsafe();
	return directory;
}
