# Session Handoff

## Workflow Trigger

If this file is mentioned with no other task, start at the first item of
`## Next Session`. `AGENTS.md` `## Boundaries` owns which acts need approval
first — push, tag, GitHub write, Gateway write, release publish, and any live
provider readback. This file does not keep a second, shorter list.

## Continuation Capability

After reading this you should not need to re-derive anything: how to sweep and
what would end it live in [defect-sweep.md](defect-sweep.md), every gate's
reasoning in [gates.md](gates.md), the carried debt in [debt.md](debt.md), the
release procedure in [release-and-enrollment.md](release-and-enrollment.md).
This file holds only what changes the next action.

## Current State

Read the facts rather than trusting them here; each line names how.

- **Everything is pushed and CI is green on it** — `git rev-list --count
  origin/main..HEAD`, `gh run list --workflow=check.yml`. Issue 10 is closed —
  `gh issue view 10 -R corca-ai/ceal-cli`. The current version carries no tag:
  compare `git describe --tags --abbrev=0` with
  `node -p 'require("./package.json").version'`.
- **The Gateway lane needs a worker release that carries the v5 contract**, not
  the v4 one on `main` today. Their C11a batch is blocked on it: the installed
  `ceal-v0.75.0` ships protocol 0.72.12, the selected-v5 candidate is 0.72.13,
  and their Agent selection record still reads `ceal-v0.73.0`,
  `recorded_not_activated`. A plain release of `main` would not unblock them.
- **Two debt items stop being deferred the moment that release is the target**,
  and [debt.md](debt.md) now says so at both: the vendored protocol must move to
  0.72.13 (the v5 gate in `leased-consumer-control-session.ts` requires
  `decodeCealLeasedConsumerCapabilityNotification`, which 0.72.12 does not
  export), and the v5 notification shutdown hang becomes live rather than latent.
- **All three gates are green — and green says nothing about the class of defect
  that keeps appearing.** `npm run check`, `npm run check:duplication`,
  `npm run lint:shell`, the two maintainer-local ones included; time them
  yourself. Every find in the 2026-08-09 range was invisible to all three, and
  [defect-sweep.md](defect-sweep.md) `## What would end this` owns why.

## Next Session

1. **Do one of the two moves in [defect-sweep.md](defect-sweep.md)
   `## What would end this` — not a fourth general sweep.** That section says
   plainly that an empty pass is not the goal and not an event to plan around,
   and `## Shape of the run` owns how to run whichever move you pick. The
   structural lens has run once (`## The denominator-gap sweep` is the only table
   listing it); `## The first re-sweep` nominates a different scope for the rate
   question. Item 1 is a choice between them, not both.
2. **Then scope the v5 release, whatever item 1 found.** The tag is not waiting
   on a clean pass. Re-vendor the protocol and re-pin in one commit, bump the
   control-session contract to `.v3`, and close the shutdown hang ahead of the
   tag — [debt.md](debt.md) has all three with their `file:line`.
3. **Ask the operator for approval before the tag; it is theirs to authorize,
   not yours to infer from green checks.** Confirm the free preconditions first —
   [operator-acceptance.md](operator-acceptance.md) `## Before Spending A Release
   Tag` lists them and all are reads. A tag is not retryable.

*Standing, applies to anything item 1 or 2 fixes:* a fix owes a fresh-eye review
and a falsified pin, both in [defect-sweep.md](defect-sweep.md)
`## Shape of the run`. The review is the control, not a formality — it does not
gate item 2.

## Discuss

- **The sample says "misses, not new defects", and still not "converging".**
  [defect-sweep.md](defect-sweep.md) holds the two tables; every survivor
  predates the tag and every one is the same shape. No scope has been swept twice
  at equal depth, so nothing supports a claim about the rate.
- **The debt in [debt.md](debt.md) is open on purpose**; read the count and the
  "not before" notes there rather than here. Issue 12's closure routes through
  the same cross-repo C11a batch item 2 serves — `gh issue view 12 -R
  corca-ai/ceal-cli`.

## References

- [defect sweep, convergence, and what would end it](defect-sweep.md) ·
  [gate detail](gates.md) · [carried debt](debt.md) ·
  [release and enrollment](release-and-enrollment.md) ·
  [operator acceptance ceiling](operator-acceptance.md) ·
  [release-guard reachability goal](release-guard-reachability.md)
- [docs/requests/](requests/) — where a divergence declaration must point.
- Session history is in `git log`; this file does not keep one.
