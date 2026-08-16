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
`scripts/coverage-scripts.ts`. Floors at 80 / 72 / 89 / 80, set from measurements
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

- **`scripts/worker-acceptance-packet.ts` at 52.64% statements and 53.33%
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

## Slice 3 — the two structural holes the audit surfaced — done

Both were decision-first and both are settled. The operator chose to add
`test:release` to the arm64 leg on 2026-08-08; B was already ordinary work by
then. Both landed in `d08faab`, and the analysis below is kept as the reasoning
the change carries, not as an open question.

Proof level reached: `npm run check:unit` green locally, with the workflow's new
shape pinned by `test/contract/worker-release-assets.test.ts` and the merge
assertion falsified by two negative cases (`merge_protocol_provenance_disagreement`,
`merge_protocol_provenance_incomplete`). **Neither has run in a release lane** —
no tag has been cut since, so the arm64 leg's real cost on a `ubuntu-24.04-arm`
runner is still the development-machine measurement quoted below.

### A. `linux-arm64` is signed without `npm run check` — resolved

`ceal-release.yml:65` sets `validate_source: "0"` for that leg alone and `:118`
gates the whole gate on it. The leg still gets `tsc`, the SEA build, the native
smoke and the pin guard through compose. What it does not get is `test:release`,
so **`verifyGatewayProtocolConsumer` never runs against the bytes signed on that
platform** — the only proof that npm's resolver binds the packed Gateway tarball
rather than the workspace symlink npm creates during development. Those two are
indistinguishable from a passing build, which is why the proof exists.

The workflow comment at `:106-116` states the tradeoff and its argument is "the
source is identical on all three legs". That is true and beside the point: this
proof is not about the source, it is about **npm's resolution on that runner**.
The 2026-08-08 lockfile incident is the same axis — npm recorded only the
optional platform packages matching the host it resolved on, and every non-arm64
runner lost its toolchain.

Measured before deciding, on a `linux-arm64` host: `npm run test:release` runs
there and passes — 23 tests, 22 pass, 1 skip, about a minute. The consumer proof is not platform-gated
(only `test/worker-release-installer.test.ts` imports `test/platform-proof.ts`),
so the tier buys the missing proof on arm64 rather than skipping itself.

| option | buys | costs |
| --- | --- | --- |
| leave it | nothing | the signed arm64 binary is permanently unproven on this axis |
| **add `test:release` to that leg** | exactly the missing proof | ~1 min, **and the prewarm step at `:92` must be enabled for the leg too** or the packed-consumer proofs fail as `ENOTCACHED` |
| full `npm run check` on all three | the above | also re-proves lint/unit/contract, which are architecture-independent — the waste the comment already argues against |
| record an explicit non-claim | honesty | the hole stays |

The serious argument for leaving it is not cost, it is that every added step is
one more way a release tag can burn, and **a failed release tag cannot be
reused**. That minute was measured on a development machine, not a
`ubuntu-24.04-arm` runner.

### B. Nothing re-asserts the pin before the artifact is signed — resolved

The pin was asserted inside `withWorkerReleaseInputs*`
(`scripts/worker-release-inputs.ts:67`) while each platform built. Afterwards
nothing asked again: `sign-and-publish`'s inventory verification
(`ceal-release.yml:263-277`) checked digests, the exact file list, and that each
manifest carried the right `version` and `platform` — bytes and shape, never
`protocol.producer`.

**The comparison already existed and failed closed.** The manifest recorded the
protocol producer's `repository`, `commit` and `tree`, and
`verifyProtocolProvenance` (`scripts/worker-acceptance-packet.ts:136`) compared
them against the lock, failing `protocol_provenance_disagreement` at `:162`.
The acceptance-packet fixture carries a real one. So this was wiring, not design. The then-open missing-client-package hole was separate; the
current merge now validates exact client provenance beside the Protocol check.

But the catch then was late rather than absent: the only production caller was
`buildAcceptancePacket` (`:205`), an operator command run against an *installed*
release. The defect would have surfaced after signing and publishing, and **a failed
release tag cannot be reused**.

It went into the `merge` the `assemble` job runs, rather than into a new step
beside it: `mergeWorkerReleaseAssetSets` already holds all three manifests and
already runs three cross-platform manifest checks, so this is a fourth beside
them. The rule itself moved to `scripts/lib/protocol-provenance.ts` so the
installed-release caller and the pre-signing caller cannot answer it
differently. The original reasoning for the job choice follows.

**Wire it into `assemble`, not into `sign-and-publish`.** `assemble` already
checks out the exact tag, so it holds the lock these artifacts were built
against — which is why the "which lock" question does not arise here — and it
already holds all three manifests and runs a repo script. `sign-and-publish`
does neither: it downloads the artifact and never checks out, so putting the
check there means adding source and a Node setup to the one job that carries the
signing identity and the origin credentials. Two notes for whoever does it:
`assemble` runs its merge on the runner's default Node rather than the pinned
`22.22.1` the build legs use, and the check must fail the job rather than warn.

## Explicitly not in this goal

**Re-asserting the pin at rollback.** `ceal-worker-stable-rollback.yml` re-verifies
signatures and moves the pointer without asking about the pin, and that stays out
of this goal deliberately. The correct pin there is the one the rolled-back
release shipped with, not the lock on the branch the lane checks out, so the
guard that fits B would fail a correct rollback. Settle "which lock" before
anyone treats this as B's second half.

The signed manifest's missing client identity was out of this goal because it
required its own manifest-schema change. That later landed in the merge path;
this historical scope boundary is not a current debt entry. The README split and
runtime-budget work likewise moved on under their own owners.

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
  `schema_version: "..."` (`packages/ceal-worker-cli/test/cli.test.ts:338`).
  Routing them through the constant would pass `tsc` and turn that gate vacuous.
  A constant no emitter may use is not a constant.
- **Two were wired into the real path**, and each was a live defect rather than
  tidiness:
  - `CEAL_AGENT_HOST_ENVIRONMENT_VARIABLES` exists, by its own comment, for "the
    probe guard pinning them inside a throwaway HOME". `scripts/probe-surface.ts`
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
`test/contract/production-reachability.test.ts`. It walks the production graph
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
