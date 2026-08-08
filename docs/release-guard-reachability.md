# Goal: Release-Guard Reachability

**Every release-safety guard is reachable, measured, and falsifiable.**

The theme this repository keeps failing at is claiming more than it enforces. The
guide digest guarded a lane the release did not consume. `forbidden_release_inputs`
would have passed on an emptied list. An 80% coverage floor was declared for
months with nothing to measure it against. Requirement 3's chokepoint could be
deleted in one line with every gate staying green. All four are fixed.

The insight that makes this one goal rather than a list of chores: **measuring
`scripts/` turns the reachability audit into a standing signal.** A guard nobody
calls reads as 0% functions on every run, instead of needing the grep audit that
found the holes below.

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

Then the two confirmed dead guards:

- **`assertWorkerReleaseSourcePath`** (`scripts/worker-release-inputs.mjs:220`) has
  no production caller. CONFIRMED with a positive control: the same search finds
  `prepareWorkerReleaseConsumer` and `assertNoSymlinkComponents` at four and seven
  production sites. What still holds the line is `assertInventory`'s overlap check
  (`:252-260`), which constrains the inventory *file* and not the code — so any new
  file-copy site added to the composer takes a path nothing validates. Either call
  it at the `stageOwnedPackage` and guide-read sites, or delete it and stop
  documenting an enforcement that does not exist.
- **`resolveLockedGatewayHandoffArchive`**
  (`scripts/worker-gateway-handoff-archive.mjs:34`) is test-only. Low severity —
  its inner guards are shared with the production `consume*` variants — but the
  tests exercise the unused wrapper, so it can drift from the consumed path with
  nothing noticing.

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
