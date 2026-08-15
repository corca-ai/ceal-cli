import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from "node:fs";
import path from "node:path";
import { resolveAnchoredDirectory } from "./local-store-anchor.js";
import { type CealLocalPricingSnapshotV1, decodeLocalPricingSnapshot } from "./local-usage-dashboard.js";

const PRICING_SNAPSHOT_FILE = "pricing-snapshot.json";
const MAX_PRICING_SNAPSHOT_BYTES = 256 * 1024;

export type CealPricingSnapshotInspection =
	| { status: "absent"; reason: "store_absent" | "snapshot_absent" }
	| { status: "unsafe"; reason: "unsafe_store" | "unsafe_snapshot" }
	| { status: "unreadable"; reason: "snapshot_unreadable" }
	| { status: "invalid"; reason: "snapshot_too_large" | "snapshot_invalid" | "snapshot_future" }
	| {
			status: "ready";
			reason: "ready";
			observedAt: string;
			currency: string;
			rateCount: number;
			revisionFingerprint: string;
			snapshot: CealLocalPricingSnapshotV1;
	  };

export function inspectLocalPricingSnapshot(home: string, now = Date.now()): CealPricingSnapshotInspection {
	const directory = path.join(home, ".ceal");
	let directoryHandle: number | undefined;
	try {
		directoryHandle = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
	} catch (error) {
		return nodeErrorCode(error) === "ENOENT" ? { status: "absent", reason: "store_absent" } : { status: "unsafe", reason: "unsafe_store" };
	}
	let directoryStat: Stats;
	try {
		directoryStat = fstatSync(directoryHandle);
	} catch {
		safeClose(directoryHandle);
		return { status: "unreadable", reason: "snapshot_unreadable" };
	}
	if (!directoryStat.isDirectory() || !ownedByCurrentUser(directoryStat.uid) || (directoryStat.mode & 0o777) !== 0o700) {
		safeClose(directoryHandle);
		return { status: "unsafe", reason: "unsafe_store" };
	}
	let anchored: string;
	try {
		anchored = resolveAnchoredDirectory(directoryHandle, directory, directoryStat, 0o700, () => {
			throw new Error("unsafe_pricing_store");
		});
	} catch {
		safeClose(directoryHandle);
		return { status: "unsafe", reason: "unsafe_store" };
	}
	const file = path.join(anchored, PRICING_SNAPSHOT_FILE);

	let pathStat: Stats;
	try {
		pathStat = lstatSync(file);
	} catch (error) {
		const result =
			nodeErrorCode(error) === "ENOENT"
				? { status: "absent", reason: "snapshot_absent" }
				: { status: "unreadable", reason: "snapshot_unreadable" };
		safeClose(directoryHandle);
		return result as CealPricingSnapshotInspection;
	}
	if (
		!pathStat.isFile() ||
		pathStat.isSymbolicLink() ||
		pathStat.nlink !== 1 ||
		!ownedByCurrentUser(pathStat.uid) ||
		(pathStat.mode & 0o777) !== 0o600
	) {
		safeClose(directoryHandle);
		return { status: "unsafe", reason: "unsafe_snapshot" };
	}

	let handle: number | undefined;
	let openAnchor: string;
	try {
		openAnchor = resolveAnchoredDirectory(directoryHandle, directory, directoryStat, 0o700, () => {
			throw new Error("unsafe_pricing_store");
		});
	} catch {
		safeClose(directoryHandle);
		return { status: "unsafe", reason: "unsafe_store" };
	}
	try {
		handle = openSync(path.join(openAnchor, PRICING_SNAPSHOT_FILE), constants.O_RDONLY | constants.O_NOFOLLOW);
		const held = fstatSync(handle);
		if (held.dev !== pathStat.dev || held.ino !== pathStat.ino) return { status: "unreadable", reason: "snapshot_unreadable" };
		if (held.size > MAX_PRICING_SNAPSHOT_BYTES) return { status: "invalid", reason: "snapshot_too_large" };
		const bytes = Buffer.alloc(MAX_PRICING_SNAPSHOT_BYTES + 1);
		let offset = 0;
		while (offset < bytes.length) {
			const count = readSync(handle, bytes, offset, bytes.length - offset, null);
			if (count === 0) break;
			offset += count;
		}
		if (offset > MAX_PRICING_SNAPSHOT_BYTES) return { status: "invalid", reason: "snapshot_too_large" };
		let decoded: CealLocalPricingSnapshotV1 | null;
		try {
			decoded = decodeLocalPricingSnapshot(JSON.parse(bytes.subarray(0, offset).toString("utf8")));
		} catch {
			decoded = null;
		}
		if (!decoded) return { status: "invalid", reason: "snapshot_invalid" };
		if (Date.parse(decoded.observed_at) > now) return { status: "invalid", reason: "snapshot_future" };
		return {
			status: "ready",
			reason: "ready",
			observedAt: decoded.observed_at,
			currency: decoded.currency,
			rateCount: decoded.rates.length,
			revisionFingerprint: createHash("sha256").update(decoded.revision).digest("hex").slice(0, 16),
			snapshot: decoded,
		};
	} catch {
		return { status: "unreadable", reason: "snapshot_unreadable" };
	} finally {
		safeClose(handle);
		safeClose(directoryHandle);
	}
}

export function loadLocalPricingSnapshot(home: string, now = Date.now()): CealLocalPricingSnapshotV1 | null {
	const inspection = inspectLocalPricingSnapshot(home, now);
	return inspection.status === "ready" ? inspection.snapshot : null;
}

function ownedByCurrentUser(uid: number): boolean {
	return typeof process.getuid !== "function" || uid === process.getuid();
}

function nodeErrorCode(error: unknown): string | undefined {
	return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function safeClose(handle: number | undefined): void {
	if (handle === undefined) return;
	try {
		closeSync(handle);
	} catch {
		/* a close failure must not replace the bounded classification */
	}
}
