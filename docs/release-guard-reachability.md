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
sentence, and it is testable: `worker-release-inputs.test.mjs` does it for the
protocol pin, and the same shape works for the rest. A slice that ends with a
guard still only pinned by a regex has not finished.

## Slice 1 — cover `scripts/` — done

The third `c8` target: `.c8rc.scripts.json`, `npm run coverage:scripts`, and
`scripts/coverage-scripts.mjs`. Measured on both `linux-arm64` and `linux-x64` at
80.59 / 72.60 / 89.75 / 80.59; floors at 80 / 72 / 89 / 80.
[gates.md](gates.md#the-third-target-scripts) owns the reasoning — read it before
touching the floor, the platform list, or the emptiness check.

## Slice 2 — resolve what it exposes

For each: wire it into the real path, or delete it. **Deleting is a legitimate
outcome** and often the right one — the goal is that what remains is true, not
that everything survives.

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

Next by measurement: `build-worker-release-assets.mjs` at 66.44% branch and
`verify-gateway-protocol-consumer.mjs` at 60.24%.

**A zero is a question, not a verdict.** `lint-shell.mjs` at 0% is honest — it is
hook-only. But hook-only does not imply zero: `check-dup-ratchet.mjs` is hook-only
too and reads about 49%, because `repo-gates.test.mjs:730` runs the hook. And
`install-git-hooks.mjs` at 0% *is* exercised, from a throwaway clone whose temp
path remaps to nothing. Read [gates.md](gates.md) before acting on one.

## Slice 3 — the two structural holes the audit surfaced

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

The signed manifest carries no client identity — no digest or package record for
`@corca-ai/ceal`, only a shared `version` string, so nothing downstream can detect
a client substitution that keeps the version number. It is a real hole, and it is a
manifest schema change that needs a release to prove, which makes it its own goal.
Same for the README split and the runtime budgets, which need a sample window
before a threshold is honest.
