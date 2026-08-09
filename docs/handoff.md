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

- **Two commits are unpushed and CI has not seen them** — `git rev-list --count
  origin/main..HEAD`, `gh run list --workflow=check.yml`. The current version
  carries no tag: compare `git describe --tags --abbrev=0` with
  `node -p 'require("./package.json").version'`.
- **The defect class now has two gates, and they are the session's product.**
  `npm run lint:store-lock` and `npm run lint:duplicate-literal` run in both
  tiers. Both were falsified against `ceal-v0.75.0` before being armed, and
  [gates.md](gates.md) owns what each can and cannot see.
  [defect-sweep.md](defect-sweep.md) `## The two-scope re-sweep` owns the run that
  produced them, including two claims this session got wrong and had to correct.
- **The v5 release is blocked on the Gateway, not on this repository.** The
  highest signed protocol handoff is `gateway-protocol-handoff-v0.72.12` —
  `git -C ../ceal ls-remote --tags origin 'gateway-protocol-handoff-*'` — while
  the v5 gate needs 0.72.13. Re-vendoring without a matching lock fails
  `proof_shipment_protocol_divergence`, which is fatal. The tracked request is
  [requests/2026-08-09-to-gateway-protocol-handoff-v0-72-13.md](requests/2026-08-09-to-gateway-protocol-handoff-v0-72-13.md).
- **The v5 shutdown hang is reproduced and its recorded fix was wrong.** Bounding
  `closeReadable` settles the await and the process still never exits; the
  measured fix is `net.Socket({ fd })` rather than `fs.createReadStream({ fd })`.
  [debt.md](debt.md) carries the reproduction, the two controls, and why it is
  its own slice.
- **All gates are green** — `npm run check`, `npm run check:duplication`,
  `npm run lint:shell`. Time them yourself.

## Next Session

1. **Close the v5 shutdown hang**, in its own slice, using the measured fix in
   [debt.md](debt.md) rather than the one the entry used to name. It is a
   transport change: `net.Socket` is a duplex with different EOF and error
   behaviour, and the FD-kind predicate in the suite is written against
   `fs.ReadStream`. The reproduction in that entry is what the fix owes a red run
   against first.
2. **Ask the operator before doing anything with the protocol pin.** Item 1 above
   does not need it. The re-vendor does, and it cannot be done here until the
   Gateway publishes the handoff — check the request's re-checks before assuming
   either way.
3. **Then scope the rest of the v5 release**: the control-session contract bump
   to `.v3`, and the release tag itself.
4. **Ask the operator for approval before the tag.** Confirm the free
   preconditions first — [operator-acceptance.md](operator-acceptance.md)
   `## Before Spending A Release Tag` lists them and all are reads. A tag is not
   retryable.

*Standing, applies to anything above:* a fix owes a fresh-eye review and a
falsified pin, both in [defect-sweep.md](defect-sweep.md) `## Shape of the run`.
This session is the strongest evidence yet that the review is the control and not
a formality — it caught a false historical claim the fixer had shipped in a
commit message and a doc, with the disproof already printed in the fixer's own
terminal.

## Discuss

- **The sample still says "misses, not new defects", and still not
  "converging".** [defect-sweep.md](defect-sweep.md) now holds three tables.
  Every survivor across all of them predates the tag, including the two this
  session found — one of which was reported as new and corrected. Two scopes have
  now been swept more than once, and depth is still the confound: the denominators
  are not the same file sets, so nothing yet supports a claim about the rate.
- **Three named patterns still have no gate**, and
  [defect-sweep.md](defect-sweep.md) `## The two-scope re-sweep` says which and
  why each was left. The one with a recorded generator is *fix scoped to the
  reported instance rather than the invariant's population*.
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
