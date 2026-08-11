# Implementation Contract

Date: 2026-08-11
Title: Session Writer Ownership

## Problem

`CealCommandRuntime` is the embedding input and currently carries raw session
save, remove, and locked-store callbacks. The same object reaches every command
handler, so a future handler can bypass the identity-replacement, refresh CAS,
or revoke-before-remove owners. Current commands do not take that shortcut; the
defect is capability reachability, not a reproduced runtime failure.

## Slice

At `runCealCommand`, convert the compatible external runtime into a physically
new package-internal command context. Mask every raw session mutation key while
preserving safe prototype, non-enumerable, and method-receiver behavior, and
replace raw mutation with a semantic session facade whose operations are fixed
to:

- commit an enrolled/adopted session through the existing replacement owner;
- ensure a current session through the existing quarantine, lock, and CAS owner;
- logout through the existing revoke-before-remove owner.

Read-only session loading remains available to commands. The external runtime
keeps its existing flat seams so repository embeddings and tests do not need a
source-breaking migration.

## Success Criteria

- Every command handler below the composition root accepts
  `CealCommandContext`, not `CealCommandRuntime`.
- `CealCommandContext` has no `saveSession`, `removeSession`, or
  `withSessionStateLock` key, enforced by a TypeScript `never` assertion.
- The actual context object has none of those own properties; a test observes
  the boundary so an `Omit`-only implementation cannot pass.
- A class-based embedding retains prototype and non-enumerable session-reading
  seams with their original method receiver.
- Enrollment and adoption still use the replacement transition, refresh still
  uses lock plus refresh-token compare-and-set, and logout still revokes before
  local removal.
- The worker package tests, iteration gate, full gate, duplicate ratchet, shell
  lint, and fresh-eye review pass.

## Boundaries

- Do not edit the frozen `packages/ceal-protocol` copy or sibling `../ceal`.
- Do not change package versions, release inputs, tags, published artifacts, or
  live Gateway state.
- This slice prevents capability leakage through the runtime object. It does
  not claim TypeScript can prevent a future owned module from importing the
  store implementation directly.
