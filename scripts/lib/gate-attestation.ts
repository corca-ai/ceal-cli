// The receipt `npm run check` writes for itself, and the only thing that lets a
// later site skip it.
//
// One worker release used to pay for the ~640s full gate seven times: once in
// the pre-push hook, twice in `check.yml`, twice in a release dry run, twice in
// the real tag run. Six of those seven prove the same commit, and re-proving an
// unchanged tree is a repeat, not evidence. What made the repeat unavoidable was
// that a green gate left nothing behind: the next site had no way to ask "has
// this exact source already passed this exact gate on a runner like me?".
//
// So the gate leaves a receipt. `postcheck` in package.json writes it, which is
// deliberate — the receipt is produced BY the gate rather than by a step beside
// it, so there is no arrangement in which a receipt exists and the gate did not
// run to completion.
//
// What the record binds, and why each field is load-bearing:
//
//   - `commit` / `tree`: the source. `tree` is the whole tree of HEAD, unscoped;
//     a scoped hash would need a list of what does not matter, and that list is
//     exactly the kind of thing that goes stale silently.
//   - `profile` / `jobs`: WHICH gate. `check` and `check:unit` are different
//     proofs, and `jobs` is the resolved `&&` chain, so a phase added to or
//     removed from the chain is visible in the receipt rather than only in the
//     tree hash.
//   - `runner_identity`: `ceal-v0.66.0` burned on a break that appears on macOS
//     and not on Linux. A green ubuntu gate is not evidence about a macOS
//     runner, so a receipt is only reusable by the identity that earned it.
//   - `node_version`: `check.yml` pins Node through `.nvmrc` and
//     `ceal-release.yml` pins a literal. `repo-gates.test.ts` asserts they
//     agree, so this is belt to that gate's braces — but the gate is a source
//     assertion and this is what the runner actually resolved.
//   - `pass_fail_env`: `CEAL_REQUIRE_PLATFORM_PROOFS` turns a correct skip into
//     a hard failure, so the same command with it off is a strictly weaker
//     proof and must not satisfy a site that wants it on.
//   - `install_fingerprint`: the tree carries `package-lock.json`, which is what
//     the install was asked for, not what is on disk. The 2026-08-08 lockfile
//     incident is the shape: a lock can name a toolchain a `node_modules` does
//     not have.
//
// Comparison is exact equality on every field. There is no stronger-covers-weaker
// rule here: Gateway has one and it is sanctioned there, but it exists to relate
// two profiles whose coverage relationship somebody proved. Adding one here would
// mean arguing that relationship for every pair, and the whole win of this slice
// comes from the `check` -> `check` case, which needs no such argument.
//
// There is deliberately no TTL. Gateway's attestation expires because it covers a
// working tree that may be dirty; this one refuses a dirty checkout outright and
// binds the installed dependency set, so age adds no information a field does not
// already carry. A clock is not free — an expiry turns a correct reuse into a
// re-run for reasons the operator cannot see in a diff.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/** @testOnly the record carries it; only the shape gate reads it back. */
export const GATE_ATTESTATION_SCHEMA = "ceal.gate_attestation.v1";
export const GATE_ATTESTATION_PATH = ".charness/quality/gate-attestation.json";
export const ATTESTATION_ARTIFACT_PREFIX = "ceal-gate-attestation-";
/** @testOnly production reads it through `resolveRunnerIdentity`. */
export const RUNNER_IDENTITY_ENV = "CEAL_GATE_RUNNER_IDENTITY";
export const ATTESTED_PROFILE = "check";
const INSTALL_FINGERPRINT_FILE = "node_modules/.package-lock.json";

/**
 * Environment that changes what the gate proves rather than how fast it runs.
 * A key here must be one whose value can turn a passing run into a failing one
 * on identical source; `test/contract/repo-gates.test.ts` holds the workflow
 * gate steps to declaring nothing outside this list.
 *
 * @testOnly production reads it through `buildGateAttestation`.
 */
export const PASS_FAIL_ENV_KEYS = ["CEAL_REQUIRE_PLATFORM_PROOFS"];

/** Diagnostics only, so it is excluded from the identity the digest names. */
const DIGEST_EXCLUDED_KEYS = ["created_at"];

export type GateAttestation = {
	readonly schema: string;
	readonly created_at?: string;
	readonly commit: string;
	readonly tree: string;
	readonly profile: string;
	readonly jobs: readonly string[];
	readonly runner_identity: string;
	readonly node_version: string;
	readonly pass_fail_env: Readonly<Record<string, string | null>>;
	readonly install_fingerprint: string | null;
};

export type GateAttestationResult =
	| { readonly ok: true; readonly reason: null; readonly detail: null; readonly attestation: GateAttestation }
	| { readonly ok: false; readonly reason: string; readonly detail: string; readonly attestation: null };

type ExecFile = typeof execFileSync;

export interface GateAttestationOptions {
	readonly repoRoot: string;
	readonly profile?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: Date;
	readonly execFile?: ExecFile;
}

/**
 * Key-sorted JSON, so two records that say the same thing digest the same
 * however their producers happened to order the fields.
 */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
		return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function withoutDiagnostics(attestation: GateAttestation): Record<string, unknown> {
	return Object.fromEntries(Object.entries(attestation).filter(([key]) => !DIGEST_EXCLUDED_KEYS.includes(key)));
}

/** @testOnly production names the artifact through `attestationArtifactName`. */
export function attestationDigest(attestation: GateAttestation): string {
	return createHash("sha256")
		.update(canonical(withoutDiagnostics(attestation)))
		.digest("hex");
}

/**
 * The artifact name IS the comparison. A consumer computes the record it wants
 * and looks for an artifact carrying that record's digest, so a single field
 * that differs makes the name miss — which is the fail-closed direction, and it
 * costs no artifact download and no zip reader to get there.
 */
export function attestationArtifactName(attestation: GateAttestation): string {
	return `${ATTESTATION_ARTIFACT_PREFIX}${attestationDigest(attestation)}`;
}

/**
 * CI declares its own identity so the two lanes can agree on one string; a local
 * host names itself, and can therefore never collide with a runner label.
 *
 * @testOnly production reaches it through `buildGateAttestation`.
 */
export function resolveRunnerIdentity(env: NodeJS.ProcessEnv = process.env): string {
	const declared = (env[RUNNER_IDENTITY_ENV] ?? "").trim();
	return declared.length > 0 ? declared : `local:${os.platform()}-${os.arch()}`;
}

function readManifestScripts(repoRoot: string): Record<string, string> {
	const manifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> };
	return manifest.scripts ?? {};
}

/**
 * The gate's phases as the shell would run them. Shallow on purpose: every
 * phase resolves to an npm script whose text lives in `package.json`, which is
 * inside the tree the record already binds, so recursing would restate the tree
 * hash in a longer form.
 *
 * @testOnly production reaches it through `buildGateAttestation`.
 */
export function resolveGateJobs(repoRoot: string, profile: string): string[] {
	const script = readManifestScripts(repoRoot)[profile];
	if (typeof script !== "string") return [];
	return script
		.split("&&")
		.map((phase) => phase.trim())
		.filter(Boolean);
}

function gitRaw(repoRoot: string, args: readonly string[], execFile: ExecFile): string {
	return String(execFile("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

function git(repoRoot: string, args: readonly string[], execFile: ExecFile): string {
	return gitRaw(repoRoot, args, execFile).trim();
}

export interface GateSourceState {
	readonly commit: string;
	readonly tree: string;
	readonly dirtyPaths: readonly string[];
}

/** @testOnly production reaches it through `buildGateAttestation`. */
export function readGateSourceState(repoRoot: string, execFile: ExecFile = execFileSync): GateSourceState {
	// `--untracked-files=all` and no `--ignored`: build output and `.charness/`
	// are gitignored, so the gate's own artifacts do not read as drift, while a
	// stray untracked source file does.
	//
	// Read raw and stripped only at the end. A porcelain line is `XY PATH`, and
	// the unstaged-modification code is ` M`, so trimming the whole block eats the
	// leading space of the FIRST line and every path it names loses a character.
	const status = gitRaw(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"], execFile).replace(/\n$/u, "");
	return {
		commit: git(repoRoot, ["rev-parse", "HEAD"], execFile),
		tree: git(repoRoot, ["rev-parse", "HEAD^{tree}"], execFile),
		dirtyPaths: status.length === 0 ? [] : status.split("\n").map((line) => line.slice(3)),
	};
}

function readInstallFingerprint(repoRoot: string): string | null {
	const installed = path.join(repoRoot, INSTALL_FINGERPRINT_FILE);
	if (!existsSync(installed)) return null;
	return createHash("sha256").update(readFileSync(installed)).digest("hex");
}

/**
 * The record this checkout would earn by running `profile` right now. Refuses
 * rather than guesses: a dirty checkout has no tree hash that describes what
 * was proven, and an unknown profile has no phase list.
 */
export function buildGateAttestation(options: GateAttestationOptions): GateAttestationResult {
	const { repoRoot, profile = ATTESTED_PROFILE, env = process.env, now = new Date(), execFile = execFileSync } = options;
	const jobs = resolveGateJobs(repoRoot, profile);
	if (jobs.length === 0) {
		return { ok: false, reason: "unknown_profile", detail: `package.json declares no ${profile} script`, attestation: null };
	}
	const state = readGateSourceState(repoRoot, execFile);
	if (state.dirtyPaths.length > 0) {
		return {
			ok: false,
			reason: "dirty_checkout",
			detail: `${state.dirtyPaths.length} path(s) differ from HEAD, starting with ${state.dirtyPaths.slice(0, 3).join(", ")}`,
			attestation: null,
		};
	}
	return {
		ok: true,
		reason: null,
		detail: null,
		attestation: {
			schema: GATE_ATTESTATION_SCHEMA,
			created_at: now.toISOString(),
			commit: state.commit,
			tree: state.tree,
			profile,
			jobs,
			runner_identity: resolveRunnerIdentity(env),
			node_version: process.version,
			pass_fail_env: Object.fromEntries(PASS_FAIL_ENV_KEYS.map((key) => [key, env[key] ?? null])),
			install_fingerprint: readInstallFingerprint(repoRoot),
		},
	};
}

/**
 * Every field of `expected` that `attested` does not match, named. A reader who
 * lost a reuse needs to know which field cost it — "no attestation matched" sends
 * them to read three files, and the answer is almost always one line.
 */
export function gateAttestationDifferences(expected: GateAttestation, attested: unknown): string[] {
	if (attested === null || typeof attested !== "object" || Array.isArray(attested)) {
		return [`the attestation is ${attested === null ? "null" : typeof attested}, not a record`];
	}
	const actual = attested as Record<string, unknown>;
	const differences: string[] = [];
	for (const [key, value] of Object.entries(withoutDiagnostics(expected))) {
		if (canonical(value) !== canonical(actual[key])) {
			differences.push(`${key}: this run wants ${canonical(value)}, the attestation carries ${canonical(actual[key])}`);
		}
	}
	for (const key of Object.keys(actual)) {
		if (!DIGEST_EXCLUDED_KEYS.includes(key) && !(key in expected)) {
			differences.push(`${key}: the attestation carries a field this run does not know, so it was written by a different producer`);
		}
	}
	return differences;
}

export function readGateAttestationFile(filePath: string): { ok: boolean; reason: string | null; attestation: unknown } {
	if (!existsSync(filePath)) return { ok: false, reason: "missing_attestation", attestation: null };
	try {
		return { ok: true, reason: null, attestation: JSON.parse(readFileSync(filePath, "utf8")) as unknown };
	} catch {
		return { ok: false, reason: "unreadable_attestation", attestation: null };
	}
}

export function serializeGateAttestation(attestation: GateAttestation): string {
	return `${JSON.stringify(attestation, null, "\t")}\n`;
}
