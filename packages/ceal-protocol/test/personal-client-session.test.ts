import assert from "node:assert/strict";
import test from "node:test";
import {
	decodeCealClientRefreshRequest,
	decodeCealClientRefreshResponse,
	decodeCealClientRevokeRequest,
	decodeCealClientRevokeResponse,
} from "../dist/index.js";

const REFRESH = `ceal_refresh_${"R".repeat(43)}`;
const ACCESS = `ceal_personal_${"A".repeat(43)}`;
const BINDING = {
	profile_ref: "profile:work",
	membership_ref: "membership:narnia",
	registration_ref: "registration:narnia",
	client_ref: "client:narnia",
	subject_ref: "subject:hwidong",
	instance_ref: "instance:ceal-dev",
};

test("personal-client refresh and revoke messages have one strict secret-safe shape", () => {
	assert.equal(decodeCealClientRefreshRequest({
		schema_version: "ceal.client_refresh_request.v1",
		refresh_token: REFRESH,
		client: { name: "ceal", version: "0.65.0" },
	}).refresh_token, REFRESH);
	const refreshed = decodeCealClientRefreshResponse({
		schema_version: "ceal.client_refresh_result.v1",
		ok: true,
		...BINDING,
		access_token: ACCESS,
		expires_at: "2026-07-13T06:15:00.000Z",
		refresh_token: REFRESH,
		refresh_token_idle_expires_at: "2026-08-12T06:00:00.000Z",
		refresh_token_absolute_expires_at: "2026-10-11T06:00:00.000Z",
	});
	assert.equal(refreshed.ok, true);
	assert.equal(decodeCealClientRevokeRequest({
		schema_version: "ceal.client_revoke_request.v1",
		refresh_token: REFRESH,
	}).refresh_token, REFRESH);
	assert.deepEqual(decodeCealClientRevokeResponse({
		schema_version: "ceal.client_revoke_result.v1", ok: true, revoked: true,
	}), { schema_version: "ceal.client_revoke_result.v1", ok: true, revoked: true });
});

test("personal-client session decoders reject drift and preserve stable recovery failures", () => {
	assert.throws(() => decodeCealClientRefreshRequest({
		schema_version: "ceal.client_refresh_request.v1", refresh_token: "short", client: { name: "ceal", version: "0.65.0" },
	}));
	assert.throws(() => decodeCealClientRefreshResponse({
		schema_version: "ceal.client_refresh_result.v1", ok: true, ...BINDING,
		access_token: ACCESS, expires_at: "2026-07-13T06:15:00.000Z", refresh_token: REFRESH,
		refresh_token_idle_expires_at: "2026-08-12T06:00:00.000Z",
		refresh_token_absolute_expires_at: "2026-10-11T06:00:00.000Z", extra: true,
	}));
	const failure = decodeCealClientRefreshResponse({
		schema_version: "ceal.client_refresh_result.v1",
		ok: false,
		error: { code: "refresh_replayed", message: "The session cannot be refreshed.", next_action: "Enroll again." },
	});
	assert.equal(failure.ok, false);
	if (!failure.ok) assert.equal(failure.error.code, "refresh_replayed");
});

test("revoke response decoder does not accept refresh-only recovery failures", () => {
	assert.throws(() => decodeCealClientRevokeResponse({
		schema_version: "ceal.client_revoke_result.v1",
		ok: false,
		error: { code: "refresh_recovery_unavailable", message: "Recovery is unavailable.", next_action: "Try later." },
	}));
});
