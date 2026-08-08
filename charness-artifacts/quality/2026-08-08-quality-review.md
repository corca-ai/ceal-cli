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
- coverage gate: none exists. No `c8`/`nyc`/`--experimental-test-coverage` anywhere; the adapter's `coverage_floor_policy` names `lefthook.yml` and `scripts/coverage-floor-exemptions.txt`, neither of which is in the repo.
- evaluator depth: deterministic gates plus quality-skill inventories only; no Cautilus run.

## Healthy

- Source hygiene is genuinely clean, not unmeasured: `inventory_lint_ignores` 0, `inventory_brittle_source_guards` 0, `inventory_dual_implementation` 0, `inventory_structural_waste` 0, `inventory_hardcoded_discovery` 0, `run_dead_code_advisory` clean at both confidence tiers.
- Every required binary is present: `node` 22.22.1, `npm` 10.9.4, `rg` 13.0.0, `git` 2.34.1, `gh` 2.92.0, `cosign`, `jq`, `python3`, `shellcheck`.
- All four workflows run `npm run check` (`ceal-release.yml:119`, `check.yml:155,201`, `npm-package-stage.yml:37`); local and CI prove the same thing.
- `inventory_adapter_gate_design` now reports 0 findings; `migration_gap` closed this slice.
- The duplicate ratchet is armed and falsified in both directions: a planted clone of `prewarm-offline-consumer-cache.mjs` hard-blocked with the family named, and removing it returned green. Baseline seeded at 132 code families over `scripts`, both `src` trees, and `test`. It then caught its own front door duplicating `probe-surface.mjs:38-41`, which is now `scripts/lib/exit-with.mjs` — the gate paying for itself on day one.
- Shell is linted for the first time. `install-ceal.sh` is a signed release asset and `.githooks/pre-push` is the last gate before a push, and `biome` sees neither. The warning tier found a dead variable the installer had been assigning since its byte comparison was removed.
- The delegated review's two hook defects are fixed and one is now regression-tested. It found that a green gate could still block the push when log rotation failed (an unwritable `.charness/quality` gave `EXIT=2` one line after printing "passed"), and that the hook used `status` as a scratch variable — which this repo's own convention bans, and which kills the hook under `zsh` before the gate runs. Reproduced both, fixed both, and added `repo-gates.test.mjs` coverage that runs the hook with stand-in gate commands: it goes red against the defective shape and green against the fix, verified in both directions. Its precision findings are fixed too — failures now record under their own label so red pushes cannot drag the passing median down, the seconds-resolution and `dist/`-dependency caveats are stated at their sites, and the `AGENTS.md` timing rule no longer points at a log that usually has no full-gate sample.

## Weak

- Runtime budgets are unset. Samples now exist but n=1 per label, and a threshold picked off one sample is the false-red this repo has already been burned by. Deliberately deferred, not overlooked.
- `inventory_ci_local_gate_parity` reports all four workflows unmatched unless invoked with `--canonical-gate-pattern 'npm run check'`; there is no adapter key for it, so the invocation is the only carrier. Recorded here because the same finding was recorded on 2026-07-27 and lost.
- The `noRestrictedGlobals` override for `**/*.mjs` outlived its reason. It was added because the Gateway lane mirrored this source into a harness whose lint did not know those globals; that mirror is gone — `corca-ai/ceal` consumes only `.tgz` artifacts under `vendor/ceal-cli/` and ignores `packages/ceal-client/**` in its own eslint. Kept as a local convention with the false justification corrected in `docs/gates.md` and `biome.json`; dropping it entirely is now defensible.
- `README.md` is 280 core lines with 2 internal doc links — `long_entrypoint` plus `progressive_disclosure_risk` from `inventory_entrypoint_docs_ergonomics`.

## Missing

- Neither hook-run gate reaches CI. `check:duplication` and `lint:shell` block a maintainer's push and stand aside everywhere else, so a change that lands without passing through a configured clone is unchecked by both. Honest, but not enforcement.
- No coverage measurement at all. The adapter declares an 80% floor policy the repo has no way to satisfy or even report against, which reads as enforcement that does not exist.

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

- active add a coverage signal — capability_needed=a maintainer can see which worker behavior is unproven instead of trusting test count; next_center=`packages/ceal-worker-cli`; transformation=run the existing suites under `node --test --experimental-test-coverage` and report before setting any floor; proof_boundary=a coverage report checked in against the current suites; enforcement_posture=advisory until one report exists, because the adapter's 80% floor was never measured against.
- active set runtime budgets from a real window — capability_needed=a gate slowdown is visible before it is normalized; next_center=`.agents/quality-adapter.yaml` `runtime_budget_profiles.local-linux-aarch64-2cpu`; transformation=derive budgets once `command-timing.jsonl` holds ~10 samples per label; proof_boundary=`check_runtime_budget.py` green on the recorded window; enforcement_posture=advisory.
- passive split `README.md` — capability_needed=a reader reaches the right doc without scanning 280 lines; next_center=`README.md`; transformation=move the release-lane and distribution sections behind links to `docs/`; proof_boundary=`inventory_entrypoint_docs_ergonomics.py` no longer reports `long_entrypoint`; enforcement_posture=no-gate because the entrypoint heuristic is advisory and the split is a judgment call the operator should make.

## History

- [2026-07-27 quality review](history/2026-07-27-quality-review-second-pass.md)
