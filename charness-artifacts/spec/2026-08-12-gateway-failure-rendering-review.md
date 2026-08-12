# Gateway Failure Rendering Review Contract

## Problem

`f88f940` replaced the Worker’s local Gateway error-prose tables with generic
Gateway-authored presentation. Review the changed producer-to-CLI boundary for
real regressions before treating the simplification as closed.

## Capability Contract

When a decoded Gateway failure has safe `message` and `next_action` fields, a
CLI caller receives those exact fields, including an opaque confirmation ref.
Malformed, incomplete, or credential-shaped failures receive only local generic
guidance and never reflect the unsafe text.

## Current Slice

Audit the generic failure renderer, its YAML call output, and its immediately
supporting contract fixtures. Repair only a reproduced local defect.

## Fixed Decisions

- Keep the frozen Protocol package and sibling Gateway source unchanged.
- Keep the local fallback for absent or unsafe presentation; do not reintroduce
  a per-error-code prose table.
- Backward compatibility is not a constraint for this pre-public product.

## Probe Questions

- Does every decoded Gateway failure reach the renderer with both presentation
  fields, and are status/denial semantics still correct?
- Can an unsafe or partial error reach the rendered YAML through a path the
  current duplicate-write fixture does not exercise?
- Do the converged/diverged fixtures still represent the pin guard faithfully?

## Deferred Decisions

- Gateway/Protocol schema changes, leased-Agent rendering, a signed handoff,
  release, installation, or live provider proof.
- Projecting `retry_after_ms` onto capabilities, receipt, and acceptance. Those
  output schemas currently expose it only for `call`; that pre-existing shape
  needs an intentional cross-surface schema decision, not a renderer repair.

## Non-Goals

- Do not clear `proof_shipment_protocol_divergence` or weaken its release gate.
- Do not invent duplicate-confirmation request semantics in this repository.

## Deliberately Not Doing

- No local reconstruction of a dynamic `message_ref` from a Gateway code.
- No broad quality-gate redesign while examining this narrow boundary.

## Constraints

- Every output claim remains bounded by the Protocol decoder and Worker safe
  output policy.
- A local check may establish source behavior only, not a live Gateway result.

## Success Criteria

- A safe duplicate-write response preserves its exact confirmation reference in
  CLI `error.message` and `error.next_action`.
- Unsafe or incomplete error presentation cannot be echoed into YAML.
- Existing status, retry timing, and `policy_denied` classification have a
  focused executable assertion or a documented deliberate result.
- The converged fixture remains a valid contract fixture; a diverged fixture
  still fails before package/acceptance work.

## Acceptance Checks

- `integration`: a local HTTP Gateway fixture drives `ceal call` and asserts the
  exact duplicate-write text and opaque reference in YAML.
- `unit`: classifier cases cover safe, incomplete, and credential-shaped error
  presentation plus retry/denial metadata.
- `integration`: `test/contract/worker-acceptance-packet.test.mjs` proves the
  diverged fixture reaches `proof_shipment_protocol_divergence`.
- `manual`: `npm run check:unit` and `.githooks/pre-push` pass; a full-gate
  failure is acceptable only when it is the declared live pin divergence.

## Boundary Ownership

- Gateway/Protocol owns failure text, duplicate-confirmation semantics, and
  response validation.
- Worker owns safe projection, local fallback, output status, and fixtures.

## Critique

- Interrupt Source: debug planner’s prior release/test seam risk.
- Seam Summary: Gateway failure fields pass through Protocol decoding to Worker
  YAML, while converged fixtures must not accidentally clear the live ship gate.
- Chosen Next Step: focused audit, then a smallest reproduced Worker repair.
- Impl Status: allowed.
- Impl Status Reason: the audit reproduced an optional-field relay defect and
  an authorization-disposition regression; the Worker repair and focused
  HTTP-to-YAML regression tests close both without restoring local prose.
- What Disproving Observation Is Resolved: a local HTTP-to-YAML fixture already
  proves duplicate-reference propagation; the completed audit added partial,
  unsafe, and authorization status coverage.

## Canonical Artifact

This contract and the paired `debug` record for the same review are canonical
until the audit resolves or identifies a concrete repair.

## First Implementation Slice

Add or adjust only the focused regression test and Worker renderer needed for a
confirmed bug; then rerun the iteration gate.
