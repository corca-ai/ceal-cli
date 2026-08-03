# V3 Control-Conformance Release Input Debug
Date: 2026-08-03

## Problem

The immutable `ceal-v0.72.5` release tag failed on linux-arm64 before native
build: the locked Gateway v0.72.3 handoff was rejected as
`invalid_control_conformance`.

## Correct Behavior

Given the signed v0.72.3 handoff has a v3 control-conformance sidecar with the
same source-identity envelope, when a worker release composes from that archive,
then it accepts the packet while refusing unknown schemas and identity drift.

## Observed Facts

- Release job `30799919391`, arm job `91641895785`, failed in 11 seconds at
  asset composition, before native compilation.
- Its log reports `Gateway control conformance does not bind the handoff
  producer identity.`
- The downloaded sidecar is schema `ceal.gateway_leased_consumer_control_conformance_handoff.v3`
  and declares the lock's Gateway commit/tree/protocol tree.
- `worker-release-inputs.mjs` accepted only schema v1, so it rejected v3 before
  reaching its existing producer-identity comparison.

## Reproduction

- Download the lock-bound archive and run `build-worker-release-assets.mjs
  compose` for `linux-arm64`; before the repair it returns
  `invalid_control_conformance`.

## Candidate Causes

- The signed archive sidecar has a mismatched producer identity.
- The lock points at a stale or malformed Gateway archive.
- The worker's fixed v1 schema allowlist rejects a valid v3 identity envelope.

## Hypothesis

- The singular v1 allowlist is the cause; accepting explicit v3 while retaining
  all byte and identity checks lets the same archive compose.
- disconfirmer: inspect the sidecar identity and retry composition after only
  that allowlist change.

## Verification

- Confirmed: sidecar source equals handoff producer; targeted v3 fixture passes
  and unknown v2 remains rejected.
- Confirmed: actual locked archive composes locally on linux-arm64 after the
  change.

## Root Cause

The worker had correctly made the control-conformance member identity-bound,
but encoded that validation as a retired v1 schema singleton. Gateway evolved
the sidecar to v3 without changing its identity envelope; the consumer's
acceptance boundary did not evolve with the new released handoff.

## Invariant Proof

- Invariant: when the Gateway ships a recognized control-conformance schema,
  the worker release resolver must bind its bytes and source identity before
  composing a native artifact.
- Producer Proof: locked v0.72.3 sidecar and handoff manifest declare identical
  commit/tree/protocol tree.
- Final-Consumer Proof: local `build-worker-release-assets.mjs compose` reaches
  a linux-arm64 artifact from that exact archive.
- Interface-Shape Sibling Scan: protocol provenance uses the same identity
  envelope and remains independently bound; unknown control schemas stay refused.
- Non-Claims: this does not prove a signed replacement release or live install.

## Detection Gap

- Release-input contract tests | only generated v1 control fixtures | add a v3
  accept case and real locked-archive compose before the next tag.

## Sibling Search

- Mental model: sidecar schema versions remain v1 because the worker does not
  interpret their vectors.
- control-conformance axis: release-input validator | decision: explicit v1/v3
  allowlist | proof: fixture plus actual archive compose.
- provenance axis: protocol provenance validator | decision: unchanged because
  its artifact schema is still v1 | proof: archive inspection.
- cross-file: `.github/workflows/ceal-release.yml` | decision: retain compose
  on every platform rather than skip ARM | proof: failed job was caught early.

## Seam Risk

- Interrupt ID: v3-control-conformance-release-input
- Risk Class: external-seam, repeated-symptom
- Seam: Gateway signed handoff -> worker release-input validator -> platform asset composer.
- Disproving Observation: a v3 sidecar changes the identity envelope or an
  actual locked archive still fails after explicit v3 acceptance.
- What Local Reasoning Cannot Prove: signed replacement release on all platforms.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-08-03-v3-control-conformance-release-input.md

## Prevention

Keep control schema acceptance explicit and contract-test every released
envelope; use the lock-bound archive in a local compose probe before spending an
immutable tag.
