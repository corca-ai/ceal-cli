import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { isRegularNonSymlinkDirectory } from "../../scripts/lib/regular-directory.ts";
import { resolveMatchingWorkerClientVersion } from "../../scripts/lib/release-version.ts";

test("release owners preserve matching versions and reject mismatch or symlinked directories", () => {
	const repoRoot = mkdtempSync(path.join(tmpdir(), "ceal-release-version-"));
	try {
		const worker = path.join(repoRoot, "packages", "worker");
		const client = path.join(repoRoot, "packages", "client");
		mkdirSync(worker, { recursive: true });
		mkdirSync(client, { recursive: true });
		writeFileSync(path.join(worker, "package.json"), JSON.stringify({ version: "1.2.3" }));
		writeFileSync(path.join(client, "package.json"), JSON.stringify({ version: "1.2.3" }));
		const readJson = (filePath: string): unknown => JSON.parse(readFileSync(filePath, "utf8"));
		const fail = (code: string, message: string): never => {
			throw new Error(`${code}:${message}`);
		};
		const inputs = [{ source_path: "packages/worker" }, { source_path: "packages/client" }];

		assert.equal(resolveMatchingWorkerClientVersion(repoRoot, inputs, readJson, fail), "1.2.3");
		writeFileSync(path.join(client, "package.json"), JSON.stringify({ version: "1.2.4" }));
		assert.throws(() => resolveMatchingWorkerClientVersion(repoRoot, inputs, readJson, fail), /version_mismatch/u);

		const realDirectory = path.join(repoRoot, "real");
		const link = path.join(repoRoot, "link");
		mkdirSync(realDirectory);
		symlinkSync(realDirectory, link, "dir");
		assert.equal(isRegularNonSymlinkDirectory(realDirectory), true);
		assert.equal(isRegularNonSymlinkDirectory(link), false);
		assert.equal(isRegularNonSymlinkDirectory(path.join(repoRoot, "missing")), false);
	} finally {
		rmSync(repoRoot, { recursive: true, force: true });
	}
});
