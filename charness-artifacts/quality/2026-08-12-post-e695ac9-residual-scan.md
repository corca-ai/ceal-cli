# Quality Review
Date: 2026-08-12
Title: Post-e695ac9 Residual Defect Scan

## Scope

Target boundary: commits `e03ace4` and `e695ac9`, their issue-14 evidence and
workspace-lock repairs, plus sibling acceptance and process-liveness seams.

Ambient repo findings: the signed Protocol divergence remains the release
boundary. This review neither edits frozen Protocol nor clears shipment.

## Surface Contract Review

- semantic coverage: `partial` — checkout call/receipt/acceptance output, request
  preflight, workspace locking, and build-process settlement were observed.
- surface: `ceal acceptance emit`, sanitized acceptance packets, and test-owned
  workspace `dist` builds.
- owner: Worker owns CLI/acceptance projection; test orchestration owns build lock
  and supervisor; Gateway/Protocol retain provider and terminal evidence.
- projections: YAML/JSON records, safe refs, lock generation, child process group.
- state scope: one acceptance readback or one workspace build generation.
- transitions: missing receipt fields, invalid ref, live/stale lock, timeout,
  TERM-ignoring descendant, and normal build.
- proof boundary: focused Worker/contract tests, real package builds, local gates.
- unexamined axes: escaped `setsid` descendants, signed successor, installed
  successor, live Gateway/provider, and final Protocol handoff.

## Current Gates

- `npm run check:unit`: passed on the final repaired tree.
- `npm run check`: reached the release tier and was refused by the declared
  `proof_shipment_protocol_divergence`; the resulting scripts-coverage floor
  failure is downstream of those guarded release positives not executing.
- focused Worker/contract tests and `npm run build:worker`: passed.
- `npm audit --omit=dev --audit-level=high`: passed with no reported vulnerability.
- `npm run check:duplication`, lint, unused, reachability, store-lock, and
  duplicate-literal checks: passed after shared-home extraction.
- full release proof remains refused by `proof_shipment_protocol_divergence`.

## Runtime Signals

- runtime source: `.charness/quality/command-timing.jsonl`, rendered by
  `render_runtime_summary.py --detail` for the declared host profile.
- runtime hot spots: the latest iteration sample exceeded its budget while the
  recent median remained inside; use the renderer for current values.
- coverage gate: both owned-package coverage floors passed through
  `npm run check:unit`.
- evaluator depth: deterministic local gates and bounded reviewers; no provider
  or model evaluator was appropriate for these local failure classes.

## Healthy

- Acceptance now validates request refs at the same pre-work boundary as receipt
  readback and derives checkout receipt projection from the installed emitter's
  declared-key owner.
- Dist-lock waiting uses a monotonic deadline while filesystem age correctly
  remains wall-clock metadata.
- A timed-out repo-owned npm/tsc process group receives TERM then KILL, bounded
  output/reporting, and settles before the dist lock is released.
- Frozen `packages/ceal-protocol` remains unchanged.

## Weak

- The process supervisor contains the repo-owned npm/tsc process group, not a
  child that deliberately escapes into a new OS session; this is an explicit
  containment boundary, not a general sandbox.
- One latest iteration sample exceeded budget; the structured log is the owner
  for deciding whether it recurs.
- Mutation testing is not configured beyond targeted falsifiers.

## Missing

- Charness 4.1.0 always emits `./scripts/run-quality.sh --read-only` although its
  own `run_when` says the repo must expose that command or an equivalent. The
  adapter has no supported suppress/replace field.
- Planner structural discovery still ignores adapter-resolved repo skills outside
  `skills/public|support`; regenerable-facts is also unconfigured for 12 docs.

## Deferred

- Signed package/install/live Gateway proof waits for the final handoff and pin
  convergence. Escaped-session containment would require an OS sandbox/cgroup,
  not another process-group wrapper, and is not warranted for repo-owned tsc.

## Advisory

- adapter/gate review (`command: inventory_adapter_gate_design.py --summary`):
  the local adapter is valid; a duplicate `run-quality.sh` wrapper would rerun
  `check:unit`/`check` or manufacture a vacuous green. Fix planner reachability.
- test economics (`command: inventory_standing_test_economics.py --summary`):
  file/startup and nested-process counts are advisory; no standing proof was
  removed. The new timeout falsifier adds one bounded process-group case.
- skill review (`command: inventory_skill_ergonomics.py --summary`): both declared
  skills scanned with zero heuristic findings; manual prose review confirmed the
  audit-vs-provider and unknown-write boundaries remain aligned.

## Delegated Review

- Delegated Review: executed — three high-leverage parent-delegated reviewers
  covered runtime/economics, behavior/security, and operability/concept integrity.
  They found four local defects; all were repaired.
- Round 2: executed — the runtime reviewer read the repaired full surfaces. Its
  same-group cleanup and lock-order proof gaps were closed; arbitrary `setsid`
  escape was dispositioned as outside the repo-owned toolchain contract.
- reviewer tier: high-leverage fields sent, host application metadata-hidden;
  findings received. Both boundary fingerprints returned `verdict: clean`.
  Fresh-Eye Satisfaction: parent-delegated.
- Slow-gate lenses: `fixture-economics`, `parallel-critical-path`, `duplicated-proof`,
  and subprocess fanout were reviewed; no proof-preserving deletion was found.

## Commands Run

- `npm run build:worker`; focused `node --test` for CLI, acceptance, and repo-build.
- `npm run check:unit`; `npm run check`; `npm run check:duplication`.
- `npm audit --omit=dev --audit-level=high`; `npm run probe -- ceal commands`.
- quality planner, runtime, adapter/gate, structural-waste, test-economics,
  brittle-guard, dual-implementation, clone, skill, and regenerable-fact inventories.
- reviewer boundary snapshot/verify for both review rounds.

## Recommended Next Quality Moves

- active fix Charness planner routing — capability_needed=honest runnable quality
  packets; next_center=planner `run_when`; transformation=mark unavailable catalog
  packets unreachable and merge adapter skill paths into discovery;
  proof_boundary=planner fixtures; enforcement_posture=AUTO_CANDIDATE.
- active consume the signed handoff — capability_needed=release convergence;
  next_center=pin/lock; transformation=one reviewed re-pin;
  proof_boundary=full package/install gate; enforcement_posture=existing-gate-reuse.
- passive add OS-session containment until a repo-owned build tool actually
  escapes its process group because capability_needed=stronger sandboxing has no
  observed producer; proof_boundary=incident/repro; enforcement_posture=no-gate.

## History

- [Earlier durable review](history/2026-07-27-quality-review-second-pass.md)
- [Prior review](2026-08-12-issue14-postcommit-review.md)
