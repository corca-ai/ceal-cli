// The one rule that says a release manifest's Gateway protocol input is the
// artifact the lock binds.
//
// It lives here because two lanes ask it at two different times and neither may
// answer differently. `worker-acceptance-packet.ts` asks it of an INSTALLED
// release, which is after signing and publishing by definition; the asset
// merge asks it of the manifests it is about to hand to the signing job, which
// is the only point where a disagreement can still be fixed without burning a
// tag. A second copy of the comparison would let those two drift, and the lane
// that drifts silently is the late one.
//
// Callers inject `fail` so each keeps its own coded-error envelope. The rule
// takes no position on how a lane reports.

import { asJsonRecord, type JsonRecord } from "./json-record.ts";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const PROTOCOL_HANDOFF_LOCK_PATH = "gateway-protocol-handoff-lock.json";

type ProtocolFailure = (code: string, message: string) => never;
type ProtocolProducer = {
	repository: string;
	commit: string;
	tree: string;
};
type LockAgreement = {
	checked_against: string | null;
	commit_matches: boolean | null;
	tree_matches: boolean | null;
};
type ProtocolProvenance = {
	package: unknown;
	version: unknown;
	sha256: unknown;
	producer: ProtocolProducer;
	lock_agreement: LockAgreement;
};

function requiredProducerField(value: unknown, field: keyof ProtocolProducer, fail: ProtocolFailure): string {
	if (typeof value !== "string" || !value) {
		fail("protocol_provenance_incomplete", `The protocol input names no producer ${field}; a version alone does not identify an artifact.`);
	}
	return value;
}

/**
 * The Protocol input must be named by immutable producer provenance, not by a
 * version string. `@corca-ai/ceal-protocol@0.65.0` has been observed with three
 * different byte sets, so a version-only binding names no particular artifact.
 *
 * An absent lock is not a pass and not a failure: `lock_agreement` records
 * `checked_against: null` so the caller can see the comparison did not happen
 * rather than read silence as agreement.
 */
export function verifyProtocolProvenanceAgainstLock(
	manifest: unknown,
	{ repoRoot, fail }: { repoRoot: string; fail: ProtocolFailure },
): ProtocolProvenance {
	const manifestRecord = asJsonRecord(manifest);
	const protocol = manifestRecord?.protocol;
	if (!protocol) fail("protocol_input_missing", "The release manifest declares no Gateway protocol input.");
	const protocolRecord = asJsonRecord(protocol) ?? {};
	const producerRecord = asJsonRecord(protocolRecord.producer) ?? {};
	const producer: ProtocolProducer = {
		repository: requiredProducerField(producerRecord.repository, "repository", fail),
		commit: requiredProducerField(producerRecord.commit, "commit", fail),
		tree: requiredProducerField(producerRecord.tree, "tree", fail),
	};
	for (const [field, value] of Object.entries(protocolRecord)) {
		if (typeof value === "string" && /^(?:workspace|link|file|portal):/u.test(value)) {
			fail(
				"protocol_substitution",
				`The protocol input's ${field} uses a '${value.split(":")[0]}:' specifier; a source-path substitution is not a Gateway artifact.`,
			);
		}
	}
	const lockPath = path.join(repoRoot, PROTOCOL_HANDOFF_LOCK_PATH);
	const parsedLock: unknown = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : undefined;
	const lock: JsonRecord | undefined = parsedLock ? (asJsonRecord(parsedLock) ?? {}) : undefined;
	const lockGateway: JsonRecord | undefined = asJsonRecord(lock?.gateway);
	const agreement: LockAgreement = lock
		? {
				checked_against: PROTOCOL_HANDOFF_LOCK_PATH,
				commit_matches: lockGateway?.commit === producer.commit,
				tree_matches: lockGateway?.tree === producer.tree,
			}
		: { checked_against: null, commit_matches: null, tree_matches: null };
	if (lock && (!agreement.commit_matches || !agreement.tree_matches)) {
		fail(
			"protocol_provenance_disagreement",
			`The release's protocol producer (${producer.commit}) disagrees with ${PROTOCOL_HANDOFF_LOCK_PATH} (${lockGateway?.commit}).`,
		);
	}
	return {
		package: protocolRecord.package,
		version: protocolRecord.version,
		sha256: protocolRecord.sha256,
		producer,
		lock_agreement: agreement,
	};
}
