# Clean-Checkout Reachability Authority

## Problem

The pre-build production-reachability lint traverses mutable checkout `dist`.
It therefore passes after a local build but crashes in a clean checkout, making
the gate's verdict depend on unrelated prior state.

## Capability Contract

The maintenance graph answers which repo-owned scripts and script exports are
reachable from production entries. Package implementation edges are traversed
through current source; emitted package ABI and executable behavior stay in the
immutable artifact lane.

## Current Slice

Resolve static edges into checkout `packages/<name>/dist/*.js` to their exact
`packages/<name>/src/*.ts` owners, including subsequent source-local `.js`
specifiers. Refuse an expected source owner that is absent. Do not change
production imports, release artifacts, package exports, or check ordering.
Close the two macOS portability siblings exposed only after the clean-checkout
gate advanced: single-shot hard process-group settlement and canonical direct
CLI path identity.

## Fixed Decisions

- Source is the only authority for this pre-build maintenance gate.
- No source-to-dist fallback is allowed when a source candidate is expected.
- The scripts-only unreachable-export verdict remains unchanged.

## Probe Questions

- Does any current production entry import a generated package module with no
  source owner? The implementation inventory must answer before generalizing.

## Deferred Decisions

- Converting production runtime imports from built packages to TypeScript
  source is outside this maintenance-gate repair.

## Non-Goals

- Reordering `build` before lint.
- Committing checkout `dist`.
- Weakening or removing production reachability.

## Deliberately Not Doing

- A fallback that reads `dist` when source mapping fails; that recreates the
  dirty-checkout false green.
- A broad shared resolver abstraction before a second production owner needs it.

## Constraints

- Exact path mapping only; no speculative package-name resolution.
- Clean checkout proof must not build.
- Existing artifact tests continue to consume isolated emitted output.

## Success Criteria

- Complete: the clean archived checkout reproduction passes with no `dist`
  directory.
- Complete: poisoned or stale `dist` cannot change the reachability verdict.
- Complete: missing mapped source fails closed with a named error, including an
  inline workflow's initial target.
- Complete: the repository still has zero unreachable scripts surfaces.

## Acceptance Checks

- `unit`: resolver mutation covers source-present/dist-absent and poisoned-dist.
- `unit`: mapped source absent is rejected, not skipped or downgraded.
- `integration`: archived clean checkout plus dependencies runs
  `scripts/check-production-reachability.mjs` without build.
- `e2e`: exact pushed commit passes Linux and macOS GitHub `Check` jobs.
- `integration`: timeout/output-limit/descendant audit behavior and the actual
  acceptance CLI process entry remain green on both runner families.

## Boundary Ownership

`scripts/lib/production-reachability.mjs` owns the maintenance graph;
`test/contract/production-reachability.test.mjs` owns its mutations; artifact
builders own emitted-output proof.

## Critique

- Interrupt Source: `debug` external-seam risk interrupt after CI run
  `31716363560` disproved local full-gate evidence.
- Seam Summary: mutable local `dist` hid a pre-build clean-checkout failure.
- Chosen Next Step: source-authoritative resolver plus clean-checkout mutation.
- Impl Status: ready.
- Impl Status Reason: implemented and locally proved; fresh-eye found and closed
  the workflow initial-edge omission. Hosted CI readback follows the commit.
- What Disproving Observation Is Resolved: clean checkout must no longer read
  or require mutable package `dist`.

## Canonical Artifact

This file remains the repair contract through the post-push CI readback.

## First Implementation Slice

Commit the proved source-authority repair, push it, and require the exact Linux
and macOS `Check` jobs to pass before resuming the release dry-run.
