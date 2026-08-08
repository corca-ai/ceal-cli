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

Read the counts rather than trusting them here; each line names the command.

- The released version is whatever `package.json` says and the tag that matches
  it — `node -p 'require("./package.json").version'`, `git describe --tags
  --abbrev=0`. `repo-gates` fails a commit whose manifests disagree, so one read
  answers for all three.
- The working tree is clean and `npm run check` is green.
- **Nothing in the unpushed range has been seen by CI**
  (`git log --oneline origin/main..HEAD`), and the baseline is not green either:
  the newest `check.yml` run on `origin/main` was **cancelled**, so the last
  green is the commit before it — `gh run list --workflow=check.yml`.
- **No release lane has run since the lane itself changed.** The arm64
  `test:release` leg and the pre-signing pin assertion are proven by the contract
  tier and by local falsification only; neither has executed on a runner. The
  dispatch dry run now reaches both, and
  [release-and-enrollment.md](release-and-enrollment.md) `## Release` makes it a
  step.

## Next Session

1. **Dry-run the release lane, then decide on a tag.**
   `gh workflow run ceal-release.yml --ref main`, then
   `gh run list --workflow=ceal-release.yml`. This is the first execution of both
   slice 3 changes; a burned tag is never reused, and the dry run is what keeps
   this off one.
2. **Issue 12 is reported but deliberately left open.** Closure routes through
   the cross-repo C11a final batch. Nothing here has been pushed or released, and
   the whole v5 notification path is latent — the shipped
   `leased-consumer-control-session-contract.json` is `.v2` with no
   `notification_channel`, so production takes the v4 branch and none of it runs.

## Discuss

- **The documentation-only CI skip has never fired live** — proven locally and
  gated, but every pushed range so far carried code. Track it or drop it.
- **[debt.md](debt.md) was carried unconfirmed across sessions.** Re-confirm an
  item before starting it, or delete it.

## References

- [release-guard reachability goal](release-guard-reachability.md) ·
  [gate detail](gates.md) · [carried debt](debt.md) ·
  [release and enrollment](release-and-enrollment.md) ·
  [operator acceptance ceiling](operator-acceptance.md)
- [docs/requests/](requests/) — where a divergence declaration must point.
- Session history is in `git log`; this file does not keep one.
