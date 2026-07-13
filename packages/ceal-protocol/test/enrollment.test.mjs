import assert from "node:assert/strict";
import test from "node:test";
import {
	decodeCealEnrollmentCreateRequest,
	decodeCealEnrollmentCreateResult,
	decodeCealEnrollmentExchangeRequest,
	decodeCealEnrollmentResponse,
} from "../dist/index.js";

const CODE = "A".repeat(43);
const TOKEN = `ceal_personal_${"B".repeat(43)}`;

test("administrator enrollment creation has one strict public wire contract", () => {
	const request = decodeCealEnrollmentCreateRequest({
		schema_version: "ceal.enrollment_create.v1",
		profile_ref: "profile:work", registration_ref: "registration:narnia", client_ref: "client:narnia",
		runner_ref: "runner:narnia", subject_ref: "subject:hwidong", instance_ref: "instance:corca",
	});
	assert.equal(request.runner_ref, "runner:narnia");
	const result = decodeCealEnrollmentCreateResult({
		schema_version: "ceal.enrollment_create_result.v1", ok: true, code: CODE, expires_at: "2026-07-14T00:00:00.000Z",
	});
	assert.equal(result.code, CODE);
	assert.throws(() => decodeCealEnrollmentCreateRequest({ ...request, authority: "gateway" }), TypeError);
	assert.throws(() => decodeCealEnrollmentCreateResult({ ...result, code: "short" }), TypeError);
});

test("enrollment request and issued result decode exact bounded material", () => {
	assert.equal(decodeCealEnrollmentExchangeRequest({
		schema_version: "ceal.enrollment_exchange.v1",
		code: CODE,
		client: { name: "ceal", version: "0.64.0" },
	}).code, CODE);
	const result = decodeCealEnrollmentResponse({
		schema_version: "ceal.enrollment_result.v1",
		ok: true,
		profile_ref: "profile:narnia",
		registration_ref: "registration:narnia",
		client_ref: "client:narnia",
		runner_ref: "runner:narnia",
		access_token: TOKEN,
		expires_at: "2026-07-14T00:00:00.000Z",
	});
	assert.equal(result.ok, true);
	assert.equal(result.access_token, TOKEN);
});

test("enrollment decoders reject extra fields, malformed codes, and token drift", () => {
	for (const request of [
		{ schema_version: "ceal.enrollment_exchange.v1", code: "short", client: { name: "ceal", version: "0.64.0" } },
		{ schema_version: "ceal.enrollment_exchange.v1", code: CODE, client: { name: "ceal", version: "0.64.0" }, extra: true },
	]) assert.throws(() => decodeCealEnrollmentExchangeRequest(request), TypeError);
	assert.throws(() => decodeCealEnrollmentResponse({
		schema_version: "ceal.enrollment_result.v1",
		ok: true,
		profile_ref: "profile:narnia",
		registration_ref: "registration:narnia",
		client_ref: "client:narnia",
		runner_ref: "runner:narnia",
		access_token: "provider-token",
		expires_at: "2026-07-14T00:00:00.000Z",
	}), TypeError);
});

test("enrollment failure has one stable recovery action", () => {
	const result = decodeCealEnrollmentResponse({
		schema_version: "ceal.enrollment_result.v1",
		ok: false,
		error: {
			code: "enrollment_used",
			message: "The enrollment code cannot be used.",
			next_action: "Ask an operator to create a new enrollment.",
		},
	});
	assert.equal(result.ok, false);
	assert.equal(Object.keys(result.error).filter((key) => key === "next_action").length, 1);
});
