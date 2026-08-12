# Quality Review
Date: 2026-08-12
Title: Post-b325a4c Process And Release-Boundary Sweep

## Scope

Target boundary: recent process supervision, update behavior, release workflows,
acceptance execution, proof sensitivity, test economics, docs, and ceal-guide.

Ambient finding: the frozen development Protocol and signed shipment lock remain
divergent; this review preserves rather than clears that quarantine.

## Surface Contract Review

- semantic coverage: `partial` — local source, workflow syntax, tests, docs, checkout probe, and read-only GitHub configuration were observed.
- surface: `ceal update`, bounded process execution, acceptance packets, npm
  staging, worker publication/rollback, and the installed skill contract.
- owner: ceal-cli owns runtime, tests, workflows, and docs; GitHub administrators
  own Environment protection and credential placement; Gateway owns Protocol.
- projections: process settlement, YAML advice, child environment, workflow handoffs, signed inventory digests, mutable stable objects, and operator prose.
- state scope: one process group, one installed command, one workflow run, one
  immutable handoff, and the stable bootstrap/pointer pair.
- transitions: normal exit, timeout/escalation, approval/refusal, artifact
  substitution, publication, rollback, and shipment-quarantine refusal.
- proof boundary: mutation-sensitive focused tests, iteration gate, expected full gate refusal, static gates, dependency audit, and two delegated review rounds.
- unexamined axes: protected Environment execution, signed successor, installed
  update, release-origin mutation, Gateway selection, and live provider readback.

## Current Gates

- `npm run check:unit` passed on the repaired tree.
- Focused workflow/process/acceptance tests, duplication, shell lint, dependency
  audit, and frozen-boundary checks passed.
- `npm run check` remains red only after release positives reach the declared
  `proof_shipment_protocol_divergence`; that refusal also shadows their scripts
  coverage. Evidence: `/tmp/ceal-cli-post-b325a4c-full.log`.

## Runtime Signals

- runtime source: `.charness/quality/command-timing.jsonl`, rendered by
  `render_runtime_summary.py`; rerun it for current samples.
- runtime hot spots: production process-tree escalation and release-test readiness now use explicit bounded settlement rather than fixed sleeps or unbounded waits.
- coverage gate: scripts coverage cannot measure a green release path while the shipment pin refuses the release positives first.
- evaluator depth: deterministic static/behavior gates plus two bounded three-lens fresh-eye rounds.

## Healthy

- `ceal update` remains independent of guide registration and returns explicit
  `ceal guide register codex|claude` recovery after binary success.
- Acceptance children preserve the injected HOME/session boundary while dropping
  CI, OIDC, npm, GitHub, and release-origin credential surfaces.
- Worker publish, npm stage, and rollback consume unprivileged handoffs; their
  privileged jobs do not check out or run repository source.
- Approval comparisons, package rehashing, worker inventory verification, and rollback bootstrap binding have mutation tests that fail when removed.
- Rollback activation independently binds pointer tag, SHA256SUMS bytes, approved
  digest, and `install-ceal.sh` bytes before release-origin mutation.
- Distinct `CEAL_ENV_*` names prevent fallback to legacy repository credentials.
- The three-file ceal-guide stays progressively disclosed; its root points to
  focused references instead of copying binary-owned command contracts.

## Weak

- Stable bootstrap and pointer are separate mutable writes; storage provides no
  cross-object transaction, so partial-write recovery remains an operator concern.
- The quality planner still routes absent `./scripts/run-quality.sh --read-only`
  and misses adapter-resolved skill scope.
- Acceptance credential names are an explicit scrub list and need sibling review
  when a new CI or publication credential is introduced.

## Missing

- `ceal-cli-release` has no observed protection rule; it carries an obsolete `CEAL_RELEASE_*` secret rather than the new `CEAL_ENV_*` identity, so release
  is intentionally fail-closed.
- No observed tag ruleset restricts worker release tags.
- Regenerable-fact ownership remains unconfigured for the wider docs tree.
- No signed successor, installed crossing, release-origin write, or live proof
  exists for this tree.

## Deferred

- Scripts-profile splitting waits for a converged release workload whose positive
  path can be measured honestly.
- Cross-object stable activation recovery needs a storage-compatible design; it
  is not disguised as an atomic write in current claims.

## Advisory

- structural review result (evidence: `npm run check:duplication` and the workflow
  mutation cases in `test/contract/repo-gates.test.mjs`): no new fixable family
  remains, and privilege facts have one test-owned verifier.
- prose review result (evidence: manual read of `skills/ceal-guide/SKILL.md` and
  both linked references): the skill keeps intent-first progressive disclosure.
- security review result (commands: `npm audit --omit=dev --audit-level=high` and
  the GitHub readbacks in `docs/operator-acceptance.md`): dependency audit is
  clean; external release protection is explicitly blocked, not assumed.
- runtime review result (evidence: bounded-process, stable-update, repo-build, and release-supervisor focused tests): settlement proofs reproduce process trees and readiness failures instead of relying on elapsed sleeps.

## Delegated Review

- Delegated Review: `executed` — runtime/economics, release/security, and surface
  contract lenses reviewed snapshot `post-b325a4c-quality-r1`.
- Round 2 reviewed the repaired snapshot `post-b325a4c-quality-r2`; both boundary
  fingerprints verified `verdict: clean` before parent edits.
- Round 2 found rollback bootstrap binding, Environment-name fallback, and
  vacuous workflow assertions. Their repairs are accepted-unreviewed under the
  two-round cap and are covered by direct mutation tests.
- Reviewer tier: quality closeout `high-leverage`; host application metadata was
  not exposed, so it is recorded as `host-defaulted`.
- Slow-gate lenses: fixture-economics defers release fixture reuse until convergence; parallel-critical-path remains worker coverage; duplicated-proof was reduced through shared workflow and deadline verifiers.

## Commands Run

- `npm run probe -- ceal commands`
- `npm audit --omit=dev --audit-level=high`
- quality planner plus runtime, docs, skills, structural, duplication, security,
  CI recoverability, and test-economics inventories
- `npm run build && node --test packages/ceal-worker-cli/test/bounded-process.test.mjs packages/ceal-worker-cli/test/stable-update.test.mjs test/contract/repo-gates.test.mjs test/contract/worker-release-assets.test.mjs test/contract/worker-acceptance-packet.test.mjs`
- `node --test test/contract/repo-build.test.mjs`
- `npm run check:unit`
- `npm run check:duplication && npm run lint:shell`
- `npm run check > /tmp/ceal-cli-post-b325a4c-full.log 2>&1`

## Recommended Next Quality Moves

- active protect `ceal-cli-release`, configure the exact `CEAL_ENV_*` values,
  remove the legacy-named credential, and establish the intended tag boundary
  before any release — capability_needed=GitHub admin approval; next_center=repo
  settings; proof_boundary=readback commands in operator acceptance;
  enforcement_posture=workflow fails closed today.
- active consume and review the final signed Protocol handoff —
  capability_needed=Gateway packet; next_center=vendor pin/lock;
  proof_boundary=full gate and installed crossing; enforcement_posture=existing
  production quarantine.
- passive because current quarantine shadows the positive workload, measure scripts-profile splitting only after convergence —
  capability_needed=green release fixture; next_center=coverage runner;
  proof_boundary=all suites exactly once; enforcement_posture=no new gate.

## History

- [Earlier review](history/2026-07-27-quality-review-second-pass.md)
