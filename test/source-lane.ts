// Who owns the "am I running through the source lane?" fact.
//
// `packages/ceal-worker-cli/test/*` imports its runtime as `../dist/*.js`, which
// is deliberate: the suites bind the same specifier shape a consumer of the
// published package binds. `test/source-loader.ts` is what makes that safe — it
// resolves those specifiers to `packages/*/src/*.ts` and transforms them, so the
// lane never reads emitted output at all, and it throws outright if anything
// still resolves through checkout `dist`.
//
// That guard only exists while the loader is registered. Run one of those files
// directly — `node --test packages/ceal-worker-cli/test/local-store-lock.test.ts`
// — and there is no loader, so `../dist/*.js` binds real emitted bytes: whatever
// a previous `npm run build` happened to leave behind. The suite passes. It is
// testing code that may be days old and is not the code you just edited.
//
// That is not hypothetical. On 2026-08-22 a mutation matrix reported two guard
// operands as untested, twice, from runs executing a three-day-old `dist`; the
// source had the operand removed and the `dist` still had it. Both verdicts were
// void, and nothing in the output said so — a green arm and a stale artifact
// look identical. It is the same root class as the 2026-08-13 clean-checkout
// reachability defect, whose recorded cause was "mutable local artifacts hid the
// defect" and whose prevention covered the reachability walker but not this lane.
//
// So the marker is set by the LOADER, not by `run-source-tests.ts`: the two
// lanes start differently (`ceal-worker-cli` through the runner,
// `ceal-client` through a bare `--import`), and only the loader is common to
// both. It is a `globalThis` symbol rather than an environment variable on
// purpose — several of these suites spawn child node processes, and an env
// marker would be inherited by a child that has no loader registered, which is
// exactly the false pass this exists to prevent.

const SOURCE_LANE = Symbol.for("ceal.source_test_lane");

type MarkedGlobal = typeof globalThis & { [SOURCE_LANE]?: true };

/** Record that the source lane's loader hooks are registered in this process. */
export function markSourceLane(): void {
	(globalThis as MarkedGlobal)[SOURCE_LANE] = true;
}

/** Whether the source lane's loader hooks are registered in this process. */
export function inSourceLane(): boolean {
	return (globalThis as MarkedGlobal)[SOURCE_LANE] === true;
}

/**
 * Refuse to run a package suite outside the source lane.
 *
 * Both packages need the lane, for different reasons, and BOTH failure modes are
 * bad in a way this message is meant to replace:
 *
 * - `ceal-worker-cli` binds `../dist/*.js`, so without the loader it silently
 *   binds stale emitted output and PASSES against code nobody edited.
 * - `ceal-client` binds `../src/*.ts`, which cannot bind stale output — but its
 *   modules import siblings as `./x.js`, and nothing maps those to `.ts` outside
 *   the lane, so it dies on an unresolvable specifier that names neither the
 *   lane nor the command to use.
 *
 * The second is merely cryptic rather than wrong, and it is inconsistent besides:
 * a leaf module with no internal imports happens to run standalone, so whether a
 * bypass "works" depends on an accident of the module graph. One rule for both
 * packages removes that accident.
 */
export function assertSourceLane(): void {
	if (inSourceLane()) return;
	throw new Error(
		[
			"This suite's imports are resolved by the source lane, and no loader is",
			"registered in this process. The lane maps package `dist` specifiers to",
			"`src`, resolves intra-package `./x.js` to `./x.ts`, and transforms the",
			"TypeScript it loads.",
			"",
			"Run one of:",
			"  npm --prefix packages/ceal-worker-cli test",
			"  npm --prefix packages/ceal-client test",
			"  node test/run-source-tests.ts <test-file> [...]",
			"",
			"A bare `node --test <test-file>` cannot work here, and for a suite that",
			"binds `../dist/*.js` it is worse than not working: it would PASS against",
			"whatever emitted output the last build left on disk. Running",
			"`npm run build` first does not fix that — it only makes the stale bytes",
			"fresher bytes, still not the source you are editing.",
		].join("\n"),
	);
}
