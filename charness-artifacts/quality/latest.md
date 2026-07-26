# Quality Review
Date: 2026-07-26
Title: Quality Review

## Scope

Target boundary: repo-wide question — are the linter, the tests, and `AGENTS.md` actually
in good shape? No target skill.

Ambient repo findings: `.charness/` scratch was not gitignored (repaired this turn);
`.agents/quality-adapter.yaml` did not exist and bootstrap wrongly recorded this repo as
having no gate commands (repaired this turn).

## Current Gates

- `npm run check:unit` — build + 4 package suites. Green, exit 0, measured 22.56s.
- `npm run check` — build + unit + release. Green, exit 0, 86 release tests, measured 124.27s
  (of which `test:release` 98.997s; slowest single test 16.6s, next 6.56s).
- `npm audit` — 0 vulnerabilities, 1 production dependency (`yaml`).
- Lint/format: **none exists anywhere in the repo.** `tsc` is the only static check.
- CI: 4 workflows, all `push: tags:` or `workflow_dispatch`. No PR or branch gate.
- Local enforcement: no git hook, no `core.hooksPath`, no husky/lefthook.

## Runtime Signals

- runtime source: structured timing capture is missing — no `.charness/quality/runtime-signals.json`, no `command_timing_log` adapter key. One-off `time` numbers are recorded under `## Current Gates` and are not a trend. <!-- reproduction-source -->
- runtime hot spots: unavailable until structured runtime metrics have samples. The one-off run shows `test:release` dominating; ranking needs repeated samples.
- coverage gate: none configured; no coverage instrumentation in the repo.
- evaluator depth: deterministic gates only — no Cautilus run, not configured for this repo.

## Healthy

- Failure-path coverage is the suite's strongest dimension: `cli.test.mjs` pins refresh-expiry
  ordering (`refreshCalls() === 0`), renewal-failure vs typed denial, and spool-throw isolation;
  `http-transport.test.mjs` covers redirect refusal, non-2xx, byte bounds; `stable-update.test.mjs`
  covers tampered installer, downgrade, unmanaged generation.
- Test/source balance is honest: ~9515 test LOC against ~9756 `packages/*/src` LOC. Supply
  chain: 0 vulnerabilities, one production dependency, every GitHub Action SHA-pinned.
- `AGENTS.md`/`CLAUDE.md` host-doc shape is already correct: `CLAUDE.md` is a symlink to
  `AGENTS.md`; `normalize_host_docs.py` plans `keep_agents` + `keep_claude_symlink`.

## Weak

- `AGENTS.md:60-62` names `CEAL_SUBCOMMANDS` / `CEALCTL_SUBCOMMANDS` as both living in
  `packages/ceal-worker-cli/src/subcommands.ts`. `CEALCTL_SUBCOMMANDS` is at
  `packages/ceal-operator-cli/src/index.ts:165` — a *frozen* package. The contract routes
  an agent into a ledger violation.
- `AGENTS.md:61-62` "Adding a route means adding a table entry, nothing else" is false for
  behavior. `client-session.ts:22-25` falls through to `enrollSession` for any non-`logout`
  session route; `index.ts:464` defaults any non-`register` guide route to `status`. A
  table-only row passes `check:unit` (the help gate) and misroutes.
- Gate timings are stale and triplicated: `~95s`/`~14s` at `AGENTS.md:53`,
  `README.md:127,133`, `docs/handoff.md:61`. Measured 124.27s / 22.56s.
- `packages/ceal-worker-cli/test/cli.test.mjs:136` blames the frozen-version incident on
  `0.65.10`; `docs/handoff.md:38` records it as `0.65.7`. `0.65.10` is the current good release.
- `test/guide-contract.test.mjs:106` asserts `node ROOT/missing/<binary> --help` exits non-zero.
  That path never exists; the assertion tests Node, not the product. The same file needs no
  release artifact yet pays the `--test-concurrency=1` tax — it belongs in `test:unit`.
- `cli.test.mjs:1650` runtime-purity denylist omits `node:child_process`, `node:os`, `node:dns`,
  `node:tls`. `stable-update.ts` already imports `spawn` in the same package.
- `client-session.ts:321` and `:336` hand-maintain two overlapping failure-code sets with
  no agreement test. A code added to one and not the other makes `ceal call` emit an
  `outcome_unknown` receipt for a call the Gateway provably never issued.
- `cli.test.mjs:158-166` and `:433-443` grep `src/*.ts` text as a stand-in for behavior;
  the `error: \{([^}]*)\}` sweep sees only 21 literal sites and truncates at the first `}`.

## Missing

- No linter or formatter of any kind, and `AGENTS.md` does not say so. Sources are
  tab-indented by convention only, with no mechanical fixer.
- No CI gate on `main`. The first workflow run for any change is the **tag** run, so a gate
  failure surfaces as a burned, non-reusable tag — the `0.65.7`/`0.65.8` loss class already
  recorded in `docs/handoff.md:38-45`.
- Maintainer-Local Enforcement: **missing.** `npm run check` is the declared final gate with
  no checked-in hook, installer, or clone validator — honor-system only.
- `scripts/prewarm-offline-consumer-cache.mjs` has zero coverage and is not import-shaped
  (top-level closure walk, lines 60-64). Its walk reads `dependencies`/`peerDependencies` but not
  `optionalDependencies`, and `lockPackages()` keeps only the first record per bare name —
  failing as `ENOTCACHED` on a cold release runner.
- `docs/roadmap.md` and `docs/operator-acceptance.md` do not exist; given the install surface
  and release lane, absent operator-takeover guidance is an operability gap.
  `.agents/retro-adapter.yaml` is likewise missing while `charness-artifacts/retro/` is active.

## Deferred

- `AGENTS.md` has no `## Skill Routing` or `## Subagent Delegation` block; the SessionStart
  hook injects routing on this host, so it is not load-bearing today.
- Coverage floor and mutation testing: not proposed. No coverage instrumentation exists, and
  adding it across a 4-package workspace is larger than this review.

## Advisory

- structural review result: no target skill named, so no `structural_review_packet` was emitted.
- prose review result: `skills/ceal-guide/SKILL.md` (120 lines) trips `progressive_disclosure_risk`
  and `option_pressure_terms_present`; `cealctl-guide` is clean. Advisory only — the guide is
  contract-tested by `test/guide-contract.test.mjs`, so the trigger boundary is honest.
- `command: npx knip` reports 3 unused files / 42 unused exports — **almost entirely false
  positives**: tests import from `../dist/*.js` not `src/`, `bin.ts` is an esbuild entry, and
  `postject` resolves via `REQUIRE.resolve`. Needs `entry`/`project` config to be usable.
  `command: inventory_doc_duplicates.py` flags the two SKILL.md intros (0.95) — shared shape.
- Real-binary proofs are host-gated and silent: `worker-release-installer.test.mjs:316` and
  `build-worker-release-artifact.test.mjs:112` skip unless linux-x64; `public-distribution.test.mjs:21`
  skips without `flock`/`sha256sum`. On arm64 macOS `npm run check` exits 0 with zero
  real-installer proof, reported as skipped rather than failed.
- `test/gateway-protocol-fixture.mjs:8` uses `new URL(...).pathname` not `fileURLToPath`, so a
  checkout path containing a space yields a confusing ENOENT.

## Delegated Review

- Delegated Review: executed — two `charness:bounded-reviewer` agents (host-policy scope,
  test/gate-posture scope). Every CONFIRMED claim cited above was independently re-verified
  by the parent before landing here.
- Slow-gate lenses (fixture-economics, parallel-critical-path, duplicated-proof): covered by the
  test-posture reviewer, not re-delegated. `buildWorkerNativeArtifactFromDevelopmentInputs` runs a
  full SEA build 3× per `test:release`, and `packedProtocolFixture` re-runs `npm run build` +
  `npm pack` uncached across ~11 invocations, all serialized by `--test-concurrency=1`.

## Commands Run

- `npm run check` (exit 0, 124.27s, 86/86), `npm run check:unit` (exit 0, 22.56s),
  `npm audit` + `--omit=dev` (0 vulns), `npx knip --no-progress` (advisory, config-less)
- `plan_quality_run.py`, `inventory_ci_local_gate_parity.py --canonical-gate-pattern 'npm run check'`,
  `inventory_doc_duplicates.py`, `inventory_skill_ergonomics.py`, `inventory_entrypoint_docs_ergonomics.py`,
  `inventory_standing_test_economics.py`, `inventory_structural_waste.py`, `inventory_sloc.py`, `render_runtime_summary.py`, `inspect_repo.py`, `normalize_host_docs.py`

## Recommended Next Quality Moves

- active add a branch/PR CI workflow running `npm run check` — capability_needed=know a change is green before it becomes a tag; next_center=`.github/workflows/`; transformation=new workflow on `push`/`pull_request` to non-tag refs; proof_boundary=the same `npm run check` already green locally; enforcement_posture=gate.
- active correct the three verified falsehoods in `AGENTS.md` (CEALCTL table location, route-acceptance overclaim, stale timings) — capability_needed=an agent can trust the contract; next_center=`AGENTS.md`; transformation=fix in place, drop the duplicated timings; proof_boundary=grep against `packages/ceal-operator-cli/src/index.ts:165`; enforcement_posture=advisory.
- active fix `packages/ceal-worker-cli/test/cli.test.mjs:136` `0.65.10`→`0.65.7` — capability_needed=the freeze rationale names the right incident; next_center=that comment; transformation=one-token correction; proof_boundary=`docs/handoff.md:38`; enforcement_posture=advisory.
- active export and pin `isClassifiedClientSessionFailure` against `classifyClientSessionFailure` — capability_needed=a new denial code cannot desync the two sets; next_center=`client-session.ts:321,336`; transformation=derive the second set from the first, or add an agreement test; proof_boundary=a unit test over both; enforcement_posture=gate.
- active adopt a linter (`oxlint` or `biome`) or state in `AGENTS.md` that none exists — capability_needed=style is mechanical, not folklore; next_center=repo root; transformation=add config + `lint` script, or one honest contract line; proof_boundary=`npm run lint` clean; enforcement_posture=advisory until it is green, then gate.
- active install a pre-push hook running `npm run check:unit` — capability_needed=close the Maintainer-Local Enforcement gap; next_center=repo-owned hook installer; transformation=checked-in hook + `core.hooksPath`; proof_boundary=hook fires on a dirty clone; enforcement_posture=gate.
- passive share the SEA build as one module-scope fixture across the three release tests — capability_needed=cut ~20s of duplicated `test:release` cost because only `worker-release-installer.test.mjs` needs its *own* artifact and the rest need *an* artifact; enforcement_posture=no-gate because the duplication is cost, not a correctness risk.
- passive make `scripts/prewarm-offline-consumer-cache.mjs` import-shaped and test the closure walk — capability_needed=catch a dropped `optionalDependencies` transitive locally because today it surfaces as `ENOTCACHED` mid-release; enforcement_posture=no-gate because the refactor precedes the test.
- passive assert the host proof tier reached by `npm run check` — capability_needed=a green run on arm64 macOS should not read as real-installer proof because the skips are silent; enforcement_posture=no-gate because the release lane already runs linux-x64.

## History

- [first quality review — no prior baseline](history/2026-07-26-quality-review.md)
