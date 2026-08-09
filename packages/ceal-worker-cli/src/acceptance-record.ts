// Installed-client acceptance record, emitted by the installed release itself.
//
// `scripts/worker-acceptance-packet.mjs` answers the same question from a source
// checkout, and that is exactly its limit: the Gateway lane's ingress contract
// refuses a source checkout as an input, and a colleague on a fresh machine has
// no checkout to run it from. So the evidence a real installation can return had
// to be cloned out of the repository first, which made "can an ordinary user
// produce this" a different question from "does the release work".
//
// This module closes that gap by measuring the running binary instead of a
// named one. There is no `--binary` here on purpose: the artifact under
// examination is the one executing, so a substitution has nothing to substitute.
//
// What it deliberately does NOT do is call a provider. A verification command
// that performs a real provider action as a side effect is how an "evidence
// run" becomes an unlogged write; the bounded call stays `ceal call`, and this
// command reads back the receipt of one that already happened.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MANIFEST_PREFIX = "ceal-worker-release-manifest-";
const SUMS_NAME = "SHA256SUMS";
const RELEASE_MANIFEST_SCHEMA = "ceal.worker_release_manifest.v1";

interface CealInstalledReleaseFacts {
	platform: unknown;
	release_version: unknown;
	artifact_sha256: string;
	artifact_state: unknown;
	manifest: string;
	digest_agreement: "binary_bytes_manifest_and_sha256sums_agree";
	protocol: unknown;
}

export type CealInstalledReleaseReading = { ok: true; facts: CealInstalledReleaseFacts } | { ok: false; code: string; message: string };

/**
 * Read the release layout beside the running binary and require its three
 * independent statements to agree: the bytes on disk, the manifest's declared
 * artifact digest, and the `SHA256SUMS` line for that filename. Any one of them
 * alone is a self-report, which is why none of them is trusted by itself.
 *
 * A failure here is a refusal rather than a weaker row. The whole value of this
 * record is that it describes an installed release; a partially-verified one
 * would still read as evidence to whoever receives it.
 */
export function readInstalledReleaseFacts(binaryPath: string): CealInstalledReleaseReading {
	const directory = path.dirname(binaryPath);
	let entries: readonly string[];
	try {
		entries = readdirSync(directory);
	} catch {
		return { ok: false, code: "release_layout_unreadable", message: `Cannot read the directory beside ${binaryPath}.` };
	}
	const manifestName = entries.find((name) => name.startsWith(MANIFEST_PREFIX) && name.endsWith(".json"));
	if (!manifestName) {
		return {
			ok: false,
			code: "release_manifest_missing",
			// Names the likely cause rather than only the symptom: running the CLI
			// from a build tree is the ordinary way to reach this, and it is not an
			// installed release no matter how current the bytes are.
			message: `No ${MANIFEST_PREFIX}*.json beside the running binary; this is not an installed release layout.`,
		};
	}
	let manifest: Record<string, unknown>;
	try {
		manifest = JSON.parse(readFileSync(path.join(directory, manifestName), "utf8")) as Record<string, unknown>;
	} catch {
		return { ok: false, code: "release_manifest_unreadable", message: `${manifestName} is not readable JSON.` };
	}
	if (manifest.schema_version !== RELEASE_MANIFEST_SCHEMA) {
		return { ok: false, code: "release_manifest_schema", message: `Unexpected release manifest schema: ${String(manifest.schema_version)}` };
	}
	let observed: string;
	try {
		observed = createHash("sha256").update(readFileSync(binaryPath)).digest("hex");
	} catch {
		return { ok: false, code: "artifact_unreadable", message: `Cannot read the running binary at ${binaryPath}.` };
	}
	const artifact = manifest.artifact as { sha256?: unknown } | undefined;
	if (observed !== artifact?.sha256) {
		return {
			ok: false,
			code: "artifact_digest_mismatch",
			message: `Installed bytes ${observed} do not match the manifest's ${String(artifact?.sha256)}.`,
		};
	}
	const sumsPath = path.join(directory, SUMS_NAME);
	if (!existsSync(sumsPath)) return { ok: false, code: "checksums_missing", message: `No ${SUMS_NAME} beside the running binary.` };
	const declared = readChecksum(sumsPath, path.basename(binaryPath));
	if (declared === undefined) {
		return { ok: false, code: "checksums_entry_missing", message: `${SUMS_NAME} has no line for ${path.basename(binaryPath)}.` };
	}
	if (declared !== observed) {
		return {
			ok: false,
			code: "checksums_mismatch",
			message: `${SUMS_NAME} declares ${declared} for the running binary but its bytes are ${observed}.`,
		};
	}
	return {
		ok: true,
		facts: {
			platform: manifest.platform,
			release_version: manifest.version,
			artifact_sha256: observed,
			artifact_state: manifest.artifact_state,
			manifest: manifestName,
			digest_agreement: "binary_bytes_manifest_and_sha256sums_agree",
			protocol: manifest.protocol,
		},
	};
}

function readChecksum(file: string, name: string): string | undefined {
	for (const line of readFileSync(file, "utf8").split("\n")) {
		const match = /^([0-9a-f]{64}) {2}(\S+)$/u.exec(line.trim());
		if (match && match[2] === name) return match[1];
	}
	return undefined;
}

/**
 * The one declaration of what a `bounded_capability_call` row may contain, and
 * of what its receipt may contain.
 *
 * Two emitters answer this schema — this module for the installed binary, and
 * `scripts/worker-acceptance-packet.mjs` from a checkout — and they cannot share
 * an implementation: one holds decoded Gateway events, the other only the
 * installed binary's rendered stdout, and making the script import this package
 * would give a script that deliberately needs no build a build dependency. So
 * the field lists live here and `test/contract/worker-acceptance-packet.test.mjs`
 * binds the script's output to them. Until this existed the two emitters
 * declared one schema version while carrying different field sets.
 *
 * @testOnly The values are used by `projectBoundedCall` below; the export exists
 * so the contract test asserts against this declaration rather than a copy.
 */
export const CEAL_ACCEPTANCE_BOUNDED_CALL_KEYS = Object.freeze([
	"capability",
	"target",
	"status",
	"exit_code",
	"elapsed_ms",
	"evidence",
	"request_ref",
	"receipt",
] as const);

/**
 * Refs only. The Gateway audit event carries `membership_ref`, `subject_ref`,
 * `registration_ref`, `client_ref` and a grant snapshot, and this record leaves
 * the machine — a released record under `docs/acceptance/ceal-v0.69.0/` shows
 * two of those because the installed emitter used to ship the raw event.
 *
 * @testOnly Same reason as the list above.
 */
export const CEAL_ACCEPTANCE_RECEIPT_KEYS = Object.freeze([
	"readback_status",
	"outcome",
	"authorization",
	"audit_refs",
	"gateway_elapsed_ms",
	"exit_code",
	"elapsed_ms",
] as const);

export interface CealAcceptanceBoundedCall {
	capability: unknown;
	target: unknown;
	status: unknown;
	exit_code: number | null;
	elapsed_ms: number | null;
	evidence: unknown;
	request_ref: unknown;
	receipt: Record<string, unknown> | null;
}

export interface CealAcceptanceRecordParts {
	release: CealInstalledReleaseFacts;
	reportedVersion: unknown;
	clientProtocolVersion: unknown;
	guide: { status: unknown; registered_host_count: number };
	session: {
		instance_ref: unknown;
		profile_ref: unknown;
		negotiated_protocol_version: unknown;
		host_decision: unknown;
		catalog_source: unknown;
		capability_count: number;
		elapsed_ms: number;
	};
	boundedCall: CealAcceptanceBoundedCall | null;
}

/**
 * Assemble the external record.
 *
 * Every field is written explicitly rather than spread from a wider object.
 * The same allow-list discipline the announcement policy renderer uses applies
 * for the same reason: this document leaves the machine, so a field added
 * upstream must not travel by default because nobody remembered to strip it.
 * In particular the emitting host's own paths are never assembled in at all,
 * rather than assembled and then removed.
 */
export function buildAcceptanceRecord(parts: CealAcceptanceRecordParts): Record<string, unknown> {
	const { release, session } = parts;
	return {
		// Written as a literal on purpose. The gate that proves every declared
		// result schema is actually emitted scans the source text for
		// `schema_version: "..."` (`test/cli.test.mjs:338`), so routing this
		// through a constant would pass `tsc` and fail that gate. A constant no
		// emitter may use is not a constant, which is why there is no longer one
		// here for a reader to reach for.
		schema_version: "ceal.worker_acceptance_result.v2",
		// The refusal writer for this same schema carries `command`, `ok` and
		// `status`, and the shipped guide tells an agent to branch on `ok`, "which
		// every command answers". This document answered none of them, so the one
		// artifact an outsider produces to prove a release read as `ok: undefined`
		// — falsy — to any reader that followed the instruction.
		command: "ceal",
		ok: true,
		status: "emitted",
		emitted_by: "installed_client",
		installed_client: {
			platform: release.platform,
			release_version: release.release_version,
			artifact_sha256: release.artifact_sha256,
			artifact_state: release.artifact_state,
			manifest: release.manifest,
			digest_agreement: release.digest_agreement,
			reported_version: parts.reportedVersion,
			client_protocol_version: parts.clientProtocolVersion,
		},
		gateway_protocol_input: release.protocol,
		guide: { status: parts.guide.status, registered_host_count: parts.guide.registered_host_count },
		gateway_session: {
			reached: true,
			elapsed_ms: session.elapsed_ms,
			instance_ref: session.instance_ref,
			profile_ref: session.profile_ref,
			negotiated_protocol_version: session.negotiated_protocol_version,
			host_decision: session.host_decision,
			catalog_source: session.catalog_source,
			live_gateway_checked: true,
			capability_count: session.capability_count,
		},
		bounded_capability_call: projectBoundedCall(parts.boundedCall),
		non_claims: acceptanceNonClaims(parts),
	};
}

/**
 * Projects the row through the declared key lists rather than emitting the object
 * it was handed. That makes the allow-list mechanical: a field added to
 * `CealAcceptanceBoundedCall` cannot travel until it is also declared above, and
 * a declared key that the caller omits still appears, as `null`, so the two
 * emitters cannot answer one schema with different key sets.
 */
function projectBoundedCall(call: CealAcceptanceBoundedCall | null): Record<string, unknown> | null {
	if (!call) return null;
	const source = call as unknown as Record<string, unknown>;
	const row = Object.fromEntries(CEAL_ACCEPTANCE_BOUNDED_CALL_KEYS.map((key) => [key, source[key] ?? null]));
	const receipt = source.receipt as Record<string, unknown> | null | undefined;
	row.receipt = receipt ? Object.fromEntries(CEAL_ACCEPTANCE_RECEIPT_KEYS.map((key) => [key, receipt[key] ?? null])) : null;
	return row;
}

// Derived from what the run actually reached, so a row that was skipped says so
// in the record itself rather than in a covering note that travels separately
// and goes stale.
function acceptanceNonClaims(parts: CealAcceptanceRecordParts): readonly string[] {
	const claims = [
		`Only ${String(parts.release.platform)} is evidenced by this record; every other platform is unproved by it.`,
		"No tag, signature, upload, publication, or Gateway configuration change was performed.",
		// The emitter never calls a provider. Saying so matters more than usual
		// here, because this command is the one a stranger runs on their own
		// machine and it must not be the thing that took a provider action.
		"This command performed no provider call. Any bounded-call row below is a read-back of a call that `ceal call` already made.",
	];
	if (!parts.boundedCall) {
		claims.push("provider_execution_not_reached: no request reference was supplied, so no provider action or receipt is claimed.");
	} else {
		// The row's shape is shared with the checkout-side emitter, which performs
		// the call itself. This command never does, so the fields that describe
		// making a call are null here rather than absent — an absent key would read
		// as a schema difference between two records that answer one schema.
		claims.push(
			"The bounded-call row's capability, target, evidence and process fields are null because this command reads back a call it did not make; only the checkout-side emitter fills them.",
		);
	}
	if (parts.release.artifact_state !== "signed") {
		claims.push(
			`artifact_state is '${String(parts.release.artifact_state)}' because the release manifest is written at asset-composition time, ` +
				"before signing; it does not mean the installed artifact is unsigned. Cosign verification is the installer's step, and this " +
				"command does not re-prove it.",
		);
	}
	// The repository-side script cross-checks the release's protocol producer
	// against `gateway-protocol-handoff-lock.json`. An installed host carries no lock, so
	// that agreement is genuinely absent here rather than silently assumed — the
	// producer tuple below is the release manifest's own statement, and verifying
	// it is the receiving lane's step.
	claims.push(
		"No handoff lock is present on an installed host, so the protocol producer tuple is the release manifest's own statement and is not cross-checked here.",
	);
	claims.push(
		"This record describes one machine. It is not a fresh-device installation proof unless this install was performed fresh for it.",
	);
	claims.push(
		"This record is assembled by allow-list: the emitting host's filesystem paths and local agent registration paths are never included, so it describes an installation without locating one.",
	);
	return claims;
}
