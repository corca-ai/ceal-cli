# Result-Control v2 Worker Carrier

## Problem

The signed Gateway protocol handoff exposes a bounded result-control grammar,
but the installed worker's private control carrier still accepts only v1
status-only frames. Updating a single layer creates a generator/runtime split
that fails closed, so no valid v2 release can be assembled.

## Capability Contract

The private Worker-to-Gateway carrier accepts exactly the five fixed operations
using `ceal.leased_consumer_result_control_request.v2` and returns exactly
`ceal.leased_consumer_result_control_response.v2`. It retains the fixed UDS
path, five route mapping, FD 4 credential custody, 8 KiB session cap, 32 KiB
frame cap, serial transport, and no-public-command boundary.

## Current Slice

Synchronize the v2 schema pair through the checked contract, generator,
generated mirror, runtime decoder, release packaging checks, and private UDS
fixture. This is an artifact-consumer slice only; Gateway serving composition
and Agent invocation follow separately.

## Fixed Decisions

- Use the already released protocol v2 schema pair; introduce no private
  schema, endpoint, or compatibility fallback.
- v1 frames are refused by this v2 carrier rather than interpreted as a
  successful status-only response.
- The checked generator remains the sole producer of embedded contract bytes.
- A result is valid only under the protocol decoder's 24 KiB bounded result
  grammar; the worker does not project, persist, or render it.

## Probe Questions

- Whether the Gateway v2 dispatcher can perform one fenced result write is a
  Gateway-owned follow-on and is not answered by the carrier fixture.

## Deferred Decisions

- Agent behavior for choosing delegated read calls and all audience delivery.
- Service registration, supervisor launch, Gateway apply, and live provider
  proof.

## Non-Goals

- No public CLI command, public API, new socket route, credential export, or
  Agent effect API.
- No source fallback, direct Gateway HTTP fallback, or v1/v2 downgrade retry.

## Deliberately Not Doing

- Do not edit generated contract source directly.
- Do not claim that a v2 release proves Gateway serving, provider execution, or
  a user-visible Agent response.

## Constraints

- The grammar pair must be exact and move atomically in the checked contract,
  generator expectation, embedded assertion, and tests.
- Existing release manifest merge checks must bind identical contract bytes on
  every platform.
- The protocol handoff identity remains `gateway-protocol-handoff-v0.71.8`.

## Success Criteria

1. Root generation accepts only the exact v2 pair and rejects a mixed pair.
2. The private session decodes v2 requests/responses and forwards only its five
   fixed UDS paths with the protected credential.
3. A result-bearing `call` response reaches the private NDJSON consumer, while
   malformed or v1 Agent frames cause no request/output.
4. Native/release contract tests bind the generated v2 bytes without drift.

## Acceptance Checks

- `unit` — focused worker control-session test includes a result `call` frame
  and rejects v1/malformed frames before socket I/O.
- `unit` — generator contract test accepts the exact v2 pair and rejects a
  mixed request/response pair.
- `integration` — root `npm run build:worker` reaches generated mirror and
  worker test package.
- `specdown` — protocol identity and non-claims remain in the checked contract.

## Boundary Ownership

The worker owns framing, fixed transport, and release embedding. The Gateway
owns authentication, dynamic authority, connector invocation, result custody,
and the one-write exchange. The Agent owns neither Gateway credentials nor an
arbitrary UDS route.

## Critique

- Interrupt Source: `charness-artifacts/debug/2026-08-01-result-control-contract-generation.md`.
- Seam Summary: generated release bytes can drift from protocol grammar unless
  the producer and final runtime consumer move together.
- Chosen Next Step: implement the atomic v2 contract transition, then request a
  fresh-eye cross-boundary review before release.
- Impl Status: ready.
- Impl Status Reason: protocol v2 decoders are already present and the exact
  contract location, generator guard, runtime consumer, and fixture are known.
- What Disproving Observation Is Resolved: the generator's v1-only guard, not
  missing protocol exports, caused the observed stop.

## Canonical Artifact

This file plus the checked
`packages/ceal-worker-cli/leased-consumer-control-session-contract.json` are
the current implementation contract.

## First Implementation Slice

Teach the generator and embedded runtime assertion the exact v2 pair, regenerate
the source, and extend the private-session and release-input tests for v2 and
mixed-pair refusal.
