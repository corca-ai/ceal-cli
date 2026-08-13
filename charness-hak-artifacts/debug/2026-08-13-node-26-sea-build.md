# Node 26 SEA Build Debug
Date: 2026-08-13

## Problem

`env TMPDIR=/tmp npm run check` fails while building the native worker artifact on Homebrew Node 26 after unit and contract tiers pass.

## Correct Behavior

Given a supported local Node toolchain, when the release test builds the worker SEA, then it creates, injects, signs, and smokes the artifact or reports the exact failing producer command.

## Observed Facts

- Node is v26.5.0 and advertises both `--build-sea` and `--experimental-sea-config`.
- Homebrew Node is dynamically linked to `@rpath/libnode.147.dylib`.
- The release test reports a native artifact failure; the exact internal failing stage was not independently proven.

## Reproduction

- `env TMPDIR=/tmp node --test --test-name-pattern="native worker artifact consumes" test/worker-native-artifact.test.mjs`

## Candidate Causes

- Node 26 changed the SEA config schema or preferred build command.
- Blob creation succeeds but the copied dynamic executable cannot be injected or smoked without `libnode`.
- The outer error wrapper suppresses the stage and stderr needed to distinguish the two.

## Hypothesis

- The host cannot satisfy the self-contained-runtime proof precondition; strict proof mode must reject any skip. | disconfirmer: run with `CEAL_REQUIRE_PLATFORM_PROOFS=1` and require failure.

## Verification

- `process.config.variables.node_shared` is true on the failing Homebrew Node. Its executable links `@rpath/libnode.147.dylib`.
- Ordinary mode explicitly declares the unavailable proof; strict proof mode fails closed. The same suite retains injected stage-order and platform tests.

## Root Cause

This host does not satisfy the real SEA proof's self-contained-runtime precondition. The exact internal failing stage remains a non-claim. Shipping the host dylib would weaken the artifact contract.

## Invariant Proof

- Invariant: each native build stage must preserve its stable error code through the final consumer.
- Producer Proof: shared-runtime status comes from Node's own build configuration.
- Final-Consumer Proof: ordinary mode declares the gap; strict mode turns it into a failure.
- Interface-Shape Sibling Scan: injected native-stage tests remain active on every host.
- Non-Claims: Workbench runtime behavior is not implicated.

## Detection Gap

- Release gate fired, but the generic outer wrapper obscured the responsible stage.

## Sibling Search

- Mental model: SEA is a pipeline of config, runtime, injection, signing, and smoke—not one opaque build.
- runtime axis: self-contained versus shared Node | decision: real proof or explicit skip | proof: release suite.
- cross-file: worker native tests inject stage doubles but the real-path test owns end-to-end proof.

## Seam Risk

- Interrupt ID: node26-sea-toolchain
- Risk Class: none
- Seam: Node SEA toolchain
- Disproving Observation: none
- What Local Reasoning Cannot Prove: none
- Generalization Pressure: none

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: impl
- Handoff Artifact: none

## Prevention

Require a self-contained Node executable for real SEA proof; never silently bundle a host package-manager dylib into the release artifact.
