/**
 * Environment for a child that is a *toolchain* — a compiler, a package manager,
 * a packer — rather than repo-owned script code.
 *
 * `NODE_V8_COVERAGE` is inherited by every descendant, so running the release and
 * contract tiers under c8 put every `tsc` and every `npm` those tiers spawn under
 * the V8 collector too. None of that lands in the measured surface: the scripts
 * coverage run remaps onto `scripts/**` and discards the rest, so the profiles
 * were written, read, and thrown away. They were most of the bytes.
 *
 * Reproduce the waste with `NODE_V8_COVERAGE=/tmp/cc npm run test:release` and
 * read the first `file:` URL of each profile under `/tmp/cc`.
 *
 * The check that this strip is correct is falsifiable and cheap: run
 * `npm run coverage:scripts` before and after and compare
 * `coverage/scripts/coverage-summary.json`. If any figure moves, some child WAS
 * contributing measured coverage and must keep the variable.
 *
 * It is also right on its own terms, independent of speed: a release build should
 * not inherit its caller's coverage collector, because the artifact it produces
 * is supposed to be a function of its inputs and nothing else.
 */
export function toolchainEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const { NODE_V8_COVERAGE: _collector, ...rest } = base;
	return rest;
}
