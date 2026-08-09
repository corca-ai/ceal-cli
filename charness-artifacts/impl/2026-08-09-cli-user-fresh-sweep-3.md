# CLI User Fresh Sweep 3 Closeout

## Outcome

The worker CLI now exposes opt-in, secret-free phase timing and closes the
third sweep's reproduced lifecycle, cleanup, parser, observer-budget, and
partial-logout truth gaps.

## Implemented

- `ceal --timing <command>` preserves the command's one-YAML stdout and emits
  fixed `ceal.timing.v1` JSON Lines on stderr for bootstrap/runtime preparation,
  session/load/lock/refresh/revoke, Gateway phases, guide/observer/receipt work,
  and update stages. Diagnostic writes and callbacks cannot change the command
  result; timed TTY update suppresses human progress text.
- Every Gateway-issued enrollment/adoption session that fails local commit gets
  a bounded revoke attempt and an `issued_session_revoked` disposition.
- Logout always stays in `ceal.session_logout.v1`, preserves completed remote
  revocation across local removal failure, and reports derived-state cleanup.
- Cache, spool, and session deletion share descriptor-anchored removal, so a
  parent rename/symlink swap cannot redirect unlink to a same-named outside file.
- Local-store lock creation, inspection, reclamation, and release use the same
  opened parent anchor, so the sibling path cannot redirect lock deletion.
- Stored-session `--profile` consumers enforce the Profile reference grammar
  before local or network work.
- Agent-audit directory enumeration streams under its entry and monotonic walk
  budgets while retaining partial/newest-first semantics.

## Proof

- Focused lifecycle, logout, timing, profile, local-store race, audit, and
  adoption tests passed against built dist.
- `npm --workspace @corca-ai/ceal-worker-cli test` passed after the first
  repaired-tree review findings were fixed.
- Final repo gates and maintainer-local checks are recorded in the paired
  quality artifact rather than duplicated here.

## Fresh Eye

- Three Luna/xhigh scans covered lifecycle/state, output/UX, and performance
  visibility. Their repaired-tree pass found logout-schema drift, preflight
  recovery drift, timing/update contamination, missing timing boundaries, and
  path-based cleanup TOCTOU; each was reproduced and fixed.
- Reviewer-boundary fingerprints were clean before parent fixes. The final
  fixes are accepted-unreviewed under the bounded two-round review rule and are
  covered by focused regression tests.

## Deferred

- Route-specific public-runtime splitting remains a measured follow-up enabled
  by the new timing surface.
- Same-identity late receipt writers still need the already-recorded local
  session-generation contract.
- Reclaimed-lock tombstone GC remains separately constrained by generation
  safety in `docs/debt.md`.

## Non-Claims

No macOS, released worker binary, live Gateway, provider, push, tag, or release
was proven by this local slice.
