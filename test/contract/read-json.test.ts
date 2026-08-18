import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJsonReader } from "../../scripts/lib/read-json.ts";
import { WorkerReleaseInputError } from "../../scripts/worker-release-inputs.ts";

test("shared JSON reader preserves parsed values and caller failures", () => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-read-json-"));
	try {
		const file = path.join(root, "value.json");
		writeFileSync(file, JSON.stringify({ owner: "worker" }));
		const fail = (code: string, message: string): never => {
			throw new WorkerReleaseInputError(code, message);
		};
		const readJson = createJsonReader(fail, "JSON input is invalid.");
		assert.deepEqual(readJson(file, "valid_json"), { owner: "worker" });
		writeFileSync(file, "{ invalid\n");
		assert.throws(
			() => readJson(file, "invalid_json"),
			(error) => error instanceof WorkerReleaseInputError && error.code === "invalid_json" && error.message === "JSON input is invalid.",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
