import { assertDirectory, assertFile, prepareDirectory, removeOwnedFile, safeExistingFile } from "../dist/local-store-guards.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

class Refused extends Error {}
function unsafe(): never {
	throw new Refused("unsafe_store");
}

function scratch(context: TestContext): string {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-store-guards-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

function store(
	root: string,
	{ dirMode = 0o700, fileMode = 0o600 }: { dirMode?: number; fileMode?: number } = {},
): { directory: string; file: string } {
	const directory = path.join(root, "store");
	mkdirSync(directory, { recursive: true });
	const file = path.join(directory, "entry.json");
	writeFileSync(file, "{}", { mode: fileMode });
	chmodSync(file, fileMode);
	chmodSync(directory, dirMode);
	return { directory, file };
}

test("a 0o700 directory holding a 0o600 file is the only safe read", (context) => {
	const root = scratch(context);
	const { directory, file } = store(root);
	assert.equal(safeExistingFile(directory, file), true);

	// A directory another user could read must not be trusted, even though the
	// file inside it is still 0o600.
	chmodSync(directory, 0o755);
	assert.equal(safeExistingFile(directory, file), false);
	chmodSync(directory, 0o700);

	// A file another user could read must not be trusted either.
	chmodSync(file, 0o644);
	assert.equal(safeExistingFile(directory, file), false);

	chmodSync(file, 0o4600);
	assert.equal(safeExistingFile(directory, file), false, "setuid must not be hidden by the permission mask");
	chmodSync(file, 0o600);
	chmodSync(directory, 0o2700);
	assert.equal(safeExistingFile(directory, file), false, "setgid must not be hidden by the permission mask");
});

test("safeExistingFile never throws, so a store falls back to a live probe", (context) => {
	const root = scratch(context);
	assert.equal(safeExistingFile(path.join(root, "absent"), path.join(root, "absent", "x")), false);
	const { directory } = store(root);
	assert.equal(safeExistingFile(directory, path.join(directory, "no-such-file")), false);
});

test("a symlinked directory or file is refused everywhere", (context) => {
	const root = scratch(context);
	const { directory, file } = store(root);
	const linkedDir = path.join(root, "linked-store");
	symlinkSync(directory, linkedDir);
	assert.equal(safeExistingFile(linkedDir, file), false);
	assert.throws(() => assertDirectory(linkedDir, unsafe), Refused);

	const linkedFile = path.join(directory, "linked-entry.json");
	symlinkSync(file, linkedFile);
	assert.equal(safeExistingFile(directory, linkedFile), false);
	assert.throws(() => assertFile(linkedFile, unsafe), Refused);
});

test("prepareDirectory creates a missing store at 0o700", (context) => {
	const root = scratch(context);
	const directory = path.join(root, "fresh");
	prepareDirectory(directory, unsafe);
	assert.equal(statSync(directory).mode & 0o777, 0o700);
});

test("processes racing to create the same missing store all succeed", async (context) => {
	// This was a check-then-create: both racers passed `existsSync`, and the
	// loser's EEXIST was reported as `unsafe_store` — a security-shaped refusal
	// for a race one of them had to lose. For the spool that is a dropped receipt
	// outside its own lock, because the store directory is prepared before the
	// lock is taken; for the session store it is a refused write.
	const root = scratch(context);
	const directory = path.join(root, "contended");
	const source = `
		const { prepareDirectory } = await import(${JSON.stringify(new URL("../dist/local-store-guards.js", import.meta.url).href)});
		process.stdout.write("ready\\n");
		await new Promise((resolve) => process.stdin.once("data", resolve));
		prepareDirectory(process.env.GUARD_DIRECTORY, () => {
			throw new Error("refused as unsafe_store");
		});
		process.stdout.write("done\\n");
	`;
	const children = Array.from({ length: 6 }, () => runGuardChild(source, { GUARD_DIRECTORY: directory }));
	const results = await releaseGuardChildren(children);
	for (const result of results) assert.equal(result.code, 0, result.stderr);
	for (const result of results) assert.equal(result.stdout, "ready\ndone\n");
	assert.equal(statSync(directory).mode & 0o777, 0o700);
});

test("the guard-child barrier fails promptly and reaps every child when readiness fails", async () => {
	for (const failingSource of ["setInterval(() => {}, 1000);", "process.exit(7);"]) {
		const children = [
			runGuardChild(failingSource, {}),
			runGuardChild('process.stdout.write("ready\\n"); await new Promise((resolve) => process.stdin.once("data", resolve));', {}),
		];
		await assert.rejects(releaseGuardChildren(children, 50), /guard child/u);
		for (const child of children) assert.equal(child.isAlive(), false);
	}
});

type GuardChildResult = { code: number | null; stdout: string; stderr: string };
type GuardChild = {
	ready: Promise<void>;
	release: () => void;
	result: Promise<GuardChildResult>;
	terminate: () => void;
	isAlive: () => boolean;
};

async function releaseGuardChildren(children: readonly GuardChild[], readyTimeoutMs = 10_000): Promise<GuardChildResult[]> {
	let timer: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			Promise.all(children.map((child) => child.ready)),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error("guard child readiness deadline exceeded")), readyTimeoutMs);
			}),
		]);
		for (const child of children) child.release();
		return await Promise.all(children.map((child) => child.result));
	} finally {
		if (timer) clearTimeout(timer);
		for (const child of children) child.terminate();
		await Promise.allSettled(children.map((child) => child.result));
	}
}

function runGuardChild(source: string, env: NodeJS.ProcessEnv): GuardChild {
	const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
		env: { ...process.env, ...env },
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let readySeen = false;
	let resolveReady: () => void;
	let rejectReady: (reason?: unknown) => void;
	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	child.stdout.on("data", (chunk) => {
		stdout += String(chunk);
		if (!readySeen && stdout.includes("ready\n")) {
			readySeen = true;
			resolveReady();
		}
	});
	child.stderr.on("data", (chunk) => {
		stderr += String(chunk);
	});
	const result = new Promise<GuardChildResult>((resolve, reject) => {
		child.once("error", (error) => {
			if (!readySeen) rejectReady(error);
			reject(error);
		});
		child.once("close", (code) => {
			if (!readySeen) rejectReady(new Error(`guard child exited ${code} before ready: ${stderr}`));
			resolve({ code, stdout, stderr });
		});
	});
	return {
		ready,
		release: () => child.stdin.end("go\n"),
		result,
		terminate: () => {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		},
		isAlive: () => child.exitCode === null && child.signalCode === null,
	};
}

// The strictness difference between the credential store and the cache/spool was
// previously an undocumented accident of which copy you were reading. It is a
// parameter now, so both behaviours are pinned.
test("requireMode decides whether a wrong-mode directory is repaired or refused", (context) => {
	const root = scratch(context);
	const directory = path.join(root, "store");
	mkdirSync(directory);
	chmodSync(directory, 0o755);

	// Cache and spool repair it: mode is enforced a line later by the write.
	prepareDirectory(directory, unsafe);
	assert.equal(statSync(directory).mode & 0o777, 0o700);

	chmodSync(directory, 0o755);
	// The credential store refuses it: nothing has repaired it yet, and a
	// suddenly group-readable credential directory is a reason to stop.
	assert.throws(() => prepareDirectory(directory, unsafe, true), Refused);
	assert.throws(() => assertDirectory(directory, unsafe, true), Refused);
	assert.doesNotThrow(() => assertDirectory(directory, unsafe));

	chmodSync(directory, 0o2700);
	assert.throws(() => prepareDirectory(directory, unsafe, true), Refused);
	assert.throws(() => assertDirectory(directory, unsafe, true), Refused);
	prepareDirectory(directory, unsafe);
	assert.equal(statSync(directory).mode & 0o7777, 0o700, "repairing stores must clear special bits too");
});

test("requireMode decides whether a wrong-mode file is refused", (context) => {
	const root = scratch(context);
	const { file } = store(root, { fileMode: 0o644 });
	// Pre-write callers chmod immediately afterwards, so shape alone is enough.
	assert.doesNotThrow(() => assertFile(file, unsafe));
	// Read-path callers have nothing downstream to fix it.
	assert.throws(() => assertFile(file, unsafe, true), Refused);
	chmodSync(file, 0o4600);
	assert.throws(() => assertFile(file, unsafe, true), Refused);
});

test("a directory is not a file and a file is not a directory", (context) => {
	const root = scratch(context);
	const { directory, file } = store(root);
	assert.throws(() => assertFile(directory, unsafe), Refused);
	assert.throws(() => assertDirectory(file, unsafe), Refused);
});

// Cleanup must never delete something the store did not create.
test("removeOwnedFile distinguishes absence from unsafe state and unlinks only through its opened parent", (context) => {
	const root = scratch(context);
	const { directory, file } = store(root);
	assert.equal(removeOwnedFile(directory, file, unsafe), true);
	assert.equal(existsSync(file), false);
	assert.equal(removeOwnedFile(directory, path.join(directory, "absent"), unsafe), false);
	assert.equal(removeOwnedFile(path.join(root, "absent"), path.join(root, "absent", "entry.json"), unsafe), false);
	assert.throws(() => removeOwnedFile(directory, directory, unsafe), Refused);
	writeFileSync(file, "{}", { mode: 0o600 });
	const link = path.join(directory, "link.json");
	symlinkSync(file, link);
	assert.throws(() => removeOwnedFile(directory, link, unsafe), Refused);
	const hardLink = path.join(directory, "hard-link.json");
	linkSync(file, hardLink);
	assert.throws(() => removeOwnedFile(directory, file, unsafe), Refused);
	rmSync(hardLink);
	const outside = path.join(root, "outside");
	mkdirSync(outside, { mode: 0o700 });
	const substituted = path.join(root, "substituted");
	symlinkSync(outside, substituted);
	assert.throws(() => removeOwnedFile(substituted, path.join(substituted, "missing"), unsafe), Refused);
	chmodSync(directory, 0o755);
	assert.throws(() => removeOwnedFile(directory, file, unsafe), Refused);
});

test("removeOwnedFile keeps deletion anchored when the visible parent is swapped", (context) => {
	const root = scratch(context);
	const { directory, file } = store(root);
	const openedParent = path.join(root, "opened-parent");
	const victimDirectory = path.join(root, "victim");
	const victim = path.join(victimDirectory, path.basename(file));
	mkdirSync(victimDirectory, { mode: 0o700 });
	writeFileSync(victim, "do not delete", { mode: 0o600 });

	const removeAfterSwap = () =>
		removeOwnedFile(directory, file, unsafe, () => {
			renameSync(directory, openedParent);
			symlinkSync(victimDirectory, directory);
		});
	if (process.platform === "darwin") assert.throws(removeAfterSwap, Refused);
	else assert.equal(removeAfterSwap(), true);
	assert.equal(existsSync(victim), true, "the replacement parent's same-named file is outside the opened directory");
	assert.equal(
		existsSync(path.join(openedParent, path.basename(file))),
		process.platform === "darwin",
		"Linux removes through its descriptor path; Darwin fails closed after the parent rename",
	);
});
