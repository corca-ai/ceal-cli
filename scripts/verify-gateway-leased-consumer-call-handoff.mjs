#!/usr/bin/env node

import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = "gateway-leased-consumer-call-handoff-lock.json";
const HANDOFF_SCHEMA = "ceal.gateway_leased_consumer_call_conformance_handoff.v1";
const LOCK_SCHEMA = "ceal.worker_gateway_leased_consumer_call_handoff_lock.v1";
const HANDOFF_PATH = "vendor/gateway-leased-consumer-call/gateway-leased-consumer-call-conformance.json";
const SOURCE_REPOSITORY = "corca-ai/ceal";
const SERVICE_PATH = "/api/ceal/agent/v1/call";
const POSITIVE_VECTOR = "admitted-owner-result-is-unavailable-external-response";
const NEGATIVE_VECTORS = Object.freeze(["caller-provenance-field", "credential-bearing-arguments", "wrong-schema-version"]);
const BASE_REQUEST = Object.freeze({
	schema_version: "ceal.gateway_leased_consumer_call_request.v1",
	event_ref: "event:interop-1",
	lease_ref: "lease:interop-1",
	lease_fence: 1,
	capability_id: "message.search",
	target_ref: "target:interop-1",
	arguments: { query: "fixture-only" },
	purpose: "fixture-only governed read",
});
const EXPECTED_REQUESTS = Object.freeze({
	[POSITIVE_VECTOR]: BASE_REQUEST,
	"wrong-schema-version": { ...BASE_REQUEST, schema_version: "ceal.gateway_leased_consumer_call_request.v0" },
	"caller-provenance-field": { ...BASE_REQUEST, runner_ref: "runner:spoofed" },
	"credential-bearing-arguments": { ...BASE_REQUEST, arguments: { authorization: "spoofed" } },
});

export class GatewayLeasedConsumerCallHandoffError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "GatewayLeasedConsumerCallHandoffError";
		this.code = code;
	}
}

/** Verifies the exact Gateway-owned, non-serving leased-call transport oracle. */
export function verifyGatewayLeasedConsumerCallHandoff({ repoRoot = ROOT } = {}) {
	const root = path.resolve(repoRoot);
	const lock = parseJson(readRepositoryFile(root, LOCK_PATH), "invalid_handoff_lock");
	const pinned = validateLock(lock);
	const bytes = readRepositoryFile(root, pinned.path);
	if (sha256(bytes) !== pinned.sha256) fail("handoff_digest_mismatch", "Gateway leased-consumer handoff bytes do not match the lock.");
	const handoff = parseJson(bytes, "invalid_handoff");
	validateHandoff(handoff, pinned);
	return Object.freeze({
		schema_version: "ceal.worker_gateway_leased_consumer_call_handoff_verification.v1",
		ok: true,
		proof_level: "local_state",
		writes_external: false,
		handoff: Object.freeze({
			path: pinned.path,
			sha256: pinned.sha256,
			source_repository: pinned.source_repository,
			source_commit: pinned.source_commit,
			source_tree: pinned.source_tree,
			vector_ids: [...pinned.vector_ids],
		}),
		non_claims: [
			"This verifies a checked-in Gateway conformance handoff, not a Gateway checkout, release, registered route, service credential, or live call.",
		],
	});
}

function validateLock(value) {
	if (!record(value) || !exactKeys(value, ["schema_version", "handoff"]) || value.schema_version !== LOCK_SCHEMA || !record(value.handoff))
		fail("invalid_handoff_lock", "Gateway leased-consumer handoff lock is invalid.");
	const handoff = value.handoff;
	if (
		!exactKeys(handoff, ["path", "sha256", "source_repository", "source_commit", "source_tree", "vector_ids"]) ||
		handoff.path !== HANDOFF_PATH ||
		!sha256Text(handoff.sha256) ||
		handoff.source_repository !== SOURCE_REPOSITORY ||
		!gitIdentity(handoff.source_commit) ||
		!gitIdentity(handoff.source_tree) ||
		!orderedUniqueStrings(handoff.vector_ids)
	) {
		fail("invalid_handoff_lock", "Gateway leased-consumer handoff lock is invalid.");
	}
	return Object.freeze({ ...handoff, vector_ids: Object.freeze([...handoff.vector_ids]) });
}

function validateHandoff(value, pinned) {
	if (
		!record(value) ||
		!exactKeys(value, ["schema_version", "proof_level", "writes_external", "source", "transport", "vectors", "invariants", "non_claims"]) ||
		value.schema_version !== HANDOFF_SCHEMA ||
		value.proof_level !== "local_state" ||
		value.writes_external !== false
	) {
		fail("invalid_handoff", "Gateway leased-consumer handoff is invalid.");
	}
	validateSource(value.source, pinned);
	validateTransport(value.transport);
	validateVectors(value.vectors, pinned.vector_ids);
	if (
		!uniqueStrings(value.invariants) ||
		!Array.isArray(value.non_claims) ||
		!value.non_claims.every((item) => typeof item === "string" && item.length > 0)
	) {
		fail("invalid_handoff", "Gateway leased-consumer handoff is invalid.");
	}
}

function validateSource(value, pinned) {
	if (
		!record(value) ||
		!exactKeys(value, ["repository", "commit", "tree", "inputs"]) ||
		value.repository !== pinned.source_repository ||
		value.commit !== pinned.source_commit ||
		value.tree !== pinned.source_tree ||
		!Array.isArray(value.inputs) ||
		value.inputs.length !== 3
	) {
		fail("handoff_source_mismatch", "Gateway leased-consumer handoff source identity does not match the lock.");
	}
	const paths = value.inputs.map((item) => item?.path).sort();
	if (
		!value.inputs.every(
			(item) => record(item) && exactKeys(item, ["path", "sha256"]) && safeSourcePath(item.path) && sha256Text(item.sha256),
		) ||
		JSON.stringify(paths) !==
			JSON.stringify([
				"scripts/agent-runtime/fixtures/gateway-leased-consumer-call-transport.json",
				"scripts/agent-runtime/gateway-leased-consumer-call-admission.mjs",
				"scripts/agent-runtime/gateway-leased-consumer-call-route.mjs",
			])
	) {
		fail("invalid_handoff", "Gateway leased-consumer handoff is invalid.");
	}
}

function validateTransport(value) {
	if (
		!record(value) ||
		!exactKeys(value, ["method", "service_path", "required_headers"]) ||
		value.method !== "POST" ||
		value.service_path !== SERVICE_PATH ||
		!record(value.required_headers) ||
		!exactKeys(value.required_headers, ["authorization", "content_type"]) ||
		value.required_headers.authorization !== "Bearer <protected-service-credential>" ||
		value.required_headers.content_type !== "application/json"
	) {
		fail("invalid_handoff", "Gateway leased-consumer handoff transport is invalid.");
	}
}

function validateVectors(value, expectedIds) {
	if (
		!Array.isArray(value) ||
		value.length !== 1 + NEGATIVE_VECTORS.length ||
		!value.every((item) => record(item) && exactKeys(item, ["id", "request_body", "external_response"]) && typeof item.id === "string")
	) {
		fail("invalid_handoff", "Gateway leased-consumer handoff vectors are invalid.");
	}
	const ids = value.map((item) => item.id).sort();
	if (
		JSON.stringify(ids) !== JSON.stringify(expectedIds) ||
		JSON.stringify(ids) !== JSON.stringify([POSITIVE_VECTOR, ...NEGATIVE_VECTORS].sort())
	)
		fail("handoff_vector_mismatch", "Gateway leased-consumer handoff vector inventory does not match the lock.");
	for (const vector of value) {
		if (
			!sameJson(vector.request_body, EXPECTED_REQUESTS[vector.id]) ||
			!validResponse(
				vector.external_response,
				vector.id === POSITIVE_VECTOR ? 503 : 400,
				vector.id === POSITIVE_VECTOR ? "leased_consumer_call_unavailable" : "invalid_request",
			)
		) {
			fail("invalid_handoff", "Gateway leased-consumer handoff vector is invalid.");
		}
	}
}

function validResponse(value, status, errorCode) {
	return (
		record(value) &&
		exactKeys(value, ["status", "body"]) &&
		value.status === status &&
		record(value.body) &&
		exactKeys(value.body, ["ok", "error_code"]) &&
		value.body.ok === false &&
		value.body.error_code === errorCode
	);
}
function readRepositoryFile(root, relativePath) {
	const target = path.resolve(root, relativePath);
	if (!target.startsWith(`${root}${path.sep}`)) fail("invalid_handoff_lock", "Gateway leased-consumer handoff path is invalid.");
	const errorCode = relativePath === LOCK_PATH ? "handoff_lock_unavailable" : "handoff_unavailable";
	let descriptor;
	try {
		assertNoSymlinkPathComponents(root, target, errorCode);
		const initial = lstatSync(target);
		if (!initial.isFile() || initial.isSymbolicLink()) fail(errorCode, "Gateway leased-consumer handoff input is unavailable.");
		descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
		if (!fstatSync(descriptor).isFile()) fail(errorCode, "Gateway leased-consumer handoff input is unavailable.");
		return readFileSync(descriptor);
	} catch {
		fail(errorCode, "Gateway leased-consumer handoff input is unavailable.");
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
	}
}
function assertNoSymlinkPathComponents(root, target, errorCode) {
	let current = root;
	if (lstatSync(current).isSymbolicLink()) fail(errorCode, "Gateway leased-consumer handoff input is unavailable.");
	for (const segment of path.relative(root, target).split(path.sep)) {
		current = path.join(current, segment);
		if (lstatSync(current).isSymbolicLink()) fail(errorCode, "Gateway leased-consumer handoff input is unavailable.");
	}
}
function parseJson(bytes, code) {
	try {
		return JSON.parse(bytes.toString("utf8"));
	} catch {
		fail(code, "Gateway leased-consumer handoff JSON is invalid.");
	}
}
function fail(code, message) {
	throw new GatewayLeasedConsumerCallHandoffError(code, message);
}
function record(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value, keys) {
	const actual = Object.keys(value).sort();
	return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}
function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
function sha256Text(value) {
	return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
function gitIdentity(value) {
	return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}
function sameJson(left, right) {
	return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}
function canonicalJson(value) {
	if (Array.isArray(value)) return value.map(canonicalJson);
	if (!record(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonicalJson(value[key])]),
	);
}
function safeSourcePath(value) {
	return typeof value === "string" && value.startsWith("scripts/agent-runtime/") && !value.includes("..") && !value.includes("\0");
}
function orderedUniqueStrings(value) {
	return (
		Array.isArray(value) &&
		value.length === 4 &&
		value.every((item) => typeof item === "string") &&
		JSON.stringify([...value].sort()) === JSON.stringify(value) &&
		new Set(value).size === value.length
	);
}
function uniqueStrings(value) {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every((item) => typeof item === "string" && item.length > 0) &&
		new Set(value).size === value.length
	);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		console.log(JSON.stringify(verifyGatewayLeasedConsumerCallHandoff(), null, 2));
	} catch (error) {
		console.error(
			JSON.stringify({
				schema_version: "ceal.worker_gateway_leased_consumer_call_handoff_verification_error.v1",
				ok: false,
				error_code: error instanceof GatewayLeasedConsumerCallHandoffError ? error.code : "verification_failed",
			}),
		);
		process.exitCode = 2;
	}
}
