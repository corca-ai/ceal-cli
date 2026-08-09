# Session Status And CLI Recovery

## Current Slice

Give the existing local session summary an explicit read-only route and make
argument refusals point at the help leaf that can correct them.

## User Capability

An operator or agent can run `ceal session status` through the sanctioned
read-only probe, and a malformed known command returns the nearest useful help
command instead of sending the user back to top-level discovery.

## Fixed Decisions

- `ceal session status` is an explicit read-only alias of the compatible bare
  `ceal session` summary. It performs no Gateway request or local write.
- Parent session help names every current route, including adoption.
- Invalid top-level option-free commands, explicit help descent, and session
  leaves each name their own nearest help route in `error.next_action`.
- Explicit help with an extra invalid tail is refused while retaining the
  nearest recognized leaf in `error.next_action`.
- Session recovery text names the explicit read-only status leaf, so the
  sanctioned probe can follow it without admitting the remote-write parent.
- Route declarations still drive help, probe effect classification, and session
  dispatch.

## Acceptance Checks

- Bare and explicit session status return the same local-state document.
- `npm run probe -- ceal session status` runs inside a throwaway home as a
  declared read-only route.
- A table of malformed known routes asserts the exact route-local recovery.
- Parent help advertises `--force` for both identity-replacement routes.
- `npm run check:unit` passes.

## Fresh-Eye Review

The first review found three user-facing seams: malformed explicit help lost a
recognized leaf, several recovery strings still named the remote-write parent,
and parent usage omitted both accepted `--force` options. The implementation
and regression table now bind all three behaviors. The second review found no
remaining act-before-commit issue. Its boundary verification records one
parent-attributed change: removing the now-unused export from the route helper
after the iteration gate identified it.

## Verification

- `npm run check:unit`
- `node --test --test-name-pattern='parent session help|malformed known route|session recovery strings|bare and explicit local session status' packages/ceal-worker-cli/test/cli.test.mjs`
- `node --test --test-name-pattern="the child's own declared effect decides" test/contract/probe-surface.test.mjs`
- `git diff --check`

## Deferred Decisions

- Bare `ceal session` remains compatible and conservatively inherits the
  parent's widest remote-write effect. Safe automation should use the explicit
  `status` leaf.
- macOS installed-worker proof remains post-release by operator decision.

## Non-Claims

- A local session summary does not prove live Gateway access; its output already
  directs the caller to capabilities for that proof.
- This slice makes no Gateway write and proves no provider behavior.
