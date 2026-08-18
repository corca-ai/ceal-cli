// Every script here is both a module a suite imports and a command a maintainer
// runs, so each ends with the same four-line guard deciding which it is right
// now. Three copies existed the moment the gate-attestation scripts landed, and
// the duplicate ratchet named them on the first run — which is the point of
// arming it.
//
// The comparison is `path.resolve` against `fileURLToPath`, not a string compare
// of `process.argv[1]`: node hands over the path as typed, so `node ./x.ts` and
// `node scripts/../scripts/x.ts` are the same file and two different strings.

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Whether this module is the one node was asked to run.
 *
 * @param moduleUrl the caller's own `import.meta.url`
 * @returns true when the caller should behave as a command rather than a module
 */
export function isMainModule(moduleUrl: string): boolean {
	const entrypoint = process.argv[1];
	return entrypoint !== undefined && path.resolve(entrypoint) === fileURLToPath(moduleUrl);
}
