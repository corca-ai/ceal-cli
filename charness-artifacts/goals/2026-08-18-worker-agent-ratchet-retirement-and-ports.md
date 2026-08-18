# Achieve Goal: Worker and Agent ratchet retirement and gate ports

Status: active
Created: 2026-08-18
Activation: /goal @../ceal-cli/charness-artifacts/goals/2026-08-18-worker-agent-ratchet-retirement-and-ports.md

This is the living goal scratchpad. It is inert until the operator runs the
activation command.

## Active Operating Frame

- Current disposition: active; Lane A, the orthogonal temporary-TypeScript-fixture
  performance slice, and D1a source-NUL gate port have implementation, targeted proof,
  and fresh-eye review complete. D1 remains in progress for its remaining structural
  gates; the D1a sibling commits are the immediate local closeout boundary.
- Execution boundary: activate from the Gateway checkout. Treat the three
  repositories as one sibling checkout set; run every Worker/Agent command with
  explicit roots (`git -C .`, `git -C ../ceal-cli`, `git -C ../ceal-agent`).
- Activation record: verified before implementation from Gateway: Gateway
  `/Users/ted/codes/ceal` at HEAD
  `52353035cb6e9ca860b0e5d48c21e1ebfc73f861` tree
  `3dbd1ee5711aa0d5f97519a6be692444997a16c8`; Worker
  `/Users/ted/codes/ceal-cli` at HEAD
  `51c8c7160d260b2f25390a64367fead869e840b7` tree
  `677f7f4a9cb130ae64b27e441ec215b805498a62`; Agent
  `/Users/ted/codes/ceal-agent` at HEAD
  `47b68bc1e780efce8091606f9d7df8f583fcf7f0` tree
  `62c95af716a460f7dbe8919f515cd0ca66c01f42`. Preparation identities are
  historical, not freeze values.
- Ownership: Worker changes belong in `../ceal-cli`; Agent changes belong in
  `../ceal-agent`; Gateway is read-only input for Lane D; this control artifact
  remains Worker-owned.
- Next action: commit the Worker and Agent D1a slices locally, then continue D1 with the
  remaining independent structural gates; keep the A → D1 → B → C → D2 → E dependency
  order intact.
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
| A | Retire Worker ratchet after raw replacement proof | raw coverage, no-consumer search, mutation red, restore green | completed |
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

Lane A implementation and proof are recorded in Slice 1 below. The temporary
TypeScript fixture performance slice is recorded in Slice 2. The Worker commit
hook's historical diagnostic output was used as a lead, not treated as raw
compiler replacement proof.

### Slice 1: Lane A — retire Worker typecheck diagnostic ratchet

- Objective: Replace the Worker diagnostic ratchet with direct raw TypeScript compiler ownership, repair the last tools-project source errors, and prove the deletion boundary before dependent lanes.
- Why this approach: The active goal forbids a regenerated baseline or replacement ratchet and requires compiler-owned diagnostics plus mutation-red and snapshot-restore-green proof before deleting the manager.
- Commits: Local Worker commit: retire Worker typecheck diagnostic ratchet; no push or external boundary.
- What changed: Updated package.json aliases, typed test/contract/repo-gates.test.ts, source-gate contract, docs/gates.md, and .githooks/pre-commit wording; deleted scripts/check-typecheck-ratchet.ts, its baseline, and the ratchet-only contract test.
- Alternatives rejected: Rejected baseline regeneration, a second deletion shape, a new diagnostic manager, and a deleted-file exists assertion; the retained manifest negative assertion plus raw-route/no-consumer evidence is sufficient for this boundary.
- Targeted verification: npm run lint:types:raw:packages exit 0; raw:tools exit 0; raw:tests exit 0; npm run lint:types exit 0; node --test test/contract/typecheck-source-gate.test.ts 7/7; node --test test/contract/repo-gates.test.ts 50/50; bash .githooks/pre-commit exit 0. Mutation inserted const laneAMutationRedProof: string = 1; raw:tools exited 1 with TS2322; restored from /tmp/ceal-lane-a-closeout-snapshot.jGxPox; restore hash matched 4d6de97ed7f43a7e2cbe816c410a7f8aa6f10347f9d7fe30407f6d4e9e27ab84 and raw:tools returned 0.
- Test duplication pressure: No new test file or duplicate test family; existing source/gate contracts were repaired and extended, and pre-commit duplicate-literal/unused/reachability checks passed with existing advisory hints only.
- Critique: Fresh-eye satisfaction: parent-delegated; three named deletion lenses plus a separate counterweight returned findings, and all four shared-tree fingerprint verifies were clean. Cite cascade and sibling-boundary lenses found no Act Before Ship code issue. Counterweight required goal closeout records, bundled stale pre-commit wording cleanup, classified deleted-file assertion as over-worry, and classified the retired ratchet file/code/count stability contract as an intentional non-claim.
- Off-goal findings: No push, CI watch, release, apply/restart, live readback, issue creation, or Gateway/Agent source edit. Issue #671 was not duplicated.
- Lessons carried forward: Raw compiler routes must be proven directly before deleting a diagnostic manager; mutation restore must use the current snapshot rather than HEAD. Keep the retired ratchet's diagnostic-shape loss explicit as a non-claim. Next locally decidable slice is the user-supplied temporary-tsconfig fixture performance inventory in Worker and Agent, kept orthogonal to D1.
- Metrics: Raw routes and targeted contracts were sub-second to low-single-digit seconds; repo-gates completed in 2.76s and pre-commit completed successfully. No broad verification-lock or external proof was run.

### Slice 2: Temporary TypeScript fixture compiler scope in Worker and Agent

- Objective: Reduce ambient TypeScript library work only in temporary fixture programs that validate artifact or tools/test compilation, while preserving production declaration checking and source diagnostics.
- Why this approach: The Gateway measurement identified a large createProgram cost from unconstrained default libs and ambient packages. The sibling trace found one Worker artifact helper and one Agent tools/test lane that own temporary configs; their class does not assert declaration-file internals or arbitrary ambient packages.
- Commits: Local commits are pending: one Worker fixture/quality/goal-record commit and one Agent fixture/quality commit; no push or external boundary.
- What changed: Worker test/artifact-workspace.ts now constrains the temporary compiler to lib ES2022, skipLibCheck, and Node types. Agent tsconfig.tools-tests.json now declares lib ES2022; its public quality test asserts lib/skipLibCheck/types/include, and src/codex-responses.ts adds an explicit type-only node:stream/web adapter for the dependency exposed by the narrower lib.
- Alternatives rejected: Rejected a repo-wide skipLibCheck or lib change, types: [] (the fixture needs Node ambient types), lib.dom, baseline regeneration, and a new benchmark harness. Production tsconfig.build.json files and existing diagnostic baselines were not changed.
- Targeted verification: Worker: npm run lint:types:raw:tools exit 0; node --test test/client-artifact.test.ts exit 0 with 4/4; git diff --check exit 0. Agent: npm run lint:types:source, npm run lint:types:tools, npm run lint:types:ts6, and npm run test:quality all exit 0; the quality suite is 9/9, both compiler lanes retain equal 279/100 diagnostic counts, and git diff --check exits 0. Agent's first narrowed-lib run was red with TS2304 for ReadableStreamReadResult; the explicit type-only import restored both lanes green. Fresh-eye round 1 plus counterweight and round 2 found no Act Before Ship blocker; Worker and Agent reviewer-boundary verifies returned ok: true, verdict: clean, drift: [].
- Test duplication pressure: The Worker retained artifact test family was reused rather than duplicated. The Agent existing public quality-gate test was extended to pin the temporary-config contract. No baseline or ratchet was regenerated.
- Critique: Parent-delegated fresh-eye covered fixture boundary, runtime economics, and type portability, followed by a separate counterweight and a repaired-proof round 2. The only actionable finding was wording precision in the Worker comment; it now states ES2022 and Node types rather than implying Node ambient types are absent. The Agent assertions were confirmed to read the tools/test config, not production config.
- Off-goal findings: No Gateway source edit, push, CI watch, release, apply/restart, live readback, or issue creation. The Agent quality-adapter bootstrap conflict was preserved without migration because it is unrelated to this slice. No claim is made for compiler-only timing, other OS/Node versions, browser/DOM fixtures, CI, release, or a diagnostic-count reduction.
- Lessons carried forward: Fixture class must be established before narrowing compiler libraries: Node-owned artifact/tools tests can use ES2022 plus explicit Node types, while production typecheck must keep its declaration-checking policy. A narrower lib is also a useful proof pressure because it exposes ambient source dependencies that should become typed adapters.
- Metrics: Single local /usr/bin/time observations (directional, not a benchmark): Worker node --test test/client-artifact.test.ts real 1.27s before to 1.16s after, test duration about 1241ms to 1107ms; Agent npm run lint:types:tools real 2.94s before to 2.65s after repair. These include setup/orchestration and assertions, not just createProgram. Next goal slice remains D1 after this orthogonal quality slice is closed.

### Slice 3: Lane D1a — source NUL structural gate port

- Objective: Port the Gateway source-NUL structural gate to Worker and Agent with receiving-owned scripts, staged pre-commit coverage, contract reachability, and direct mutation/restore proof.
- Why this approach: The fixed Gateway gate catches a raw source byte that makes recursive searches silently skip a file. The port is independent of explicit-any and keeps compiler/linter ownership without adding a baseline or diagnostic manager.
- Commits: Local Worker and Agent implementation commits are pending at this record; no push or external boundary.
- What changed: Added typed check-source-nul-bytes.ts implementations and retained-path tests in each sibling; wired normal and staged package scripts, check/lint chains, hooks, gate contracts, Worker gate docs, and Agent test-lane ownership. The receiving ports also import execFileSync, correcting the fixed Gateway source staged-mode omission.
- Alternatives rejected: Rejected a shared cross-repo helper, a diagnostic ratchet/baseline, a fail-closed change to the Gateway source contract, and scanning unchanged tracked files from the pre-commit staged route. Normal check owns all tracked source; staged pre-commit owns changed index paths.
- Targeted verification: Worker: source-NUL tests 4/4, repo-gates 54/54, staged and normal routes green, mutation raw NUL at scripts/check-no-legacy-mjs.ts:157 exit 1, snapshot restore hash a750859ec8c379da468686eb30c17c2fa7e980ab and routes green, check:unit proof job passed exit 0 in 41875 ms. Agent: source-NUL and gate-contract tests 11/11, quality-gates 9/9, staged and normal routes green, mutation at scripts/check-no-legacy-mjs.ts:136 exit 1, snapshot restore hash c92bdb3089f598b4312d7a06846e3dbaea815f02 and routes green, check:contributor proof job passed exit 0 in 28993 ms. Agent npm run check reached lint and quality green but its Linux runtime lane refused on macOS with linux_runtime_requires_linux.
- Test duplication pressure: Added one focused source-integrity test family per receiving repository because the new gate owns a distinct verdict; Worker contract inventory and Agent test-lane contract prove reachability. No duplicate scripts test family remains.
- Critique: Parent-delegated medium fresh-eye lenses covered reachability, byte/index portability, and source-of-truth scope. All three returned findings; both sibling reviewer fingerprints returned ok true, verdict clean, drift empty. Accepted Gateway-inherited staged changed-path scope and unreadable-file skip as source contract. Tracked newline-delimited Git path serialization as a follow-up if newline-bearing source paths become in-scope; no D1a code blocker remains.
- Off-goal findings: No Gateway edit, push, CI watch, release, apply/restart, live readback, issue creation, or duplicate #671. No claim is made for Linux Agent runtime execution on this macOS host, CI, release, or live behavior.
- Lessons carried forward: A structural gate port is incomplete until the receiving check chain, staged hook route, declarative contract, test inventory, and mutation evidence all agree. A copied checker is not enough. Read the fixed source contract before “improving” inherited behavior.
- Metrics: Fast targeted routes were sub-second; Worker check:unit proof duration was 41875 ms and Agent check:contributor was 28993 ms. These are local gate durations, not a performance claim.

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

Lane A local verification completed on 2026-08-19: all three raw TypeScript
routes, targeted source/gate contracts, the mutation-red/restore-green proof,
and the Worker pre-commit gate passed. The temporary fixture slice also passed
its Worker artifact test, Agent source/tools/TS6 type lanes, Agent quality tests,
quality-artifact validators, and round-2 boundary checks. D1a source-NUL gate
port verification passed in both sibling checkouts; the overall goal remains
active for the remaining D1 gates and later compiler/linter lanes. No
compiler-only timing, Linux-only runtime, push, release, or remote proof is
claimed.

## User Verification Instructions

1. Start from Gateway `ceal` and read all three AGENTS.md files.
2. Verify roots and current HEAD/tree identities with explicit `git -C` roots.
3. Run the default checker and `--pursue-ready` on this exact artifact.
4. Activate exactly with the `Activation:` line above.
5. Start with Lane A; do not push, watch CI, apply/restart, live-read, or
   regenerate a baseline. If Lane A deletion is unproven, record why and stop
   dependent slices.

## Auto-Retro

Retro not run — Lane A and the temporary fixture slice are closed as local
implementation units, but the goal continues into the planned gate/compiler
lanes. The quality artifacts record the validator correction and its disposition.
The Worker and Agent auto-retro probes returned `state: not-established` with
`configuration_status: adapter-missing`; I therefore chose to defer the short
session retro to goal closeout rather than treat the missing answer as a clean
no-retro verdict.
Run `charness:retro` at goal closeout and disposition every surfaced
improvement as applied or a tracked issue.

## Claim Ledger

| claim | source | re-check command |
| --- | --- | --- |
| all three rule sets load before activation | three AGENTS.md files | from Gateway: `git -C . rev-parse --show-toplevel`; same for `../ceal-cli` and `../ceal-agent`; read each AGENTS.md |
| activation identities are current | three Git checkouts | `git -C . rev-parse HEAD`; same explicit roots; record tree identity before implementation |
| Worker raw replacement exists | `../ceal-cli/package.json` and raw scripts | `rg -n "lint:types:raw" ../ceal-cli/package.json ../ceal-cli/scripts ../ceal-cli/test` with a positive control |
| old ratchet has no live consumer | Worker scripts/tests/config | first hit the raw-route control, then search declared roots for ratchet names and record zero only after the control succeeds |
| Lane A raw routes are green after ratchet deletion | Worker `package.json:29-36`, raw compiler projects, Slice 1 proof | from `../ceal-cli`: run `npm run lint:types:raw:packages`, `npm run lint:types:raw:tools`, `npm run lint:types:raw:tests`, and read each direct exit code |
| Lane A mutation guard is real and restored without losing intended work | retained `test/contract/repo-gates.test.ts` plus `/tmp/ceal-lane-a-closeout-snapshot.jGxPox` | mutate `test/contract/repo-gates.test.ts`, require `npm run lint:types:raw:tools` nonzero, restore from the snapshot, require the same route green, and compare SHA-256 |
| pre-commit labels the type gate as raw compiler ownership | Worker `.githooks/pre-commit:9,45,73` | `rg -n -i "type ratchet|raw TypeScript compiler|type checks" ../ceal-cli/.githooks/pre-commit` |
| Worker temporary artifact compiler is constrained without changing production typecheck | `../ceal-cli/test/artifact-workspace.ts:29-50`; `../ceal-cli/test/client-artifact.test.ts:14-19` | from `../ceal-cli`: run `npm run lint:types:raw:tools` and `node --test test/client-artifact.test.ts`; read the temporary config producer and retained 4-test setup |
| Agent temporary tools/test compiler is constrained and explicitly asserted | `../ceal-agent/scripts/typecheck-tools-tests.ts:132-150`; `../ceal-agent/tsconfig.tools-tests.json:15-24`; `../ceal-agent/test/public/quality-gates.test.ts:40-45` | from `../ceal-agent`: run `npm run lint:types:tools`, `npm run lint:types:ts6`, and `npm run test:quality`; inspect `evaluateLane()` and the quality contract |
| fixture timing is directional end-to-end observation, not compiler-only proof | Slice 2 metrics; quality artifacts under `../ceal-cli/charness-artifacts/quality/` and `../ceal-agent/charness-artifacts/quality/` | repeat `/usr/bin/time -p` around the same commands; do not generalize one sample without a structured timing capture |
| Gateway source-NUL contract is the fixed input for D1a | Gateway commit `3cb729ba5d6f76ff6796e60a541454ff9ebbc924`: `scripts/check-source-nul-bytes.ts:24-63` and `scripts/check-source-nul-bytes.test.ts:44-47` | `git -C /Users/ted/codes/ceal show 3cb729ba5d6f76ff6796e60a541454ff9ebbc924:scripts/check-source-nul-bytes.ts`; run both receiving source-NUL test files |
| D1a normal and staged routes are receiving-owned and reachable | Worker/Agent package scripts, hooks, gate contracts, and test-lane contracts | from each explicit sibling root: `npm run lint:source-nul-bytes`, `npm run lint:source-nul-bytes:staged`, and the retained contract tests |
| D1a retained-input mutation is real and restored from current snapshots | D1a quality/impl records and `/tmp/ceal-d1-worker-nul-proof.kNDgRI`, `/tmp/ceal-d1-agent-nul-proof.OV2924` | inject a raw NUL into `scripts/check-no-legacy-mjs.ts`, require `npm run lint:source-nul-bytes` exit 1, restore with the named snapshot, compare hashes, and require tracked/staged routes exit 0 |
| D1a staged route intentionally covers changed index paths while normal route covers all tracked source | Gateway source lines `44-50`; Worker `docs/gates.md` source-NUL section; receiving checker comments | inspect the fixed Gateway source and run each receiving `:staged` route against the staged index; do not claim pre-commit scans unchanged tracked files |
| D1a unreadable-file skip is inherited source behavior, not a fail-closed diagnostic claim | Gateway `scripts/check-source-nul-bytes.test.ts:44-47` and receiving tests | run the unreadable-file tests; keep this behavior unchanged unless a future source-contract slice explicitly changes it |
| D1a path serialization remains a tracked follow-up, not a new port divergence | Gateway `scripts/ratchet-policy-lib.ts:55-58` and both receiving local `gitLines` helpers | inspect the three newline-delimited implementations; if newline-bearing source paths become in-scope, design one shared NUL-safe contract before changing either port |
| Agent full Linux gate is platform-scoped on this macOS host | Agent `AGENTS.md:40-48`, `.githooks/pre-push:22-27`, and proof-job result `agent-d1-source-nul-check` | on Linux run `npm run check`; on this host run `npm run check:contributor`; read the direct result artifact |
| compiler/linter owns source diagnostics | Worker/Agent configs and raw routes | inspect owning configs; run each declared raw typecheck/lint route and read direct exit codes |
| noNonNullAssertion rationale is live before Lane C | `../ceal-cli/biome.json:30`, `../ceal-cli/docs/gates.md:103-107` | read both, enable the rule, rerun Biome, reread the owner doc |
| every port is receiving-owned and reachable | source closure plus receiving package/gate contracts | inspect package/check/hook reachability; run retained-input mutation red and snapshot-restore green |
| Agent cleanup preserves paid diagnostics | two Agent baseline JSON files | compute key-set diffs, require all retained non-zero keys, run both TS7/TS6 lanes and checker tests |
| synthetic sentinel is Gateway fixture-only | Gateway packaging test and Agent source tree | read `../ceal/scripts/agent-runtime/customer-package-deb.test.ts:197-212`; inspect both boundaries before a port edit |
| no duplicate issue #671 is created | current goal and upstream issue record | do not run issue creation; if status is ever needed, use the existing issue record only |
