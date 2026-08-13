# Release Test Readiness Isolation Closeout

## Implemented

- Extended the existing converged Protocol scratch repository with an opt-in
  release-build surface rather than adding a second fixture or a guard bypass.
- Copied only the two owned package source trees, release contracts, guide,
  compatibility guide, notice, locked Gateway handoff, and the four dependency
  trees the package compiler actually stages.
- Bound the fixture's control-session contract and generated sources to its
  derived Gateway/Protocol identity before committing the scratch checkout.
- Packed Protocol from that checkout while the shared Protocol build lock still
  owned the generated `dist` snapshot.
- Passed the same fixture root through package/native success, compiler-error,
  and Darwin-order tests. Production archive-boundary negatives and dedicated
  divergence/chokepoint tests still exercise the real refusal surface.
- Replaced one stale native integration assertion that banned the placeholder
  literal `server-controlled` with exact meaningful public-safe Gateway prose,
  while retaining credential non-reflection assertions.

## Verification

- Targeted package/native bundle: 10/10 passed at
  `/tmp/ceal-proof-jobs/ceal-cli-release-fixture-targeted/result.20260813d.json`.
- Dedicated Protocol divergence and release-chokepoint contracts: 23/23 passed.
- Full `npm run check`: passed in 154.813 seconds, including lint, static gates,
  build, unit/contract coverage, 251 contract tests, 35 release tests, and
  release-script coverage. Durable result:
  `/tmp/ceal-proof-jobs/ceal-cli-release-fixture-full-check/result.20260813a.json`.
- `npm run lint` and `git diff --check` passed.
- The staged pre-push iteration gate passed `check:unit` with 251/251 contract
  tests. Its duplicate ratchet initially exposed one import-scaffolding re-key
  plus six pre-existing/unreviewed families; bounded fresh-eye classified them,
  `dup-review.json` now records each ownership rationale, and the ratchet plus
  shell lint pass. The original failed hook artifact is retained honestly at
  `/tmp/ceal-proof-jobs/ceal-cli-release-fixture-prepush/result.20260813a.json`.

## Lint Gate

Passed directly and again inside the full repository gate. The full gate also
passed unused-export, production-reachability, store-lock, duplicate-literal,
clean-build, contract, release, and coverage checks.

The maintainer-local structural duplicate ratchet and shell lint pass after
reviewed overlay synchronization. The exact duplicated `nodeErrorCode` pair is
named as bounded gate debt rather than being silently folded into this fixture
slice.

## Boundary Ownership

`owned-correctly` — post-guard release tests own a converged deterministic
repository state; the production readiness guard continues to own refusal of
the intentionally divergent maintainer checkout.

## Critique

The bounded fresh-eye review found no Act Before Ship issue. Its one
Bundle Anyway comment-accuracy finding was repaired. The full disposition is
recorded in
`charness-artifacts/critique/2026-08-13-release-test-readiness-isolation-code-critique.md`.

Fresh-Eye Satisfaction: parent-delegated.

## Residual Risks and Non-Claims

- This is a local test-isolation repair, not Protocol convergence or release
  readiness. The real checkout remains intentionally divergent until the final
  signed handoff is published and consumed.
- No production bypass, pin/lock rewrite, package version change, publish,
  install, provider action, or live instance apply occurred.
- Real macOS signing remains a platform/release proof, not a Linux fixture
  claim.

## Completion Categories

- Completed locally: fixture ownership, exact release read surface, derived
  identity consistency, guard separation, targeted proof, and full gate.
- Deferred to external owner/state: final signed Protocol handoff and release.
- Unresolved inside this source slice: none.
