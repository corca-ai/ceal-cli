#!/usr/bin/env node

// `packages/ceal-protocol` is a frozen copy of a tree corca-ai/ceal owns, and
// until this script existed nothing in the repository recorded which Gateway
// commit it was copied from. That gap cost a session three separate times in one
// day: the copy blocked the policy renderer, it split what the gate tests from
// what a release ships, and a re-pull hours after a sync found it stale again.
// All three times `npm run check` was green, because a green gate said nothing
// about a directory whose only correctness claim is "identical to somewhere
// else".
//
// So the pin names three identities and this validator binds them together:
//
//   source   — the Gateway commit and protocol subtree this copy was taken from
//   vendored — what `packages/ceal-protocol` actually hashes to right now
//   shipped  — the protocol subtree inside the locked handoff archive that
//              `gateway-protocol-handoff-lock.json` binds a release to consume
//
// `source` vs `vendored` is the drift check, and it is fatal. `source` vs
// `shipped` is the proof/ship divergence, and it is fatal too: the Gateway owner
// ruled it ship-blocking for every worker release, acceptance packet, and claim
// that a green protocol test proves shipped worker behavior. A divergence may
// still be *declared*, which is what keeps `--development` motion legal, but a
// declaration is a quarantine rather than a clearance. It stays bound to the
// facts it was made about: re-sync the copy or bump the handoff lock and it
// stops matching them and the gate fails for that reason instead. That expiry is
// the property a comment in a document does not have.
//
// Read `docs/gates.md` before trusting this further than it goes. It reaches no
// remote, so it cannot see the copy falling behind its owner, and `source.commit`
// is a recorded observation nothing here confirms. `shipped.protocol_tree` used
// to be in that sentence too; the protocol-only handoff declares the producer's
// protocol subtree and the lock records it, so it is cross-checked below — which
// is a comparison of two local files, not a check against the archive.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codedErrorClass } from "./lib/coded-error.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PIN_PATH = "protocol-vendor-pin.json";
const SCHEMA = "ceal.protocol_vendor_pin.v1";
const VENDORED_PATH = "packages/ceal-protocol";
const SOURCE_REPOSITORY = "corca-ai/ceal";
const LOCK_FILE = "gateway-protocol-handoff-lock.json";
const REQUESTS_DIRECTORY = "docs/requests";
const STATUSES = new Set(["agreed", "diverged"]);

export const ProtocolVendorPinError = codedErrorClass("ProtocolVendorPinError");

/**
 * Validates the vendored protocol pin against the working tree and the Gateway
 * handoff lock. Reads local files, the Git index, and the working tree — the
 * working tree deliberately, because a committed tree hash cannot see a
 * mid-sync edit. It never fetches, installs, or contacts a remote.
 *
 * Every observed input is injectable so the falsification tests can drive the
 * failure branches without constructing a scratch Git repository per case.
 */
export function validateProtocolVendorPin({
	repoRoot = REPO_ROOT,
	pin,
	lock,
	vendoredTree,
	vendoredDirty,
	vendoredHidden,
	requestTracked,
} = {}) {
	const root = path.resolve(repoRoot);
	const candidate = pin ?? readJson(root, PIN_PATH, "invalid_protocol_vendor_pin");
	assertPinShape(candidate);

	const observedTree = vendoredTree ?? readVendoredTree(root, candidate.vendored_path);
	if (observedTree !== candidate.source.tree) {
		throw new ProtocolVendorPinError(
			"vendored_tree_mismatch",
			`${candidate.vendored_path} hashes to ${observedTree}, but the pin records ${candidate.source.tree}. ` +
				"Either the copy was edited, or a sync landed without updating protocol-vendor-pin.json.",
		);
	}

	// `git status` is not the whole story: `update-index --assume-unchanged` and
	// `--skip-worktree` tell Git to stop looking at a file, and it then reports a
	// modified frozen copy as clean while `HEAD:` still hashes to the pinned tree.
	// Both checks above therefore pass over an edited copy. Whoever set the bit
	// meant to, but the gate's answer has to describe the tree on disk rather than
	// the tree Git was told to pretend it sees.
	const hidden = vendoredHidden ?? readVendoredHidden(root, candidate.vendored_path);
	if (hidden.length > 0) {
		throw new ProtocolVendorPinError(
			"vendored_change_hidden",
			`${hidden.join(", ")} is marked assume-unchanged or skip-worktree, so Git would report an edited copy as clean. ` +
				`Clear it with \`git update-index --no-assume-unchanged --no-skip-worktree -- ${candidate.vendored_path}\`.`,
		);
	}

	// A committed tree hash cannot see an uncommitted edit, and an uncommitted
	// edit to a frozen copy is exactly the shape of drift this guards.
	const dirty = vendoredDirty ?? readVendoredDirty(root, candidate.vendored_path);
	if (dirty.length > 0) {
		throw new ProtocolVendorPinError(
			"vendored_worktree_dirty",
			`${candidate.vendored_path} has uncommitted changes (${dirty.join(", ")}); a frozen copy must match its recorded source exactly.`,
		);
	}

	const lockValue = lock ?? readJson(root, candidate.shipped.lock_file, "invalid_gateway_handoff_lock");
	const lockedCommit = lockValue?.gateway?.commit;
	if (lockedCommit !== candidate.shipped.gateway_commit) {
		throw new ProtocolVendorPinError(
			"shipped_lock_mismatch",
			`${candidate.shipped.lock_file} now binds Gateway commit ${lockedCommit}, but the pin was written about ` +
				`${candidate.shipped.gateway_commit}. Re-check the proof/ship state and update the pin.`,
		);
	}

	// The protocol-only handoff declares the producer's protocol subtree, so the
	// lock carries it and `shipped.protocol_tree` stopped being a field the pin
	// alone gets to write. Closing that is what removes the documented two-field
	// forgery: forging `source.tree` alone already failed, and forging
	// `shipped.protocol_tree` to match it used to pass. It cannot now, because the
	// lock disagrees — and the lock's value came from a signed archive.
	//
	// Required, not conditional. Skipping the check when the lock omits the field
	// would leave the forgery one deletion away: drop `gateway.protocol_tree` from
	// the lock and the pin gets the last word again, with the gate still green.
	// The pin's `shipped.lock_file` is constrained to the protocol handoff lock,
	// whose shape always carries this, so a lock without it is malformed rather
	// than an older variant to tolerate.
	const lockedProtocolTree = lockValue?.gateway?.protocol_tree;
	if (!isGitObject(lockedProtocolTree)) {
		throw new ProtocolVendorPinError(
			"invalid_gateway_handoff_lock",
			`${candidate.shipped.lock_file} does not bind a Gateway protocol subtree, so the pin's shipped.protocol_tree cannot be checked ` +
				"against anything. A lock this gate cannot read is not a lock it may pass over.",
		);
	}
	if (lockedProtocolTree !== candidate.shipped.protocol_tree) {
		throw new ProtocolVendorPinError(
			"shipped_lock_mismatch",
			`${candidate.shipped.lock_file} binds protocol subtree ${lockedProtocolTree}, but the pin records ` +
				`${candidate.shipped.protocol_tree}. The lock's value comes from the signed handoff, so the pin is the wrong one.`,
		);
	}

	// The divergence verdict is decided by `source.commit` against the lock's
	// `gateway.commit`, not by the pin's own two tree fields. Both trees are
	// author-written, so a verdict computed from them is a statement about the
	// pin rather than a check of anything; `lock.gateway.commit` is the one
	// identity here that the pin does not get to write. The residual limit is
	// honest and worth stating: `source.commit` is still self-recorded, so this
	// makes divergence detectable without making convergence observable.
	const converged = candidate.source.commit === lockedCommit;
	// The consistency check is deliberately one-directional. One Gateway commit
	// has exactly one `packages/ceal-protocol` subtree, so a pin naming the same
	// commit on both sides while recording two different trees is contradicting
	// itself and no reader could tell which half to believe.
	//
	// The reverse is NOT a contradiction and must not be treated as one: two
	// different Gateway commits can carry a byte-identical protocol subtree, and
	// a pin recording that is being honest. Rejecting it would have made the only
	// green pin one that records a false `source.commit` — the guard pressuring a
	// falsification of its own authoritative field. That state is still not
	// shippable, because the lock binds a different commit, but it fails as a
	// divergence rather than as a lying pin.
	if (converged && candidate.shipped.protocol_tree !== candidate.source.tree) {
		throw new ProtocolVendorPinError(
			"invalid_protocol_vendor_pin",
			`The pin names Gateway commit ${candidate.source.commit} on both sides but records two different protocol subtrees ` +
				`(source.tree ${candidate.source.tree}, shipped.protocol_tree ${candidate.shipped.protocol_tree}). One commit has one subtree.`,
		);
	}
	if (candidate.shipped.status === "agreed" && !converged) {
		throw new ProtocolVendorPinError(
			"undeclared_divergence",
			// Name the two values the verdict was actually computed from. This said
			// "two different trees" while `converged` compares commits, so a
			// maintainer whose tag it blocked was sent to compare two fields that
			// are equal in every pin this check passes.
			`The pin claims the vendored and shipped protocol identities agree, but it records two different Gateway commits ` +
				`(source.commit ${candidate.source.commit}, ${candidate.shipped.lock_file} gateway.commit ${lockedCommit}).`,
		);
	}
	if (candidate.shipped.status === "diverged") {
		if (converged) {
			throw new ProtocolVendorPinError(
				"stale_divergence_record",
				"The pin declares a proof/ship divergence that its own recorded trees say no longer exists; close the declaration.",
			);
		}
		// A declaration whose disposition request has been deleted or renamed is
		// no longer a pointer to an open question, just an excuse. Existence alone
		// is too weak a check: any path in the tree satisfies it, so a one-character
		// edit keeps a dead declaration alive by pointing it at README.md. It must
		// be a tracked file under the directory that actually holds requests.
		const request = candidate.shipped.disposition_request;
		if (!request.startsWith(`${REQUESTS_DIRECTORY}/`)) {
			throw new ProtocolVendorPinError(
				"stale_divergence_record",
				`A divergence disposition request must live under ${REQUESTS_DIRECTORY}/; ${request} is some other file.`,
			);
		}
		assertRegularFile(root, request, "stale_divergence_record");
		if (!(requestTracked ?? isTracked(root, request))) {
			throw new ProtocolVendorPinError(
				"stale_divergence_record",
				`${request} is not tracked in Git, so it is not a request anyone else can read.`,
			);
		}
	}

	return {
		schema_version: candidate.schema_version,
		vendored_path: candidate.vendored_path,
		source: { ...candidate.source },
		vendored: { tree: observedTree },
		shipped: { ...candidate.shipped },
		diverged: !converged,
		non_claims: candidate.non_claims,
	};
}

/**
 * The ship gate. `validateProtocolVendorPin` answers "is this pin internally
 * honest", which stays true of a correctly declared divergence — that is what
 * lets development continue on the synced decoder. This answers the different
 * question a release must ask: may these bytes be shipped at all.
 *
 * The Gateway owner's decision makes the divergence ship-blocking for every
 * worker release, installed-acceptance packet, and claim that a green protocol
 * test proves shipped worker behavior. A declaration is a quarantine, not a
 * clearance, so every one of those paths calls this rather than trusting that
 * some test command ran.
 */
export function assertShippableProtocolVendorPin(options = {}) {
	const result = validateProtocolVendorPin(options);
	if (!result.diverged) return result;
	throw new ProtocolVendorPinError(
		"proof_shipment_protocol_divergence",
		`The vendored protocol copy was taken from Gateway commit ${result.source.commit}, but ${result.shipped.lock_file} binds ` +
			`${result.shipped.gateway_commit} for shipment. What this repository tests is not what a release would ship, so this is ` +
			"not a releasable worker input. Consume a Gateway artifact whose lock and pin name the same commit, or stop at " +
			"development-only proof (`npm run check:protocol-dev`). This is refused even when the two commits carry a byte-identical " +
			"protocol subtree: nothing here can verify that claim, and the lock is what a release actually consumes.",
	);
}

function assertPinShape(pin) {
	if (!isRecord(pin) || pin.schema_version !== SCHEMA || pin.vendored_path !== VENDORED_PATH) {
		throw new ProtocolVendorPinError("invalid_protocol_vendor_pin", "Protocol vendor pin is missing or does not match its schema.");
	}
	const source = pin.source;
	if (
		!isRecord(source) ||
		source.repository !== SOURCE_REPOSITORY ||
		source.package_path !== VENDORED_PATH ||
		!isGitObject(source.commit) ||
		!isGitObject(source.tree)
	) {
		throw new ProtocolVendorPinError("invalid_protocol_vendor_pin", "Protocol vendor pin does not record a complete source identity.");
	}
	const shipped = pin.shipped;
	if (
		!isRecord(shipped) ||
		shipped.lock_file !== LOCK_FILE ||
		!STATUSES.has(shipped.status) ||
		!isGitObject(shipped.gateway_commit) ||
		!isGitObject(shipped.protocol_tree)
	) {
		throw new ProtocolVendorPinError("invalid_protocol_vendor_pin", "Protocol vendor pin does not record a complete shipped identity.");
	}
	// Only demanded for a divergence: an `agreed` pin has no open question to
	// point at, and requiring an owner there would invite a placeholder.
	if (
		shipped.status === "diverged" &&
		(!isNonEmptyString(shipped.reason) || !isNonEmptyString(shipped.disposition_owner) || !isNonEmptyString(shipped.disposition_request))
	) {
		throw new ProtocolVendorPinError(
			"invalid_protocol_vendor_pin",
			"A declared proof/ship divergence must name its reason, its disposition owner, and the request that asks for the disposition.",
		);
	}
	if (!Array.isArray(pin.non_claims) || pin.non_claims.length === 0 || !pin.non_claims.every(isNonEmptyString)) {
		throw new ProtocolVendorPinError("invalid_protocol_vendor_pin", "Protocol vendor pin must carry its non-claims.");
	}
}

function readVendoredTree(root, vendoredPath) {
	return git(root, ["rev-parse", `HEAD:${vendoredPath}`], "the vendored protocol tree hash");
}

// `git ls-files -v` prefixes each path with its index state. A lowercase letter
// means assume-unchanged; `S` means skip-worktree. Anything else is a file Git is
// still watching.
function readVendoredHidden(root, vendoredPath) {
	return git(root, ["ls-files", "-v", "--", vendoredPath], "the vendored protocol index flags")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => {
			const marker = line[0];
			return marker === "S" || (marker >= "a" && marker <= "z");
		})
		.map((line) => line.slice(1).trim());
}

function readVendoredDirty(root, vendoredPath) {
	return git(root, ["status", "--porcelain", "--", vendoredPath], "the vendored protocol worktree status")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

function isTracked(root, relativePath) {
	try {
		execFileSync("git", ["ls-files", "--error-unmatch", "--", relativePath], { cwd: root, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

// Deliberately not "this needs a Git work tree": a work tree with no commits yet
// fails here too, and blaming the wrong thing sends the reader looking for a
// missing repository that is right in front of them.
function git(root, args, what) {
	try {
		return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		throw new ProtocolVendorPinError(
			"git_identity_failed",
			`Git could not report ${what}. This check needs a Git work tree with at least one commit, run from the repository that owns ${VENDORED_PATH}.`,
		);
	}
}

function readJson(root, relativePath, code) {
	const file = assertRegularFile(root, relativePath, code);
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		throw new ProtocolVendorPinError(code, `${relativePath} is not valid JSON.`);
	}
}

function assertRegularFile(root, relativePath, code) {
	if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath)) {
		throw new ProtocolVendorPinError(code, "Protocol vendor pin paths must be non-empty relative paths.");
	}
	const target = path.resolve(root, relativePath);
	if (!target.startsWith(`${root}${path.sep}`))
		throw new ProtocolVendorPinError(code, "Protocol vendor pin path escaped the repository root.");
	const stat = existsSync(target) ? lstatSync(target) : null;
	if (!stat?.isFile() || stat.isSymbolicLink())
		throw new ProtocolVendorPinError(code, `${relativePath} must be a regular non-symlink file.`);
	return target;
}

function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isGitObject(value) {
	return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}
function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	// `--development` is the escape hatch the owner decision asks for, and it is
	// deliberately not the default: a bare run is the ship gate. It reports the
	// same pin without the shippability assertion, and says in its own output
	// that it proves nothing about a release or an installed worker, so the
	// answer cannot be pasted somewhere as evidence that it is not.
	const development = process.argv.slice(2).includes("--development");
	try {
		const result = development ? validateProtocolVendorPin() : assertShippableProtocolVendorPin();
		console.log(
			JSON.stringify(
				development
					? {
							...result,
							proof_level: "development_only",
							non_claims: [
								...result.non_claims,
								"This is development-only protocol proof. It is not release proof, not installed-worker proof, and must not be used by a release, acceptance, or announcement path.",
							],
						}
					: result,
				null,
				2,
			),
		);
	} catch (error) {
		console.error(
			JSON.stringify({
				schema_version: "ceal.protocol_vendor_pin_error.v1",
				ok: false,
				error_code: error instanceof ProtocolVendorPinError ? error.code : "protocol_vendor_pin_verification_failed",
				message: error.message,
			}),
		);
		process.exitCode = 2;
	}
}
