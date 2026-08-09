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

## Next Session

1. **Watch the release tag, then read back an installed binary.** The procedure
   is [release-and-enrollment.md](release-and-enrollment.md) `## Release`, and it
   does not end at the tag: `ceal update` then a readback is what turns a passing
   lane into installed-release proof. Everything before that is source proof, and
   naming it as more would be the overclaim `AGENTS.md` `## Claims And Proof`
   forbids.
2. **Issue 12 is reported and deliberately left open.** Closure routes through
   the cross-repo C11a final batch. The whole v5 notification path is latent —
   the shipped `leased-consumer-control-session-contract.json` is `.v2` with no
   `notification_channel`, so production takes the v4 branch and none of it runs.
   Nothing in this release changes shipped v4 behaviour except the `effect`
   vocabulary.

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
