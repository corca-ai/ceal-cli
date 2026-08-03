# Code Critique: Personal-Client Refresh Quarantine

## Execution

Three bounded fresh-eye passes over the pending worker refresh change: problem
framing and producer ownership, persistence/atomicity, and counterweight.

## Fresh-Eye Satisfaction

parent-delegated

## Packet Consumed

n/a (no adapter sections)

## Target

Code critique.

## Change

Before sending a one-time personal-client refresh credential, persist an
`outcome_unknown` quarantine marker. Refuse later refresh attempts from that
state, preserve typed Gateway denials, and clear the marker only after a
validated rotated session is durably saved.

## Capability at Stake

An employee must never be advised to replay a credential when Gateway may
already have consumed it and treats replay as family-revoking hostile reuse.

## Diff Scope

The worker session refresh and persisted profile-store schemas gain a narrow
v2 quarantine state, with CLI and cross-process tests. The Gateway v1 refresh
wire shape is unchanged.

## Findings

- The first candidate repair changed only the retry message. Fresh-eye review
  correctly found that a later invocation would still send the old credential.
  The final diff uses a durable pre-send marker instead.
- A second candidate persisted the marker after the network call. Fresh-eye
  review correctly found the crash window remained; the final diff writes it
  before sending and fails closed if that write fails.
- Explicit Gateway denials must remain distinguishable from unknown outcomes.
  The final diff retains their typed reason in the marker and reports that
  reason without another provider call.
- Verified-by-reading: the producer remains the correct authority for an
  eventual idempotent recovery protocol. The worker cannot safely invent a
  v1 recovery handle.

## Counterweight Triage

- Act Before Ship: empty. The pending diff now proves pre-send persistence,
  zero provider calls after persistence failure, no second refresh across a
  separately started packaged worker, typed-denial preservation, and clearing
  the marker on a validated rotation.
- Bundle Anyway: retain the explicit v2 schema label and exact allow-list for
  blocked reasons; both make unknown persisted data fail closed without
  expanding the wire contract.
- Over-Worry: do not implement speculative client-side token reconstruction,
  automatic reenrollment, or a broad session-store migration in this slice.
- Valid but Defer: version the Gateway recovery protocol around an opaque
  request attempt and an idempotent result lookup; `cealctl` parity belongs in
  its own administrative-token slice.

## Defect Class Cross-Link

`charness-artifacts/debug/2026-08-03-refresh-rotation-unknown-outcome.md` —
unknown remote mutation outcome was classified as retryable transport failure.

## Deliberately Not Doing

Do not claim that this worker change recovers a lost successful rotation, or
that it proves a released artifact or live Gateway path. It prevents the
dangerous replay until the producer supplies a versioned recovery contract.

## Next Move

Commit this worker safety slice with its producer/consumer specifications.
Batch the release with the other onboarding and repository-cutover changes;
then repeat a real device flow before claiming live remediation.
