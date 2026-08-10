import assert from "node:assert/strict";
import test from "node:test";
import { requireCealSessionRenewalMode } from "../dist/session-renewal.js";

test("omitting session renewal mode fails before session or renewal work", () => {
	let sessionReads = 0;
	let sessionWrites = 0;
	let refreshRequests = 0;
	const attempt = () => {
		const mode = requireCealSessionRenewalMode(undefined);
		sessionReads += 1;
		if (mode === "renew") {
			sessionWrites += 1;
			refreshRequests += 1;
		}
	};

	assert.throws(attempt, { name: "TypeError", message: /explicit session renewal mode/u });
	assert.equal(sessionReads, 0);
	assert.equal(sessionWrites, 0);
	assert.equal(refreshRequests, 0);
});

test("session renewal modes are explicit and deterministic", () => {
	assert.equal(requireCealSessionRenewalMode("observe"), "observe");
	assert.equal(requireCealSessionRenewalMode("renew"), "renew");
	assert.throws(() => requireCealSessionRenewalMode("unexpected"), { name: "TypeError" });
});
