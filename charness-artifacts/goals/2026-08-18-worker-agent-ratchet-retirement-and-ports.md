# Achieve Goal: Worker and Agent ratchet retirement and gate ports

Status: draft
Created: 2026-08-18
Activation: /goal @../ceal-cli/charness-artifacts/goals/2026-08-18-worker-agent-ratchet-retirement-and-ports.md

This is the living goal scratchpad. It is inert until the operator runs the
activation command.

## Active Operating Frame

- Current disposition: draft/backlog; no implementation slice has started. The
  first slice is Lane A, the Worker ratchet-retirement pilot.
- Execution boundary: activate from the Gateway checkout. Treat the three
  repositories as one sibling checkout set; run every Worker/Agent command with
  explicit roots (`git -C .`, `git -C ../ceal-cli`, `git -C ../ceal-agent`).
- Activation record: before implementation, record each root, HEAD, and tree
  identity again. Preparation identities are historical, not freeze values.
- Ownership: Worker changes belong in `../ceal-cli`; Agent changes belong in
  `../ceal-agent`; Gateway is read-only input for Lane D; this control artifact
  remains Worker-owned.
- Next action: after activation, re-read the three AGENTS.md files, verify the
  identities, remeasure Lane A, and repair the remaining raw compiler route.
- Enforcement: compiler/linter rules own source diagnostics; repo gates own
  structural, packaging, and cross-surface contracts. Do not add or regenerate
  a diagnostic ratchet/baseline to make a migration green.
- Gate cadence: narrow checks while a slice is in flight; run the broad local
  bundle only at `--verification-lock` after all slice dependencies are
  coherent; no push, CI watch, release, apply/restart, or live readback belongs
  to this goal.

## Goal

Reduce hand-managed quality state across Worker and Agent while preserving real
structural gates:

- retire the Worker typecheck diagnostic ratchet after raw compiler coverage and
  mutation/restore proof;
- enable the measured compiler options plus `noNonNullAssertion` and
  `no-explicit-any`, repairing source with guards and typed adapters;
- port Gateway structural gates with receiving-repository wiring and proof;
- remove only paid zero entries from the Agent TS6/TS7 baselines.

Compiler/linter enforcement should own source correctness, repo gates should own
what they can uniquely observe, and hand-maintained diagnostic managers should
not sit between them.

## Scope Boundary With the Sibling Goal

- This goal owns `../ceal-cli` and `../ceal-agent`; the sibling Gateway goal
  owns Gateway source changes.
- Lane D reads the fixed Gateway port source at commit
  `3cb729ba5d6f76ff6796e60a541454ff9ebbc924`; rebind and re-review if the
  Gateway source or tree changes before that slice.
- The `esm-sentinel.js` path is a synthetic Gateway packaging fixture. Do not
  create, move, or rename a real `../ceal-agent/src/esm-sentinel.js`.

## Lane A — retire the Worker typecheck ratchet

Re-derive the Worker project/file distance from the current baseline and raw
compiler output. The existing replacement route is `lint:types:raw:*`; no
replacement diagnostic manager is allowed.

Acceptance:

1. Snapshot relevant Worker scripts, baseline, configs, tests, and package
   scripts before mutation.
2. Repair the remaining project/file to zero through its raw compiler route.
3. Prove the raw route for every project formerly covered by the ratchet and
   show package/check reachability.
4. Establish a positive-control search hit for the raw route, then prove no
   live ratchet consumers remain.
5. Delete `scripts/check-typecheck-ratchet.ts`, its baseline, and ratchet-only
   tests only after their failure mode is unreachable.
6. Mutate a retained source/config input, require a direct nonzero raw-route
   result, restore from the pre-mutation snapshot, and require the same route
   green with the intended diff intact.
7. Do not rewrite or regenerate a baseline. If deletion cannot be proven, log
   the falsifiable reason and stop dependent implementation; do not try a
   second deletion shape.

The relevant evidence surfaces are `scripts/check-typecheck-ratchet.ts`,
`charness-artifacts/quality/typecheck-ratchet-baseline.json`,
`test/contract/typecheck-ratchet.test.ts`, and
`test/contract/typecheck-source-gate.test.ts` in `../ceal-cli`.

## Lane B — configure the compilers

Enable these options in every owning Worker/Agent project actually compiled by
the raw checks, then repair source diagnostics without a ratchet:

`noFallthroughCasesInSwitch`, `noImplicitReturns`, `noImplicitOverride`,
`noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, and
`exactOptionalPropertyTypes`.

Re-measure with each repository's declared raw typecheck route. Keep
`noPropertyAccessFromIndexSignature` as a separate compiler-owned migration;
it is deferred, not an accepted permanent exception and not a custom ratchet.

## Lane C — remove disabled lint escape hatches

- In `../ceal-agent/eslint.config.ts:36`, enable
  `@typescript-eslint/no-explicit-any`; use `unknown`, guards, or typed SDK
  adapters at boundaries.
- In `../ceal-cli/biome.json:30`, enable `noNonNullAssertion`; replace index
  and map assertions with explicit guards/helpers and update
  `../ceal-cli/docs/gates.md:103-107`.
- `as const` remains an intentional exception only when the active source or
  config contract supports it. Never solve new diagnostics by adding assertions
  or weakening the rule.

## Lane D — port structural gates with their contracts

| gate | receiving checkout | dependency |
| --- | --- | --- |
| lint:import-resolution | Worker and Agent | none |
| lint:secrets | Worker and Agent | signed release/service-runtime lanes |
| lint:source-nul-bytes | Worker and Agent | none |
| lint:explicit-any | Worker and Agent | Lane C |
| markdown lint | Worker | receiving docs gate |
| duplicate detector | Agent | Agent allowlist and scope |

Every port must preserve its source commit/tree, helpers, policy, tests, and
platform assumptions; add receiving config/script/contract/hook/full-check
reachability; keep receiving allowlists and scan roots local; and prove a
retained-input mutation red followed by snapshot-restore green. A copied but
unreachable script is not a port. D1 precedes Lane B/C-dependent D2.

## Lane E — clear paid content from Agent baselines

For `../ceal-agent/config/typecheck-baseline.json` and
`typecheck-baseline-ts6.json`, compute before/after key-set diffs and remove
only zero-valued entries paid by the current raw checker. Preserve every
non-zero diagnostic and TS6/TS7 distinction, run both declared lanes and
checker tests, and prove no update/min-merge path hides new diagnostics. Record
the exact removed keys in Agent-owned evidence. Keep the legacy `.mjs` guard:
its prohibition is still mechanically reachable.

## Non-Goals

- No push, tag, publish, remote-CI watch, apply/restart, or live readback.
- No Gateway source edits and no real Agent `src/esm-sentinel.js` file.
- No new or regenerated diagnostic baseline, ratchet, grep-count, or bypass.
- No claim that either checkout becomes free of all `any` or assertions.
- No claim that local macOS proof equals Linux, signed-artifact, release, or
  provider proof.
- No duplicate creation or resolution of issue #671; it remains an upstream
  Charness follow-up.

## Boundaries

- Activate from Gateway and read `../ceal/AGENTS.md`, `../ceal-cli/AGENTS.md`,
  and `../ceal-agent/AGENTS.md` first.
- Worker/Agent commands use explicit sibling roots; each checkout proves its
  own behavior.
- A gate/compiler replacement needs direct exit-code mutation-red and
  snapshot-restore-green evidence. Restore the snapshot, never HEAD, and verify
  the restore with the same gate.
- Delete a guard only after its failure mode is unreachable and no live caller
  remains.
- Commit meaningful local slices with an intent-focused subject and check the
  parent-relative cached name-status against the intended path set.
- External boundaries are phase-scoped and absent from this activation.

## User Acceptance

The user can verify that:

- the Worker ratchet and ratchet-only tests disappear only after raw coverage,
  no-consumer proof, and mutation/restore evidence;
- all seven compiler options and both disabled lint rules are enabled and paid
  in source without new baselines/assertions;
- every gate port has source identity, receiving reachability, local contract,
  and red/restore-green proof;
- Agent baseline cleanup preserves all non-zero TS6/TS7 entries and records
  exact removed keys;
- local commits and proof records exist without any external-boundary claim.

## Agent Verification Plan

### Low-Cost Checks

- Read all three AGENTS.md files and verify sibling roots, HEADs, and trees.
- Run this artifact's default check and `--pursue-ready` before activation.
- Inspect package scripts, gate contracts, compiler/linter configs, baselines,
  and closures with positive-control searches.
- Run targeted raw typecheck/lint routes and baseline key-set checks.
- Verify intended commit name-status before each commit.

### High-Confidence Checks

- Run narrow declared checks for each owning checkout.
- Run direct mutation-red and snapshot-restore-green proof for Lane A and each
  new port; read exit codes without a pipe.
- Run the broad local bundle only after dependencies are coherent and bind a
  distinct fresh-eye critique to deletion/cross-surface closeout.

### External Or Live Proof

Skipped by scope: push, remote CI, Linux-only proof, signed publication,
runtime apply/restart, Slack action, and live readback. Record these as
non-claims at closeout and reopen them only under a separately approved goal.

## Slice Plan

| Slice | Objective | Expected evidence | Status |
| --- | --- | --- | --- |
| A | Retire Worker ratchet after raw replacement proof | raw coverage, no-consumer search, mutation red, restore green | pending |
| D1 | Port structural gates independent of explicit-any | closure, reachability, mutation/restore | pending |
| B | Enable seven measured compiler options | config diff, source repairs, raw proof | pending |
| C | Enable noNonNullAssertion and no-explicit-any | lint proof, guards/adapters, docs alignment | pending |
| D2 | Close explicit-any port | receiving closure and mutation/restore | pending |
| E | Remove only paid Agent baseline entries | key diff, non-zero preservation, both lanes | pending |
| Closeout | Bind local proof and non-claims | fresh-eye, identities, final gates | pending |

Order is A → D1 → B → C → D2 → E. If Lane A fails, dependent
implementation stops with a falsifiable Slice Log reason; no second deletion
shape or baseline regeneration is authorized.

## Backlog Recount

- Counted: preparation snapshot recorded 4 open `corca-ai/ceal-cli` issues on
  2026-08-18; local issue artifacts counted 0.
- Claims: none; this is a local Worker/Agent quality goal.
- Not claimed: all open issues, including #671; none is adopted or duplicated.

## Operator Decision Queue

none — activation boundaries, slice order, compiler/linter ownership, and the
Lane A stop rule are resolved in `## Discuss Before Activation`.

## Coordination Cues

- Phases: impl, quality, critique, retro.
- Routing: `charness:achieve` owns lifecycle; `charness:impl` owns bounded
  source/config/test slices; `charness:quality` owns proof; `charness:critique`
  owns deletion/cross-surface fresh-eye review.
- Fresh-eye: bounded delegated reader plus counterweight pass; primary rereads
  every load-bearing claim.
- Gather: n/a — local owner docs and source only.
- Release: n/a — no release surface.
- Issue closeout: n/a — #671 is an off-goal upstream follow-up.

## Discuss Before Activation

Discuss before activation: RESOLVED 2026-08-18 — activate from Gateway, keep
the run local-only, use explicit sibling roots, prefer compiler/linter
enforcement, follow A → D1 → B → C → D2 → E, stop dependent work on an
unproven Lane A deletion, and leave Linux/remote/runtime proof to separately
approved work. Do not create or duplicate #671.

## Slice Log

No implementation slice has started; preparation and artifact checks only. The
Worker commit hook printed the known Lane A diagnostics while returning exit 0;
disposition: tracked by Lane A and not treated as raw compiler replacement
proof.

## Context Sources

1. `../ceal/AGENTS.md` — three-repository ownership, claim ledger, mutation/
   restore, and external-boundary rules.
2. `AGENTS.md` — Worker ownership, local gates, and publication boundaries.
3. `../ceal-agent/AGENTS.md` — Agent ownership and fail-closed proof surfaces.
4. `../ceal/docs/dogfooding.md` and `../ceal/docs/verification-philosophy.md`.
5. `../ceal-cli/docs/gates.md` — current lint exceptions and gate contracts.
6. `../ceal-agent/docs/roadmap.md` and operator-acceptance docs.
7. The sibling Gateway goal — boundary context only; do not edit or wait on it.
8. Gateway port source commit `3cb729ba5d6f76ff6796e60a541454ff9ebbc924`.

## Interview Decisions

- Problem: remove hand-managed diagnostics while strengthening compiler/linter
  enforcement; rejected preserving custom migration state.
- Execution: Gateway session with explicit sibling roots; rejected independent
  Worker activation.
- Rules: enable named compiler/linter options and repair source; rejected new or
  regenerated baselines.
- Assertions/any: use guards, `unknown`, and typed adapters; rejected textual
  counts and disabled exceptions.
- `noPropertyAccessFromIndexSignature`: defer as a separately-sized compiler
  migration, never as a permanent off exception or custom ratchet.
- Order: A → D1 → B → C → D2 → E; rejected ambiguity because earlier slices
  change later code and gate surfaces.
- Failure: stop dependent work if Lane A deletion is unproven; rejected a
  second deletion shape in the same goal.

## Plan Critique Findings

Preparation fresh-eye review identified host-specific paths, incomplete
Lane A/B/D/E postconditions, ambiguous push boundaries, and insufficient
receiving-gate wiring. This compact artifact folds those fixes into Scope,
Boundaries, Verification, and Slice Plan. It also keeps the synthetic Gateway
fixture boundary, separates local from Linux/release/live proof, and retains
issue #671 as an upstream follow-up rather than a local fix claim.

## Closeout Binding Plan

- Reviewed inputs: this goal, all three AGENTS.md files, owner docs, compiler/
  linter configs, baselines, gate contracts, and the fixed Gateway port source.
- Frozen target: activation-time HEAD and tree identities from `.`,
  `../ceal-cli`, and `../ceal-agent`, plus Gateway port source commit
  `3cb729ba5d6f76ff6796e60a541454ff9ebbc924`; rebind after semantic changes.
- Fresh-eye: distinct bounded reviewer and counterweight pass, separate from
  the primary's direct command evidence.
- Verification lock: exact local gate and mutation/restore result artifacts in
  the owning checkout; any later source/config edit reopens the affected proof.
- Complete flip: only after slice logs, local commits, fresh-eye evidence,
  final verification, non-claims, and retro dispositions are recorded, then
  default check passes and the artifact is marked complete.

## Off-Goal Findings

- `corca-ai/charness#671` — upstream portability defect: reject host-specific
  absolute paths in portable goal artifacts; do not duplicate or close it here.
- Linux-only Worker/Agent proof, signed publication, and remote CI remain
  separately approved work.
- `noPropertyAccessFromIndexSignature` remains a named compiler-owned successor
  candidate, not a custom ratchet.

## Final Verification

Preparation-only. On 2026-08-18, the default artifact check and
`--pursue-ready` both exited 0 before this cleanup; rerun both after this edit.
No implementation, runtime, push, release, or remote proof is claimed.

## User Verification Instructions

1. Start from Gateway `ceal` and read all three AGENTS.md files.
2. Verify roots and current HEAD/tree identities with explicit `git -C` roots.
3. Run the default checker and `--pursue-ready` on this exact artifact.
4. Activate exactly with the `Activation:` line above.
5. Start with Lane A; do not push, watch CI, apply/restart, live-read, or
   regenerate a baseline. If Lane A deletion is unproven, record why and stop
   dependent slices.

## Auto-Retro

Retro not run — no implementation work unit has closed. Run `charness:retro` at
closeout and disposition every surfaced improvement as applied or a tracked
issue.

## Claim Ledger

| claim | source | re-check command |
| --- | --- | --- |
| all three rule sets load before activation | three AGENTS.md files | from Gateway: `git -C . rev-parse --show-toplevel`; same for `../ceal-cli` and `../ceal-agent`; read each AGENTS.md |
| activation identities are current | three Git checkouts | `git -C . rev-parse HEAD`; same explicit roots; record tree identity before implementation |
| Worker raw replacement exists | `../ceal-cli/package.json` and raw scripts | `rg -n "lint:types:raw" ../ceal-cli/package.json ../ceal-cli/scripts ../ceal-cli/test` with a positive control |
| old ratchet has no live consumer | Worker scripts/tests/config | first hit the raw-route control, then search declared roots for ratchet names and record zero only after the control succeeds |
| compiler/linter owns source diagnostics | Worker/Agent configs and raw routes | inspect owning configs; run each declared raw typecheck/lint route and read direct exit codes |
| noNonNullAssertion rationale is live before Lane C | `../ceal-cli/biome.json:30`, `../ceal-cli/docs/gates.md:103-107` | read both, enable the rule, rerun Biome, reread the owner doc |
| every port is receiving-owned and reachable | source closure plus receiving package/gate contracts | inspect package/check/hook reachability; run retained-input mutation red and snapshot-restore green |
| Agent cleanup preserves paid diagnostics | two Agent baseline JSON files | compute key-set diffs, require all retained non-zero keys, run both TS7/TS6 lanes and checker tests |
| synthetic sentinel is Gateway fixture-only | Gateway packaging test and Agent source tree | read `../ceal/scripts/agent-runtime/customer-package-deb.test.ts:197-212`; inspect both boundaries before a port edit |
| no duplicate issue #671 is created | current goal and upstream issue record | do not run issue creation; if status is ever needed, use the existing issue record only |
