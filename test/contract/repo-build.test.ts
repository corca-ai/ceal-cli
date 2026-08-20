import { ensurePackageBuilt, processIsGone, REPO_ROOT } from "../repo-build.ts";
import { scratchDir } from "../scratch-dir.ts";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";

const HELPER = path.join(REPO_ROOT, "test", "repo-build.ts");
const SUPERVISOR = path.join(REPO_ROOT, "test", "repo-build-supervisor.ts");
type HolderResult = { code: number | null; signal: string | null; stdout: string; stderr: string };
type InjectedRepoBuildOptions = { waitTimeoutMs?: number };

// `test:release` runs `test/*.test.mjs` in parallel, and the release fixtures both
// write and read the checked-out `packages/<name>/dist`. That tree is the state
// those processes share, so the tier's correctness rests on this mutex. These are
// the proofs that it holds, because the tier passing is not one: a race that loses
// is silent.
//
// Nothing here runs a real `npm run build`. This file executes inside
// `test:contract`, whose sibling tests spawn `packages/*/dist/bin.js`, so a test
// that rebuilt `dist` here would make the pre-push gate itself flaky.

test("the dist lock serializes concurrent holders across processes", async (context) => {
	const scratch = scratchDir(context, "ceal-dist-lock-probe-");
	const journal = path.join(scratch, "journal");
	writeFileSync(journal, "");
	const helper = injectedRepoBuild(scratch, undefined, undefined, { waitTimeoutMs: 5_000 });
	const holder = `
		import { appendFileSync } from "node:fs";
		import { withDistLock } from ${JSON.stringify(helper)};
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
});

test("a live holder is not reclaimed, however long it holds", async (context) => {
	// The reclaim rule is process liveness, not elapsed time. A wall clock cannot
	// tell a slow compile on a loaded runner from a dead holder, and breaking a live
	// holder recreates the double-writer state the lock exists to prevent. This
	// asserts the direction that keeps the mutex sound; the test below asserts the
	// direction that keeps it from deadlocking.
	const scratch = scratchDir(context, "ceal-dist-lock-live-");
	const helper = injectedRepoBuild(scratch, undefined, undefined, { waitTimeoutMs: 5_000 });
	const journal = path.join(scratch, "journal");
	writeFileSync(journal, "");
	const slow = spawnHolder(
		`
		import { appendFileSync } from "node:fs";
		import { withDistLock } from ${JSON.stringify(helper)};
		withDistLock(() => {
			appendFileSync(${JSON.stringify(journal)}, "slow-enter\\n");
			console.log("slow-ready");
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
			appendFileSync(${JSON.stringify(journal)}, "slow-exit\\n");
		});
		console.log("slow-done");
	`,
		"slow-ready\n",
	);
	// Start contention only after the holder says it owns the lock. A fixed sleep
	// let a loaded host start the waiter first and pass without exercising reclaim.
	await slow.ready;
	const waiter = await runHolder(`
		import { appendFileSync } from "node:fs";
		import { withDistLock } from ${JSON.stringify(helper)};
		withDistLock(() => {
			appendFileSync(${JSON.stringify(journal)}, "waiter-entered\\n");
			console.log("waiter-entered");
		});
	`);
	assert.equal(waiter.code, 0, waiter.stderr);
	assert.equal((await slow.result).code, 0);
	assert.deepEqual(readFileSync(journal, "utf8").trim().split("\n"), ["slow-enter", "slow-exit", "waiter-entered"]);
	// The journal proves mutual exclusion; this secondary check also rejects a
	// misleading recovery signal on the healthy live-holder path.
	assert.doesNotMatch(waiter.stderr, /reclaiming/u, "a live holder was reclaimed");
});

test("a lock abandoned by a dead process is reclaimed rather than waited out forever", async (context) => {
	const scratch = isolatedRepoBuild(context, "ceal-dist-lock-dead-");
	const lock = path.join(scratch.root, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
	// A pid that cannot be running: the kernel would have to have wrapped past it,
	// and `pid_max` is far below this on every supported host.
	writeDeadHolder(lock);
	const isolated = await import(`${pathToFileURL(scratch.modulePath).href}?dead=${Date.now()}`);
	assert.equal(
		isolated.withDistLock(() => "reclaimed"),
		"reclaimed",
	);
	assert.equal(existsSync(lock), false);
});

test("a stale holder reclaimed after the wait deadline still gets one acquisition attempt", async (context) => {
	const { lock, modulePath } = expiredAcquisitionRepoBuild(context, "ceal-dist-lock-expired-reclaim-");
	writeDeadHolder(lock);
	const isolated = await import(`${pathToFileURL(modulePath).href}?expired=${Date.now()}`);
	assert.equal(
		isolated.withDistLock(() => "reclaimed-after-deadline"),
		"reclaimed-after-deadline",
	);
	assert.equal(existsSync(lock), false);
});

test("a holder released after the wait deadline still gets one acquisition attempt", async (context) => {
	const { lock, modulePath } = expiredAcquisitionRepoBuild(
		context,
		"ceal-dist-lock-expired-release-",
		"rmSync(LOCK, { recursive: true, force: true });",
	);
	mkdirSync(lock, { recursive: true });
	writeFileSync(path.join(lock, "owner"), `${process.pid} ${"b".repeat(32)}\n`);
	const isolated = await import(`${pathToFileURL(modulePath).href}?released=${Date.now()}`);
	assert.equal(
		isolated.withDistLock(() => "released-after-deadline"),
		"released-after-deadline",
	);
	assert.equal(existsSync(lock), false);
});

test("live-holder wait uses a monotonic deadline instead of the adjustable wall clock", async (context) => {
	const root = scratchDir(context, "ceal-dist-lock-monotonic-");
	const modulePath = injectedRepoBuild(
		root,
		"const deadline = performance.now() + WAIT_TIMEOUT_MS;",
		"const Date = { now: () => { throw new Error('wall clock used for live-holder deadline'); } };\n\tconst deadline = performance.now() + WAIT_TIMEOUT_MS;",
	);
	const lock = path.join(root, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
	mkdirSync(lock, { recursive: true });
	writeFileSync(path.join(lock, "owner"), `${process.pid} ${"b".repeat(32)}\n`);
	const isolated = await import(`${pathToFileURL(modulePath).href}?monotonic=${Date.now()}`);
	assert.throws(() => isolated.withDistLock(() => assert.fail("live holder was bypassed")), /timed out waiting/u);
});

test("an owner-less lock is reclaimed after the owner-write grace, not waited out", async (context) => {
	// A holder that died between its `mkdir` and its owner write names no pid, so
	// the liveness check can never declare it dead. Before the grace existed this
	// case hung for the full wait timeout — found by a falsification run that left
	// exactly this lock behind, not by review.
	const scratch = isolatedRepoBuild(context, "ceal-dist-lock-ownerless-");
	const lock = path.join(scratch.root, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
	mkdirSync(lock, { recursive: true });
	const stale = new Date(Date.now() - 60_000);
	utimesSync(lock, stale, stale);
	const isolated = await import(`${pathToFileURL(scratch.modulePath).href}?ownerless=${Date.now()}`);
	const started = Date.now();
	assert.equal(
		isolated.withDistLock(() => "reclaimed"),
		"reclaimed",
	);
	assert.ok(Date.now() - started < 5_000, "the owner-less lock was waited out instead of reclaimed");
});

test("a fresh owner-less legacy lock is not replaced before its grace expires", async (context) => {
	const scratch = isolatedRepoBuild(context, "ceal-dist-lock-fresh-ownerless-");
	const lock = path.join(scratch.root, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
	mkdirSync(lock, { recursive: true });
	const generation = statSync(lock);
	const isolated = await import(`${pathToFileURL(scratch.modulePath).href}?fresh=${Date.now()}`);
	assert.throws(() => isolated.withDistLock(() => assert.fail("fresh legacy lock was replaced")), /timed out waiting/u);
	const retained = statSync(lock);
	assert.equal(retained.dev, generation.dev);
	assert.equal(retained.ino, generation.ino);
});

test("a process cannot delete a lock it does not own", async (context) => {
	const scratch = isolatedRepoBuild(context, "ceal-dist-lock-successor-");
	const lock = path.join(scratch.root, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
	const isolated = await import(`${pathToFileURL(scratch.modulePath).href}?successor=${Date.now()}`);
	isolated.withDistLock(() => {
		// Simulate the successor case: our lock is reclaimed and a second process
		// takes it while we are still inside. Our release must not remove theirs.
		writeFileSync(path.join(lock, "owner"), `1 ${"b".repeat(32)}\n`);
	});
	const observed = readFileSync(path.join(lock, "owner"), "utf8").trim();
	assert.equal(observed, `1 ${"b".repeat(32)}`, "the outgoing holder deleted its successor's lock");
});

test("release leaves a two-party successor when its marker disappears", async (context) => {
	const scratch = scratchDir(context, "ceal-dist-lock-release-marker-");
	const successorMarker = `owner-${"f".repeat(32)}`;
	const successorOwner = `${process.pid}\n`;
	const modulePath = injectedRepoBuild(
		scratch,
		"unlinkSync(markerPath);",
		[
			"rmSync(LOCK, { recursive: true, force: true });",
			"mkdirSync(LOCK, { recursive: true });",
			`writeFileSync(path.join(LOCK, ${JSON.stringify(successorMarker)}), ${JSON.stringify(successorOwner)});`,
			"unlinkSync(markerPath);",
		].join("\n"),
	);
	const isolated = await import(`${pathToFileURL(modulePath).href}?release-marker=${Date.now()}`);
	assert.equal(
		isolated.withDistLock(() => "released"),
		"released",
	);
	const lock = path.join(scratch, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
	assert.equal(readFileSync(path.join(lock, successorMarker), "utf8"), successorOwner);
	assert.deepEqual(
		readdirSync(path.dirname(lock)).filter((entry) => entry.includes("reclaimed") || entry.includes("released")),
		[],
	);
});

test("a late stale-lock reclaimer leaves a three-party successor at the lock", async (context) => {
	const scratch = scratchDir(context, "ceal-dist-lock-late-marker-");
	const successorMarker = `owner-${"d".repeat(32)}`;
	const modulePath = injectedRepoBuild(
		scratch,
		"unlinkSync(markerPath);",
		[
			"rmSync(LOCK, { recursive: true, force: true });",
			"mkdirSync(LOCK);",
			`writeFileSync(path.join(LOCK, ${JSON.stringify(`owner-${"c".repeat(32)}`)}), ${JSON.stringify(`${process.pid}\n`)});`,
			"rmSync(LOCK, { recursive: true, force: true });",
			"mkdirSync(LOCK);",
			`writeFileSync(path.join(LOCK, ${JSON.stringify(successorMarker)}), ${JSON.stringify(`${process.pid}\n`)});`,
			"unlinkSync(markerPath);",
		].join("\n"),
	);
	const lock = path.join(scratch, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
	writeDeadHolder(lock);
	const raced = await import(`${pathToFileURL(modulePath).href}?late-marker=${Date.now()}`);
	assert.throws(() => raced.withDistLock(() => undefined), /timed out waiting/u);
	assert.equal(readFileSync(path.join(lock, successorMarker), "utf8"), `${process.pid}\n`);
	assert.deepEqual(
		readdirSync(path.dirname(lock)).filter((entry) => entry.includes("reclaimed") || entry.includes("released")),
		[],
	);
});

test("a stale fixed-owner legacy lock is refused without deletion", async (context) => {
	const scratch = isolatedRepoBuild(context, "ceal-dist-lock-fixed-owner-legacy-");
	const lock = path.join(scratch.root, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
	mkdirSync(lock, { recursive: true });
	writeFileSync(path.join(lock, "owner"), `2147483646 ${"e".repeat(32)}\n`);
	const stale = new Date(Date.now() - 60_000);
	utimesSync(lock, stale, stale);
	const isolated = await import(`${pathToFileURL(scratch.modulePath).href}?fixed-owner-legacy=${Date.now()}`);
	assert.throws(() => isolated.withDistLock(() => assert.fail("legacy fixed-owner lock was reclaimed")), /timed out waiting/u);
	assert.equal(readFileSync(path.join(lock, "owner"), "utf8"), `2147483646 ${"e".repeat(32)}\n`);
});

test("a completed candidate that loses publication cannot replace the winner", async (context) => {
	const scratch = scratchDir(context, "ceal-dist-lock-publish-race-");
	const modulePath = injectedRepoBuild(
		scratch,
		"renameSync(candidate, LOCK);",
		[
			"mkdirSync(LOCK);",
			`writeFileSync(path.join(LOCK, ${JSON.stringify(`owner-${"d".repeat(32)}`)}), ${JSON.stringify(`${process.pid}\n`)});`,
			"renameSync(candidate, LOCK);",
		].join("\n"),
	);
	const lock = path.join(scratch, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
	const raced = await import(`${pathToFileURL(modulePath).href}?publish=${Date.now()}`);
	assert.throws(() => raced.withDistLock(() => undefined), /timed out waiting/u);
	assert.equal(readFileSync(path.join(lock, `owner-${"d".repeat(32)}`), "utf8"), `${process.pid}\n`);
	assert.deepEqual(
		readdirSync(path.dirname(lock)).filter((name) => name.includes(".candidate-")),
		[],
		"the losing private candidate was not cleaned up",
	);
});

test("a stale non-empty unknown generation is refused without deletion", async (context) => {
	const scratch = isolatedRepoBuild(context, "ceal-dist-lock-invalid-");
	const lock = path.join(scratch.root, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
	mkdirSync(lock, { recursive: true });
	writeFileSync(path.join(lock, "unknown"), "invalid\n");
	const stale = new Date(Date.now() - 60_000);
	utimesSync(lock, stale, stale);
	const isolated = await import(`${pathToFileURL(scratch.modulePath).href}?invalid=${Date.now()}`);
	assert.throws(() => isolated.withDistLock(() => assert.fail("unknown lock generation was reclaimed")), /timed out waiting/u);
	assert.equal(readFileSync(path.join(lock, "unknown"), "utf8"), "invalid\n");
	assert.deepEqual(
		readdirSync(path.dirname(lock)).filter((entry) => entry.includes("reclaimed") || entry.includes("released")),
		[],
	);
});

test("the lock is released even when the guarded body throws", async (context) => {
	const scratch = isolatedRepoBuild(context, "ceal-dist-lock-throws-");
	const lock = path.join(scratch.root, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
	const isolated = await import(`${pathToFileURL(scratch.modulePath).href}?throws=${Date.now()}`);
	assert.throws(() => {
		isolated.withDistLock(() => {
			throw new Error("boom");
		});
	}, /boom/u);
	assert.equal(existsSync(lock), false);
});

test("ensurePackageBuilt runs the build exactly once per package per process", () => {
	// Injected builder, so this proves the memo without writing the `dist` that
	// this tier's sibling tests are executing.
	const calls: string[] = [];
	const build = (packagePath: string): void => {
		calls.push(packagePath);
	};
	assert.equal(ensurePackageBuilt("packages/fixture-a", build), true);
	assert.equal(ensurePackageBuilt("packages/fixture-a", build), false);
	// Spelling the same path differently must not buy a second build.
	assert.equal(ensurePackageBuilt("packages/./fixture-a", build), false);
	assert.equal(ensurePackageBuilt("packages/fixture-b", build), true);
	assert.deepEqual(calls, ["packages/fixture-a", "packages/fixture-b"]);
});

test("a timed-out workspace build kills its TERM-ignoring process group before releasing the lock", async (context) => {
	const root = scratchDir(context, "ceal-dist-build-timeout-");
	const modulePath = injectedRepoBuild(root);
	const packageRoot = path.join(root, "packages", "fixture");
	const bin = path.join(root, "bin");
	const lock = path.join(root, "node_modules", ".cache", "ceal-test-workspace-dist.lock");
	const leaderPid = path.join(root, "leader.pid");
	const descendantPid = path.join(root, "descendant.pid");
	const termMarker = path.join(root, "term.marker");
	mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
	mkdirSync(bin);
	const npm = path.join(bin, "npm");
	writeFileSync(
		npm,
		`#!/bin/sh
trap '[ -d ${JSON.stringify(lock)} ] && printf held > ${JSON.stringify(termMarker)}' TERM
printf '%s\n' "$$" > ${JSON.stringify(leaderPid)}
sh -c 'trap "" TERM; printf "%s\\n" "$$" > "$1"; while :; do sleep 1; done' sh ${JSON.stringify(descendantPid)} </dev/null >/dev/null 2>&1 &
while :; do sleep 1; done
`,
	);
	chmodSync(npm, 0o755);
	const isolated = await import(`${pathToFileURL(modulePath).href}?build-timeout=${Date.now()}`);
	assert.throws(
		() =>
			isolated.withBuiltPackages(["packages/fixture"], () => assert.fail("timed-out build reached its reader"), {
				buildEnv: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` },
			}),
		/timed out/u,
	);
	assert.equal(readFileSync(termMarker, "utf8"), "held", "the dist lock was not held when timeout cleanup began");
	assert.equal(existsSync(lock), false, "the dist lock remained after the failed build settled");
	for (const pidPath of [leaderPid, descendantPid]) {
		const pid = Number(readFileSync(pidPath, "utf8").trim());
		context.after(() => killIfAlive(pid));
		assert.equal(processIsGone(pid), true, `${path.basename(pidPath)} ${pid} survived the build timeout`);
	}
});

test("the build supervisor rejects extra and malformed request fields", () => {
	const valid = {
		command: process.execPath,
		args: ["-e", ""],
		cwd: REPO_ROOT,
		env: process.env,
		timeoutMs: 1_000,
		terminationGraceMs: 100,
		postKillReportMs: 100,
		postExitDrainMs: 100,
		maxCapturedOutputBytes: 1_024,
	};
	const invalidRequests: unknown[] = [
		{ ...valid, unexpected: true },
		{ ...valid, env: [] },
		{ ...valid, timeoutMs: 0 },
		{ ...valid, maxCapturedOutputBytes: Number.MAX_SAFE_INTEGER + 1 },
	];
	for (const request of invalidRequests) {
		const result = runSupervisor(request);
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, /invalid build supervisor request/u);
	}
});

test("workspace builds reject an unknown supervisor result shape", async (context) => {
	const scratch = scratchDir(context, "ceal-dist-build-invalid-result-");
	const modulePath = injectedRepoBuild(scratch);
	mkdirSync(path.join(scratch, "packages", "fixture", "dist"), { recursive: true });
	writeFileSync(path.join(scratch, "test", "repo-build-supervisor.ts"), "process.stdout.write(JSON.stringify({ code: 0, extra: true }));");
	const isolated = await import(`${pathToFileURL(modulePath).href}?invalid-result=${Date.now()}`);
	assert.throws(() => isolated.withBuiltPackages(["packages/fixture"], () => undefined), /build supervisor returned an invalid result/u);
});

test("standalone package behavior tests do not enter the checkout-dist owner", () => {
	for (const packageName of ["ceal-client", "ceal-worker-cli"]) {
		const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", packageName, "package.json"), "utf8"));
		assert.equal(manifest.scripts.precoverage, undefined);
		assert.equal(manifest.scripts.pretest, undefined);
	}
});

// The mutex only protects `dist` if every fixture goes through it. A new fixture
// that built or packed on its own would reintroduce the race and pass its own
// tests, so both hazards are gated here rather than left to review.
test("no test fixture builds or unsafely packs a workspace package outside repo-build.ts", () => {
	const builders: string[] = [];
	const unsafePacks: string[] = [];
	for (const directory of [path.join(REPO_ROOT, "test"), path.join(REPO_ROOT, "test", "contract")]) {
		for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".ts") || entry.endsWith(".mjs"))) {
			const relative = path.relative(REPO_ROOT, path.join(directory, name));
			if (relative === path.join("test", "repo-build.ts")) continue;
			const source = readFileSync(path.join(directory, name), "utf8");
			const findings = inspectFixture(relative, source);
			builders.push(...findings.builders);
			unsafePacks.push(...findings.unsafePacks);
		}
	}
	assert.deepEqual(builders, [], "route the build through withBuiltPackages so the parallel tier keeps one writer for dist");
	assert.deepEqual(unsafePacks, [], "npm pack without --ignore-scripts runs prepack, which deletes the shared dist");
});

test("fixture safety scan catches an unsafe temporary TypeScript fixture", () => {
	const unsafeSource = `spawnSync("npm", [${JSON.stringify("run")}, ${JSON.stringify("build")}]);`;
	const findings = inspectFixture("test/contract/temporary.ts", unsafeSource);
	assert.deepEqual(findings.builders, ["test/contract/temporary.ts"]);
});

function inspectFixture(relative: string, source: string): { builders: string[]; unsafePacks: string[] } {
	const builders: string[] = [];
	const unsafePacks: string[] = [];
	// The patterns are assembled from parts so this gate does not flag itself.
	const runBuild = new RegExp(`${JSON.stringify("run")},\\s*${JSON.stringify("build")}`, "u");
	if (runBuild.test(source)) builders.push(relative);
	// `prepack` for these packages is `rm -rf dist && tsc`, so a pack without
	// `--ignore-scripts` deletes the shared tree every other process is
	// reading — strictly worse than the race the build gate above catches.
	for (const call of source.matchAll(new RegExp(`\\[\\s*${JSON.stringify("pack")}[^\\]]*\\]`, "gu"))) {
		if (!call[0].includes("--ignore-scripts")) unsafePacks.push(`${relative}: ${call[0]}`);
	}
	return { builders, unsafePacks };
}

function runSupervisor(request: unknown): { status: number | null; stderr: string } {
	const loader = pathToFileURL(path.join(REPO_ROOT, "test", "source-loader.ts")).href;
	const result = spawnSync(process.execPath, ["--import", loader, SUPERVISOR], {
		encoding: "utf8",
		input: JSON.stringify(request),
		env: process.env,
	});
	return { status: result.status, stderr: result.stderr };
}

function runHolder(source: string): Promise<HolderResult> {
	return spawnHolder(source).result;
}

function writeDeadHolder(lock: string): void {
	mkdirSync(lock, { recursive: true });
	writeFileSync(path.join(lock, `owner-${"a".repeat(32)}`), "2147483646\n");
}

function expiredAcquisitionRepoBuild(context: TestContext, prefix: string, beforeReclaim?: string) {
	const root = scratchDir(context, prefix);
	const replacement = [
		"Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);",
		beforeReclaim,
		"const reclaimed = reclaimIfHolderIsGone();",
	]
		.filter(Boolean)
		.join("\n");
	return {
		lock: path.join(root, "node_modules", ".cache", "ceal-test-workspace-dist.lock"),
		modulePath: injectedRepoBuild(root, "const reclaimed = reclaimIfHolderIsGone();", replacement),
	};
}

function spawnHolder(source: string, readyMarker?: string): { ready: Promise<void>; result: Promise<HolderResult> } {
	const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "pipe", "pipe"] });
	let stderr = "";
	let stdout = "";
	let readyResolve: ((value?: undefined) => void) | undefined;
	let readyReject: ((reason?: unknown) => void) | undefined;
	const ready =
		readyMarker === undefined
			? Promise.resolve()
			: new Promise<void>((resolve, reject) => {
					readyResolve = resolve;
					readyReject = reject;
				});
	const watchdog = setTimeout(() => child.kill("SIGKILL"), 10_000);
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
		if (readyResolve && readyMarker !== undefined && stdout.includes(readyMarker)) {
			readyResolve();
			readyResolve = undefined;
			readyReject = undefined;
		}
	});
	const result = new Promise<HolderResult>((resolve) =>
		child.on("close", (code, signal) => {
			clearTimeout(watchdog);
			if (readyReject) readyReject(new Error(`holder exited before '${readyMarker}': ${stderr}`));
			resolve({ code, signal, stdout, stderr });
		}),
	);
	return { ready, result };
}

function injectedRepoBuild(root: string, anchor?: string, replacement?: string, options: InjectedRepoBuildOptions = {}): string {
	const directory = path.join(root, "test");
	mkdirSync(directory, { recursive: true });
	let source = readFileSync(HELPER, "utf8");
	if (anchor) assert.ok(source.includes(anchor), `repo-build injection anchor missing: ${anchor}`);
	const toolchainImport = new URL("../../scripts/lib/toolchain-env.ts", import.meta.url).href;
	source = source.replace('from "../scripts/lib/toolchain-env.ts"', `from ${JSON.stringify(toolchainImport)}`);
	const objectRecordImport = new URL("../../scripts/lib/object-record.ts", import.meta.url).href;
	source = source.replace('from "../scripts/lib/object-record.ts"', `from ${JSON.stringify(objectRecordImport)}`);
	const waitTimeoutAnchor = "const WAIT_TIMEOUT_MS = 600_000;";
	assert.ok(source.includes(waitTimeoutAnchor), "repo-build wait-timeout injection anchor missing");
	source = source.replace(waitTimeoutAnchor, `const WAIT_TIMEOUT_MS = ${options.waitTimeoutMs ?? 20};`);
	// Keep production's termination grace and a startup-safe timeout here: on an
	// arbitrary machine, scheduler load can otherwise delay the fake npm until
	// after the fixture expires but before its TERM trap is installed.
	source = source.replace("const BUILD_TIMEOUT_MS = 600_000;", "const BUILD_TIMEOUT_MS = 2_000;");
	source = source.replace("const BUILD_POST_KILL_REPORT_MS = 1_000;", "const BUILD_POST_KILL_REPORT_MS = 80;");
	if (anchor && replacement !== undefined) source = source.replace(anchor, replacement);
	const modulePath = path.join(directory, "repo-build.ts");
	writeFileSync(modulePath, source);
	const supervisorImport = new URL("../../packages/ceal-worker-cli/src/json-record.ts", import.meta.url).href;
	let supervisorSource = readFileSync(SUPERVISOR, "utf8");
	supervisorSource = supervisorSource.replace(
		'import { isJsonRecord as isRecord } from "../packages/ceal-worker-cli/src/json-record.ts";',
		`import { isJsonRecord as isRecord } from ${JSON.stringify(supervisorImport)};`,
	);
	writeFileSync(path.join(directory, "repo-build-supervisor.ts"), supervisorSource);
	return modulePath;
}

function isolatedRepoBuild(context: TestContext, prefix: string): { root: string; modulePath: string } {
	const root = scratchDir(context, prefix);
	return { root, modulePath: injectedRepoBuild(root) };
}

function killIfAlive(pid: number): void {
	if (!Number.isInteger(pid) || pid <= 0 || processIsGone(pid)) return;
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		/* Already gone. */
	}
}
