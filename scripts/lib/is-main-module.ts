import path from "node:path";
import { fileURLToPath } from "node:url";

/** Return whether this module is the process entrypoint. */
export function isMainModule(moduleUrl: string): boolean {
	const entrypoint = process.argv[1];
	return entrypoint !== undefined && path.resolve(entrypoint) === fileURLToPath(moduleUrl);
}
