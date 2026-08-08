# Goal: Release-Guard Reachability

**Every release-safety guard is reachable, measured, and falsifiable.**

The theme this repository keeps failing at is claiming more than it enforces. The
guide digest guarded a lane the release did not consume. `forbidden_release_inputs`
would have passed on an emptied list. An 80% coverage floor was declared for
months with nothing to measure it against. Requirement 3's chokepoint could be
deleted in one line with every gate staying green. All four are fixed.

The goal was written believing that measuring `scripts/` would turn the
reachability audit into a standing signal — that a guard nobody calls would read
as 0% functions. **Slice 2 disproved that on the very guards it was written
about.** Both were exhaustively tested, so both sat inside files reading 91-94%
function coverage while never being called from production.

Two different defects, and coverage sees only one:

| defect | coverage | how it was actually found |
| --- | --- | --- |
| untested surface | **yes** — reads low | `worker-acceptance-packet.mjs` at 52.64% |
| production-unreachable | **no** — reads covered | grep with a positive control |

So slice 1 is worth having and is not the audit. The second column still has no
standing signal; see the open question at the end.

## Acceptance

**Deleting any guard call must turn something red.** That is the whole goal in one
sentence, and it is testable *in a test* — `worker-release-inputs.test.mjs` does it
for the protocol pin by reaching the guard, not by deleting one for real, and the
same shape works for the rest. A slice that ends with a
guard still only pinned by a regex has not finished.

## Slice 1 — cover `scripts/` — done

The third `c8` target: `.c8rc.scripts.json`, `npm run coverage:scripts`, and
`scripts/coverage-scripts.mjs`. Floors at 80 / 72 / 89 / 80, set from measurements
on `linux-arm64` and `linux-x64` that differ on branches — gates.md carries both
numbers and why the difference is load-bearing.
[gates.md](gates.md#the-third-target-scripts) owns the reasoning — read it before
touching the floor, the platform list, or the emptiness check.

## Slice 2 — resolve what it exposes

For each: wire it into the real path, or delete it. **Deleting is a legitimate
outcome** — the goal is that what remains is true, not that everything survives.
It is not the default: establish whether a surface is untested or unreachable
before choosing, for every item below and not only the first.

Start here, because slice 1 named it and nothing on this list explains it:

- **`scripts/worker-acceptance-packet.mjs` at 52.64% statements and 53.33%
  functions** — half the file, including everything from `:407` to the end. The
  largest unproven surface in the release lane. Find out whether that is untested
  code or unreachable code before deciding which fix it needs.

**The two dead guards are deleted.** Both were introduced on 2026-07-23 and had
**zero production callers at every commit in their history** — neither regressed,
neither was ever wired. Recorded here because the reasoning generalises:

- **`assertWorkerReleaseSourcePath`** admitted a candidate release path if it was
  under one of the three declared source paths and not under a forbidden one. The
  proposed fix was to call it at the composer's copy sites — but every one of
  those takes its path *from the inventory* (`inputs.client.source_path` and
  friends), so the check would have compared a value against itself and could
  never fail. Wiring it would have manufactured exactly the vacuous guard this
  goal exists to remove. What survives is `assertInventory`'s overlap rule, which
  constrains the inventory file rather than any copy, and now has its own test.
- **`resolveLockedGatewayHandoffArchive`** was not a distinct capability: both
  `consume*` variants return the same `{ resolution, lock }` when given no
  `consume` dependency. Its twelve tests exercised the unused wrapper while the
  consumed path went unproven; they call the sync variant now.

Next by measurement, both branch coverage: `build-worker-release-assets.mjs` at
66.44% and `verify-gateway-protocol-consumer.mjs` at 60.24%. (gates.md quotes the
latter's *statements* figure for a different purpose; do not read them as one.)

**A zero is a question, not a verdict.** Two of the three on this report are not
findings at all, and one of them is exercised despite reading 0%. gates.md names
which and why; read it before acting on a zero.

## Slice 3 — the two structural holes the audit surfaced

**Decision-first.** Both are knowing holes with a stated tradeoff, so they are the
operator's to settle before anything moves. Do not implement either unilaterally.

- **`linux-arm64` is signed without `npm run check`.** `ceal-release.yml:118` gates
  the gate on `validate_source == '1'`. That leg gets `tsc`, the SEA build, the
  native smoke and the pin guard through compose — but not `test:release`, so
  `verifyGatewayProtocolConsumer`, the only proof that npm's resolver binds the
  Gateway tarball rather than a workspace link, never runs against the bytes being
  signed on that platform. The workflow comment at `:112-116` states the tradeoff,
  so this is a knowing hole. Decide it deliberately rather than inheriting it.
- **Nothing re-asserts the pin between the build artifact and the stable pointer.**
  Neither the sign/publish job nor `ceal-worker-stable-rollback.yml` invokes the
  guard. If compose's call is ever bypassed, no later stage asks again.

## Explicitly not in this goal

The signed manifest's missing client identity, described in [debt.md](debt.md), is
a real hole and is out of this goal: it is a manifest schema change that needs a
release to prove, which makes it its own goal. Same for the README split and the
runtime budgets, which need a sample window before a threshold is honest.

## Slice 4 — the standing signal coverage cannot give

Coverage finds unexercised code; it cannot find code no production path reaches,
per the table at the top. Slice 2 found both of its guards by hand. Two moves,
decided, in this order:

**Adopt `knip` — done.** Installed at `6.32.0` with `knip.json` and
`npm run lint:unused`. The two one-line blockers were one line each as predicted;
[gates.md](gates.md#knip-and-why-it-is-not-in-either-gate-yet) owns the config
reasoning and why it is in neither gate yet.

What it gives, from a clean run: zero unused files, zero unused dependencies, and
**15 unused exports plus 6 unused exported types, every one of them in
`packages/ceal-worker-cli/src/`**. Not one is a false positive. Every one is
defined in `src/`, referenced only from `test/`, and reached by no production
path — which is nearer the reachability question than the third blocker predicted.
In the TypeScript packages the `dist`/`src` split turns out to *help*: because
suites import `dist/`, `knip` does not count a test as a consumer of `src/`, so
the exact shape slice 2 deleted by hand shows up on this list instead of reading
as used. Read that as scoped, not as the blind spot closing — it holds only where
the compile step separates what tests import from what production imports.

It is a list of questions, not verdicts, and triaging it is the next move: this
package also ships `exports`, so a symbol with no in-repo production caller may
still be consumed surface rather than dead code. Resolve each the way slice 2
resolved its two — wire it into the real path, or delete it.

**Then a repo-owned production-reachability check for what `knip` cannot see.**
`scripts/` is where it cannot see, and that is not a config gap: those suites
import `scripts/*.mjs` directly, so `knip` counts a test as a consumer and both
guards slice 2 deleted would have read as *used*. The configured run confirms it —
it reports nothing at all under `scripts/`. Excluding tests from `entry` to force
the question turns every test file into an "unused file", which trades one blind
spot for a page of noise.

The check we actually want is narrow — an export under `scripts/` that no
production entry point reaches, walking static imports from the npm-script
entries. It has no `dist`/`src` problem, and it can fail closed like the rest of
the gates here. Size it against what `knip` already covers before building it, so
it stays the narrow thing rather than a second general tool.
