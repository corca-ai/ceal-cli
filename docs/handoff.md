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
- **One commit is unpushed: `a0fbbb3`**, documentation only — it records the
  `linux-x64` coverage measurement.
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

1. **On the next documentation-only push, confirm the skip works**: `scope` should
   report `code=false` and neither gate leg should run. One-shot per opportunity —
   a code change spends it, so do this before item 2 if a docs push is pending.
2. **Slice 2 of the goal**, starting at `worker-acceptance-packet.mjs` — the
   largest unproven surface slice 1 exposed. See
   [release-guard-reachability.md](release-guard-reachability.md) for the full
   list and for why a zero is a question rather than a verdict.
3. Then the two confirmed dead guards in the same slice. **Slice 3 after that is
   decision-first**, not implementation: both items are knowing holes to settle
   with the operator before anything moves.
4. Do not reopen the coverage run's cost as a performance goal. The obvious lever
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
