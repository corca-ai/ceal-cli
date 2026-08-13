# Implementation Contract

Date: 2026-08-13
Title: Release Test Readiness Isolation
Status: completed

## Problem

The full local gate reports four release-test failures from one intentional
checkout state: the signed Protocol proof/ship pin is divergent. Two artifact
success tests and two downstream compiler/Darwin behavior tests all enter the
same ambient development-input preflight before reaching their own assertion
subject. Their skipped branches then cause script coverage thresholds to fail.

The production fail-closed chokepoint is correct. The test arrangement is not:
post-guard behavior tests are coupled to whether the maintainer checkout happens
to be release-ready, even though the repository already owns a minimal converged
Protocol scratch-repository fixture for this purpose.

## Slice

- Extend the existing converged Protocol fixture with an opt-in release-build
  surface containing the owned package sources, guide/notices, and exact local
  build dependencies required by package/native builders.
- Make `packedProtocolFixture` build its packet from that converged repository
  and return its `repoRoot`.
- Run package/native success, compiler-diagnostic, and Darwin-order tests against
  that root.
- Keep the production/development-input pin guard unchanged and retain the
  dedicated divergence/chokepoint contract tests.

## Success Criteria

1. The four formerly ambient-coupled tests reach and prove their own assertion
   subjects while the main checkout remains intentionally divergent.
2. Dedicated `proof_shipment_protocol_divergence` and chokepoint tests stay
   green; no production guard or release command accepts divergent input.
3. `npm run check` passes, including release-script coverage thresholds.
4. The fixture remains opt-in and does not make every contract fixture copy
   release build dependencies.

## Constraints

- Do not change pin, lock, package versions, frozen Protocol source, or release
  inputs in the real checkout.
- Do not add a production bypass flag or injectable no-op pin guard.
- Do not claim release readiness, signature, publish, or installed behavior.

## Proof Boundary

Local deterministic package/native tests, dedicated guard contract tests, full
`npm run check`, and bounded fresh-eye review. No external write or release.

## Completion

The release-build fixture now owns one internally coherent scratch checkout:
its Protocol packet, pin, lock, control-session contract, generated sources,
owned package source, guide/notices, and four build dependency trees all come
from the same converged root. The production guard is unchanged. Dedicated
divergence/chokepoint proof and the full repository gate both pass.
