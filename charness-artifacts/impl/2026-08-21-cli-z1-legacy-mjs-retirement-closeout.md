# CLI Z1 Legacy-MJS Retirement Closeout

Date: 2026-08-21
Status: locally proved CLI Z1 cleanup; the release-tier Protocol pin remains a
separate pre-existing gate debt.

## Implemented

- Deleted `scripts/test-support/base64url.mjs`, whose current callers had moved
  into `packages/ceal-protocol/test/protocol-test-support.ts`.
- Deleted `scripts/convert-legacy-mjs.ts`,
  `test/source/legacy-mjs-conversion.test.ts`, and the
  `convert:legacy-mjs` package route after the input class became empty.
- Removed the stale `protocol-vendor-pin.json.test_support` sidecar, its blob
  assertion, and the ineffective production-reachability exception.
- Removed the now-dead `trackedLegacyMjs` export and stale Knip entry globs and
  `tsx` allowance.
- Kept the empty `config/no-legacy-mjs.json` policy and its fail-closed checker
  and tests. Updated `docs/gates.md` and the release pin test to describe the
  current owner boundary.

## Capability Delivered

The CLI now has no authored `.mjs` files in its tracked inventory. The retained
checker remains the steady-state non-expansion owner, and production
reachability no longer reads a compatibility sidecar for a file it did not
inventory. A future authored `.mjs` path is still an explicit red event.

## Contract Source

- `package.json`, `config/no-legacy-mjs.json`, `scripts/check-no-legacy-mjs.ts`
- `scripts/lib/production-reachability.ts`
- `protocol-vendor-pin.json`, `test/protocol-vendor-pin.test.ts`,
  `test/contract/production-reachability.test.ts`
- `knip.json`, `docs/gates.md`
- Active cross-repository goal Claim Ledger

## Verification

- `npm run lint:no-legacy-mjs`: ran-pass, verified 0 files.
- `npm run lint:reachability`: ran-pass, 29 entries and 98 reachable modules.
- Retained reachability/checker tests: ran-pass, 19/19.
- Changed release-pin tests excluding the pre-existing live tree assertion:
  ran-pass, 3/3. The full `test/protocol-vendor-pin.test.ts` remains red at
  the live tree assertion because `HEAD:packages/ceal-protocol` is
  `e93e491a3b46c4039e956b784af7e8676c758a19`, while the pin and Gateway
  source commit record `cfee89e25f0724484a5df2e8cb15346c6697c743`.
- `npm run lint`, `lint:types:packages`, `lint:types:tools`,
  `lint:types:tests`, `lint:secrets`, `lint:import-hard-failures`,
  `lint:source-nul-bytes`, `lint:markdown`, `lint:unused`,
  `lint:store-lock`, and `lint:duplicate-literal`: ran-pass.
- `npm run check:unit`: ran-pass through the proof runner; result
  `/tmp/ceal-proof-jobs/cli-z1-check-unit/result.20260821-cli-z1-check-unit-01.json`,
  exit 0, 59,570 ms. This is local development proof, not release or installed
  Worker proof.
- Mutation: inverting the checker comparison made `npm run lint:no-legacy-mjs`
  red with `legacy MJS list changed (added: none; removed: none)`. The snapshot
  `/tmp/ceal-cli-z1-check-no-legacy-mjs.snapshot.ts` restored SHA
  `2faa03d3df1ea5fae2210fcf22b1671e20316f71e9607b7ca0cea93adfb0a564`, and the
  same gate returned green.
- Fresh-eye: fallback Codex review
  `/tmp/ceal-cli-z1-review.GEYzl5/codex-review.md` returned no substantive
  blocker in the dedicated worktree. Built-in reviewer delivery failures are
  recorded as non-evidence.

## Lint Gate

Lint Gate: ran-pass through the commit hook and `check:unit`. Knip now emits
only six pre-existing unused `@testOnly` tag hints in
`scripts/lib/gate-attestation.ts`; disposition is a separate gate-attestation
cleanup, not silently ignored and not a blocker for this slice.

## Truth Surface Sync

Updated the CLI package route, empty policy, Protocol pin, reachability test and
implementation, Knip configuration, gate documentation, and release-tier pin
test. The cross-repository goal and quality ledger remain the parent truth
surfaces and record the current CLI commit and the separate pin debt.

## Boundary Ownership

Producer: `scripts/check-no-legacy-mjs.ts` owns the tracked/staged `.mjs`
inventory and exact policy comparison.

Consumers: `check`/`check:unit`, the pre-commit staged route, and the source
checker tests. Protocol source ownership remains with the Gateway; this slice
does not edit `packages/ceal-protocol` or rewrite its pin.

Boundary Ownership: owned-correctly.

## Critique

The bounded fresh-eye review found no substantive deletion blocker. It agreed
that the historical `.mjs` caller did not remain in the current CLI source and
that the stale exception, converter, and Knip entries should retire together.
The pre-existing Protocol tree mismatch remains explicitly separate and
release-blocking.

## Contract Updates

- The exact MJS policy is now empty and remains fail-closed.
- The Protocol pin has only its owned source/vendored/shipped identity surfaces.
- Reachability no longer accepts a pin-sidecar exception for a non-inventoried
  `.mjs` file.
- Conversion scaffolding is reopened only by a newly authored `.mjs` path, a
  live conversion caller, or a named format contract.

## Completion Report

- durable: CLI source, tests, package/config/docs contracts, critique, and impl
  closeout are committed at `83625676208ae791252f89b08886b2ca8c91dd7d`.
- external-writes: none; no push, CI watch, release, publish, apply/restart, or
  live readback.
- Instance apply: not applicable; this slice changes local quality surfaces.
- verification: local deterministic proof with a separate release-tier gate
  debt; no installed Worker, remote Gateway, or live provider claim.

## Residual Risks

- Protocol vendor pin drift introduced by CLI commit `a8b3b96` remains owned by
  the Protocol handoff/re-pin lane and blocks release-tier proof.
- Root full `.js`/`.mjs`/`.cjs` family guard and unrelated semantic quality
  slices remain open in the parent goal.
- Six unused `@testOnly` tags remain a separate Knip cleanup.

## Next Slice

Repair the Protocol handoff/re-pin debt under its owner boundary, then continue
the parent goal's root full-family guard and remaining quality slices. Do not
reintroduce a converter for an empty policy.
