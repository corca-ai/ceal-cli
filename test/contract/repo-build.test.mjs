import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { ensurePackageBuilt, REPO_ROOT, withBuildLock } from "../repo-build.mjs";

const LOCK_ROOT = path.join(REPO_ROOT, "node_modules", ".cache", "ceal-test-build-locks");

// `test:release` runs `test/*.test.mjs` in parallel, and the release fixtures need
// a current `packages/<name>/dist`. That directory is the one piece of state the
// parallel processes share, so the whole tier's correctness rests on this mutex.
// These are the proofs that it holds, because the tier passing is not one: a race
// that loses is silent.

test("the build lock serializes concurrent holders across processes", async () => {
	const name = `probe-${process.pid}`;
	const journal = path.join(LOCK_ROOT, `${name}-journal`);
	mkdirSync(LOCK_ROOT, { recursive: true });
	rmSync(journal, { force: true });
	writeFileSync(journal, "");
	const holder = `
		import { appendFileSync } from "node:fs";
		import { withBuildLock } from ${JSON.stringify(path.join(REPO_ROOT, "test", "repo-build.mjs"))};
		withBuildLock(${JSON.stringify(name)}, () => {
			appendFileSync(${JSON.stringify(journal)}, "enter\\n");
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
			appendFileSync(${JSON.stringify(journal)}, "exit\\n");
		});
	`;
	// They must be in flight at the same time. Spawning them synchronously one at a
	// time would serialize the holders by construction and make this assertion
	// vacuous — which it was, until removing the mutex failed to turn it red.
	const running = Array.from({ length: 6 }, () => {
		const child = spawn(process.execPath, ["--input-type=module", "-e", holder], { stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		return new Promise((resolve) => child.on("close", (code) => resolve({ code, stderr })));
	});
	for (const child of await Promise.all(running)) assert.equal(child.code, 0, child.stderr);

	// Every `enter` must be followed by its own `exit` before the next `enter`.
	// Interleaving is exactly the overlap the mutex exists to prevent, and it is
	// what a plain `existsSync` check instead of `mkdir` would produce here.
	const events = readFileSync(journal, "utf8").trim().split("\n");
	assert.equal(events.length, 12, `expected 6 enter/exit pairs, got ${events.join(",")}`);
	for (let index = 0; index < events.length; index += 2) {
		assert.equal(events[index], "enter");
		assert.equal(events[index + 1], "exit");
	}
	rmSync(journal, { force: true });
});

test("the lock is released even when the guarded body throws", () => {
	const name = `throwing-${process.pid}`;
	assert.throws(() => {
		withBuildLock(name, () => {
			throw new Error("boom");
		});
	}, /boom/u);
	assert.equal(existsSync(path.join(LOCK_ROOT, name)), false);
	// And the next acquisition succeeds rather than waiting out the stale timeout.
	assert.equal(
		withBuildLock(name, () => "reacquired"),
		"reacquired",
	);
});

test("a lock abandoned by a dead process is broken rather than waited out forever", () => {
	const name = `stale-${process.pid}`;
	const lock = path.join(LOCK_ROOT, name);
	mkdirSync(LOCK_ROOT, { recursive: true });
	rmSync(lock, { recursive: true, force: true });
	mkdirSync(lock);
	writeFileSync(path.join(lock, "owner"), "999999\n");
	// Backdate past STALE_LOCK_MS; the alternative is sleeping two minutes.
	const old = new Date(Date.now() - 10 * 60_000);
	utimesSync(lock, old, old);
	assert.equal(
		withBuildLock(name, () => "broke through"),
		"broke through",
	);
	assert.equal(existsSync(lock), false);
});

test("ensurePackageBuilt runs the build once per process", () => {
	// A second call must not shell out again. `npm run build` rewrites `dist`, so
	// the memo is observable as the emitted files keeping their mtimes.
	const emitted = path.join(REPO_ROOT, "packages", "ceal-protocol", "dist", "index.js");
	ensurePackageBuilt(path.join("packages", "ceal-protocol"));
	const first = readFileSync(emitted);
	const before = Date.now();
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
	ensurePackageBuilt(path.join("packages", "ceal-protocol"));
	assert.ok(Date.now() - before < 1000, "the second ensurePackageBuilt rebuilt instead of using the memo");
	assert.deepEqual(readFileSync(emitted), first);
});

// The mutex only protects `packages/<name>/dist` if every fixture goes through it.
// A new fixture that shells out to `npm run build` on its own reintroduces exactly
// the race `--test-concurrency=1` used to hide, and would pass its own tests.
test("no test fixture builds a workspace package outside repo-build.mjs", () => {
	const offenders = [];
	for (const directory of [path.join(REPO_ROOT, "test"), path.join(REPO_ROOT, "test", "contract")]) {
		for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".mjs"))) {
			if (name === "repo-build.mjs") continue;
			const source = readFileSync(path.join(directory, name), "utf8");
			// Matches the npm argv pair however the call spells its prefix flags. The
			// pattern is built from parts so this gate does not flag its own source.
			const buildArgv = new RegExp(`${JSON.stringify("run")},\\s*${JSON.stringify("build")}`, "u");
			if (buildArgv.test(source)) offenders.push(path.relative(REPO_ROOT, path.join(directory, name)));
		}
	}
	assert.deepEqual(offenders, [], "route the build through ensurePackageBuilt so the parallel tier keeps one writer for dist");
});
