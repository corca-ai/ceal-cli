# Session Handoff

## Workflow Trigger

If this file is mentioned with no other task, start at the first item of
`## Next Session`. `AGENTS.md` `## Boundaries` owns which acts need approval
first — push, tag, GitHub write, Gateway write, release publish, and any live
provider readback. This file does not keep a second, shorter list.

## Continuation Capability

After reading this you should not need to re-derive anything: the standing goal
and its slices live in
[release-guard-reachability.md](release-guard-reachability.md), every gate's
reasoning in [gates.md](gates.md), and how to sweep in
[defect-sweep.md](defect-sweep.md). This file holds only what changes the next
action.

## Current State

Read the counts rather than trusting them here; each line names the command.

- The released version is what `package.json` says and the tag that matches it —
  `node -p 'require("./package.json").version'`, `git describe --tags --abbrev=0`.
- **Everything is pushed and CI is green on it.** `git rev-list --count
  origin/main..HEAD` answers the count; `gh run list --workflow=check.yml` reads
  the run. Seventeen commits went in one push and cost one run, because
  `check.yml` declares `concurrency: cancel-in-progress`.
- **Issue 10 is closed and verified**, by `Closes #10` on `e8f2c44` — re-read it
  with the `issue` skill's `verify-closeout --expect-state CLOSED`, not from
  here.
- **Issue 10's fix is one of many; two sweeps then closed defects it did not cause.**
  `CHANGELOG.md` `## Unreleased` holds all of it; the release step folds that
  section into the version it cuts. Two published acceptance records under
  `docs/acceptance/` overstate guide registration and were left as written —
  [debt.md](debt.md) says so.
- **The sweeps converged on one shape**, now stated once as `AGENTS.md`
  `## One Fact, One Home`. Both 2026-08-09 re-sweeps found only that shape, and
  the enumeration found the enforcement holding at every sibling it could reach.
- **Three shared homes were created and the copies routed through them**:
  `packages/ceal-worker-cli/src/private-worker-transport.ts`,
  `packages/ceal-client/src/request-bounds.ts`, and the acceptance record's
  declared key lists. Each caller still owns its own deadlines, caps, and error
  vocabulary — the first cut of the worker one did not, and renamed shipped
  stderr names until a fresh-eye review caught it.
- **Every duplicate family the ratchet then raised is classified** in
  `charness-artifacts/quality/dup-review.json` with its reasoning. Most are
  artifacts of the extractions themselves — import blocks, one-line idioms — and
  each entry says why re-folding was declined. Read the entry before re-opening
  one.
- **All three gates are green here**, the two maintainer-local ones included:
  `npm run check`, `npm run check:duplication`, `npm run lint:shell`. Time a gate
  yourself rather than trusting a figure — this host is 2-core and its wall clock
  swung by minutes across runs. CI is green on `origin/main` too, but read the
  run rather than trusting this line.
- **Proof level reached is local suite plus repo gate.** No installed release and
  no live `session enroll`/`adopt` against a real Gateway; both are
  `remote_write`. To re-emit acceptance for the installed `ceal-v0.75.0`, call
  `node scripts/worker-acceptance-packet.mjs --binary "$(command -v ceal)"`
  directly — through `npm run accept:worker` the guard refuses, correctly.

## Next Session

1. **Ask about the release tag.** `docs/operator-acceptance.md` `## Before
   Spending A Release Tag` owns what to confirm first, and all of it is free:
   repository variable and secret, push/tag rights, and the vendor pin. A tag is
   not retryable, so spend those reads before spending a version. The tag is the
   only way to reach a proof level above `surface`, because the acceptance packet
   needs a real installed release.
2. **Re-run the structural lens, not another scope re-sweep.**
   [defect-sweep.md](defect-sweep.md) `## The denominator-gap sweep` records why:
   the invariant enumeration cannot see a rule enforced nowhere, and the lens
   built for that blind spot produced two of that run's five survivors on its
   first outing. The scope re-sweeps have now covered their declared gaps.
3. **The remaining debt is the four items that are still open on purpose.**
   [debt.md](debt.md) has them; three carry their own "not before" and the fourth
   is the release-manifest client package, which is release-affecting.

## Discuss

- **The sample now says "misses, not new defects", and still not "converging".**
  Two runs, ten lenses, six survivors — [defect-sweep.md](defect-sweep.md) has
  both tables. Every survivor predates `ceal-v0.75.0` and every one is the same
  shape: a rule enforced at one site and not at its sibling. That is a claim
  about what the stream *is*, not about whether it is shrinking; no scope has yet
  been swept twice at equal depth.
- **Issue 12 stays open** and is not an action here: closure routes through the
  cross-repo C11a final batch. Its v5 notification path is latent — the shipped
  contract declares no `notification_channel` — and [debt.md](debt.md) records
  the shutdown hang that becomes a blocker when it ships.

## References

- [defect sweep and convergence](defect-sweep.md) ·
  [release-guard reachability goal](release-guard-reachability.md) ·
  [gate detail](gates.md) · [carried debt](debt.md) ·
  [release and enrollment](release-and-enrollment.md) ·
  [operator acceptance ceiling](operator-acceptance.md)
- [docs/requests/](requests/) — where a divergence declaration must point.
- Session history is in `git log`; this file does not keep one.
