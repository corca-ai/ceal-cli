import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { withLocalStoreLock } from "../dist/local-store-lock.js";

// Every branch below was uncovered on both sides of the extraction that made
// this module shared: the session store had carried the same code privately
// since it was written, and no test named a stale owner, the initialization
// grace, the busy deadline, or an unsafe lock directory. The extraction was
// verified by diffing against HEAD, which is review, not a gate — so a later
// edit to any of these paths would have had nothing to fail against.

class TestUnsafe extends Error {
	name = "TestUnsafe";
}
class TestBusy extends Error {
	name = "TestBusy";
}

function options(directory, overrides = {}) {
	return {
		lockPath: path.join(directory, "test.lock"),
		maxWaitMs: 250,
		onUnsafe: () => {
			throw new TestUnsafe("unsafe");
		},
		onBusy: () => {
			throw new TestBusy("busy");
		},
		...overrides,
	};
}

test("the lock serializes, then releases so the next caller can take it", async () => {
	await withStore(async (directory) => {
		const held = [];
		await withLocalStoreLock(options(directory), async () => {
			held.push(statSync(options(directory).lockPath).isDirectory());
		});
		assert.deepEqual(held, [true]);
		assert.equal(existsSync(options(directory).lockPath), false);
		// A second acquisition proves the release was real rather than the first
		// call simply never having created the directory.
		await withLocalStoreLock(options(directory), async () => {});
	});
});

test("a rejecting action still releases the lock", async () => {
	await withStore(async (directory) => {
		await assert.rejects(
			withLocalStoreLock(options(directory), async () => {
				throw new Error("action failed");
			}),
			/action failed/u,
		);
		assert.equal(existsSync(options(directory).lockPath), false);
		await withLocalStoreLock(options(directory), async () => {});
	});
});

test("a lock held by a live process is waited for and then refused as busy", async () => {
	await withStore(async (directory) => {
		const lockPath = options(directory).lockPath;
		// This process is unquestionably alive, so the dead-owner reclamation
		// path cannot fire and the deadline is the only way out.
		writeOwnedLock(lockPath, process.pid);
		const started = Date.now();
		await assert.rejects(
			withLocalStoreLock(options(directory), async () => {}),
			TestBusy,
		);
		// The wait is real: refusing immediately would also satisfy the rejection.
		assert.ok(Date.now() - started >= 250, "the lock must exhaust its bounded wait before refusing");
		assert.equal(existsSync(lockPath), true, "a live holder's lock must survive the contender giving up");
	});
});

test("a lock orphaned by a dead process is reclaimed rather than waited out", async () => {
	await withStore(async (directory) => {
		const lockPath = options(directory).lockPath;
		writeOwnedLock(lockPath, await deadPid());
		let entered = false;
		// A short deadline is the assertion: reclamation has to happen on the
		// first poll, not by outlasting the wait.
		await withLocalStoreLock(options(directory, { maxWaitMs: 50 }), async () => {
			entered = true;
		});
		assert.equal(entered, true);
	});
});

test("an owner-less lock is live inside the initialization grace and stale after it", async () => {
	await withStore(async (directory) => {
		const lockPath = options(directory).lockPath;
		// A lock directory exists for a moment before its owner record does.
		// Treating that window as abandoned would let two racing acquirers each
		// delete the other's fresh lock and both proceed.
		mkdirSync(lockPath, { mode: 0o700 });
		// The wait must finish well inside the 1s grace, or a loaded runner turns
		// "still initializing" into "abandoned" and this flakes to a false pass on
		// the wrong branch. 100ms leaves a 10x margin instead of the 1.3x that
		// reusing the default wait would give.
		await assert.rejects(
			withLocalStoreLock(options(directory, { maxWaitMs: 100 }), async () => {}),
			TestBusy,
		);
		assert.equal(existsSync(lockPath), true);
		// Past the grace, the same owner-less directory is abandoned rather than
		// initializing, and blocking on it forever would be the worse failure.
		const aged = (Date.now() - 5_000) / 1000;
		utimesSync(lockPath, aged, aged);
		let entered = false;
		await withLocalStoreLock(options(directory, { maxWaitMs: 50 }), async () => {
			entered = true;
		});
		assert.equal(entered, true);
	});
});

test("a lock directory or owner record readable beyond its owner is refused", async () => {
	await withStore(async (directory) => {
		const lockPath = options(directory).lockPath;
		mkdirSync(lockPath, { mode: 0o755 });
		writeFileSync(path.join(lockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, nonce: "a".repeat(32) })}\n`, { mode: 0o600 });
		await assert.rejects(
			withLocalStoreLock(options(directory), async () => {}),
			TestUnsafe,
		);
	});
	await withStore(async (directory) => {
		const lockPath = options(directory).lockPath;
		writeOwnedLock(lockPath, process.pid, 0o644);
		await assert.rejects(
			withLocalStoreLock(options(directory), async () => {}),
			TestUnsafe,
		);
	});
});

test("a holder whose lock was reclaimed does not delete its successor's", async () => {
	await withStore(async (directory) => {
		const lockPath = options(directory).lockPath;
		let successorNonce;
		await withLocalStoreLock(options(directory), async () => {
			// Stand in for the sequence where this holder stalled, another process
			// reclaimed the lock as stale, and a third now holds it. Releasing by
			// path rather than by nonce would hand one state file to two writers.
			rmSync(lockPath, { recursive: true, force: true });
			successorNonce = "b".repeat(32);
			writeOwnedLock(lockPath, process.pid, 0o600, successorNonce);
		});
		assert.equal(existsSync(lockPath), true, "the successor's lock must survive the previous holder's release");
		assert.equal(JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf8")).nonce, successorNonce);
	});
});

function writeOwnedLock(lockPath, pid, ownerMode = 0o600, nonce = "a".repeat(32)) {
	mkdirSync(lockPath, { mode: 0o700, recursive: true });
	writeFileSync(path.join(lockPath, "owner.json"), `${JSON.stringify({ pid, nonce })}\n`, { mode: ownerMode });
}

// A pid that has certainly exited. Picking an arbitrary high number could name a
// live process on a busy host and turn this into a flake.
async function deadPid() {
	const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
	await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", resolve);
	});
	return child.pid;
}

async function withStore(callback) {
	const directory = mkdtempSync(path.join(tmpdir(), "ceal-store-lock-"));
	try {
		await callback(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
