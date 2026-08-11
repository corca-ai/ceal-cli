# Quality Review
Date: 2026-08-11
Title: Duplication Seam Review

## Scope

Target boundary: contract-test release-state coupling, the full nose clone
inventory, directly adjacent duplicated test fixtures, and final-gate
orchestration failures encountered while proving the repair.

Ambient repo findings: B1 remains intentionally unshippable because the local
Protocol proof source and signed shipment lock diverge; this review does not
clear or weaken that quarantine.

## Surface Contract Review

- semantic coverage: `observed` — contract behavior and release readiness were
  being represented by the same live repository root.
- surface: contract fixtures calling public release-input and acceptance entrypoints.
- owner: contract fixtures own stable behavior; release-tier live positives own
  checkout shippability.
- projections: converged scratch state reaches behavior; diverged scratch and
  live release state reach the production guard.
- state scope: scratch Git repositories are disposable; the working tree and
  frozen Protocol package are not mutated by fixtures.
- transitions: converged fixture passes, declared divergence refuses before
  binary/input work.
- proof boundary: local contract and release-tier commands; no signed or live
  Gateway claim.
- unexamined axes: released successor, Gateway selection/apply, provider readback.

## Current Gates

- `npm run check:duplication` is the lexical boy-scout ratchet and now passes.
- `npm run check:unit` is the development iteration gate under declared
  divergence and now passes through contract behavior.
- Production shippability guards remain in both public entrypoints; release-tier
  live positives remain their checkout-level proof.

## Runtime Signals

- runtime source: structured runtime metrics in
  `.charness/quality/command-timing.jsonl`; rerun the named gate for current timing.
- runtime hot spots: the release suite remains the documented final-gate cost
  center; worker coverage exposed inherited child instrumentation and a
  scheduler-sensitive audit clock.
- coverage gate: `npm run check:unit` includes owned package coverage and passed.
- evaluator depth: deterministic gates plus bounded fresh-eye review; Cautilus
  was not used because this is a local, falsifiable test-oracle defect.

## Healthy

- Production guards were already centralized and were not weakened.
- Contract tests call real public guarded functions against real scratch Git
  state rather than a mock, bypass flag, or injected shippability verdict.
- Dedicated guard-reachability fixtures prove guard ordering independently of
  the live tree; acceptance pins the exact divergence code while release-input
  resolution distinguishes the pre-argument pin refusal.
- Worker coverage now controls test clocks, omits discarded child profiles, and
  gives exclusion-only children a watchdog-backed test lock policy without
  changing production audit or lock deadlines.
- Default append and drop contention run in watchdog-owned subprocesses, so a
  widened production deadline makes the proof fail instead of hanging the gate.

## Weak

- nose cannot infer that syntactically different test calls share a hidden live
  repository-state dependency.
- Clone fingerprints re-key when member windows change, so intentional families
  require reviewed overlay updates even when their conceptual class is stable.
- The packed Protocol consumer had retained the old single-file guide assumption
  after the release carrier became a directory; the final release tier was the
  first gate that exercised that sibling.

## Missing

- No generic static analyzer currently models semantic fixture ownership. The
  behavioral `check:unit`/release-tier split is the stronger regression oracle.

## Deferred

- Signed-handoff convergence, release proof, installed-worker proof, and live
  Gateway/provider proof remain downstream of the Gateway-owned final packet.

## Advisory

- structural review result: command: `npm run check:unit` confirms one shared
  converged repository fixture is the correct test-owned seam; production APIs
  retain unconditional guards.
- prose review result: artifact: `docs/gates.md` distinguishes development
  contract proof from live release readiness without restating Protocol values.
- Full nose inventory: command: `npm run check:duplication` found one additional
  actionable clone: package and native release tests hand-wrote the same
  client-session store. It now has one test owner; remaining new fingerprints
  were individually reviewed as intentional.
- Final-gate sibling review: command: `node --test test/gateway-protocol-consumer.test.mjs`
  proves the packed consumer now hashes the canonical skill-directory bundle
  rather than trying to read the guide directory as one file.

## Delegated Review

- Delegated Review: executed — a bounded fresh-eye reviewer classified every
  remaining nose family, confirmed no contract-tier live shippability positive
  remained, and required the two test-local converged-root wrappers that landed.
- Final review rejected reduced process counts as deterministic; round one
  separated test timing and round two required watchdog-owned production
  contention proofs. The last repair is accepted-unreviewed under the cap.
- Slow-gate lenses (fixture-economics, parallel-critical-path, duplicated-proof):
  duplicated-proof was reviewed; no new subprocess or release build was added.

## Commands Run

- `npm run check:duplication`
- `npm run check:unit`
- `npm --prefix packages/ceal-worker-cli run coverage`
- focused Protocol pin, release-input, and acceptance contract tests
- packed Gateway Protocol consumer release test
- release-tier live-root positive, expected `proof_shipment_protocol_divergence`
- `npm run check`, expected release-tier quarantine after earlier phases pass
- `npm run coverage:scripts`, expected live package/native quarantine after the
  packed directory consumer passes
- `bash .githooks/pre-push`
- `git diff --check` and the fresh-eye boundary verification

## Recommended Next Quality Moves

- active keep contract semantics independent from live checkout readiness —
  capability_needed=test-state fixture; next_center=none after this repair;
  transformation=converged/diverged real Git fixtures; proof_boundary=iteration
  green plus release refusal; enforcement_posture=existing gates.
- passive do not add a semantic-duplication regex because shared hidden state is
  not reliably lexical; capability_needed=behavioral oracle;
  next_center=release tier after signed handoff; transformation=none;
  proof_boundary=ordinary full gate; enforcement_posture=no-gate because the
  current behavioral split already falsifies the regression.

## History

- [Lifecycle HTTP duplication review](2026-08-11-lifecycle-http-duplication.md)
- [Prior quality review](history/2026-07-27-quality-review-second-pass.md)
