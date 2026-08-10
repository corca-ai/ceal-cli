# Ceal CLI Worker Repair Handoff

## Workflow Trigger

Consume the released Worker-owned notification shutdown repair. The source fix,
immutable Worker release, public signature readback, and installed update are
complete; do not reimplement or republish the repair.

## Continuation Capability

Use signed `ceal-v0.76.1` as the exact Worker identity for Gateway coherent v5
selection. Preserve early-FD5 and unrelated-error failure in any follow-up.

## Current State

- The operator explicitly unfroze ceal-cli for this active-runner shutdown
  repair. The source, real child-FD5 oracle, mutation oracle, spec, and critique
  are locally complete.
- The pre-fix real-socket arm returned `clean:false`. The repaired arm returns
  `clean:true` with empty stderr, while FD5-first EOF and same-message/wrong-code
  errors remain false.
- The final local `check:unit` job is green. Gateway transport-only and active-
  runner durable compositions both reach Worker exit zero against the repaired
  local build; the active result records one abort and cancelled completion.
- Annotated tag `ceal-v0.76.1` resolves to
  `2edf126e1c7bf65900d40b449dce9ea4481c6ce7`; release run `31346152389`
  completed every build, assembly, signing, publication, and stable-pointer
  step.
- Fresh public readback verified all nine checksum-listed assets plus the
  separately signed `SHA256SUMS` against the exact Cosign identity. The public
  `SHA256SUMS` digest is
  `7f5e20c27b539af490fee6f2fe18746853506ac075e8e6d91b462336fe582b4a`.
- Installed `ceal` is `0.76.1`; Linux ARM64 binary digest is
  `5c893c8ab10575eab9da378c85d2ba300d2eb469bd6ed57d5207aae9569cfe04`.
- Gateway selection/apply and live provider/latency proof have not happened.

## Next Session

1. Read the release record and use the exact signed 0.76.1 tuple; do not redo
   release work.
2. Hand the tuple to the Gateway goal for coherent v5 selection, `ceal-dev`
   apply, and configured-channel latency proof.

## Discuss

- Concurrent notification plus channel-loss abort idempotency remains a
  separate non-claim; it does not block the normal owned-shutdown repair.
- The response-latency proof belongs after signed selection and apply. It may
  overlap only disjoint local work and must not overlap another instance
  restart.
- Refresh kept: exact public/install proof state and the next Gateway handoff.
- Refresh non-claims: no Gateway selection/apply, provider/Slack, latency,
  concurrent-close, or C11a completion proof.

## References

- [repair contract](../charness-artifacts/spec/2026-08-10-worker-owned-notification-shutdown.md)
- [implementation closeout](../charness-artifacts/impl/2026-08-10-worker-owned-notification-shutdown.md)
- [code critique](../charness-artifacts/critique/2026-08-10-worker-owned-notification-shutdown-code-critique.md)
- [v0.76.0 release record](../charness-artifacts/release/2026-08-09-ceal-v0-76-0.md)
- [v0.76.1 release record](../charness-artifacts/release/2026-08-10-ceal-v0-76-1.md)
