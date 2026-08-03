# V3 Control-Conformance Release Input

## Problem

`ceal-v0.72.5` reached the worker release build matrix but its linux-arm64
compose step rejected the signed Gateway v0.72.3 handoff. The release-input
resolver accepted only the retired v1 control-conformance schema, while the
locked artifact carries v3.

## Capability Contract

A worker release must consume the exact signed Gateway handoff named by its
lock when the control-conformance sidecar uses a schema with the unchanged
source-identity envelope.

## Current Slice

Accept v1 and v3 control-conformance envelopes, retain byte and producer
identity binding, and prove v3 locally before cutting a replacement tag.

## Fixed Decisions

- v3 is accepted because it adds reply-control vectors but retains `source`
  identity (`repository`, `commit`, `tree`, `protocol_tree`).
- Unknown schemas, including v2, remain fail-closed.
- The release workflow remains the multi-platform publisher; no ARM exception
  or skipped compose is allowed.

## Probe Questions

- None for this slice; the signed v0.72.3 packet establishes the actual v3
  envelope consumed by the release lane.

## Deferred Decisions

- A generic version-negotiation field for future control-conformance schemas.

## Non-Goals

- Interpret the Gateway-owned v3 vectors in ceal-cli.
- Change Gateway handoff bytes, protocol pin, or release permissions.

## Deliberately Not Doing

- Accept every `*.vN` schema by prefix: that would turn an unknown envelope
  into a silently trusted release input.

## Constraints

- Archive manifest digest, sidecar bytes, producer identity, and protocol tree
  must remain bound exactly as before.
- A burned immutable v0.72.5 tag cannot be reused; the repair requires a new
  worker version and tag.

## Success Criteria

- `ceal.gateway_leased_consumer_control_conformance_handoff.v3` with the same
  producer identity resolves successfully. (Verification type: unit)
- An unrecognized control-conformance schema is refused. (Verification type: unit)
- The actual locked v0.72.3 archive composes locally for this host platform.
  (Verification type: integration)

## Acceptance Checks

- `node --test test/contract/worker-release-inputs.test.mjs` (Verification type: unit)
- `node scripts/build-worker-release-assets.mjs compose ...locked archive...`
  (Verification type: integration)

## Boundary Ownership

- Gateway owns the conformance schema and signed archive; ceal-cli owns its
  allowlist and release-input validation.

## Critique

- Interrupt Source: `charness-artifacts/debug/latest.md` external release seam.
- Seam Summary: Gateway v3 artifact reached final worker release composition
  after source tests covered only a v1 fixture.
- Chosen Next Step: bounded allowlist plus exact v3 fixture and real-archive
  local composition.
- Impl Status: ready.
- Impl Status Reason: the actual sidecar proves the v3 envelope is unchanged.
- What Disproving Observation Is Resolved: the failing job reports
  `invalid_control_conformance` before any platform-native build.

## Canonical Artifact

This document and the v3 fixture test are canonical for this slice.

## First Implementation Slice

Replace the singular v1 constant with an explicit v1/v3 allowlist and add the
accept/reject contract cases.
