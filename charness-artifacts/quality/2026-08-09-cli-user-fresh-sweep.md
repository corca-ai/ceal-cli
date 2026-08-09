# Quality Review
Date: 2026-08-09
Title: CLI User Fresh Sweep

## Scope

Target boundary: worker CLI behavior visible to an agent or employee: startup,
argv refusal, help and recovery, declared effects, local-state safety, observer
attribution, and stable update completion.

Ambient repo findings: the first full iteration gate exposed a stale contract
test that copied the former capabilities effect. It was updated with this slice.

## Surface Contract Review

- semantic coverage: `partial` — Linux source/dist behavior and deterministic
  local tests were exercised; macOS, a released binary, and live Gateway or
  provider behavior were not.
- surface: `ceal` public commands, leaf help, YAML results, local stores, and the
  observer projection.
- owner: `CEAL_COMMANDS` / `CEAL_SUBCOMMANDS` own routes and effects; each store
  owns its filesystem rules; the Gateway owns live capability truth.
- projections: stdout YAML/help, process exit status, `~/.ceal` state, probe
  refusal, and observer state.
- state scope: one installed worker session and its session-derived cache and
  receipt spool.
- transitions: absent/unsafe session store, enrollment/adoption replacement,
  refresh, call receipt append, logout cleanup, and observer readback.
- proof boundary: local build, focused runtime reproductions, package/contract
  suites, and bounded fresh-eye review.
- unexamined axes: macOS runtime, signed release installation, live Gateway,
  provider calls, and adversarial filesystem races after a completed path check.

## Current Gates

`npm run check:unit` is the iteration gate and `npm run check` is the final gate.
The repo-derived probe is the installed-surface guard. Store, CLI, observer, and
update suites cover the changed behavior; the maintainer-local duplication and
shell gates remain separate by design.

## Runtime Signals

- runtime source: structured metrics from `.charness/quality/command-timing.jsonl`, rendered by the
  quality runtime-summary command; reviewer startup probes supplied this
  slice's command-level comparison. <!-- reproduction-source -->
- runtime hot spots: stateful routes still evaluate the full public runtime;
  reproduce with the reviewer command recorded under Commands Run.
- coverage gate: package coverage and contract tiers run through
  `npm run check:unit`.
- evaluator depth: deterministic gates and bounded subagents only; no Cautilus
  run because no log-backed evaluator request was in scope.

## Healthy

- Static help, commands, version, and refusal routes stay ahead of full runtime
  evaluation.
- Malformed argv now refuses before session or Gateway work with the argument
  exit class and route-local help.
- Local store cleanup refuses substituted or widened parents, and observer cache
  output is bound to the current session.
- Receipt lock contention is bounded as advisory work and remains observable via
  the existing drop counter rather than delaying a completed call for seconds.

## Weak

- Every public stateful route still imports one eager runtime that constructs
  stores, guide inspection, and updater dependencies not used by that route.
- Receipt history has an identity discriminator but no local session-generation
  discriminator, so a pre-logout process may write after same-identity login.

## Missing

- An explicit local session-generation contract that rejects late writes while
  preserving intended same-identity re-enrollment history.

## Deferred

- Route-specific lazy public-runtime dispatch: an optimization with a wider
  module-boundary design, not a correctness patch for this slice.
- A timeout specifically around `cosign verify-blob`: no hang was reproduced;
  the managed updater's outer installer deadline remains the current bound.

## Advisory

- command: `inventory_cli_surface.py --repo-root .` — generic JSON inventories
  are unconfigured, but typed route tables and the derived probe are stronger
  owners; parallel JSON would violate One Fact, One Home.
- artifact: `charness-artifacts/impl/2026-08-09-cli-user-fresh-sweep.md` —
  Boundary ownership: Producer: route/store declarations; Consumer: CLI user,
  probe, and observer; Owning surface: worker CLI; Verdict: `owned-correctly`.
- command: `rg -n 'CEAL_COMMANDS|CEAL_SUBCOMMANDS' packages/ceal-worker-cli/src`
  — no skill package was targeted; command and recovery prose were reviewed at
  their declaration owners.

## Delegated Review

- Delegated Review: executed — three parent-delegated Luna/xhigh reviewers used
  distinct UX/recovery, state-integrity, and performance/update lenses. Findings
  were received and repaired; a post-repair pass found the acceptance exit-class,
  cleanup-truth, and receipt-lock tail defects. Shared-tree fingerprint verdicts
  were clean after each result.
- Reviewer tier: high-leverage; requested fields sent on the initial spawns;
  host exposure `requested_fields_sent`; provider application not claimed.
- Slow-gate lenses: fixture-economics was not implicated; parallel-critical-path
  and duplicated-proof remain owned by the prior review; command-startup and
  lock-tail cost were delegated here.

## Commands Run

- Quality adapter planning, runtime summary, CLI inventory, and reviewer-boundary
  snapshot/verify commands from the installed charness quality/prove packages.
- Focused `node --test --test-name-pattern=...` runs for CLI, guide, adoption,
  stores, observer, probe, and updater behavior.
- Linux startup probes with `/usr/bin/time` and `strace`; a fake local Gateway
  plus a live spool lock reproduced the process-exit tail.
- `npm run check:unit`; `npm run check`; `npm run check:duplication`;
  `npm run lint:shell`; `git diff --check`.

## Recommended Next Quality Moves

- active define local session generation before changing receipt attribution —
  capability_needed=late-writer exclusion; next_center=session identity and spool
  key; transformation=bind writes to a local generation without discarding valid
  same-identity history; proof_boundary=logout/re-login concurrent-process test;
  enforcement_posture=advisory.
- active split the public runtime by declared route — capability_needed=lower
  stateful startup overhead; next_center=`bin.ts` and public runtime factories;
  transformation=load only route-owned dependencies; proof_boundary=module-load
  markers plus repeated Linux startup probes; enforcement_posture=advisory.
- passive because no hang reproduced, add a cosign-local timeout only after a
  hanging verifier outlives the updater deadline; capability_needed=verifier
  cancellation; next_center=installer verification; transformation=none yet;
  proof_boundary=hanging cosign fixture; enforcement_posture=no-gate because no
  failing behavior has been observed.

## History

- [Earlier 2026-08-09 review](2026-08-09-quality-review.md)
- [2026-08-08 review](2026-08-08-quality-review.md)
- [2026-07-27 review](history/2026-07-27-quality-review.md)
