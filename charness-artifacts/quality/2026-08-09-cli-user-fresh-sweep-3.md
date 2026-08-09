# Quality Review
Date: 2026-08-09
Title: CLI User Fresh Sweep 3

## Scope

Target boundary: worker CLI user-visible correctness, recovery truth, local-state
integrity, bounded local inspection, startup behavior, and fine-grained
performance visibility.

Ambient repo finding: the native SEA smoke retyped top-level usage and rejected
the additive timing prefix. It now checks the structural usage shape.

## Surface Contract Review

- semantic coverage: `partial` — Linux source, built dist, deterministic local
  fixtures, and a Linux SEA smoke were exercised.
- surface: public command parsing/help, timing diagnostics, session lifecycle,
  logout, Profile selection, audit inventory, advisory stores, and update.
- owner: CLI declarations own routes/effects; fixed timing vocabulary owns phase
  names; Gateway owns live session/provider truth.
- projections: one-YAML stdout, opt-in JSONL stderr, exit status, local stores,
  session disposition, and observer inventory.
- state scope: one local worker installation and concurrent same-user processes.
- transitions: issued-but-uncommitted session, partial logout, refresh
  quarantine, parent-path substitution, lock contention, and timed update.
- proof boundary: focused built-dist tests, worker suite, repo gates, native SEA
  smoke, and bounded Luna/xhigh review.
- unexamined axes: macOS execution, signed released worker, live Gateway, and
  provider readback.

## Current Gates

`npm run check:unit` is the iteration gate and `npm run check` is final.
Store-lock, duplicate-literal, reachability, coverage, native artifact, and
release fixtures cover this slice; pre-push adds duplication and shell checks.

## Runtime Signals

- runtime source: repo timing log summarized by
  `render_runtime_summary.py --repo-root . --detail`. <!-- reproduction-source -->
- runtime hot spots: the structured command-timing log identifies the standing
  iteration/full-gate cost; `ceal --timing` now separates user-command phases.
- coverage gate: worker/client coverage is enforced by `npm run check:unit`;
  scripts coverage is enforced by `npm run check`.
- evaluator depth: deterministic gates, three independent Luna/xhigh scan
  angles, and repaired-tree review; no live provider evaluator ran.

## Healthy

- `ceal --timing <command>` emits secret-free fixed-vocabulary phase events to
  stderr while preserving ordinary behavior and one-YAML stdout.
- Session enrollment/adoption revokes every issued session that cannot commit
  locally and exposes the disposition.
- Logout stays in its own schema and preserves remote versus local truth.
- Stored Profile refs reject before state or network work.
- File removal and lock operations stay anchored to an opened owner-only parent
  across visible-path substitution.
- Audit directory enumeration streams under shared entry and monotonic budgets.

## Weak

- Stateful commands still import the full public runtime; timing makes the cost
  attributable but does not remove it.
- Descriptor-anchored Darwin behavior is source-supported but not executed on
  this Linux host.

## Missing

- Signed released-binary execution on all release platforms.
- Live Gateway/provider readback.
- A local session-generation contract for late pre-logout receipt writers.

## Deferred

- Split public runtime dependencies by declared route after collecting timing
  evidence.
- Reclaimed-lock tombstone GC remains generation-sensitive debt.

## Advisory

- command: `npm run bootstrap:gateway-handoff -- --tag <tag>` now owns
  read-only public handoff authentication before release mutation.
- command: `inventory_cli_ergonomics.py --repo-root . --summary` — generic
  inventory remains unconfigured; typed route/help declarations are the owner.
- command: `inventory_cli_side_effect_probes.py --repo-root . --summary` —
  generic probes remain unconfigured; the repo-derived route effect guard is
  stronger and should not be duplicated.
- artifact: `charness-artifacts/impl/2026-08-09-cli-user-fresh-sweep-3.md`
  records implementation and proof limits.

## Delegated Review

- Delegated Review: executed — Luna/xhigh subagents independently scanned
  lifecycle/state, UX/output contracts, and performance/visibility.
- Repaired-tree fresh-eye review found and drove fixes for logout schema,
  preflight recovery, TTY timing contamination, missing timing boundaries,
  cleanup TOCTOU, and diagnostic callback truth.
- Reviewer-boundary fingerprints were clean at the bounded review windows.
  Parent-only final sibling fixes are accepted-unreviewed after the maximum
  review rounds and carry focused regressions.
- Slow-gate lenses: `fixture-economics`, `parallel-critical-path`, and
  `duplicated-proof` were applied.

## Commands Run

- Worker build, focused lifecycle/timing/store/audit tests, full worker package
  suite, and native SEA smoke.
- `npm run check:unit`; `npm run check`; maintainer-local duplication/shell
  checks and pre-push hook at closeout.
- Quality runtime summary, artifact validators, reviewer-boundary checks, and
  `git diff --check`.

## Recommended Next Quality Moves

- active split public runtime by route — capability_needed=lower measured
  startup work; next_center=`bin.ts` factories; transformation=load only
  route-owned dependencies; proof_boundary=timing events plus module-load
  markers; enforcement_posture=advisory.
- active prove Darwin descriptor anchors after release —
  capability_needed=platform deletion safety; next_center=released
  `darwin-arm64` worker; transformation=none unless readback fails;
  proof_boundary=Mac race fixture; enforcement_posture=advisory.
- active define local session generation — capability_needed=late-writer
  exclusion; next_center=session identity and spool key; transformation=bind
  writes to one local generation; proof_boundary=logout/re-login concurrency;
  enforcement_posture=advisory.

## History

- [Prior quality baseline](history/2026-07-27-quality-review-second-pass.md)
