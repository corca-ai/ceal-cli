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
- **Issue 10 is fixed and committed, and the commit is unpushed.** It carries the
  `Closes #10` keyword, so pushing closes the issue. Nothing has been pushed and
  the issue is still open; that approval was never asked for. Verify after any
  push with `issue_tool.py verify-closeout ... --carrier direct-commit
  --commit-ref <ref> --expect-state CLOSED`.
- **That fix is unreleased.** `CHANGELOG.md` carries it under `## Unreleased`,
  which the release step should fold into the version section it cuts. Proof
  level reached is local suite plus repo gate — no installed release, and no live
  `session enroll`/`adopt` against a real Gateway, which both declare
  `remote_write`.
- **`ceal-v0.75.0` is released and read back on this host.** Re-emit the
  acceptance packet with `node scripts/worker-acceptance-packet.mjs --binary
  "$(command -v ceal)"` — through `npm run accept:worker` the guard refuses,
  correctly, because npm puts the workspace symlink on PATH ahead of the install.

## Next Session

1. **Ask about pushing the issue 10 commit, then verify the closeout.** It is the
   only thing between a finished fix and a closed issue.
2. **Issue 6 is the one with someone else's clock on it.** Gateway compatibility
   retirement is blocked on this consumer's cutover, and the ledger lives in
   `corca-ai/ceal`, not here. Read its status there before ranking it below 10.
   A related gap surfaced during issue 12: the vendored protocol is `0.72.12`
   while that issue names a packed `0.72.13` selected-v5 candidate this checkout
   does not have, so its candidate proof could not run.
3. **A structural gate for direct session writers is now carried debt.** Issue 10
   happened because a command wrote the session store without going through a
   transition contract, and nothing structural stops the next one.
   [debt.md](debt.md) says why a regex sweep was rejected as the instrument.
4. **Issue 12 is reported and deliberately left open.** Closure routes through
   the cross-repo C11a final batch. The whole v5 notification path is latent —
   the shipped `leased-consumer-control-session-contract.json` is `.v2` with no
   `notification_channel`, so production takes the v4 branch and none of it runs.

## Discuss

- ~~The documentation-only CI skip has never fired live.~~ **Settled.** It fired
  on run `31286608349`, the first pushed range that carried no code: `scope`
  succeeded and both `check-native` and `check` were skipped. Nothing to track.
- **[debt.md](debt.md) was carried unconfirmed across sessions.** Re-confirm an
  item before starting it, or delete it.

## References

- [release-guard reachability goal](release-guard-reachability.md) ·
  [gate detail](gates.md) · [carried debt](debt.md) ·
  [release and enrollment](release-and-enrollment.md) ·
  [operator acceptance ceiling](operator-acceptance.md)
- [docs/requests/](requests/) — where a divergence declaration must point.
- Session history is in `git log`; this file does not keep one.
