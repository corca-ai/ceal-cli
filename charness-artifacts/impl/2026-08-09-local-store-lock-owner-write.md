# Local Store Lock Owner-Write Failure

## Current Slice

Prevent a partially initialized or late-reclaimed lock generation from letting
two `ceal` processes enter the same local-store critical section.

## User Capability

Concurrent `ceal` processes keep mutual exclusion over session refresh,
enrollment, logout, and receipt-spool writes across owner publication, stale
recovery, and successor acquisition races.

## Fixed Decisions

- Owner data is completed in a private nonce-named candidate directory before
  an atomic same-parent rename publishes the lock.
- A visible empty directory from the legacy mkdir/write protocol can be
  atomically replaced by a complete candidate. A visible partial owner record
  remains under the initialization grace.
- A dead or invalid non-empty generation is renamed, never deleted, to a fixed
  generation tombstone. Valid owners use their nonce; invalid owners use the
  moved directory's retained device/inode identity. The tombstone remains
  non-empty so a late reclaimer cannot move the live successor onto the same
  destination.
- Release still checks the holder nonce before removing the stable path.

## Acceptance Checks

- A complete candidate that loses its publication race preserves the winner.
- Two stale observations of one dead generation cannot let the late reclaimer
  move the live successor.
- A zero-byte legacy owner stays live during initialization grace and is
  quarantined after the grace rather than wedging the store.
- Existing live, stale, malformed, release, and process-concurrency lock tests
  remain green.

## Deferred Decisions

- macOS installed-worker proof remains post-release by operator decision.
- Mutual exclusion is proved among binaries using atomic candidate publication.
  A legacy binary already paused after opening a zero-byte owner record can
  resume after a new binary quarantines that generation and still believe its
  old path is current. Release/update acceptance must therefore exclude a
  concurrently running legacy CLI at that exact acquisition seam; this slice
  does not claim cross-version lock handoff.
- Candidate directories left by a killed process do not participate in future
  lock ownership. Retained generation tombstones also stay outside the stable
  path, but may not be deleted by a simple age rule: an indefinitely delayed
  reclaimer could otherwise reuse the destination and move a successor.
- This slice does not change lock wait budgets.

## Verification

- Focused lock suite:
  `node --test packages/ceal-worker-cli/test/local-store-lock.test.mjs`
- Repository iteration gate: `npm run check:unit`
- Fresh-eye review falsified the first cleanup-only design with an open/write
  interleaving and a double-reclaimer interleaving. The candidate/tombstone
  redesign repaired both; re-review then found the repeated-invalid collision,
  which the retained generation identity and regression fixture repaired.
- Final bounded re-review found no remaining act-before-ship issue within the
  current-binary scope.

## Non-Claims

- At slice close this was local source/test proof; the later signed release and
  installed readback are owned by the `ceal-v0.76.0` release record.
- The one-time legacy-to-atomic update condition remains owned by
  `docs/release-and-enrollment.md`. It was satisfied before the first installed
  update, so the temporary tracking item has been removed from `docs/debt.md`.
