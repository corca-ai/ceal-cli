# Quality Review
Date: 2026-08-11
Title: Probe and deadline integrity

## Scope

Target boundaries: declared default CLI routes, packed-consumer workspace lifecycle,
Unix-socket request deadlines, and subprocess coverage byproducts.
The frozen Protocol package and sibling Gateway repository were read-only.

## Surface Contract Review

- semantic coverage: `partial` — checkout behavior and negative paths are observed;
  signed installed bytes and live Gateway/provider behavior are not.
- surface: `ceal guide`/`ceal session` probe routing, packed Protocol consumer
  verification, private Unix-socket POST, and retained real-binary guide smokes.
- owner: `CEAL_SUBCOMMANDS` owns default leaves;
  `verifyGatewayProtocolConsumer` owns its workspace; `postUnixSocket` owns its
  wall deadline; `coverage:scripts` owns only `scripts/**` profiles.
- projections: selected read-only leaf, retained debug workspace path, settled
  transport promise, and emitted V8 profiles.
- state scope: one invocation, one temporary consumer, one socket request, and one child process.
- transitions: bare parent to default leaf; verification to cleanup or explicit
  retention; active response to deadline refusal; worker smoke to no discarded
  child profile.
- proof boundary: worker package coverage, focused contract/release tests, static gates, and guarded checkout probes.
- unexamined axes: signed installation, macOS, live Gateway/provider readback,
  acceptance-packet managed-layout enforcement, and its hung-binary behavior.

## Current Gates

- Worker package coverage, lint, unused-export, production-reachability,
  store-lock, and duplicate-literal gates pass on the repaired tree.
- The ordinary `check:unit`/`check` ship-facing path remains intentionally
  unavailable while B1 proof/shipment Protocol divergence is quarantined.
  `npm run check:protocol-dev` is development proof, not release proof.
- The planner's broad quality-runner command is absent here, so repo-owned gates and focused proofs were used.

## Runtime Signals

- runtime source: `render_runtime_summary.py --repo-root . --summary` over the
  gitignored timing log. <!-- reproduction-source -->
- runtime hot spots: the adapter-owned standing gate budgets are not exceeded in that summary.
- `NODE_V8_COVERAGE=<scratch> node --test test/contract/worker-guide-contract.test.mjs`
  leaves the parent contract
  profile while no longer emitting checkout worker-bin profiles.
- coverage gate: worker coverage passed; the ship-facing repo gate remains quarantined.
- evaluator depth: deterministic local tests and read-only probes only.

## Healthy

- Bare observational parents now derive their default leaves from the same
  declaration that owns help, effects, probe authorization, and dispatch.
- Packed-consumer workspaces are removed on success and expected failure; only
  the explicit debug-retention option preserves and reports one.
- Unix-socket requests use a wall deadline that response activity cannot reset.
- Real process smokes remain without producing data outside the scripts coverage target.
- Documentation now calls the sanctioned probe checkout-built proof and names
  the current B1 gate divergence honestly.

## Weak

- `worker-acceptance-packet.mjs` still accepts a self-consistent scratch binary,
  manifest, and checksum set as an installed release instead of requiring the
  managed installer layout already recognized by `stable-update.ts`.
- Its synchronous unbounded binary invocations let a wedged binary wedge acceptance emission.
- `test/repo-build.mjs` can let multiple stale-lock reclaimers delete a newly
  acquired successor because removal is not generation-specific.

## Missing

- Regenerable-facts documentation classification is not configured.

## Deferred

- Acceptance layout validation and bounded child termination need one shared
  owner rather than a copied path grammar or a bare `spawnSync` timeout.
- The repo-build stale-lock repair needs a generation-specific tombstone and a
  deterministic late-reclaimer regression, following the production lock's
  already-proven shape.
- Sharing immutable packed Protocol fixtures per release-test module is a lower-priority speed move.

## Advisory

- command: `inventory_skill_ergonomics.py --repo-root . --summary` flags `ceal-guide` for progressive-disclosure risk, but
  manual review found its single-file release asset and incremental intent flow
  coherent; splitting it now would create another distribution boundary.
- command: `inventory_standing_test_economics.py --repo-root . --summary` does not justify a repo-wide spawn budget; remaining process tests
  which mostly own packaging, isolation, FD, or installed-process semantics.

## Candidate Scorecard

Behavior value: restore read-only reachability and bounded waits/storage while preserving process proof.
Intent overlap: directly answers the requested bug, speed, and quality pass.
Structural signal: derive from existing owners and narrow test orchestration.
Ownership: production facts remain in declarations and transports; tests own
scenario assertions, not alternate implementations.
Gate blast radius: worker runtime, contract probe, packed-consumer negative proof, and one guide smoke helper.
Disposition: implemented the deterministic repairs; keep the three reproduced
larger defects as active next work.
Stop condition: focused and package proofs pass, truth surfaces agree, and the
fresh-eye findings are either repaired or explicitly carried.

## Delegated Review

- Delegated Review: executed — independent read-only behavior/security, operability/skills, and runtime/economics lenses.
- requested tier: high-leverage; host execution metadata was not exposed.
- reviewer boundary fingerprints were verified clean after every return.
- findings received: packed workspace leak, probe default-route split brain,
  checkout/installed proof-label mismatch, wall-deadline defect, coverage
  byproducts, acceptance integrity gaps, and release-fixture repacking.

## Commands Run

- `python3 .../render_runtime_summary.py --repo-root . --summary`
- `python3 .../inventory_standing_test_economics.py --repo-root . --summary`
- `npm run build:worker`
- `npm --ignore-scripts --prefix packages/ceal-worker-cli run coverage`
- `node --test test/contract/probe-surface.test.mjs`
- `node --test test/contract/worker-guide-contract.test.mjs`
- focused carrier, CLI routing, and packed-consumer tests named in the diff
- `npm run lint && npm run lint:unused && npm run lint:reachability`
- `npm run lint:store-lock && npm run lint:duplicate-literal`
- `node scripts/install-git-hooks.mjs --check`
- `npm run probe -- ceal guide` and `npm run probe -- ceal session`
- outer `NODE_V8_COVERAGE` profile inventory with a positive-control parent hit

## Recommended Next Quality Moves

- active make acceptance emission consume one managed-install identity owner
  and use a TERM/KILL-bounded runner; proof boundary is a scratch decoy refusal
  plus a hanging installed-binary fixture that settles.
- active replace repo-build stale removal with generation-specific quarantine;
  proof boundary is a late reclaimer that cannot move its successor.
- passive because correctness moves dominate, share one immutable packed Protocol fixture per release-test module;
  proof boundary is unchanged artifact assertions with one pack invocation.

## History

- [Earlier test-economics review](history/2026-07-27-quality-review-second-pass.md)
