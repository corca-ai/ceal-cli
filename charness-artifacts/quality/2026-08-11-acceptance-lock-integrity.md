# Quality Review
Date: 2026-08-11
Title: Acceptance and lock integrity

## Scope

Target boundaries: installed-worker acceptance identity, acceptance child
lifecycle, the shared test-build lock, standalone package build closure, and
duplicate Protocol packing in release tests. The frozen Protocol package and
sibling Gateway repository were not changed.

Ambient repo findings: B1 proof/shipment divergence still blocks ship-facing
gates; that quarantine is not a regression from this review.

## Surface Contract Review

- semantic coverage: `partial` — managed and decoy layouts plus bounded child
  failures are observed locally; signed installed bytes are not.
- surface: checkout acceptance packet, installed `ceal acceptance emit`, stable
  update/observe install inspection, and shared workspace build serialization.
- owner: `managed-worker-install.ts` owns installed topology;
  `bounded-process.ts` owns child settlement; `repo-build.mjs` owns shared dist.
- projections: acceptance release facts, update/observe availability, child
  result envelopes, and the workspace `dist` generation.
- state scope: one managed current generation, one child process tree, and one
  workspace build-lock generation.
- transitions: managed/unmanaged/current/stale install; exit/timeout/output
  overflow; candidate publish/reclaim/successor acquisition.
- proof boundary: worker package coverage and focused acceptance/lock contract tests.
- unexamined axes: signed install, live Gateway/provider, macOS process groups,
  and release-test timing after Protocol shipment convergence.

## Current Gates

- Worker coverage, lint, unused-export, production-reachability, store-lock, and
  duplicate-literal gates pass on the repaired tree.
- The ordinary `check:unit` and `check` paths remain intentionally unavailable
  because the signed handoff lock still trails the quarantined Protocol proof.
- The adapter-routed broad `./scripts/run-quality.sh --read-only` command is
  missing; repo-owned gates and focused proofs supplied the executable evidence.
- Maintainer-Local Enforcement: healthy — the checked-in pre-push hook and
  `node scripts/install-git-hooks.mjs --check` remain the enforcing path.

## Runtime Signals

- runtime source: `render_runtime_summary.py --repo-root . --detail` over the
  repo-declared gitignored timing log. <!-- reproduction-source -->
- runtime hot spots: the summary reports no budget breach in its current window.
- coverage gate: worker package coverage passed after the repair.
- evaluator depth: deterministic local gates only; no provider roundtrip was appropriate.

## Healthy

- Arbitrary binary/manifest/checksum bundles no longer qualify as installed;
  acceptance, update, and observe derive from one managed-topology owner.
- Acceptance children have a shared process-tree deadline, TERM/KILL escalation,
  output cap, and pipe settlement; call timeout names unknown-outcome recovery.
- Test dist acquisition publishes a completed private candidate atomically and
  stale reclamation cannot delete or move a successor generation.
- Standalone package hooks build their complete workspace dependency closure.
- Packed-consumer fallback inspection now reads dependency declarations
  structurally; worker install hashing has one package-private owner.
- The worker package and native release-test modules now each share one
  immutable Protocol packet fixture while retaining their real packed-consumer
  delivery smokes.

## Weak

- Several non-acceptance release/probe subprocess seams still use synchronous
  child execution without an explicit repo-owned deadline.
- The release-test pack saving is structurally present but cannot be timed on a
  green delivery path while B1 shipment divergence rejects the builders.

## Missing

- Regenerable-facts documentation classification remains unconfigured.
- Signed installed-worker and live Gateway/provider proof remain outside this run.

## Deferred

- No Protocol, Gateway, release, push, tag, or publication action was authorized
  or performed.

## Advisory

- artifact: current diff structural review result — acceptance identity moved to the installer-owned
  topology module; process and lock mechanics were reduced to one owner each.
- command: `inventory_skill_ergonomics.py --repo-root . --summary` prose review
  result — `ceal-guide` still triggers the heuristic
  progressive-disclosure advisory, but its incremental intent flow and
  single-file shipped asset remain coherent.
- command: `check_regenerable_facts.py --repo-root .` reports a typed
  not-configured result, not a clean documentation verdict.

## Delegated Review

- Delegated Review: executed — three bounded read-only reviewers covered
  acceptance semantics, lock concurrency, and test economics/operability.
- Slow-gate lenses were delegated to the runtime/economics reviewer:
  fixture-economics justified module-lifetime immutable fixtures;
  parallel-critical-path found no safe delivery-smoke removal; duplicated-proof
  retained the distinct packed and native boundary smokes.
- requested tier: high-leverage; host applied metadata was not exposed.
- reviewer boundary fingerprint verdict was clean after every return.
- The second review round found signal/spawn settlement gaps, incomplete
  installer-topology identity checks, and stale-lock publication races. Those
  findings were repaired and re-proved locally. Per the two-round review cap,
  the final repair delta is accepted-unreviewed rather than presented as a
  third fresh-eye verdict.

## Commands Run

- quality planner/bootstrap commands from `charness:quality`
- `python3 .../render_runtime_summary.py --repo-root . --detail`
- `python3 .../check_regenerable_facts.py --repo-root .`
- `npm run build:worker`
- `npm --prefix packages/ceal-worker-cli run coverage`
- clean temporary copy: `npm ci --ignore-scripts`, then standalone client and
  worker package tests with no pre-existing `dist`
- focused acceptance, repo-build, stable-update, and packed-consumer tests
- `npm run lint && npm run lint:unused && npm run lint:reachability`
- `npm run lint:store-lock && npm run lint:duplicate-literal`

## Recommended Next Quality Moves

- active inventory the remaining release/probe subprocess seams —
  capability_needed=bounded process lifecycle; next_center=release script
  orchestration; transformation=reuse or specialize an explicit deadline owner;
  proof_boundary=hanging-child fixtures settle before an outer watchdog;
  enforcement_posture=advisory.
- passive until signed Protocol convergence, measure the shared packet-fixture
  saving — capability_needed=release tier timing; next_center=release test
  orchestration; transformation=confirm one pack per module without weakening
  delivery smokes; proof_boundary=focused release files on a shippable pin;
  enforcement_posture=no-gate because the builders are currently quarantined.

## History

- [Probe and deadline integrity](2026-08-11-probe-and-deadline-integrity.md)
- [Earlier test-economics review](history/2026-07-27-quality-review-second-pass.md)
