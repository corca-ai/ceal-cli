# Clean-Checkout Reachability Dist Authority Debug Review
Date: 2026-08-13

## Problem

GitHub Actions run `31716363560` failed on Linux and macOS before the build
step because `npm run lint:reachability` tried to read the absent checkout file
`packages/ceal-worker-cli/dist/managed-worker-install.js`.

## Correct Behavior

Given a clean checkout with installed dependencies and no generated `dist`,
when the maintenance reachability gate runs before build, then it analyzes the
editable source graph and returns the same scripts-surface verdict as a dirty
developer checkout. Emitted-artifact behavior remains owned by artifact tests.

## Observed Facts

- Both CI operating systems failed at the same `readFileSync` call in
  `scripts/lib/production-reachability.mjs`.
- Root `npm run check` deliberately orders `lint:reachability` before `build`.
- `scripts/worker-acceptance-packet.mjs` has three static imports from Worker
  checkout `dist`; each has a corresponding `src/*.ts` module.
- The local checkout contained prior build output, so the same gate was green.

## Reproduction

- `git archive HEAD` into a temporary directory, symlink only the declared
  `node_modules`, and run `node scripts/check-production-reachability.mjs`.
- Result: exit 1 with the same missing `dist/managed-worker-install.js` path.

## Candidate Causes

- CI failed to restore a build cache required by the reachability gate.
- The full-gate order accidentally moved build after a compiled-output consumer.
- The reachability walker follows a production artifact import even though its
  scripts-surface verdict is intended to be editable-source authoritative.

## Hypothesis

- The walker has mixed source/artifact authority. If checkout package `dist`
  edges are resolved to existing package source modules, the clean-checkout
  reproduction becomes green without building, while a missing source owner
  fails closed. | disconfirmer: a clean temp checkout still reads `dist` or an
  intentionally missing source candidate silently falls back to compiled bytes.

## Verification

- Confirmed before repair: the clean temp checkout reproduces CI exactly, while
  the dirty local checkout is green.
- Confirmed after repair: a fresh `git archive HEAD` tree overlaid only with the
  current changed paths, linked to the declared dependency set, had no Worker
  `dist`; the reachability gate passed with 19 entries/39 modules and the
  focused source-authority suite passed 16/16 applicable tests (one historical
  git-object proof skipped because an archive intentionally has no `.git`).
- Focused repository proof passed 17/17, including workflow initial-edge source
  normalization and missing-source refusal.

## Root Cause

The maintenance reachability graph treated checkout package `dist` as an
execution authority even though its verdict explicitly excludes package
exports and the gate runs before build. Mutable local artifacts hid the defect;
clean CI exposed it.

## Invariant Proof

- Invariant: when a scripts production entry imports a checkout package
  artifact, the maintenance graph must analyze the current source owner before
  it may claim a clean scripts-surface verdict.
- Producer Proof: `worker-acceptance-packet.mjs` statically imports three Worker
  package artifacts whose source owners exist.
- Final-Consumer Proof: CI `npm run check` is the final gate and failed before
  build on both supported runner families.
- Interface-Shape Sibling Scan: all three checkout package-dist imports occur
  in that one entry; direct script-to-script edges remain unchanged.
- Non-Claims: no production runtime import changes and no emitted package ABI
  claim; those remain artifact-lane proof.

## Detection Gap

- Local full checks reused mutable checkout `dist`; no mutation removed it
  before running the pre-build reachability gate. Add a clean-checkout/source
  authority mutation to the reachability suite.

## Sibling Search

- Mental model: maintenance source verdicts must not depend on mutable emitted
  artifacts.
- same-file: three Worker dist imports | factor now through one resolver | CI log.
- same-package: source loader already maps dist-to-source for behavior tests |
  retain separate owner | mutation-proved source lane.
- artifact lane: release/package tests intentionally consume immutable emitted
  output | retain | isolated artifact proof.
- cross-file: package export reachability fixture currently blesses dist-only
  traversal | replace with source-backed mapping plus no-fallback mutation.

## Seam Risk

- Interrupt ID: clean-checkout-reachability-dist-authority
- Risk Class: external-seam
- Seam: dirty local checkout to clean Linux/macOS GitHub runners.
- Disproving Observation: clean temp checkout passes before repair.
- What Local Reasoning Cannot Prove: hosted runner filesystem semantics beyond
  the reproduced absence; the post-push CI rerun supplies that proof.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-08-13-clean-checkout-reachability-authority.md

## Prevention

Make the reachability walker explicitly source-authoritative for checkout
package edges, fail closed when the source owner is absent, and keep emitted
artifact verification in the isolated artifact lane.
