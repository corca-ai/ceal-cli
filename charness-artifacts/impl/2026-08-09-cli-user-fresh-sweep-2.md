# CLI User Fresh Sweep 2

## Current Slice

Close the deterministic user-facing defects reproduced by the second independent
Luna/xhigh sweep, while leaving Gateway-owned cache semantics and the existing
session-generation design question explicit.

## User Capability

A CLI user can finish logout when the Gateway says the refresh credential is
already retired, register the same guide safely from concurrent processes, trust
that a bounded audit miss is not reported as a complete search, retain observable
receipt-drop accounting under concurrent failures.

## Fixed Decisions

- Every Gateway code that means a refresh credential is already retired lets
  logout remove local state, while the result distinguishes `already_unusable`
  from a revocation this request actually performed.
- A concurrent guide registration that resolves to the requested symlink is
  success; a different occupant remains a conflict.
- Missing a requested session in a truncated inventory is `unreadable`, never
  `not_found`.
- The receipt-drop counter stays advisory and bounded, but its first write and
  cap must be serialized without waiting behind the receipt-spool lock.

## Acceptance Checks

- Logout removes local state for `refresh_revoked`, `refresh_invalid`,
  `refresh_expired`, and `refresh_replayed`, reports their server disposition as
  `already_unusable`, and preserves state for transport and other denials.
- Concurrent registrations of the same guide all report the final registered
  state; an existing different path is still refused.
- A session outside a bounded partial scan returns `unreadable`; a complete miss
  remains `not_found`.
- Concurrent first drop writes retain their count and never exceed the declared
  cap; sequential and foreign-identity behavior stay intact.
- Focused suites, `npm run check:unit`, the final gate, and maintainer-local gates
  pass.

## Deferred Decisions

- Whether discovery cache identity must include subject and instance is a
  Gateway-owned semantic question; do not widen the key without the signed
  protocol owner.
- Late pre-logout writers still require the explicit local session-generation
  contract already recorded by the prior slice.
- Route-specific lazy public runtimes remain the prior performance design slice.
- A synthetic executable named `cosign` that ignores cosign's own CLI contract
  does not prove an installer hang. The pinned v2.6.4 command owns a default
  command timeout, while installed `ceal update` retains its outer process-tree
  deadline; no additional wrapper is justified without a conforming repro.
- The shared lock's successor-swap hardening needs a reachable process-lifecycle
  reproduction; the synthetic owner-read swap is recorded, not claimed as a
  user-visible failure.

## Non-Claims

- No macOS runtime, released binary, live Gateway, or provider behavior is
  proved by this slice.

## Verification

- The focused built-dist regression set and the full worker package suite pass
  on the final implementation.
- The first full worker package run exposed that its existing concurrent append
  fixture relied on a fixed child-start time. The fixture now uses an explicit
  readiness gate, and the package suite passes after that repair.
- `npm run check:unit` and `npm run check` pass on the final implementation.
  The maintainer-local duplicate ratchet first exposed duplicated transcript
  collection decisions in the two audit read paths; one shared collector now
  owns them, and the ratchet and shell lint pass after that repair.
- Two parent-delegated Luna/xhigh reviewers scanned user journeys/update and
  state/concurrency. Each then reviewed the repaired tree; all shared-tree
  fingerprint windows verified clean. Provider-side model application is not
  claimed beyond the requested spawn fields.
- Critique: full parent-delegated Luna/xhigh user-journey, update, state, and
  concurrency review. The second-round truthful logout projection and
  deterministic fixture repairs are accepted-unreviewed under the bounded
  two-round stopping rule and are covered by the final test/gate evidence.

## Closeout Ledger

- Implemented: durable CLI source, deterministic regression fixtures, quality
  review, and continuation handoff; external-writes: none; test-only: temporary
  Linux homes and process gates.
- Capability Delivered: retired credentials no longer strand logout or claim a
  fresh revocation; guide registration converges under a same-target race;
  partial audit misses stay unknown; concurrent receipt losses stay observable.
- Contract Source: this artifact's Fixed Decisions and Acceptance Checks.
- Verification: local source/build/test proof; no released_binary,
  provider_roundtrip, or agent_choice claim.
- Lint Gate: ran-fail-fixed `npm run check:duplication`; ran-pass
  `npm run check:unit`, `npm run check`, `npm run check:duplication`,
  `npm run lint:shell`, and `bash .githooks/pre-push`.
- Truth Surface Sync: `docs/handoff.md`, this implementation artifact, and the
  current quality review.
- Boundary Ownership: Producer: worker session, guide, audit, and store modules;
  Consumer: CLI user and observer; Owning surface: worker CLI; Verdict:
  `owned-correctly`.
- Critique: full parent-delegated Luna/xhigh journey/update and
  state/concurrency review; findings received and boundary fingerprints clean.
- Contract Updates: acceptance checks, truthful server disposition, and
  deferred decisions reflect the final implementation.
- Residual Risks: the Deferred Decisions plus the no-macOS/release/live
  Non-Claims above.
- Next Slice: define local session generation before late-writer repair; then
  design route-specific lazy public runtimes after Gateway cache semantics are
  resolved.
