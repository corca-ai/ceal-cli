import { validateProtocolVendorPin } from "../scripts/verify-protocol-vendor-pin.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
type GatewayHandoffLock = {
	gateway: { commit: string; protocol_tree: string };
	protocol: { package: string; version: string; filename: string; sha256: string };
};

const LOCK = JSON.parse(readFileSync(path.join(ROOT, "gateway-protocol-handoff-lock.json"), "utf8")) as GatewayHandoffLock;

// This file is intentionally in the release tier. These assertions bind the real
// checkout and release-input records; the contract-tier sibling contains only
// injected validator fixtures and must stay independent of this state.
test("the vendored protocol artifact is the exact archive the handoff lock binds", () => {
	const result = validateProtocolVendorPin({ repoRoot: ROOT });
	assert.equal(result.vendored.sha256, LOCK.protocol.sha256);
	assert.equal(result.vendored.path, `vendor/ceal-protocol/${LOCK.protocol.filename}`);
	assert.equal(result.source.commit, LOCK.gateway.commit);
});

// The validator hashes the file itself, so this re-derives the digest independently
// rather than re-reading the validator's own answer. Without it, a validator that
// returned the lock's value verbatim would pass the test above.
test("the vendored archive on disk really hashes to what the lock records", () => {
	const bytes = readFileSync(path.join(ROOT, "vendor/ceal-protocol", LOCK.protocol.filename));
	assert.equal(createHash("sha256").update(bytes).digest("hex"), LOCK.protocol.sha256);
});

// Asked of Git, not of the filesystem, and against the REAL checkout. Every other
// assertion in this file would pass over an archive that exists locally and reaches
// no clone -- which is exactly the state this cutover shipped in until a reviewer
// read .gitignore.
test("the vendored archive is tracked, so a clone of this branch actually gets a Protocol", () => {
	const tracked = execFileSync("git", ["ls-files", "--", `vendor/ceal-protocol/${LOCK.protocol.filename}`], {
		cwd: ROOT,
		encoding: "utf8",
	}).trim();
	assert.equal(tracked, `vendor/ceal-protocol/${LOCK.protocol.filename}`, "the archive must be in the index, not merely on disk");
	// Positive control: the same command reports nothing for a path that is ignored,
	// so a match above is a real index entry rather than an echo of the argument.
	assert.equal(execFileSync("git", ["ls-files", "--", "node_modules"], { cwd: ROOT, encoding: "utf8" }).trim(), "");
});

test("the repository root carries exactly one protocol handoff lock", () => {
	const locks = readdirSync(ROOT).filter((name) => /handoff-lock\.json$/u.test(name));
	assert.deepEqual(
		locks.filter((name) => name.includes("protocol")).sort(),
		["gateway-protocol-handoff-lock.json"],
		"a second protocol handoff lock is a stale procedure input, not a spare copy",
	);
});

// The editable copy is what `a8b3b96` was able to edit, and removing the ABILITY --
// not merely the pressure -- is the whole point of consuming a tarball. This is a
// live prohibition rather than migration scaffolding, so it stays.
test("no editable protocol source tree may re-enter this repository", () => {
	assert.equal(
		readdirSync(path.join(ROOT, "packages")).includes("ceal-protocol"),
		false,
		"packages/ceal-protocol is consumed as a signed artifact under vendor/; a source copy here would be editable again",
	);
});

test("exactly one vendored protocol archive is carried, and the lock names it", () => {
	assert.deepEqual(readdirSync(path.join(ROOT, "vendor/ceal-protocol")).sort(), [LOCK.protocol.filename]);
});
