import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assertShippableProtocolVendorPin,
	ProtocolVendorPinError,
	validateProtocolVendorPin,
} from "../../scripts/verify-protocol-vendor-pin.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCK = JSON.parse(readFileSync(path.join(ROOT, "gateway-protocol-handoff-lock.json"), "utf8"));

// Every divergence-shaped case below runs off this local fixture rather than off
// the repository's real protocol-vendor-pin.json, and that is the point. The
// outcome the disposition request asks for is a *converged* pin — and a suite
// that asserted "throws because diverged" against the live file would go red on
// the day the divergence is resolved, for a reason that has nothing to do with
// the code. A gate that punishes the fix it exists to ask for teaches the next
// maintainer to delete assertions instead of reading them.
const DIVERGED = Object.freeze({
	schema_version: "ceal.protocol_vendor_pin.v1",
	vendored_path: "packages/ceal-protocol",
	source: {
		repository: "corca-ai/ceal",
		package_path: "packages/ceal-protocol",
		commit: "a".repeat(40),
		tree: "b".repeat(40),
	},
	shipped: {
		lock_file: "gateway-protocol-handoff-lock.json",
		status: "diverged",
		gateway_commit: LOCK.gateway.commit,
		protocol_tree: LOCK.gateway.protocol_tree,
		reason: "fixture divergence",
		disposition_owner: "vinc",
		// A real tracked file, because the gate now requires one. It points at the
		// directory's own README rather than at any dated request: it used to name
		// a received Gateway-lane decision, and deleting that correspondence turned
		// three tests red for a reason unrelated to the code. The README is the one
		// file under `docs/requests/` that outlives every individual request.
		disposition_request: "docs/requests/README.md",
	},
	non_claims: ["fixture"],
});

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function expectCode(code, overrides, label = "") {
	assert.throws(
		() =>
			validateProtocolVendorPin({
				repoRoot: ROOT,
				pin: DIVERGED,
				lock: LOCK,
				vendoredTree: DIVERGED.source.tree,
				vendoredDirty: [],
				vendoredHidden: [],
				...overrides,
			}),
		(error) => {
			assert.ok(error instanceof ProtocolVendorPinError, `expected a ProtocolVendorPinError, got ${error?.name}`);
			assert.equal(error.code, code, `${label} expected ${code}, got ${error.code}: ${error.message}`);
			return true;
		},
	);
}

function expectPass(overrides) {
	return validateProtocolVendorPin({
		repoRoot: ROOT,
		pin: DIVERGED,
		lock: LOCK,
		vendoredTree: DIVERGED.source.tree,
		vendoredDirty: [],
		vendoredHidden: [],
		...overrides,
	});
}

// The check that actually binds this repository: no injection, no fixture. If
// someone edits or re-syncs packages/ceal-protocol without moving the pin, this
// is the assertion that goes red.
test("the vendored protocol copy matches its recorded Gateway source", () => {
	const result = validateProtocolVendorPin({ repoRoot: ROOT });
	assert.equal(result.vendored.tree, result.source.tree);
	assert.equal(result.shipped.gateway_commit, LOCK.gateway.commit);
});

// The converged end state has to stay green, or this suite argues against the
// disposition it is waiting for.
test("a pin whose proof and shipped trees have converged passes as agreed", () => {
	const converged = clone(DIVERGED);
	converged.shipped.status = "agreed";
	// The lock carries the shipped protocol subtree now, so a converged fixture
	// converges on the lock's value rather than on an arbitrary one.
	converged.source.tree = LOCK.gateway.protocol_tree;
	converged.shipped.protocol_tree = converged.source.tree;
	// Convergence is decided by the commits, so a converged fixture has to move
	// both: matching trees alone would now be a pin contradicting itself.
	converged.source.commit = LOCK.gateway.commit;
	// An `agreed` pin has no open question, so it needs no reason, owner, or request.
	converged.shipped.reason = undefined;
	converged.shipped.disposition_owner = undefined;
	converged.shipped.disposition_request = undefined;
	const result = expectPass({ pin: converged, vendoredTree: converged.source.tree });
	assert.equal(result.diverged, false);
});

// Moving to the protocol-only handoff left `gateway-handoff-lock.json` sitting in
// the root, tracked and read by nothing: every gate was green, because a gate
// that only reads the lock the pin names cannot notice a second one. It was not
// harmless — `docs/macos-worker-runbook.md` told an operator to verify a download
// against `archive.sha256` in that file, and the file still answered, with the
// digest of a Protocol no release lane binds any more. A superseded lock is a
// working procedure pointing at the wrong bytes.
test("the repository root carries exactly the one protocol handoff lock the pin names", () => {
	const pin = JSON.parse(readFileSync(path.join(ROOT, "protocol-vendor-pin.json"), "utf8"));
	const locks = readdirSync(ROOT).filter((name) => /handoff-lock\.json$/u.test(name));
	assert.deepEqual(
		locks.filter((name) => name.includes("protocol")).sort(),
		[pin.shipped.lock_file],
		"a protocol handoff lock the pin does not name is a stale procedure input, not a spare copy",
	);
});

// A drifted copy is the whole point, so it gets its own case rather than being
// folded into the shape sweep below.
test("a vendored copy that no longer hashes to its recorded source fails", () => {
	expectCode("vendored_tree_mismatch", { vendoredTree: "0".repeat(40) });
});

// A committed tree hash is blind to a working-tree edit, which is precisely how
// a mid-sync tree looks. Green here would mean "the copy you are looking at is
// not the copy this gate checked".
test("an uncommitted edit inside the vendored copy fails", () => {
	expectCode("vendored_worktree_dirty", { vendoredDirty: ["M packages/ceal-protocol/src/index.ts"] });
});

// The one bypass that survived the first draft: `git update-index
// --assume-unchanged` (and its `--skip-worktree` sibling) tells Git to stop
// looking at a file, so `git status` calls an edited frozen copy clean while
// `HEAD:` still hashes to the pinned tree. Both other checks pass over it, which
// made "the copy on disk matches its record" a claim the gate could not support.
test("a vendored file Git was told to stop watching fails", () => {
	expectCode("vendored_change_hidden", { vendoredHidden: ["packages/ceal-protocol/src/index.ts"] });
});

// The divergence declaration is only worth having if it expires with its own
// facts. A lock bump means the shipped side moved, so the declaration was made
// about a state that no longer exists and has to be re-examined.
test("a Gateway handoff lock that moved past the pin fails", () => {
	const moved = clone(LOCK);
	moved.gateway.commit = "1".repeat(40);
	expectCode("shipped_lock_mismatch", { lock: moved });
});

// The two directions of a lying status. Both matter: a false `agreed` hides a
// real divergence, and a false `diverged` keeps an answered question open and
// trains maintainers to ignore the declaration.
test("a status that contradicts the recorded trees fails in both directions", () => {
	const claimsAgreement = clone(DIVERGED);
	claimsAgreement.shipped.status = "agreed";
	expectCode("undeclared_divergence", { pin: claimsAgreement });

	const claimsDivergence = clone(DIVERGED);
	claimsDivergence.source.tree = LOCK.gateway.protocol_tree;
	claimsDivergence.shipped.protocol_tree = claimsDivergence.source.tree;
	claimsDivergence.source.commit = LOCK.gateway.commit;
	expectCode("stale_divergence_record", { pin: claimsDivergence, vendoredTree: claimsDivergence.source.tree });
});

// Forging `source.tree` alone always failed against `HEAD:`. Forging
// `shipped.protocol_tree` to agree with it used to pass, because nothing else in
// the repository knew what the shipped subtree was. The protocol-only handoff
// declares it and the lock records it, so the pin no longer gets the last word on
// that field.
test("a shipped protocol subtree the lock does not bind is refused", () => {
	const forged = clone(DIVERGED);
	forged.shipped.protocol_tree = "f".repeat(40);
	expectCode("shipped_lock_mismatch", { pin: forged });
});

// Existence alone was too weak: every path in the tree satisfied it, so a
// one-character edit could keep a dead declaration alive by aiming it at
// README.md. A request has to be somewhere a reader would look for one, and it
// has to be tracked, or nobody but its author can read it.
test("a divergence must point at a tracked file under docs/requests/", () => {
	for (const [request, label] of [
		["docs/requests/does-not-exist.md", "a deleted request"],
		["README.md", "a file that is not a request"],
		["protocol-vendor-pin.json", "the pin pointing at itself"],
	]) {
		const orphaned = clone(DIVERGED);
		orphaned.shipped.disposition_request = request;
		expectCode("stale_divergence_record", { pin: orphaned }, label);
	}
	// Untracked is checked separately: the path exists and is correctly placed,
	// so only the index can distinguish it.
	expectCode("stale_divergence_record", { requestTracked: false });
	assert.equal(expectPass({ requestTracked: true }).diverged, true);
});

// The declared divergence must name who owes the answer and why, or "diverged"
// degrades into a permanent silent exemption.
test("a divergence missing its reason, owner, or request is not a declaration", () => {
	for (const field of ["reason", "disposition_owner", "disposition_request"]) {
		const incomplete = clone(DIVERGED);
		delete incomplete.shipped[field];
		expectCode("invalid_protocol_vendor_pin", { pin: incomplete });
	}
});

test("a pin missing its schema, identities, or non-claims is rejected", () => {
	for (const mutate of [
		(pin) => {
			pin.schema_version = "ceal.protocol_vendor_pin.v0";
		},
		(pin) => {
			pin.source.commit = "not-a-git-object";
		},
		(pin) => {
			pin.source.repository = "corca-ai/ceal-cli";
		},
		(pin) => {
			pin.shipped.protocol_tree = "short";
		},
		(pin) => {
			pin.shipped.status = "unknown";
		},
		(pin) => {
			pin.non_claims = [];
		},
	]) {
		const broken = clone(DIVERGED);
		mutate(broken);
		expectCode("invalid_protocol_vendor_pin", { pin: broken, vendoredTree: broken.source.tree });
	}
});

// The live pin's own consistency, kept separate from the divergence-shaped cases
// above so this is the only assertion that has to change when the disposition
// lands. It states what must hold whichever way that goes.
test("the repository's own pin agrees with the lock it was written about", () => {
	const pin = JSON.parse(readFileSync(path.join(ROOT, "protocol-vendor-pin.json"), "utf8"));
	assert.equal(pin.shipped.lock_file, "gateway-protocol-handoff-lock.json");
	assert.equal(pin.shipped.gateway_commit, LOCK.gateway.commit, "the pin must be written about the lock this repository actually carries");
	assert.equal(
		pin.shipped.status === "diverged",
		pin.shipped.protocol_tree !== pin.source.tree,
		"the declared status and the recorded trees must agree",
	);
});

// The ship gate itself, on the live pin. This is the assertion that keeps
// `npm run check` from returning green while what the repository tests is not
// what a release would ship, so it is deliberately not written as "throws
// because diverged": that form would go red on the day the divergence is
// resolved, which is the outcome the whole guard exists to ask for. It asserts
// shippability, and a divergence makes it fail on its own.
test("the repository's vendored protocol is shippable against the lock it carries", () => {
	const result = assertShippableProtocolVendorPin({ repoRoot: ROOT });
	assert.equal(result.diverged, false);
	// The verdict must come from the one identity the pin does not author.
	assert.equal(result.source.commit, LOCK.gateway.commit);
});

// Fatality lives here, in the fixture tier, for the reason the header gives.
test("a diverged pin is refused as a release input, however well declared", () => {
	// DIVERGED is a complete, correctly declared divergence: reason, owner, and a
	// tracked request all present, and `validateProtocolVendorPin` accepts it.
	// That acceptance is what lets development continue; it is not clearance.
	assert.equal(expectPass({}).diverged, true);
	assert.throws(
		() =>
			assertShippableProtocolVendorPin({
				repoRoot: ROOT,
				pin: DIVERGED,
				lock: LOCK,
				vendoredTree: DIVERGED.source.tree,
				vendoredDirty: [],
				vendoredHidden: [],
			}),
		(error) => {
			assert.equal(error.code, "proof_shipment_protocol_divergence");
			// The owner decision requires the failure to name both immutable
			// identities, so a reader can tell which side has to move.
			assert.match(error.message, new RegExp(DIVERGED.source.commit, "u"));
			assert.match(error.message, new RegExp(LOCK.gateway.commit, "u"));
			return true;
		},
	);
});

// A pin that recorded converged commits alongside two different trees would be
// carrying two answers, and the gate would silently use one of them.
test("a pin whose commits and trees disagree about convergence is rejected", () => {
	const contradictory = clone(DIVERGED);
	contradictory.source.commit = LOCK.gateway.commit;
	expectCode("invalid_protocol_vendor_pin", { pin: contradictory, vendoredTree: contradictory.source.tree });
});

// The reverse must not be rejected the same way. Two Gateway commits can carry a
// byte-identical protocol subtree, and a pin that records that is honest. It is
// still unshippable — the lock binds the other commit and nothing here can check
// the byte-identity claim — but it has to fail as a divergence, not as a lying
// pin. Otherwise the only way to a green gate is to write a false `source.commit`,
// which is the one field the whole verdict rests on.
test("an identical subtree under a different Gateway commit is a divergence, not a lying pin", () => {
	const identicalSubtree = clone(DIVERGED);
	identicalSubtree.source.tree = LOCK.gateway.protocol_tree;
	identicalSubtree.shipped.protocol_tree = identicalSubtree.source.tree;
	const injected = {
		pin: identicalSubtree,
		lock: LOCK,
		vendoredTree: identicalSubtree.source.tree,
		vendoredDirty: [],
		vendoredHidden: [],
	};
	// It is a well-formed pin: `validateProtocolVendorPin` accepts it and reports
	// the divergence rather than rejecting the shape.
	assert.equal(validateProtocolVendorPin({ repoRoot: ROOT, ...injected }).diverged, true);
	assert.throws(
		() => assertShippableProtocolVendorPin({ repoRoot: ROOT, ...injected }),
		(error) => {
			assert.equal(error.code, "proof_shipment_protocol_divergence");
			return true;
		},
	);
});
