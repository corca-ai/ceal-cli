import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG_UPDATE = `refs/tags/ceal-v0.77.0 ${"a".repeat(40)} refs/tags/ceal-v0.77.0 ${"0".repeat(40)}\n`;

test("a concurrent pre-push is refused before it starts another gate", async (context: TestContext) => {
	const fixture = createFixture(context);
	const first = spawn("sh", [".githooks/pre-push"], {
		cwd: fixture.root,
		env: fixture.environment,
		stdio: ["pipe", "pipe", "pipe"],
	});
	context.after(() => {
		if (first.exitCode === null) first.kill("SIGKILL");
	});
	first.stdin.end(TAG_UPDATE);
	await waitForFile(fixture.started);

	const second = spawnSync("sh", [".githooks/pre-push"], {
		cwd: fixture.linked,
		env: fixture.environment,
		input: TAG_UPDATE,
		encoding: "utf8",
	});
	assert.equal(second.status, 2);
	assert.match(second.stderr, /another pre-push gate is already running/u);
	assert.match(second.stderr, /Wait for the original git push to finish; do not start a second push/u);
	assert.equal(readFileSync(fixture.invocations, "utf8").trim().split("\n").length, 1, "the refused hook spawned npm");

	writeFileSync(fixture.release, "release\n");
	const firstResult = await collect(first);
	assert.equal(firstResult.code, 0, firstResult.stderr);
	assert.equal(existsSync(path.join(fixture.gitCommonDirectory, "ceal-pre-push.lock")), false);

	const third = spawnSync("sh", [".githooks/pre-push"], {
		cwd: fixture.linked,
		env: fixture.environment,
		input: TAG_UPDATE,
		encoding: "utf8",
	});
	assert.equal(third.status, 0, third.stderr);
});

const signalExitCases: ReadonlyArray<readonly [NodeJS.Signals, number]> = [
	["SIGHUP", 129],
	["SIGINT", 130],
	["SIGTERM", 143],
];

for (const [signal, expectedExit] of signalExitCases) {
	test(`${signal} preserves its shell exit status and releases the lock`, async (context: TestContext) => {
		const fixture = createFixture(context);
		const child = spawn("sh", [".githooks/pre-push"], {
			cwd: fixture.root,
			env: fixture.environment,
			stdio: ["pipe", "pipe", "pipe"],
		});
		context.after(() => {
			if (child.exitCode === null) child.kill("SIGKILL");
		});
		child.stdin.end(TAG_UPDATE);
		await waitForFile(fixture.started);
		child.kill(signal);
		writeFileSync(fixture.release, "release\n");
		const result = await collect(child);
		assert.equal(result.code, expectedExit, result.stderr);
		assert.equal(existsSync(path.join(fixture.gitCommonDirectory, "ceal-pre-push.lock")), false);
	});
}

function createFixture(context: TestContext) {
	const scratch = mkdtempSync(path.join(tmpdir(), "ceal-pre-push-lock-"));
	const root = path.join(scratch, "main");
	const linked = path.join(scratch, "linked");
	mkdirSync(root);
	context.after(() => rmSync(scratch, { recursive: true, force: true }));
	mkdirSync(path.join(root, ".githooks"));
	mkdirSync(path.join(root, "bin"));
	copyFileSync(path.join(ROOT, ".githooks", "pre-push"), path.join(root, ".githooks", "pre-push"));
	chmodSync(path.join(root, ".githooks", "pre-push"), 0o755);
	const started = path.join(root, "started");
	const release = path.join(root, "release");
	const invocations = path.join(root, "invocations");
	writeFileSync(
		path.join(root, "bin", "npm"),
		"#!/bin/sh\nprintf '%s\\n' \"$*\" >>\"$CEAL_FAKE_NPM_INVOCATIONS\"\nif [ ! -e \"$CEAL_FAKE_NPM_STARTED\" ]; then\n  printf 'started\\n' >\"$CEAL_FAKE_NPM_STARTED\"\n  while [ ! -e \"$CEAL_FAKE_NPM_RELEASE\" ]; do sleep 0.05; done\nfi\n",
	);
	chmodSync(path.join(root, "bin", "npm"), 0o755);
	// The tag branch now asks `gate-attestation.ts verify` whether the full gate
	// can be skipped, and a stub that answered 0 to everything would take that
	// skip — leaving this suite proving the lock around `npm run lint:shell`
	// instead of around the long gate the lock exists for.
	writeFileSync(path.join(root, "bin", "node"), '#!/bin/sh\ncase "$*" in *gate-attestation*) exit 1 ;; esac\nexit 0\n');
	chmodSync(path.join(root, "bin", "node"), 0o755);
	assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
	assert.equal(spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root }).status, 0);
	assert.equal(spawnSync("git", ["config", "user.name", "Test"], { cwd: root }).status, 0);
	assert.equal(spawnSync("git", ["add", ".githooks/pre-push"], { cwd: root }).status, 0);
	assert.equal(spawnSync("git", ["commit", "-qm", "fixture"], { cwd: root }).status, 0);
	assert.equal(spawnSync("git", ["worktree", "add", "-q", "--detach", linked, "HEAD"], { cwd: root }).status, 0);
	return {
		root,
		linked,
		gitCommonDirectory: path.join(root, ".git"),
		started,
		release,
		invocations,
		environment: {
			...process.env,
			PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
			CEAL_FAKE_NPM_STARTED: started,
			CEAL_FAKE_NPM_RELEASE: release,
			CEAL_FAKE_NPM_INVOCATIONS: invocations,
			CEAL_TIMING_LOG: path.join(root, "timing.jsonl"),
		},
	};
}

async function waitForFile(file: string) {
	const deadline = Date.now() + 5_000;
	while (!existsSync(file)) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${file}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

function collect(child: ChildProcessWithoutNullStreams): Promise<{ code: number | null; stderr: string }> {
	let stderr = "";
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	return new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => resolve({ code, stderr }));
	});
}
