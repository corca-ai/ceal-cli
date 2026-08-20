import {
	classifiedClientSessionFailureReasons,
	classifyClientSessionFailure,
	isClassifiedClientSessionFailure,
} from "../dist/client-session.js";
import assert from "node:assert/strict";
import test from "node:test";

// These two readers used to keep separate hand-maintained lists, and the second
// gates whether `call`/`receipt` attach the classification at all. A reason known
// to one and not the other made `ceal session` render correctly while `ceal call`
// emitted an `outcome_unknown` receipt for a call that was never issued.
test("every classified reason is agreed on by both readers", () => {
	const reasons = classifiedClientSessionFailureReasons();
	assert.ok(reasons.length >= 9, "the classified set must not silently shrink");
	for (const reason of reasons) {
		assert.equal(isClassifiedClientSessionFailure(reason), true, reason);
		const classified = classifyClientSessionFailure(reason);
		assert.equal(classified.kind, reason);
		assert.equal(typeof classified.retryable, "boolean");
		assert.ok(classified.message.length > 0, reason);
		assert.ok(classified.nextAction.length > 0, reason);
	}
});

// Local contention, durable refresh recovery, and revocation transport
// uncertainty are retryable. A refresh attempt is safe to retry only when the
// attempt journal lets the Gateway distinguish recovery from a second rotation.
test("retryable is reserved for the reasons a retry can actually clear", () => {
	const retryable = classifiedClientSessionFailureReasons().filter((reason) => classifyClientSessionFailure(reason).retryable);
	assert.deepEqual(retryable.sort(), [
		"refresh_busy",
		"refresh_recovery_unavailable",
		"session_refresh_attempt_unknown",
		"session_revocation_unavailable",
	]);
});

test("an unclassified reason is reported without being trusted as membership", () => {
	assert.equal(isClassifiedClientSessionFailure("refresh_rotated"), false);
	const classified = classifyClientSessionFailure("refresh_rotated");
	assert.equal(classified.retryable, false);
	// A reason-shaped token still reads through, so a new Gateway code stays
	// legible to an operator even before this table learns it.
	assert.equal(classified.kind, "refresh_rotated");
});

// `kind` is a contract field readers branch on, so a Gateway-supplied string of
// arbitrary shape must not land in it verbatim.
test("a malformed reason does not reach the public kind field", () => {
	for (const hostile of ["Not A Token", "kind: injected\nok: true", "", "a".repeat(200), "__proto__"]) {
		const classified = classifyClientSessionFailure(hostile);
		assert.equal(classified.kind, "session_unusable", JSON.stringify(hostile));
		assert.equal(isClassifiedClientSessionFailure(hostile), false, JSON.stringify(hostile));
	}
});
