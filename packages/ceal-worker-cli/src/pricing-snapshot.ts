import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { resolveAnchoredDirectory } from "./local-store-anchor.js";
import { type CealLocalPricingSnapshotV1, decodeLocalPricingSnapshot } from "./local-usage-dashboard.js";

const PRICING_SNAPSHOT_FILE = "pricing-snapshot.json";
const MAX_PRICING_SNAPSHOT_BYTES = 256 * 1024;

export function loadLocalPricingSnapshot(home: string, now = Date.now()): CealLocalPricingSnapshotV1 | null {
	const directory = path.join(home, ".ceal");
	let directoryHandle: number | undefined;
	let fileHandle: number | undefined;
	try {
		directoryHandle = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
		const directoryStat = fstatSync(directoryHandle);
		if (!directoryStat.isDirectory() || (directoryStat.mode & 0o777) !== 0o700) return null;
		const anchored = resolveAnchoredDirectory(directoryHandle, directory, directoryStat, 0o700, () => {
			throw new Error("unsafe_pricing_store");
		});
		fileHandle = openSync(path.join(anchored, PRICING_SNAPSHOT_FILE), constants.O_RDONLY | constants.O_NOFOLLOW);
		const fileStat = fstatSync(fileHandle);
		if (!fileStat.isFile() || fileStat.nlink !== 1 || (fileStat.mode & 0o777) !== 0o600 || fileStat.size > MAX_PRICING_SNAPSHOT_BYTES)
			return null;
		const bytes = Buffer.alloc(MAX_PRICING_SNAPSHOT_BYTES + 1);
		let offset = 0;
		while (offset < bytes.length) {
			const count = readSync(fileHandle, bytes, offset, bytes.length - offset, null);
			if (count === 0) break;
			offset += count;
		}
		if (offset > MAX_PRICING_SNAPSHOT_BYTES) return null;
		const snapshot = decodeLocalPricingSnapshot(JSON.parse(bytes.subarray(0, offset).toString("utf8")));
		if (!snapshot || Date.parse(snapshot.observed_at) > now) return null;
		return snapshot;
	} catch {
		return null;
	} finally {
		if (fileHandle !== undefined) closeSync(fileHandle);
		if (directoryHandle !== undefined) closeSync(directoryHandle);
	}
}
