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
   the `accept:worker` entry. **The uncovered mass starts at `:191`, not `:407`
   as this file previously said**, and seven functions are uncovered, not four.
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
4. **Slice 3 B is undecided, not blocked.** The manifest does record the
   protocol producer and `verifyProtocolProvenance` already compares it against
   the lock and fails closed; what is open is which lock a rollback compares
   against. Same doc, section B.
5. Do not reopen the coverage run's cost as a performance goal — gates.md says why.

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
