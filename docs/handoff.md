# Session Handoff

## Workflow Trigger

If this file is mentioned with no other task, start at the first item of
`## Next Session

1. **Make the gate stop paying for work it throws away.** Measured on 2026-08-09
   and scheduled here rather than carried in [debt.md](debt.md), which owns the
   detail and the corrected reason it was declined before. Two moves, in order:
   route `precoverage`/`pretest` through the `dist` freshness owner the repo
   already has (`ensurePackageBuilt` in `test/repo-build.mjs`) so a gate run
   compiles each package once, then pass `--incremental` with a gitignored build
   info file through `npm --prefix <pkg> run build --` so an unchanged tree stops
   recompiling. Neither needs the frozen package edited.
   It touches `prepack`, so it is release-affecting — which is why it goes now,
   ahead of a release, rather than after one. The proof is a `dist` digest that
   does not change and a re-measured iteration tier;
   `charness-artifacts/quality/2026-08-09-quality-review.md` holds the before
   figures and the commands that produced them.
2. **Declare a runtime budget** for the two tiers in `.agents/quality-adapter.yaml`
   while the numbers are fresh. `render_runtime_summary.py` reports
   `runtime_visibility_missing_budgets` today, and the absence is not academic: a
   contended reading of the iteration tier went unchallenged in this session's own
   notes until it was re-measured. Set it from the measurement, not from a target.
3. **There is no worker-side v5 work left that the Gateway is not holding.** All
   three items funnel through one tag, and each is mechanically enforced rather
   than merely believed — [requests/…-v0-72-13.md](requests/2026-08-09-to-gateway-protocol-handoff-v0-72-13.md)
   `## Three items, one blocker` lists them with the `file:line` that refuses
   each. Do not start any of them; re-check the request's commands instead, and
   ask the operator before anything that writes to that lane. The operator is
   delivering that request by hand.
4. **When the tag lands**, the order is: re-vendor and re-pin in one commit, then
   the `.v3` contract, then the release tag. The contract needs no authoring —
   the generator refuses it today only because the lock is behind.
5. **Ask the operator for approval before the tag.** Confirm the free
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
