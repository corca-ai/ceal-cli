# CLI User Fresh Sweep

## Current Slice

Close the reproducible user-facing defects found by the Luna xhigh fresh sweep,
without hiding the two larger lifecycle/performance changes that need a separate
design boundary.

## User Capability

A CLI user can trust route effects, argument refusals, recovery instructions,
local-state safety, and observer attribution before deciding whether to retry,
replace a session, or run a command against real state.

## Fixed Decisions

- A route that may rotate the Gateway session declares `remote_write`, even when
  its primary operation is a read. Help explains that the remote write is session
  renewal, not a provider action.
- Invalid argv returns the argument-error envelope and exit class, pointing at
  the nearest useful help route before any session or Gateway work.
- Shared session replacement rendering receives the acquisition method so
  adoption never inherits enrollment-code terminology.
- A credential-store read distinguishes a genuinely absent directory from an
  unsafe parent. Cache/spool cleanup refuses a non-owned parent directory.
- Observer cache projection is bound to the same stored-session snapshot as the
  session and receipt projections; mismatched cache contents are not rendered.
- Advisory cleanup reports whether it actually completed, and receipt lock
  contention cannot hold a completed call behind a multi-second wait.

## Acceptance Checks

- Duplicate capabilities flags and every malformed call/receipt/guide/observe
  example fail with `invalid_argument`, exit 2, and route-local help.
- Capabilities detail is either declared on the targets leaf or rejected; there
  is no hidden accepted option.
- Capabilities, targets, receipt, and acceptance advertise `remote_write` and
  the installed-surface probe refuses them unless help was requested.
- An installed guide with no HOME reports the missing configuration root rather
  than recommending reinstall.
- Session adoption conflicts and post-revoke write failures use adoption terms
  and never request an enrollment code.
- An absent credential file under an unsafe `.ceal` parent is refused before an
  enrollment/adoption transaction; cache and spool cleanup do not follow that
  parent.
- Observer state never attributes a cache from another session to the current
  session.
- Acceptance argv errors use exit 2, widened store permissions refuse cleanup,
  and a failed advisory clear never reports `local_derived_state_cleared: true`.
- A live receipt-spool lock is bounded without hiding the dropped receipt from
  the observer's drop counter.
- `npm run check:unit` and the focused affected suites pass.

## Deferred Decisions

- A late pre-logout process can recreate same-identity receipt history after a
  later login. Closing it while preserving same-identity reenrollment history
  needs an explicit local session-generation contract.
- Route-specific lazy public runtimes can remove dynamic-command startup work,
  but require a dispatcher boundary rather than another conditional import
  patch. Linux measurements show an optimization opportunity, not a blocker.
- The installer download path is bounded; a separate reproduction is required
  before treating an unbounded `cosign verify-blob` invocation as a defect.

## Non-Claims

- No macOS installed-binary, released worker, live Gateway, or provider behavior
  is proved by this slice.

## Verification

- Focused CLI, guide, adoption, store, observer, probe, and updater tests passed.
- `npm run check:unit` first exposed a stale copied effect expectation; the final
  green run is recorded after that owner synchronization.
- `npm run check` passed on the final source tree. The maintainer-local duplicate
  ratchet first refused one extractable family plus intentional re-keys; the
  empty-spool state was extracted, the other families were independently
  classified, and both duplication and shell gates then passed.
- Three parent-delegated Luna/xhigh fresh-eye reviewers returned findings. The
  shared-tree fingerprint was clean after each result; provider-side model
  application is not claimed.
- Critique: full parent-delegated UX/recovery, state-integrity, and
  performance/update review.

## Closeout Ledger

- Implemented: durable CLI source, regression tests, operator docs, quality
  review, and continuation handoff; external-writes: none; test-only: temporary
  Linux probe homes/logs only.
- Capability Delivered: users receive truthful route effects, argument exits,
  recovery, cleanup results, session-bound observer output, and bounded advisory
  receipt recording.
- Contract Source: this artifact's Fixed Decisions and Acceptance Checks.
- Verification: local source/build/test proof; no provider_roundtrip or
  agent_choice claim.
- Lint Gate: ran-fail-fixed `bash .githooks/pre-push`; its iteration phase passed,
  then the duplicate component was repaired and both local components passed.
- Truth Surface Sync: `README.md`, `docs/operator-acceptance.md`,
  `docs/handoff.md`, and the current quality review.
- Boundary Ownership: Producer: worker route/store declarations; Consumer: CLI
  user, probe, observer; Owning surface: worker CLI; Verdict: `owned-correctly`.
- Critique: full parent-delegated Luna/xhigh UX, state, performance, and
  duplicate-family review; findings received and boundary fingerprints clean.
- Contract Updates: acceptance checks and deferred decisions reflect the final
  implementation.
- Residual Risks: the two Deferred Decisions plus the no-macOS/release/live
  Non-Claims above.
- Next Slice: define local session generation before late-writer repair; then
  design route-specific lazy public runtimes.
