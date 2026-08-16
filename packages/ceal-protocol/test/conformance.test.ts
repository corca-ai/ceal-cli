import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TextEncoder } from "node:util";
import { URL } from "node:url";
import {
	ConformanceValidationError,
	loadCanonicalCorpus,
	parseAndValidateCorpus,
	runConformanceCorpus,
	sha256Digest,
	validateCorpus,
	verifyCorpusDigest,
} from "../dist/conformance.js";
import { cloneJson } from "./protocol-test-support.ts";

test("canonical corpus validates exact bytes and runs through a consumer harness", async () => {
	const { corpus, digest } = await loadCanonicalCorpus();
	assert.equal(digest, "0c3bd421d4565e467f6ebec691f08626bd84791543adec1f34751e0089da6a1d");
	assert.equal(corpus.cases.length, 27);
	const report = await runConformanceCorpus(corpus, {
		name: "fixture-reference-consumer",
		version: "0.65.0",
		execute: (testCase) => testCase.expected,
	});
	assert.deepEqual(
		{ passed: report.passed, total: report.total, passedCount: report.passed_count, failedCount: report.failed_count },
		{ passed: true, total: 27, passedCount: 27, failedCount: 0 },
	);
});

test("schema and version drift fail closed", async () => {
	const { corpus } = await loadCanonicalCorpus();
	assert.throws(() => validateCorpus({ ...corpus, schema_version: "ceal.governed_runner_conformance_corpus.v2" }), ConformanceValidationError);
	assert.throws(() => validateCorpus({ ...corpus, corpus_version: "2.0.0" }), ConformanceValidationError);
});

test("malformed case ABI and corpus JSON fail closed", async () => {
	const { corpus } = await loadCanonicalCorpus();
	const malformed = cloneJson(corpus);
	delete malformed.cases[0].expected;
	assert.throws(() => validateCorpus(malformed), /does not match the .* ABI/u);
	assert.throws(() => parseAndValidateCorpus(new TextEncoder().encode("{")), /not valid JSON/u);
});

test("digest sidecar rejects byte and sidecar drift", async () => {
	const corpusUrl = new URL("../conformance/governed-runner/v1/corpus.json", import.meta.url);
	const bytes = await readFile(corpusUrl);
	const digest = sha256Digest(bytes);
	assert.equal(verifyCorpusDigest(bytes, `${digest}  corpus.json\n`), digest);
	assert.throws(() => verifyCorpusDigest(Buffer.concat([bytes, Buffer.from(" ")]), `${digest}  corpus.json\n`), /digest mismatch/u);
	assert.throws(() => verifyCorpusDigest(bytes, digest), /sidecar format/u);
});

test("unsafe secret, raw-provider, and private-path content fail closed", async () => {
	const { corpus } = await loadCanonicalCorpus();
	for (const unsafe of [
		{ credential: "Bearer provider-material-that-must-not-ship" },
		{ raw_provider_payload: { id: "provider-record" } },
		{ locator: ["", "home", "operator", "private-runtime", "state.json"].join("/") },
		{ ref: "slack:C12345:1711111111.000100" },
	]) {
		const candidate = cloneJson(corpus);
		candidate.cases[0].input = unsafe;
		assert.throws(() => validateCorpus(candidate), ConformanceValidationError);
	}
});

test("proof promotion and production claim promotion fail closed", async () => {
	const { corpus } = await loadCanonicalCorpus();
	const promoted = cloneJson(corpus);
	promoted.cases[0].proof_contract.reached = "provider_roundtrip";
	assert.throws(() => validateCorpus(promoted), /proof promotion/u);
	const claimed = cloneJson(corpus);
	claimed.cases[0].proof_contract.production_gateway_handshake_checked = true;
	assert.throws(() => validateCorpus(claimed), /promotes unproven/u);
});

test("consumer mismatches and errors are deterministic report failures", async () => {
	const { corpus } = await loadCanonicalCorpus();
	const report = await runConformanceCorpus(corpus, {
		name: "failing-consumer",
		version: "0.65.0",
		execute(testCase) {
			if (testCase.id === "context.personal") throw new Error("adapter rejected case");
			return testCase.id === "context.ci" ? { wrong: true } : testCase.expected;
		},
	});
	assert.equal(report.passed, false);
	assert.equal(report.failed_count, 2);
	assert.match(report.results[0].error ?? "", /adapter rejected case/u);
	assert.match(report.results[1].error ?? "", /did not match/u);
});
