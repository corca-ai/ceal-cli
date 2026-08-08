# Quality Review
Date: 2026-08-08
Title: Quality Review

## Scope

Target boundary: repo-wide quality posture after the legacy `cealctl` lane was deleted (commits `6c8fae6`, `d8fc5fd`, `82a0ad5`). No target skill; `skills_in_scope` is false per the planner.

Ambient repo findings: binary/linter/hook setup and runtime visibility, requested explicitly by the operator alongside the deletion work.

## Surface Contract Review

- semantic coverage: `partial` — the pre-push gate surface was observed end to end; the worker CLI's own semantic surface was not re-reviewed here.
- surface: the standing local gate (`.githooks/pre-push` → `npm run check:unit` / `npm run check`) and its timing output.
- owner: `.githooks/pre-push`; `scripts/install-git-hooks.mjs` owns installation and the `--check` readback.
- projections: stderr phase lines for the human, `.charness/quality/command-timing.jsonl` for later sessions, exit code for git. Remote/storage projections `n/a`.
- state scope: per-push, appended; the log is bounded to the most recent 200 samples.
- transitions: pass and fail both executed for the branch and tag paths, including a failing gate (exit 42 preserved, not flattened) and an unwritable timing log.
- proof boundary: both hook paths executed against the real gate on this host (48s branch, 106s tag) with the log read back; failure paths executed with stand-in gate commands in `repo-gates.test.mjs`; `shellcheck -s sh` plus `dash -n` and `zsh -n` clean.
- unexamined axes: behavior on a host without `tail`/`wc`; concurrent pushes appending to the same log; the log carries no `profile` field, so it is per-clone by accident rather than by design.

## Current Gates

- `npm run check:unit` — lint + build + client/worker unit + `test:contract`. 48s measured.
- `npm run check` — adds `test:release`. 106s measured. 426 tests pass, 1 skipped (platform-gated).
- `npm run lint` — `biome check .`, inside both gates, 97 files.
- `.github/workflows/check.yml` — full gate on every push and PR to `main`, ubuntu + macOS.
- `.githooks/pre-push` — iteration gate on branch push, full gate on tag push; `node scripts/install-git-hooks.mjs --check` confirms this clone enforces it.
- `protocol-vendor-pin.json` + `npm run check:protocol-dev` — vendored-protocol drift and proof/ship divergence.
- `npm run probe` — declared-effect guard, refuses any route that is not `read_only`.
- `npm run check:duplication` — boy-scout duplicate ratchet, armed this slice; hook-run, maintainer-local.
- `npm run lint:shell` — `shellcheck -s sh --severity=warning` over `install-ceal.sh` and the hook; hook-run, maintainer-local.

## Runtime Signals

- runtime source: `command_timing_log` bridge, written by `.githooks/pre-push` to `.charness/quality/command-timing.jsonl` and rendered by `render_runtime_summary.py --detail`. Before this slice `commands_source` was `none`. <!-- reproduction-source -->
- runtime hot spots: `tag push, full gate` 106000ms; `iteration gate` 48000ms. Neither is budgeted yet — one sample each.
- startup probe: `ceal --help process start` 146ms median over 5 samples (`measure_startup_probes.py --detail`).
- coverage gate: introduced this slice. `c8` remapped to `src/**/*.ts`, `all: true`, floors in each `.c8rc.json` and `check-coverage: true`. Worker 93.86% statements / 83.92 branches / 92.73 functions; client 99.00 / 90.58 / 100.00. `test:unit` is the coverage run, so the suites are not paid for twice.
- evaluator depth: deterministic gates plus quality-skill inventories only; no Cautilus run.

## Healthy

- Source hygiene is genuinely clean, not unmeasured: `inventory_lint_ignores` 0, `inventory_brittle_source_guards` 0, `inventory_dual_implementation` 0, `inventory_structural_waste` 0, `inventory_hardcoded_discovery` 0, `run_dead_code_advisory` clean at both confidence tiers.
- Every required binary is present: `node` 22.22.1, `npm` 10.9.4, `rg` 13.0.0, `git` 2.34.1, `gh` 2.92.0, `cosign`, `jq`, `python3`, `shellcheck`.
- All four workflows run `npm run check` (`ceal-release.yml:119`, `check.yml:155,201`, `npm-package-stage.yml:37`); local and CI prove the same thing.
- `inventory_adapter_gate_design` now reports 0 findings; `migration_gap` closed this slice.
- The duplicate ratchet is armed and falsified in both directions: a planted clone of `prewarm-offline-consumer-cache.mjs` hard-blocked with the family named, and removing it returned green. Baseline seeded at 132 code families over `scripts`, both `src` trees, and `test`. It then caught its own front door twice. The first hit was a real four-line `stderr`-then-`exit` helper duplicated from `probe-surface.mjs`, now `scripts/lib/exit-with.mjs`. The second was an ES-module import header, and the attempted fix is the more useful record: extracting `repoRootFrom()` and converting all ten call sites turned one family into three, because every rewritten header then carried the same extra import, and it broke the `install-git-hooks` scratch-clone test that needs that script self-contained. Reverted and classified `intentional` in the overlay with that reasoning attached — which is what the class is for.
- A defeatable release-safety gate was found and closed. The Requirement 3 source-shape gate matched a call inside an error-translating wrapper, so deleting the one live invocation in `resolveWorkerReleaseDevelopmentInputs` — disarming release-input resolution, packing, the native build, and the workflow's compose step — left every gate green. Reproduced, then falsified behaviourally: a scratch `repoRoot` reaches the guard and fails for a pin reason, and with the call removed the same input fails on the next argument check instead. Red against the deletion, green against the fix.
- Coverage exists and is scoped deliberately, following `../craken-agents`: source-mapped to `src`, `all: true` so an untested module is zero rather than invisible, two named exclusions with reasons, floors from measurement. Three of the four plausible scopings inflate the number, and one — Node's own `--test-coverage-include='src/**'` — reports a perfect score over an empty set. `repo-gates.test.mjs` now asserts the floor, `all`, and `check-coverage` so the gate cannot be softened into a report.
- Shell is linted for the first time. `install-ceal.sh` is a signed release asset and `.githooks/pre-push` is the last gate before a push, and `biome` sees neither. The warning tier found a dead variable the installer had been assigning since its byte comparison was removed.
- The delegated review's two hook defects are fixed and one is now regression-tested. It found that a green gate could still block the push when log rotation failed (an unwritable `.charness/quality` gave `EXIT=2` one line after printing "passed"), and that the hook used `status` as a scratch variable — which this repo's own convention bans, and which kills the hook under `zsh` before the gate runs. Reproduced both, fixed both, and added `repo-gates.test.mjs` coverage that runs the hook with stand-in gate commands: it goes red against the defective shape and green against the fix, verified in both directions. Its precision findings are fixed too — failures now record under their own label so red pushes cannot drag the passing median down, the seconds-resolution and `dist/`-dependency caveats are stated at their sites, and the `AGENTS.md` timing rule no longer points at a log that usually has no full-gate sample.

## Weak

- Runtime budgets are unset. Samples now exist but n=1 per label, and a threshold picked off one sample is the false-red this repo has already been burned by. Deliberately deferred, not overlooked.
- `inventory_ci_local_gate_parity` reports all four workflows unmatched unless invoked with `--canonical-gate-pattern 'npm run check'`; there is no adapter key for it, so the invocation is the only carrier. Recorded here because the same finding was recorded on 2026-07-27 and lost.
- The `noRestrictedGlobals` override for `**/*.mjs` outlived its reason. It was added because the Gateway lane mirrored this source into a harness whose lint did not know those globals; that mirror is gone — `corca-ai/ceal` consumes only `.tgz` artifacts under `vendor/ceal-cli/` and ignores `packages/ceal-client/**` in its own eslint. Kept as a local convention with the false justification corrected in `docs/gates.md` and `biome.json`; dropping it entirely is now defensible.
- `README.md` is 280 core lines with 2 internal doc links — `long_entrypoint` plus `progressive_disclosure_risk` from `inventory_entrypoint_docs_ergonomics`.

## Missing

- `scripts/` is 4,052 lines of release-lane production code with no coverage; measured at 79.88/71.63/89.53 across both tiers but not gated. It is slice 1 of the next goal, because a guard nobody calls surfaces there as 0% functions.
- Nothing measures the `test/` tier. Coverage covers the two owned packages; the contract and release suites and the scripts they exercise have no ratio at all.
- Neither hook-run gate reaches CI. `check:duplication` and `lint:shell` block a maintainer's push and stand aside everywhere else, so a change that lands without passing through a configured clone is unchecked by both. Honest, but not enforcement.

## Deferred

- `assertWorkerReleaseSourcePath` (`scripts/worker-release-inputs.mjs:220`) has no production caller; the forbidden-path inventory is declared and enforced only from tests. Tracked in `docs/handoff.md`; predates this slice.

## Advisory

- structural review result: no target skill in scope, so the planner emitted no `structural_review_packet`; `skill_ergonomics_skill_paths` was repaired this slice (it still named the deleted `skills/cealctl-guide/SKILL.md`).
- prose review result: `AGENTS.md` was breaking its own stated rule that a rule which has grown an explanation belongs in a truth surface — `## Frozen Paths` had become three narrative paragraphs. Rewritten against `/home/ubuntu/ceal/AGENTS.md`'s conventions; the explanation moved to `README.md`.
- `inventory_doc_duplicates` reports 3 near-duplicate Markdown families, all inside `docs/requests/` — delivered correspondence, not a maintained surface. `command: inventory_doc_duplicates.py --summary`.
- Several inventories scan paths this repo does not have (`skills/public`, `skills/support`, `runtime_bootstrap.py`, `tests`) and report `scope_status: partial`. Preset residue from `typescript-quality`/`monorepo-quality`; harmless but it makes those packets look evaluated when they are vacuous.

## Delegated Review

- Delegated Review: executed — a bounded fresh-eye subagent reviewed the uncommitted quality slice (hook correctness under `set -eu`, gate-failure propagation, truth of every new `AGENTS.md` rule including rules dropped from the previous version, and startup-probe honesty). It confirmed the gating contract and every `AGENTS.md` factual claim, found no silently dropped rule, and returned two real hook defects plus four precision gaps — all fixed in this slice and recorded under `## Healthy`.
- Slow-gate lenses (fixture-economics, parallel-critical-path, duplicated-proof): not re-delegated — no slow-gate scope in this slice; the two gate timings were measured, not triaged.

## Commands Run

- `plan_quality_run.py`, `resolve_adapter.py`, `bootstrap_adapter.py`, `resolve_quality_artifact.py --intent record`
- `inventory_lint_ignores.py`, `inventory_brittle_source_guards.py`, `inventory_dual_implementation.py`, `inventory_structural_waste.py`, `inventory_hardcoded_discovery.py`, `inventory_gitignore_scan_hygiene.py`, `inventory_nose_clones.py`, `inventory_doc_duplicates.py`, `inventory_entrypoint_docs_ergonomics.py`, `inventory_standing_test_economics.py`, `inventory_standing_gate_verbosity.py`, `inventory_ci_local_gate_parity.py`, `inventory_ci_recoverable_gates.py`, `inventory_release_only_sentinels.py`, `inventory_cli_ergonomics.py`, `inventory_ubiquitous_language.py`, `inventory_adapter_gate_design.py`, `inventory_sloc.py`, `run_dead_code_advisory.py`
- `render_runtime_summary.py --detail`, `measure_startup_probes.py --detail`
- `.githooks/pre-push` executed on both the branch and tag paths; `shellcheck .githooks/pre-push`; `time npm run check`

## Recommended Next Quality Moves

- active raise the branch floors — capability_needed=the weakest-proven paths get proven rather than averaged over; next_center=`acceptance-record.ts` at 55% branch and `bin.ts` at 50%; transformation=cover those two, then ratchet the worker branch floor above 83; proof_boundary=`npm run coverage` green at the higher floor; enforcement_posture=advisory until the tests land.
- active set runtime budgets from a real window — capability_needed=a gate slowdown is visible before it is normalized; next_center=`.agents/quality-adapter.yaml` `runtime_budget_profiles.local-linux-aarch64-2cpu`; transformation=derive budgets once `command-timing.jsonl` holds ~10 samples per label; proof_boundary=`check_runtime_budget.py` green on the recorded window; enforcement_posture=advisory.
- passive split `README.md` — capability_needed=a reader reaches the right doc without scanning 280 lines; next_center=`README.md`; transformation=move the release-lane and distribution sections behind links to `docs/`; proof_boundary=`inventory_entrypoint_docs_ergonomics.py` no longer reports `long_entrypoint`; enforcement_posture=no-gate because the entrypoint heuristic is advisory and the split is a judgment call the operator should make.

## History

- [2026-07-27 quality review](history/2026-07-27-quality-review-second-pass.md)
