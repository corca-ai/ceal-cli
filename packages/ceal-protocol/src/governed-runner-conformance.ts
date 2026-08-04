import type { CEAL_PROTOCOL_VERSION } from "./gateway-response-types.js";

export const GOVERNED_RUNNER_CORPUS_SCHEMA = "ceal.governed_runner_conformance_corpus.v1" as const;
export const GOVERNED_RUNNER_CORPUS_VERSION = "1.1.0" as const;

export type GovernedRunnerConformanceKind =
	| "runner_context"
	| "denial"
	| "ledger"
	| "dispatch"
	| "egress"
	| "wake"
	| "capability_result";

export interface GovernedRunnerProofContract {
	requirement: "local_state";
	reached: "local_state";
	fixture: "local_projection_fixture";
	claims_allowed: string[];
	non_claims: string[];
	production_gateway_handshake_checked: false;
	production_gateway_audit_reached: false;
	live_provider_dispatch_checked: false;
	connector_completion_readback_checked: false;
}

export interface GovernedRunnerConformanceCase {
	id: string;
	kind: GovernedRunnerConformanceKind;
	input: unknown;
	expected: unknown;
	proof_contract: GovernedRunnerProofContract;
}

export interface GovernedRunnerConformanceCorpus {
	schema_version: typeof GOVERNED_RUNNER_CORPUS_SCHEMA;
	corpus_version: typeof GOVERNED_RUNNER_CORPUS_VERSION;
	protocol_version: typeof CEAL_PROTOCOL_VERSION;
	cases: GovernedRunnerConformanceCase[];
}
