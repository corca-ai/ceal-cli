# Quality Review
Date: 2026-08-11
Title: Post-Closeout Defect and Runtime Sweep

## Scope

Target boundary: owned client/worker runtime, scripts, tests, CLI/skill
operability, and standing-gate economics after commit `38e78a6`.

Ambient repo findings: the unsigned development Protocol and signed shipment
lock still diverge; this review does not weaken or clear that quarantine.

## Surface Contract Review

- semantic coverage: `partial` — local behavior and the checkout-built surface
  probe are in scope; installed, signed, and live Gateway/provider behavior are not.
- surface: worker CLI, client transports, local stores, release verification,
  and directory skills.
- owner: this repository owns worker/client behavior; Gateway owns frozen Protocol.
- projections: stdout/stderr, local files, HTTP/UDS frames, packed artifacts.
- state scope: request, process, local session, and release generation.
- transitions: success, timeout, contention, malformed input, and quarantine.
- proof boundary: repo tests, probes, static inventories, and packed local proof.
- unexamined axes: signed successor, installed successor, Gateway apply, provider readback.

## Current Gates

- `bash .githooks/pre-push` and `npm run check:unit` passed on the repaired tree.
- `npm run check` reached the intended `proof_shipment_protocol_divergence`;
  those release refusals also leave scripts coverage below its final-gate floor.
- `npm run check:duplication` passes after extracting shared fixture, timing,
  process, and release-proof facts and classifying three reviewed re-keys.

## Runtime Signals

- runtime source: structured metrics in `.charness/quality/command-timing.jsonl`
  rendered by `render_runtime_summary.py`; profile `local-linux-aarch64-2cpu`.
- runtime hot spots: the full tag gate and iteration gate remain within their
  configured budgets; rerun the renderer for current samples.
- coverage gate: the iteration coverage run passed on the repaired tree.
- evaluator depth: deterministic gates and bounded fresh-eye review; no Cautilus
  run because the requested sweep is repo-local and directly falsifiable.

## Healthy

- The checkout-built command-surface probe is reachable and reports declared effects.
- The skill ergonomics inventory found no structural heuristic hit.
- Structural-waste and dual-implementation inventories found no candidate.
- `npm audit --omit=dev --audit-level=high` reported no vulnerability in the
  current production dependency snapshot.
- Release asset merge now reaches the same fatal Protocol ship guard as package,
  native, and acceptance entrypoints before it reads composed assets.
- HTTP request timeout classification now agrees for an abort-ignoring fetch
  and abort-respecting fetch and body implementations.
- Explicit guide registration no longer labels a route-supplied host as a
  fallback/default host.
- Selected native-artifact and installer process probes are bounded without
  replacing their real process boundaries.

## Weak

- The generic read-only quality packet points to a missing repo script, so that
  route is `unreachable`, not a passing quality result.
- The quality planner does not discover the adapter-resolved repo-owned
  `skills/ceal-guide` path as a target skill, even though the direct ergonomics
  inventory can scan it.
- Test-economics inventory sees nested CLI fanout but cannot attribute value or cost.

## Missing

- Regenerable-fact ownership is not configured for the full docs tree.
- Security commands are not configured in the adapter; this is a coverage gap,
  not evidence of a security defect.

## Deferred

- Signed handoff convergence, release, installed successor, and live provider proof.
- A transcript appended or replaced during its bounded event read can still
  outrun the pre-read stat; a deterministic mutation seam is needed before
  changing the completeness contract.
- Splitting frozen Protocol tests out of scripts coverage needs an isolated
  before/after wall-time and raw-profile measurement before changing tier routing.

## Advisory

- structural review evidence: the fixed-time local-store race barrier moved to a
  bounded ready/release protocol; release manifest, guide archive, Git fixture,
  process liveness, and monotonic-clock facts now have shared homes. evidence:
  `packages/ceal-worker-cli/test/local-store-guards.test.mjs` and
  `test/release-process-bounds.mjs`, `test/converged-protocol-repo-fixture.mjs`,
  and `packages/ceal-worker-cli/src/monotonic-clock.ts`.
- prose review evidence: skill triggers and progressive references were directly
  reviewed; no repo-owned skill edit was warranted. evidence: rerun the skill
  ergonomics inventory against `skills/ceal-guide/SKILL.md`.
- command: rerun the quality planner, runtime/skill/structure
  inventories, `npm run check:duplication`, and `npm run check:unit`.

## Delegated Review

- Delegated Review: `executed` — three parent-delegated read-only reviewers ran
  behavior/security, runtime/test-economics, and claims passes through snapshots
  `post-closeout-sweep-r1` to `post-closeout-sweep-r3`; every fingerprint was clean.
- The rounds found release-guard, timeout taxonomy, provenance, process-tree,
  barrier cleanup, regression-oracle, and truth-surface defects. All reported
  owned blockers were repaired. Round four returned no current blocker against
  snapshot `post-closeout-sweep-r4`; its fingerprint was clean.
- Slow-gate lenses: fixture-economics remains deferred because signed-pin
  divergence prevents honest release timing; parallel-critical-path is worker
  coverage; duplicated-proof profile waste remains measurement-first.

## Commands Run

- quality planner and its runtime, skill, docs, structure, test-economics,
  brittle-guard, regenerable-facts, and CLI inventories
- `npm audit --omit=dev --audit-level=high`
- `node --test --test-name-pattern='process proof|busy deadline|missing guide asset' test/worker-native-artifact.test.mjs test/worker-release-installer.test.mjs packages/ceal-worker-cli/test/local-store-lock.test.mjs packages/ceal-worker-cli/test/agent-guide.test.mjs`
- `npm run check:duplication`
- `npm run check:unit`
- `npm run check`

## Recommended Next Quality Moves

- active add a deterministic transcript mutation fixture before changing audit
  completeness — capability_needed=filesystem race injection; next_center=agent
  audit test seam; transformation=post-read stability classification;
  proof_boundary=mutation test plus iteration gate; enforcement_posture=existing gates.
- active measure scripts-coverage profile exclusion before changing tier routing
  — capability_needed=coverage profile inventory; next_center=coverage runner;
  transformation=none until measured; proof_boundary=all tests exactly once and
  unchanged scripts floor; enforcement_posture=existing inventory gate.
- passive signed release proof waits until Gateway handoff convergence because
  current shipment refusal is intentional; capability_needed=signed handoff;
  next_center=release tier; transformation=none; proof_boundary=full gate;
  enforcement_posture=production quarantine.

## History

- [Earlier review](history/2026-07-27-quality-review-second-pass.md); [duplication seam review](2026-08-11-duplication-seam-review.md)
