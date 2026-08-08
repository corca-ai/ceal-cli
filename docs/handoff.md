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
- **Uncommitted work continues `087cc4a`**, by the same author in this one
  clone, in the two files that commit touched
  (`packages/ceal-worker-cli/{src,test}/leased-consumer-control-session.*`), and
  `malformed, duplicate-key, oversized, and unterminated notification frames
  fail closed` is red. Rebuild before judging it — the suite imports `dist/`.
- **Ten commits are unpushed** and `check.yml` has seen none of them. Nor is the
  baseline green: the newest run on `origin/main` (`31264596590`, `c696fd3`) was
  **cancelled**, so the last green is the commit before it. The range carries
  code, so the next push runs both legs.
- Slice 4 is closed. Both gates now run `npm run lint:unused` (`knip`, at zero)
  and `npm run lint:reachability`; `AGENTS.md` `## Gates` carries the rule and
  [gates.md](gates.md) the limits.

## Next Session

1. **Finish or shelve the uncommitted `087cc4a` continuation first.** Nothing
   below yields a trustworthy gate run until it is, and a push would carry it.
   The two hunks appear to disagree: the added `if (signal?.aborted) return true;`
   returns success on a path the red test requires to fail closed.
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
3. **Slice 3 A is the operator's to settle**, and only then implement. The
   measurement, the four options and their costs are in
   [release-guard-reachability.md](release-guard-reachability.md#a-linux-arm64-is-signed-without-npm-run-check);
   `## Discuss` carries the question, not a second copy of the analysis.
4. **Slice 3 B is now ordinary work, not a decision.** `verifyProtocolProvenance`
   already compares the manifest's protocol producer against the lock and fails
   closed; nothing in the lane calls it, so the catch happens after signing.
   Wire it into `assemble`, which holds the tag's lock and no signing identity —
   not into `sign-and-publish`, which checks out nothing. Section B has the
   detail; rollback is out of the goal, under `## Explicitly not in this goal`.

## Discuss

- **Slice 3 A: is a signed `linux-arm64` binary acceptable with
  `verifyGatewayProtocolConsumer` never run against it?** Recommended answer is
  to add `test:release` to that leg, on a measurement rather than an argument.
  The one serious case against is tag-burn risk.
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
