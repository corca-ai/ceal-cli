# Gateway Failure Recovery Normalization Debug
Date: 2026-08-12

## Problem

The exported Worker failure renderer accepted malformed `recovery` fields from
direct `unknown` callers and used their partial semantics to report a denial or
retry time that Protocol would reject.

## Correct Behavior

Given a direct failure input with malformed or unknown recovery semantics, the
Worker must treat recovery as absent. Given a decoded valid recovery, it must
preserve its authorized denial class and bounded retry time.

## Observed Facts

- Protocol accepts only its closed recovery kind vocabulary and a nonnegative,
  bounded integer wait.
- The direct renderer separately read `recovery.kind` for denial and
  `retry_after_ms` for pacing.
- Before repair, an invalid wait plus `request_approval` produced `blocked`;
  an unknown kind plus a valid wait emitted that wait.

## Reproduction

- `classifyGatewayFailure({ code: "unknown_gateway_code", message: "safe",
  next_action: "safe", recovery: { kind: "request_approval",
  retry_after_ms: -1 } })` reported a denial before repair.
- Protocol decoding of the matching call response returns
  `invalid_client_response`.

## Candidate Causes

- Direct inputs bypass the HTTP decoder.
- Recovery had two readers rather than one normalized boundary.
- Protocol might permit an invalid wait beside a valid denial kind.

## Hypothesis

- The first two causes are correct: a single semantic recovery normalizer makes
  malformed recovery absent to both readers. | disconfirmer: decode the same
  envelope through Protocol and compare direct classification after repair.

## Verification

- Confirmed: Protocol rejected the `-1` envelope as `invalid_client_response`;
  repaired Worker classification is non-denial and omits retry timing.

## Root Cause

The direct defensive boundary validated the individual values it emitted but
did not validate their shared `recovery` object. A malformed object could thus
combine a denial kind with an invalid wait, or an unrecognized kind with a
valid wait.

The same review found that a partial `policy_denied` error could create a
blocked call even though the Protocol requires its complete response, proof,
and decision envelope. The call projection now recognizes that semantic status
only after its exact envelope validates; a partial policy object stays an error.

The direct boundary also now rejects non-plain records at every interpreted
level and requires a real ordered `non_claims` array instead of trusting a
serialization hook.

## Invariant Proof

- Invariant: when Protocol rejects recovery semantics, direct Worker projection
  must not derive denial or retry output from them.
- Producer Proof: Protocol's failure decoder rejects a malformed recovery.
- Final-Consumer Proof: direct `writeCallGatewayFailure` now emits `error`, not
  `blocked`, and no retry timing for malformed recovery or partial policy;
  a complete plain policy envelope remains blocked. Date-shaped records and a
  `toJSON`-forged `non_claims` value remain errors.
- Interface-Shape Sibling Scan: call, capabilities, receipt, and acceptance
  all consume the shared classification; normalization precedes them all.
- Non-Claims: no live Gateway or provider result was observed.

## Detection Gap

- CLI classifier tests checked invalid waits and valid denial kinds separately.
  Mixed malformed recovery, undeclared recovery keys, and partial policy
  envelopes now assert their final call-YAML projection, including non-plain
  records and forged serialized non-claims.

## Sibling Search

- Mental model: recovery is one typed boundary, not two independent hints.
- same layer: denial and retry readers | fix now | local classifier proof.
- abstraction up: frozen Protocol recovery decoder | consume its public kind
  vocabulary and bound mirror | source/decode proof.
- cross-file: all command writers | shared classifier | direct call-YAML proof.

## Seam Risk

- Interrupt ID: gateway-failure-recovery-normalization
- Risk Class: external-seam
- Seam: Protocol recovery envelope through Worker CLI output.
- Disproving Observation: Protocol accepts a mixed malformed recovery.
- What Local Reasoning Cannot Prove: live Gateway recovery emission.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-08-12-gateway-failure-rendering-review.md

## Prevention

Normalize each structured producer field once before any local output decision;
do not let two consumers independently interpret an untrusted partial object.
