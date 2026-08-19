import { checkNoLegacyMjs, parseArgs, writeBaseline } from "../../scripts/check-no-legacy-mjs.ts";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CHECKER = fileURLToPath(new URL("../../scripts/check-no-legacy-mjs.ts", import.meta.url));

function fixture() {
	const root = mkdtempSync(path.join(os.tmpdir(), "ceal-no-legacy-mjs-"));
	const policy = path.join(root, "policy.json");
	const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
	const put = (name: string, contents = "export {}\n") => {
		const file = path.join(root, name);
		writeFileSync(file, contents, { encoding: "utf8" });
	};
	put("old.mjs");
	put("space name.mjs");
	git(["init", "-q"]);
	git(["config", "user.email", "test@example.invalid"]);
	git(["config", "user.name", "test"]);
	git(["add", "old.mjs", "space name.mjs"]);
	git(["commit", "-qm", "fixture"]);
	writeBaseline(root, policy);
	return { root, policy, git, put, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("clean fixtures and spaces pass the exact list", () => {
	const f = fixture();
	try {
		assert.deepEqual(checkNoLegacyMjs(f.root, f.policy), ["old.mjs", "space name.mjs"]);
	} finally {
		f.cleanup();
	}
});

test("staged new files, staged deletions, and swaps fail closed", () => {
	const added = fixture();
	try {
		added.put("new.mjs");
		added.git(["add", "new.mjs"]);
		assert.throws(() => checkNoLegacyMjs(added.root, added.policy), /added: new[.]mjs/u);
	} finally {
		added.cleanup();
	}
	const deleted = fixture();
	try {
		deleted.git(["rm", "-q", "old.mjs"]);
		assert.throws(() => checkNoLegacyMjs(deleted.root, deleted.policy), /removed: old[.]mjs/u);
	} finally {
		deleted.cleanup();
	}
	const swapped = fixture();
	try {
		swapped.git(["rm", "-q", "old.mjs"]);
		swapped.put("replacement.mjs");
		swapped.git(["add", "replacement.mjs"]);
		assert.throws(() => checkNoLegacyMjs(swapped.root, swapped.policy), /replacement[.]mjs.*old[.]mjs|old[.]mjs.*replacement[.]mjs/u);
	} finally {
		swapped.cleanup();
	}
});

test("unstaged worktree deletions and untracked additions are current inventory", () => {
	const deleted = fixture();
	try {
		rmSync(path.join(deleted.root, "old.mjs"));
		assert.throws(() => checkNoLegacyMjs(deleted.root, deleted.policy), /removed: old[.]mjs/u);
	} finally {
		deleted.cleanup();
	}
	const added = fixture();
	try {
		added.put("new.mjs");
		assert.throws(() => checkNoLegacyMjs(added.root, added.policy), /added: new[.]mjs/u);
	} finally {
		added.cleanup();
	}
});

test("absent and malformed policies fail closed", () => {
	const f = fixture();
	try {
		rmSync(f.policy);
		assert.throws(() => checkNoLegacyMjs(f.root, f.policy), /missing policy/u);
		writeFileSync(f.policy, "[]\n");
		assert.throws(() => checkNoLegacyMjs(f.root, f.policy), /object/u);
		writeFileSync(f.policy, JSON.stringify({ schema_version: "ceal.no_legacy_mjs.v1", files: ["old.mjs", "old.mjs"] }));
		assert.throws(() => checkNoLegacyMjs(f.root, f.policy), /duplicates/u);
		for (const invalid of ["dir/./foo.mjs", "dir/../foo.mjs", "C:/foo.mjs", "//server/foo.mjs", "foo\\bar.mjs", "foo.txt"]) {
			writeFileSync(f.policy, JSON.stringify({ schema_version: "ceal.no_legacy_mjs.v1", files: [invalid] }));
			assert.throws(() => checkNoLegacyMjs(f.root, f.policy), /non-normalized|must be .mjs/u, invalid);
		}
	} finally {
		f.cleanup();
	}
});

test("writer roundtrip is exact and rejects wrong object entries", () => {
	const f = fixture();
	try {
		const files = writeBaseline(f.root, f.policy);
		const first = readFileSync(f.policy, "utf8");
		assert.deepEqual(JSON.parse(first).files, files);
		writeBaseline(f.root, f.policy);
		assert.equal(readFileSync(f.policy, "utf8"), first);
		writeFileSync(f.policy, JSON.stringify({ schema_version: "ceal.no_legacy_mjs.v1", files: ["old.mjs", 3] }));
		assert.throws(() => checkNoLegacyMjs(f.root, f.policy), /strings/u);
	} finally {
		f.cleanup();
	}
});

test("CLI parsing is order-independent and rejects duplicates, unknown flags, and missing values", () => {
	assert.deepEqual(parseArgs(["--policy", "policy.json", "--write-baseline", "--repo-root", "."]), {
		write: true,
		repoRoot: path.resolve("."),
		policyPath: path.resolve("policy.json"),
	});
	for (const args of [["--write-baseline", "--write-baseline"], ["--repo-root", "--policy", "x"], ["--policy"], ["--unknown"]])
		assert.throws(() => parseArgs(args), /duplicate|missing value|unknown flag/u);
});

test("CLI rejects a nested root before reading policy or listing files", () => {
	const f = fixture();
	try {
		const nested = path.join(f.root, "nested");
		mkdirSync(nested);
		assert.throws(() => checkNoLegacyMjs(nested, f.policy), /Git worktree root/u);
		const result = spawnSync(process.execPath, [CHECKER, "--policy"], { cwd: f.root, encoding: "utf8" });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /missing value for --policy/u);
	} finally {
		f.cleanup();
	}
});
