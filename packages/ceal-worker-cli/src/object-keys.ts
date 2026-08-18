// `.ts`, not the `.js` every other specifier in this directory uses, and the
// difference is load-bearing rather than an oversight. `scripts/` runs its
// sources through node directly and imports this module by its `.ts` path, so
// node — which does not remap a `.js` specifier onto a `.ts` file — resolves
// whatever this line says. Every other module here is a leaf and never exercised
// that path. `tsc` DOES remap it, which is why the mismatch typechecks green and
// fails only when the build actually runs the generator.
//
// `rewriteRelativeImportExtensions` in this package's tsconfig emits `.js` here,
// so the published artifact is unchanged; the flag leaves existing `.js`
// specifiers alone. Converting the other 175 is a separate decision.
import { isPlainJsonRecord } from "./canonical-json.ts";

/** Compare an object's own string keys with one contract-owned key list. */
export function sameObjectKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const required = [...expected].sort();
	return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

/** Validate exact own keys on an ordinary JSON object. */
export function hasExactObjectKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
	return isPlainJsonRecord(value) && Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
