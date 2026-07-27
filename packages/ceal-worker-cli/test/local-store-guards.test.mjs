import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertDirectory, assertFile, prepareDirectory, removableFile, safeExistingFile } from "../dist/local-store-guards.js";

class Refused extends Error {}
function unsafe() {
	throw new Refused("unsafe_store");
}

function scratch(context) {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-store-guards-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

function store(root, { dirMode = 0o700, fileMode = 0o600 } = {}) {
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
	const startAt = Date.now() + 750;
	const source = `
		const { prepareDirectory } = await import(${JSON.stringify(new URL("../dist/local-store-guards.js", import.meta.url).href)});
		const startAt = Number(process.env.GUARD_START_AT);
		const margin = startAt - Date.now();
		await new Promise((resolve) => setTimeout(resolve, Math.max(0, margin - 20)));
		while (Date.now() < startAt) {}
		prepareDirectory(process.env.GUARD_DIRECTORY, () => {
			throw new Error("refused as unsafe_store");
		});
		process.stdout.write(String(margin));
	`;
	const results = await Promise.all(
		Array.from({ length: 6 }, () => runGuardChild(source, { GUARD_DIRECTORY: directory, GUARD_START_AT: String(startAt) })),
	);
	for (const result of results) assert.equal(result.code, 0, result.stderr);
	// Same guard as the spool's concurrency test: a host too slow to reach the
	// barrier would serialize the racers and pass without racing anything.
	const margins = results.map((result) => Number(result.stdout.trim()));
	assert.deepEqual(
		margins.filter((margin) => !(margin >= 0)),
		[],
		`creators did not overlap; margins to the shared barrier were ${margins.join(", ")}ms`,
	);
	assert.equal(statSync(directory).mode & 0o777, 0o700);
});

function runGuardChild(source, env) {
	const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
		env: { ...process.env, ...env },
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
});

test("requireMode decides whether a wrong-mode file is refused", (context) => {
	const root = scratch(context);
	const { file } = store(root, { fileMode: 0o644 });
	// Pre-write callers chmod immediately afterwards, so shape alone is enough.
	assert.doesNotThrow(() => assertFile(file, unsafe));
	// Read-path callers have nothing downstream to fix it.
	assert.throws(() => assertFile(file, unsafe, true), Refused);
});

test("a directory is not a file and a file is not a directory", (context) => {
	const root = scratch(context);
	const { directory, file } = store(root);
	assert.throws(() => assertFile(directory, unsafe), Refused);
	assert.throws(() => assertDirectory(file, unsafe), Refused);
});

// Cleanup must never delete something the store did not create.
test("removableFile accepts only a plain existing file", (context) => {
	const root = scratch(context);
	const { directory, file } = store(root);
	assert.equal(removableFile(file), true);
	assert.equal(removableFile(path.join(directory, "absent")), false);
	assert.equal(removableFile(directory), false);
	const link = path.join(directory, "link.json");
	symlinkSync(file, link);
	assert.equal(removableFile(link), false);
});
