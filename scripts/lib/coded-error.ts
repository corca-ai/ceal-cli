// Every release script raises the same error shape: a stable `code` a caller can
// branch on plus a human `message`. That shape was declared nine times by hand.
//
// Two of those nine copies survived here on purpose, because the frozen scripts
// holding them could not import a local module without breaking the sync to
// corca-ai/ceal. Those scripts are deleted, so the exemption is spent: a new
// release script imports this, it does not redeclare the shape.

/**
 * Builds an Error subclass carrying a `code`, with `name` set for readable
 * stack traces and `instanceof` intact for callers that re-throw selectively.
 *
 * @param name class name, used for both `error.name` and the class's own name
 * @param extraFields ordered names of additional constructor parameters, each
 *   assigned to the instance; used by the consumer verifier's `workspace`
 */
export function codedErrorClass(name: string, extraFields: readonly string[] = []) {
	class CodedError extends Error {
		code: string;

		constructor(code: string, message: string, ...rest: unknown[]) {
			super(message);
			this.name = name;
			this.code = code;
			for (const [index, field] of extraFields.entries()) {
				Object.defineProperty(this, field, {
					value: rest[index] ?? null,
					enumerable: true,
					configurable: true,
					writable: true,
				});
			}
		}
	}
	// Without this the class reports as `CodedError`, which would make every
	// release script's failures look like they came from the same place.
	Object.defineProperty(CodedError, "name", { value: name, configurable: true });
	return CodedError;
}
