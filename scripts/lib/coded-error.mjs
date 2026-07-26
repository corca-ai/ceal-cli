// Every release script raises the same error shape: a stable `code` a caller can
// branch on plus a human `message`. That shape was declared nine times by hand.
//
// `scripts/build-platform-binaries.mjs` and `scripts/build-release-manifest.mjs`
// keep their own declarations. They are frozen compatibility material shared with
// corca-ai/ceal, and making them import a new local module would break that copy
// outright if the sync does not carry `scripts/lib/` — a worse outcome than a
// duplicated six-line constructor. The duplication there is deliberate, not
// missed.

/**
 * Builds an Error subclass carrying a `code`, with `name` set for readable
 * stack traces and `instanceof` intact for callers that re-throw selectively.
 *
 * @param name class name, used for both `error.name` and the class's own name
 * @param extraFields ordered names of additional constructor parameters, each
 *   assigned to the instance; used by the consumer verifier's `workspace`
 */
export function codedErrorClass(name, extraFields = []) {
	class CodedError extends Error {
		constructor(code, message, ...rest) {
			super(message);
			this.name = name;
			this.code = code;
			for (const [index, field] of extraFields.entries()) {
				this[field] = rest[index] ?? null;
			}
		}
	}
	// Without this the class reports as `CodedError`, which would make every
	// release script's failures look like they came from the same place.
	Object.defineProperty(CodedError, "name", { value: name, configurable: true });
	return CodedError;
}
