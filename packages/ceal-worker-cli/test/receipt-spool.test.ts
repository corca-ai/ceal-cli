import "../../../test/require-source-lane.ts";
import { required as requiredValue } from "../../../test/required.ts";
import {
	CealReceiptSpoolStoreError,
	createCealReceiptSpoolStore as createRawReceiptSpoolStore,
	RECEIPT_SPOOL_MAX_ENTRIES,
	RECEIPT_SPOOL_RETENTION_MS,
	receiptSpoolEntryFromCallResult,
} from "../dist/receipt-spool.js";
import { changedSessionIdentityBindings, sessionIdentityDiscriminator } from "../dist/session-identity.js";
import type { CealStoredSession } from "../src/profile-store.js";
import type { CealReceiptSpoolEntry, CealReceiptSpoolState } from "../src/receipt-spool.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const BASE_TIME = Date.parse("2026-07-24T12:00:00.000Z");
const TEST_IDENTITY = "a".repeat(64);

type TestReceiptSpoolStore = {
	load: () => Promise<CealReceiptSpoolState | null>;
	append: (value: CealReceiptSpoolEntry) => Promise<void>;
	recordDrop: () => Promise<void>;
	remove: () => Promise<void>;
};

type ProcessGateResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

async function requireState(load: () => Promise<CealReceiptSpoolState | null>): Promise<CealReceiptSpoolState> {
	const state = await load();
	assert.ok(state);
	return state;
}

function createCealReceiptSpoolStore(
	home: string | undefined,
	now: () => number = Date.now,
	identity = TEST_IDENTITY,
): TestReceiptSpoolStore {
	const store = createRawReceiptSpoolStore(home, now);
	return {
		load: () => store.load(identity),
		append: (value) => store.append(identity, value),
		recordDrop: () => store.recordDrop(identity),
		remove: () => store.remove(),
	};
}

function entry(overrides: Partial<CealReceiptSpoolEntry> = {}): CealReceiptSpoolEntry {
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
		await store.remove();
		await store.append(entry());
		const state = await requireState(store.load);
		assert.deepEqual(state.entries, [entry()]);
		assert.deepEqual(state.bounds, { maxEntries: RECEIPT_SPOOL_MAX_ENTRIES, retentionMs: RECEIPT_SPOOL_RETENTION_MS });
		const file = spoolFile(home);
		assert.equal(statSync(file).mode & 0o777, 0o600);
		assert.equal(statSync(path.join(home, ".ceal")).mode & 0o777, 0o700);
		await store.remove();
		assert.equal(await store.load(), null);
	});
});

test("receipt spool never attributes delayed old-session state to its replacement", async () => {
	await withHome(async (home) => {
		const raw = createRawReceiptSpoolStore(home, () => BASE_TIME);
		const oldIdentity = "a".repeat(64);
		const newIdentity = "b".repeat(64);

		await raw.append(oldIdentity, entry({ requestRef: "narnia:call:old:call" }));
		await raw.recordDrop(oldIdentity);
		await raw.remove();

		// An already-running old process can finish after replacement cleanup. Its
		// advisory bytes may reappear, but their identity must make them invisible
		// to the new session rather than merge two subjects in `ceal observe`.
		await raw.append(oldIdentity, entry({ requestRef: "narnia:call:late-old:call" }));
		await raw.recordDrop(oldIdentity);
		assert.equal(await raw.load(newIdentity), null);

		await raw.append(newIdentity, entry({ requestRef: "narnia:call:new:call" }));
		await raw.recordDrop(newIdentity);
		const current = await requireState(() => raw.load(newIdentity));
		assert.deepEqual(
			current.entries.map((value) => value.requestRef),
			["narnia:call:new:call"],
		);
		assert.deepEqual(current.drops, { count: 1, atLeast: false });
		assert.equal(await raw.load(oldIdentity), null, "the current write replaces the stale identity instead of merging it");
	});
});

test("receipt attribution derives from the same stable bindings as session replacement", () => {
	const current = storedIdentitySession();
	const reenrolled = { ...current, registrationRef: "registration:new", clientRef: "client:new" };
	assert.deepEqual(changedSessionIdentityBindings(current, reenrolled), []);
	assert.equal(sessionIdentityDiscriminator(current), sessionIdentityDiscriminator(reenrolled));

	const replacement = { ...reenrolled, subjectRef: "subject:other" };
	assert.deepEqual(changedSessionIdentityBindings(current, replacement), ["subject_ref"]);
	assert.notEqual(sessionIdentityDiscriminator(current), sessionIdentityDiscriminator(replacement));
});

test("receipt spool enforces entry-count and retention bounds on append", async () => {
	await withHome(async (home) => {
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		// One expired entry plus enough fresh entries to overflow the cap.
		await store.append(entry({ recordedAt: BASE_TIME - RECEIPT_SPOOL_RETENTION_MS - 1, requestRef: "narnia:call:expired" }));
		for (let index = 0; index <= RECEIPT_SPOOL_MAX_ENTRIES; index += 1) {
			await store.append(entry({ recordedAt: BASE_TIME + index, requestRef: `narnia:call:${index}` }));
		}
		const state = await requireState(store.load);
		assert.equal(state.entries.length, RECEIPT_SPOOL_MAX_ENTRIES);
		assert.ok(state.entries[0]);
		assert.equal(state.entries[0].requestRef, "narnia:call:1");
		const lastEntry = state.entries.at(-1);
		assert.ok(lastEntry);
		assert.equal(lastEntry.requestRef, `narnia:call:${RECEIPT_SPOOL_MAX_ENTRIES}`);
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
		const dormant = await requireState(createCealReceiptSpoolStore(home, () => BASE_TIME + RECEIPT_SPOOL_RETENTION_MS + 1).load);
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
		const state = await requireState(createCealReceiptSpoolStore(home, () => BASE_TIME).load);
		assert.deepEqual(state.entries, [entry()]);
	});
});

test("separate ceal processes each keep their receipt when they append at once", { timeout: 30_000 }, async () => {
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
		const refs = Array.from({ length: 3 }, (_, index) => `narnia:call:concurrent:${index}`);
		// Every child declares readiness before one shared file releases them, so
		// host load cannot turn the concurrency proof into a startup-speed test.
		const results = await runAtProcessGate(home, "append", refs, (ref, readyFile, goFile) =>
			appendInChildProcess(home, ref, readyFile, goFile),
		);
		for (const result of results) {
			assert.equal(result.timedOut, false, "append exclusion child exceeded the test watchdog");
			assert.equal(result.code, 0, result.stderr);
		}
		// The count is exact because the priors plus concurrent entries stay under
		// the entry cap: a lock that kept the new entries by clobbering priors would pass
		// a membership-only assertion.
		const spooled = new Set((await requireState(store.load)).entries.map((item) => item.requestRef));
		assert.deepEqual(
			[...priors, ...refs].filter((ref) => !spooled.has(ref)),
			[],
		);
		assert.equal(spooled.size, priors.length + refs.length);
	});
});

function appendInChildProcess(home: string, requestRef: string, readyFile: string, goFile: string): Promise<ProcessGateResult> {
	const source = `
		const { existsSync, writeFileSync } = await import("node:fs");
		const { createCealReceiptSpoolStore } = await import(${JSON.stringify(new URL("../dist/receipt-spool.js", import.meta.url).href)});
		const store = createCealReceiptSpoolStore(process.env.HOME, Date.now, ${lockTimingSource()});
		writeFileSync(process.env.SPOOL_READY_FILE, "");
		while (!existsSync(process.env.SPOOL_GO_FILE)) await new Promise((resolve) => setTimeout(resolve, 1));
		await store.append(${JSON.stringify("a".repeat(64))}, {
			recordedAt: Date.now(),
			requestRef: process.env.SPOOL_REQUEST_REF,
			status: "completed",
			evidence: "readback_verified",
			auditRefs: [],
		});
	`;
	return spawnProcessGateChild(home, source, {
		SPOOL_REQUEST_REF: requestRef,
		SPOOL_READY_FILE: readyFile,
		SPOOL_GO_FILE: goFile,
	});
}

function recordDropInChildProcess(home: string, readyFile: string, goFile: string): Promise<ProcessGateResult> {
	const source = `
		const { existsSync, writeFileSync } = await import("node:fs");
		const { createCealReceiptSpoolStore } = await import(${JSON.stringify(new URL("../dist/receipt-spool.js", import.meta.url).href)});
		const store = createCealReceiptSpoolStore(process.env.HOME, Date.now, ${lockTimingSource()});
		writeFileSync(process.env.SPOOL_READY_FILE, "");
		while (!existsSync(process.env.SPOOL_GO_FILE)) await new Promise((resolve) => setTimeout(resolve, 1));
		await store.recordDrop(${JSON.stringify(TEST_IDENTITY)});
	`;
	return spawnProcessGateChild(home, source, { SPOOL_READY_FILE: readyFile, SPOOL_GO_FILE: goFile });
}

function lockTimingSource() {
	return JSON.stringify({
		spoolMaxWaitMs: Number.MAX_SAFE_INTEGER,
		dropsMaxWaitMs: Number.MAX_SAFE_INTEGER,
		dropsPollMs: 1,
	});
}

function spawnProcessGateChild(home: string, source: string, overrides: Record<string, string> = {}): Promise<ProcessGateResult> {
	const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
		env: processGateEnv(home, overrides),
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	const watchdog = setTimeout(() => {
		timedOut = true;
		child.kill("SIGKILL");
	}, 20_000);
	child.stdout.on("data", (chunk) => {
		stdout += String(chunk);
	});
	child.stderr.on("data", (chunk) => {
		stderr += String(chunk);
	});
	return new Promise((resolve, reject) => {
		child.once("error", (error) => {
			clearTimeout(watchdog);
			reject(error);
		});
		child.once("close", (code) => {
			clearTimeout(watchdog);
			resolve({ code, stdout, stderr, timedOut });
		});
	});
}

// These subprocesses prove cross-process exclusion, not script coverage. c8's
// inherited collector instruments every contender and can consume the tiny
// production lock budget itself, turning the proof into a coverage-I/O race.
function processGateEnv(home: string, overrides: Record<string, string>): NodeJS.ProcessEnv {
	return { ...process.env, NODE_V8_COVERAGE: "", HOME: home, ...overrides };
}

async function recordConcurrentDrops(home: string, writers: number): Promise<ProcessGateResult[]> {
	return runAtProcessGate(home, "drop", Array.from({ length: writers }), (_value, readyFile, goFile) =>
		recordDropInChildProcess(home, readyFile, goFile),
	);
}

async function runAtProcessGate<T>(
	home: string,
	label: string,
	values: T[],
	launch: (value: T, readyFile: string, goFile: string) => Promise<ProcessGateResult>,
): Promise<ProcessGateResult[]> {
	const gate = path.join(home, `${label}-gate-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	mkdirSync(gate);
	const goFile = path.join(gate, "go");
	const readyFiles = values.map((_value, index) => path.join(gate, `ready-${index}`));
	const pending = values.map((value, index) => launch(value, requiredValue(readyFiles[index], "writer_ready_file"), goFile));
	const deadline = Date.now() + 10_000;
	while (!readyFiles.every(existsSync)) {
		assert.ok(Date.now() < deadline, `${label} writers did not reach the shared gate`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	writeFileSync(goFile, "");
	return Promise.all(pending);
}

test("a lost receipt is counted so the observer can say the history is incomplete", async () => {
	await withHome(async (home) => {
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		// Nothing lost yet: the counter must not exist merely because the spool does.
		await store.append(entry());
		assert.deepEqual((await requireState(store.load)).drops, { count: 0, atLeast: false });
		await store.recordDrop();
		await store.recordDrop();
		assert.deepEqual((await requireState(store.load)).drops, { count: 2, atLeast: false });
		assert.equal(statSync(dropsFile(home)).mode & 0o777, 0o600);
		// Drops survive an append, because the append that succeeded says nothing
		// about the ones that did not.
		await store.append(entry({ requestRef: "narnia:call:2:call" }));
		assert.equal((await requireState(store.load)).drops.count, 2);
		// Clearing the spool clears its drop record too: an empty history cannot
		// carry a warning about entries it no longer claims to have had.
		await store.remove();
		assert.equal(existsSync(dropsFile(home)), false);
	});
});

test("concurrent first drops are retained and the counter never races past its cap", { timeout: 30_000 }, async () => {
	await withHome(async (home) => {
		const writers = 6;
		const results = await recordConcurrentDrops(home, writers);
		for (const result of results) {
			assert.equal(result.timedOut, false, "drop exclusion child exceeded the test watchdog");
			assert.equal(result.code, 0, result.stderr);
		}
		assert.equal(
			(await requireState(createCealReceiptSpoolStore(home).load)).drops.count,
			writers,
			`drop bytes: ${readFileSync(dropsFile(home), "utf8").length}; errors: ${results.map((result) => result.stderr).join(" | ")}`,
		);
	});
	await withHome(async (home) => {
		mkdirSync(path.join(home, ".ceal"), { mode: 0o700, recursive: true });
		writeFileSync(dropsFile(home), `ceal.receipt_spool_drops.v2 ${TEST_IDENTITY}\n${".".repeat(4090)}`, { mode: 0o600 });
		const store = createCealReceiptSpoolStore(home);
		for (let count = 4090; count < 4096; count += 1) await store.recordDrop();
		assert.deepEqual((await requireState(store.load)).drops, { count: 4096, atLeast: true });
		assert.equal(requiredValue(readFileSync(dropsFile(home), "utf8").split("\n")[1], "drop_body").length, 4096);
	});
});

// The append takes the spool lock for its read-modify-write; the removal did not,
// so a clear racing an in-flight append lost to it and the append's rename
// recreated the file with every pre-removal entry. The spool carries no identity
// discriminator, so a resurrected spool renders two subjects' history as one —
// the failure logout's cleanup exists to prevent, reached from the other side.
test("clearing the spool contends for the same lock the append holds", async () => {
	await withHome(async (home) => {
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		await store.append(entry({ requestRef: "narnia:call:1:call" }));
		const lockPath = path.join(home, ".ceal", "receipt-spool.lock");
		// This process is unquestionably alive, so the dead-owner reclamation path
		// cannot fire — the same construction `local-store-lock.test.ts` uses.
		mkdirSync(lockPath, { mode: 0o700, recursive: true });
		writeFileSync(path.join(lockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, nonce: "a".repeat(32) })}\n`, { mode: 0o600 });

		const pending = store.remove();
		await new Promise((resolve) => setTimeout(resolve, 150));
		// The wait is the assertion. Walking past a held lock is what let a clear
		// race an in-flight append, whose rename then recreated the spool with
		// every pre-removal entry — two subjects' history under one identity, the
		// failure this cleanup exists to prevent.
		assert.equal(existsSync(spoolFile(home)), true, "the removal must wait for the holder rather than walk past it");
		rmSync(lockPath, { recursive: true, force: true });
		await pending;
		assert.equal(existsSync(spoolFile(home)), false, "and complete once the holder is gone");
	});
});

test("production append and drop lock budgets settle with their documented outcomes", { timeout: 30_000 }, async () => {
	await withHome(async (home) => {
		mkdirSync(path.join(home, ".ceal"), { mode: 0o700, recursive: true });
		writeLiveLock(home, "receipt-spool.lock", "b");
		const appendResult = await spawnProcessGateChild(
			home,
			`
				const { createCealReceiptSpoolStore } = await import(${JSON.stringify(new URL("../dist/receipt-spool.js", import.meta.url).href)});
				const store = createCealReceiptSpoolStore(process.env.HOME);
				try {
					await store.append(${JSON.stringify(TEST_IDENTITY)}, ${JSON.stringify(entry())});
					throw new Error("append unexpectedly crossed a live production lock");
				} catch (error) {
					if (error?.code !== "spool_busy") throw error;
				}
			`,
		);
		assert.equal(appendResult.timedOut, false, "default append lock wait exceeded the test watchdog");
		assert.equal(appendResult.code, 0, appendResult.stderr);

		rmSync(path.join(home, ".ceal", "receipt-spool.lock"), { recursive: true, force: true });
		writeLiveLock(home, "receipt-spool-drops.lock", "c");
		const dropResult = await spawnProcessGateChild(
			home,
			`
				const { createCealReceiptSpoolStore } = await import(${JSON.stringify(new URL("../dist/receipt-spool.js", import.meta.url).href)});
				const store = createCealReceiptSpoolStore(process.env.HOME);
				await store.recordDrop(${JSON.stringify(TEST_IDENTITY)});
			`,
		);
		assert.equal(dropResult.timedOut, false, "default drop lock wait exceeded the test watchdog");
		assert.equal(dropResult.code, 0, dropResult.stderr);
		assert.equal(existsSync(dropsFile(home)), false, "a busy best-effort drop counter must not walk past its live lock");
	});
});

function writeLiveLock(home: string, name: string, nonceCharacter: string): void {
	const lockPath = path.join(home, ".ceal", name);
	mkdirSync(lockPath, { mode: 0o700 });
	writeFileSync(path.join(lockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, nonce: nonceCharacter.repeat(32) })}\n`, {
		mode: 0o600,
	});
}

test("the drop counter is bounded and never becomes a failure of its own", async () => {
	await withHome(async (home) => {
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		mkdirSync(path.join(home, ".ceal"), { mode: 0o700, recursive: true });
		writeFileSync(dropsFile(home), `ceal.receipt_spool_drops.v2 ${TEST_IDENTITY}\n${".".repeat(4096)}`, { mode: 0o600 });
		await store.recordDrop();
		// No spool file was ever written here, which is the case where every
		// receipt this client tried to record was lost. Reporting that as "no
		// calls yet" would be the strongest false claim this page can make, so the
		// store answers with an empty history that still carries its drop count.
		const state = await requireState(store.load);
		assert.deepEqual(state.entries, []);
		assert.deepEqual(state.drops, { count: 4096, atLeast: true }, "past the cap the count is reported as a floor, not grown further");
	});
	await withHome(async (home) => {
		// recordDrop describes a failure, so it may not raise one. A drops path
		// that is a directory is unwritable in the way a symlinked store would be.
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		await store.append(entry());
		mkdirSync(dropsFile(home), { mode: 0o700, recursive: true });
		await store.recordDrop();
		// The spool still reads, and the uncountable drop reads as no count rather
		// than as a thrown store error that would take `ceal observe` down.
		const state = await requireState(store.load);
		assert.deepEqual(state.entries, [entry()]);
		assert.deepEqual(state.drops, { count: 0, atLeast: false });
	});
});

test("the drop counter refuses a symlinked path and survives a drifted mode", async () => {
	await withHome(async (home) => {
		// existsSync follows symlinks and reports false for a dangling one, so the
		// check-then-append shape would have created and written the link's target
		// — the one write in this store that could land outside it. Every other
		// write here goes to a random temp name with `wx` and renames.
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		mkdirSync(path.join(home, ".ceal"), { mode: 0o700, recursive: true });
		const outside = path.join(home, "outside-the-store");
		symlinkSync(outside, dropsFile(home));
		await store.recordDrop();
		assert.equal(existsSync(outside), false, "the drop counter must not create the target of a planted symlink");
	});
	await withHome(async (home) => {
		// A drifted mode is repaired, not refused: refusing here would stop the
		// counter permanently and silently, which is the exact failure it exists
		// to make visible. This is the spool's stated write-path contract.
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		await store.append(entry());
		await store.recordDrop();
		chmodSync(dropsFile(home), 0o644);
		await store.recordDrop();
		assert.equal((await requireState(store.load)).drops.count, 2, "a mode-drifted counter must keep counting rather than go silent");
		assert.equal(statSync(dropsFile(home)).mode & 0o777, 0o600, "and must be repaired to owner-only");
	});
	await withHome(async (home) => {
		// The counter is read through a shape check, not the read-strictness guard
		// the spool file uses. That guard also asserts the *directory* is 0o700, so
		// a widened `~/.ceal` would zero the count on read — restoring the "no calls
		// yet" claim on a client whose every receipt had in fact been lost.
		// No spool file: this is the client whose very first receipt was lost, which
		// is where zeroing the count restores the strongest false claim the page
		// can make.
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		await store.recordDrop();
		chmodSync(path.join(home, ".ceal"), 0o755);
		const state = await requireState(store.load);
		assert.equal(state.drops.count, 1, "a widened store directory must not silently zero the drop count");
		assert.equal(state.spoolPresent, false);
	});
});

test("a real spool emptied by retention is not reported as a spool that never existed", async () => {
	await withHome(async (home) => {
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		await store.append(entry());
		await store.recordDrop();
		// Same file, read far enough in the future that every entry has aged out.
		const dormant = createCealReceiptSpoolStore(home, () => BASE_TIME + RECEIPT_SPOOL_RETENTION_MS + 1);
		const state = await requireState(dormant.load);
		assert.deepEqual(state.entries, []);
		assert.equal(state.drops.count, 1);
		assert.equal(state.spoolPresent, true, "the spool file exists; only its window is empty");
	});
	await withHome(async (home) => {
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		await store.recordDrop();
		const state = await requireState(store.load);
		assert.deepEqual(state.entries, []);
		assert.equal(state.spoolPresent, false, "no spool file was ever written, which is the far stronger claim");
	});
});

test("receipt spool load reports a present-but-unusable file while append still soft-misses", async () => {
	// load throws so the observer can render `unreadable` instead of an empty
	// history; append treats the same anomaly as a miss and keeps recording.
	const anomalies: Array<[string, number]> = [
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
		assert.deepEqual((await requireState(store.load)).entries, [entry()]);
	});
});

test("a safe legacy spool is never attributed to the current session", async () => {
	await withHome(async (home) => {
		const legacy = entry({ requestRef: "narnia:legacy:receipt" });
		writeFileSync(
			spoolFile(home),
			JSON.stringify({
				schema_version: "ceal.receipt_spool.v1",
				entries: [
					{
						recorded_at: new Date(legacy.recordedAt).toISOString(),
						request_ref: legacy.requestRef,
						status: legacy.status,
						evidence: legacy.evidence,
						audit_refs: legacy.auditRefs,
					},
				],
			}),
			{ mode: 0o600 },
		);
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		assert.equal(await store.load(), null);

		const current = entry({ requestRef: "narnia:current:receipt" });
		await store.append(current);
		assert.deepEqual((await requireState(store.load)).entries, [current]);
		const persisted: unknown = JSON.parse(readFileSync(spoolFile(home), "utf8"));
		assert.ok(typeof persisted === "object" && persisted !== null);
		assert.ok("schema_version" in persisted);
		assert.ok("identity" in persisted);
		assert.ok("entries" in persisted && Array.isArray(persisted.entries));
		assert.equal(persisted.schema_version, "ceal.receipt_spool.v2");
		assert.equal(persisted.identity, TEST_IDENTITY);
		assert.deepEqual(
			persisted.entries.map((value) => {
				assert.ok(typeof value === "object" && value !== null);
				assert.ok("request_ref" in value && typeof value.request_ref === "string");
				return value.request_ref;
			}),
			[current.requestRef],
		);
	});
});

// The soft-miss above is deliberate for content this store cannot read. A mode
// bit is not that: the content is valid and the append rewrites the file at 0o600
// anyway. Treating it as a miss replaced the whole history with a one-entry spool
// and recorded no drop, because the append succeeded — the silent under-report
// this module's lock and drop counter exist to prevent, arriving through the one
// path neither of them watches.
test("a repairable mode on the spool does not cost the history it holds", async () => {
	await withHome(async (home) => {
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		const earlier = ["req-a", "req-b", "req-c"].map((requestRef) => entry({ requestRef }));
		for (const item of earlier) await store.append(item);
		chmodSync(spoolFile(home), 0o644);

		const appended = entry({ requestRef: "req-d" });
		await store.append(appended);
		assert.deepEqual(
			(await requireState(store.load)).entries.map((item) => item.requestRef),
			[...earlier.map((item) => item.requestRef), appended.requestRef],
			"the earlier receipts were discarded over a mode bit",
		);
		// And the write repaired the anomaly rather than propagating it, so `load`
		// stops reporting the file as unusable.
		assert.equal(statSync(spoolFile(home)).mode & 0o777, 0o600);
		assert.equal((await requireState(store.load)).drops.count, 0, "no drop was recorded, so a silent loss here would be invisible");
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
		const state = await requireState(store.load);
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

test("receipt spool cleanup never follows a substituted store parent", async () => {
	await withHome(async (home) => {
		const outside = path.join(home, "outside");
		mkdirSync(outside, { mode: 0o700 });
		const externalSpool = path.join(outside, "receipt-spool.json");
		const externalDrops = path.join(outside, "receipt-spool-drops");
		writeFileSync(externalSpool, "external\n", { mode: 0o600 });
		writeFileSync(externalDrops, "external\n", { mode: 0o600 });
		symlinkSync(outside, path.join(home, ".ceal"));
		await assert.rejects(createCealReceiptSpoolStore(home, () => BASE_TIME).remove(), CealReceiptSpoolStoreError);
		assert.equal(existsSync(externalSpool), true);
		assert.equal(existsSync(externalDrops), true);
	});
});

test("receipt spool cleanup refuses a store parent whose permissions widened", async () => {
	await withHome(async (home) => {
		const store = createCealReceiptSpoolStore(home, () => BASE_TIME);
		await store.append(entry());
		chmodSync(path.join(home, ".ceal"), 0o755);
		await assert.rejects(store.remove(), CealReceiptSpoolStoreError);
		assert.equal(existsSync(spoolFile(home)), true);
	});
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

function storedIdentitySession(): CealStoredSession {
	return {
		gatewayEndpoint: "https://gateway.example.test/corca-ai/dev/api/ceal/v1",
		profileRef: "profile:test",
		membershipRef: "membership:test",
		registrationRef: "registration:test",
		clientRef: "client:test",
		subjectRef: "subject:test",
		instanceRef: "instance:test",
		accessToken: "secret",
		expiresAt: "2099-01-01T00:00:00.000Z",
		refreshToken: "refresh",
		refreshTokenIdleExpiresAt: "2099-01-02T00:00:00.000Z",
		refreshTokenAbsoluteExpiresAt: "2099-01-03T00:00:00.000Z",
	};
}

function dropsFile(home: string): string {
	return path.join(home, ".ceal", "receipt-spool-drops");
}

function spoolFile(home: string): string {
	mkdirSync(path.join(home, ".ceal"), { mode: 0o700, recursive: true });
	return path.join(home, ".ceal", "receipt-spool.json");
}

async function withHome(callback: (home: string) => Promise<void>): Promise<void> {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-receipt-spool-"));
	try {
		await callback(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}
