# Worker Owned Notification Shutdown Contract

## Problem

The v5 Worker owns FD5 teardown after Agent control EOF, but the production
inherited `net.Socket` async iterator rejects that owned destroy with
`ERR_STREAM_PREMATURE_CLOSE`. The notification loop previously accepted only
its private `ControlAbortedError`, so an otherwise successful active-runner
cancellation ended with Worker exit 3.

## Capability Contract

When Agent control EOF starts the Worker's normal shutdown, the Worker closes
its inherited notification socket and exits cleanly even when Node reports the
owned destroy as `ERR_STREAM_PREMATURE_CLOSE`. FD5-first EOF, malformed
notifications, and unrelated output failures remain unsuccessful.

## Current Slice

Classify the exact Node premature-close code as clean only behind the existing
owned-shutdown latch, and add a process-level oracle using the real inherited
child FD5 socketpair for both normal owner shutdown and FD5-first EOF.

## Fixed Decisions

- Keep Agent control EOF as the only normal-shutdown owner.
- Match the typed Node error code, not the human message.
- Do not accept arbitrary errors merely because the owned-shutdown latch is set.
- Preserve the existing private abort classification and every v4 behavior.
- Prove the change through the shipped stream constructor and a real child FD,
  not two synthetic fakes.

## Deferred Decisions

- Signed Worker release, Gateway selection/apply, and live latency proof.
- Concurrent Agent notification and channel-loss abort idempotency.

## Success Criteria

- The pre-fix process oracle is red because owner shutdown returns `clean:false`.
- The repaired owner-shutdown arm exits zero, emits `{ "clean": true }`, and
  writes no stderr.
- The same oracle's FD5-first arm exits zero but emits `{ "clean": false }`.
- The retained malformed-frame, output-failure, deadline, and v5 candidate
  tests remain green.
- Broadening the owned-shutdown classifier to every `Error` makes the
  same-message/wrong-code mutation oracle red; restoring the exact Node code
  makes it green.
- Gateway transport-only and active-runner compositions both reach Worker exit
  zero against the repaired local build before release work starts.

## Acceptance Checks

- `npm run build`
- `node --test packages/ceal-worker-cli/test/leased-consumer-control-session.test.mjs packages/ceal-worker-cli/test/leased-consumer-v5-candidate.test.mjs`
- Gateway durable transport-only and `local_active_runner_integration` proof jobs
  using the exact repaired local Worker build and current built Agent.
- `npm run check:unit`, followed by the final pre-push gate before publication.

## Boundary Ownership

`moved-to-owner` — ceal-cli owns the Worker notification stream lifecycle and
its exit classification. Gateway owns composition proof and later selection;
Agent owns broker-to-runner cancellation.

## Non-Claims

This local source repair is not a signed release, coherent Gateway selection,
instance apply, provider call, Slack roundtrip, latency result, or C11a
completion.
