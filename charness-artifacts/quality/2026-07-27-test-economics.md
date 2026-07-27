# Quality Review
Date: 2026-07-27
Title: Quality Review — third pass, test economics and the defects a bug hunt found

## Scope

Target boundary: repo-wide, driven by an open autonomous-improvement brief (test speed,
code speed, bug fixes, code quality, duplication). The morning's two passes closed their five
`active` cards, so this pass measured the gate instead of re-deriving the inventory, then
hunted defects in the editable packages.

Ambient repo findings: `charness-artifacts/quality/latest.md` still listed all five cards as
`active` while `docs/handoff.md` recorded them closed — a doc-to-runtime drift resolved by
this record superseding it.

## Current Gates

- `npm run check` (final), `npm run check:unit` (iteration), `npm run lint` = `biome check .`
  inside both. `.githooks/pre-push` runs the iteration gate, the full gate on a tag push.
- `.github/workflows/check.yml` runs the full gate on push/PR to `main`, ubuntu + macOS.
- New this pass: `test/contract/repo-build.test.mjs` (the workspace-dist mutex and the
  fixture-hygiene gate), a positional-index sweep over the worker command tables, an
  observer/store freshness-agreement gate, a spool mode-anomaly gate, and two store-lock
  recovery gates.
- `npm audit` and `--omit=dev`: 0 vulnerabilities.

## Runtime Signals

- runtime source: missing — `render_runtime_summary.py` reports `runtime source: not configured`. <!-- reproduction-source -->
- runtime hot spots: unavailable as a trend — no structured samples exist, so the figures under
  `## Commands Run` are single `time` runs from this turn, ranked well enough to act on.
- coverage gate: no floor configured; confidence is gated by negative probes.
- evaluator depth: deterministic gates only — no Cautilus adapter.

## Healthy

- `npm run check` 43–46s, down from ~98s, with `test:release` 74.6s → 22–25s. Eight
  consecutive parallel release runs and ten contract runs green, including one release run
  from a deleted `dist`.
- Every change falsifies by deletion, and falsification found two things review did not: the
  first serialization probe spawned its holders synchronously and stayed green with the mutex
  removed, and the owner-write-grace branch was found only because a probe hung on it.
- Supply chain clean; frozen boundary held — nothing under `packages/ceal-protocol`,
  `packages/ceal-operator-cli`, or the frozen release lane was touched.

## Weak

- **The release tier's remaining floor is one file.** `worker-release-installer` is 22.3s, of
  which test 16 alone is 16.1s — a full SEA build (esbuild + a 119 MB runtime copy + postject)
  that `worker-native-artifact` builds again from the same inputs. Splitting the file gains
  only ~4s against its 17.9s sibling, so the win needs a shared artifact cache, which trades
  proof integrity for time in a release-proof tier. Not attempted.
- **Two shared surfaces are unproven rather than proven safe under the new parallelism.**
  `~/.npm/_cacache` now takes three concurrent `npm install --offline` runs — `cacache` is built
  for that and 18 runs showed nothing, but nothing here demonstrates it. And
  `build-worker-release-artifact.test.mjs:111` builds a tmp path from the pid rather than
  `mkdtemp`: safe within a run, racy only between two concurrent `npm run check` invocations.
  Separately, `ensureBuilt`'s memo is per process, so `ceal-protocol` is still built once per
  release test file — off the critical path, so it costs CPU rather than wall clock.

## Missing

- **Structured gate timing.** Still no `command_timing_log`, so this record's numbers are
  again hand-measured and will go stale the same way the last set did.
- **`ceal update` has no deadline.** `stable-update.ts:189-215` spawns the installer and the
  installed binary with no timeout, and `install-ceal.sh` runs `curl` with no `--max-time`
  while holding a `flock`. A black-holed connection or a concurrent update hangs the command
  with no envelope written. Every other wait in this CLI is bounded. Read-only finding — not
  reproduced.
- **`createLock`'s failure cleanup lacks the ownership check `releaseLock` has**
  (`local-store-lock.ts:93-96`). If a holder is descheduled past the initialization grace, its
  successor's lock can be removed by the process whose lock was reclaimed — the mutual
  exclusion loss the module exists to prevent. Read-only finding; `releaseLock` already has the
  correct shape to copy.

## Deferred

- `skills/ceal-guide` vs `skills/cealctl-guide` SKILL.md duplication (0.95): frozen, so a
  request to `corca-ai/ceal`. Carried unchanged.
- `packages/ceal-operator-cli`'s non-recursive `../src` sweeps: sent to `vinc`, frozen here.
- The positional-index and duplicated-predicate sweeps covered the editable packages only; the
  frozen ones were not swept for the same shapes.

## Advisory

- structural review result: not_applicable — no `skills/public`/`skills/support` tree, so the
  planner emitted no `structural_review_packet`.
- prose review result: `entrypoint_docs_ergonomics` flags `README.md`, heuristic and unchanged;
  `standing_gate_verbosity` reports `escape_hatch: missing` for `.githooks/pre-push`, a false
  positive since the hatch is `git push --no-verify` and the hook documents it. Nothing found by
  `structural_waste`, `dual_implementation`, `hardcoded_discovery`, `lint_ignores`,
  `ci_recoverable_gates`, `gitignore_scan_hygiene`; command: the corresponding `inventory_*.py`.
- `--test-concurrency=1` entered the repo inside an unrelated feature commit with no recorded
  reason (`git log -S`), and a contract test then locked the string. A pin nobody could explain
  cost 54s per gate run for months.

## Delegated Review

- Delegated Review: executed — three subagents. One mapped the release tier's cost (its
  duplication map drove the whole speed slice). One bounded fresh-eye reviewer found the first
  mutex unsound: it guarded the build but not the `npm pack`/`cpSync` read, and the in-process
  memo made it worse. That finding was verified here and is why commit 2 exists; without it
  this lane would have shipped a race hidden behind three green runs. One bug hunt returned
  seven source findings; four were reproduced here and fixed, two are recorded under `Missing`
  as read-only, and its own discard list correctly killed the prior review's
  `negotiated_protocol_version` card.
- Slow-gate lenses, all three delegated to the cost-mapping agent this turn: fixture-economics
  (it found `packedProtocolFixture` and `makeGatewayProtocolFixture` cache nothing, so
  `ceal-protocol` is built and packed 7× per run); parallel-critical-path (the per-file split
  that showed one 22s file is the floor); duplicated-proof (the same SEA artifact built 3×, and
  `verifyGatewayProtocolConsumer` run twice).

## Commands Run

- `time npm run check` (exit 0; 43.4s / 43.6s / 44.3s / 45.7s / 46.1s / 46.8s across the pass),
  `time npm run check:unit` (21.8s), per-tier and per-file `time`/`date +%s%N` splits
- baselines: `test:release` 74.6s serial vs 20.6s parallel ×3, and at `--test-concurrency` 2 (37.3s) and 4 (26.5s)
- soaks: 8 parallel release runs, 10 contract runs, 3 pre-lock parallel runs — all green
- falsification by deletion: mutex, release nonce check, liveness check, owner-write grace,
  build memo, positional index, observer freshness copy, spool strict read, EPERM path,
  unparsable-owner path — each turns a named test red (the grace probe hangs)
- readbacks against the built binary: `ceal capabilities` under an empty `HOME` before and
  after the recovery fix; a scripted spool reproduction before and after the mode fix
- `plan_quality_run.py`, the four planner-dispatched inventories named above, `npm audit`
- not run, and so not claimed: any macOS or CI run of the now-parallel tier; no live Gateway
  readback

## Recommended Next Quality Moves

- active bound `ceal update` — capability_needed=a black-holed release origin or a concurrent update cannot hang the command with no envelope written; next_center=`stable-update.ts:189-215` plus `--max-time` in `install-ceal.sh`; transformation=give `runProcess` a deadline and a kill, as every other wait in this CLI already has; proof_boundary=point the installer at a black-holed address and assert a bounded failure envelope; enforcement_posture=gate.
- active give `createLock`'s failure cleanup the ownership check `releaseLock` has — capability_needed=a holder descheduled past the initialization grace cannot delete its successor's lock; next_center=`local-store-lock.ts:93-96`; transformation=remove only a lock that is still owner-less or ours, copying `releaseLock:105-112`; proof_boundary=the existing "does not delete its successor's" test, aimed at the create path; enforcement_posture=gate.
- active prove the parallel tier on the runners that gate it — capability_needed=the concurrency change is verified where it actually runs, not only on a 36-core host; next_center=`.github/workflows/check.yml`; transformation=read the first ubuntu and macOS runs after this lands, and record whether the npm-cache surface or the pid-built tmp path produces noise; proof_boundary=a green macOS run of `test:release` without `--test-concurrency=1`; enforcement_posture=advisory because the observation is the work, not a new threshold.
- passive capture gate timings mechanically — capability_needed=gate cost becomes a trend rather than figures `AGENTS.md` forbids quoting; next_center=`command_timing_log` in `.agents/quality-adapter.yaml`; transformation=append each run's elapsed time to a machine-written log; proof_boundary=`render_runtime_summary.py` reporting real hot spots; enforcement_posture=no-gate because the repo's contract test refuses runtime assertions as flaky, so this is measurement and not a threshold.
- passive share the SEA artifact between the two suites that build it — capability_needed=the release tier's 22s floor drops toward its next-slowest file; next_center=`worker-release-installer.test.mjs:345` and `worker-native-artifact.test.mjs:20`; transformation=content-address the artifact on the packed tarball digests plus the toolchain identity, reusing the `withDistLock` shape; proof_boundary=mutate a worker source file and watch the cache miss; enforcement_posture=no-gate until the digest can be shown to cover every input, because a stale binary in a release-proof tier is worse than a slow one.

## History

- [2026-07-27 — second pass, superseded by this one](history/2026-07-27-quality-review-second-pass.md)
- [2026-07-27 — first pass](history/2026-07-27-quality-review.md)
- [2026-07-26 — first quality review](history/2026-07-26-quality-review.md)
