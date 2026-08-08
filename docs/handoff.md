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
  `ceal-v0.74.0`.
- The working tree is clean and `npm run check:unit` is green. Slices 3 and 4 are
  closed; issue 12 is fixed but **not yet reported back or closed**.
- **Thirteen commits are unpushed** and `check.yml` has seen none of them. Nor is
  the baseline green: the newest run on `origin/main` (`31264596590`, `c696fd3`)
  was **cancelled**, so the last green is the commit before it. The range carries
  code, so the next push runs both legs. The operator declined a push on
  2026-08-08 and that decision has not been revisited.
- **No release lane has run since `d08faab`.** The arm64 `test:release` leg and
  the pre-signing pin assertion are proven by the contract tier and by local
  falsification only; neither has executed on a runner.

## Next Session

1. **Report issue 12 back and close it.** The fix is `4729711` plus the abort
   ordering in `f4c0380`. Its acceptance boundary asks for the commands and the
   non-claims, and there are two worth stating rather than eliding: the whole v5
   notification path is **latent** — the shipped
   `leased-consumer-control-session-contract.json` is `.v2` with no
   `notification_channel`, so production takes the v4 branch and none of this
   runs — and a stdout error that lands strictly *after* the owned shutdown's
   abort is deliberately classified as cancellation, because past that point the
   stream was destroyed by that path and a late error cannot be told apart from
   the teardown's own. An error already in flight settles the promise itself and
   stays a failure; that is the case the classification turns on.
2. **`scripts/worker-acceptance-packet.mjs` at 52.64%** — slice 2's remaining
   mass. It is untested, not unreachable: `lint:reachability` reaches it through
   the `accept:worker` entry. Seven functions are uncovered and the mass starts
   at `:191`; read the coverage report rather than a range quoted here.
   Take it in rising cost: `parseArgs` (`:381`) and `render` (`:407`) are pure,
   but neither is exported yet; then `buildAcceptancePacket` (`:191`), which
   needs no live Gateway — it reaches one only through the binary it spawns, and
   the suite already writes an executable stub — and `nonClaims` (`:282`),
   `runBinary` (`:177`) and `scalar` (`:186`) come with it. `which` (`:78`) does
   not. The floor is global in `.c8rc.scripts.json`; raise it once this lands.
3. **Issue 11 — `call` is declared `read_only`.** `index.ts:95` has no remote
   write term in its effect vocabulary, so `index.ts:158-161` gives `call` the
   same effect as `version`, and `scripts/probe-surface.mjs:55` admits anything
   `read_only`. The sanctioned probe path therefore permits `ceal call`, which is
   not what `AGENTS.md` `## Boundaries` says it does. `session logout` is the
   other half: it is `local_write` while it revokes at the Gateway.

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
