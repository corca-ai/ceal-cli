# Adoption Clock Authority Contract

## Problem

An employee device can have a wall clock ahead of the Gateway. A client-side
comparison of that clock with the Gateway-issued absolute challenge expiry can
misclassify a fresh, confirmed transaction as `expired` before the next poll.

## Capability Contract

`ceal session adopt` must accept a Gateway-issued sealed session after a valid
mailbox confirmation regardless of harmless client/Gateway wall-clock skew,
while keeping Gateway expiry and every delivery binding fail closed.

## Current Slice

Move challenge-expiry authority to the Gateway poll result and bound only an
otherwise endlessly pending local process with a monotonic elapsed-time cap.

## Fixed Decisions

- The Gateway's `failed: expired` poll result is the only normal expiry result
  rendered by the worker.
- The worker does not compare a Gateway absolute timestamp to its wall clock.
- A 35-minute monotonic cap is a distinct `wait_timeout`, not `expired`.

## Non-Goals

- Change Gateway policy TTLs, email verification, HPKE, or device bindings.
- Display a client-side expiry countdown.

## Success Criteria

- Verification type: `unit` — a clock 40 minutes ahead still reaches a sealed
  Gateway delivery after pending.
- Verification type: `unit` — the same skewed client receives `expired` only
  after a subsequent Gateway terminal poll and never stores a session.
- Verification type: `integration` — the worker source gate remains green.
- Verification type: `manual` — a newly released worker completes one fresh
  Narnia adoption, provider read, and receipt readback.

## Boundary Ownership

- Worker CLI: local wait semantics and result rendering.
- Gateway: absolute challenge lifetime and terminal expiry decision.
- Operator: release the signed worker and run the Narnia acceptance retry.

## Critique

Interrupt Source: repeated email-adoption external seam failure.

Seam Summary: Gateway clock and client clock had been treated as one authority.

Chosen Next Step: change the worker to use Gateway terminal status plus a local
monotonic safety cap.

Impl Status: implemented and locally verified.

What Disproving Observation Is Resolved: a +40-minute client skew no longer
causes a local expiry before a second Gateway poll.

## Canonical Artifact

`charness-artifacts/debug/2026-08-02-adoption-clock-skew-expiry.md`

## First Implementation Slice

Release the worker once, then repeat Narnia adoption with a fresh transaction.
