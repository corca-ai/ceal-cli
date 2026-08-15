import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadLocalPricingSnapshot } from "../dist/pricing-snapshot.js";

const NOW = Date.parse("2026-08-15T00:00:00.000Z");
const snapshot = {
	schema_version: "ceal.local_pricing_snapshot.v1",
	snapshot_ref: "pricing:local:2026-08-15",
	revision: "pricing-rev-1",
	observed_at: "2026-08-14T00:00:00.000Z",
	currency: "USD",
	rates: [
		{
			model_key: "gpt-5",
			input_per_million: "1.25",
			output_per_million: "10",
			cache_read_per_million: "0.125",
			cache_write_per_million: "0",
		},
	],
};

test("loads only an owner-only bounded local pricing snapshot", (context) => {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-pricing-"));
	context.after(() => rmSync(home, { recursive: true, force: true }));
	const directory = path.join(home, ".ceal");
	const file = path.join(directory, "pricing-snapshot.json");
	mkdirSync(directory, { mode: 0o700 });
	writeFileSync(file, JSON.stringify(snapshot), { mode: 0o600 });
	assert.deepEqual(loadLocalPricingSnapshot(home, NOW), snapshot);
	chmodSync(file, 0o644);
	assert.equal(loadLocalPricingSnapshot(home, NOW), null);
	chmodSync(file, 0o600);
	writeFileSync(file, JSON.stringify({ ...snapshot, observed_at: "2026-08-16T00:00:00.000Z" }), { mode: 0o600 });
	assert.equal(loadLocalPricingSnapshot(home, NOW), null);
	writeFileSync(file, "x".repeat(256 * 1024 + 1), { mode: 0o600 });
	assert.equal(loadLocalPricingSnapshot(home, NOW), null);
});

test("refuses a symlinked pricing snapshot", (context) => {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-pricing-"));
	context.after(() => rmSync(home, { recursive: true, force: true }));
	const directory = path.join(home, ".ceal");
	const outside = path.join(home, "outside.json");
	mkdirSync(directory, { mode: 0o700 });
	writeFileSync(outside, JSON.stringify(snapshot), { mode: 0o600 });
	symlinkSync(outside, path.join(directory, "pricing-snapshot.json"));
	assert.equal(loadLocalPricingSnapshot(home, NOW), null);
});
