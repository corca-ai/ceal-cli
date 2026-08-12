import { createHash } from "node:crypto";

/** Return the lowercase SHA-256 digest used by worker install identities. */
export function sha256(bytes: Buffer | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** Whether a value is one canonical lowercase SHA-256 digest. */
export function isSha256Digest(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
