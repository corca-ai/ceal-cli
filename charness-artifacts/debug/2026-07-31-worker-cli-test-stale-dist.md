# Worker CLI Test Stale Dist Debug
Date: 2026-07-31

## Problem

`npm --prefix packages/ceal-worker-cli test` exits with code 2 before running
worker tests. `pretest` invokes `tsc -p tsconfig.build.json`, which reports
missing exports from `@corca-ai/ceal` and `@corca-ai/ceal-protocol`.

## Correct Behavior

Given the workspace source and package versions are aligned, when the worker
test command runs, then dependency declarations must expose the same exports
as their source and the worker build and tests must complete.

## Observed Facts

- `packages/ceal-worker-cli/package.json` runs `pretest: npm run build`.
- The initial build reported missing adoption exports, enrollment exports,
  `CealGatewayAnnouncementPolicy`, and `gateway_elapsed_ms`.
- `npm ls` resolves both dependencies to workspace packages at `@corca-ai/ceal`
  0.70.0 and `@corca-ai/ceal-protocol` 0.68.0.
- The source packages contain all reported exports.
- Before rebuilding dependencies, `packages/ceal-client/dist/index.d.ts` was
  1568 bytes and `packages/ceal-protocol/dist/index.d.ts` was from Jul 24 and
  lacked the new declaration files.

## Reproduction

- Run `npm --prefix packages/ceal-worker-cli test` with the existing stale
  dependency `dist` trees. `tsc` fails before `node --test` starts.
- Run `npm run build --workspace @corca-ai/ceal-protocol && npm run build
  --workspace @corca-ai/ceal`, then repeat the worker command. The build
  succeeds and the worker test suite passes.

## Candidate Causes

- Stale ignored `dist` output in the workspace is selected through each
  package's `types: ./dist/index.d.ts` export.
- A package version or lockfile mismatch supplies declarations from a different
  protocol/client pair.
- The worker source imports exports that were added in source but dependency
  packages were not rebuilt after the source update.

## Hypothesis

- The dependency declaration trees are stale; rebuilding the client and
  protocol packages should make the missing exports visible and turn the worker
  test command green. Disconfirmer: a clean dependency build followed by the
  same worker command still fails with the same export errors.

## Verification

- Confirmed. `npm ls` showed the expected workspace versions, ruling out a
  dependency-version mismatch.
- After rebuilding both dependency packages, the worker build completed and
  `npm --prefix packages/ceal-worker-cli test` completed successfully (164
  tests observed in the output).

## Root Cause

The workspace had stale, ignored declaration output under
`packages/ceal-client/dist` and `packages/ceal-protocol/dist`. Their package
exports point TypeScript at those generated declarations, not directly at
`src`, so the worker saw an older public API even though current source files
already exported the required symbols.

## Invariant Proof

- Invariant: a workspace package's generated `types` target must reflect its
  current source exports before a dependent package is type-checked.
- Producer Proof: rebuilding the client and protocol packages emitted the
  adoption, enrollment, announcement-policy, and timing declarations.
- Final-Consumer Proof: the worker build and its complete local test command
  passed after the rebuild.
- Interface-Shape Sibling Scan: both dependency packages use the same
  `types: ./dist/index.d.ts` contract and both exhibited the stale-output shape.
- Non-Claims: this proves local source/build/test behavior only; it is not
  released-binary or live Gateway/provider proof.

## Detection Gap

- `npm --prefix packages/ceal-worker-cli test` | worker pretest assumes dependency
  dist is current and fails with indirect export errors | build workspace
  dependencies first, or add a documented root preparation gate that does so.
- `npm ls` | correctly showed workspace versions but not declaration freshness |
  no version-only check can detect stale ignored generated output.

## Sibling Search

- Mental model: workspace package metadata names generated output as the public
  type surface, while local iteration can leave that output stale.
- same layer: `packages/ceal-client/package.json` and
  `packages/ceal-protocol/package.json` | decision: same bug, fix now | proof:
  both use `types: ./dist/index.d.ts` and both required rebuilds.
- abstraction up: root `npm run check:unit` | decision: same class,
  diagnostic-only for this slice | proof: not rerun; likely shares the same
  generated-output precondition and should be checked by the repo's normal
  preparation workflow.
- specialization down: `packages/ceal-worker-cli/tsconfig.build.json` |
  decision: intentional plain-text or non-rendering boundary | proof: static
  inspection; it correctly resolves package declarations and is not the cause.
- cross-file: `packages/ceal-client/package.json` | decision: same bug, fix now |
  proof: static package export plus successful rebuild retest.

## Seam Risk

- Interrupt ID: worker-test-stale-generated-declarations
- Risk Class: none
- Seam: local workspace generated-output freshness
- Disproving Observation: rebuilding both dependencies made the same command pass
- What Local Reasoning Cannot Prove: published package tarballs and CI checkout
  preparation independently reproduce the local stale-output state
- Generalization Pressure: monitor

## Interrupt Decision

- Resolution: resolved
- Critique Required: no
- Next Step: impl
- Handoff Artifact: none

## Prevention

For local worker iteration, rebuild the workspace dependencies before the worker
test when their source exports changed. A future improvement would make the root
worker gate establish this generated-output precondition explicitly; no source
fix was requested or made in this diagnosis.
