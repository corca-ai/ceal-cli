# Quality Review
Date: 2026-08-09
Title: Quality Review

## Scope

Target boundary: repo-wide, with the operator's question split in two — is the standing gate's *speed* acceptable, and is there duplication, dead test surface, dead code, redundant bootstrap, or absent caching. Not a target-skill review; this repo authors no skills under `skills/public` or `skills/support`.

Ambient repo findings: the session that preceded this review added two gates and three suites, so part of the runtime growth under review is its own. That is treated as a finding, not context.

## Surface Contract Review

- semantic coverage: `partial` — the surface under review is the standing gate itself: what a maintainer runs before push and what CI reruns.
- surface: `npm run check` / `npm run check:unit`, plus the two maintainer-local gates in `.githooks/pre-push`.
- owner: `package.json` `scripts` owns composition; `docs/gates.md` owns the reasoning; `.githooks/pre-push` owns local enforcement.
- projections: developer wall-clock before push, `check.yml` runner minutes, and `.charness/quality/command-timing.jsonl` (per-clone, gitignored, written only on a tag push).
- state scope: per-invocation, except `packages/*/dist`, which is cumulative across steps and is the shared state this review's main finding is about.
- transitions: cold clone, warm re-run, tag push (full gate), documentation-only push (no gate by design).
- proof boundary: per-step elapsed time measured this turn on the maintainer host, plus a `dist` digest comparison across a rebuild. No CI-runner timings were taken.
- unexamined axes: CI runner wall-clock, macOS leg cost, cold-clone cost (`node_modules` was warm throughout), and memory/IO pressure.

## Current Gates

`npm run check` and `npm run check:unit` are the two tiers, `.githooks/pre-push` runs the iteration tier (full gate on a tag push) plus `check:duplication` and `lint:shell`. All were run green this session. `docs/gates.md` owns each one's reasoning; this review does not restate it.

## Runtime Signals

- runtime source: `.charness/quality/command-timing.jsonl` (54 samples) rendered by `render_runtime_summary.py --detail`; profile `local-linux-aarch64-2cpu`. `runtime-signals.json` is absent, so there are no budgets. <!-- reproduction-source -->
- runtime hot spots: the log's `iteration gate` median is 57s and its `tag push, full gate` median 134s. Measured this turn, per step, with nothing else running: iteration tier ≈ 68s, full gate ≈ 163s. **The earlier reading of 114s for the iteration tier in this session's own notes was contended by concurrent subagents and is withdrawn.**
- coverage gate: `test:unit` (c8 over both owned packages) 30.5s; the same suites without c8 are 27.5s, so c8 itself is ≈ 3s. `coverage:scripts` is 117.0s against 71.4s for the same two tiers plain — the `docs/gates.md` figures for that pair still hold.
- evaluator depth: deterministic gates only. No Cautilus run; no live provider readback.

## Healthy

- The two tiers are honestly separated and the expensive half is CI/tag-only: `coverage:scripts` is 117.0s of the 163s full gate and is absent from the iteration tier.
- Local enforcement is real and checkable: `.githooks/pre-push` is checked in and `node scripts/install-git-hooks.mjs --check` reports whether a clone enforces it. Maintainer-Local Enforcement disposition: **enforced** (checked-in hook plus a repo-owned clone validator).
- The timing log exists, is machine-readable, and is per-clone rather than committed.

## Weak

- **The gate compiles the same two packages twice per run, and the second compile produces nothing.** `build:worker` builds protocol, client and worker; `test:unit` then triggers `precoverage` in each package, which runs `tsc` again. Measured: client 3.4s + worker 6.1s ≈ **9.5s**, about 14% of the iteration tier. A `dist` digest taken before and after the second build is identical for both packages, so the work is provably redundant. `docs/debt.md` carries this as unscheduled; it now has a number.
- **No build caching anywhere.** `tsc --incremental` on an unchanged tree: worker 4.66s → 2.01s, protocol 5.97s → 3.51s. The frozen `packages/ceal-protocol` is rebuilt on every gate run despite only changing when the vendored copy does — which `verify-protocol-vendor-pin.mjs` already detects.
- **This session's own shutdown test cost 5.2s of standing gate time, 89% of its file.** Its control arm hangs by construction, so it always pays the full `spawnSync` timeout; the timeout had been rounded up rather than sized. Fixed this turn: 5.18s → 1.75s, file 5.80s → 3.23s, and the falsification still turns red when `openInheritedReadable` is reverted.
- **No runtime budgets.** `render_runtime_summary.py` reports `runtime_visibility_missing_budgets`: the adapter declares no budget for this profile, so a 20% drift is only visible to someone who remembers the old number — which is how the 114s misreading above happened.

## Missing

- Nothing new. `docs/debt.md` and `docs/release-guard-reachability.md` own the standing gaps and were re-derived earlier this session.

## Deferred

- Removing the redundant second compile. It is a change to `pretest`/`precoverage`/`prepack`, which feed packing and therefore the release path, so it is not a same-turn edit inside a review. The routing fix is named below rather than applied.

## Advisory

- structural review result: no target skill in scope; the planner emitted no `structural_review_packet`. command: `python3 $SKILL_DIR/scripts/plan_quality_run.py --repo-root . --detail`
- prose review result: not run — this repo authors no skill package, so trigger boundaries and progressive disclosure have no surface here. command: `rg --files -g '**/SKILL.md' .`
- The repo already owns a freshness concept for exactly this problem: `ensurePackageBuilt` in `test/repo-build.mjs` gives `dist` one writer with an inter-process mutex plus an in-process memo, and `docs/gates.md` `## The Release Tier Runs In Parallel` records why. The `precoverage`/`pretest` hooks predate it and bypass it. This is a routing fix that honors an existing convention, not a new gate. command: `rg -n '"pretest"|"precoverage"' packages/*/package.json`
- Dead code: `npm run lint:unused` (knip) and `npm run lint:reachability` both report nothing, and `run_dead_code_advisory.py` was not needed. Both gates' blind spots are already documented in `docs/gates.md`; no new dead surface found by inventory. command: `npm run lint:unused && npm run lint:reachability`
- Duplication: `npm run check:duplication` is green after this session classified six families with reasons. Three duplicates this session *introduced* were extracted rather than classified. command: `npm run check:duplication`

## Delegated Review

- Delegated Review: executed — two bounded fresh-eye reviewers ran earlier this session against the commits under review. Both returned findings and both were confirmed against the tree: a false historical claim about when the receipt-spool asymmetry appeared, an ancestor-walk scope bug in `@separateGrammar`, and a false "the hang does not reproduce through inherited descriptors" claim that was a harness artifact. All three are fixed and recorded.
- Slow-gate lenses (fixture-economics, parallel-critical-path, duplicated-proof): not re-delegated. The duplicated-proof lens was answered directly by the `dist` digest measurement above; the other two are named as unexamined.

## Commands Run

- `python3 $SKILL_DIR/scripts/{resolve_adapter,bootstrap_adapter,resolve_quality_artifact,plan_quality_run,render_runtime_summary,scaffold_quality_artifact}.py --repo-root .`
- Per-step timing of every `check:unit` and `check` step, and of each package build, with a millisecond wrapper around `npm run <step>`.
- `npx tsc -p <pkg>/tsconfig.build.json --incremental --tsBuildInfoFile <tmp>` twice per package.
- `find <pkg>/dist -type f | sort | xargs sha256sum | sha256sum` before and after a rebuild.
- `node --test --test-reporter=spec packages/ceal-worker-cli/test/leased-consumer-control-session.test.mjs`
- `npm run check`, `npm run check:duplication`, `npm run lint:shell`.

## Recommended Next Quality Moves

- active route `precoverage`/`pretest` through the existing `dist` freshness owner instead of an unconditional `tsc` — capability_needed=build-once-per-gate-run; next_center=`packages/*/package.json` scripts plus `test/repo-build.mjs`; transformation=reuse `ensurePackageBuilt`'s freshness check so a standalone `npm run coverage` still builds but a gate run does not rebuild what `build:worker` just produced; proof_boundary=`dist` digest unchanged plus the iteration tier dropping by the measured 9.5s; enforcement_posture=advisory.
- active add `--incremental` with a gitignored `tsBuildInfoFile` to the three builds — capability_needed=build caching; next_center=root `build:worker`, passing the flag through `npm --prefix … run build --` so the frozen protocol package is not edited; transformation=cache unchanged compiles; proof_boundary=re-run `build:worker` twice and compare, against the measured 4.66s→2.01s and 5.97s→3.51s; enforcement_posture=advisory.
- active declare a runtime budget for the two tiers — capability_needed=drift visibility; next_center=`.agents/quality-adapter.yaml` runtime budget for profile `local-linux-aarch64-2cpu`; transformation=turn a remembered number into an enforced one, since this review had to withdraw a 114s reading nobody could check; proof_boundary=`render_runtime_summary.py` stops reporting `runtime_visibility_missing_budgets`; enforcement_posture=candidate-floor, north-star=the gate a maintainer will actually keep running before every push, floor-addition-restraint=set from the measurement above, not from a target.
- passive re-examine whether `coverage:scripts` must run both tiers under `c8` — capability_needed=cheaper `scripts/` coverage; next_center=`scripts/coverage-scripts.mjs`; transformation=none proposed; proof_boundary=the 117.0s vs 71.4s measurement; enforcement_posture=no-gate because `docs/gates.md` already argues the contract tier alone would put the floor at about 55% and that tradeoff is the maintainer's, not this review's.

## History

- [2026-08-08 review](2026-08-08-quality-review.md) — the immediately prior pass.
- [2026-07-27 review](history/2026-07-27-quality-review.md) · [second pass](history/2026-07-27-quality-review-second-pass.md) · [2026-07-26 review](history/2026-07-26-quality-review.md)
