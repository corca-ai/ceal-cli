import { lstatSync, realpathSync, type Stats } from "node:fs";
import path from "node:path";

/** Resolve child operations back to one already-open owner-only directory. */
export function resolveAnchoredDirectory(directoryHandle: number, expected: Stats, expectedMode: number, unsafe: () => never): string {
	if (process.platform === "linux") return path.join("/proc/self/fd", String(directoryHandle));
	if (process.platform !== "darwin") unsafe();
	let directory: string;
	let observed: Stats;
	try {
		// Darwin's /dev/fd entry identifies the descriptor but is not itself a
		// traversable directory. realpath asks the still-open descriptor for the
		// directory's current name, including after that directory was renamed.
		directory = realpathSync(path.join("/dev/fd", String(directoryHandle)));
		observed = lstatSync(directory);
	} catch {
		unsafe();
	}
	if (
		!observed.isDirectory() ||
		observed.isSymbolicLink() ||
		observed.dev !== expected.dev ||
		observed.ino !== expected.ino ||
		(observed.mode & 0o777) !== expectedMode
	)
		unsafe();
	return directory;
}
