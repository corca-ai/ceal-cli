import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { ensureBuilt, REPO_ROOT, withDistLock } from "../repo-build.mjs";

const LOCK = path.join(REPO_ROOT, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
const HELPER = path.join(REPO_ROOT, "test", "repo-build.mjs");

// `test:release` runs `test/*.test.mjs` in parallel, and the release fixtures both
// write and read the checked-out `packages/<name>/dist`. That tree is the state
// those processes share, so the tier's correctness rests on this mutex. These are
// the proofs that it holds, because the tier passing is not one: a race that loses
// is silent.
//
// Nothing here runs a real `npm run build`. This file executes inside
// `test:contract`, whose sibling tests spawn `packages/*/dist/bin.js`, so a test
// that rebuilt `dist` here would make the pre-push gate itself flaky.

test("the dist lock serializes concurrent holders across processes", async () => {
	const scratch = mkdtempSync(path.join(tmpdir(), "ceal-dist-lock-probe-"));
	const journal = path.join(scratch, "journal");
	writeFileSync(journal, "");
	const holder = `
		import { appendFileSync } from "node:fs";
		import { withDistLock } from ${JSON.stringify(HELPER)};
		withDistLock(() => {
			appendFileSync(${JSON.stringify(journal)}, "enter\\n");
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
			appendFileSync(${JSON.stringify(journal)}, "exit\\n");
		});
	`;
	// They must be in flight at the same time. Spawning them synchronously one at a
	// time would serialize the holders by construction and make this assertion
	// vacuous — which it was, until removing the mutex failed to turn it red.
	for (const child of await Promise.all(Array.from({ length: 6 }, () => runHolder(holder)))) {
		assert.equal(child.code, 0, child.stderr);
	}
	const events = readFileSync(journal, "utf8").trim().split("\n");
	assert.equal(events.length, 12, `expected 6 enter/exit pairs, got ${events.join(",")}`);
	for (let index = 0; index < events.length; index += 2) {
		assert.equal(events[index], "enter");
		assert.equal(events[index + 1], "exit");
	}
	rmSync(scratch, { recursive: true, force: true });
});

test("a live holder is not reclaimed, however long it holds", async () => {
	// The reclaim rule is process liveness, not elapsed time. A wall clock cannot
	// tell a slow compile on a loaded runner from a dead holder, and breaking a live
	// holder recreates the double-writer state the lock exists to prevent. This
	// asserts the direction that keeps the mutex sound; the test below asserts the
	// direction that keeps it from deadlocking.
	const slow = runHolder(`
		import { withDistLock } from ${JSON.stringify(HELPER)};
		withDistLock(() => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500));
		console.log("slow-done");
	`);
	// Let the slow holder take the lock before the waiter starts contending.
	await new Promise((resolve) => setTimeout(resolve, 300));
	const waiter = await runHolder(`
		import { withDistLock } from ${JSON.stringify(HELPER)};
		withDistLock(() => console.log("waiter-entered"));
	`);
	assert.equal(waiter.code, 0, waiter.stderr);
	assert.equal((await slow).code, 0);
	// If the waiter had reclaimed the live holder's lock it would still print this,
	// so the real assertion is that it did not warn about reclaiming one.
	assert.doesNotMatch(waiter.stderr, /reclaiming/u, "a live holder was reclaimed");
});

test("a lock abandoned by a dead process is reclaimed rather than waited out forever", () => {
	rmSync(LOCK, { recursive: true, force: true });
	mkdirSync(LOCK, { recursive: true });
	// A pid that cannot be running: the kernel would have to have wrapped past it,
	// and `pid_max` is far below this on every supported host.
	writeFileSync(path.join(LOCK, "owner"), "2147483646 deadbeef\n");
	assert.equal(
		withDistLock(() => "reclaimed"),
		"reclaimed",
	);
	assert.equal(existsSync(LOCK), false);
});

test("an owner-less lock is reclaimed after the owner-write grace, not waited out", () => {
	// A holder that died between its `mkdir` and its owner write names no pid, so
	// the liveness check can never declare it dead. Before the grace existed this
	// case hung for the full wait timeout — found by a falsification run that left
	// exactly this lock behind, not by review.
	rmSync(LOCK, { recursive: true, force: true });
	mkdirSync(LOCK, { recursive: true });
	const stale = new Date(Date.now() - 60_000);
	utimesSync(LOCK, stale, stale);
	const started = Date.now();
	assert.equal(
		withDistLock(() => "reclaimed"),
		"reclaimed",
	);
	assert.ok(Date.now() - started < 5_000, "the owner-less lock was waited out instead of reclaimed");
	rmSync(LOCK, { recursive: true, force: true });
});

test("a process cannot delete a lock it does not own", () => {
	rmSync(LOCK, { recursive: true, force: true });
	let observed = null;
	withDistLock(() => {
		// Simulate the successor case: our lock is reclaimed and a second process
		// takes it while we are still inside. Our release must not remove theirs.
		writeFileSync(path.join(LOCK, "owner"), "1 successor-nonce\n");
	});
	observed = readFileSync(path.join(LOCK, "owner"), "utf8").trim();
	assert.equal(observed, "1 successor-nonce", "the outgoing holder deleted its successor's lock");
	rmSync(LOCK, { recursive: true, force: true });
});

test("the lock is released even when the guarded body throws", () => {
	rmSync(LOCK, { recursive: true, force: true });
	assert.throws(() => {
		withDistLock(() => {
			throw new Error("boom");
		});
	}, /boom/u);
	assert.equal(existsSync(LOCK), false);
});

test("ensureBuilt runs the build exactly once per package per process", () => {
	// Injected builder, so this proves the memo without writing the `dist` that
	// this tier's sibling tests are executing.
	const calls = [];
	const build = (packagePath) => calls.push(packagePath);
	assert.equal(ensureBuilt("packages/fixture-a", build), true);
	assert.equal(ensureBuilt("packages/fixture-a", build), false);
	// Spelling the same path differently must not buy a second build.
	assert.equal(ensureBuilt("packages/./fixture-a", build), false);
	assert.equal(ensureBuilt("packages/fixture-b", build), true);
	assert.deepEqual(calls, ["packages/fixture-a", "packages/fixture-b"]);
});

// The mutex only protects `dist` if every fixture goes through it. A new fixture
// that built or packed on its own would reintroduce the race and pass its own
// tests, so both hazards are gated here rather than left to review.
test("no test fixture builds or unsafely packs a workspace package outside repo-build.mjs", () => {
	const builders = [];
	const unsafePacks = [];
	for (const directory of [path.join(REPO_ROOT, "test"), path.join(REPO_ROOT, "test", "contract")]) {
		for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".mjs"))) {
			const relative = path.relative(REPO_ROOT, path.join(directory, name));
			if (relative === path.join("test", "repo-build.mjs")) continue;
			const source = readFileSync(path.join(directory, name), "utf8");
			// The patterns are assembled from parts so this gate does not flag itself.
			const runBuild = new RegExp(`${JSON.stringify("run")},\\s*${JSON.stringify("build")}`, "u");
			if (runBuild.test(source)) builders.push(relative);
			// `prepack` for these packages is `rm -rf dist && tsc`, so a pack without
			// `--ignore-scripts` deletes the shared tree every other process is
			// reading — strictly worse than the race the build gate above catches.
			for (const call of source.matchAll(new RegExp(`\\[\\s*${JSON.stringify("pack")}[^\\]]*\\]`, "gu"))) {
				if (!call[0].includes("--ignore-scripts")) unsafePacks.push(`${relative}: ${call[0]}`);
			}
		}
	}
	assert.deepEqual(builders, [], "route the build through withBuiltPackages so the parallel tier keeps one writer for dist");
	assert.deepEqual(unsafePacks, [], "npm pack without --ignore-scripts runs prepack, which deletes the shared dist");
});

function runHolder(source) {
	const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "pipe", "pipe"] });
	let stderr = "";
	let stdout = "";
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	return new Promise((resolve) => child.on("close", (code) => resolve({ code, stdout, stderr })));
}
