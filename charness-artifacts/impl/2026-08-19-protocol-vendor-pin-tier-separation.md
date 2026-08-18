# Worker Protocol Vendor-Pin Tier Separation

Date: 2026-08-19
Status: implementation contract before code changes.

## Current Slice

Separate real-checkout Protocol vendor-pin assertions from the ordinary
contract/unit iteration tier. The frozen Protocol source and its current
pin/lock mismatch remain unchanged.

## Capability Delivered

Worker iteration can run the injected validator contract without paying or
claiming the live checkout/release-input binding. The release tier and
release/acceptance production guards retain the binding proof.

## Acceptance Checks

- `test/contract/protocol-vendor-pin.test.ts` contains only synthetic/injected
  validator and error-branch cases.
- `test/protocol-vendor-pin.test.ts` owns the live tree, helper blob, lock
  census, and pin/lock assertions.
- The live validator proof also requires the source commit and shipment lock to
  converge, not only the vendored tree hash.
- `npm run check:unit` does not execute the live suite.
- `npm run test:release` executes the live suite and remains red on the current
  vendored-tree mismatch.
- `npm run lint:types:tests`, the staged lint hook, and `git diff --check` pass.
- No Protocol source, pin, lock, baseline, release input, CI, or runtime state
  changes.

## Claim Ledger

| Claim | Source | Recheck | Level |
| --- | --- | --- | --- |
| Contract tests execute `test/contract/*.test.ts`, while release tests execute `test/*.test.ts`. | `package.json:22-24` | `node --test test/contract/protocol-vendor-pin.test.ts` and `npm run test:release` | verified-by-reading |
| Ordinary pre-push uses `check:unit`; tag/full paths use `check`. | `.githooks/pre-push:129-138` | `npm run check:unit` and hook contract test | verified-by-reading |
| Full test coverage reaches both contract and release tiers through `test:tiers`. | `scripts/coverage-scripts.ts:74-79` | `npm test` | verified-by-reading |
| The current live vendored tree differs from the recorded pin tree. | `scripts/verify-protocol-vendor-pin.ts:333-357`, `protocol-vendor-pin.json` | `node scripts/verify-protocol-vendor-pin.ts` | verified-by-reading |
| Release and acceptance retain independent shippability guards. | `scripts/worker-release-inputs.ts:197-220`, `scripts/worker-acceptance-packet.ts:467-470` | `node --test test/contract/repo-gates.test.ts` | verified-by-reading |

## Deliberately Not Doing

- Do not resync `packages/ceal-protocol` or regenerate `protocol-vendor-pin.json`.
- Do not add a baseline, `--no-verify` route, new third suite, or CI change.
- Do not remove or weaken production shippability guards.

## Gate Advisory Disposition

The staged pre-commit gate passed. Its existing Knip configuration/tag hints,
zero-writer store-lock observations, and duplicate-literal ownership notes are
non-blocking signals owned by their existing quality configurations; this slice
does not alter or suppress them. They remain deferred to the next Worker
quality sweep rather than being treated as new defects here.
