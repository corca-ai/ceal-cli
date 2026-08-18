import path from "node:path";
import { asJsonRecord } from "./json-record.ts";

export type WorkerPackageVersionInput = { readonly source_path: string };
type ReadJson = (filePath: string, code: string) => unknown;
type ReleaseFailure = (code: string, message: string) => never;

/** Enforce the one release version shared by the Worker and client packages. */
export function resolveMatchingWorkerClientVersion(
	repoRoot: string,
	inputs: readonly WorkerPackageVersionInput[],
	readJson: ReadJson,
	fail: ReleaseFailure,
): string {
	const versions = inputs.map(
		(entry) => asJsonRecord(readJson(path.join(repoRoot, entry.source_path, "package.json"), "invalid_inventory"))?.version,
	);
	if (versions.some((value) => typeof value !== "string") || new Set(versions).size !== 1) {
		fail("version_mismatch", "Worker and client package versions must match exactly.");
	}
	const version = versions[0];
	if (typeof version !== "string") fail("version_mismatch", "Worker and client package versions must match exactly.");
	return version;
}
