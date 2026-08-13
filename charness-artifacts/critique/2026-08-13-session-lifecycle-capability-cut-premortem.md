# Session lifecycle capability cut premortem
Date: 2026-08-13

## Decision Under Review

Delete ceal-cli's compatibility-only flat session hooks, the second projected
command context, and every unlocked mutation fallback. Replace them with one
all-or-none semantic session lifecycle capability built by one production
factory from the canonical locked store.

## Failure Angles

- A partial capability would preserve the same combinatorial API under a new
  name. A configured capability must always contain `load`, `commitEnrolled`,
  `ensureCurrent`, and `logout`; otherwise the capability itself is absent.
- Deleting only the three raw writers would miss direct `loadSession` readers
  in status, discovery, calls, adoption, and observer composition, leaving a
  second session seam and partial-runtime failures.
- Test fixtures could hide the compatibility layer by hand-assembling semantic
  callbacks. They must use the same production factory and an in-memory locked
  store.
- Removing unlocked fallbacks is safe only if enrollment/adoption retains one
  locked compare/dispose/write interval, refresh retains identity validation
  plus refresh-token CAS, and logout retains revoke-before-remove.
- Preflight reads must still occur before an enrollment code or adoption
  transaction is consumed.
- A temporary-HOME helper can accidentally make missing-HOME behavior
  untestable. The absence case needs a child process whose environment truly
  omits `HOME`.
- Generated declarations and ignored `dist` can retain removed hooks after
  source tests pass.

## Counterweight Pass

- Act before ship: use one factory; make the capability all-or-none; migrate
  every reader; delete raw hooks and unlocked fallbacks; prove the lock interval
  by mutation and the missing-HOME case by a real child process.
- Bundle anyway: retain exact V1/V2 payload tests and the security ordering
  tests while deleting projection/prototype tests whose sole subject is the old
  embedding shape.
- Valid but defer: ordinary unlocked reads are not shown to violate the current
  atomic-write and locked-mutation contract; signed Protocol convergence and a
  full release gate remain separate.
- Over-worry: external embedding migration and deep-import compatibility. The
  Worker package is private and the operator explicitly removed compatibility
  commitments.
- Two reviewers initially compared the packet's tagged `sha256-v1` content
  digest to raw file SHA256. The repo-owned verifier confirmed the rebound
  packet current; both reviewers withdrew the finding.

## Structured Findings

- F1 | bin: act-before-ship | evidence: strong | ref: packages/ceal-worker-cli/src/command-context.ts:20 | action: fix | note: replace partial getter-based session operations with one all-or-none production capability
- F2 | bin: act-before-ship | evidence: strong | ref: packages/ceal-worker-cli/src/session-replacement.ts:209 | action: fix | note: delete unlocked enrollment, refresh, and logout fallbacks with the raw hooks
- F3 | bin: act-before-ship | evidence: strong | ref: packages/ceal-worker-cli/src/index.ts:826 | action: fix | note: move status, discovery, call, observer, enrollment, adoption, refresh, and logout reads to the same capability
- F4 | bin: act-before-ship | evidence: strong | ref: packages/ceal-worker-cli/src/public-bin-runtime.ts:14 | action: fix | note: prove a valid store produces all four operations and absent HOME produces no partial capability
- F5 | bin: bundle-anyway | evidence: strong | ref: packages/ceal-worker-cli/src/profile-store.ts:147 | action: fix | note: retain current V1/V2 exact payload behavior without adding a migration reader
- F6 | bin: valid-but-defer | evidence: moderate | ref: packages/ceal-worker-cli/src/profile-store.ts:56 | action: defer | note: do not widen this slice into locking ordinary reads absent a reproduced invariant failure
- F7 | bin: over-worry | evidence: strong | ref: packages/ceal-worker-cli/package.json:4 | action: defer | note: private package consumers do not justify a compatibility adapter or deprecation phase

## Reviewer Tier Evidence

- Requested tier: bounded high-leverage.
- Requested spawn fields: reasoning effort `medium`, as required by the
  repository adapter; no model override requested.
- Host exposure state: requested_fields_sent
- Application state: applied to both bounded reviewer task instructions.
- Delivery state: findings-received-and-rebound

## Fresh-Eye Satisfaction

parent-delegated

## Reviewed Input Identity

- Packet consumed: `charness-artifacts/critique/2026-08-13-session-lifecycle-capability-cut-packet.json`
- Packet path: `charness-artifacts/critique/2026-08-13-session-lifecycle-capability-cut-packet.json`
- Packet SHA256: `3c369a7c301c9a7ebadfac39e8e568ae0482e0b895e1504852f7f67580349cdc`
- Identity SHA256: `339651b54be4c200fc3ab7038915d309c2267beb5f701fa668494bfba0f85708`

## Boundary Ownership

- Producer: Worker public binary composition root.
- Consumer: Worker command handlers and deterministic fixtures.
- Owning surface: one session lifecycle capability factory backed by the
  canonical locked profile store.
- Verdict: moved-to-owner
