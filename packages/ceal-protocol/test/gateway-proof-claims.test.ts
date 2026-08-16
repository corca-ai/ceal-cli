import assert from "node:assert/strict";
import test from "node:test";
import {
	CEAL_GATEWAY_HOST_NON_CLAIM_ORDER,
	CEAL_GATEWAY_MANDATORY_NON_CLAIM,
	CEAL_GATEWAY_PROOF_AXES,
	CEAL_GATEWAY_PROOF_AXIS_NON_CLAIMS,
	cealGatewayProofAxisState,
	isValidCealGatewayHostNonClaims,
} from "../dist/index.js";

// The three facts `proof_level: "host_decision"` ran together. The test that
// matters is not that three names exist but that the three MOVE INDEPENDENTLY:
// an ordinal could not express provider-reached-but-audit-not, and that state is
// the one a post-provider audit-append failure actually produces.
test("the three proof axes are independent, not a ladder", () => {
	assert.deepEqual([...CEAL_GATEWAY_PROOF_AXES], ["host_decision", "provider_execution", "production_audit"]);
	assert.deepEqual(cealGatewayProofAxisState(["provider_execution_not_reached", "production_audit_not_reached"]), {
		host_decision: "reached", provider_execution: "not_reached", production_audit: "not_reached",
	});
	assert.deepEqual(cealGatewayProofAxisState(["production_audit_not_reached"]), {
		host_decision: "reached", provider_execution: "reached", production_audit: "not_reached",
	});
	// Every axis carries its own denial token except the one an accepted response
	// has always reached, so no token can ever contradict `host_decision`.
	assert.deepEqual({ ...CEAL_GATEWAY_PROOF_AXIS_NON_CLAIMS }, {
		host_decision: null,
		provider_execution: "provider_execution_not_reached",
		production_audit: "production_audit_not_reached",
	});
	assert.deepEqual(
		CEAL_GATEWAY_PROOF_AXES.map((axis) => CEAL_GATEWAY_PROOF_AXIS_NON_CLAIMS[axis]).filter((token) => token !== null),
		[...CEAL_GATEWAY_HOST_NON_CLAIM_ORDER],
		"canonical emission order must follow the axis order, or two equal claims stop being byte-identical",
	);
});

// The half that was never written down: a MISSING non-claim is a positive claim,
// so an empty array is the strongest possible response rather than the weakest.
test("absence of a non-claim is the positive claim, so an empty array is refused as maximal", () => {
	assert.equal(cealGatewayProofAxisState([]).provider_execution, "reached");
	assert.equal(cealGatewayProofAxisState([]).production_audit, "reached");
	assert.equal(isValidCealGatewayHostNonClaims([], { mayBeReached: true, wasReached: true }), false);
	assert.equal(CEAL_GATEWAY_MANDATORY_NON_CLAIM, "production_audit_not_reached");
	// The mandatory axis holds under every disposition: nothing on this boundary
	// can prove the production ledger recorded the call.
	for (const disposition of [{}, { mayBeReached: true }, { wasReached: true }, { mayBeReached: true, wasReached: true }]) {
		assert.equal(isValidCealGatewayHostNonClaims(["provider_execution_not_reached"], disposition), false, JSON.stringify(disposition));
	}
});

test("provider-reach disposition belongs to the caller, never to the response", () => {
	const denied = ["provider_execution_not_reached", "production_audit_not_reached"];
	const claimed = ["production_audit_not_reached"];
	// Default: the response must deny provider execution.
	assert.equal(isValidCealGatewayHostNonClaims(denied), true);
	assert.equal(isValidCealGatewayHostNonClaims(claimed), false);
	// `mayBeReached` widens to a choice, not to an obligation.
	assert.equal(isValidCealGatewayHostNonClaims(denied, { mayBeReached: true }), true);
	assert.equal(isValidCealGatewayHostNonClaims(claimed, { mayBeReached: true }), true);
	// `wasReached` is the caller asserting the provider WAS reached, so denying
	// it would be a false non-claim rather than a conservative one.
	assert.equal(isValidCealGatewayHostNonClaims(denied, { wasReached: true }), false);
	assert.equal(isValidCealGatewayHostNonClaims(claimed, { wasReached: true }), true);
});

test("non_claims is a canonically ordered set of known tokens", () => {
	assert.equal(isValidCealGatewayHostNonClaims(["production_audit_not_reached", "provider_execution_not_reached"]), false, "reversed order");
	assert.equal(isValidCealGatewayHostNonClaims(["provider_execution_not_reached", "provider_execution_not_reached", "production_audit_not_reached"]), false, "duplicate");
	assert.equal(isValidCealGatewayHostNonClaims(["production_audit_not_reached", "live_provider_dispatch_not_reached"], { mayBeReached: true }), false, "unknown token");
	for (const shape of [null, undefined, "production_audit_not_reached", { 0: "production_audit_not_reached", length: 1 }]) {
		assert.equal(isValidCealGatewayHostNonClaims(shape, { mayBeReached: true }), false, JSON.stringify(shape) ?? "undefined");
	}
});
