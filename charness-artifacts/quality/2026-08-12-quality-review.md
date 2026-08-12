# Quality Review
Date: 2026-08-12
Title: Recent Update and Guide Defect Re-Sweep

## Scope

Target boundary: recent update/embedded-guide changes at `cbc5732`, their
release projections, local-store filesystem siblings, and regression-test
liveness.

Ambient repo findings: the vendored development Protocol and signed shipment
lock remain deliberately divergent. This review does not clear that quarantine.

## Surface Contract Review

- semantic coverage: `partial` — local source, tests, workflows, release merge,
  and checkout-built behavior are in scope; no signed successor or live Gateway.
- surface: `ceal update`, `ceal guide status/register`, local stores, release
  manifests, workflow checkouts, and bounded release-process tests.
- owner: this repository owns every changed surface; Gateway owns frozen Protocol.
- projections: YAML guidance, host skill links, Unix modes, release manifests,
  CI checkout state, and process settlement.
- state scope: local install generation, per-host registration, local store,
  one merge, and one process tree.
- transitions: update success, explicit registration, conflict, integrity drift,
  timeout, and signed-pin quarantine.
- proof boundary: local tests, mutation fixtures, static gates, and full-gate
  refusal; no release, installation, Gateway selection, or provider readback.
- unexamined axes: signed successor, installed first hop, Gateway apply, and
  concurrent external mutation after an operator manually removes a legacy link.

## Current Gates

- `npm run check:unit` passed on the repaired tree.
- `npm run check:duplication`, lint, frozen-boundary checks, and focused mutation
  suites passed.
- `npm run check` remained red only after release positives reached the declared
  `proof_shipment_protocol_divergence`; their early refusal also leaves scripts
  coverage below the final floor. Evidence: `/tmp/ceal-cli-recent-full-gate.log`.

## Runtime Signals

- runtime source: `.charness/quality/command-timing.jsonl`, rendered by
  `render_runtime_summary.py`; rerun that command for current samples.
- runtime hot spots: the latest recorded iteration sample exceeded its configured
  budget while the recent median did not; no prose number is copied here.
- coverage gate: owned package coverage passed; scripts coverage is not measurable
  as green while release positives are quarantined before their branches.
- evaluator depth: deterministic gates plus two bounded fresh-eye lenses; no
  external evaluator was needed for repo-local falsifiers.

## Healthy

- Update does not invoke guide materialization or host registration and advises
  the explicit detected-host command after success.
- Merge rebuilds the canonical guide bundle from the checkout and binds every
  platform manifest to it, including one-leg and identical-all-leg drift tests.
- CI jobs that execute historical-installer release proofs fetch tag history,
  with a repo gate deriving the requirement from job commands.
- Process-tree tests retain the real TERM-to-KILL boundary and arm their short
  deadline only after a bounded fixture-ready marker.

## Weak

- An earlier Ceal-managed guide link cannot be conditionally replaced atomically
  with portable Node filesystem APIs. Registration preserves it and gives exact
  cleanup-and-retry advice instead of claiming automatic migration.
- The generic quality planner still emits the absent
  `./scripts/run-quality.sh --read-only` route.

## Missing

- Regenerable-fact ownership remains unconfigured for the full docs tree.
- The quality adapter has no configured security-command packet; this is a
  coverage gap, not evidence of no security defect.

## Deferred

- Signed Protocol convergence, release, installed-update crossing, and live
  Gateway/provider proof remain downstream of the Gateway handoff.
- Coverage-tier profile splitting remains measurement-first work.

## Advisory

- structural review result (evidence: `npm run check:duplication`): one new duplication fingerprint was a reviewed
  compose-versus-merge re-key; actual shared facts remain in the bundle and
  output-directory owners. evidence: `npm run check:duplication` and
  `charness-artifacts/quality/dup-review.json`.
- prose review result (inventory: skill ergonomics): `skills/ceal-guide/SKILL.md` stayed unchanged; this sweep
  changed carrier/update behavior, not the skill's progressive workflow.
  evidence: skill ergonomics inventory against `skills/ceal-guide/SKILL.md`.
- inventory result (command: quality planner packet): automatic structure and docs ergonomics scans found no new
  target finding; runtime and regenerable-fact inventories produced the Weak and
  Missing items above. command: rerun the quality planner packet.

## Delegated Review

- Delegated Review: `executed` — release/proof and claims/operability reviewers
  inspected snapshot `recent-change-scan-r2`; a third runtime/security reviewer
  was blocked before returning findings. host signal: the reviewer turn returned
  `flagged for possible cybersecurity risk` without a review payload.
- The reviewers found a remaining managed-link TOCTOU, stale embedded-carrier
  wording, and a watchdog fixture readiness race. The parent repaired them after
  the snapshot; therefore its final fingerprint correctly reports parent-caused
  boundary drift rather than a clean reviewed tree.
- Round cap disposition: the post-review automatic-migration removal and bounded
  ready-marker seam are `accepted-unreviewed`; focused mutation tests and the
  iteration gate pass, but no third review round is claimed.
- Slow-gate lenses: fixture-economics found no production shortcut worth taking;
  parallel-critical-path remains worker coverage; duplicated-proof was reduced
  only where one fact had one owner.

## Commands Run

- quality bootstrap/planner plus runtime, skill, docs, structure,
  test-economics, brittle-guard, and regenerable-facts inventories
- `npm run build && npm run lint`
- focused guide/store/update/release/workflow mutation suites
- repeated native and installer process-tree watchdog tests
- `npm run check:duplication`
- `npm run check:unit`
- `npm run check > /tmp/ceal-cli-recent-full-gate.log 2>&1`

## Recommended Next Quality Moves

- active converge the final signed Protocol handoff before release —
  capability_needed=signed Gateway packet; next_center=vendor pin and lock;
  transformation=one atomic re-pin; proof_boundary=full gate and release tier;
  enforcement_posture=existing production quarantine.
- passive measure scripts-profile exclusion before tier changes because release
  quarantine currently shadows the positive path; capability_needed=converged
  release fixture; next_center=coverage runner; transformation=none;
  proof_boundary=all suites exactly once; enforcement_posture=no new gate.

## History

- [Earlier quality review](history/2026-07-27-quality-review-second-pass.md)
