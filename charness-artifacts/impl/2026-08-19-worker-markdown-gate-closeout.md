# Worker Markdown lint gate closeout

Date: 2026-08-19
Status: locally proved D1 implementation slice; D1 remains pending for its other structural gates.

## Implemented

Added a typed Worker Markdown checker with full and staged routes. The route
selects tracked/non-ignored untracked general Markdown for the full gate and
changed index Markdown for pre-commit, using a checked-in local policy and an
exact `markdownlint-cli2` dependency. Added focused scope/contract tests,
package/check/hook/gate-contract wiring, and the Worker gate documentation.

The full route exposed existing Markdown violations, which were repaired in
the same slice. Its broad proof also exposed a real test-harness race: the
repo-build timeout fixture changed global `process.env.PATH` while Node tests
ran concurrently. The fixture now passes a per-call `buildEnv` through the
workspace build helper and supervisor.

## Capability Delivered

Worker checks now enforce a local Markdown quality verdict before the full
check, while pre-commit checks the staged Markdown subset. Missing local policy
fails closed. The implementation explicitly does not claim Gateway's Charness
authoring preflight, because that wrapper delegates to upstream packaged source
the Worker does not own.

## Contract Source

- Gateway `scripts/check-markdown.sh:1-28` and
  `scripts/check_doc_authoring_preflight.py:1-6` as the producer reference.
- Worker commit `ada59b34e8461fed400e748585a4a36a37bbaa75`.
- Worker `scripts/check-markdown.ts`, `test/contract/check-markdown.test.ts`,
  `package.json`, `.githooks/pre-commit`, `config/gate-contract.json`, and
  `docs/gates.md`.
- Active goal Slice 4 and Claim Ledger.

## Verification

- Markdown contract tests: ran-pass, 4/4; combined Markdown and repo-build
  contracts: ran-pass, 26/26.
- Worker lint, raw tools typecheck, reachability, gate-contract, full/staged
  Markdown routes, and `git diff --check`: ran-pass.
- Worker `check:unit` proof job: ran-pass, exit 0, 45,215 ms.
- Worker full `check` proof job: ran-pass, exit 0, 85,640 ms; 69 pass, 1
  skip, 0 fail.
- Mutation: an extra blank line in `README.md` made `npm run lint:markdown`
  red with MD012; restoring `/tmp/ceal-worker-markdown-proof.Q4Ya5N/README.md`
  returned SHA-256
  `06719b795979b68b297b36f4f7a9b180fb4ec0692d1a65d4188023912a89c3d8` and the
  full route green.

## Lint Gate

Lint Gate: ran-pass through the Worker pre-commit route and both broad check
routes. The nine Knip configuration/tag hints are pre-existing nonblocking
advisories owned by the existing Knip surface; no new suppression was added.

## Truth Surface Sync

Updated the Worker goal artifact, dated quality record, current quality pointer,
implementation closeout, gate docs, package/hook/config contracts, and Markdown
policy. The Agent and Gateway sibling surfaces were not changed in this slice.

## Boundary Ownership

Producer: `scripts/check-markdown.ts` selects the local Markdown scope and calls
the pinned `markdownlint-cli2` API with the checked-in policy.

Consumer: `check`, `check:unit`, `.githooks/pre-commit`, gate-contract tests, and
the Worker docs.

Boundary Ownership: owned-correctly for the Worker markdownlint-only contract;
Gateway's upstream Charness authoring preflight remains explicitly out of scope.

## Critique

Kant's bounded fresh-eye review required the semantic delta from Gateway to be
named, local policy/dependency and route reachability to be visible, and a real
mutation proof to exist. The primary reread those sources and accepted the
partial receiving contract. No second code-repair round was required.

## Completion Report

- durable: Worker checker, local policy/dependency, tests, package/check/hook/
  config/docs wiring, test-harness race repair, goal, quality, and impl records.
- external-writes: none; no push, CI watch, release, apply/restart, or live readback.
- Instance apply: not applicable; this slice changes local structural gates only.
- verification: local deterministic proof; no Gateway preflight equivalence,
  Linux runtime, remote, release, or live behavior claimed.
- unverified-future: remaining D1 gates and any future owned integration of the
  Charness authoring preflight.

## Next Slice

Continue Lane D1 with the next independent structural gate. Preserve the source
contract, receiving-owned wiring, and mutation/restore proof. Do not enable
explicit-any or remove another diagnostic surface until the goal dependency
order allows it.
