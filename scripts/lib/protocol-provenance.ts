// The one rule that says a release manifest's Gateway protocol input is the
// artifact the lock binds.
//
// It lives here because two lanes ask it at two different times and neither may
// answer differently. `worker-acceptance-packet.mjs` asks it of an INSTALLED
// release, which is after signing and publishing by definition; the asset
// merge asks it of the manifests it is about to hand to the signing job, which
// is the only point where a disagreement can still be fixed without burning a
// tag. A second copy of the comparison would let those two drift, and the lane
// that drifts silently is the late one.
//
// Callers inject `fail` so each keeps its own coded-error envelope. The rule
// takes no position on how a lane reports.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const PROTOCOL_HANDOFF_LOCK_PATH = "gateway-protocol-handoff-lock.json";

/**
 * The Protocol input must be named by immutable producer provenance, not by a
 * version string. `@corca-ai/ceal-protocol@0.65.0` has been observed with three
 * different byte sets, so a version-only binding names no particular artifact.
 *
 * An absent lock is not a pass and not a failure: `lock_agreement` records
 * `checked_against: null` so the caller can see the comparison did not happen
 * rather than read silence as agreement.
 */
export function verifyProtocolProvenanceAgainstLock(manifest, { repoRoot, fail }) {
	const protocol = manifest?.protocol;
	if (!protocol) fail("protocol_input_missing", "The release manifest declares no Gateway protocol input.");
	const producer = protocol.producer ?? {};
	for (const field of ["repository", "commit", "tree"]) {
		if (typeof producer[field] !== "string" || !producer[field]) {
			fail("protocol_provenance_incomplete", `The protocol input names no producer ${field}; a version alone does not identify an artifact.`);
		}
	}
	for (const [field, value] of Object.entries(protocol)) {
		if (typeof value === "string" && /^(?:workspace|link|file|portal):/u.test(value)) {
			fail(
				"protocol_substitution",
				`The protocol input's ${field} uses a '${value.split(":")[0]}:' specifier; a source-path substitution is not a Gateway artifact.`,
			);
		}
	}
	const lockPath = path.join(repoRoot, PROTOCOL_HANDOFF_LOCK_PATH);
	const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : undefined;
	const agreement = lock
		? {
				checked_against: PROTOCOL_HANDOFF_LOCK_PATH,
				commit_matches: lock.gateway?.commit === producer.commit,
				tree_matches: lock.gateway?.tree === producer.tree,
			}
		: { checked_against: null, commit_matches: null, tree_matches: null };
	if (lock && (!agreement.commit_matches || !agreement.tree_matches)) {
		fail(
			"protocol_provenance_disagreement",
			`The release's protocol producer (${producer.commit}) disagrees with ${PROTOCOL_HANDOFF_LOCK_PATH} (${lock.gateway?.commit}).`,
		);
	}
	return {
		package: protocol.package,
		version: protocol.version,
		sha256: protocol.sha256,
		producer,
		lock_agreement: agreement,
	};
}
