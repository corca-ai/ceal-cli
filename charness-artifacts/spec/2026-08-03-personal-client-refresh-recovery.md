# Personal Client Refresh Recovery Consumer Contract
Date: 2026-08-03

## Problem

The worker cannot distinguish a harmless failed refresh request from a Gateway
rotation that committed before its response was lost.  v1 has no stable recovery
attempt identity.

## Capability Contract

Once the Gateway publishes a versioned idempotent refresh-recovery protocol,
the worker persists one opaque attempt reference under its existing session
lock, sends it with the initial refresh, and accepts only the same recovered
result.  Until then it refuses to recommend reuse of the v1 one-time token.

## Current Slice

The worker's v1 result is now protective: `session_renewal_unavailable` is
non-retryable, directs replacement enrollment, and writes a v2 local
`renewal_blocked_reason` quarantine before the first network send; a failed
quarantine write sends nothing. No automatic recovery is implemented in this
repository yet.

## Fixed Decisions

- Persist the opaque attempt before issuing the network request.
- The v1 quarantine follows the same ordering: persist before the network
  request, or do not send.
- Never log, render, or derive the attempt from bearer material.
- On a matching recovered result, atomically replace the stored session and
  clear the attempt; on a terminal result, retain safe recovery output.
- Keep `refresh_busy` retryable because it is a local pre-request contention.
- Preserve the current access token only until its existing expiry; when a
  refresh is required, the quarantine blocks network refresh before send.

## Probe Questions

- The Gateway-provided recovery route/schema and durable response-retention
  guarantee are prerequisites.  Canonical producer contract:
  `../ceal/charness-artifacts/spec/2026-08-03-personal-client-refresh-recovery.md`.

## Deferred Decisions

- A standalone employee repair command.
- Administrative `cealctl` token parity.

## Non-Goals

- Retrying v1 refresh after an unknown outcome.
- Changing the Gateway's replay-family revocation policy.

## Constraints

- The published v1 decoder enforces exact request keys.
- Worker persistence and refresh run under the current local session lock.

## Success Criteria

- A first-response loss recovers only with the identical persisted attempt.
- A worker cannot generate another rotation during recovery.
- Unknown v1 outcome output never instructs same-command retry.

## Acceptance Checks

- `unit`: durable attempt survives a simulated client restart before recovery.
- `integration`: the matching recovery result writes a valid session exactly
  once; mismatched/terminal results do not.
- `unit`: unknown v1 response is non-retryable and says not to retry.

## Boundary Ownership

- Gateway state and protocol: `corca-ai/ceal` on `vinc`.
- Worker attempt journal and employee result: `corca-ai/ceal-cli`.

## Critique

- Interrupt Source: refresh-rotation unknown-outcome debug.
- Seam Summary: remote commit may precede local durable response persistence.
- Chosen Next Step: wait for the versioned Gateway contract; do not add a
  private retry field to v1.
- Impl Status: protective wording landed locally; recovery not implemented.
- Impl Status Reason: a matching protocol/Gateway recovery result does not
  exist yet.
- What Disproving Observation Is Resolved: none beyond v1 source inspection.

## Canonical Artifact

This is the worker-consumer contract.  The Gateway producer contract is the
linked `ceal` repository artifact above.

## First Implementation Slice

Consume the published recovery decoder, add a locked attempt journal, and test
Gateway-committed/worker-response-lost recovery before enabling retry.
