# CLI Z1 Legacy-MJS Retirement Critique

Date: 2026-08-21

## Decision Under Review

Delete the CLI's last authored `.mjs` helper and the conversion-only surfaces
that existed to migrate it: `scripts/test-support/base64url.mjs`,
`scripts/convert-legacy-mjs.ts`, its source test, and the `convert:legacy-mjs`
package route. Remove the stale Protocol-pin sidecar and reachability exemption,
keep the empty `.mjs` ratchet, and remove stale Knip entries.

The current Protocol vendor tree mismatch is explicitly separate: the CLI tree
is `e93e491a…`, while the pin and Gateway source commit record `cfee89e…`.
This critique does not authorize rewriting a frozen pin or editing the vendored
Protocol package.

## Fresh-Eye Review

The primary first attempted seven bounded built-in reviewers. They returned no
report before bounded stop and were closed; no shutdown or missing delivery is
counted as review evidence. A fallback `codex exec` reviewer then read the
current diff in a dedicated detached worktree and returned a substantive clean
verdict. Its own lint/test attempts were limited by the detached worktree's
Git/dependency environment; primary verification below is authoritative for
those commands.

## Findings

### Act Before Ship

- Delete the helper, converter, converter test, and package route together so no
  migration path survives an empty input class.
- Remove the `test_support` pin field, its release assertion, and the
  production-reachability exception together; the current Protocol tests use
  the in-subtree TypeScript support module.
- Keep `config/no-legacy-mjs.json` as an empty exact-list policy and retain the
  checker/tests so a newly authored `.mjs` path fails closed.
- Remove stale Knip globs and the unused `tsx` allowance; otherwise every gate
  would keep printing a warning about deleted surfaces.

### Bundle Anyway

- Keep the release-tier pin test's exact top-level key assertion so the removed
  compatibility sidecar cannot silently return.
- Keep the production reachability gate uniform over its owned TypeScript
  inventory; do not add a new exception for the deleted `.mjs` path.
- Keep the current docs statement that test support lives inside the pinned
  Protocol tree.

### Over-Worry

- Retaining the old helper “for a future handoff” is not supported by the
  current caller graph: the current Protocol tests import
  `protocol-test-support.ts`; the `.mjs` import belongs to historical MJS
  handoff snapshots.
- A new converter is unnecessary while the exact-list ratchet is empty; a new
  authored path is the explicit reopen trigger.

### Valid but Defer

- Repairing the seven-file Protocol tree drift belongs to the Protocol handoff
  and re-pin owner. It remains a release-tier blocker and is not hidden by the
  successful `check:unit` proof.
- The six existing unused `@testOnly` tags in
  `scripts/lib/gate-attestation.ts` remain a separate Knip-owned cleanup.

## Acceptance Tightening

- The intended diff contains no current reference to the deleted helper,
  converter, route, or sidecar.
- `npm run lint:no-legacy-mjs` reports zero files and fails under an inverted
  predicate mutation.
- `npm run lint:reachability`, the retained checker tests, changed pin tests,
  lint/type/import/markdown/NUL gates, and `npm run check:unit` pass.
- The release pin mismatch is recorded as a separate non-claim and no pin or
  frozen Protocol bytes are rewritten.
