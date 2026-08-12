# Gateway Failure Fallback Action Debug
Date: 2026-08-12

## Problem

The field-independent fallback fixed a missing optional `next_action`, but its
generic action still tells callers to retry with a new request ID. A legal
write refusal with no Gateway action can therefore receive ungrounded retry
advice.

## Correct Behavior

Given a decoded write failure whose `next_action` is absent or unsafe, the CLI
must preserve any safe message but tell the caller to inspect Gateway status
and audit readback before deciding whether to retry.

## Observed Facts

- Protocol permits `error.next_action` to be absent.
- `gatewayFailureText` correctly falls back per field.
- Its fallback says "retry with a new request ID" for every code, including
  `duplicate_write_refused`.
- `call` is the final YAML surface using this shared classification.
- The exported call renderer also accepts `unknown` failure and proof-ref input;
  it cannot rely solely on the HTTP Protocol decoder for redaction.

## Reproduction

- `classifyGatewayFailure({ code: "duplicate_write_refused", message: "safe" })`
  produces a next action that recommends a new request ID.

## Candidate Causes

- The legacy generic action was copied unchanged when fallback became per-field.
- The renderer lacks a distinction between safe fallback and retry authorization.
- Protocol might require the missing action for duplicate-write failures.

## Hypothesis

- The first two causes are correct: changing only the generic fallback to
  readback-first guidance removes unauthorized retry advice.
- disconfirmer: assert the exact current classifier action for a message-only refusal.

## Verification

- Confirmed: source search finds one production fallback and the existing
  message-only HTTP fixture renders it for `ceal call`.

## Root Cause

The initial repair treated an absent action as a presentation problem only. For
writes, action text also carries retry authority; a generic retry instruction
is not a safe substitute for Gateway-authored guidance.

The initial direct-renderer test guarded only text. Code and proof references
needed the same defense; the Worker now binds its safe proof-ref predicate to
Protocol behavior while retaining valid opaque refs.

The same direct boundary initially accepted an unbounded `retry_after_ms`; it
now applies the Protocol's one-hour maximum before rendering YAML, with a
contract binding that compares the two declarations.

## Invariant Proof

- Invariant: when Gateway omits retry guidance, Worker must not create retry
  authorization before the call YAML reaches its operator.
- Producer Proof: Protocol allows optional `next_action`.
- Final-Consumer Proof: CLI HTTP fixture emits the classifier's fallback in
  `error.next_action`; direct renderer tests prove unsafe code/proof refs do
  not enter its YAML envelope.
- Interface-Shape Sibling Scan: call, capabilities, receipt, and acceptance
  share the fallback; a neutral action is safe on all four surfaces.
- Non-Claims: no live Gateway write or provider state was observed.

## Detection Gap

- `packages/ceal-worker-cli/test/cli.test.mjs` | message-only coverage asserted
  the old retry prose and bypassed code/proof fields | assert readback-first
  fallback and serialized direct-renderer redaction.

## Sibling Search

- Mental model: missing recovery detail may be filled with a locally plausible
  action; it cannot when that action authorizes a write retry.
- same layer: `classifyGatewayFailure` | same bug, fix now | proof: local payload.
- same layer: `writeCallGatewayFailure` | same bug, fix now | proof: local YAML.
- abstraction up: receipt/acceptance/capabilities shared classifier | same class,
  diagnostic-only for this slice because the neutral fallback is shared | proof: static scan.
- cross-file: `packages/ceal-worker-cli/src/index.ts` consumes the shared action.

## Seam Risk

- Interrupt ID: gateway-failure-fallback-action
- Risk Class: external-seam
- Seam: Gateway failure envelope through Worker guidance to CLI YAML.
- Disproving Observation: Protocol requires an action for duplicate-write refusal.
- What Local Reasoning Cannot Prove: Gateway production retry semantics.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-08-12-gateway-failure-rendering-review.md

## Prevention

Keep local fallback guidance observational; only Gateway-provided safe text may
authorize or describe a recovery for a governed write. Bind direct renderer
reference validation to frozen Protocol behavior instead of treating all opaque
references as unsafe text.
