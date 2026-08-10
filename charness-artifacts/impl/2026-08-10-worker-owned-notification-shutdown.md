# Worker Owned Notification Shutdown Closeout

## Implemented

- The Worker recognizes Node's exact `ERR_STREAM_PREMATURE_CLOSE` only after
  its normal Agent-EOF-owned shutdown latch is set.
- A real child FD5 socketpair proves owned close green and FD5-first EOF red.
- A same-message/wrong-code oracle rejects broad `Error` or human-message
  classification and was proven red by mutation.

## Capability Delivered

The local v5 Worker exits cleanly after one successful active-runner
cancellation while preserving failure for independent notification-channel
termination and unrelated stream errors.

## Contract Source

`charness-artifacts/spec/2026-08-10-worker-owned-notification-shutdown.md`

## Verification

- Pre-fix targeted run: 28/29 passed; the real owned-shutdown arm returned
  `{ "clean": false }`.
- Repaired targeted run: build exit 0; 30 passed and two candidate-only tests
  skipped, including both real FD5 arms and the wrong-code classifier oracle.
- Mutation: accepting every `Error` made the wrong-code oracle red with
  `true !== false`; restoring the exact code made it green.
- Gateway durable jobs
  `s43-worker-shutdown-transport/result.20260810a.json` and
  `s43-worker-shutdown-active/result.20260810a.json` both record child exit 0.
  The active result binds runner-started, one abort, cancelled completion,
  pending-zero, later idle acquire, notification sink close, and Worker exit 0.
- Final local iteration job
  `s43-ceal-cli-worker-shutdown-final-check-unit/result.20260810b.json` records
  child exit 0 on the repaired tree.

## Lint Gate

ran-pass `npm run check:unit`

## Truth Surface Sync

The current contract, critique, this closeout, and `docs/handoff.md` own the
local repair and its next release boundary. The prior immutable v0.76.0 release
record remains unchanged.

## Boundary Ownership

`moved-to-owner` — ceal-cli owns the Worker lifecycle classifier; Gateway and
Agent retain composition/selection and broker-cancellation ownership.

## Critique

Full parent-delegated fresh-eye review found and closed the classifier-mutation
and lint-fixture gaps. The repaired-surface pass found no blocker or should-fix:
`charness-artifacts/critique/2026-08-10-worker-owned-notification-shutdown-code-critique.md`.

## Contract Updates

The contract now records the mutation-red requirement and separates concurrent
channel-loss from the normal owned-shutdown repair.

## Residual Risks

- Concurrent notification and channel-loss abort idempotency remains deferred.
- No signed successor release, stable selection, installed update, Gateway
  apply, provider/Slack roundtrip, latency result, or C11a completion is claimed.

## Next Slice

After separate immutable Worker release approval, run the repo release
procedure, update/read back the installed Worker, then hand the exact signed
identity to Gateway selection and `ceal-dev` apply proof.
