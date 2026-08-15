// Every standalone script here ends the same two ways: say one prefixed line on
// stderr, then exit with a code that means something to the caller. Each had
// written its own three-line copy of that, which is how the prefix drifts and
// how an exit code quietly becomes 1 for everything.
//
// This exists because the duplicate ratchet caught the second copy on the day it
// was armed, which is the whole point of arming it.

/**
 * Writes one prefixed line to stderr and exits the process.
 *
 * @param {string} prefix Script name the reader can search for.
 * @param {string} message What happened, in one line.
 * @param {number} code Exit status. Pick it deliberately: 0 means the caller
 *   should carry on, and anything else means it should not.
 * @returns {never}
 */
export function exitWith(prefix: string, message: string, code: number): never {
	process.stderr.write(`${prefix}: ${message}\n`);
	process.exit(code);
}
