# Native Platform Release Input Critique
Date: 2026-07-13

## Execution

- Target: release critique
- Angles: Gawande operational/release checklist; Weinberg diagnostic and
  implementation integrity; separate skeptical counterweight.
- Packet Consumed: n/a (no critique adapter sections).

## Decision Under Review

Move current-source compilation and stale-output eviction into the native
platform artifact producer instead of relying on caller sequencing.

## Release Scope

- Version/tag: unchanged `0.64.0`; no tag or publication in this slice.
- Consumer change: `release:binaries` now removes ignored package outputs,
  compiles current source, then assembles and smokes both native commands.

## Surface-Lock Inventory

- Producer ordering and source provenance in `scripts/build-platform-binaries.mjs`.
- `build_failed` and missing-command diagnostic contracts.
- Existing marked output preservation and build-tree path isolation.
- README native-build instructions and workflow step wording.
- Final `ceal` and `cealctl` native command-discovery smoke.

## Failure Angles

- Rebuilding without cleaning would retain outputs for source files deleted by a
  pull; the producer now evicts all four package `dist` trees first.
- Cleaning before output validation could destroy an overlapping output; the
  read-only preflight now rejects real-path overlap before cleanup.
- A symlink alias could bypass lexical overlap; existing symlink components are
  now rejected before cleanup and covered by regression tests.
- Same-checkout concurrent release invocations can still race over shared `dist`,
  but the supported workflow is sequential per checkout and uses separate runners
  across platforms.

## Counterweight Pass

- Act Before Ship: stale deletion, output overlap, and symlink alias findings were
  strong and were fixed before commit.
- Bundle Anyway: existing-output preservation, structured failure, and precise
  missing-command diagnostics were cheap adjacent proofs and are included.
- Over-Worry: repeated CI builds and bounded compiler stderr do not weaken the
  release contract or justify a `--skip-build` escape hatch.
- Valid but Defer: a checkout-level lock or invocation-local compilation tree for
  unsupported same-checkout concurrency is real but not required for this lane.

## Structured Findings

- F1 | bin: act-before-ship | evidence: strong | ref: scripts/build-platform-binaries.mjs#buildCurrentSource | action: fix | note: resolved by evicting every consumed package output before compilation
- F2 | bin: act-before-ship | evidence: strong | ref: scripts/build-platform-binaries.mjs#assertOutputOutsideBuildTrees | action: fix | note: resolved by rejecting lexical overlap and symlink aliases before cleanup
- F3 | bin: bundle-anyway | evidence: strong | ref: test/build-platform-binaries.test.mjs | action: fix | note: added stale eviction, existing-output preservation, bounded failure, and path isolation proofs
- F4 | bin: valid-but-defer | evidence: moderate | ref: .github/workflows/cealctl-release.yml | action: defer | note: same-checkout concurrent builds remain unsupported while the release workflow is sequential per checkout
- F5 | bin: over-worry | evidence: strong | ref: .github/workflows/cealctl-release.yml | action: document | note: two producer invocations intentionally rebuild independently for deterministic artifact comparison

## Reviewer Tier Evidence

- Requested tier: high-leverage release review, mapped to bounded medium reasoning by repo host policy.
- Requested spawn fields: `reasoning_effort: medium`.
- Host exposure state: requested_fields_sent
- Application state: host accepted the field; provider application metadata was not exposed.

## Fresh-Eye Satisfaction

parent-delegated; three read-only reviewer boundary fingerprints reported zero
worktree, index, or HEAD drift.

## Operator Action Required

No remaining Act Before Ship action after the fixes above. Native AMD64 proof still
requires rerunning the corrected producer on Narnia after pulling the pushed commit.

## Upgrade Path

The command grammar is unchanged. Pull the corrected commit and rerun the same
`npm run release:binaries -- ...` invocation; no manual pre-build cleanup is needed.

## Boundary Ownership

- Producer: native platform release builder.
- Consumer: injected SEA binaries and their final command-discovery smoke.
- Owning surface: `scripts/build-platform-binaries.mjs`.
- Verdict: moved-to-owner

## Deliberately Not Doing

- No `--skip-build` path, timestamp freshness heuristic, publication, non-Linux
  matrix expansion, or same-checkout concurrency contract in this slice.

## Next Move

Run the full gate and corrected ARM64 artifact producer, then commit and push for
the operator's native AMD64 rerun.
