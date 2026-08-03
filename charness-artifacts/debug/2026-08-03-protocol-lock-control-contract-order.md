# Protocol Lock / Control Contract Ordering Debug
Date: 2026-08-03

## Problem

Synchronizing the signed Gateway Protocol handoff to 0.72.4 initially made
`generate-leased-consumer-handoff-runtime.mjs` return
`invalid_control_session_contract`.

## Correct Behavior

Given a reviewed handoff lock, when the frozen Protocol copy and the private
control-session contract are updated together, then the generator should embed
the same lock identity and the vendor-pin gate should pass after that coherent
state is committed.

## Observed Facts

- The signed archive verified with the tag-bound Sigstore identity and declares
  Gateway commit `c3f2df48`, Protocol tree `2fe207f7`, and archive digest
  `5cdd0b7b`.
- The control-session contract still named the prior 0.72.3 lock, so its exact
  lock comparison rejected the mixed state.
- The vendor-pin validator deliberately hashes `HEAD:packages/ceal-protocol`,
  not an uncommitted frozen copy.

## Reproduction

- Update `gateway-protocol-handoff-lock.json` without its paired control
  contract, then run `node scripts/generate-leased-consumer-handoff-runtime.mjs`.

## Candidate Causes

- The control contract was not updated with the lock.
- The generator accepted an unsafe mixed producer identity.
- The vendored Protocol tree was allowed to pass before a committed pin.

## Hypothesis

- The strict failures are intentional coherence guards, not an archive or
  runtime fault; updating the paired contract and committing the frozen vendor
  pin should make both checks pass. | disconfirmer: run the generator after the
  paired update, then run the vendor-pin gate from the resulting commit.

## Verification

- Confirmed: the paired contract update made the generator succeed; the
  remaining vendor-pin failure reports the expected pre-commit `HEAD` tree.

## Root Cause

The sync sequence transiently mixed a new signed handoff lock with an old
embedded control-contract identity. The contract is intentionally exact and
the frozen-copy gate intentionally evaluates committed source state.

## Invariant Proof

- Invariant: the release embeds one reviewed Gateway handoff identity in its
  lock, private control contract, and frozen Protocol source.
- Producer Proof: the archive's manifest, provenance, and Sigstore identity
  agree on the 0.72.4 producer identity.
- Final-Consumer Proof: generator succeeds only after the contract names that
  identity; the vendor gate will be rerun after commit.
- Interface-Shape Sibling Scan: lock and contract both carry the same four
  identity fields; the generated TypeScript is regenerated from the contract.
- Non-Claims: this proves no worker release, install, or live Gateway apply.

## Detection Gap

- Sync procedure | did not state the contract-before-generator ordering | add
  the coherent-slice sequence to the release handoff documentation.

## Sibling Search

- Mental model: a signed handoff is a release input tuple, not a lone archive.
- contract identity axis: `leased-consumer-control-session-contract.json` |
  decision: synchronize | proof: generator exact comparison.
- frozen source axis: `protocol-vendor-pin.json` |
  decision: synchronize and commit | proof: `HEAD` tree gate.
- cross-file: release workflow literals must match the lock and are covered by
  contract tests.

## Seam Risk

- Interrupt ID: protocol-handoff-coherence
- Risk Class: external-seam
- Seam: Gateway signed archive to worker release input.
- Disproving Observation: archive and its declared lock identity disagree.
- What Local Reasoning Cannot Prove: future origin availability or live apply.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-08-03-v3-control-conformance-release-input.md

## Prevention

Keep lock, vendor pin, frozen source, embedded control contract, generated
source, and workflow literals in one committed consumption slice; only then run
the `HEAD`-based vendor gate.
