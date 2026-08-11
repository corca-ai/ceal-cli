# Diverged Iteration Gate Debug

Date: 2026-08-11

## Problem

`npm run check:unit` failed ten contract tests with
`proof_shipment_protocol_divergence`. One release-readiness fact from the live
checkout was being re-tested through several contract-behavior cases, so the
first guard shadowed the behavior each case was meant to prove.

## Correct Behavior

`test:contract` proves invariant and fixture behavior independently of the live
checkout's release readiness. Ship-facing builders, packing, acceptance, and
the release tier still inspect the live pin and refuse a declared divergence.

## Observed Facts

- `protocol-vendor-pin.json` records reviewed local Protocol source and an older
  signed shipment with `status: diverged`.
- The acceptance and release-input contract positives passed the repository
  root implicitly, so their production guards stopped before their own packet
  and input branches.
- The same public production entrypoints work against a real scratch Git
  checkout whose frozen tree, pin, and lock genuinely converge.
- Separate diverged scratch fixtures make both entrypoints refuse with
  `proof_shipment_protocol_divergence` before installed-binary or input work.

## Reproduction

- Before repair: `npm run check:unit` reached the contract tier and the ten
  affected cases all stopped at the same divergence verdict.
- After repair: `npm run check:unit` passes while the live release-tier positive
  still refuses the declared divergence.

## Candidate Causes

- The production guard was too broad.
- Contract tests accidentally coupled behavior proof to live release state.
- The divergence declaration was internally inconsistent.

## Hypothesis

The second cause is correct. If contract positives receive a genuinely
converged repository fixture, their downstream behavior becomes reachable
without changing production guards. If a ship-facing live-root path then
succeeds, the hypothesis is false.

## Verification

- Added `test/converged-protocol-repo-fixture.mjs`, which commits a real scratch
  repository and derives the pin and lock from that repository's actual tree.
- Contract packet and release-input positives call the unchanged public guarded
  functions through test-local wrappers that own the converged root.
- Diverged-fixture tests prove both public guard call sites run before later
  binary/input work.
- The live release package positive remains a release-tier readiness proof and
  refuses the current checkout.

## Root Cause

One representation, `test:contract`, was carrying two concepts: stable contract
semantics and current-checkout shippability. Repeating the live root across
otherwise different tests hid that coupling from lexical duplicate detection
and made one release fact shadow several unrelated test oracles.

## Invariant Proof

- Invariant: contract behavior is state-independent, while every ship-facing
  live consumer must refuse proof/shipment divergence.
- Producer Proof: the shared scratch fixture derives a real commit/tree and
  writes agreeing lock and pin records; the live pin verifier still reports the
  declared divergence.
- Final-Consumer Proof: both acceptance and release-input public entrypoints
  pass their downstream contract tests under convergence and refuse their
  deliberately diverged fixture before later work.
- Interface-Shape Sibling Scan: no contract-tier live shippability positive
  remains; live-root positives remain in the release tier.
- Non-Claims: no signed handoff, release package, installed successor, Gateway
  selection, or provider readback was proved by the converged fixture.

## Detection Gap

- nose compares repeated lexical blocks; the affected calls had different
  options and assertions, so their shared hidden input (`repoRoot`) was not a
  clone family.
- The behavioral falsifier is now the iteration gate itself: it must pass under
  declared live divergence, while explicit diverged-fixture guard tests and the
  release tier must remain red.
- A full nose inventory did find a separate repeated client-session JSON fixture;
  that fixture now has one test owner in `test/client-session-store-fixture.mjs`.

## Sibling Search

- same layer: acceptance contract cases | use one converged-root wrapper.
- same layer: release-input contract cases | use one converged-root wrapper.
- abstraction up: Protocol pin contract | prove converged and diverged fixtures,
  not live readiness.
- specialization down: package/native release positives | retain live root and
  release-tier ownership.
- cross-file: duplicated client-session release fixtures | extract one shared
  writer; retain distinct release assertions.

## Seam Risk

- Interrupt ID: protocol-divergence-contract-shadowing
- Risk Class: test-seam
- Seam: contract fixtures to production shippability guards.
- Disproving Observation: a contract behavior case depends on live checkout
  readiness, or a live ship-facing path succeeds while pin and lock diverge.
- What Local Reasoning Cannot Prove: the identity or timing of the future signed
  Gateway handoff.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: implementation proof
- Handoff Artifact: charness-artifacts/spec/2026-08-11-pre-handoff-worker-closeout.md

## Prevention

Keep live checkout readiness in release-tier positives. Contract tests may call
the same production guards only through honest converged/diverged repository
fixtures, never a bypass flag or mocked shippability result.
