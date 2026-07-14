import assert from "node:assert/strict";
import test from "node:test";
import {
	CEAL_PROTOCOL_VERSION,
	CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE,
	negotiateCealProtocol,
} from "../dist/index.js";

test("the declared Gateway range is exactly the protocol this release implements", () => {
	assert.deepEqual(CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE, {
		minimum: CEAL_PROTOCOL_VERSION,
		maximum: CEAL_PROTOCOL_VERSION,
	});
	assert.equal(Object.isFrozen(CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE), true);
});

test("protocol negotiation selects the current implemented version", () => {
	assert.deepEqual(negotiateCealProtocol({ minimum: "1.2.0", maximum: "1.2.0" }), {
		schema_version: "ceal.protocol_negotiation.v1",
		ok: true,
		protocol_version: "1.2.0",
	});
	assert.equal(negotiateCealProtocol({ minimum: "0.9.0", maximum: "1.2.0" }).ok, true);
});

test("protocol negotiation rejects non-overlap without guessing another schema", () => {
	for (const range of [
		{ minimum: "0.8.0", maximum: "0.9.9" },
		{ minimum: "1.3.0", maximum: "2.0.0" },
	]) {
		const result = negotiateCealProtocol(range);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error.code, "incompatible_protocol");
			assert.match(result.error.next_action, /Upgrade the Ceal client or Gateway/u);
		}
	}
});

test("protocol negotiation fails closed on malformed or reversed ranges", () => {
	for (const range of [
		null,
		{},
		"1.2.0",
		{ minimum: 1, maximum: "1.2.0" },
		{ minimum: "1", maximum: "1.2.0" },
		{ minimum: "1.2.0", maximum: "1.2.0-next" },
		{ minimum: "2.0.0", maximum: "1.2.0" },
		{ minimum: "9007199254740992.0.0", maximum: "9007199254740992.0.0" },
	]) {
		const result = negotiateCealProtocol(range);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error.code, "invalid_gateway_protocol_range");
			assert.match(result.error.next_action, /Gateway release metadata/u);
		}
	}
});
