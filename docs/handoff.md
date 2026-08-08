# Session Handoff

## Workflow Trigger

If this file is mentioned with no other task, start at the first item of
`## Next Session`. `ceal capabilities --fresh` and `ceal call` are live-session,
provider-touching acts: approval first.

## Continuation Capability

The standing goal and its remaining slices live in
[release-guard-reachability.md](release-guard-reachability.md); every gate's
reasoning lives in [gates.md](gates.md). This file holds only what changes the
next action.

## Current State

- Version `0.74.0` (root and `packages/ceal-worker-cli` agree), latest tag
  `ceal-v0.74.0`. `gateway-protocol-handoff-lock.json` is the single record of
  handoff consumption.
- **One commit is unpushed: `a0fbbb3`**, documentation only — it records the
  `linux-x64` coverage measurement. Push it or carry it with the next change.
- `check.yml` is green on both legs (run `31263490521`). It had been red for five
  runs, every one dying on `biome check .`, because `d8fc5fd` regenerated
  `package-lock.json` with `node_modules` present and npm dropped 31 platform
  packages. Fixed in `48c0b27` and gated in `repo-gates.test.mjs`. **The next tag
  would have burned on two of three legs.**
- Both `check.yml` gate legs now skip documentation-only changes. **Unexercised:**
  no docs-only commit has been through it, so pushing this file is the first test
  of the skip — check that `scope` says `code=false` and neither leg runs.
- Gates: `npm run check` about 2m35s, `check:unit` about 49s, timed on this host.
  Four workflows: `check.yml`, `ceal-release.yml`, `ceal-worker-stable-rollback.yml`,
  `npm-package-stage.yml`.

## Next Session

1. **Slice 2 of the goal**, starting at `worker-acceptance-packet.mjs` — the
   largest unproven surface slice 1 exposed. See
   [release-guard-reachability.md](release-guard-reachability.md) for the full
   list and for why a zero is a question rather than a verdict.
2. Then the two confirmed dead guards in the same slice, then slice 3.
3. Do not reopen the coverage run's cost as a performance goal. The obvious lever
   was measured and recovered ~9s of 52; gates.md says why the rest is the
   measurement rather than waste.

## Discuss

- **`main` has no branch protection**, which is why five red CI runs went
  unnoticed — nothing required a check and the pre-push hook runs only
  `check:unit`, which passed on this host. Worth deciding deliberately.
- **[debt.md](debt.md) was carried unconfirmed across sessions.** Re-confirm an
  item before starting it, or delete it.

## References

- [release-guard reachability goal](release-guard-reachability.md) ·
  [gate detail](gates.md) · [release and enrollment](release-and-enrollment.md) ·
  [operator acceptance ceiling](operator-acceptance.md)
- [carried debt](debt.md) · [docs/requests/](requests/), where a divergence
  declaration must point.
- Session history is in `git log`; this file does not keep one.
