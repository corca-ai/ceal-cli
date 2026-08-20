import { isJsonRecord } from "../../packages/ceal-worker-cli/src/json-record.ts";
import {
	assertShippableProtocolVendorPin,
	ProtocolVendorPinError,
	validateProtocolVendorPin,
} from "../../scripts/verify-protocol-vendor-pin.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

type ValidationOptions = Parameters<typeof validateProtocolVendorPin>[0];
type ProtocolVendorPinFixture = {
	schema_version: string;
	vendored_path: string;
	source: { repository: string; package_path: string; commit: string; tree: string };
	shipped: {
		lock_file: string;
		status: string;
		gateway_commit: string;
		protocol_tree: string;
		reason?: string | undefined;
		disposition_owner?: string | undefined;
		disposition_request?: string | undefined;
	};
	non_claims: string[];
};
type GatewayHandoffLock = { gateway: { commit: string; protocol_tree: string } };
type DivergenceField = "reason" | "disposition_owner" | "disposition_request";
const DIVERGENCE_FIELDS: readonly DivergenceField[] = ["reason", "disposition_owner", "disposition_request"];

function isGatewayHandoffLock(value: unknown): value is GatewayHandoffLock {
	return (
		isJsonRecord(value) &&
		isJsonRecord(value.gateway) &&
		typeof value.gateway.commit === "string" &&
		typeof value.gateway.protocol_tree === "string"
	);
}

function clone<T>(value: T, isValue: (candidate: unknown) => candidate is T): T {
	const cloned: unknown = JSON.parse(JSON.stringify(value));
	if (!isValue(cloned)) throw new TypeError("invalid cloned JSON fixture");
	return cloned;
}

function isProtocolVendorPin(value: unknown): value is ProtocolVendorPinFixture {
	return isJsonRecord(value) && isJsonRecord(value.source) && isJsonRecord(value.shipped) && Array.isArray(value.non_claims);
}

function isProtocolVendorPinError(error: unknown): error is InstanceType<typeof ProtocolVendorPinError> {
	return error instanceof ProtocolVendorPinError;
}

const FIXTURE_ROOT = mkdtempSync(path.join(tmpdir(), "ceal-protocol-vendor-pin-"));
mkdirSync(path.join(FIXTURE_ROOT, "docs"), { recursive: true });
writeFileSync(path.join(FIXTURE_ROOT, "docs", "protocol-quarantine.md"), "synthetic fixture quarantine\n");
test.after(() => rmSync(FIXTURE_ROOT, { recursive: true, force: true }));

const LOCK: GatewayHandoffLock = Object.freeze({
	gateway: {
		commit: "c".repeat(40),
		protocol_tree: "d".repeat(40),
	},
});

// Every divergence-shaped case below runs off this local fixture rather than off
// the repository's real protocol-vendor-pin.json, and that is the point. The
// outcome the disposition request asks for is a *converged* pin — and a suite
// that asserted "throws because diverged" against the live file would go red on
// the day the divergence is resolved, for a reason that has nothing to do with
// the code. A gate that punishes the fix it exists to ask for teaches the next
// maintainer to delete assertions instead of reading them.
const DIVERGED: Readonly<ProtocolVendorPinFixture> = Object.freeze({
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
		// A synthetic file at the exact owner path, because the gate requires one
		// stable quarantine record rather than dated cross-repository correspondence.
		disposition_request: "docs/protocol-quarantine.md",
	},
	non_claims: ["fixture"],
});

function validateFixture(overrides: ValidationOptions = {}) {
	return validateProtocolVendorPin({
		repoRoot: FIXTURE_ROOT,
		pin: DIVERGED,
		lock: LOCK,
		vendoredTree: DIVERGED.source.tree,
		vendoredDirty: [],
		vendoredHidden: [],
		requestTracked: true,
		...overrides,
	});
}

function expectCode(code: string, overrides: ValidationOptions = {}, label = "") {
	assert.throws(
		() => validateFixture(overrides),
		(error) => {
			assert.ok(
				isProtocolVendorPinError(error),
				`expected a ProtocolVendorPinError, got ${error instanceof Error ? error.name : typeof error}`,
			);
			if (!isProtocolVendorPinError(error)) return false;
			assert.equal(error.code, code, `${label} expected ${code}, got ${error.code}: ${error.message}`);
			return true;
		},
	);
}

function expectPass(overrides: ValidationOptions = {}) {
	return validateFixture(overrides);
}

// The converged end state has to stay green, or this suite argues against the
// disposition it is waiting for.
test("a pin whose proof and shipped trees have converged passes as agreed", () => {
	const converged = clone(DIVERGED, isProtocolVendorPin);
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
	assert.equal(
		assertShippableProtocolVendorPin({
			repoRoot: FIXTURE_ROOT,
			pin: converged,
			lock: LOCK,
			vendoredTree: converged.source.tree,
			vendoredDirty: [],
			vendoredHidden: [],
		}).diverged,
		false,
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
	const moved = clone(LOCK, isGatewayHandoffLock);
	moved.gateway.commit = "1".repeat(40);
	expectCode("shipped_lock_mismatch", { lock: moved });
});

// The two directions of a lying status. Both matter: a false `agreed` hides a
// real divergence, and a false `diverged` keeps an answered question open and
// trains maintainers to ignore the declaration.
test("a status that contradicts the recorded trees fails in both directions", () => {
	const claimsAgreement = clone(DIVERGED, isProtocolVendorPin);
	claimsAgreement.shipped.status = "agreed";
	expectCode("undeclared_divergence", { pin: claimsAgreement });

	const claimsDivergence = clone(DIVERGED, isProtocolVendorPin);
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
	const forged = clone(DIVERGED, isProtocolVendorPin);
	forged.shipped.protocol_tree = "f".repeat(40);
	expectCode("shipped_lock_mismatch", { pin: forged });
});

// Existence alone was too weak: every path in the tree satisfied it, so a
// one-character edit could keep a dead declaration alive by aiming it at an
// unrelated document. The pin must name the single tracked quarantine record.
test("a divergence must point at the tracked Protocol quarantine record", () => {
	for (const [request, label] of [
		["docs/protocol-quarantine-missing.md", "a deleted quarantine record"],
		["README.md", "an unrelated file"],
		["protocol-vendor-pin.json", "the pin pointing at itself"],
	]) {
		const orphaned = clone(DIVERGED, isProtocolVendorPin);
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
	for (const field of DIVERGENCE_FIELDS) {
		const incomplete = clone(DIVERGED, isProtocolVendorPin);
		delete incomplete.shipped[field];
		expectCode("invalid_protocol_vendor_pin", { pin: incomplete });
	}
});

test("a pin missing its schema, identities, or non-claims is rejected", () => {
	for (const mutate of [
		(pin: ProtocolVendorPinFixture) => {
			pin.schema_version = "ceal.protocol_vendor_pin.v0";
		},
		(pin: ProtocolVendorPinFixture) => {
			pin.source.commit = "not-a-git-object";
		},
		(pin: ProtocolVendorPinFixture) => {
			pin.source.repository = "corca-ai/ceal-cli";
		},
		(pin: ProtocolVendorPinFixture) => {
			pin.shipped.protocol_tree = "short";
		},
		(pin: ProtocolVendorPinFixture) => {
			pin.shipped.status = "unknown";
		},
		(pin: ProtocolVendorPinFixture) => {
			pin.non_claims = [];
		},
	]) {
		const broken = clone(DIVERGED, isProtocolVendorPin);
		mutate(broken);
		expectCode("invalid_protocol_vendor_pin", { pin: broken, vendoredTree: broken.source.tree });
	}
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
				repoRoot: FIXTURE_ROOT,
				pin: DIVERGED,
				lock: LOCK,
				vendoredTree: DIVERGED.source.tree,
				vendoredDirty: [],
				vendoredHidden: [],
				requestTracked: true,
			}),
		(error) => {
			if (!isProtocolVendorPinError(error)) return false;
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
	const contradictory = clone(DIVERGED, isProtocolVendorPin);
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
	const identicalSubtree = clone(DIVERGED, isProtocolVendorPin);
	identicalSubtree.source.tree = LOCK.gateway.protocol_tree;
	identicalSubtree.shipped.protocol_tree = identicalSubtree.source.tree;
	const injected = {
		pin: identicalSubtree,
		lock: LOCK,
		vendoredTree: identicalSubtree.source.tree,
		vendoredDirty: [],
		vendoredHidden: [],
		requestTracked: true,
	};
	// It is a well-formed pin: `validateProtocolVendorPin` accepts it and reports
	// the divergence rather than rejecting the shape.
	assert.equal(validateProtocolVendorPin({ repoRoot: FIXTURE_ROOT, ...injected }).diverged, true);
	assert.throws(
		() => assertShippableProtocolVendorPin({ repoRoot: FIXTURE_ROOT, ...injected }),
		(error) => {
			if (!isProtocolVendorPinError(error)) return false;
			assert.equal(error.code, "proof_shipment_protocol_divergence");
			return true;
		},
	);
});
