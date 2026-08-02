# Code Critique: Adoption Clock-Skew Worker Fix

## Execution

Three independent bounded reviews of the pending worker diff: protocol/security,
operator behavior, and counterweight.

## Fresh-Eye Satisfaction

parent-delegated

## Packet Consumed

n/a (no adapter sections)

## Target

Code critique.

## Change

Replace cross-machine absolute expiry comparison with a 35-minute monotonic
local liveness cap; render normal expiry only from Gateway terminal poll status.

## Findings

- Act Before Ship: prove that a skewed client performs a subsequent poll and
  honors Gateway `expired`; added the focused regression test.
- Bundle Anyway: the change does not weaken HPKE, transaction, key, or session
  binding; Gateway still enforces expiry before sealing.
- Over-Worry: a client-side expiry countdown is neither needed nor safe as a
  lifecycle authority.
- Valid but Defer: adding a safe transaction diagnostic to `wait_timeout`
  needs a separate output-minimization decision.

## Deliberately Not Doing

Do not change the Gateway TTL or remove explicit mailbox confirmation.

## Next Move

Release one signed worker artifact and repeat fresh Narnia adoption.
