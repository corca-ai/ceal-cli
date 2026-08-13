# Full Gate Fixture Debug
Date: 2026-08-13

## Problem

`env TMPDIR=/tmp npm run check:unit` passes worker tests but fails contract tests in release-package fixture packing and staged probe execution.

## Correct Behavior

Given a clean built repository, when the unit/contract gate runs, then package fixtures expose the packed filename and staged read-only probes emit their declared output.

## Observed Facts

- Two bootstrap tests throw while reading `packument.files[0].filename`.
- Two staged probe tests receive empty stdout where guide/status YAML is expected.
- Focused observer tests pass; these failures reproduce without the observer tests selected.

## Reproduction

- `env TMPDIR=/tmp node --test test/contract/gateway-handoff-bootstrap.test.mjs test/contract/probe-surface.test.mjs`

## Candidate Causes

- Current npm version changed `npm pack --json` output or fixture parsing assumptions.
- Concurrent package builds/packing share `dist` state and race.
- Staged probe fixture launches a package whose bin metadata or generated path is missing.

## Hypothesis

- The release fixture assumes a package-manager output field that is absent in this environment; if true, capturing raw pack JSON will show a different output shape before any repair. | disconfirmer: run both flag positions and inspect structured stdout.

## Verification

- `npm pack --json` on npm 12 produced no stdout; `npm --json pack` produced a package-name keyed object.
- The staged Node process reported `Library not loaded: @rpath/libnode.147.dylib`.
- After repair, the focused contract reproduction and `env TMPDIR=/tmp npm run check:unit` passed.

## Root Cause

npm 12 moved JSON handling to a global option and changed the output from an array to a keyed object. Separately, Homebrew Node 26 is dynamically linked and cannot execute after copying only the binary away from its sibling `libnode` search path.

## Invariant Proof

- Invariant: a built package fixture must resolve one existing archive before any consumer probe starts.
- Producer Proof: the decoder accepts legacy arrays and npm 12 keyed objects; the staged runtime includes the Homebrew shared library on macOS.
- Final-Consumer Proof: bootstrap packing and both local-write staged probe consumers pass.
- Interface-Shape Sibling Scan: every repo-owned `npm pack --json` consumer was moved to the shared decoder.
- Non-Claims: observer behavior is not implicated by current evidence.

## Detection Gap

- The full contract gate fired. Added decoder-shape tests so future npm output drift fails at the owning boundary.

## Sibling Search

- Mental model: package-manager structured output is an external seam and must be decoded from observed shape.
- package fixture axis: all pack consumers | decision: shared dual-shape decoder | proof: focused and full contract gates.
- cross-file: staged release fixture and package fixture share the built archive boundary.

## Seam Risk

- Interrupt ID: npm-pack-structured-output
- Risk Class: none
- Seam: npm package-manager output to test fixture
- Disproving Observation: none
- What Local Reasoning Cannot Prove: none
- Generalization Pressure: none

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: impl
- Handoff Artifact: none

## Prevention

Keep package-manager output decoding in one helper and stage the runtime dependency required by the exact executable under test.
