# AMD64 Worker Release Fixture Repair

## Problem

The first static-origin worker release tag, `ceal-v0.65.2`, reached the GitHub
amd64 source gate but did not publish because its real-native test requested a
stale package version. The local ARM gate intentionally skips that
architecture-specific proof.

## Capability Contract

A worker version bump must be able to reach the signed static-origin release
workflow without a separately maintained integration-test version literal
blocking its amd64 build. A failed build must continue to stop before release
assembly, signing, R2 upload, or stable-pointer promotion.

## Current Slice

Derive the real-native test's requested worker version from the same worker
package manifest that the artifact builder verifies, publish a replacement
immutable tag `ceal-v0.65.3`, and prove the signed static-origin install and
option-free `ceal update` path.

## Fixed Decisions

- `ceal-v0.65.2` remains an immutable, unpublished failed tag; it is never
  retagged or promoted.
- The test reads `packages/ceal-worker-cli/package.json`; it does not copy a
  release literal or weaken the artifact builder's mismatch rejection.
- `ceal-v0.65.3` is the only replacement publication candidate.
- GitHub Actions is the required amd64 gate and R2 publication boundary;
  local ARM success alone is not release proof.

## Probe Questions

- Does the replacement tag complete the amd64 gate and publish a valid static
  release set? Answer through the tag workflow and public readback.

## Deferred Decisions

- Cross-architecture local execution remains outside this repair; GitHub's
  amd64 runner is the retained authoritative lane.

## Non-Goals

- Changing the worker artifact version invariant.
- Retagging `ceal-v0.65.2` or mutating any published release object.
- Gateway connection, enrollment, or provider-action proof.

## Deliberately Not Doing

- Adding a second version source or a special ARM emulation test merely to
  duplicate the retained amd64 release gate.

## Constraints

- The worker package manifest remains source authority for its version.
- A GitHub Actions failure must leave no static release state mutation.
- Publication goes only through the existing signed static-origin workflow.

## Success Criteria

- The real-native test obtains its requested version from the worker manifest.
- `npm run check` passes locally, with the known ARM-only skips recorded.
- The `ceal-v0.65.3` Actions run completes its amd64 gate and the signed static
  publication job.
- The public stable pointer selects `ceal-v0.65.3`, and a fresh temporary
  installation completes `ceal version` and `ceal update` without GitHub
  release downloads.

## Acceptance Checks

- Verification type: unit — run the focused artifact and installer tests.
- Verification type: integration — run `npm run check` and inspect the amd64
  GitHub Actions release gate.
- Verification type: e2e — install from the public stable bootstrap into a
  temporary directory, then run `ceal version` and `ceal update`.

## Boundary Ownership

The `ceal-cli` repository owns the worker package manifest, real-native test,
tag workflow, and worker static-origin distribution. The gateway repository
does not own this worker publication slice.

## Critique

- Interrupt Source: `charness-artifacts/debug/latest.md` /
  `release-amd64-version-fixture`.
- Seam Summary: local ARM tests cannot disprove the GitHub amd64 publication
  gate.
- Chosen Next Step: spec.
- Impl Status: implemented locally; external tag proof pending.
- Impl Status Reason: the requested version is source-derived, but only a new
  immutable amd64 runner can prove the exact release boundary.
- What Disproving Observation Is Resolved: a successful replacement tag must
  no longer emit `version_mismatch` from the real-native test.

## Canonical Artifact

This document is the handoff contract for the current debug interrupt. The
debug record remains the causal evidence source.

## First Implementation Slice

Commit the source-derived fixture and `0.65.3` version bump, run the local
gate, perform a bounded fresh-eye review, then push and tag `ceal-v0.65.3` for
the required amd64 release proof.
