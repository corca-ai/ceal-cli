import {
	assertShippableProtocolVendorPin,
	ProtocolVendorPinError,
	validateProtocolVendorPin,
} from "../../scripts/verify-protocol-vendor-pin.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Contract tier: every case here is an injected fixture. The release-tier sibling
// (`test/protocol-vendor-pin.test.ts`) is the one that binds the real checkout, and
// these two must not learn about each other's state.
//
// This surface is smaller than the tree-pin it replaces, and the shrink is mostly
// evidence rather than lost coverage: `vendored_tree_mismatch`,
// `vendored_worktree_dirty`, `undeclared_divergence`, `stale_divergence_record` and
// `proof_shipment_protocol_divergence` are gone because their preconditions are gone
// — there is no second copy to drift and no proof/ship gap to declare.
//
// `vendored_change_hidden` is the exception, and it is worth being precise about why.
// Its subject was never `assume-unchanged` specifically; it was Git having been told
// something untrue about these bytes. That is still reachable, by a route the tree-pin
// never faced: a `.gitignore` pattern. `vendored_artifact_untracked` below is its
// replacement, and it is the one question a content digest cannot answer.

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const DIGEST = "c".repeat(64);

function lock(overrides: Record<string, unknown> = {}) {
	return {
		gateway: { commit: COMMIT, protocol_tree: TREE },
		protocol: { package: "@corca-ai/ceal-protocol", version: "0.73.0", filename: "corca-ai-ceal-protocol-0.73.0.tgz", sha256: DIGEST },
		...overrides,
	};
}

function expectCode(code: string, options: Parameters<typeof validateProtocolVendorPin>[0], message?: string) {
	assert.throws(
		() => validateProtocolVendorPin(options),
		(error: unknown) => error instanceof ProtocolVendorPinError && error.code === code,
		message ?? `expected ${code}`,
	);
}

test("a vendored archive matching the lock digest passes, and reports the lock's identities", () => {
	const result = validateProtocolVendorPin({ lock: lock(), artifactSha256: DIGEST });
	assert.equal(result.vendored.path, "vendor/ceal-protocol/corca-ai-ceal-protocol-0.73.0.tgz");
	assert.equal(result.vendored.sha256, DIGEST);
	assert.equal(result.source.commit, COMMIT);
	assert.equal(result.source.protocol_tree, TREE);
	assert.ok(result.non_claims.length > 0, "the result must carry its non-claims");
});

test("a digest that disagrees with the lock is refused", () => {
	expectCode("vendored_artifact_mismatch", { lock: lock(), artifactSha256: "d".repeat(64) });
});

// The ship gate is a distinct entry point because four release paths call it by
// name. It must stay a real call rather than an alias a refactor can drop.
test("the ship gate refuses exactly what the validator refuses, and passes what it passes", () => {
	assert.equal(assertShippableProtocolVendorPin({ lock: lock(), artifactSha256: DIGEST }).vendored.sha256, DIGEST);
	assert.throws(
		() => assertShippableProtocolVendorPin({ lock: lock(), artifactSha256: "d".repeat(64) }),
		(error: unknown) => error instanceof ProtocolVendorPinError && error.code === "vendored_artifact_mismatch",
	);
});

// The archive being PRESENT and CORRECT is not the same as it being in the
// repository. This repository ignores `*.tgz` for `npm pack` output and a slash-free
// pattern matches at any depth, so the vendored archive was untracked for the whole
// first version of this cutover with every local gate green. A clone would have had
// no Protocol and `npm ci` would have died on the `file:` dependency before any gate
// ran. This is the surviving half of the retired `vendored_change_hidden` check: its
// subject was never `assume-unchanged` specifically, it was Git being told something
// untrue about these bytes.
test("an archive with the right bytes is still refused when Git does not track it", () => {
	expectCode("vendored_artifact_untracked", { lock: lock(), artifactSha256: DIGEST, tracked: false });
	// Positive control: the identical call with the same right bytes passes, so the
	// refusal is attributable to tracking and to nothing else.
	assert.equal(validateProtocolVendorPin({ lock: lock(), artifactSha256: DIGEST, tracked: true }).vendored.sha256, DIGEST);
});

// Ordering matters: wrong bytes must report as wrong bytes. A tracking complaint
// about an archive that is also the wrong archive would send a reader to .gitignore
// for a problem that is not there.
test("wrong bytes outrank a tracking complaint", () => {
	expectCode("vendored_artifact_mismatch", { lock: lock(), artifactSha256: "d".repeat(64), tracked: false });
});

test("an unreadable protocol identity is a refusal, never a pass-over", () => {
	expectCode("invalid_gateway_handoff_lock", { lock: {}, artifactSha256: DIGEST }, "a lock with no protocol block");
	expectCode(
		"invalid_gateway_handoff_lock",
		{ lock: lock({ protocol: { package: "@corca-ai/other", version: "0.73.0", filename: "corca-ai-ceal-protocol-0.73.0.tgz", sha256: DIGEST } }), artifactSha256: DIGEST },
		"a lock naming some other package",
	);
	expectCode(
		"invalid_gateway_handoff_lock",
		{ lock: lock({ protocol: { package: "@corca-ai/ceal-protocol", version: "0.73.0", filename: "corca-ai-ceal-protocol-0.99.0.tgz", sha256: DIGEST } }), artifactSha256: DIGEST },
		"a filename that does not follow the version it is recorded beside",
	);
	expectCode(
		"invalid_gateway_handoff_lock",
		{ lock: lock({ protocol: { package: "@corca-ai/ceal-protocol", version: "0.73.0", filename: "corca-ai-ceal-protocol-0.73.0.tgz", sha256: "not-a-digest" } }), artifactSha256: DIGEST },
		"a malformed digest",
	);
});

// Deliberately required rather than conditional. These are the producer identities
// a release quotes, and skipping the check when the lock omits them would leave the
// quote unsourced with the gate still green.
test("a lock without the producing Gateway identities is refused", () => {
	expectCode("invalid_gateway_handoff_lock", { lock: lock({ gateway: {} }), artifactSha256: DIGEST });
	expectCode("invalid_gateway_handoff_lock", { lock: lock({ gateway: { commit: "nope", protocol_tree: TREE } }), artifactSha256: DIGEST });
	expectCode("invalid_gateway_handoff_lock", { lock: lock({ gateway: { commit: COMMIT } }), artifactSha256: DIGEST });
});

test("the archive must be a real regular file, not a symlink and not absent", (t) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-protocol-artifact-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(path.join(root, "gateway-protocol-handoff-lock.json"), JSON.stringify(lock()));
	mkdirSync(path.join(root, "vendor/ceal-protocol"), { recursive: true });

	expectCode("vendored_artifact_missing", { repoRoot: root }, "no archive at all");

	// A symlink is refused because it points somewhere this gate did not hash and
	// nothing stops it being retargeted after the check.
	writeFileSync(path.join(root, "elsewhere.tgz"), "payload");
	symlinkSync(path.join(root, "elsewhere.tgz"), path.join(root, "vendor/ceal-protocol/corca-ai-ceal-protocol-0.73.0.tgz"));
	expectCode("vendored_artifact_missing", { repoRoot: root }, "a symlinked archive");
});

test("a real file is hashed rather than trusted, and a wrong one is named in the error", (t) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-protocol-artifact-real-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(path.join(root, "gateway-protocol-handoff-lock.json"), JSON.stringify(lock()));
	mkdirSync(path.join(root, "vendor/ceal-protocol"), { recursive: true });
	writeFileSync(path.join(root, "vendor/ceal-protocol/corca-ai-ceal-protocol-0.73.0.tgz"), "not the signed archive");
	assert.throws(
		() => validateProtocolVendorPin({ repoRoot: root }),
		(error: unknown) =>
			error instanceof ProtocolVendorPinError &&
			error.code === "vendored_artifact_mismatch" &&
			error.message.includes("vendor/ceal-protocol/corca-ai-ceal-protocol-0.73.0.tgz"),
	);
});

test("a lock that is missing or is not JSON is refused rather than skipped", (t) => {
	const root = mkdtempSync(path.join(tmpdir(), "ceal-protocol-artifact-lock-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	expectCode("invalid_gateway_handoff_lock", { repoRoot: root }, "no lock file");
	writeFileSync(path.join(root, "gateway-protocol-handoff-lock.json"), "{not json");
	expectCode("invalid_gateway_handoff_lock", { repoRoot: root }, "a malformed lock");
});
