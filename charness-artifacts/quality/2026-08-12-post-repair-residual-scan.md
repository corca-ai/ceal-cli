# Quality Review
Date: 2026-08-12
Title: Post-Repair Residual Quality Scan

## Scope

Target boundary: residual defects after `9f706b2`: sibling workflows, proof sensitivity, release-test credentials, fact ownership, and continuation truth.

Ambient finding: frozen development Protocol and shipment lock remain divergent;
this review does not clear that quarantine.

## Surface Contract Review

- semantic coverage: `partial` — local source, workflows, tests, docs, and
  checkout-built CLI proof were observed; no signed successor or live Gateway.
- surface: `ceal update`, guide registration, release CI, release tests, and the
  worker continuation pointer.
- owner: ceal-cli owns runtime/test/workflow; the sibling plan owns ordering;
  Gateway owns frozen Protocol.
- projections: YAML advice, filesystem modes and links, workflow checkout/cache,
  child-process environment, release test verdicts, and handoff prose.
- state scope: one update, one host registration, one release-test process, one
  workflow job, and one continuation pointer.
- transitions: success, preserved conflict, timeout, missing readiness marker,
  historical installer crossing, and Protocol quarantine refusal.
- proof boundary: focused mutation-sensitive tests, iteration gate, full-gate
  refusal log, static gates, dependency audit, and two delegated review rounds.
- unexamined axes: signed successor, installed update, Gateway/provider readback,
  and operator execution of manual legacy-link cleanup.

## Current Gates

- `npm run check:unit` passed on the repaired tree.
- Lint, duplication, focused workflow/update/guide/process tests, and the adapter
  security command passed.
- `npm run check` remains red at the declared
  `proof_shipment_protocol_divergence`; the refusal shadows release-positive
  branches and their scripts coverage. Evidence:
  `/tmp/ceal-cli-post-repair-residual-full.log`.

## Runtime Signals

- runtime source: `.charness/quality/command-timing.jsonl`, rendered by
  `render_runtime_summary.py`; rerun the command below for current samples.
- runtime hot spots: the renderer keeps the iteration and tag-full samples
  within their configured profile budgets; no measured value is copied here.
- coverage gate: owned-package coverage passed; scripts coverage cannot reach a
  green positive release path while shipment divergence refuses it first.
- evaluator depth: deterministic gates plus two bounded three-lens fresh-eye rounds.

## Healthy

- Release-proof workflows fetch history; full-gate jobs prewarm offline cache.
- Historical installer bytes come from the released commit, the tag must peel to
  it, and release-test children cannot inherit CI OIDC/GitHub tokens.
- Ready-marker tests now distinguish early arming, deleted marker detection, and
  a missing-marker deadline without relying on an unbounded child.
- Exact Unix mode interpretation has one `permissionMode` owner; permissive
  parent/quarantine predicates remain separate policies.
- `ceal update` still never stages/registers a guide and returns the explicit
  `ceal guide register <host>` next action after binary success.

## Weak

- An earlier Ceal-managed guide link requires explicit operator removal before
  retry because portable filesystem APIs cannot conditionally replace it. The
  runtime and release procedure name that limitation and do not advise reinstall.
- The planner routes absent `./scripts/run-quality.sh --read-only` and reports
  no skill scope despite the adapter-resolved ceal-guide path.

## Missing

- Regenerable-fact ownership remains unconfigured for the wider docs tree.
- Signed successor, installed crossing, and live proof do not exist yet.

## Deferred

- Scripts-profile splitting waits for a converged, comparable release workload.
- Managed registration replacement remains out; preserving the occupant and
  requiring deliberate cleanup is the safe contract.

## Advisory

- structural review result (evidence: `npm run check:duplication` and
  `charness-artifacts/quality/dup-review.json`): workflow discovery was extracted;
  two traversal re-keys retain distinct build/runtime trust policies.
- prose review result (evidence: `inventory_skill_ergonomics.py` plus manual read):
  the three-file ceal-guide remains progressively disclosed and unchanged by this
  runtime/workflow repair.
- security review result (command: `npm audit --omit=dev --audit-level=high`): no
  advisory was reported, and the command now has an adapter-owned quality route.
- runtime review result (evidence: `inventory_standing_test_economics.py`): no
  standing nested-CLI file was classified as a current acceleration candidate;
  fixed post-settlement sleeps in stable-update tests were replaced by bounded
  condition observation.

## Delegated Review

- Delegated Review: `executed` — three parent-delegated lenses reviewed snapshot
  `post-repair-residual-r1`; runtime/security found npm-stage history omission,
  test/duplication found marker-proof and mode-owner gaps, and operability found
  stale cross-repo truth surfaces.
- Round 2 reviewed the repaired whole surfaces and found mutable-tag execution,
  missing offline prewarm, non-sensitive marker detection, and remaining prose
  tense/order drift. Those repairs are accepted-unreviewed under the two-round cap.
- Reviewer tier: quality closeout `high-leverage`; follow-up exposed no override
  metadata, so host application is `host-defaulted`; findings were received and
  both boundary fingerprints verified `verdict: clean`.
- Slow-gate lenses: fixture-economics removed fixed waits;
  parallel-critical-path remains worker coverage; duplicated-proof was reduced
  only at one shared owner.

## Commands Run

- quality bootstrap/planner and required concept, behavior, security, operability,
  proof-path, surface-contract, and fresh-eye references
- `npm run probe -- ceal commands`
- `npm audit --omit=dev --audit-level=high`
- runtime, regenerable-facts, skill/docs, duplication, structural-waste, test-
  economics, CI-recoverability, brittle-guard, and dual-implementation inventories
- `npm run build` and focused guide/update/workflow/process release tests
- `npm run lint && npm run check:duplication`
- `npm run check:unit`
- `npm run check > /tmp/ceal-cli-post-repair-residual-full.log 2>&1`

## Recommended Next Quality Moves

- active consume and review the one final signed Protocol handoff after the
  sibling S0 and selected S1-S5 packet changes — capability_needed=signed Gateway
  packet; next_center=vendor pin/lock; transformation=atomic convergence;
  proof_boundary=full gate, release tier, installed crossing;
  enforcement_posture=existing production quarantine.
- passive measure scripts-profile exclusion after convergence because the current
  quarantine shadows positive release workload — capability_needed=converged
  release fixture; next_center=coverage runner; transformation=none yet;
  proof_boundary=all suites exactly once; enforcement_posture=no new gate.

## History

- [Earlier quality review](history/2026-07-27-quality-review-second-pass.md)
