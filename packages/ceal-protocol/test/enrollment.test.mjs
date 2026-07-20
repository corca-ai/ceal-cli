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
		profile_ref: "profile:work", client_ref: "client:narnia",
		subject_ref: "subject:hwidong", instance_ref: "instance:corca",
	});
	assert.equal(request.client_ref, "client:narnia");
	const result = decodeCealEnrollmentCreateResult({
		schema_version: "ceal.enrollment_create_result.v1", ok: true, code: CODE,
		gateway_endpoint: "https://gateway.example.test/api/ceal/v1", expires_at: "2026-07-14T00:00:00.000Z",
	});
	assert.equal(result.code, CODE);
	assert.throws(() => decodeCealEnrollmentCreateRequest({ ...request, authority: "gateway" }), TypeError);
	assert.throws(() => decodeCealEnrollmentCreateResult({ ...result, code: "short" }), TypeError);
});

test("enrollment request and issued result decode exact bounded material", () => {
	assert.equal(decodeCealEnrollmentExchangeRequest({
		schema_version: "ceal.enrollment_exchange.v1",
		code: CODE,
		client: { name: "ceal", version: "0.65.0" },
	}).code, CODE);
	const result = decodeCealEnrollmentResponse({
		schema_version: "ceal.enrollment_result.v1",
		ok: true,
		profile_ref: "profile:narnia",
		membership_ref: "membership:narnia",
		registration_ref: "registration:narnia",
		client_ref: "client:narnia",
		subject_ref: "subject:hwidong",
		instance_ref: "instance:corca",
		access_token: TOKEN,
		expires_at: "2026-07-14T00:00:00.000Z",
		refresh_token: `ceal_refresh_${"R".repeat(43)}`,
		refresh_token_idle_expires_at: "2026-08-12T06:00:00.000Z",
		refresh_token_absolute_expires_at: "2026-10-11T06:00:00.000Z",
	});
	assert.equal(result.ok, true);
	assert.equal(result.access_token, TOKEN);
});

test("enrollment accepts one all-or-nothing refresh-capable result", () => {
	const result = decodeCealEnrollmentResponse({
		schema_version: "ceal.enrollment_result.v1",
		ok: true,
		profile_ref: "profile:work",
		membership_ref: "membership:narnia",
		registration_ref: "registration:narnia",
		client_ref: "client:narnia",
		subject_ref: "subject:hwidong",
		instance_ref: "instance:ceal-dev",
		access_token: `ceal_personal_${"A".repeat(43)}`,
		expires_at: "2026-07-13T06:15:00.000Z",
		refresh_token: `ceal_refresh_${"R".repeat(43)}`,
		refresh_token_idle_expires_at: "2026-08-12T06:00:00.000Z",
		refresh_token_absolute_expires_at: "2026-10-11T06:00:00.000Z",
	});
	assert.equal(result.ok, true);
	if (result.ok) assert.match(result.refresh_token, /^ceal_refresh_/u);
});

test("enrollment decoders reject extra fields, malformed codes, and token drift", () => {
	for (const request of [
		{ schema_version: "ceal.enrollment_exchange.v1", code: "short", client: { name: "ceal", version: "0.65.0" } },
		{ schema_version: "ceal.enrollment_exchange.v1", code: CODE, client: { name: "ceal", version: "0.65.0" }, extra: true },
	]) assert.throws(() => decodeCealEnrollmentExchangeRequest(request), TypeError);
	assert.throws(() => decodeCealEnrollmentResponse({
		schema_version: "ceal.enrollment_result.v1",
		ok: true,
		profile_ref: "profile:narnia",
		membership_ref: "membership:narnia",
		registration_ref: "registration:narnia",
		client_ref: "client:narnia",
		subject_ref: "subject:hwidong",
		instance_ref: "instance:corca",
		access_token: "provider-token",
		expires_at: "2026-07-14T00:00:00.000Z",
		refresh_token: `ceal_refresh_${"R".repeat(43)}`,
		refresh_token_idle_expires_at: "2026-08-12T06:00:00.000Z",
		refresh_token_absolute_expires_at: "2026-10-11T06:00:00.000Z",
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
