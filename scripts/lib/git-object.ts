import { isLowercaseHexDigest } from "./hex-digest.ts";

/** Canonical lowercase Git object identity grammar for Worker release tooling. */

export function isGitObject(value: unknown): value is string {
	return isLowercaseHexDigest(value, 40);
}
