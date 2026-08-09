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
- `npm run check` is green on this host and `origin/main` was green on CI before
  the commit below — `gh run list --workflow=check.yml`. That baseline had been
  broken for a while and is not to be assumed; read it.
- **Nothing is pushed.** The commits below are local only, and the first carries
  `Closes #10`, so pushing closes that issue. Approval for the push was asked for
  and declined once. Verify after any push with `issue_tool.py verify-closeout
  ... --carrier direct-commit --commit-ref <ref> --expect-state CLOSED`.
- **Issue 10 is fixed**, and a scouting pass then closed six release-path defects
  it did not cause — an installer literal that would have locked existing clients
  out of the next protocol bump, an acceptance document answering no `ok`, a
  frame-ceiling measured on the wrong buffer, and three gates or steps that
  passed without proving what they named. `CHANGELOG.md` `## Unreleased` has all
  of it, and the release step should fold that section into the version it cuts.
- **All three gates are green on this host**, including the two maintainer-local
  ones: `npm run check`, `npm run check:duplication`, `npm run lint:shell`. The
  ratchet had been failing before this session and its stale control-loop entry
  is rotated and corrected. Time a gate yourself rather than trusting a figure:
  this host is 2-core and its wall clock swung by minutes across runs today.
  `origin/main` was green on CI before these commits —
  `gh run list --workflow=check.yml`; that baseline is not to be assumed.
- **Proof level reached is local suite plus repo gate.** No installed release,
  and no live `session enroll`/`adopt` against a real Gateway; both declare
  `remote_write`.
- **`ceal-v0.75.0` is released and read back on this host.** Re-emit the
  acceptance packet with `node scripts/worker-acceptance-packet.mjs --binary
  "$(command -v ceal)"` — through `npm run accept:worker` the guard refuses,
  correctly, because npm puts the workspace symlink on PATH ahead of the install.

## Next Session

1. **Ask about pushing the issue 10 commit, then verify the closeout.** It is the
   only thing between a finished fix and a closed issue.
2. **A structural gate for direct session writers is now carried debt.** Issue 10
   happened because a command wrote the session store without going through a
   transition contract, and nothing structural stops the next one.
   [debt.md](debt.md) says why a regex sweep was rejected as the instrument.
3. **Issue 12 is reported and deliberately left open.** Closure routes through
   the cross-repo C11a final batch. The whole v5 notification path is latent —
   the shipped `leased-consumer-control-session-contract.json` is `.v2` with no
   `notification_channel`, so production takes the v4 branch and none of it runs.

## Discuss

- Nothing open. Three items settled this session and were removed rather than
  struck through: the documentation-only CI skip fired live, issue 6 closed, and
  [debt.md](debt.md) is re-confirmed against the tree. `git log` holds the detail.

## References

- [release-guard reachability goal](release-guard-reachability.md) ·
  [gate detail](gates.md) · [carried debt](debt.md) ·
  [release and enrollment](release-and-enrollment.md) ·
  [operator acceptance ceiling](operator-acceptance.md)
- [docs/requests/](requests/) — where a divergence declaration must point.
- Session history is in `git log`; this file does not keep one.
