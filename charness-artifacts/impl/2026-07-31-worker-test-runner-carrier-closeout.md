# Worker Test Runner Carrier — Closeout

## Implemented

- Replaced the hanging synchronous `spawnSync` test call in
  `packages/ceal-worker-cli/test/leased-consumer-carrier.test.mjs:218` with an
  asynchronous `spawn` helper.
- Connected an explicit `/dev/null` descriptor to child FD 4, preserving the
  non-pipe-FD contract instead of relying on test-runner `stdio: "ignore"`.
- Added a five-second child timeout and cleanup for the opened descriptor.

## Capability Delivered

The worker and CI test runners now complete this private-carrier boundary test
without waiting indefinitely after the HPKE file's output.

## Contract Source

`charness-artifacts/spec/2026-07-31-worker-test-runner-carrier-hang.md` and the
existing carrier contract/test assertions.

## Verification

- `node --test packages/ceal-worker-cli/test/leased-consumer-carrier.test.mjs`:
  8 passed.
- `npm --prefix packages/ceal-worker-cli test`: 237 passed.
- `npm test`: passed; unit, contract (103), and release (26 passed, 2 platform
  skips) completed in 36.592s before the final cleanup-only adjustment.
- `npm run lint -- --no-errors-on-unmatched`: passed.
- `git diff --check`: passed.

## Lint Gate

ran-pass `npm run lint -- --no-errors-on-unmatched`

## Truth Surface Sync

No user-facing, release, or protocol truth surface changed; this is a test
harness lifecycle fix.

## Boundary Ownership

single-surface — the change is confined to the worker test's child-process
harness; the shipped carrier implementation and private contract are unchanged.

## Critique

Fresh-eye reviewer approved the contract-preserving change and identified only
the descriptor cleanup edge case, which was addressed with `try/finally`.

## Contract Updates

None.

## Residual Risks

The local proof covers Node v22.22.1 on macOS plus the repository's full local
test suite; it does not independently execute a remote GitHub Actions runner.

## Next Slice

None required for this fix.
