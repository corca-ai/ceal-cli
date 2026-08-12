# Gateway Failure Rendering Repair

## Current Slice

Repair the two regressions from generic Gateway failure rendering without
reintroducing Worker-owned Gateway wording.

## User Capability

CLI callers retain Gateway-authored, safe error text and opaque confirmation
references even when an optional action is absent, while authorization failures
still present as blocked or denied rather than unavailable.

## Fixed Decisions

- Read `message` and optional `next_action` independently; substitute local
  guidance only for the missing or unsafe field.
- Apply the frozen Protocol public-safe-text predicate at the Worker boundary,
  retaining the established Ceal credential-prefix guard for direct callers.
- Preserve denial disposition with compact known-code and recovery-kind sets,
  not a resurrected wording or recovery-prose table.
- Leave cross-surface `retry_after_ms` projection as separate schema work.

## Fresh-Eye Review

Independent reviews reproduced the optional-field and denial-status regressions.
They also identified the direct-call safe-text boundary and the call-surface
`blocked` projection; both received focused regression coverage. The final
fresh-eye pass found no remaining act-before-ship issue.

## Verification

- `npm --ignore-scripts --prefix packages/ceal-worker-cli run build && node --test packages/ceal-worker-cli/test/cli.test.mjs`
- `npm run check:unit`
- `bash .githooks/pre-push`
- `git diff --check`
- `npm run check` — intentionally stops only in release-package tests with
  `proof_shipment_protocol_divergence`: the shipped handoff lock and vendored
  Protocol pin name different Gateway commits. This predates the slice and
  remains a required release refusal.

## Non-Claims

- This is local source and fixture proof, not a live Gateway response, signed
  handoff, packaged release, installation, or provider readback.
- This does not make the current Protocol shipment divergence releasable.
