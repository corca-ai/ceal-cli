# Session Handoff

## Workflow Trigger

If this file is mentioned with no other task, read `## Next Session — release-guard reachability

**The goal: every release-safety guard is reachable, measured, and falsifiable.**

The theme this repository keeps failing at is claiming more than it enforces. The
guide digest guarded a lane the release did not consume. `forbidden_release_inputs`
would have passed on an emptied list. An 80% coverage floor was declared for
months with nothing to measure it against. Requirement 3's chokepoint could be
deleted in one line with every gate staying green. The first three are fixed and
the fourth was fixed on the way to writing this — see `## 2026-08-08` above.

What remains lives in `scripts/`: **about 4.9k lines of release-lane production
code** (`wc -l scripts/*.mjs scripts/lib/*.mjs`) that had no coverage at all until
slice 1 measured it.

The insight that makes this one goal rather than three chores: **measuring
`scripts/` turns the reachability audit into a standing signal.** A guard nobody
calls shows up as 0% functions, every run, instead of needing the grep audit that
found the holes below. Slice 1 produces the evidence slice 2 acts on.

### Slice 1 — cover `scripts/` — **done, see `## 2026-08-08 — scripts/ is measured`**

### Slice 2 — resolve what it exposes

Start from the known ones. For each: wire it into the real path, or delete it.
**Deleting is a legitimate outcome** and often the right one — the goal is that
what remains is true, not that everything survives.

- **`assertWorkerReleaseSourcePath`** (`scripts/worker-release-inputs.mjs:220`) has
  no production caller. CONFIRMED with a positive control: the same search finds
  `prepareWorkerReleaseConsumer` and `assertNoSymlinkComponents` at four and seven
  production sites. What still holds the line is `assertInventory`'s overlap check
  (`:252-260`), which constrains the inventory *file* and not the code — so any new
  file-copy site added to the composer takes a path nothing validates. Either call
  it at the `stageOwnedPackage` and guide-read sites, or delete it and stop
  documenting an enforcement that does not exist.
- **`resolveLockedGatewayHandoffArchive`** (`scripts/worker-gateway-handoff-archive.mjs:34`)
  is test-only. Low severity — its inner guards are shared with the production
  `consume*` variants — but the tests exercise the unused wrapper, so it can drift
  from the consumed path with nothing noticing.

Slice 1 adds a third name to that list, and it is the one with the most room:
**`worker-acceptance-packet.mjs` at 52.64% statements and 53.33% functions** —
half the file, including everything from `:407` to the end. That is the largest
unproven surface in the release lane and nothing on this list explains it yet.
`build-worker-release-assets.mjs` at 66.44% branch and
`verify-gateway-protocol-consumer.mjs` at 60.24% are the next two.

Two zeros are also on the report and neither is a finding. `lint-shell.mjs` is
hook-only and `npm run check` is right not to reach it — though hook-only does not
imply zero, since `check-dup-ratchet.mjs` is hook-only too and reads about 49%,
because `repo-gates.test.mjs:730` runs the hook. `install-git-hooks.mjs` *is*
exercised, from a throwaway clone whose temp path remaps to nothing. Read
[gates.md](gates.md) before treating a zero as a verdict.

### Slice 3 — the two structural holes the audit surfaced

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

### Acceptance

**Deleting any guard call must turn something red.** That is the whole goal in one
sentence, and it is now testable: `worker-release-inputs.test.mjs` does it for the
protocol pin, and the same shape works for the rest. A slice that ends with a
guard still only pinned by a regex has not finished.

### Explicitly not in this goal

The signed manifest carries no client identity — no digest or package record for
`@corca-ai/ceal`, only a shared `version` string, so nothing downstream can detect
a client substitution that keeps the version number. It is a real hole and it is a
manifest schema change that needs a release to prove, which makes it its own goal.
Same for the README split and the runtime budgets, which need a sample window
before a threshold is honest.

## Current State`, then pick
from `## Debt` or do what the operator asked for. `ceal capabilities --fresh` and
`ceal call` are live-session, provider-touching acts: approval first.

## 2026-08-08 — CI had been red for five runs, and no gate could see it

Found by reading `gh run list` after the first push of the coverage work. Not
caused by it: `check.yml` had failed five consecutive runs, each in about 30s,
every one dying on `biome check .` — the *first* command of `npm run check`.

`d8fc5fd` ("delete the legacy cealctl lane") regenerated `package-lock.json` on
this arm64 Linux host with `node_modules` present. npm records only the optional
platform packages matching the tree it can see, so **6 of 8 `@biomejs/cli-*` and
25 of 26 `@esbuild/*` entries left the lock**, with no error and no diff a reader
would read as a break. `npm ci` on any other runner then installs no binary.

The severity is the release lane, not the check lane. `ceal-release.yml:119` runs
the same gate on `linux-amd64` and `darwin-arm64`, and esbuild is what builds the
SEA — so **the next tag would have burned on two of three legs**, which is the one
failure this repository says it cannot afford. The last release predates the
break, so nothing shipped wrong.

Why no gate caught it: every local `npm run check`, in that session and this one,
passed — this host is the one architecture the lock still served. A host-shaped
hole is invisible to a gate run on that host.

**Fixed** by regenerating the lock in a clean room, manifests only and no
`node_modules`, which restores all 31 entries. Verified equivalent otherwise: 31
added, 0 removed, no version drift, no integrity change on any shared package.

**Gated** by `repo-gates.test.mjs`, which derives the platforms from the runners
every workflow declares and fails if the lock lacks a toolchain for one. Scoped
rather than blanket, and checked both ways: dropping `@esbuild/linux-x64` or
`@biomejs/cli-darwin-arm64` turns it red, dropping `@esbuild/win32-x64` does not,
because no lane runs win32.

Regenerate the lock with `node_modules` absent, or this comes back.

## 2026-08-08 — scripts/ is measured

Slice 1 of the release-guard goal. `scripts/` now has the third `c8` target:
`.c8rc.scripts.json`, `npm run coverage:scripts`, and the runner
`scripts/coverage-scripts.mjs`. Measured across both tiers at 80.55 / 72.68 /
89.75 / 80.55; floors sit at 80 / 72 / 89 / 80.

Two things the handoff's plan did not account for, both found by running it:

- **The floor cannot be flat across platforms.** `check.yml` runs the same
  `npm run check` on macOS, where `platformProofSkip` correctly skips the
  installed-binary proofs — on platform and arch alone, not on
  `CEAL_REQUIRE_PLATFORM_PROOFS`, which only escalates a skip that was already
  decided — and coverage drops through nobody's defect. A flat floor would fail
  that leg for skipping what it is right to skip: the `ceal-v0.67.0` shape. Hence
  the runner. It measures on Linux, and on macOS runs the tiers plainly and prints
  the measurement it did not carry.
- **The maintainer host is `linux-arm64`, not the release platform.** So the
  floors are measured there and *extrapolated* to `linux-x64`, which is enforced
  too because it carries every platform proof. [gates.md](gates.md) states the
  extrapolation and why it is small. **The first `check.yml` run confirms it or
  moves the number** — and that has NOT happened yet: the first run after this
  landed died at `biome check .` on the broken lockfile above, long before the
  gate reached coverage. The floor is still an arm64 measurement asserted about
  x64. The next green `ubuntu-24.04` run is the evidence.

Falsified rather than assumed, per the goal's own acceptance bar: breaking `all`,
`check-coverage`, the floor values, the release platform's place in the runner's
enforcement list, and `test`'s route through `coverage:scripts` each turn
`repo-gates.test.mjs` red, and a c8 run over an empty program exits nonzero on all
four ratios.

The mandated fresh-eye review found two things worth recording, both since fixed:

- **The floor was vacuous on an empty file set.** `c8` exits **0** when its
  `include` matches nothing — verified directly — printing all-zero ratios and
  comparing nothing, because istanbul builds them from 0/0 totals. A rename or a
  `src` typo would have left this gate green while measuring nothing. The runner
  now reads the emitted `coverage-summary.json` after a passing run and fails
  unless it names every script the config claims; breaking the glob now exits 2
  and lists all 19.
- **Nothing asserted that `npm test` still runs `test:unit`** — pre-existing, not
  introduced here. `repo-gates.test.mjs` pinned what `test:unit` *is*, never that
  anything called it, so deleting it from `test` would have taken both packages'
  coverage floors out of `npm run check` and out of `check.yml` with every gate
  green. It is a hop in the resolved chain now.

Cost, timed on this host: `npm run check` went from about 1m44s to **about
2m34s** — three timed runs at 2m33s, 2m36s and 2m33s, the last of them after the
one optimisation below, which is to say the optimisation does not surface above
the spread at gate level. `check:unit` is unchanged at about 49s.

That optimisation is also a correction. The overhead is `NODE_V8_COVERAGE`
inherited by everything the tiers touch, and this handoff first recorded that
stripping it at the spawn sites which cannot contribute `scripts/` coverage —
package managers, compilers, SEA tooling — "would buy most of the minute back".
**That was an inference from per-test timings and it was wrong.** Clearing it at
`verify-gateway-protocol-consumer.mjs`'s `run()` helper, the single largest of
those sites, recovered about 9 seconds of 52 on the tiers alone (2m03s to 1m54s)
with no coverage lost — and nothing measurable on the full gate. The rest is
V8 collecting coverage in the test processes themselves — the measurement, not
waste — so **do not open this as a performance goal.** The only remaining lever is
structural: drop the release tier and the floor drops to about 55%.

## 2026-08-08 — the legacy lane is gone

Two slices.

**1. Test cleanup.** The criterion throughout: does this assertion breaking mean
a real defect, or only that two files were not hand-synchronized?

- The `release-contract.json` guide-digest assertion left the worker gate. The
  previous handoff recorded that "the release never reads that value" — that was
  **wrong**: `build-platform-binaries.mjs` read it and failed `guide_drift` on a
  mismatch. But that was the frozen legacy lane, and the worker lane's own
  `worker-release-inputs.json` names `release-contract.json` under
  `forbidden_release_inputs`. So the assertion did not belong in the worker gate,
  and it went to the suite that tested the lane consuming it — which has since
  been deleted along with that lane.
- `guide-contract.test.mjs` duplicated all four of `worker-guide-contract.test.mjs`'s
  contracts. It was the copy the lane split forked from.
- The workflow-sequence regex pinned `--fresh` as a literal, so a test titled
  "without command snapshots" was itself a snapshot, and `cc29047` broke it by
  making a documented authoring decision. It now pins order and profile scoping.
- Elsewhere: exact npm-script strings became file-set membership plus a runner
  check; ordered `workspaces` and platform literals became the claim itself; a
  duplicated raw-YAML tag trigger went in favour of the parsed one; the
  `platformProofTest` name inventory became its anti-vacuity floor. The test
  asserting `WORKER_CONTRACT_TESTS.length <= 20` against a constant declared in
  the same file was deleted.

**2. Deleting the legacy lane.** Checked against `../ceal` directly: the cealctl
material here was a **stale fork**, not a compatibility input.
`packages/ceal-operator-cli` was missing `access-command-help.ts` and
`bounded-json-response.ts` and differed in six more source files; the operator
guide had been rewritten wholesale into
`packages/official-skills/ceal-native/skills/cealctl-guide/SKILL.md`; the
installer had moved to `packaging/cealctl/install-cealctl.sh`. And
`packaging/ceal-cli-source/` is genuinely absent from that repo. This was the
Stage 5 deletion gate the README already described.

Deleted: `packages/ceal-operator-cli`, `skills/cealctl-guide`, `install.sh`,
`release-contract.json`, `ceal-cli-seed-manifest.json`,
`scripts/build-platform-binaries.mjs`, `scripts/build-release-manifest.mjs`,
`.github/workflows/cealctl-release.yml`, the four-file `test:legacy-compatibility`
suite, and the dead half of the development-only chain —
`scripts/build-worker-release-artifact.mjs`,
`scripts/verify-worker-release-inputs.mjs`, `release/worker-inputs.json` and their
tests.

**Kept, and why:**

- `.github/workflows/npm-package-stage.yml` and its bare `v*` tags. Not cealctl
  material: it is the only npm publish path `@corca-ai/ceal-protocol` and
  `@corca-ai/ceal` have. Operator's call.
- `scripts/verify-gateway-protocol-consumer.mjs`. **Not dead code** — it runs
  inside `npm run check` through `test/gateway-protocol-consumer.test.mjs` for
  about 16s, and proves two things the live lane cannot, because the live lane
  hand-extracts tarballs and never invokes npm's resolver: that a real install
  binds `package-lock` to the Gateway tarball rather than a workspace link or the
  registry, and that `import.meta.resolve` in the installed consumer lands under
  `node_modules/`. It now reads the live `worker-release-inputs.json` instead of
  the duplicate inventory it used to carry.

**Relocated, not dropped:** the release-identity claims only the deleted tests
made — worker is `private: true`, client and protocol stay publishable, consumers
pin the vendored protocol exactly — moved into `repo-gates.test.mjs`. The
`forbidden_release_inputs` content pin moved into `worker-release-inputs.test.mjs`,
which until then would have stayed green on an emptied list.

## Current State

- Version `0.74.0` (root and `packages/ceal-worker-cli` agree), latest tag
  `ceal-v0.74.0`.
- `gateway-protocol-handoff-lock.json` is the single record of handoff consumption.
- Four workflows: `check.yml`, `ceal-release.yml`,
  `ceal-worker-stable-rollback.yml`, `npm-package-stage.yml`.
- Gates: `npm run check` passes in about 2m35s, `check:unit` in about 49s, both
  timed with `time` on this host — the final gate carries the `scripts/` coverage
  run and the iteration gate does not. Two suites only — `test:contract`,
  `test:release`, reached from `npm test` through `coverage:scripts` and
  `test:tiers`.

## Debt

Carried from the previous handoff and **none of it re-confirmed**. Check that an
item is still true before starting on it.

- **The signed release manifest has no client package.**
  `ceal-worker-release-manifest-<platform>.json` records only the protocol, so a
  consumer is left with a source-owner claim. The real fix puts the client in the
  manifest schema, which is a release-affecting change.
- **The acceptance record's receipt branch is not an allow-list.** It passes a
  Gateway receipt event through without projection, so `membership_ref` and
  `subject_ref` ride along.
- **The record has two formats.** The repo script emits JSON, the installed
  command emits YAML.
- **CI has no macOS install leg.** Do not cite `require_platform_proofs` as the
  reason — that is about the release and installer suites, and requiring it across
  all of `linux-*` is what burned `ceal-v0.67.0`. It is narrowed to `linux-amd64`
  and gated there now.
- **The worker `createLock` race** is unresolved.

Everything else is owned by the comment at the site and by [gates.md](gates.md).

## References

- [Gate detail](gates.md) · [release and enrollment](release-and-enrollment.md) ·
  [operator acceptance ceiling](operator-acceptance.md)
- [docs/requests/](requests/) — where a divergence declaration must point; the
  split-era correspondence that filled it was deleted on 2026-08-08 and is in `git log`
