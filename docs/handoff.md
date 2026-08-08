# Session Handoff

## Workflow Trigger

If this file is mentioned with no other task, start at the first item of
`## Next Session`. `AGENTS.md` `## Boundaries` owns which acts need approval
first — push, tag, GitHub write, Gateway write, release publish, and any live
provider readback. This file does not keep a second, shorter list.

## Continuation Capability

After reading this you should not need to re-derive anything: the standing goal
and its slices live in
[release-guard-reachability.md](release-guard-reachability.md), and every gate's
reasoning in [gates.md](gates.md). This file holds only what changes the next
action.

## Current State

- Version `0.74.0` (root and `packages/ceal-worker-cli` agree), latest tag
  `ceal-v0.74.0`. `gateway-protocol-handoff-lock.json` is the single record of
  handoff consumption.
- **Two commits are unpushed**: `0cce9f9` and `da52059`, the guard deletions and
  the test refactor they forced. Both touch code, so the next push runs the gate.
- `check.yml` is green on both legs (run `31263490521`) after five consecutive red
  runs on a platform-pruned `package-lock.json`. Cause, consequence and the rule
  it earned are in `AGENTS.md` `## Conventions`; the gate is in
  `repo-gates.test.mjs`.
- Both `check.yml` gate legs now skip documentation-only changes, which no
  docs-only commit has yet exercised — see item 1.
- Four workflows: `check.yml`, `ceal-release.yml`, `ceal-worker-stable-rollback.yml`,
  `npm-package-stage.yml`. Time the gates on the host in hand rather than
  inheriting a figure; `.charness/quality/command-timing.jsonl` may hold a sample.

## Next Session

1. **Confirm the documentation-only CI skip.** It applies to the whole pushed
   *range*, not the tip commit — checking `git status` is how this was got wrong
   once already. Verify with `git diff --name-only origin/main..HEAD` before
   pushing, and expect `scope` to report `code=false` with neither leg running.
2. **Slice 4, in its two decided steps**: adopt `knip` — settled, not contingent
   on what it finds — then build the narrow production-reachability check for the
   class `knip` structurally cannot see. Slice 2 proved coverage cannot see it
   either. [release-guard-reachability.md](release-guard-reachability.md) has the
   reasoning and the trap to avoid.
3. **Then slice 2's remaining mass**: `worker-acceptance-packet.mjs`, 52.64%
   statements, everything from `:407`. Its two dead guards are already deleted.
4. **Slice 3 is decision-first**, not implementation: both items are knowing holes
   to settle with the operator before anything moves.
5. Do not reopen the coverage run's cost as a performance goal. The obvious lever
   was measured and recovered ~9s of 52; gates.md says why the rest is the
   measurement rather than waste.

## Discuss

Needs the operator this session; carried-but-unscheduled work belongs in
[debt.md](debt.md) instead.

- **[debt.md](debt.md) was carried unconfirmed across sessions.** Re-confirm an
  item before starting it, or delete it.

## References

- [release-guard reachability goal](release-guard-reachability.md) ·
  [gate detail](gates.md) · [carried debt](debt.md) ·
  [release and enrollment](release-and-enrollment.md) ·
  [operator acceptance ceiling](operator-acceptance.md)
- [docs/requests/](requests/) — where a divergence declaration must point.
- Session history is in `git log`; this file does not keep one.
