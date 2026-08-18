# Worker Source-NUL Structural Gate Port Closeout

Date: 2026-08-19
Status: locally proved D1a implementation slice; D1 remains pending for its other structural gates.

## Implemented

Added a typed Worker checker for raw NUL bytes in tracked source, with a staged
index variant for pre-commit. Added four focused contract tests, package scripts,
check/check:unit reachability, the staged pre-commit route, gate-contract
declaration, and the Worker gate documentation. The receiving implementation
imports `execFileSync` explicitly because the fixed Gateway source uses it
without importing it in staged mode.

## Capability Delivered

Worker normal checks now own the full tracked-source raw-byte verdict, while the
pre-commit tier checks source paths changed in the index before commit. The gate
uses no diagnostic baseline or ratchet and does not alter production compiler policy.

## Contract Source

- Gateway commit `3cb729ba5d6f76ff6796e60a541454ff9ebbc924`
- `scripts/check-source-nul-bytes.ts`
- `test/contract/check-source-nul-bytes.test.ts`
- `package.json`, `.githooks/pre-commit`,
  `config/gate-contract.json`, `docs/gates.md`
- Active goal Slice 3 and Claim Ledger

## Verification

- Source-NUL tests: ran-pass, 4/4.
- Worker repo-gate contract: ran-pass, 54/54.
- `npm run lint` and `npm run lint:types:raw:tools`: ran-pass.
- Normal and staged source-NUL scripts: ran-pass.
- `npm run check:unit` through `run-proof-job.ts`: ran-pass,
  41,875 ms.
- Mutation: raw NUL at `scripts/check-no-legacy-mjs.ts:157` made the gate
  red; snapshot restore returned hash
  `a750859ec8c379da468686eb30c17c2fa7e980ab` and the gate green.
- No Gateway edit, push, CI watch, release, apply/restart, or live readback.

## Lint Gate

Lint Gate: ran-pass through the Worker lint and check:unit routes. The check log
printed nine pre-existing Knip hints; disposition is a non-blocking
`knip.json` advisory for a separate quality sweep.

## Truth Surface Sync

Updated the Worker goal artifact, quality record, current quality pointer, gate
docs, package/hook/config contracts, and the implementation closeout. Agent owns
and records its sibling implementation separately.

## Boundary Ownership

Producer: `scripts/check-source-nul-bytes.ts` enumerates tracked or staged
source and reads the worktree or index.

Consumer: `check__, `check:unit__, `.githooks/pre-commit`, and
their declarative contract tests.

Boundary Ownership: owned-correctly.

## Critique

Three parent-delegated medium fresh-eye lenses returned findings. The staged
changed-path scope and unreadable-file skip were confirmed against the fixed
Gateway source contract; newline-delimited path serialization is recorded as a
future source-integrity follow-up. Worker and Agent reviewer-boundary verifies
returned `ok: true`, `verdict: clean`, and empty drift.

## Completion Report

- durable: Worker checker, tests, package/check/hook/config/docs wiring, goal,
  quality, and impl records.
- external-writes: none; no push, CI watch, release, apply/restart, or live readback.
- Instance apply: not applicable; this slice changes local structural gates only.
- verification: local deterministic proof; no Linux runtime or remote proof claimed.
- unverified-future: remaining D1 gates, Linux/CI/release behavior, and newline-bearing
  source paths.

## Next Slice

Continue Lane D1 with the next independent structural gate. Do not enable
explicit-any or delete another diagnostic surface until the goal dependency order
allows it.
