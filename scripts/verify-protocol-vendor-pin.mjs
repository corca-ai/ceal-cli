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
//              `gateway-handoff-lock.json` binds a release to consume
//
// `source` vs `vendored` is the drift check. `source` vs `shipped` is the
// proof/ship divergence, which is a real state this lane cannot unilaterally
// resolve — so it is declarable rather than fatal, but the declaration is bound
// to the exact commits it was made about. Move either side and the declaration
// stops matching its own facts and the gate fails, which is the property a bare
// comment in a document does not have.

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
const LOCK_FILE = "gateway-handoff-lock.json";
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
export function validateProtocolVendorPin({ repoRoot = REPO_ROOT, pin, lock, vendoredTree, vendoredDirty, requestTracked } = {}) {
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

	const converged = candidate.shipped.protocol_tree === candidate.source.tree;
	if (candidate.shipped.status === "agreed" && !converged) {
		throw new ProtocolVendorPinError(
			"undeclared_divergence",
			"The pin claims the vendored and shipped protocol trees agree, but it records two different trees.",
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
	try {
		console.log(JSON.stringify(validateProtocolVendorPin(), null, 2));
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
