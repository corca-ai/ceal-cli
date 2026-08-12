# Gateway Failure Fallback Safety

## Current Slice

Finish the generic Gateway failure renderer so its fallback does not authorize
writes and its exported direct-input boundary cannot reflect unsafe fields.

## User Capability

When Gateway omits recovery guidance, a caller gets readback-first advice rather
than a locally invented write retry; safe opaque audit references still survive
while credential/provider material does not.

## Fixed Decisions

- The only generic action is observational: inspect Gateway status and audit
  readback before deciding whether to retry.
- The direct renderer validates error codes, proof refs, and retry timing even
  though the normal HTTP path has already decoded them; its retry ceiling is
  contract-bound to the frozen Protocol declaration.
- Worker proof-ref validation follows Protocol safe-ref behavior and preserves
  an opaque positive control; frozen Protocol source remains untouched.

## Fresh-Eye Review

The second independent pass found the unsafe retry fallback, direct code/ref
reflection, the false-positive opaque-ref hardening attempt, and unbounded
direct retry timing. The final counterweight review approved the corrected
Protocol-bound predicate and focused tests.

## Verification

- `npm run check:unit`
- `node --test packages/ceal-worker-cli/test/cli.test.mjs`
- `node --test test/contract/one-fact-one-home.test.mjs`
- `git diff --check`
- `bash .githooks/pre-push`

## Non-Claims

- These are checkout-level HTTP fixtures and direct-renderer tests, not a live
  Gateway/provider result or installed-release proof.
- The existing Protocol shipment divergence still blocks the release tier.
