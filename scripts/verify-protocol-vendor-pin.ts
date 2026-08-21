#!/usr/bin/env node

// This file used to bind three identities because the Protocol arrived here as an
// EDITABLE SOURCE TREE under `packages/ceal-protocol`, and a directory whose only
// correctness claim is "identical to somewhere else" needs constant policing:
//
//   source   — the Gateway commit and protocol subtree the copy was taken from
//   vendored — what `packages/ceal-protocol` actually hashed to right now
//   shipped  — the protocol subtree inside the locked handoff archive
//
// Policing it did not work. `a8b3b96` edited the copy to satisfy this repository's
// own `noUncheckedIndexedAccess` ratchet — which swept a frozen tree in as authored
// source — and in doing so forked `compareProtocolVersions` so that ragged version
// arrays compared EQUAL here and by `?? 0` upstream. Two protocol negotiators, one
// package name. The gate that would have refused it ran three tiers later, and the
// pin sat red in every mode until this change.
//
// So the copy is gone. The Protocol now arrives as `vendor/ceal-protocol/*.tgz`:
// the exact signed artifact `gateway-protocol-handoff-lock.json` binds, installed
// through `npm` by digest, carrying `dist` and `conformance` and no `src` at all.
// What this file checks collapses accordingly, and the collapse is the point:
//
//   * There is no `source` vs `vendored` drift, because there is no second copy to
//     drift. The bytes on disk are the published bytes or the digest disagrees.
//   * There is no `vendored` vs `shipped` divergence, because what this repository
//     tests IS what a release ships — the same archive, not a re-compilation of a
//     tree that was once equal to it. `proof_shipment_protocol_divergence` is
//     therefore unreachable rather than merely unobserved, and the `--development`
//     escape hatch it justified is no longer a different answer.
//   * `assume-unchanged`, `skip-worktree` and uncommitted-edit checks are gone. A
//     content digest already answers what all three approximated, and answers it
//     about the bytes rather than about what Git was told to believe.
//   * But a digest over the working tree is silent on whether the working tree IS
//     the repository, and that turned out to matter. `vendored_change_hidden` looked
//     like it was about `assume-unchanged` and `skip-worktree`; its real subject was
//     "Git has been told to believe something untrue about these bytes", and
//     `.gitignore` is a third route to that state and the strongest one — it makes
//     the file invisible rather than merely stale. This repository ignores `*.tgz`
//     for `npm pack` output, a slash-free pattern matches at any depth, and the
//     first version of this cutover therefore left the archive untracked with every
//     local gate green. So one index question survives, below.
//
// The pin FILE is gone too. Every identity it recorded — producer commit, protocol
// subtree, artifact digest, filename — is in the handoff lock, which came from the
// signed archive rather than from an author. A second file restating them could
// only ever agree or lie.
//
// Read `docs/gates.md` before trusting this further than it goes. It reaches no
// remote: it proves that the artifact in `vendor/` is the one the lock names, not
// that the lock still matches a live corca-ai/ceal.

import { codedErrorClass } from "./lib/coded-error.ts";
import { isGitObject } from "./lib/git-object.ts";
import { isObjectRecord } from "./lib/package-bin.ts";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_FILE = "gateway-protocol-handoff-lock.json";
const VENDOR_DIRECTORY = "vendor/ceal-protocol";
const PROTOCOL_PACKAGE = "@corca-ai/ceal-protocol";
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

interface GatewayHandoffLock {
	readonly gateway?: { readonly commit?: unknown; readonly protocol_tree?: unknown };
	readonly protocol?: { readonly package?: unknown; readonly version?: unknown; readonly filename?: unknown; readonly sha256?: unknown };
}

interface ValidateProtocolVendorPinOptions {
	readonly repoRoot?: string;
	readonly lock?: GatewayHandoffLock;
	/** Injected so the falsification tests need no scratch tarball on disk. */
	readonly artifactSha256?: string;
	/** Injected so fixtures on a scratch root need not be Git work trees. */
	readonly tracked?: boolean;
}

interface ProtocolVendorPinValidationResult {
	readonly schema_version: "ceal.protocol_vendor_artifact.v1";
	readonly source: { readonly repository: "corca-ai/ceal"; readonly commit: string; readonly protocol_tree: string };
	readonly vendored: { readonly path: string; readonly sha256: string };
	readonly shipped: { readonly lock_file: typeof LOCK_FILE; readonly package: string; readonly version: string; readonly filename: string };
	readonly non_claims: readonly string[];
}

export const ProtocolVendorPinError = codedErrorClass("ProtocolVendorPinError");

/**
 * Proves that the vendored Protocol artifact is the exact archive the Gateway
 * handoff lock binds. Reads two local files and hashes one of them; it never
 * fetches, installs, or contacts a remote.
 */
export function validateProtocolVendorPin({
	repoRoot = REPO_ROOT,
	lock,
	artifactSha256,
	tracked,
}: ValidateProtocolVendorPinOptions = {}): ProtocolVendorPinValidationResult {
	const root = path.resolve(repoRoot);
	const lockValue = lock ?? readJson<GatewayHandoffLock>(root, LOCK_FILE, "invalid_gateway_handoff_lock");
	const protocol = lockValue?.protocol;
	if (
		!isObjectRecord(protocol) ||
		protocol.package !== PROTOCOL_PACKAGE ||
		!isSemanticVersion(protocol.version) ||
		protocol.filename !== `corca-ai-ceal-protocol-${protocol.version}.tgz` ||
		!isSha256(protocol.sha256)
	) {
		throw new ProtocolVendorPinError(
			"invalid_gateway_handoff_lock",
			`${LOCK_FILE} does not bind a complete ${PROTOCOL_PACKAGE} artifact identity, so there is nothing to check the vendored archive against. ` +
				"A lock this gate cannot read is not a lock it may pass over.",
		);
	}

	// Required, not conditional, and read from the lock rather than from any
	// author-writable file. These are the producer identities a release quotes; if
	// the lock omits them the quote would be unsourced.
	const gateway = lockValue?.gateway;
	if (!isGitObject(gateway?.commit) || !isGitObject(gateway?.protocol_tree)) {
		throw new ProtocolVendorPinError(
			"invalid_gateway_handoff_lock",
			`${LOCK_FILE} does not bind the producing Gateway commit and protocol subtree.`,
		);
	}

	const vendoredPath = `${VENDOR_DIRECTORY}/${protocol.filename}`;
	const observed = artifactSha256 ?? sha256File(assertRegularFile(root, vendoredPath, "vendored_artifact_missing"));
	if (observed !== protocol.sha256) {
		throw new ProtocolVendorPinError(
			"vendored_artifact_mismatch",
			`${vendoredPath} hashes to ${observed}, but ${LOCK_FILE} binds ${protocol.sha256}. ` +
				"The vendored archive is not the signed artifact this repository consumes. Re-acquire it with " +
				"`npm run bootstrap:gateway-handoff -- --tag <tag>` rather than editing either file.",
		);
	}

	// The one question a digest cannot answer: are these bytes IN the repository? An
	// untracked archive passes every check above and gives a clone nothing, which is
	// not hypothetical — it is the state this cutover was in until a reviewer read
	// `.gitignore`. Checked after the digest so that wrong bytes still report as wrong
	// bytes rather than as a bookkeeping problem.
	if (!(tracked ?? isTrackedInGit(root, vendoredPath))) {
		throw new ProtocolVendorPinError(
			"vendored_artifact_untracked",
			`${vendoredPath} is not tracked by Git, so a clone of this branch would have no Protocol at all and` +
				" 'npm ci' would fail on the 'file:' dependency before any gate ran. Look for a .gitignore pattern that " +
				"swallows it — '*.tgz' matches at any depth — rather than forcing the add.",
		);
	}

	return {
		schema_version: "ceal.protocol_vendor_artifact.v1",
		source: { repository: "corca-ai/ceal", commit: gateway.commit, protocol_tree: gateway.protocol_tree },
		vendored: { path: vendoredPath, sha256: observed },
		shipped: { lock_file: LOCK_FILE, package: protocol.package, version: protocol.version, filename: protocol.filename },
		non_claims: [
			"This binds local bytes to a local lock; it does not fetch, verify a signature, or prove anything about the live corca-ai/ceal remote.",
			"The lock's own identities were established when the handoff was bootstrapped and signature-verified; this gate re-reads them rather than re-proving them.",
			"Agreement is an artifact identity. It is not by itself a Worker package, native artifact, installation, or live Gateway action proof.",
		],
	};
}

/**
 * The ship gate, kept as a distinct entry point because three release scripts call
 * it by this name -- `worker-release-inputs.ts`, `worker-acceptance-packet.ts` and
 * `build-worker-release-assets.ts` -- and a release must ask its own question rather
 * than trust that some check ran.
 *
 * It no longer has a second question to ask. While the Protocol was a source copy,
 * "is this pin honest" and "may these bytes ship" could differ, and a declared
 * divergence was a quarantine rather than a clearance. Consuming the signed archive
 * directly collapses the two: the artifact that passes above IS the artifact a
 * release consumes.
 *
 * The result no longer carries a `diverged` field. It was kept for one revision on
 * the stated grounds that release paths read it; they do not — all three call this
 * and discard the result. Its type was the literal `false`, so the assertions over it
 * could not fail and were guaranteed by the compiler rather than by behaviour. A
 * field nothing reads, whose only possible value is asserted by three tests that
 * cannot go red, is scaffolding.
 */
export function assertShippableProtocolVendorPin(options: ValidateProtocolVendorPinOptions = {}): ProtocolVendorPinValidationResult {
	return validateProtocolVendorPin(options);
}

// `--error-unmatch` makes an untracked path an error rather than empty output, so
// the verdict is an exit status and not a string comparison. A repoRoot that is not a
// Git work tree at all also lands here as "not tracked", which is the honest answer
// for a gate whose whole question is what a clone would receive.
function isTrackedInGit(root: string, relativePath: string): boolean {
	try {
		execFileSync("git", ["ls-files", "--error-unmatch", "--", relativePath], { cwd: root, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function sha256File(file: string): string {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readJson<T>(root: string, relativePath: string, code: string): T {
	const file = assertRegularFile(root, relativePath, code);
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		throw new ProtocolVendorPinError(code, `${relativePath} is not valid JSON.`);
	}
}

function assertRegularFile(root: string, relativePath: string, code: string): string {
	const target = path.resolve(root, relativePath);
	if (!target.startsWith(`${root}${path.sep}`)) throw new ProtocolVendorPinError(code, "Protocol artifact path escaped the repository root.");
	// `lstatSync` does not follow the link, so a symlink already fails `isFile()` and
	// the check needs no second operand. An earlier `|| stat.isSymbolicLink()` here
	// could never evaluate true, which made the test named for it exercise the
	// not-a-regular-file branch instead.
	const stat = existsSync(target) ? lstatSync(target) : null;
	if (!stat?.isFile()) throw new ProtocolVendorPinError(code, `${relativePath} must be a regular non-symlink file.`);
	return target;
}

// Every sibling that reads this field requires semver. Accepting any non-empty
// string here let `version: "../../x"` build a filename that the containment check
// then refused as a path escape — fail-closed, but reported under
// `vendored_artifact_missing` with an escape message, which sends the reader looking
// for the wrong defect.
function isSemanticVersion(value: unknown): value is string {
	return typeof value === "string" && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(value);
}

function isSha256(value: unknown): value is string {
	return typeof value === "string" && SHA256_PATTERN.test(value);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	// `--development` is accepted and deliberately does nothing different. It stays
	// so the documented command and the operator habit keep working, and so the
	// output SAYS why there is no longer a weaker mode to fall back to.
	const development = process.argv.slice(2).includes("--development");
	try {
		const result = assertShippableProtocolVendorPin();
		console.log(
			JSON.stringify(
				development
					? {
							...result,
							proof_level: "same_as_release",
							non_claims: [
								...result.non_claims,
								"`--development` no longer selects a weaker check. The vendored artifact is the shipped artifact, so there is no proof/ship divergence for a development mode to tolerate.",
							],
						}
					: result,
				null,
				2,
			),
		);
	} catch (error: unknown) {
		console.error(
			JSON.stringify({
				schema_version: "ceal.protocol_vendor_pin_error.v1",
				ok: false,
				error_code: error instanceof ProtocolVendorPinError ? error.code : "protocol_vendor_pin_verification_failed",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		process.exitCode = 2;
	}
}
