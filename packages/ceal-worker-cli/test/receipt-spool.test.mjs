import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	CealReceiptSpoolStoreError,
	createCealReceiptSpoolStore,
	RECEIPT_SPOOL_MAX_ENTRIES,
	RECEIPT_SPOOL_RETENTION_MS,
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
		assert.equal(
			state.entries.some((item) => item.requestRef === "narnia:call:expired"),
			false,
		);
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
			request_ref: "narnia:call:future",
			status: "completed",
			evidence: "readback_verified",
			audit_refs: [],
		});
		writeFileSync(file, JSON.stringify(parsed), { mode: 0o600 });
		const state = await createCealReceiptSpoolStore(home, () => BASE_TIME).load();
		assert.deepEqual(state.entries, [entry()]);
	});
});

test("separate ceal processes each keep their receipt when they append at once", async () => {
	// The regression this pins: appendEntry is a read-modify-write of one file,
	// so without a cross-process lock every writer reads the same prior state
	// and the last rename wins — losing the others' receipts silently, which is
	// the exact under-report `ceal observe` exists to surface. The prior spool
	// is pre-filled so the read-serialize-write window is wide enough that an
	// unlocked build loses entries reliably rather than only under load.
	await withHome(async (home) => {
		const store = createCealReceiptSpoolStore(home);
		const priors = Array.from({ length: 150 }, (_, index) => `narnia:call:prior:${index}`);
		for (const ref of priors) await store.append(entry({ recordedAt: Date.now(), requestRef: ref }));
		const refs = Array.from({ length: 6 }, (_, index) => `narnia:call:concurrent:${index}`);
		// A shared absolute start instant, spun to rather than slept to, lines the
		// writers up far more tightly than spawn order alone would.
		const startAt = Date.now() + START_BARRIER_MS;
		const results = await Promise.all(refs.map((ref) => appendInChildProcess(home, ref, startAt)));
		for (const result of results) assert.equal(result.code, 0, result.stderr);
		// Without this, the test degrades silently instead of failing: on a host
		// slow enough that a child reaches the barrier after it has already
		// passed, the appends serialize naturally, an unlocked build keeps every
		// receipt, and the regression proof passes while proving nothing. Each
		// child reports the margin it still had when it arrived, so a run that
		// never achieved overlap fails as that, rather than as green.
		const margins = results.map((result) => Number(result.stdout.trim()));
		assert.deepEqual(
			margins.filter((margin) => !(margin >= 0)),
			[],
			`writers did not overlap; margins to the shared barrier were ${margins.join(", ")}ms`,
		);
		// The count is exact because 150 priors plus 6 concurrent stays under the
		// entry cap: a lock that kept the six by clobbering the priors would pass
		// a membership-only assertion.
		const spooled = new Set((await store.load()).entries.map((item) => item.requestRef));
		assert.deepEqual(
			[...priors, ...refs].filter((ref) => !spooled.has(ref)),
			[],
		);
		assert.equal(spooled.size, priors.length + refs.length);
	});
});

// Long enough that six `node` cold starts finish before the barrier on a loaded
// host, short enough not to dominate the suite. The margin assertion above is
// what catches a host where it was not long enough after all.
const START_BARRIER_MS = 750;

function appendInChildProcess(home, requestRef, startAt) {
	const source = `
		const { createCealReceiptSpoolStore } = await import(${JSON.stringify(new URL("../dist/receipt-spool.js", import.meta.url).href)});
		const startAt = Number(process.env.SPOOL_START_AT);
		const store = createCealReceiptSpoolStore(process.env.HOME);
		// Measured before the wait: this is how much slack this child still had,
		// and a negative value means it arrived after the gun already went off.
		const margin = startAt - Date.now();
		await new Promise((resolve) => setTimeout(resolve, Math.max(0, margin - 20)));
		while (Date.now() < startAt) {}
		await store.append({
			recordedAt: Date.now(),
			requestRef: process.env.SPOOL_REQUEST_REF,
			status: "completed",
			evidence: "readback_verified",
			auditRefs: [],
		});
		process.stdout.write(String(margin));
	`;
	const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
		env: { ...process.env, HOME: home, SPOOL_REQUEST_REF: requestRef, SPOOL_START_AT: String(startAt) },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => {
		stdout += String(chunk);
	});
	child.stderr.on("data", (chunk) => {
		stderr += String(chunk);
	});
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => resolve({ code, stdout, stderr }));
	});
}

test("receipt spool load reports a present-but-unusable file while append still soft-misses", async () => {
	// load throws so the observer can render `unreadable` instead of an empty
	// history; append treats the same anomaly as a miss and keeps recording.
	const anomalies = [
		["{ not json", 0o600],
		[JSON.stringify({ schema_version: "wrong", entries: [] }), 0o600],
		[JSON.stringify({ schema_version: "ceal.receipt_spool.v1", entries: [] }), 0o644],
	];
	for (const [content, mode] of anomalies) {
		await withHome(async (home) => {
			writeFileSync(spoolFile(home), content, { mode });
			const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
			await assert.rejects(store.load(), CealReceiptSpoolStoreError);
		});
	}
	await withHome(async (home) => {
		writeFileSync(spoolFile(home), "{ not json", { mode: 0o600 });
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		await store.append(entry());
		assert.deepEqual((await store.load()).entries, [entry()]);
	});
});

test("receipt spool drops individually invalid entries without losing the rest", async () => {
	await withHome(async (home) => {
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		await store.append(entry());
		const file = spoolFile(home);
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		parsed.entries.push({
			recorded_at: "2026-07-24T12:00:01.000Z",
			request_ref: "free text with spaces",
			status: "completed",
			evidence: "readback_verified",
			audit_refs: [],
		});
		parsed.entries.push({
			recorded_at: "2026-07-24T12:00:02.000Z",
			request_ref: "narnia:call:2:call",
			status: "surprising_status",
			evidence: "readback_verified",
			audit_refs: [],
		});
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
	const completed = receiptSpoolEntryFromCallResult(
		{
			schema_version: "ceal.result.v2",
			status: "completed",
			capability: "message.search",
			target: "target:team-inbox",
			data: { results: [{ text: "secret provider payload" }] },
			receipt: { evidence: "readback_verified", request_ref: "narnia:call:1:call", audit_refs: ["gateway-audit:event:001"] },
		},
		BASE_TIME,
	);
	assert.deepEqual(completed, entry());
	assert.equal(JSON.stringify(completed).includes("secret"), false);

	const blocked = receiptSpoolEntryFromCallResult(
		{
			schema_version: "ceal.result.v2",
			status: "blocked",
			capability: "message.create",
			target: "target:team-inbox",
			receipt: { evidence: "not_read_back", request_ref: "narnia:call:2:call", audit_refs: [] },
			error: { kind: "authorization_denied", message: "long free text", next_action: "more free text" },
		},
		BASE_TIME,
	);
	assert.deepEqual(blocked, {
		recordedAt: BASE_TIME,
		requestRef: "narnia:call:2:call",
		status: "blocked",
		evidence: "not_read_back",
		auditRefs: [],
		capabilityId: "message.create",
		targetRef: "target:team-inbox",
		errorKind: "authorization_denied",
	});

	// Pre-issue failures carry no receipt and must not be spooled.
	assert.equal(
		receiptSpoolEntryFromCallResult(
			{
				schema_version: "ceal.result.v2",
				status: "error",
				error: { kind: "session_unavailable", message: "m", next_action: "n" },
			},
			BASE_TIME,
		),
		null,
	);
	// Unsafe refs or unknown vocabulary drop the whole entry rather than spooling free text.
	assert.equal(
		receiptSpoolEntryFromCallResult(
			{
				schema_version: "ceal.result.v2",
				status: "completed",
				receipt: { evidence: "readback_verified", request_ref: "free text with spaces", audit_refs: [] },
			},
			BASE_TIME,
		),
		null,
	);
	assert.equal(
		receiptSpoolEntryFromCallResult(
			{
				schema_version: "ceal.result.v2",
				status: "completed",
				receipt: { evidence: "invented_evidence", request_ref: "narnia:call:3:call", audit_refs: [] },
			},
			BASE_TIME,
		),
		null,
	);
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
