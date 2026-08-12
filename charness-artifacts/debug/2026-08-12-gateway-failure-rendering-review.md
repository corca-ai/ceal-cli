# Gateway Failure Rendering Debug Review
Date: 2026-08-12

## Problem

The new generic Gateway failure relay (`f88f940`) erased authorization status
for several existing failures and discarded a safe dynamic message whenever the
optional `next_action` field was absent.

## Correct Behavior

Given a decoded Gateway failure, the Worker preserves each safe presentation
field independently, applies a local fallback only to the absent or unsafe
field, and keeps denial classification separate from wording.

## Observed Facts

- Protocol makes `error.message` required but `error.next_action` optional:
  `packages/ceal-protocol/src/gateway-response-types.ts` and `src/index.ts`.
- `f88f940` required both fields in `gatewayFailurePresentation`, so a legal
  message-only response emitted generic prose.
- It also reduced `denial` to `policy_denied`; prior code classified
  authentication, Profile, and ungranted-target rejection as denials.
- The live full gate remains independently refused by the declared Protocol
  shipment divergence, not this path.

## Reproduction

- Before repair, `classifyGatewayFailure({ code: "duplicate_write_refused",
  message: "...message:already-sent_001" })` discarded that message.
- Before repair, a `target_catalog_capability_not_granted` targets response
  emitted `status: unavailable`, rather than the prior `denied`.

## Candidate Causes

- The prose-table deletion also deleted the unrelated classification facts.
- The renderer treated optional presentation fields as an all-or-nothing pair.
- Protocol decoding might have failed to retain the optional field.

## Hypothesis

- The first two causes are correct; a field-independent safe-text accessor and
  compact code/recovery classification restore the output. | disconfirmer: run
  HTTP Gateway fixtures with an optional action and denied target response.

## Verification

- Confirmed: Worker CLI build and all 151 CLI tests pass after the focused
  repair; fixtures cover exact duplicate ref, independent optional fields,
  unsafe fallback, denial status, and recovery classification.

## Root Cause

One old structure carried two facts: local prose and error disposition. The
cleanup correctly removed local prose but accidentally removed disposition;
separately, its new all-or-nothing field projection contradicted Protocol
optionality.

## Invariant Proof

- Invariant: when Protocol emits safe failure presentation and disposition,
  Worker YAML preserves both before a caller chooses a retry or interprets
  availability.
- Producer Proof: Protocol validates and retains `message`, optional
  `next_action`, and closed `recovery.kind`.
- Final-Consumer Proof: local HTTP Gateway-to-CLI YAML tests assert duplicate
  message/action and target `denied` output.
- Interface-Shape Sibling Scan: call, capabilities, receipt, and acceptance
  share `classifyGatewayFailure`; session-refresh overrides remain intentional.
- Non-Claims: no live Gateway response, signed release, or provider action was
  observed.

## Detection Gap

- CLI tests proved text relay but the simplification removed the target status
  assertion and lacked a message-only HTTP response. Restored both targeted
  assertions make this failure observable in `npm run check:unit`.

## Sibling Search

- Mental model: presentation, classification, and retry metadata are separate
  failure facets, not one legacy table.
- same layer: call/capabilities | shared classifier | focused CLI proof.
- abstraction up: Protocol optional/closed fields | consume unchanged | source
  and decoder tests.
- cross-file: receipt/acceptance | shared classification | existing route
  writers preserve their intentional session-refresh override.

## Seam Risk

- Interrupt ID: gateway-failure-projection
- Risk Class: external-seam
- Seam: Protocol failure envelope to Worker YAML result.
- Disproving Observation: an allowed decoded failure loses safe text or a known
  denial emits availability after the repaired tests.
- What Local Reasoning Cannot Prove: Gateway production wording or write state.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-08-12-gateway-failure-rendering-review.md

## Prevention

Keep failure wording, disposition, and optional metadata independently tested;
removing a local message owner must not collapse Gateway-owned classification.
