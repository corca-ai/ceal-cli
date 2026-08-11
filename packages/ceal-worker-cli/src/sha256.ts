import { createHash } from "node:crypto";

/** Return the lowercase SHA-256 digest used by worker install identities. */
export function sha256(bytes: Buffer | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}
