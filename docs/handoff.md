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
- **The v5 shutdown hang is closed, and its recorded fix had been wrong.**
  Bounding `closeReadable` settles the await and leaves the process alive; the
  fix is `openInheritedReadable` adopting the descriptor with `net.Socket`. The
  test's control arm hangs on purpose so the fixed arm cannot pass vacuously, and
  reverting the fix turns it red. It is pinned on the descriptor Gateway actually
  supplies, and the hang reproduces there — an earlier reading that it did not
  came from the harness, not the tree. [debt.md](debt.md) keeps both wrong
  readings, because the second one survived a commit.
- **The Gateway blocker is an order, not a deadlock, and the unrun step is
  theirs.** Their handoff workflow triggers on its own tag and names no worker
  input — `rg -n 'ceal-cli|vendor/|worker'` over
  `.github/workflows/gateway-protocol-handoff-release.yml` in `../ceal` finds
  nothing while `rg -c 'ceal-protocol'` finds two. Their 0.72.13 is committed
  locally and **not pushed to their own origin**:
  `git -C ../ceal show origin/main:packages/ceal-protocol/package.json` still says
  0.72.12. So "waiting on a worker release" is true of their last step and hides
  their first one.
- **All gates are green** — `npm run check`, `npm run check:duplication`,
  `npm run lint:shell`. Time them yourself.

## Next Session

1. **There is no worker-side v5 work left that the Gateway is not holding.** All
   three items funnel through one tag, and each is mechanically enforced rather
   than merely believed — [requests/…-v0-72-13.md](requests/2026-08-09-to-gateway-protocol-handoff-v0-72-13.md)
   `## Three items, one blocker` lists them with the `file:line` that refuses
   each. Do not start any of them; re-check the request's commands instead, and
   ask the operator before anything that writes to that lane.
2. **When the tag lands**, the order is: re-vendor and re-pin in one commit, then
   the `.v3` contract, then the release tag. The contract needs no authoring —
   the generator refuses it today only because the lock is behind, so moving the
   lock is most of it.
3. **Ask the operator for approval before the tag.** Confirm the free
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
