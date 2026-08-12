# Gateway Failure Recovery Normalization

## Current Slice

Make the exported Worker failure renderer fail closed when direct `unknown`
input is not a Protocol-valid recovery or policy-denial shape.

## Implemented

- Normalize recovery once before it can affect denial or retry output.
- Require plain records, own known recovery keys, a closed recovery kind, and a
  bounded integer wait.
- Recognize call `policy_denied` only from the complete plain Protocol-shaped
  envelope, including a real exact `non_claims` array.

## Verification

- `node --test packages/ceal-worker-cli/test/cli.test.mjs` — 153 passing.
- `bash .githooks/pre-push` — passed.
- `npm run check:unit` — passed.
- `npm run check` — release tier remains refused only by the declared
  `proof_shipment_protocol_divergence` guard.

## Boundary Ownership

Worker owns defensive direct-input projection; frozen Protocol remains the
wire-shape owner and was not edited.

## Critique

Full fresh-eye review recorded in
`charness-artifacts/critique/2026-08-12-gateway-failure-rendering-review.md`.

## Non-Claims

No live Gateway/provider result, release package, or installed binary was
tested.
