# Session Onboarding Recovery

## Current Slice

Make every generic no-session recovery surface present both approved setup
routes instead of silently hiding mailbox adoption.

## User Capability

A fresh, logged-out, or capabilities-blocked user is sent first to local session
status and can then choose either an operator-issued enrollment code or a
verified mailbox invitation.

## Fixed Decisions

- One setup-choice fragment owns both route spellings; generic setup and
  replacement recovery derive their context-specific actions from it.
- Session status, logout completion, capabilities failure, command discovery,
  parent help, pre-issue call/receipt failures, and installed acceptance derive
  from those declarations.
- Renewal failures offer both approved replacement paths while retaining their
  no-retry warning.
- Enrollment-specific failures continue to name enrollment because they report
  an already-selected code exchange, not generic setup.

## Acceptance Checks

- The unconfigured status, already-logged-out result, completed logout result,
  and no-session capabilities/call/receipt errors carry the declared setup
  action; installed acceptance imports the same action after its install check.
- The action names both `session enroll --help` and `session adopt --help`.
- `npm run check:unit` passes.

## Fresh-Eye Review

The first review found three scope gaps: call, receipt, and installed acceptance
still bypassed generic setup; renewal failures still treated code enrollment as
the only replacement; and status help retyped both route choices. The shared
choice fragment and expanded regression checks address all three. A second
review then reproduced an installed-only defect: no-session acceptance emitted
a capabilities document before its own refusal. Stored access resolution is now
separate from rendering, and an injected installed-layout regression requires
one acceptance document. The next review found that the result-only resolver
had dropped whether a failure was a typed client-session error; that provenance
is now part of the result union, and both capabilities and acceptance prove a
pre-send local save failure stays local rather than becoming network advice. A
final review then found that the safe-but-unclassified fallback still guessed
code replacement after a local failure. It now stops at local status and
configuration repair; only classified replacement failures offer setup routes.
The closing review found no remaining act-before-commit issue and independently
rechecked the local fallback, both replacement choices, enrollment-specific
errors, typed failure provenance, and the single-document acceptance result.

## Verification

- `npm run check`
- `npm run check:unit`
- `node --test --test-name-pattern='generic no-session recovery|ambiguous renewal response|pre-send quarantine|typed Gateway refresh denial' packages/ceal-worker-cli/test/cli.test.mjs`
- `git diff --check`

## Non-Claims

- Naming adoption does not claim that the user currently has an active mailbox
  invitation.
- This slice makes no Gateway request and changes no enrollment transaction.
