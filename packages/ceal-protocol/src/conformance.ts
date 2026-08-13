import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import {
	CEAL_PROTOCOL_VERSION,
	GOVERNED_RUNNER_CORPUS_SCHEMA,
	GOVERNED_RUNNER_CORPUS_VERSION,
	type GovernedRunnerConformanceCase,
	type GovernedRunnerConformanceCorpus,
	type GovernedRunnerConformanceKind,
} from "./index.js";

const CORPUS_URL = new URL("../conformance/governed-runner/v1/corpus.json", import.meta.url);
const DIGEST_URL = new URL("../conformance/governed-runner/v1/corpus.json.sha256", import.meta.url);
const EXPECTED_CASE_COUNTS: Readonly<Record<GovernedRunnerConformanceKind, number>> = {
	runner_context: 4,
	denial: 7,
	ledger: 1,
	dispatch: 3,
	egress: 3,
	wake: 6,
	capability_result: 3,
};
const PROOF_LEVEL_KEYS = new Set(["proof_level", "highest_proof_level_reached", "requirement", "reached"]);
const FORBIDDEN_VALUE_KEY = /^(?:secret|password|token|raw_provider_payload|private_path)$/iu;
const PRIVATE_PATH = /(?:^|["'\s])(?:\/home\/|\/Users\/|packages\/(?:ceal-runtime|ceal-core)\/src\/|node_modules\/)/u;
const SECRET_MATERIAL = /(?:xox[baprs]-[A-Za-z0-9-]{8,}|sk-[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)/u;
const RAW_PROVIDER_REF = /(?:slack:[CDGUW][A-Z0-9]{4,}|github:(?:issue|pull|repo):|[0-9]{10}\.[0-9]{4,})/u;

export class ConformanceValidationError extends Error {
	override readonly name = "ConformanceValidationError";
}

export interface ConformanceConsumer {
	name: string;
	version: string;
	execute(testCase: Readonly<GovernedRunnerConformanceCase>): unknown | Promise<unknown>;
}

export interface ConformanceCaseResult {
	id: string;
	kind: GovernedRunnerConformanceKind;
	passed: boolean;
	error?: string;
}

export interface ConformanceReport {
	schema_version: "ceal.governed_runner_conformance_report.v1";
	consumer: string;
	consumer_version: string;
	corpus_version: string;
	proof_level: "local_state";
	production_gateway_checked: false;
	non_claims: string[];
	passed: boolean;
	total: number;
	passed_count: number;
	failed_count: number;
	results: ConformanceCaseResult[];
}

export function sha256Digest(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function verifyCorpusDigest(bytes: Uint8Array, sidecar: string): string {
	const match = /^([a-f0-9]{64})[ ]{2}corpus\.json\n?$/u.exec(sidecar);
	if (!match) {
		throw new ConformanceValidationError("invalid governed-runner digest sidecar format");
	}
	const actual = sha256Digest(bytes);
	if (actual !== match[1]) {
		throw new ConformanceValidationError(`governed-runner corpus digest mismatch: expected ${match[1]}, received ${actual}`);
	}
	return actual;
}

export function parseAndValidateCorpus(bytes: Uint8Array): GovernedRunnerConformanceCorpus {
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder().decode(bytes));
	} catch (error) {
		throw new ConformanceValidationError(`governed-runner corpus is not valid JSON: ${errorMessage(error)}`);
	}
	return validateCorpus(value);
}

export function validateCorpus(value: unknown): GovernedRunnerConformanceCorpus {
	if (!isRecord(value)) throw new ConformanceValidationError("governed-runner corpus must be an object");
	if (value.schema_version !== GOVERNED_RUNNER_CORPUS_SCHEMA) throw new ConformanceValidationError("unsupported governed-runner corpus schema");
	if (value.corpus_version !== GOVERNED_RUNNER_CORPUS_VERSION) throw new ConformanceValidationError("unsupported governed-runner corpus version");
	if (value.protocol_version !== CEAL_PROTOCOL_VERSION) throw new ConformanceValidationError("unsupported governed-runner protocol version");
	if (!Array.isArray(value.cases)) throw new ConformanceValidationError("governed-runner corpus cases must be an array");

	const ids = new Set<string>();
	const counts = new Map<GovernedRunnerConformanceKind, number>();
	for (const [index, testCase] of value.cases.entries()) {
		validateCase(testCase, index, ids, counts);
	}
	for (const [kind, expected] of Object.entries(EXPECTED_CASE_COUNTS) as Array<[GovernedRunnerConformanceKind, number]>) {
		if ((counts.get(kind) ?? 0) !== expected) {
			throw new ConformanceValidationError(`governed-runner corpus requires ${expected} ${kind} cases`);
		}
	}
	assertSafeValue(value, "$", null);
	return value as unknown as GovernedRunnerConformanceCorpus;
}

export async function loadCanonicalCorpus(): Promise<{ corpus: GovernedRunnerConformanceCorpus; digest: string }> {
	const [bytes, sidecar] = await Promise.all([readFile(CORPUS_URL), readFile(DIGEST_URL, "utf8")]);
	const digest = verifyCorpusDigest(bytes, sidecar);
	return { corpus: parseAndValidateCorpus(bytes), digest };
}

export async function runConformanceCorpus(
	corpusValue: unknown,
	consumer: ConformanceConsumer,
): Promise<ConformanceReport> {
	const corpus = validateCorpus(corpusValue);
	if (!consumer.name.trim()) throw new ConformanceValidationError("conformance consumer name must not be empty");
	if (!consumer.version.trim()) throw new ConformanceValidationError("conformance consumer version must not be empty");
	const results: ConformanceCaseResult[] = [];
	for (const testCase of corpus.cases) {
		try {
			const actual = await consumer.execute(testCase);
			const passed = isDeepStrictEqual(actual, testCase.expected);
			results.push({ id: testCase.id, kind: testCase.kind, passed, ...(passed ? {} : { error: "consumer output did not match expected value" }) });
		} catch (error) {
			results.push({ id: testCase.id, kind: testCase.kind, passed: false, error: errorMessage(error) });
		}
	}
	const passedCount = results.filter((result) => result.passed).length;
	return {
		schema_version: "ceal.governed_runner_conformance_report.v1",
		consumer: consumer.name,
		consumer_version: consumer.version,
		corpus_version: corpus.corpus_version,
		proof_level: "local_state",
		production_gateway_checked: false,
		non_claims: [
			"production Gateway transport, authentication, policy, and audit were not reached",
			"live provider dispatch and connector completion readback were not reached",
		],
		passed: passedCount === results.length,
		total: results.length,
		passed_count: passedCount,
		failed_count: results.length - passedCount,
		results,
	};
}

export async function runCanonicalConformance(consumer: ConformanceConsumer): Promise<ConformanceReport & { corpus_digest: string }> {
	const { corpus, digest } = await loadCanonicalCorpus();
	return { ...(await runConformanceCorpus(corpus, consumer)), corpus_digest: digest };
}

function validateCase(
	value: unknown,
	index: number,
	ids: Set<string>,
	counts: Map<GovernedRunnerConformanceKind, number>,
): void {
	if (!isRecord(value)) throw new ConformanceValidationError(`case ${index} must be an object`);
	const keys = Object.keys(value).sort();
	if (!isDeepStrictEqual(keys, ["expected", "id", "input", "kind", "proof_contract"])) {
		throw new ConformanceValidationError(`case ${index} does not match the {id,kind,input,expected,proof_contract} ABI`);
	}
	if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9._-]+$/u.test(value.id)) throw new ConformanceValidationError(`case ${index} has an invalid id`);
	if (ids.has(value.id)) throw new ConformanceValidationError(`duplicate governed-runner case id: ${value.id}`);
	ids.add(value.id);
	if (typeof value.kind !== "string" || !(value.kind in EXPECTED_CASE_COUNTS)) {
		throw new ConformanceValidationError(`case ${value.id} has an unsupported kind`);
	}
	const kind = value.kind as GovernedRunnerConformanceKind;
	counts.set(kind, (counts.get(kind) ?? 0) + 1);
	if (!("input" in value) || !("expected" in value)) throw new ConformanceValidationError(`case ${value.id} is missing input or expected`);
	validateProofContract(value.proof_contract, value.id);
}

function validateProofContract(value: unknown, id: string): void {
	if (!isRecord(value)) throw new ConformanceValidationError(`case ${id} proof_contract must be an object`);
	if (value.requirement !== "local_state" || value.reached !== "local_state" || value.fixture !== "local_projection_fixture") {
		throw new ConformanceValidationError(`case ${id} attempts proof promotion or changes the local fixture contract`);
	}
	if (!Array.isArray(value.claims_allowed) || !value.claims_allowed.every((item) => typeof item === "string")) {
		throw new ConformanceValidationError(`case ${id} claims_allowed must be a string array`);
	}
	if (!Array.isArray(value.non_claims) || !value.non_claims.every((item) => typeof item === "string")) {
		throw new ConformanceValidationError(`case ${id} non_claims must be a string array`);
	}
	for (const key of ["production_gateway_handshake_checked", "production_gateway_audit_reached", "live_provider_dispatch_checked", "connector_completion_readback_checked"]) {
		if (value[key] !== false) throw new ConformanceValidationError(`case ${id} promotes unproven ${key}`);
	}
}

function assertSafeValue(value: unknown, path: string, key: string | null): void {
	if (typeof value === "string") {
		assertSafeString(value, path, key);
		return;
	}
	assertNonStringSensitiveField(value, path, key);
	if (Array.isArray(value)) {
		value.forEach((item, index) => assertSafeValue(item, `${path}[${index}]`, null));
	} else if (isRecord(value)) {
		for (const [childKey, child] of Object.entries(value)) assertSafeValue(child, `${path}.${childKey}`, childKey);
	}
}

function assertSafeString(value: string, path: string, key: string | null): void {
	if (PRIVATE_PATH.test(value)) throw new ConformanceValidationError(`private path content at ${path}`);
	if (SECRET_MATERIAL.test(value)) throw new ConformanceValidationError(`secret or raw-provider content at ${path}`);
	if (RAW_PROVIDER_REF.test(value)) throw new ConformanceValidationError(`raw provider reference at ${path}`);
	if (key && FORBIDDEN_VALUE_KEY.test(key) && value.trim()) throw new ConformanceValidationError(`unsafe sensitive field at ${path}`);
	if (key && PROOF_LEVEL_KEYS.has(key) && value !== "readiness" && value !== "local_state") {
		throw new ConformanceValidationError(`proof promotion at ${path}`);
	}
}

function assertNonStringSensitiveField(value: unknown, path: string, key: string | null): void {
	if (key && FORBIDDEN_VALUE_KEY.test(key) && value !== null && value !== false) {
		throw new ConformanceValidationError(`unsafe sensitive field at ${path}`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
