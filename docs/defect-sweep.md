# Defect Sweep And The Convergence Measurement

Three sweeps ran on 2026-08-09 and each found defects. That says nothing about
whether the stream is converging, and this document exists so the next one can
answer that instead of adding a fourth uncomparable number.

## Why the counts so far cannot be compared

Each pass swept a different area — the release path and workflows; output
contracts, the client and test quality; state, time and concurrency. Three
samples from three populations measure the populations, not a rate. Reading "six,
then six" as flat is reading noise.

Worse, none of the three recorded what it swept and found **clean**. Without that
denominator, "six found" is a rate over an unknown area.

One piece of re-sweep evidence does exist and it points the wrong way:
`charness-artifacts/quality/2026-08-08-quality-review.md` reviewed
`.githooks/pre-push` and `scripts/install-git-hooks.mjs` — including the `--check`
readback — with a delegated fresh-eye reviewer, and the next day's pass found two
more defects in those same two files.

## The measurement

Re-sweep an **already-swept scope, with the same scope statement**, and count.
Two data points from one population give a rate; anything else does not.

The scopes to re-run, verbatim enough to be the same population:

1. Release path — `scripts/`, `.github/workflows/`, the release manifest, the
   installer, the acceptance packet.
2. Reader-facing contracts — emitted documents against their declared
   `result_schema`, `skills/ceal-guide/SKILL.md` against the binary,
   `packages/ceal-client/`, and tests that would pass against a broken product.
3. State, time, concurrency, partial failure — the local stores, the locks, the
   clocks, the retry and cancellation paths.

Each re-sweep must record, in its result:

- what it swept and found clean, by path — the denominator
- for every find, whether the defect predates the previous sweep of that scope
- what it could not reach, and why

A find that predates the previous sweep of the same scope is a **miss**, and
misses are the number that matters. A find introduced since is a new defect, and
those two answer different questions.

## The first re-sweep, 2026-08-09

Run as one workflow: the three scopes above with their scope statements verbatim,
plus the enumeration below, four independent reviewers with distinct lenses and no
shared framing, each finding then put to a skeptic prompted to refute it.

| lens | reported | survived refutation | predates |
| --- | --- | --- | --- |
| release path | 0 | — | — |
| reader-facing contracts | 0 | — | — |
| state, time, concurrency | 1 | 1 | 1 |
| invariant enumeration | 0 of 10 checked | — | — |

**The one find is a miss, not a new defect.** `leased-consumer-carrier.ts`'s
outbound service call had no deadline; `git diff ceal-v0.75.0 HEAD -- <that file>`
was empty, so it predates the baseline and all three sweeps walked past it —
including the one whose own subject was applying a deadline rule to the sibling
site that lacked it. Its fix is in `## Unreleased`.

**Do not read the three zeros as convergence yet.** Two of the four lenses
declared large unreached areas in their own denominators, the release-path lens
most of all, so its zero is over a smaller area than the sweep it is being
compared to. A zero over an unstated area is the same defect as a count over an
unstated area, which is what this document was written to stop. What the run does
establish is one comparable data point on one scope, and a second re-sweep of the
state/time/concurrency scope is the one that would give a rate.

**The enumeration came back clean and that is the result, not a null.** Ten
invariants were identified with the site that enforces each, and every sibling
site checked held it. That is the first evidence that `## One Fact, One Home` is
actually enforced where it has been applied, and it is why the day's one find sat
in the module that had no shared home at all.

## The finite task the sweeps converged on

`AGENTS.md` `## One Fact, One Home` states the law. Its second working rule names
the search: **for each invariant this tree has already learned and enforced at one
site, find the site where it is not enforced.** That is enumerable rather than a
random walk, and it is where the third sweep's most productive findings came
from — an adoption clock rule absent at the refresh edge, a store lock present on
append and absent on remove, a deadline present on one transport and absent on
its sibling.

Start the enumeration from the tree's own record of what it has learned:

```
rg -n "cannot desync|one table|second copy|derive from|hand-copy" \
  packages/ceal-worker-cli/src packages/ceal-client/src scripts test AGENTS.md docs
rg -n "charness-artifacts/debug" --files-with-matches docs
```

There is no `src/` at the repo root; the sources live under `packages/*/src`.

Each hit names a rule. For each, ask which other call site needs it.

## Shape of the run

Run the re-sweep and the enumeration as **one** dynamic-size workflow, not as two
tasks and not as a single agent: the scopes above are independent, and their
reviewers must not see each other's framing — a shared frame is how two reviewers
miss the same thing. Size the fan-out to the scope list plus the enumeration, and
give each reviewer a distinct named lens rather than the same "review this"
packet. Sonnet is the reviewer tier this is sized for; the parent still owes each
finding the verification below, because delegation does not transfer trust.

Two rules bind every reviewer, because the defects found so far include the gates
themselves:

- A finding is a claim. `AGENTS.md` `## Claims And Proof` governs it — an absence
  claim owes a positive control, a normative claim owes a `file:line`.
- **A fix owes a falsified pin.** Revert the fix in a scratch copy and confirm the
  suite goes red before trusting it. Several defects in the 2026-08-09 range were
  tests that existed and could not fail — read the `fix:` commit bodies in
  `git log ceal-v0.75.0..` for which, and how each failed to fail.
