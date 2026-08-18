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
`.githooks/pre-push` and `scripts/install-git-hooks.ts` — including the `--check`
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

## The denominator-gap sweep, 2026-08-09

The first re-sweep's two weakest lenses declared large unread areas. This run read
exactly those, plus one lens for the structural question the invariant enumeration
cannot reach by construction. Same discipline: distinct lenses, no shared framing,
every finding put to a skeptic prompted to refute it.

| lens | reported | survived refutation | predates |
| --- | --- | --- | --- |
| release build scripts | 1 | 1 | 1 |
| release support scripts | 1 | 0 | — |
| workflow remainder | 1 | 1 | 1 |
| worker CLI tests, read in full | 1 | 0 | — |
| client SDK tests | 1 | 1 | 1 |
| structural, unenforced rules | 2 | 2 | 2 |

**All five survivors predate the baseline, and all five are one shape.** A rule
enforced at one site and not at its sibling: the merge step re-read one of three
private release inputs from the checkout; the pipe rule's sibling construct went
unguarded; three of four client transports hand-copied bounds the fourth declared
once; a live guard had no test while its neighbours did; one store spelled its
schema version five times while both siblings named theirs once. Every fix is in
`## Unreleased`.

**The structural lens is the one to run again.** It was built to see what the
enumeration cannot — a rule enforced nowhere — and it produced two of the five
survivors on its first outing, both in code no earlier pass had questioned. The
enumeration's blind spot is real and this is its instrument.

**Two zeros here are honest and two are earned.** The two refuted findings were
refuted on evidence, not waved off. The lenses that read a whole file said so;
none of the six left an area unstated.

**The fresh-eye review of the fixes found seven more, and three were the fixer's
own.** A projection applied at one emitter and not its sibling; a binding test
that compared a fixture against itself and so could not fail; a commit message
claiming one key set where two still differed. That is the same shape the sweep
was about, produced while fixing it — which is the argument for the review being
mandatory rather than discretionary. Both reviews in this session found a real
defect the gate could not see.

## The two-scope re-sweep, 2026-08-09

The two moves in `## What would end this` were run together rather than chosen
between: both scopes re-swept at the depth their prior pass used, then what they
found taken into gates. Same discipline — distinct lenses, no shared framing,
every finding put to a skeptic prompted to refute.

| lens | pass | reported | survived refutation | predates |
| --- | --- | --- | --- | --- |
| structural, unenforced rules | 2nd | 1 | 1 | 1 |
| state, time, concurrency | 3rd | 1 | 1 | 1 |

**Both survive as misses, and the second one's history was got wrong twice
before it was got right.** `recordDrop` writes the receipt spool's drop counter
outside the lock that `removeUnderLock` and `appendEntry` both take. The lens
reported that as new since the baseline, the parent repeated it, and the commit
shipped saying so. It is false: at `ceal-v0.75.0` `appendEntry` already took
`withLocalStoreLock`, and `removeSpool` and `recordDrop` were both outside it —
`git show ceal-v0.75.0:packages/ceal-worker-cli/src/receipt-spool.ts` shows the
lock at the append. Commit 52d8a45 fixed one of the two unlocked writers and left
the other. So the asymmetry predates the baseline and every sweep walked past it,
like every other survivor in this record.

**The disproof was in the parent's own terminal, on the run it cited as
evidence.** The census reports a `clean` list of the writers it found *under* the
lock, and at the baseline that list is `["writeAppendedSpool"]` — the append,
already locked. The parent read the findings line and not the line above it. The
fresh-eye review caught it by reading the same output. That is the third time in
this range a review found the fixer's own defect, and the first time the fixer
had already been handed the evidence.

**The structural survivor was the safe-ref grammar with no home**, spelled as its
own literal at six sites across the two owned packages, with three more
prefixed budgets nobody had noticed. `packages/ceal-protocol` declares the
grammar and does not re-export it, so no site could have imported it.

**Neither count licenses "converging", and the reason is the same as before:
depth.** Both passes were run by different agents against denominators that are
not the same file set, and the structural population shrank between passes
because the prior pass's fixes removed instances from it. What the run does
establish is a second and third comparable point, and a shift in where the
marginal effort belongs: away from sweep depth over old code, and toward
bounding the blast radius of fixes.

### What went into gates, and what each one is measured to catch

Two detectors now run in both tiers — `npm run lint:store-lock` and
`npm run lint:duplicate-literal`. [gates.md](gates.md) owns their reasoning and
their blind spots. What belongs here is the falsification, because "would have
caught" is a claim:

- Point either analyzer at the release baseline (`git archive ceal-v0.75.0`).
  The census reports the receipt-spool defect a sweep later found by hand **and**
  the writer the fix for it left behind. The literal check reports five groups,
  including the `application/json` pair commit 779768b removed by hand — so it
  was red on a real defect and went green when the fix landed.
- Both were falsified in the other direction too, on the tree and on fixtures.
  Two of those runs found a defect in the gate itself. The exemption table, keyed
  by literal alone, passed a *third* copy of an exempted grammar in silence; it
  pins its site set now. And `@separateGrammar` walked every ancestor, so a tag
  written to justify one literal silenced an unrelated one in the same function —
  the fresh-eye review's find, now bounded to the tagged statement and pinned by
  a test that goes red when the bound comes off. The first version of that test
  put the tag on a *sibling* statement and so could not fail either way, which is
  the same defect one layer up.

**Three patterns from the record are named and not yet gated**, and naming them
is the useful part of an ungated pattern:

- *Fix scoped to the reported instance rather than to the invariant's
  population.* This is the generator, not an instance — the fix for this class
  reproduces it, measured here and recorded again in `## The denominator-gap
  sweep`. `lint:store-lock` catches the one shape of it that is a lock; the
  general form has no detector, and the mandated fresh-eye review is still the
  only control.
- *A test that exists and cannot fail.* Mechanically detectable by mutation, and
  rejected here on cost: a useful run executes the suite once per mutant.
- *One name, two lifecycle stages* — a frame ceiling read against an accumulated
  buffer, a directory that resolved reported as a host that registered. Every
  instance is type-correct at both ends, which is exactly why nothing sees it.

## What would end this, and what would not

Four passes ran on 2026-08-09 — two sweeps and the two fresh-eye reviews the
sweeps' own fixes owed. **All four found something.** The fourth found defects in
the third's fixes, some of them the third fixer's own; the counts are in
`## The denominator-gap sweep` above rather than restated here. All of it was
invisible to `npm run check`, and each fix's falsified pin is that evidence —
read the `fix:` commit bodies in `git log ceal-v0.75.0..`.

So **"sweep until a pass comes back empty" is not a terminating condition** and
should not be treated as one. Planning a release around it means planning around
an event this record gives no reason to expect. **Either** of two things would
change the situation, and neither is another general sweep:

1. **Measure the rate.** Sweep one scope twice at equal depth, with the same
   scope statement, and compare. Every pass so far has read a different area or
   a different depth, so "we keep finding things" is still a statement about
   coverage rather than about the tree. Until that runs, no pass — however
   clean — licenses "converging".
2. **Move the class into a gate.** The class is one sentence: *an invariant
   enforced at one site and not at its sibling.* Every survivor of both sweeps
   was an instance. A check that could see even part of it is worth more than
   another pass, because it keeps working after the session ends and a sweep does
   not. As examples only, not a checklist: sibling call sites of a guarded call,
   two writers of one store, two spellings of one bound. Any instrument that
   mechanically binds two homes counts. Two now exist —
   `## The two-scope re-sweep` records what they are measured to catch — and
   three named patterns still have none.

And a standing consequence for whoever fixes: **the mandated fresh-eye review is
the control, not a formality.** The one measurement here of a fixer working
inside this class says the fixer reproduces it. Both reviews in the 2026-08-09
range found a real defect the gate could not see; one of them found the fixer's
own. Skipping it because the change "is only a refactor" is exactly the case
that produced the defect.

## The finite task the sweeps converged on

`AGENTS.md` `## One Fact, One Home` states the law. Its second working rule names
the search: **for each invariant this tree has already learned and enforced at one
site, find the site where it is not enforced.** That is enumerable rather than a
random walk, and it is where the third sweep's most productive findings came
from — an adoption clock rule absent at the refresh edge, a store lock present on
append and absent on remove, a deadline present on one transport and absent on
its sibling.

Start the enumeration from the tree's own record of what it has learned:

```sh
rg -n "cannot desync|one table|second copy|derive from|hand-copy" \
  packages/ceal-worker-cli/src packages/ceal-client/src scripts test AGENTS.md docs
rg -n "charness-artifacts/debug" --files-with-matches docs
```

There is no `src/` at the repo root; the sources live under `packages/*/src`.

Each hit names a rule. For each, ask which other call site needs it.

## Shape of the run

No skill encodes this; the operator composes the fan-out. What is fixed is the
shape below.

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
