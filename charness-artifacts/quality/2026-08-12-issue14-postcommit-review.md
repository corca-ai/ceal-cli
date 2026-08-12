# Quality Review
Date: 2026-08-12
Title: Issue 14 Post-Commit Residual Review

## Scope

Target boundary: commit `e03ace4`, its Worker call/receipt/acceptance evidence
projection, two agent skills, and the adjacent workspace dist-lock repair.

Ambient repo findings: the signed Protocol proof/shipment divergence remains the
release boundary; this review neither changes nor clears it.

## Surface Contract Review

- semantic coverage: `partial` — checkout YAML, recovery prose, acceptance
  projection, lock races, and local gates were observed.
- surface: `ceal call`, `ceal receipt show`, `ceal acceptance emit`, the checkout
  `ceal-guide` and `ceal-capability-audit`, and the test-owned workspace dist lock.
- owner: Worker owns local rendering and guides; Gateway/Protocol own provider,
  replay, and terminal evidence; test orchestration owns the dist lock.
- projections: CLI YAML, acceptance record, help, skills, docs, and lock state.
- state scope: one capability call/readback or one workspace build generation.
- transitions: verified audit, missing audit, unknown call outcome, acceptance
  emission, live/stale lock, expired wait, and reclaimed generation.
- proof boundary: loopback Worker tests, forced deadline/reclaim fixture, skill
  validators, checkout probe, and iteration gate.
- unexamined axes: signed successor, installed successor, live Gateway/provider,
  final Protocol contract, release package, and agent selection of released skills.

## Current Gates

- `npm run check:unit`: passed on the repaired tree.
- `npm audit --omit=dev --audit-level=high`: passed.
- `npm run probe -- ceal commands`: passed in its checkout-built throwaway HOME.
- `npm run check`: not run because the direct ship guard returned the declared
  `proof_shipment_protocol_divergence`; this is a release refusal, not a green gate.
- maintainer-local enforcement: installed hook path was already verified in the
  preceding closeout; this pass reran its component duplication gate.

## Runtime Signals

- runtime source: `.charness/quality/command-timing.jsonl`, rendered by
  `render_runtime_summary.py --detail` for the declared local host profile.
- runtime hot spots: the final pre-push iteration sample exceeded its configured
  budget while the recent median remained within it; use the renderer for values.
- coverage gate: package coverage and contract tests passed through `check:unit`.
- evaluator depth: deterministic gates and bounded fresh-eye review only; no live
  provider or model evaluator was appropriate for this local contract repair.

## Healthy

- Gateway audit readback and provider-state non-evidence remain distinct through
  call, receipt, and both acceptance emitters.
- Unknown writes retain their request reference and are not authorized for replay;
  both skills now tell the agent to preserve inputs/key and leave the write unresolved.
- The dist-lock proof now forces deadline expiry before stale reclamation or a
  concurrent release and proves one immediate acquisition attempt once the lock is free.
- Frozen `packages/ceal-protocol` has no diff.

## Weak

- The quality planner reports repo skills out of structural scope even while the
  adapter resolves repo-owned skill paths. The local adapter now inventories both
  changed skills, but planner discovery remains an upstream Charness weakness.
- No mutation runner is configured; the focused lock falsifier is strong, but this
  review does not claim mutation coverage for the broader Worker surface.
- The final pre-push iteration sample exceeded its configured runtime budget. One
  sample cannot distinguish host contention from standing regression; the timing log
  keeps the recurrence observable instead of justifying an immediate scope cut.

## Missing

- `./scripts/run-quality.sh --read-only` is still an unreachable planner route
  (exit 127); the repo should not add a duplicate wrapper solely to satisfy it.
- Regenerable-facts coverage is not configured for the docs tree, so that packet is
  an explicit no-verdict rather than a clean documentation claim.

## Deferred

- Full release/package/installation and live Gateway/provider proof remain deferred
  until one signed Protocol handoff converges the pin and shipment lock.
- Provider terminality, replay identity, and any future retry authorization remain
  Gateway/Protocol work; this Worker deliberately exposes none for unknown writes.

## Advisory

- structural review result (`command: inventory_skill_ergonomics.py --summary`): both skill packages keep detailed recovery/audit policy
  in their proper reference/core owners; no new helper or command snapshot is needed.
  Evidence: `inventory_skill_ergonomics.py --repo-root . --summary` scanned both.
- prose review result (`command: rg -n provider-not-started packages skills docs/handoff.md`): heuristic inventory was clean, but manual review found the
  invented `provider-not-started` state; it was removed from code, skills, docs, and
  tests before closeout. The scoped command returns no hits.
- runtime economics (`command: render_runtime_summary.py --detail`): the iteration gate remains the dominant normal feedback lane;
  no new spawn or fixture cache optimization justified weakening a real boundary.
  Evidence: `render_runtime_summary.py --repo-root . --detail` and delegated review.

## Delegated Review

- Delegated Review: executed — three high-leverage parent-delegated reviewers covered
  behavior/sibling propagation, runtime economics, and security/claims. They found
  the expired-reclaim failure and invented recovery state; both were repaired.
- Round 2: executed — the runtime reviewer read the repaired full surfaces and found
  no ACT blocker in that packet. The parent then completed the same free-lock
  invariant for concurrent release; that final sibling is accepted-unreviewed under
  the two-round cap and passed focused plus iteration gates.
  Fresh-Eye Satisfaction: parent-delegated.
- reviewer tier: high-leverage fields were sent; host application is metadata-hidden;
  findings were received. Boundary verdict was parent-attributed only for the exact
  parent-edited repair paths, with no undeclared drift.
- Slow-gate lenses: `fixture-economics`, `parallel-critical-path`, and
  `duplicated-proof` were checked with unbounded waits; no further ACT item was found.

## Commands Run

- `npm run check:unit`
- `npm audit --omit=dev --audit-level=high`
- `npm run probe -- ceal commands`
- `node scripts/verify-protocol-vendor-pin.mjs`
- `npm run lint && npm run check:duplication`
- `npm run build && node --test test/contract/repo-build.test.mjs packages/ceal-worker-cli/test/cli.test.mjs test/contract/worker-guide-contract.test.mjs`
- `python3 .../quick_validate.py skills/ceal-guide` and the audit-skill sibling
- quality planner runtime, regenerable-facts, skill, and docs inventory commands

## Recommended Next Quality Moves

- active consume the final signed Protocol handoff — capability_needed=release
  convergence; next_center=Protocol pin/lock; transformation=re-pin then run the full
  gate; proof_boundary=release/package/install gates; enforcement_posture=existing gate.
- active fix upstream planner routing — capability_needed=honest quality packets;
  next_center=Charness planner; transformation=filter unreachable run-quality and honor
  adapter-resolved repo skill paths; proof_boundary=planner fixture; enforcement_posture=AUTO_CANDIDATE.
- active remeasure the next iteration samples — capability_needed=runtime diagnosis;
  next_center=timing log; transformation=inspect repeated budget breaches before
  changing gate scope; proof_boundary=rendered runtime summary; enforcement_posture=advisory.
- passive mutation setup until a scoped runner and maintenance budget are chosen because
  the current adapter declares no executable mutation command.

## History

- [Earlier quality review](history/2026-07-27-quality-review-second-pass.md)
