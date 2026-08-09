# Darwin Local Store Lock Debug
Date: 2026-08-09

## Problem

The first pushed `0.76.0` candidate passed Linux but failed the macOS full gate
because every local-store writer that acquired the shared lock returned its
typed `unsafe_store` failure.

## Correct Behavior

Given an owner-only local store on Linux or macOS, when a Ceal command acquires
its lock, then the lock must publish one complete owner generation atomically,
exclude concurrent writers, and never follow a substituted store parent.

## Observed Facts

- GitHub run `31327563111`, macOS job `93280263494`, reached the worker suite
  and reported 51 failures; representative receipt-spool failures originate in
  `createLock` and surface `CealReceiptSpoolStoreError: unsafe_store`.
- The same commit passed the local Linux full gate and its pre-push iteration
  gate. The failure is host-specific, not a general lock-state fixture failure.
- `anchorLockParent` maps the open parent descriptor to `/proc/self/fd` on Linux
  and `/dev/fd` on Darwin, then appends child names below that path.
- `removeOwnedFile` independently made the same mapping, so its two macOS
  substitution/cleanup tests fail at the same descriptor-path boundary.
- Darwin exposes `/dev/fd/<n>` as a descriptor entry, not a traversable
  directory. Apple's `fd(4)` description and the observed stack both contradict
  the Linux-derived assumption that children can be created below it.

## Reproduction

- Released runner reproduction: `npm run check` in job `93280263494` on
  `macos-15-arm64`.
- Smallest checked-in consumer: the first acquisition in
  `packages/ceal-worker-cli/test/local-store-lock.test.mjs`; it succeeds on
  Linux and reaches `onUnsafe` from `createLock` on the macOS runner.

## Candidate Causes

- Darwin `/dev/fd/<n>` does not support child-path traversal used for the lock
  candidate and stable name.
- APFS directory-rename collision rules differ from Linux and reject candidate
  publication after candidate creation.
- macOS runner umask or mode reporting widens the parent/candidate mode and the
  safety checks refuse it.
- Parallel tests leave a live or malformed lock generation that contaminates
  later cases.

## Hypothesis

- The static Darwin `/dev/fd/<parent-fd>/<child>` anchor is the cause. If true,
  resolving the open descriptor to its current real directory path, verifying
  that path against the descriptor identity, and using that verified path for
  the operation will make the smallest lock test and its parent-swap sibling
  pass on macOS. | disconfirmer: a macOS probe shows descriptor realpath cannot
  be resolved/re-anchored, or the focused lock suite still fails before rename.

## Verification

- Confirmed at the failing boundary: all representative failures enter
  `createLock`; Linux passes; the one platform branch that differs supplies a
  non-traversable Darwin descriptor path.
- Pending repair proof: focused macOS lock tests and the complete macOS gate.

## Root Cause

The lock treated Linux procfs descriptor links and Darwin descriptor devices as
one path abstraction. Both identify an open descriptor, but only the Linux path
can be traversed as the opened directory. The shared lock therefore refused its
first ordinary Darwin mutation before any user state could be written.

## Invariant Proof

- Invariant: when the lock opens an owner-only store parent, every later lock
  mutation must resolve to that same directory identity before the CLI can
  report the local operation as successful.
- Producer Proof: `anchorLockParent` holds an `O_DIRECTORY|O_NOFOLLOW` handle
  and its `fstat` identity.
- Final-Consumer Proof: pending; the macOS full gate must exercise session,
  cache, receipt, and guide consumers without `unsafe_store`.
- Interface-Shape Sibling Scan: every store reaches the same shared lock; the
  candidate publish, stale quarantine, and release paths all consume its path.
- Non-Claims: no released macOS binary or live Gateway/provider call is proven.

## Detection Gap

- Local full gate | ran only on Linux before push | require the existing macOS
  `check.yml` leg to pass before the release dry run or tag.
- Lock unit tests | asserted substitution safety but not that the descriptor
  anchor itself is traversable on every supported host | retain a Darwin path
  resolution/re-anchoring assertion through the focused suite.

## Sibling Search

- Mental model: a descriptor exposed in a filesystem namespace is necessarily
  a directory path on every POSIX host.
- same layer: candidate publish, wait/quarantine, release, owned-file cleanup |
  decision: one platform-aware resolver, not copied fallbacks | proof: source
  census.
- abstraction up: session, discovery, receipt, and guide stores | decision:
  unchanged callers; all consume the shared invariant | proof: CI failure set.
- specialization down: Linux `/proc/self/fd` | decision: retain the stronger
  directly traversable anchor | proof: full Linux gate.
- cross-file: release workflow macOS leg | decision: keep it mandatory before
  tag; it is the final-consumer host proof.

## Seam Risk

- Interrupt ID: darwin-local-store-lock-anchor
- Risk Class: external-seam, host-disproves-local
- Seam: Node filesystem path API -> Darwin descriptor namespace -> local store.
- Disproving Observation: the focused and full macOS suites acquire, contend,
  quarantine, and release without acting on a substituted parent.
- What Local Reasoning Cannot Prove: Darwin descriptor realpath behavior after
  a parent rename; the hosted macOS runner must prove it.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: open
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-08-09-darwin-local-store-lock-anchor.md

## Prevention

Treat descriptor identity and descriptor-path traversal as separate platform
capabilities. Keep the macOS full gate ahead of every release tag and preserve
the parent-substitution regression at the shared lock boundary.
