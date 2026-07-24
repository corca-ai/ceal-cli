import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	RECEIPT_SPOOL_MAX_ENTRIES,
	RECEIPT_SPOOL_RETENTION_MS,
	CealReceiptSpoolStoreError,
	createCealReceiptSpoolStore,
	receiptSpoolEntryFromCallResult,
} from "../dist/receipt-spool.js";

const BASE_TIME = Date.parse("2026-07-24T12:00:00.000Z");

function entry(overrides = {}) {
	return {
		recordedAt: BASE_TIME,
		requestRef: "narnia:call:1:call",
		status: "completed",
		evidence: "readback_verified",
		auditRefs: ["gateway-audit:event:001"],
		capabilityId: "message.search",
		targetRef: "target:team-inbox",
		...overrides,
	};
}

test("receipt spool appends owner-only and reads entries back", async () => {
	await withHome(async (home) => {
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		assert.equal(await store.load(), null);
		await store.append(entry());
		const state = await store.load();
		assert.deepEqual(state.entries, [entry()]);
		assert.deepEqual(state.bounds, { maxEntries: RECEIPT_SPOOL_MAX_ENTRIES, retentionMs: RECEIPT_SPOOL_RETENTION_MS });
		const file = spoolFile(home);
		assert.equal(statSync(file).mode & 0o777, 0o600);
		assert.equal(statSync(path.join(home, ".ceal")).mode & 0o777, 0o700);
		await store.remove();
		assert.equal(await store.load(), null);
	});
});

test("receipt spool enforces entry-count and retention bounds on append", async () => {
	await withHome(async (home) => {
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		// One expired entry plus enough fresh entries to overflow the cap.
		await store.append(entry({ recordedAt: BASE_TIME - RECEIPT_SPOOL_RETENTION_MS - 1, requestRef: "narnia:call:expired" }));
		for (let index = 0; index <= RECEIPT_SPOOL_MAX_ENTRIES; index += 1) {
			await store.append(entry({ recordedAt: BASE_TIME + index, requestRef: `narnia:call:${index}` }));
		}
		const state = await store.load();
		assert.equal(state.entries.length, RECEIPT_SPOOL_MAX_ENTRIES);
		assert.equal(state.entries[0].requestRef, "narnia:call:1");
		assert.equal(state.entries.at(-1).requestRef, `narnia:call:${RECEIPT_SPOOL_MAX_ENTRIES}`);
		assert.equal(state.entries.some((item) => item.requestRef === "narnia:call:expired"), false);
	});
});

test("receipt spool applies retention on read and drops far-future entries", async () => {
	await withHome(async (home) => {
		await createCealReceiptSpoolStore(home, () => BASE_TIME).append(entry());
		// A dormant client past the retention window serves nothing, even though
		// no append ran to trim the file.
		const dormant = await createCealReceiptSpoolStore(home, () => BASE_TIME + RECEIPT_SPOOL_RETENTION_MS + 1).load();
		assert.deepEqual(dormant.entries, []);
	});
	await withHome(async (home) => {
		// A future-dated entry beyond clock-skew tolerance could never expire, so
		// it is dropped instead of retained.
		await createCealReceiptSpoolStore(home, () => BASE_TIME).append(entry());
		const file = spoolFile(home);
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		parsed.entries.push({
			recorded_at: new Date(BASE_TIME + 60 * 60 * 1000).toISOString(),
			request_ref: "narnia:call:future", status: "completed", evidence: "readback_verified", audit_refs: [],
		});
		writeFileSync(file, JSON.stringify(parsed), { mode: 0o600 });
		const state = await createCealReceiptSpoolStore(home, () => BASE_TIME).load();
		assert.deepEqual(state.entries, [entry()]);
	});
});

test("receipt spool read degrades to a miss on any anomaly instead of throwing", async () => {
	await withHome(async (home) => {
		writeFileSync(spoolFile(home), "{ not json", { mode: 0o600 });
		assert.equal(await createCealReceiptSpoolStore(home, () => BASE_TIME).load(), null);
	});
	await withHome(async (home) => {
		writeFileSync(spoolFile(home), JSON.stringify({ schema_version: "wrong", entries: [] }), { mode: 0o600 });
		assert.equal(await createCealReceiptSpoolStore(home, () => BASE_TIME).load(), null);
	});
	await withHome(async (home) => {
		writeFileSync(spoolFile(home), JSON.stringify({ schema_version: "ceal.receipt_spool.v1", entries: [] }), { mode: 0o644 });
		assert.equal(await createCealReceiptSpoolStore(home, () => BASE_TIME).load(), null);
	});
});

test("receipt spool drops individually invalid entries without losing the rest", async () => {
	await withHome(async (home) => {
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		await store.append(entry());
		const file = spoolFile(home);
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		parsed.entries.push({ recorded_at: "2026-07-24T12:00:01.000Z", request_ref: "free text with spaces", status: "completed", evidence: "readback_verified", audit_refs: [] });
		parsed.entries.push({ recorded_at: "2026-07-24T12:00:02.000Z", request_ref: "narnia:call:2:call", status: "surprising_status", evidence: "readback_verified", audit_refs: [] });
		writeFileSync(file, JSON.stringify(parsed), { mode: 0o600 });
		const state = await store.load();
		assert.deepEqual(state.entries, [entry()]);
	});
});

test("receipt spool refuses an unsafe entry and a symlinked store", async () => {
	await withHome(async (home) => {
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		await assert.rejects(store.append(entry({ requestRef: "free text with spaces" })), CealReceiptSpoolStoreError);
		mkdirSync(path.join(home, ".ceal"), { mode: 0o700, recursive: true });
		writeFileSync(path.join(home, "elsewhere.json"), "{}", { mode: 0o600 });
		symlinkSync(path.join(home, "elsewhere.json"), spoolFile(home));
		await assert.rejects(store.append(entry()), CealReceiptSpoolStoreError);
	});
	assert.throws(() => createCealReceiptSpoolStore(undefined), CealReceiptSpoolStoreError);
});

test("call-result projection keeps only allowlisted metadata and skips receipt-less envelopes", () => {
	const completed = receiptSpoolEntryFromCallResult({
		schema_version: "ceal.result.v2",
		status: "completed",
		capability: "message.search",
		target: "target:team-inbox",
		data: { results: [{ text: "secret provider payload" }] },
		receipt: { evidence: "readback_verified", request_ref: "narnia:call:1:call", audit_refs: ["gateway-audit:event:001"] },
	}, BASE_TIME);
	assert.deepEqual(completed, entry());
	assert.equal(JSON.stringify(completed).includes("secret"), false);

	const blocked = receiptSpoolEntryFromCallResult({
		schema_version: "ceal.result.v2",
		status: "blocked",
		capability: "message.create",
		target: "target:team-inbox",
		receipt: { evidence: "not_read_back", request_ref: "narnia:call:2:call", audit_refs: [] },
		error: { kind: "authorization_denied", message: "long free text", next_action: "more free text" },
	}, BASE_TIME);
	assert.deepEqual(blocked, {
		recordedAt: BASE_TIME, requestRef: "narnia:call:2:call", status: "blocked", evidence: "not_read_back",
		auditRefs: [], capabilityId: "message.create", targetRef: "target:team-inbox", errorKind: "authorization_denied",
	});

	// Pre-issue failures carry no receipt and must not be spooled.
	assert.equal(receiptSpoolEntryFromCallResult({
		schema_version: "ceal.result.v2", status: "error",
		error: { kind: "session_unavailable", message: "m", next_action: "n" },
	}, BASE_TIME), null);
	// Unsafe refs or unknown vocabulary drop the whole entry rather than spooling free text.
	assert.equal(receiptSpoolEntryFromCallResult({
		schema_version: "ceal.result.v2", status: "completed",
		receipt: { evidence: "readback_verified", request_ref: "free text with spaces", audit_refs: [] },
	}, BASE_TIME), null);
	assert.equal(receiptSpoolEntryFromCallResult({
		schema_version: "ceal.result.v2", status: "completed",
		receipt: { evidence: "invented_evidence", request_ref: "narnia:call:3:call", audit_refs: [] },
	}, BASE_TIME), null);
});

function spoolFile(home) {
	mkdirSync(path.join(home, ".ceal"), { mode: 0o700, recursive: true });
	return path.join(home, ".ceal", "receipt-spool.json");
}

async function withHome(callback) {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-receipt-spool-"));
	try {
		await callback(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}
