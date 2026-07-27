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

// Both cases below used to be permanent `unsafe_store`: a store that refuses
// every write from then on, with nothing anywhere to clear it. Neither is a
// security condition — one is a crash, the other is ordinary pid reuse — so both
// belong on a recoverable path.

test("an owner record that exists but cannot be read is reclaimed, not refused forever", async () => {
	await withStore(async (directory) => {
		const lockPath = options(directory).lockPath;
		// What a crash between `openSync(…, "wx")` and its write leaves behind: the
		// right shape, the right mode, no content.
		mkdirSync(lockPath, { mode: 0o700, recursive: true });
		writeFileSync(path.join(lockPath, "owner.json"), "", { mode: 0o600 });
		// Past the initialization grace, so this is abandonment rather than a
		// holder that is mid-write right now.
		const old = new Date(Date.now() - 60_000);
		utimesSync(lockPath, old, old);

		let entered = false;
		await withLocalStoreLock(options(directory), async () => {
			entered = true;
		});
		assert.equal(entered, true, "a zero-byte owner record wedged the store instead of being reclaimed");
	});
	await withStore(async (directory) => {
		// Within the grace it is a holder mid-write, so it must still be waited for
		// and refused as busy rather than reclaimed out from under that holder.
		const lockPath = options(directory).lockPath;
		mkdirSync(lockPath, { mode: 0o700, recursive: true });
		writeFileSync(path.join(lockPath, "owner.json"), "", { mode: 0o600 });
		await assert.rejects(
			withLocalStoreLock(options(directory), async () => {}),
			TestBusy,
		);
	});
});

test("a lock owned by a pid this user cannot signal is busy, not unsafe", async () => {
	await withStore(async (directory) => {
		// pid 1 exists and is root-owned, so `kill(1, 0)` raises EPERM here. That is
		// proof the pid is *alive*, which is the ordinary pid-reuse case — reporting
		// it as unsafe left the session store refusing writes for as long as that
		// process lived.
		// Assert the precondition rather than assume it: running as root makes
		// `kill(1, 0)` succeed, and this test would then quietly prove the
		// already-covered live-owner path instead of the EPERM one.
		let signalled = null;
		try {
			process.kill(1, 0);
		} catch (error) {
			signalled = error.code;
		}
		assert.equal(signalled, "EPERM", "this test needs a pid it cannot signal; it is not exercising the EPERM path");
		writeOwnedLock(options(directory).lockPath, 1);
		await assert.rejects(
			withLocalStoreLock(options(directory), async () => {}),
			TestBusy,
		);
	});
});

// The create path's twin of the release-path test above. The destructive window
// opens between `createLock`'s `mkdir` and its owner write, so the successor is
// simulated at exactly that seam in a patched copy of the built module. An
// earlier version spawned a child process and raced it for real; that cost 2.5s
// of the iteration gate and had a silent false-pass ordering, and it bought
// nothing, because the code under test never observes the schedule — only the
// directory state the schedule produces.
test("a holder that loses the owner-write race does not delete its successor's lock", async () => {
	// A successor that reclaimed the owner-less directory and fully claimed it.
	await withStore(async (directory) => {
		const lockPath = path.join(directory, "test.lock");
		const { withLocalStoreLock: raced } = await import(
			successorAtSeam(directory, JSON.stringify({ pid: process.pid, nonce: FOREIGN_NONCE }))
		);
		// Refused as busy, not unsafe: losing this race is nobody's error.
		await assert.rejects(
			raced(options(directory, { maxWaitMs: 100 }), async () => {}),
			TestBusy,
		);
		assert.equal(existsSync(lockPath), true, "the losing holder deleted the lock its successor was actively holding");
		assert.equal(JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf8")).nonce, FOREIGN_NONCE);
	});

	// A successor still mid-write of its own record. This case is here because the
	// first attempt at the fix guarded the cleanup on `readLockOwner` finding a
	// *valid* record, and a zero-byte one reads as absent — so that guard called
	// this lock unclaimed and deleted it, while `staleLockOwner` calls the same
	// state a live holder. The `EEXIST` return does not consult the contents at
	// all, which is why it is the right shape; this pins that it stays that way.
	await withStore(async (directory) => {
		const lockPath = path.join(directory, "test.lock");
		const { withLocalStoreLock: raced } = await import(successorAtSeam(directory, ""));
		await assert.rejects(
			raced(options(directory, { maxWaitMs: 100 }), async () => {}),
			TestBusy,
		);
		assert.equal(existsSync(lockPath), true, "a successor mid-write of its owner record had its lock deleted");
	});
});

const FOREIGN_NONCE = "c".repeat(32);

// Patches the built module so that a contender replaces the lock directory in
// the gap between `mkdir` and the owner write. The anchors are asserted rather
// than replaced blindly: a no-op patch would leave these tests passing against
// code they never actually raced. Both ends of the seam are pinned, so moving
// the nonce generation above the `mkdir` fails here instead of silently
// relocating the injection to a place where no race exists.
function successorAtSeam(directory, ownerContent) {
	const source = readFileSync(new URL("../dist/local-store-lock.js", import.meta.url), "utf8");
	const body = source.slice(source.indexOf("function createLock"));
	const anchor = 'const nonce = randomBytes(16).toString("hex");';
	assert.ok(body.includes(anchor), "the create path no longer matches the seam anchor; re-point these tests at the mkdir/owner-write gap");
	assert.ok(
		body.indexOf("mkdirSync") < body.indexOf(anchor),
		"the anchor must sit after the mkdir, or the injected successor races nothing",
	);
	assert.ok(body.indexOf(anchor) < body.indexOf("writeFileSync"), "the anchor must sit before the owner write it is meant to lose to");

	const injected = [
		"{ const __lp = options.lockPath;",
		"  if (!globalThis.__cealSeam?.has(__lp)) {",
		"    (globalThis.__cealSeam ??= new Set()).add(__lp);",
		"    rmSync(__lp, { recursive: true, force: true });",
		"    mkdirSync(__lp, { mode: 0o700 });",
		`    writeFileSync(path.join(__lp, "owner.json"), ${JSON.stringify(ownerContent)}, { flag: "wx", mode: 0o600 });`,
		"  } }\n",
	].join("\n");
	const module = path.join(directory, "seam-lock.mjs");
	writeFileSync(module, source.replace(anchor, injected + anchor));
	return module;
}

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
