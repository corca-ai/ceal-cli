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
- The working tree is clean, `npm run check` is green, and `origin/main` is green
  on CI — `gh run list --workflow=check.yml`. That baseline had been broken for a
  while and is not to be assumed; read it.
- **Both slice 3 changes have executed on real runners without spending a tag.**
  A dispatch dry run of `ceal-release.yml` reached all three build legs and
  `assemble`, with `sign-and-publish` skipped. On the `linux-arm64` leg the gate
  is skipped as designed and `Prove the packed Gateway consumer on the ungated
  leg` ran. `gh run list --workflow=ceal-release.yml` has it.

- **`ceal-v0.75.0` is released and read back on this host.** `ceal update` took
  it from 0.73.0, the installed artifact digest matches the published
  `SHA256SUMS`, and the acceptance packet reports digests agreeing across bytes,
  manifest and `SHA256SUMS` with the protocol producer agreeing with the lock.
  A live discovery reached `instance:ceal-prod` and was accepted. Re-emit with
  `node scripts/worker-acceptance-packet.mjs --binary "$(command -v ceal)"` —
  through `npm run accept:worker` the guard refuses, correctly, because npm puts
  the workspace symlink on PATH ahead of the install.
- **Proof level reached: installed release plus live host decision.** Provider
  execution is not claimed: no bounded capability call was requested, and `call`
  is now `remote_write`.

## Next Session

1. **Issue 10 is the direct successor to what just shipped.** This release made
   `session enroll`/`adopt`/`logout` declare `remote_write` because they consume
   a one-time Gateway approval or revoke a live session. Issue 10 says those same
   routes still overwrite a live session with no refusal, no `--force`, no
   Gateway revoke and no spool cleanup — so the declaration is now truthful and
   the behaviour still is not.
2. **Issue 6 is the one with someone else's clock on it.** Gateway compatibility
   retirement is blocked on this consumer's cutover, and the ledger lives in
   `corca-ai/ceal`, not here. Read its status there before ranking it below 10.
   A related gap surfaced during issue 12: the vendored protocol is `0.72.12`
   while that issue names a packed `0.72.13` selected-v5 candidate this checkout
   does not have, so its candidate proof could not run.
3. **Issue 12 is reported and deliberately left open.** Closure routes through
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
