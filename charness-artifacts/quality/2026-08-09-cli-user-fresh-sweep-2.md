# Quality Review
Date: 2026-08-09
Title: CLI User Fresh Sweep 2

## Scope

Target boundary: worker CLI user journeys, local-state integrity, concurrency,
startup/update behavior, and recovery truth after the first fresh sweep.

Ambient repo findings: the existing append-concurrency fixture used a timed
startup guess; the added process load falsified it, so both concurrency proofs
now use child readiness rather than elapsed startup time. The duplicate ratchet
also exposed parallel transcript-collection decisions in the inventory and
drill-down paths; one shared collector now owns absence, failure, and partial
collection.

## Surface Contract Review

- semantic coverage: `partial` — Linux source/dist behavior and deterministic
  local fixtures were exercised; macOS, released install, and live Gateway or
  provider behavior were not.
- surface: session logout, guide registration, observer audit drill-down,
  receipt-drop accounting, and shared local-store exclusion.
- owner: worker session/store/guide declarations own local behavior; Gateway
  owns cache identity semantics and live session truth.
- projections: stdout YAML, process exit, guide symlink, local audit lookup, and
  `~/.ceal` advisory state.
- state scope: one local worker installation and concurrent worker processes.
- transitions: retired refresh credential, concurrent registration, truncated
  audit walk, first/capped drop writes, and lock release during inspection.
- proof boundary: focused built-dist tests, full worker package suite, repo
  gates, and bounded Luna/xhigh review.
- unexamined axes: macOS runtime, signed released binary, live Gateway/provider,
  and a reachable successor-swap lifecycle.

## Current Gates

`npm run check:unit` is the iteration gate and `npm run check` is final. Store
lock and duplicate-literal ownership gates run in both; the pre-push hook also
runs maintainer-local duplication and shell checks.

## Runtime Signals

- runtime source: repo timing log rendered by
  `render_runtime_summary.py --repo-root . --detail`. <!-- reproduction-source -->
- runtime hot spots: the final gate and iteration gate remain within their
  recorded budgets; stateful public startup remains the known design slice.
- coverage gate: worker/client coverage is enforced by `npm run check:unit`.
- evaluator depth: deterministic gates and bounded subagents; no external
  evaluator or provider roundtrip was in scope.

## Healthy

- Retired refresh outcomes no longer strand local logout or claim a revocation
  the request did not perform.
- Same-target concurrent guide registration converges to success while foreign
  occupants remain conflicts.
- Partial audit misses stay unknown, and receipt-drop first writes/caps are
  serialized independently from a busy spool.
- The shared lock accepts a normal holder-release transition instead of naming
  it an unsafe store.
- Audit inventory and drill-down derive filesystem collection disposition from
  the same helper.

## Weak

- The drop counter may hold a failure-path process behind its small dedicated
  contention bound; this buys exact accounting during a burst.
- Dynamic/stateful commands still load the full public runtime.

## Missing

- A local session-generation contract for excluding late pre-logout writers.
- macOS and released-binary execution of this repaired slice.

## Deferred

- Discovery-cache subject/instance scope awaits the Gateway-owned semantic
  contract.
- A synthetic successor-swap in the lock primitive lacks a reachable lifecycle
  reproduction; it is not encoded as a speculative point fix.

## Advisory

- command: `rg -n 'withLocalStoreLock|withSessionStateLock' packages/ceal-worker-cli/src`
  supports the structural review result: producers remain the worker's session, guide,
  audit, and store modules; final consumers are CLI users and the observer;
  shared lock mechanics stay generic. Evidence: `packages/ceal-worker-cli/src/`;
  verdict: `owned-correctly`.
- command: `inventory_cli_ergonomics.py --repo-root . --summary` — generic JSON
  inventory is unconfigured, while typed route tables already own discovery.
- command: `inventory_cli_side_effect_probes.py --repo-root . --summary` — the
  generic contract is absent; the repo-derived effect probe remains the stronger
  One-Fact owner, so a parallel declaration is not recommended.
- artifact: `charness-artifacts/impl/2026-08-09-cli-user-fresh-sweep-2.md`
  records why the fake-cosign hang ignored the pinned tool's timeout contract
  and was rejected rather than converted into portable shell code.

## Delegated Review

- Delegated Review: executed — two new Luna/xhigh reviewers independently
  scanned user journeys/update and state/concurrency; two repaired-tree passes
  checked runtime boundaries and closeout claims. Both reviewer-boundary windows
  verified clean.
- Reviewer tier: high-leverage; explicit Luna/xhigh spawn fields were sent;
  host exposure `requested_fields_sent`, provider application not claimed.
- Slow-gate lenses: `fixture-economics` caught and removed the timed child-start
  guess; `parallel-critical-path` kept independent reviewers concurrent;
  `duplicated-proof` rejected a second route/effect inventory.

## Commands Run

- Quality planning, runtime summary, CLI ergonomics/side-effect inventories,
  boundary snapshot/verify, and boundary-escalation checks.
- Focused built-dist tests for each repaired branch and repeated concurrent
  receipt-drop runs.
- Worker package suite; `npm run check:unit`, `npm run check`,
  `npm run check:duplication`, `npm run lint:shell`, and
  `bash .githooks/pre-push` at closeout. The first duplicate-ratchet run failed
  and passed after the common audit collector was extracted.

## Recommended Next Quality Moves

- active define local session generation — capability_needed=late-writer
  exclusion; next_center=session identity and spool key; transformation=bind
  writes to a local generation; proof_boundary=logout/re-login concurrent test;
  enforcement_posture=advisory.
- active split public runtime by declared route — capability_needed=lower
  stateful startup work; next_center=`bin.ts` runtime factories;
  transformation=load route-owned dependencies only; proof_boundary=module-load
  markers and repeated Linux probes; enforcement_posture=advisory.
- passive until Gateway semantics answer it, keep cache subject/instance scope
  unchanged — capability_needed=authoritative cache identity; next_center=signed
  Gateway contract; transformation=none; proof_boundary=contract fixture;
  enforcement_posture=no-gate because the owner has not decided the fact.

## History

- [First fresh sweep](2026-08-09-cli-user-fresh-sweep.md)
- [Prior quality baseline](history/2026-07-27-quality-review-second-pass.md)
