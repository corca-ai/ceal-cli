# Quality Review
Date: 2026-08-11
Title: Session Writer Ownership

## Scope

Target boundary: worker command runtime capability ownership. This review
continues the active move recorded by the prior codebase quality sweep.

Ambient repo findings: none; frozen Protocol, release, and sibling Gateway
surfaces remain out of scope.

## Surface Contract Review

- semantic coverage: `partial` — source architecture and deterministic local
  behavior are in scope; no released binary or live Gateway is claimed.
- surface: worker command dispatch and persisted client-session transitions.
- owner: the command composition root owns capability projection; session
  transition modules own commit, renewal, and logout semantics.
- projections: compatible embedding runtime to a physically narrowed internal
  command context.
- state scope: one local client-session slot and its derived local state.
- transitions: enrollment/adoption commit, refresh quarantine/CAS, and logout
  revoke-before-remove.
- proof boundary: TypeScript capability proof, worker tests, repo gates, and
  bounded fresh-eye review.
- unexamined axes: released packages, live Gateway, and direct imports a future
  owned module could add outside the runtime boundary.

## Current Gates

The iteration and final gates remain `npm run check:unit` and `npm run check`;
the local hook adds duplication and shell checks.

## Runtime Signals

- runtime source: `.charness/quality/command-timing.jsonl`, rendered by
  `render_runtime_summary.py --repo-root . --detail`. <!-- reproduction-source -->
- runtime hot spots: no timing-driven scope change; rerun the renderer for the
  current host sample.
- coverage gate: `npm run check:unit` and `npm run check` passed after the
  capability projection landed.
- evaluator depth: deterministic gates plus a bounded architecture reviewer;
  no log-backed evaluator request applies.

## Healthy

The composition root now projects the compatible embedding runtime into an
exact, null-prototype, non-extensible command context. Command handlers receive
only read/operate seams plus fixed enrollment, renewal, and logout operations.
TypeScript makes every new runtime key choose the safe projection or the raw
mutation set before the worker compiles.

## Weak

The external embedding contract still accepts deprecated raw session seams for
source compatibility. That object stops at `runCealCommand`; the internal
context carries no route back to it or its prototype.

## Missing

No missing proof remains inside the runtime capability boundary. TypeScript
cannot prevent a future owned module from directly importing a store writer;
there is no such observed bypass to justify a separate import-graph gate.

## Deferred

Released-package and live Gateway behavior remain outside this local source and
runtime proof. No release was requested or performed.

## Advisory

- artifact: the structural review recorded in
  `charness-artifacts/spec/2026-08-11-session-writer-ownership.md` supports an
  internal command context plus fixed semantic facade, not a regex allowlist.
- artifact: prose review is not applicable because the implementation contract
  scopes no skill prose change.
- artifact: the implementation contract is
  `charness-artifacts/spec/2026-08-11-session-writer-ownership.md`.

## Delegated Review

- Delegated Review: executed and satisfied — the bounded architecture reviewer first found
  the locked-store sibling leak, then falsified spread/Proxy projections against
  class receivers, prototype bypass, reflection invariants, and eager getters.
  The final exact projection passed the repaired-tree review; its fingerprint
  verification was clean.
- A distinct closeout-claims reviewer returned PASS for local source/runtime
  completion; that review window's fingerprint verification was also clean.
- Slow-gate lenses (fixture-economics, parallel-critical-path, duplicated-proof):
  not re-delegated because this slice does not alter gate shape or runtime cost.

## Commands Run

`npm --prefix packages/ceal-worker-cli test`, `npm run check:unit`, `npm run
check`, `npm run check:duplication`, `npm run lint:shell`, `node
scripts/install-git-hooks.mjs --check`, `git diff --check`, quality artifact
validation, and reviewer fingerprint snapshot/verify.

## Recommended Next Quality Moves

- passive because no direct import bypass is observed, add an import-graph
  restriction only if one appears —
  capability_needed=AST import ownership; next_center=repo gates;
  transformation=forbid command-to-store imports; proof_boundary=fixture
  falsification; enforcement_posture=no-gate because no current bypass needs it.
- passive because later complete gates passed, investigate the receipt-spool
  concurrent-drop test only if its earlier one-off failure recurs under a
  recorded command; there is no falsifiable product or stable test defect yet.

## History

- [Prior codebase quality sweep](2026-08-11-codebase-quality-sweep.md)
- [Prior quality baseline](history/2026-07-27-quality-review-second-pass.md)
