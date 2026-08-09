# Session Handoff

## Workflow Trigger

If this file is mentioned with no other task, start at the first item of
`## Next Session`. `AGENTS.md` `## Boundaries` owns which acts need approval
first — push, tag, GitHub write, Gateway write, release publish, and any live
provider readback. This file does not keep a second, shorter list.

## Continuation Capability

After reading this you should not need to re-derive anything: the standing goal
and its slices live in
[release-guard-reachability.md](release-guard-reachability.md), every gate's
reasoning in [gates.md](gates.md), and how to sweep in
[defect-sweep.md](defect-sweep.md). This file holds only what changes the next
action.

## Current State

Read the counts rather than trusting them here; each line names the command.

- The released version is what `package.json` says and the tag that matches it —
  `node -p 'require("./package.json").version'`, `git describe --tags --abbrev=0`.
- **Nothing is pushed.** Every commit since `ceal-v0.75.0` is local, and one
  carries `Closes #10`, so pushing closes that issue. The push has been offered
  and declined twice.
- **Issue 10 is fixed, and three sweeps then closed defects it did not cause.**
  `CHANGELOG.md` `## Unreleased` holds all of it; the release step folds that
  section into the version it cuts. Two published acceptance records under
  `docs/acceptance/` overstate guide registration and were left as written —
  [debt.md](debt.md) says so.
- **The sweeps converged on one shape**, now stated once as `AGENTS.md`
  `## One Fact, One Home`. The 2026-08-09 re-sweep applied its second working
  rule and found the enforcement holding at every sibling it enumerated; the one
  defect it did find was in the module that had no shared home at all.
- **The two private worker modes now share `private-worker-transport.ts`.** Each
  still owns its deadlines, caps, and error vocabulary. Six duplicate families
  the ratchet then raised are classified in
  `charness-artifacts/quality/dup-review.json` with their reasoning; four are
  artifacts of the extraction itself, and re-folding them was declined for
  reasons each entry states.
- **All three gates are green here**, the two maintainer-local ones included:
  `npm run check`, `npm run check:duplication`, `npm run lint:shell`. Time a gate
  yourself rather than trusting a figure — this host is 2-core and its wall clock
  swung by minutes across runs. `origin/main` was green on CI before these
  commits — `gh run list --workflow=check.yml`; do not assume it.
- **Proof level reached is local suite plus repo gate.** No installed release and
  no live `session enroll`/`adopt` against a real Gateway; both are
  `remote_write`. To re-emit acceptance for the installed `ceal-v0.75.0`, call
  `node scripts/worker-acceptance-packet.mjs --binary "$(command -v ceal)"`
  directly — through `npm run accept:worker` the guard refuses, correctly.

## Next Session

1. **Ask about pushing.** Declined twice now, so nothing depends on it. If
   approved, push and then verify with the `issue` skill's `issue_tool.py
   verify-closeout --carrier direct-commit --commit-ref <ref> --expect-state
   CLOSED`.
2. **Re-sweep the state/time/concurrency scope, and only that one.**
   [defect-sweep.md](defect-sweep.md) `## The first re-sweep` records why: it is
   the one scope with a find, so a second pass over it is the one that yields a
   rate rather than another zero over an unstated area. Same scope statement,
   same denominator discipline.
3. **Close the release-path lens's denominator gap before comparing its zero to
   anything.** That lens left most of `scripts/` unread and said so; the zero is
   real over what it covered and says nothing about what it did not.

## Discuss

- **The sample still cannot support "converging" or "diverging".** One re-sweep
  has now run and produced one comparable data point on one scope, with a miss
  rather than a new defect — [defect-sweep.md](defect-sweep.md) has the table and
  the caveat on the two lenses that left area unread. Two of the four zeros are
  partly reduced coverage, not evidence.
- **Issue 12 stays open** and is not an action here: closure routes through the
  cross-repo C11a final batch. Its v5 notification path is latent — the shipped
  contract declares no `notification_channel` — and [debt.md](debt.md) records
  the shutdown hang that becomes a blocker when it ships.

## References

- [defect sweep and convergence](defect-sweep.md) ·
  [release-guard reachability goal](release-guard-reachability.md) ·
  [gate detail](gates.md) · [carried debt](debt.md) ·
  [release and enrollment](release-and-enrollment.md) ·
  [operator acceptance ceiling](operator-acceptance.md)
- [docs/requests/](requests/) — where a divergence declaration must point.
- Session history is in `git log`; this file does not keep one.
