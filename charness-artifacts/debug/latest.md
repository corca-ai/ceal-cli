# Native Platform Binary Smoke Debug Review
Date: 2026-07-13

## Problem

At `aab75f7677c1a8bcf7ce54c1e211f71859f3c43c`, the native Linux AMD64
`release:binaries` build exits with `smoke_failed`: “Built command discovery
omitted a required enrollment workflow command.”

## Correct Behavior

Given a clean native checkout at the pushed CLI commit, when the operator runs
`release:binaries`, then the produced `ceal` and `cealctl` binaries expose the
current profile/enrollment, renewal, and capability-call surfaces and the smoke
gate succeeds without a separate undocumented build step.

## Observed Facts

- Narnia is Linux AMD64 and is at the exact pushed commit.
- Package and lock files did not change across the user's prior successful build.
- TypeScript source at this commit includes `ceal profiles`, `ceal call`, session
  refresh, and `cealctl enrollments`.
- The failing command used a new output directory, excluding output replacement
  as the immediate cause.

## Reproduction

- `git check-ignore -v packages/{ceal-worker-cli,ceal-operator-cli}/dist/bin.js`
  proves both packaged entrypoints are ignored local state.
- Current compiled entrypoints discover worker `call`/profile `logout` and operator
  `login`/`profiles`/`logout`; the pre-existing ignored `dist-arm64` binaries omit
  exactly those later commands.
- `scripts/build-platform-binaries.mjs:51-58,182-185` prepares the output and
  bundles those ignored entrypoints without compiling them first.

## Candidate Causes

- State: the release builder packages an ignored/stale compiled `dist` tree left
  from an earlier checkout instead of compiling current source.
- Control flow: the smoke assertion requires the wrong command on the wrong
  binary or was not updated with the new surface grammar.
- Environment/dependency: native packaging cache or workspace resolution selects
  an older installed package despite the current source checkout.

## Hypothesis

- If stale compiled input is the cause, a current source build will change the
  packaged command discovery and make the same native release command pass;
  disconfirmer: an old native binary whose discovery already contains all required
  commands, or a builder path that compiles before bundling.

## Verification

- confirmed — the cheapest falsifier failed: the ignored ARM64 binaries omit the
  newly required commands while current compiled entrypoints contain them, and no
  source-build call exists on the release-builder path.
- Claim type: attribution
- Candidate claim: caller-local stale compiled entrypoints caused the smoke failure.
- Cheapest falsifier: compare current compiled discovery with a pre-existing native
  artifact and search the builder for a compile-before-bundle step.
- Result: confirmed
- Corrected producer proof: `npm run check` passes all package and root suites;
  a native ARM64 `release:binaries` run succeeds after clean compilation, both
  command-discovery surfaces include the current workflows, and all four emitted
  checksums verify.

## Root Cause

1. The native artifact failed discovery because it omitted required commands.
2. It omitted them because the SEA bundle was assembled from an older `dist/bin.js`.
3. That older file survived `git pull` because every package `dist/` is ignored.
4. The release builder only checked that the compiled file existed, not that it was
   produced from the current checkout.
5. The root script and README made `npm run build` an implicit caller sequencing
   requirement instead of a producer-owned invariant.

Structural cause: the final release producer did not own the freshness of its
generated input, so file existence was incorrectly treated as source provenance.

## Invariant Proof

- Invariant: release artifacts must derive from the checked-out source commit,
  not caller-local ignored build state.
- Producer Proof: `package.json:15,19` separates `build` from `release:binaries`,
  while `scripts/build-platform-binaries.mjs:182-185` consumes ignored `dist` by
  existence only.
- Final-Consumer Proof: the native smoke at `scripts/build-platform-binaries.mjs:218-230`
  refused the stale AMD64 binary; the preserved ARM64 binary independently shows
  the same stale discovery shape.
- Interface-Shape Sibling Scan: both worker and operator entrypoints share the same
  builder; both native platforms share the same script. The tag workflow happens
  to run `npm run check` first, but direct/local release use does not.
- Non-Claims: fixed ARM64 proof will not itself prove the next AMD64 artifact; Narnia
  must rerun the corrected producer for native AMD64 evidence.

## Detection Gap

- Unit tests replace bundling with a fake and therefore never exercised compiled-input
  production. The tag workflow's preceding `npm run check` masked the missing
  ownership. Smallest durable prevention: make the builder invoke the source build
  once before output preparation/bundling and test that ordering.

## Sibling Search

- Mental model: generated-input existence is not generated-input freshness.
- same layer, `scripts/build-platform-binaries.mjs` worker/operator entrypoints and
  ARM64/AMD64 targets | decision: same bug, fix now | proof: local payload proof.
- abstraction up, `.github/workflows/cealctl-release.yml` calls `npm run check`
  before two assemblies | decision: same class, diagnostic-only for this slice;
  workflow is currently safe but should rely on the builder invariant | proof:
  static scan only.
- specialization down, missing and stale `dist` must both converge on one owned build
  step | decision: same bug, fix now | proof: local payload proof.
- cross-file: `README.md` documents `npm run check` as a prerequisite and
  `package.json` exposes a standalone release script | decision: same bug, fix now |
  proof: static scan only.

## Seam Risk

- Interrupt ID: native-platform-release-smoke
- Risk Class: host-disproves-local
- Seam: source checkout to generated package input to native binary smoke.
- Disproving Observation: AMD64 host rejected a commit whose source-level tests passed.
- What Local Reasoning Cannot Prove: native AMD64 artifact behavior without Narnia.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-07-13-native-platform-release-input-seam.md

## Prevention

- The release producer removes all consumed package build trees and compiles the
  current checkout exactly once before touching output or bundling either command.
- A read-only preflight rejects output/build-tree overlap and symlink aliases before
  cleanup can mutate either side.
- Unit coverage proves build-before-bundle ordering, stale eviction, output
  preservation, path isolation, structured failure, and final smoke diagnostics.
- Operator docs state that `release:binaries` owns compilation; `npm run check`
  remains the broader pre-release test gate, not a hidden correctness prerequisite.
