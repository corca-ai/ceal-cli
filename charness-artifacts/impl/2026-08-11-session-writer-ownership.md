# Session Writer Ownership Closeout

## Implemented

- `runCealCommand` projects the compatible external runtime into an exact
  package-internal command context.
- Raw session save, remove, and locked-store callbacks stop at the composition
  root; command handlers receive fixed commit, renewal, and logout operations.
- The projection preserves class receivers, prototype/non-enumerable methods,
  lazy accessors, and accessors that return changing function identities.
- The context has a null prototype, is non-extensible, and derives its complete
  safe key set from a compile-time totality assertion.
- Enrollment/adoption, refresh, and logout retain their existing replacement,
  quarantine/lock/CAS, and revoke-before-remove owners.

## Capability Delivered

Future command handlers cannot name or recover arbitrary session writers from
their runtime object. Embeddings keep the existing input contract, while worker
command code receives only semantic lifecycle operations.

## Contract Source

`charness-artifacts/spec/2026-08-11-session-writer-ownership.md`

## Verification

- Worker package tests cover physical/raw-key absence, prototype bypass,
  reflection behavior, class receivers, lazy getters, and lifecycle semantics.
- A mutation arm widened the internal context and made TypeScript fail before
  the implementation was restored.
- `npm run check:unit` and `npm run check` passed.
- Verification level: local source/runtime only; no released package, installed
  worker, or live Gateway/provider seam ran.

## Lint Gate

ran-pass `bash .githooks/pre-push` — an earlier run surfaced two pre-existing
detector families after surrounding type annotations changed. Their independent
contracts were reviewed and classified before the final hook passed its
iteration, duplication, and shell phases.

## Truth Surface Sync

The implementation contract, quality record, this closeout, `docs/debt.md`, and
`docs/handoff.md` now agree that raw writer reachability is closed locally.
Release inputs and protocol pins did not change.

## Boundary Ownership

`owned-correctly` — the external embedding runtime remains the compatibility
input; the worker composition root owns capability projection; session
replacement and lifecycle modules retain mutation semantics. The frozen
Protocol package and sibling Gateway are outside this slice.

## Critique

Full parent-delegated fresh-eye review first exposed the locked-store sibling
leak, then broke spread and Proxy designs on class compatibility, prototype
bypass, reflection invariants, and eager session getters. The final exact
projection returned PASS, and its reviewer fingerprint verification was clean.
A distinct closeout-claims reviewer also returned PASS for local source/runtime
completion; that review window's fingerprint verification was clean.

## Contract Updates

The contract was refined during implementation to require prototype and
non-enumerable compatibility, method receiver preservation, lazy capability
discovery, reflection-safe physical masking, and classification totality. No
success criterion was dropped.

## Residual Risks

- TypeScript cannot stop a future owned module from directly importing a store
  writer; no such observed bypass currently justifies an import-graph gate.
- No signed package, installed worker, live Gateway/provider, or macOS install
  is claimed.
- One earlier receipt-spool concurrency test failure did not recur in later
  focused, iteration, or full gates; it remains a signal to investigate only if
  a recorded command reproduces it.

## Next Slice

The remaining concrete debt requires either macOS install proof or historical
acceptance-record re-emission, both outside an unapproved local-only change.
Return to the ceal-cli roadmap or begin another evidence-led quality sweep; ask
before any push, tag, publish, or release.

## Completion Categories

- durable: internal capability projection, semantic facade, boundary tests,
  debt deletion, synchronized contract and quality records.
- external-writes: none.
- test-only: class/accessor/reflection compatibility fixtures and mutation arm.
- verification: worker tests, repository gates, local hook checks, and fresh-eye
  review.
- unverified-future: released/installed/live behavior and direct-import policy.
