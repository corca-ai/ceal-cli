# Receipt Spool Identity Boundary

## Current Slice

Prevent a late receipt append or drop record from an old session from appearing
in the local observer as activity of the session that replaced it.

## User Capability

`ceal observe` shows only receipt history and loss accounting attributable to
the identity currently stored on this host. A concurrent logout, forced
replacement, or delayed old process may lose advisory history, but it may not
misattribute that history to the new identity.

## Fixed Decisions

- One stable discriminator derives from the same identity bindings that decide
  whether enrollment is a replacement.
- Both the receipt spool envelope and its lock-free drop counter carry that
  discriminator; fixing only one would leave the sibling race intact.
- The discriminator is a digest. Raw membership, subject, profile, instance,
  or Gateway values do not enter the advisory files.
- Legacy unscoped spool and drop files are not attributed to the current
  identity. The next current-identity write replaces them.
- A mismatched old process may replace advisory bytes after a transition, but
  current-identity reads reject those bytes rather than merging identities.

## Deferred Decisions

- The receipt spool remains advisory and best-effort; this slice does not turn
  it into a journal or make its failure affect `ceal call`.
- macOS installed-worker proof remains post-release by operator decision.
- Other user-reliability debt is handled in later slices.

## Acceptance Checks

- Tests prove that old-identity entries and drops are invisible to a new
  identity, including writes that occur after replacement cleanup.
- Tests prove same-identity re-enrollment retains attribution and current
  bounded/drop behavior.
- Tests prove one observer response derives its session projection and receipt
  identity from the same stored-session snapshot.
- Tests prove a readable legacy spool is ignored and replaced rather than
  attributed or merged.
- Session replacement and receipt spool import one canonical identity owner.
- Worker unit/contract gates pass, followed by the final repository gate at
  bundle closeout.

## Verification

- Focused regression suite:
  `node --test packages/ceal-worker-cli/test/receipt-spool.test.mjs packages/ceal-worker-cli/test/observer.test.mjs packages/ceal-worker-cli/test/local-store-file.test.mjs packages/ceal-worker-cli/test/cli.test.mjs`
- Repository iteration gate: `npm run check:unit`
- Fresh-eye review found an observer snapshot race and a missing safe-legacy
  fixture; both were repaired and the bounded re-review found no remaining
  act-before-ship issue.
- Shared-tree reviewer boundary was clean before and after each review window.

## Non-Claims

- A response can become stale immediately after its single session snapshot;
  it remains internally identity-consistent.
- A delayed old process can replace advisory bytes and temporarily hide current
  history. The discriminator prevents attribution to the wrong identity; it
  does not turn the spool into durable audit storage.
- macOS installed-worker behavior is not proved by this slice.
