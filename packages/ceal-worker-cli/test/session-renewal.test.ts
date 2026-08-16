import assert from "node:assert/strict";
import test from "node:test";
import { requireCealCallRenewalMode, requireCealSessionRenewalMode } from "../dist/session-renewal.js";
import type { CealSessionRenewalMode } from "../src/session-renewal.ts";

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
	assert.throws(() => Reflect.apply(requireCealSessionRenewalMode, undefined, ["unexpected"]), { name: "TypeError" });
});

test("capability call renewal rejects omission or observe before fake session or transport work", () => {
	let sessionReads = 0;
	let transportRequests = 0;
	let sessionWrites = 0;
	const attempt = (mode: CealSessionRenewalMode | undefined) => {
		requireCealCallRenewalMode(mode);
		sessionReads += 1;
		transportRequests += 1;
		sessionWrites += 1;
	};

	for (const mode of [undefined, "observe"] satisfies readonly (CealSessionRenewalMode | undefined)[]) {
		assert.throws(() => attempt(mode), { name: "TypeError", message: /explicit renew session mode/u });
	}
	assert.equal(sessionReads, 0);
	assert.equal(transportRequests, 0);
	assert.equal(sessionWrites, 0);
	assert.equal(requireCealCallRenewalMode("renew"), "renew");
});
