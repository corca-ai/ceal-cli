# Ceal CLI Worker Repair Handoff

## Workflow Trigger

Continue the bounded Worker-owned notification shutdown lane. Read the local
contract and closeout before doing release work; do not reimplement the repair.
The operator approved the immutable Worker tag/release publish on 2026-08-10.
Use the repo release procedure and its full tag gate; approval does not weaken
any candidate, tag, public, install, or later Gateway proof.

## Continuation Capability

Carry the locally proved Worker lifecycle repair into one signed successor to
`ceal-v0.76.0`, then provide the exact public identity for Gateway coherent v5
selection. Preserve early-FD5 and unrelated-error failure while doing so.

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
- The immutable public release remains `ceal-v0.76.0`. No successor tag,
  release publish, installed update, Gateway selection/apply, or live proof has
  happened.
- The prepared patch candidate targets `0.76.1` / `ceal-v0.76.1`; its
  changelog, release critique, and pre-publication record are local truth
  surfaces until the exact version commit passes the remaining gates.

## Next Session

1. Confirm the exact local commit and clean tree; do not redo the repair.
2. Complete and commit the coherent 0.76.1 version/changelog/release-record
   slice with Protocol 0.72.13 unchanged.
3. Follow [release procedure](release-and-enrollment.md): full gate, dry run,
   immutable tag, release watch, installed update, and readback.
4. Hand the signed release tuple to the Gateway goal for coherent v5 selection,
   `ceal-dev` apply, and configured-channel latency proof.

## Discuss

- Concurrent notification plus channel-loss abort idempotency remains a
  separate non-claim; it does not block the normal owned-shutdown repair.
- The response-latency proof belongs after signed selection and apply. It may
  overlap only disjoint local work and must not overlap another instance
  restart.
- Refresh kept: exact local proof state, immutable-release approval boundary,
  and the next Gateway handoff.
- Refresh non-claims: no successor release, selection/apply, provider/Slack,
  latency, concurrent-close, or C11a completion proof.

## References

- [repair contract](../charness-artifacts/spec/2026-08-10-worker-owned-notification-shutdown.md)
- [implementation closeout](../charness-artifacts/impl/2026-08-10-worker-owned-notification-shutdown.md)
- [code critique](../charness-artifacts/critique/2026-08-10-worker-owned-notification-shutdown-code-critique.md)
- [v0.76.0 release record](../charness-artifacts/release/2026-08-09-ceal-v0-76-0.md)
