# Adoption Clock-Skew Expiry Debug
Date: 2026-08-02

## Problem

On Narnia, a fresh `ceal session adopt` was browser-confirmed but the worker
returned `status: expired` without writing a session.

## Correct Behavior

Given a Gateway challenge that is pending and then mailbox-confirmed, when a
device has a skewed wall clock, then the worker polls again and accepts the
Gateway's sealed delivery. Only the Gateway's terminal `expired` result is a
normal adoption expiry.

## Observed Facts

- Gateway transaction `adoption:709b7a...` was created at
  `2026-08-02T12:09:40.159Z`, expires at `12:39:40.159Z`, and its mailbox was
  confirmed at `12:09:54.451Z`.
- The old worker computed `min(challenge.expires_at, local-now + 15m)` and
  returned its own `expired` before the next poll when `local-now + retry`
  exceeded that absolute deadline.
- The Gateway poll coordinator independently enforces the challenge record and
  returns `failed: expired` only after its own authority rejects the poll.

## Reproduction

- Unit: inject a client wall clock 40 minutes ahead of the Gateway challenge.
  The old local deadline branch rejects at the first pending response; the
  repaired worker sleeps the Gateway interval and completes a sealed delivery.

## Candidate Causes

- The Gateway transaction expired before browser confirmation.
- Narnia's wall clock was ahead of the Gateway.
- A client-side deadline confused a local clock with Gateway authority.

## Hypothesis

- A cross-machine absolute-time comparison is sufficient to produce the
  observed false expiry. Disconfirmer: with +40-minute skew, a repaired worker
  still emits local `expired` before its second poll.

## Verification

- Confirmed locally: the new skew test completes adoption; a second test proves
  that after pending the worker makes a second poll and renders the Gateway's
  `expired` without storing a session.
- `npm run check:unit` passed after the change.

## Root Cause

The worker made an authorization/lifecycle decision using its own wall clock
against a timestamp issued by a different host. The Gateway already owns the
expiry state and exposes it through the proof-bound poll protocol.

## Invariant Proof

- Invariant: when the Gateway emits a terminal adoption status, the worker must
  surface that status before it can report normal completion or expiry.
- Producer Proof: Gateway poll coordinator reads challenge/verifier state and
  returns `failed: expired` for its own expired record.
- Final-Consumer Proof: worker tests prove a skewed client makes the terminal
  second poll, renders Gateway `expired`, and leaves session storage empty.
- Interface-Shape Sibling Scan: ordinary request timeouts remain transport
  failures; only adoption mixed a remote absolute expiry with a local clock.
- Non-Claims: this does not independently measure Narnia's wall-clock offset;
  it removes the erroneous dependency on that offset.

## Detection Gap

- Adoption unit tests | used one shared clock for client and Gateway | inject
  divergent wall and monotonic clocks plus a terminal Gateway expiry test.

## Sibling Search

- Mental model: an absolute timestamp is safely comparable across hosts.
- lifecycle axis: Gateway challenge versus worker wait | decision: Gateway owns
  expiry; worker owns only monotonic liveness bound | proof: new unit tests.
- transport axis: pending versus unreachable Gateway | decision: preserve
  existing transport timeout; use `wait_timeout` only for repeated pending |
  proof: existing transport tests plus worker test.
- no cross-file sibling: other session lifetimes are locally issued/stored or
  already decided by typed Gateway responses.

## Seam Risk

- Interrupt ID: adoption-gateway-clock-authority
- Risk Class: external-seam, repeated-symptom
- Seam: Gateway-issued timestamp -> independently clocked worker -> user-visible
  terminal outcome.
- Disproving Observation: a released worker still emits local expiry before a
  terminal Gateway poll on a skewed Narnia host.
- What Local Reasoning Cannot Prove: release installation and fresh Narnia live
  adoption.
- Generalization Pressure: monitor

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-08-02-adoption-clock-authority.md

## Prevention

Use monotonic elapsed time only for local liveness limits. Let the issuer of a
remote lifecycle timestamp return its terminal state; never turn a separate
machine's wall-clock reading into that authority.
