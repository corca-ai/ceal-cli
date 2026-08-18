import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs, { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { transformSync } from "esbuild";
import { resolveAnchoredDirectory } from "../dist/local-store-anchor.js";
import { withLocalStoreLock } from "../dist/local-store-lock.js";
import type { LocalStoreLockOptions } from "../src/local-store-lock.js";

// Every branch below was uncovered on both sides of the extraction that made
// this module shared: the session store had carried the same code privately
// since it was written, and no test named a stale owner, the initialization
// grace, the busy deadline, or an unsafe lock directory. The extraction was
// verified by diffing against HEAD, which is review, not a gate — so a later
// edit to any of these paths would have had nothing to fail against.

class TestUnsafe extends Error {
	override name = "TestUnsafe";
}
class TestBusy extends Error {
	override name = "TestBusy";
}

test("Darwin refuses a visible directory path after the opened directory is renamed", { skip: process.platform !== "darwin" }, () => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-darwin-anchor-"));
	const directory = path.join(root, "store");
	const moved = path.join(root, "moved-store");
	mkdirSync(directory, { mode: 0o700 });
	const handle = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
	try {
		const expected = fs.fstatSync(handle);
		fs.renameSync(directory, moved);
		assert.throws(
			() => resolveAnchoredDirectory(handle, directory, expected, 0o700, () => assert.fail("descriptor anchor was refused")),
			/descriptor anchor was refused/u,
		);
	} finally {
		fs.closeSync(handle);
		rmSync(root, { recursive: true, force: true });
	}
});

function options(directory: string, overrides: Partial<LocalStoreLockOptions> = {}): LocalStoreLockOptions {
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
		const held: boolean[] = [];
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

test("a holder released between lock inspection and directory read is an available lock", async () => {
	await withStore(async (directory) => {
		const lockPath = options(directory).lockPath;
		mkdirSync(lockPath, { mode: 0o700 });
		const originalReaddirSync = fs.readdirSync;
		let released = false;
		try {
			Reflect.set(fs, "readdirSync", (directoryPath: fs.PathLike) => {
				const directory = String(directoryPath);
				if (!released && path.basename(directory) === path.basename(lockPath)) {
					released = true;
					rmSync(directory, { recursive: true, force: true });
				}
				return originalReaddirSync(directory);
			});
			syncBuiltinESMExports();
			let entered = false;
			await withLocalStoreLock(options(directory), async () => {
				entered = true;
			});
			assert.equal(released, true);
			assert.equal(entered, true);
		} finally {
			Reflect.set(fs, "readdirSync", originalReaddirSync);
			syncBuiltinESMExports();
		}
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

test("release stays anchored when the visible parent is swapped", async () => {
	await withStore(async (root) => {
		const directory = path.join(root, "store");
		const moved = path.join(root, "moved-store");
		const victim = path.join(root, "victim");
		mkdirSync(directory, { mode: 0o700 });
		mkdirSync(victim, { mode: 0o700 });
		const victimLock = path.join(victim, "test.lock");
		writeOwnedLock(victimLock, process.pid);

		await withLocalStoreLock(options(directory), async () => {
			fs.renameSync(directory, moved);
			fs.symlinkSync(victim, directory, "dir");
		});

		assert.equal(existsSync(victimLock), true, "release must not follow the replacement parent to an outside lock");
		assert.equal(
			existsSync(path.join(moved, "test.lock")),
			process.platform === "darwin",
			"Linux releases through its descriptor path; Darwin leaves the generation stale and fails closed internally",
		);
	});
});

test("candidate initialization re-resolves the opened parent after its visible name is replaced", async () => {
	await withStore(async (root) => {
		const directory = path.join(root, "store");
		const moved = path.join(root, "moved-store");
		mkdirSync(directory, { mode: 0o700 });
		const { withLocalStoreLock: raced } = await import(parentSwapAfterCandidateMkdir(root, directory, moved));
		let entered = false;
		const run = raced(options(directory), async () => {
			entered = true;
		});
		if (process.platform === "darwin") await assert.rejects(run, TestUnsafe);
		else await run;
		assert.equal(entered, process.platform !== "darwin");
		assert.deepEqual(readdirSync(directory), [], "candidate work must not enter the replacement parent");
		assert.equal(existsSync(path.join(moved, "test.lock")), false, "release must follow the opened parent after publication");
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

test("a lock parent with special permission bits is refused as unsafe", async () => {
	await withStore(async (directory) => {
		fs.chmodSync(directory, 0o2700);
		await assert.rejects(
			withLocalStoreLock(options(directory), async () => {}),
			TestUnsafe,
		);
	});
});

test("the busy deadline is driven by a monotonic clock", async () => {
	await withStore(async (directory) => {
		const lockPath = options(directory).lockPath;
		writeOwnedLock(lockPath, process.pid);
		const originalDateNow = Date.now;
		try {
			Date.now = () => {
				throw new Error("wall clock reached by monotonic deadline");
			};
			await assert.rejects(
				withLocalStoreLock(
					options(directory, {
						maxWaitMs: 0,
					}),
					async () => {},
				),
				TestBusy,
			);
		} finally {
			Date.now = originalDateNow;
		}
		assert.equal(existsSync(lockPath), true);
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
		writeFileSync(path.join(lockPath, "owner.json"), "", { mode: 0o600 });
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
		let successorNonce: string | undefined;
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

test("successive invalid lock generations get distinct retained tombstones", async () => {
	await withStore(async (directory) => {
		const lockPath = options(directory).lockPath;
		for (const marker of ["first", "second"]) {
			mkdirSync(lockPath, { mode: 0o700 });
			writeFileSync(path.join(lockPath, "owner.json"), marker, { mode: 0o600 });
			const old = new Date(Date.now() - 60_000);
			utimesSync(lockPath, old, old);
			await withLocalStoreLock(options(directory), async () => {});
		}
		const tombstones = readdirSync(directory).filter((name) => name.startsWith("test.lock.reclaimed-invalid-"));
		assert.equal(tombstones.length, new Set(tombstones).size, "an invalid generation reused an earlier tombstone identity");
		assert.deepEqual(tombstones.map((name) => readFileSync(path.join(directory, name, "owner.json"), "utf8")).sort(), ["first", "second"]);
	});
});

test("a lock owned by a pid this user cannot signal is busy, not unsafe", async () => {
	await withStore(async (directory) => {
		const ownerPid = 4242;
		const probed: number[] = [];
		const processProbe = (pid: number): never => {
			probed.push(pid);
			throw Object.assign(new Error("permission denied"), { code: "EPERM" });
		};
		writeOwnedLock(options(directory).lockPath, ownerPid);
		await assert.rejects(
			withLocalStoreLock(options(directory, { processProbe }), async () => {}),
			TestBusy,
		);
		assert.ok(probed.length > 0);
		assert.equal(
			probed.every((pid) => pid === ownerPid),
			true,
		);
	});
});

// The candidate is complete before it becomes visible. Injecting a live winner
// at the publish syscall makes the rename lose atomically; the loser cleans only
// its nonce-named private candidate and never touches the winner.
test("a completed lock candidate that loses publication preserves the winner", async () => {
	await withStore(async (directory) => {
		const lockPath = path.join(directory, "test.lock");
		const { withLocalStoreLock: raced } = await import(successorBeforeCandidatePublish(directory));
		await assert.rejects(
			raced(options(directory, { maxWaitMs: 100 }), async () => {}),
			TestBusy,
		);
		assert.equal(JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf8")).nonce, FOREIGN_NONCE);
	});
});

// Both waiters classified the same dead generation before the first one moved
// it. Its nonce-derived non-empty tombstone makes the late rename collide there
// instead of moving the live successor now occupying the stable path.
test("a late stale-lock reclaimer cannot move the successor generation", async () => {
	await withStore(async (directory) => {
		const lockPath = path.join(directory, "test.lock");
		writeOwnedLock(lockPath, await deadPid());
		const { withLocalStoreLock: raced } = await import(successorBeforeLateQuarantine(directory));
		await assert.rejects(
			raced(options(directory, { maxWaitMs: 100 }), async () => {}),
			TestBusy,
		);
		assert.equal(JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf8")).nonce, FOREIGN_NONCE);
	});
});

test("stale quarantine re-resolves both rename paths after the visible parent is replaced", async () => {
	await withStore(async (root) => {
		const directory = path.join(root, "store");
		const moved = path.join(root, "moved-store");
		mkdirSync(directory, { mode: 0o700 });
		writeOwnedLock(options(directory).lockPath, await deadPid());
		const { withLocalStoreLock: raced } = await import(parentSwapBeforeQuarantine(root, directory, moved));
		let entered = false;
		const run = raced(options(directory), async () => {
			entered = true;
		});
		if (process.platform === "darwin") await assert.rejects(run, TestUnsafe);
		else await run;
		assert.equal(entered, process.platform !== "darwin");
		assert.deepEqual(readdirSync(directory), [], "quarantine must not enter the replacement parent");
		assert.equal(existsSync(path.join(moved, "test.lock")), process.platform === "darwin");
	});
});

const FOREIGN_NONCE = "c".repeat(32);

function successorBeforeCandidatePublish(directory: string): string {
	const source = injectableLockSource();
	const anchor = "renameSync(candidate(), options.lockPath);";
	assert.ok(source.includes(anchor), "the create path no longer matches the candidate-publish seam");
	const injected = [
		"{ const __lp = options.lockPath;",
		"  mkdirSync(__lp, { mode: 0o700 });",
		`  writeFileSync(path.join(__lp, "owner.json"), ${JSON.stringify(`${JSON.stringify({ pid: process.pid, nonce: FOREIGN_NONCE })}\n`)}, { mode: 0o600 });`,
		"}",
	].join("\n");
	const module = path.join(directory, "candidate-publish-lock.mjs");
	writeFileSync(module, emittedInjectedLock(source.replace(anchor, `${injected}\n${anchor}`)));
	return module;
}

function successorBeforeLateQuarantine(directory: string): string {
	const source = injectableLockSource();
	const anchor = "renameSync(options.lockPath, quarantine());";
	assert.ok(source.includes(anchor), "the stale path no longer matches the quarantine seam");
	const injected = [
		"{ const __lp = options.lockPath;",
		"  renameSync(__lp, quarantine());",
		"  mkdirSync(__lp, { mode: 0o700 });",
		`  writeFileSync(path.join(__lp, "owner.json"), ${JSON.stringify(`${JSON.stringify({ pid: process.pid, nonce: FOREIGN_NONCE })}\n`)}, { flag: "wx", mode: 0o600 });`,
		"}",
	].join("\n");
	const module = path.join(directory, "late-quarantine-lock.mjs");
	writeFileSync(module, emittedInjectedLock(source.replace(anchor, `${injected}\n${anchor}`)));
	return module;
}

function parentSwapAfterCandidateMkdir(moduleDirectory: string, directory: string, moved: string): string {
	const source = injectableLockSource();
	const anchor = "mkdirSync(candidate(), { mode: 0o700 });";
	assert.ok(source.includes(anchor), "the create path no longer matches the candidate-mkdir seam");
	const injected = [
		anchor,
		`renameSync(${JSON.stringify(directory)}, ${JSON.stringify(moved)});`,
		`mkdirSync(${JSON.stringify(directory)}, { mode: 0o700 });`,
	].join("\n");
	const module = path.join(moduleDirectory, "candidate-parent-swap-lock.mjs");
	writeFileSync(module, emittedInjectedLock(source.replace(anchor, injected)));
	return module;
}

function parentSwapBeforeQuarantine(moduleDirectory: string, directory: string, moved: string): string {
	const source = injectableLockSource();
	const anchor = "renameSync(options.lockPath, quarantine());";
	assert.ok(source.includes(anchor), "the stale path no longer matches the parent-swap seam");
	const injected = [
		`renameSync(${JSON.stringify(directory)}, ${JSON.stringify(moved)});`,
		`mkdirSync(${JSON.stringify(directory)}, { mode: 0o700 });`,
		anchor,
	].join("\n");
	const module = path.join(moduleDirectory, "quarantine-parent-swap-lock.mjs");
	writeFileSync(module, emittedInjectedLock(source.replace(anchor, injected)));
	return module;
}

function injectableLockSource(): string {
	const source = readFileSync(new URL("../src/local-store-lock.ts", import.meta.url), "utf8");
	const relativeImport = 'from "./local-store-anchor.js";';
	const relativeClockImport = 'from "./monotonic-clock.js";';
	const relativeModeImport = 'from "./filesystem-mode.js";';
	assert.ok(source.includes(relativeImport), "the lock no longer imports its shared anchor beside itself");
	assert.ok(source.includes(relativeClockImport), "the lock no longer imports its monotonic clock beside itself");
	assert.ok(source.includes(relativeModeImport), "the lock no longer imports its shared permission-mode owner beside itself");
	const anchorUrl = new URL("../dist/local-store-anchor.js", import.meta.url).href;
	const clockUrl = new URL("../dist/monotonic-clock.js", import.meta.url).href;
	const modeUrl = new URL("../dist/filesystem-mode.js", import.meta.url).href;
	return source
		.replace(relativeImport, `from ${JSON.stringify(anchorUrl)};`)
		.replace(relativeClockImport, `from ${JSON.stringify(clockUrl)};`)
		.replace(relativeModeImport, `from ${JSON.stringify(modeUrl)};`);
}

function emittedInjectedLock(source: string): string {
	return transformSync(source, { format: "esm", loader: "ts", target: "node22" }).code;
}

function writeOwnedLock(lockPath: string, pid: number, ownerMode = 0o600, nonce = "a".repeat(32)): void {
	mkdirSync(lockPath, { mode: 0o700, recursive: true });
	writeFileSync(path.join(lockPath, "owner.json"), `${JSON.stringify({ pid, nonce })}\n`, { mode: ownerMode });
}

// A pid that has certainly exited. Picking an arbitrary high number could name a
// live process on a busy host and turn this into a flake.
async function deadPid(): Promise<number> {
	const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
	await new Promise<void>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", () => resolve());
	});
	if (child.pid === undefined) throw new Error("child_pid_missing");
	return child.pid;
}

async function withStore(callback: (directory: string) => Promise<void>): Promise<void> {
	const directory = mkdtempSync(path.join(tmpdir(), "ceal-store-lock-"));
	try {
		await callback(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
