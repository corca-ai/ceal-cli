# Worker Temporary TypeScript Fixture Compiler Scope Closeout

Date: 2026-08-19
Status: locally proved implementation slice; no compiler-only, CI, release, or live claim.

## Implemented

`test/artifact-workspace.ts` now writes temporary artifact compiler programs with
`lib: ["ES2022"]`, `skipLibCheck: true`, and `types: ["node"]`, while retaining
the existing isolated `typeRoots`, optional paths, and package-build extension.
The production typecheck configuration and diagnostic baseline surfaces were not
changed.

## Capability Delivered

Worker artifact tests pay only for the Node/ES2022 fixture class they exercise,
without changing production declaration checking or source diagnostics. The
existing isolated artifact setup still proves emitted ABI, exports, executable
surface, and checkout-dist non-mutation.

## Contract Source

- `charness-artifacts/goals/2026-08-18-worker-agent-ratchet-retirement-and-ports.md`, Slice 2
- `test/artifact-workspace.ts:29-50`
- `test/client-artifact.test.ts:14-19`
- `charness-artifacts/quality/2026-08-19-temporary-typescript-fixture-compiler-scope-20260819.md`

## Verification

- `npm run lint:types:raw:tools` — ran-pass.
- `node --test test/client-artifact.test.ts` — ran-pass, 4/4.
- `git diff --check` — ran-pass.
- Directional `/usr/bin/time -p node --test test/client-artifact.test.ts` observation:
  real 1.27 s before versus 1.16 s after; this includes setup, subprocesses, and assertions.
- Quality artifact validation — ran-pass.
- `check_boundary_escalation.py --detail` — `state: not-configured`; no cross-surface
  probe exists in this repo, so the objective override is off by design.
- Local code/fixture proof only; no provider-roundtrip, CI, release, or live proof ran.

## Lint Gate

Lint Gate: ran-pass `bash .githooks/pre-commit`.

The hook passed twice on the final Worker tree. It printed nine pre-existing Knip
configuration/tag hints; the quality record accepts them as a non-blocking
`knip.json`-owned advisory for the next Worker quality sweep.

## Truth Surface Sync

Updated the active goal Slice Log, Claim Ledger, Worker quality record, and its
current quality pointer. README and product/operator docs were not changed because
this is an internal test-fixture compiler-cost boundary.

## Boundary Ownership

Producer: `test/artifact-workspace.ts` creates the temporary `tsconfig.json` and
invokes `tsc -p` inside a disposable artifact root.

Consumer: `test/client-artifact.test.ts` consumes the isolated package outputs and
asserts the retained artifact contract.

Boundary Ownership: owned-correctly.

Production `tsconfig.build.json` remains the production compiler-policy owner.

## Critique

Critique: full parent-delegated fresh-eye review with fixture-boundary, runtime-
economics, and type-portability lenses, a counterweight, and a round-2 repair
review. No Act Before Ship blocker remained. The round-2 Worker boundary
fingerprint returned `ok: true`, `verdict: clean`, `drift: []`; the only repair was
precision in the comment about Node types.

## Contract Updates

The goal now records the Worker/Agent fixture class, the accepted alternatives,
the red Agent type seam and repair, the directional timing non-claim, and the next
D1 raw compiler-route slice.

## Completion Report

- durable: temporary Worker compiler options, quality contract, goal/quality/impl records.
- external-writes: none; no push, CI watch, release, apply/restart, or live readback.
- test-only: existing artifact test family reused; no duplicate test family added.
- verification: local deterministic code/fixture proof; no provider-roundtrip or agent-choice proof.
- unverified-future: repeated compiler-phase benchmark, other OS/Node versions, DOM fixtures,
  CI/release behavior, and the goal's remaining D1/B/C/D2/E lanes.

## Next Slice

Commit is complete locally. Continue with Lane D1 raw compiler-route closure; do not
generalize this fixture optimization to production typecheck policy.
