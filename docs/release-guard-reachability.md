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

| defect | coverage | `knip` | standing signal |
| --- | --- | --- | --- |
| untested surface | **yes** — reads low | no | `npm run coverage:scripts` (slice 1) |
| production-unreachable | **no** — reads covered | no — counts a test as a caller | `npm run lint:reachability` (slice 4) |

So slice 1 is worth having and is not the audit. The second row had no standing
signal when this was written; slice 4 built one, and proved it by rerunning it
over the tree that held the two guards slice 2 found by hand.

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
`npm run lint:unused`, and it runs inside both gates.
[gates.md](gates.md#knip-and-what-its-zero-means) owns the config reasoning and
what its zero does and does not mean.

It opened with 21 findings and closes at 0. The reading matters more than either
number: `knip` claims a surplus `export` modifier, not unreachable code, and only
**6** of the 21 had no reference inside `src/` at all. The other 15 were live
production code — `CealHpkeError` is thrown from six lines of its own file — so
taking the list as a delete-list would have deleted working code. Seven lost the
modifier, eleven are tagged `@testOnly` against a gate that checks the tag, and
the six below were resolved on their merits.

**The six are triaged.** None reaches the package's `exports` — no candidate
appears in `index.ts` or `profile-store.ts` — so the "may be consumed surface"
escape was closed by reading rather than assumed away. Three outcomes, and the
distribution is the finding: only one of six was dead code.

- **Three are deliberate test-only exports whose reason is written at the
  definition** — `verifyCealDeviceProof` ("so the proof path can be falsified
  rather than only exercised"), `sealCealHpkeMessage` ("the vector suite needs a
  sender"), `classifiedClientSessionFailureReasons` ("for tests that must prove
  both readers agree"). Deleting any of them weakens a proof. They carry
  `@testOnly` now, and `knip.json` reads that tag, so the exception lives at the
  declaration instead of in a config allowlist a reader would have to correlate.
- **One was deleted**: `CEAL_ACCEPTANCE_RECORD_SCHEMA`. It could not be wired in,
  and the reason is the trap this goal keeps meeting. Its four would-be call
  sites write the schema as a literal on purpose, because the gate proving every
  declared result schema is actually emitted scans the source text for
  `schema_version: "..."` (`packages/ceal-worker-cli/test/cli.test.mjs:338`).
  Routing them through the constant would pass `tsc` and turn that gate vacuous.
  A constant no emitter may use is not a constant.
- **Two were wired into the real path**, and each was a live defect rather than
  tidiness:
  - `CEAL_AGENT_HOST_ENVIRONMENT_VARIABLES` exists, by its own comment, for "the
    probe guard pinning them inside a throwaway HOME". `scripts/probe-surface.mjs`
    named two of them by hand instead — the stale hand-kept copy the comment
    warns about, whose failure mode is a probe writing to the operator's real
    agent configuration directory. The guard derives the set now.
  - `LEASED_CONSUMER_CONTROL_SESSION_CONTRACT_SHA256` was the odd one of three
    sibling generated digests: `leased-consumer-carrier.ts` verifies its embedded
    contract against its digest before parsing, and the control session parsed
    its embedded contract without ever reading the digest beside it. The native
    build's `embedded_control_session_contract_drift` check reads the source file
    as *text*, so it said nothing about the pair this module loaded. It verifies
    now, and the guard is falsifiable — deleting the comparison turns
    `test/leased-consumer-control-session.test.mjs` red, confirmed by doing it.

Wiring one of them did **not** clear it from `knip`'s list, and that is the
measurement to keep: `CEAL_AGENT_HOST_ENVIRONMENT_VARIABLES`' new consumer is a
`scripts/` file importing `dist/`, which `knip` does not trace back to `src/`. It
is re-exported from `index.ts` now, so the guard reads it from the module it
already resolves — one dist entry point for one guard — and `knip` stops
reporting it because entry-file exports are never reported. Neither fact makes
`knip` a reachability signal.

**Then a repo-owned production-reachability check for what `knip` cannot see.**
`scripts/` is still where it cannot see, and the reason is worse than the config
gap this section first assumed — there are two mechanisms, and each alone would
have hidden both guards slice 2 deleted:

- the top-level `scripts/*.mjs` are `entry` files, and `knip` reports no export
  in an entry file;
- under `scripts/lib/` it does report one, until a test imports it — and those
  suites import `scripts/` directly, with no build step between the test consumer
  and the production one.

Excluding tests from `entry` to force the question turns every test file into an
"unused file", which trades one blind spot for a page of noise. Undeclaring the
entries would report every `scripts/*.mjs` as an unused file instead.

**The check exists — `npm run lint:reachability`**, in both gates and in
`test/contract/production-reachability.test.mjs`. It walks the production graph
only: entries are the `node scripts/*.mjs` invocations declared in the manifest,
in the lanes, and in the hook; edges are static relative imports; and a release
lane's inline `node --input-type=module` step counts as a caller. Tests are not
in the graph, which is the whole mechanism — a guard only its own suite calls is
the defect being looked for. It reports two things: a module no entry reaches,
and an export no production path reaches that its own module never calls either.
The second condition is what keeps it out of `knip`'s territory; a surplus
`export` modifier is not this check's business.

**It was proven against the tree that held the defect, not against an imitation
of it.** Run today's analyzer over `0cce9f9^`, reconstructed with `git archive`,
and it names `assertWorkerReleaseSourcePath` and
`resolveLockedGatewayHandoffArchive` — the two guards slice 2 found by hand after
coverage and `knip` both read them as fine. That assertion is in the suite, and
it skips loudly rather than passing on a clone without the commit.

Its first run also produced one false positive and one real finding, and both are
worth inheriting:

- `parsePublishedWorkerReleaseInventory` read as unreached because the rollback
  lane calls it from an inline workflow script. A check that is wrong on its first
  run is a check that gets switched off, so workflow steps are in the graph now.
- `verify-gateway-protocol-consumer.mjs` was reached by no entry at all: README
  told operators to run it and the manifest never declared it. It has an npm
  script now, and README points at that.

What it does not cover, stated so a green run is not read as more than it is: only
`scripts/`, only static imports — a dynamic `import()` is deliberately not an edge,
because treating an unresolvable specifier as one would widen the graph until
nothing could be unreachable — and a `@testOnly` export is exempt by declaration.
That exemption is checked rather than trusted: `repo-gates.test.mjs` fails when a
tagged export is reached by no suite.
