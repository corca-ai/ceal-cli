import test from "node:test";

// The real-binary and installer proofs build a SEA and run an installer, so they
// can only run on the platform they build for. Skipping them is correct; being
// quiet about it is not. On an arm64 macOS host the release suite reported green
// with zero installed-binary proofs, which reads exactly like a host that ran
// them and passed.
//
// So the gap is declared two ways. Every skip names the proof this run does not
// carry, and a runner that is supposed to carry them sets
// CEAL_REQUIRE_PLATFORM_PROOFS=1, which turns the skip into a failure rather
// than trusting the image to still be linux-x64.
export const PLATFORM_PROOF_PLATFORM = "linux-x64";

export function platformProofSkip(proof) {
	if (process.platform === "linux" && process.arch === "x64") return false;
	return `${proof} requires ${PLATFORM_PROOF_PLATFORM}; this run is ${process.platform}-${process.arch} and proves no installed binary`;
}

/**
 * Declare a proof that only runs on the release platform.
 *
 * Use this instead of an inline `process.platform`/`process.arch` skip so the
 * gap is named in the output and the strict-runner escape hatch stays in one
 * place. `test/contract/repo-gates.test.mjs` enforces that.
 */
export function platformProofTest(proof, name, fn) {
	const skip = platformProofSkip(proof);
	availabilityProofTest(proof, name, skip, fn);
}

export function availabilityProofTest(proof, name, unavailable, fn) {
	const skip = unavailable || false;
	if (skip && process.env.CEAL_REQUIRE_PLATFORM_PROOFS === "1") {
		test(name, () => {
			throw new Error(`CEAL_REQUIRE_PLATFORM_PROOFS=1 but ${proof} cannot run here: ${skip}`);
		});
		return;
	}
	test(name, { skip }, fn);
}
