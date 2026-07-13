# Native Platform Release Input Contract

Date: 2026-07-13

## Problem

`release:binaries` can package ignored, caller-local `dist/bin.js` files that do
not match the checked-out source. A pull can therefore leave a buildable but stale
release candidate whose final smoke fails only after expensive SEA assembly.

## Capability Contract

An operator can invoke one native release command from an installed checkout and
receive binaries derived from that checkout's current source, without remembering
a separate compilation sequence.

## Current Slice

Move compilation ownership into the platform-binary producer, preserve native
platform/version/output safety, improve missing-command diagnostics, and cover the
producer-to-bundle ordering with deterministic tests.

## Fixed Decisions

- `release:binaries` compiles the monorepo once before output preparation and before
  bundling either command.
- Both direct script invocation and the npm alias use the same invariant.
- The final binary smoke remains authoritative and still checks both command sets.
- The builder remains native-only and emits no external writes.

## Probe Questions

- Resolved: a dependency-injected source-build seam proves invocation ordering;
  an exported current-source producer fixture additionally pre-seeds and evicts
  stale outputs before its injected compiler runs.

## Deferred Decisions

- Reproducible-build provenance beyond the existing two-assembly workflow.
- Non-Linux native platforms.

## Non-Goals

- Publishing a tag, npm package, draft release, or installer.
- Replacing the existing final binary smoke with source-level assertions.
- Proving AMD64 behavior on an ARM64 host.

## Deliberately Not Doing

- A timestamp or git-dirty heuristic: neither proves that ignored output matches
  source and both preserve caller-state ambiguity.
- A package-script-only `npm run build && ...` wrapper: direct script callers would
  retain the bug.
- A public `--skip-build` escape hatch: it would recreate the unsafe state as a
  supported operator path.

## Constraints

- Compilation starts only after all consumed package outputs are removed; failure
  must occur before the release output directory is created or replaced.
- Before cleanup, a read-only preflight rejects any release output path that is
  equal to, inside, or an ancestor of a consumed package build tree.
- The same preflight rejects symbolic links in any existing output-path component,
  preventing an alias from bypassing the build-tree overlap rule.
- A source build runs once per release invocation, not once per binary.
- Existing ignored native artifacts must remain untouched.

## Success Criteria

- A stale existing package `dist` cannot be consumed without a current source build.
- Unit proof records source build before the first bundle and exactly once overall.
- Unit proof pre-seeds every consumed package output and observes all of it removed
  before compilation.
- A source-build failure emits a bounded structured `build_failed` response and
  does not create release output.
- Missing-command smoke errors identify the affected command and missing names.
- README no longer describes compilation as an implicit caller prerequisite.

## Acceptance Checks

- Verification type: unit — targeted platform-builder tests cover ordering, one-shot
  compilation, failure-before-output, and command-specific diagnostics.
- Verification type: integration — `npm run check` passes on the native ARM64 host.
- Verification type: integration — an ARM64 SEA build from the corrected producer
  discovers all required commands.
- Verification type: manual — Narnia reruns the exact AMD64 release command after
  pulling the corrected commit.

## Boundary Ownership

owned-correctly — the final artifact producer owns all generated inputs it consumes;
the workflow and npm alias are callers, not provenance authorities.

## Critique

- Interrupt Source: `charness-artifacts/debug/latest.md`
- Seam Summary: host AMD64 proof disproved source-level readiness because ignored
  compiled input crossed into the native artifact producer.
- Chosen Next Step: implement producer-owned compilation and prove ordering locally.
- Impl Status: ready
- Impl Status Reason: the structural cause and smallest enforceable invariant are confirmed.
- What Disproving Observation Is Resolved: stale ignored compiled input can no longer
  reach SEA bundling without a current source build.

## Canonical Artifact

This file is the current implementation contract for the slice.

## First Implementation Slice

Add an injectable `buildSource` producer step to the platform builder, invoke the
real root build by default before output mutation, then update tests, diagnostics,
workflow wording, and README.

## Implementation Evidence

- `node --test test/build-platform-binaries.test.mjs`: 9/9 pass.
- `npm run check`: all protocol, client, worker, operator, and 29 root tests pass.
- Native ARM64 `release:binaries`: both SEA binaries smoke successfully; all four
  `SHA256SUMS` entries verify; current worker `call` and operator session workflows
  are present in binary command discovery.
- Native AMD64 remains an operator-host acceptance check after the corrected commit
  is pushed.
