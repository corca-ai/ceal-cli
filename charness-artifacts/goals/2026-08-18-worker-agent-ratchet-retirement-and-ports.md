# Achieve Goal: Worker and Agent ratchet retirement and gate ports

Status: active
Created: 2026-08-18
Activation: /goal @../ceal-cli/charness-artifacts/goals/2026-08-18-worker-agent-ratchet-retirement-and-ports.md

This is the living goal scratchpad. It is inert until the operator runs the
activation command.

## Active Operating Frame

- Current disposition: active; Lane A, the orthogonal temporary-TypeScript-fixture
  performance slice, D1a source-NUL gate port, Worker Markdown gate, D1 receiving-local
  import hard-failure gate, Worker/Agent Secretlint gates, and Agent-local duplicate
  detector have implementation, targeted proof, and local commits. The full Gateway
  loader-rewrite ratchet remains deliberately unported; D1 is complete and Lane B is
  the next dependency-safe slice.
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
- Next action: begin Lane B compiler-option measurement and source repair, keeping the
  A → D1 → B → C → D2 → E dependency order intact.
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
| lint:import-hard-failures (portable import-resolution subset) | Worker and Agent | no Gateway loader-rewrite parity claim |
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

### D1 import-resolution boundary: receiving-local hard failures only

The fresh-eye decision records a deliberate non-equivalence. Gateway's
`LOADER_REWRITE` list is a ratchet for a future `tsx`/bare-Node migration, not a
portable sibling error class. Worker and Agent may therefore implement a
receiving-owned `lint:import-hard-failures` route that keeps only these claims:

1. a static source import whose target is absent under every receiving resolver
   is a hard failure with no baseline;
2. a path declared by a receiving CI step, hook, npm script, or adapter that is
   absent is a hard failure with no baseline;
3. Agent `config/typecheck-baseline*.json` diagnostic records are excluded from
   path-declaration scanning, and their entries are not regenerated or paid by
   this route;
4. `.js` to `.ts` `LOADER_REWRITE` entries are neither scanned as sibling
   failures nor counted as green parity with Gateway.

The route must be receiving-owned and reachable from package scripts, the
appropriate full check and hook, and a contract test. Its contract test must
show a real missing target red and restore the pre-mutation snapshot green.
Any future removal of the `.js` convention or `tsx`-aware loading is a separate
emitted-tree/runtime migration and must not be hidden inside this subset.

### D1 receiving-local secret and duplicate gate contract

Worker and Agent secretlint routes, and the Agent duplicate detector, must each
declare their own dependency/lockfile, config, scan roots, fixture/allowlist
policy, package route, check/hook reachability, and failure behavior. Gateway's
Slack fixture scope and Agent-runtime jscpd threshold are not portable defaults.
The retained-input proof must disable or bypass any cache, show a live-shaped
secret or duplicate mutation red, restore from a snapshot, and show the same
route green. No baseline, count-only ratchet, or stale allowlist may be used to
manufacture green output.

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
| D1 | Port structural gates independent of explicit-any | closure, reachability, mutation/restore | completed — import hard failures, Secretlint, and Agent duplicate detector proven |
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
- Commits: Worker fixture commits `3cda8f22992d63c8aa164c8a0f3f12d166c96327`, `4b8eb268dba6f7306bb4771f81c5d4ab5de2eed7`, and `7f62094426c03622a63e75cc2869404ac6e00936`; Agent fixture commits `cbcf3b986825264aefda80a7fb487a93d03473cf` and `20438a0cea2b52e21b8622dc40e92def091dafe6`; no push or external boundary.
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
- Commits: Worker `106be90423109f3729d171b203a8d589369c2024`; Agent `7a940722f28c5e7f1092902f01d2e335cd6a3a43`; no push or external boundary.
- What changed: Added typed check-source-nul-bytes.ts implementations and retained-path tests in each sibling; wired normal and staged package scripts, check/lint chains, hooks, gate contracts, Worker gate docs, and Agent test-lane ownership. The receiving ports also import execFileSync, correcting the fixed Gateway source staged-mode omission.
- Alternatives rejected: Rejected a shared cross-repo helper, a diagnostic ratchet/baseline, a fail-closed change to the Gateway source contract, and scanning unchanged tracked files from the pre-commit staged route. Normal check owns all tracked source; staged pre-commit owns changed index paths.
- Targeted verification: Worker: source-NUL tests 4/4, repo-gates 54/54, staged and normal routes green, mutation raw NUL at scripts/check-no-legacy-mjs.ts:157 exit 1, snapshot restore hash a750859ec8c379da468686eb30c17c2fa7e980ab and routes green, check:unit proof job passed exit 0 in 41875 ms. Agent: source-NUL and gate-contract tests 11/11, quality-gates 9/9, staged and normal routes green, mutation at scripts/check-no-legacy-mjs.ts:136 exit 1, snapshot restore hash c92bdb3089f598b4312d7a06846e3dbaea815f02 and routes green, check:contributor proof job passed exit 0 in 28993 ms. Agent npm run check reached lint and quality green but its Linux runtime lane refused on macOS with linux_runtime_requires_linux.
- Test duplication pressure: Added one focused source-integrity test family per receiving repository because the new gate owns a distinct verdict; Worker contract inventory and Agent test-lane contract prove reachability. No duplicate scripts test family remains.
- Critique: Parent-delegated medium fresh-eye lenses covered reachability, byte/index portability, and source-of-truth scope. All three returned findings; both sibling reviewer fingerprints returned ok true, verdict clean, drift empty. Accepted Gateway-inherited staged changed-path scope and unreadable-file skip as source contract. Tracked newline-delimited Git path serialization as a follow-up if newline-bearing source paths become in-scope; no D1a code blocker remains.
- Off-goal findings: No Gateway edit, push, CI watch, release, apply/restart, live readback, issue creation, or duplicate #671. No claim is made for Linux Agent runtime execution on this macOS host, CI, release, or live behavior.
- Lessons carried forward: A structural gate port is incomplete until the receiving check chain, staged hook route, declarative contract, test inventory, and mutation evidence all agree. A copied checker is not enough. Read the fixed source contract before “improving” inherited behavior.
- Metrics: Fast targeted routes were sub-second; Worker check:unit proof duration was 41875 ms and Agent check:contributor was 28993 ms. These are local gate durations, not a performance claim.

### Slice 4: Lane D1 — Worker Markdown lint receiving gate

- Objective: Give the Worker an honest, locally owned Markdown quality gate with full and staged routes, package/check/hook reachability, a declarative contract, and retained-input mutation proof.
- Why this approach: Gateway `scripts/check-markdown.sh` combines markdownlint with an upstream Charness authoring preflight that the Worker does not own. A typed markdownlint-only route preserves the receiving repository's useful docs enforcement while making the missing preflight surface explicit instead of copying an unowned compatibility tree.
- Commits: Worker `ada59b34e8461fed400e748585a4a36a37bbaa75`; no push or external boundary.
- What changed: Added a local `.markdownlint-cli2.jsonc` policy and exact `markdownlint-cli2` dependency; added typed `scripts/check-markdown.ts` full/staged routes, a root typed API declaration, focused contract tests, package/check/pre-commit/gate-contract wiring, and Worker gate documentation. Existing Markdown violations exposed by the newly enforced full route were repaired. The proof also exposed a top-level-test race in `test/contract/repo-build.test.ts`; its timeout fixture now injects a per-call build environment instead of mutating global `process.env.PATH`, and `test/repo-build.ts` carries that environment through the supervisor.
- Alternatives rejected: Rejected copying Gateway's Charness wrapper or cached Charness source, weakening the local policy, adding a baseline/ratchet, and claiming full Gateway authoring-preflight equivalence. Rejected keeping the global `PATH` mutation and teaching operators to serialize tests; the retained harness now accepts an isolated environment.
- Targeted verification: `node --test test/contract/check-markdown.test.ts` 4/4; combined Markdown plus repo-build contract tests 26/26; `npm run lint`, raw tools typecheck, reachability, gate-contract, normal/staged Markdown routes, and `git diff --check` passed. Worker `check:unit` proof result `/tmp/ceal-proof-jobs/worker-d1-markdown-check-unit/result.20260819-markdown-attempt4.json` passed exit 0 in 45215 ms. Worker full `check` result `/tmp/ceal-proof-jobs/worker-d1-markdown-check/result.20260819-markdown-check-attempt1.json` passed exit 0 in 85640 ms with 69 pass, 1 skip, 0 fail. The commit pre-commit route also passed.
- Mutation/restore: With snapshot `/tmp/ceal-worker-markdown-proof.Q4Ya5N/README.md`, an injected extra blank line made `npm run lint:markdown` red with `README.md:3 MD012`; restoring from that snapshot returned SHA-256 `06719b795979b68b297b36f4f7a9b180fb4ec0692d1a65d4188023912a89c3d8` and the full route green. The staged contract's real violation path returned exit 1; the local-policy-absent path returned 2.
- Test duplication pressure: Added one focused gate contract because the new Markdown gate owns a distinct scope/verdict; the existing repo-build contract was repaired in place rather than duplicated. No diagnostic baseline or additional ratchet was created.
- Critique: Kant's bounded fresh-eye review accepted the partial receiving contract only because the Charness preflight omission is named in source, docs, and tests; it required local dependency/config, full/staged scope, hook/check reachability, and mutation proof. The primary rechecked those source claims and found no Act Before Ship blocker.
- Off-goal findings: The full check printed nine existing Knip hints and skipped gate-attestation recording because the checkout was intentionally dirty; both are recorded advisories, not hidden or reclassified as failures. No Gateway edit, Agent edit, push, CI watch, release, apply/restart, live readback, or issue creation occurred.
- Lessons carried forward: A receiving gate is only honest when its semantic delta from the producer is explicit. A broad test failure that came from global environment mutation was a harness-structure defect; repairing the per-call environment made the retained path parallel-safe rather than relying on a rerun.
- Metrics: Worker Markdown full route saw 19 files and 0 issues; `check:unit` took 45215 ms and full `check` took 85640 ms. These are local command observations, not compiler-only or cross-host benchmarks.

### D1 disposition: import-resolution receiving-port review

- Observation: the Gateway checker, run with explicit sibling roots, reports Worker `loader-rewrite` 170 with no local policy and Agent `loader-rewrite` 396 plus 10 dangling references named only inside the two Agent baseline JSON files; both commands exit 1.
- Critical review: Worker and Agent intentionally use `.js` relative source specifiers with NodeNext and `rewriteRelativeImportExtensions`; the Gateway checker itself defines this class as a TypeScript-aware-loader ratchet for eventual `tsx` removal, not as an ordinary broken import. The Agent baseline-only references are not source declarations and must not be turned into a regenerated baseline.
- Disposition: tracked with owner `D1 import-resolution design`; do not port an empty/seeded baseline, do not replace the source contract with a hard-failure-only approximation, and do not run the broad `--fix` rewrite without a bounded fresh-eye review plus emitted-tree/runtime proof. This is a deferred implementation boundary, not a green claim.
- Recheck: from Gateway, `node scripts/check-import-resolution.ts --repo-root /Users/ted/codes/ceal-cli` and the same command for `/Users/ted/codes/ceal-agent`; positive controls are the Gateway `config/import-resolution-policy.json` and the sibling `rewriteRelativeImportExtensions`/`.js` source hits recorded in the Claim Ledger.
- Off-goal: no sibling source rewrite, baseline regeneration, push, CI watch, release, apply/restart, live readback, or issue creation occurred.

### D1 decision review: full-ratchet boundary and receiving-local gates

- Review artifact: Gateway `charness-artifacts/critique/2026-08-19-d1-import-gate-port-20260819.md`; validator passed with one artifact.
- Fresh-eye result: three unnamed parent-delegated reviewers independently rejected porting the full `loader_rewrite` ratchet, accepted a narrow hard-failure subset only after this contract revision, and recommended receiving-local secretlint plus Agent duplicate detection.
- Boundary proof: the Gateway, Worker, and Agent reviewer windows all returned `ok: true`, `verdict: clean`, `drift: []` after reviewer delivery. The exact snapshots and re-check commands are recorded in the critique artifact.
- Decision: rename the sibling route to `lint:import-hard-failures`; retain true unresolvable and invoked-path failures without a baseline; exclude Agent diagnostic-record JSON; defer `.js`/`.ts` loader migration to a separately proved emitted/runtime slice.
- Next implementation: begin Lane B compiler-option measurement and source repair;
  Agent duplicate detection is closed in Slice 7.

### Slice 5: D1 — receiving-owned Secretlint gates

- Objective: Add a local secret scanner to Worker and Agent with explicit rules,
  receiving scan roots, staged projection, package/check/hook reachability, and
  mutation proof without a diagnostic baseline or success cache.
- Why this approach: Secretlint is a linter-owned source policy, while Gateway's
  fixture and allowlist shape is not a portable receiving contract. Each sibling
  therefore owns its dependency, config, tracked/staged file projection, and test
  fixture policy.
- Commits: Worker `ae238fe25063ca35e2627744a982fd4cb1ec7155`; Agent
  `868daa1645a8609d71aa513edcec3c1b23f92e8e`; no push or external boundary.
- What changed: Added Secretlint and four local rule packages, `.secretlintrc.json`
  and `.secretlintignore`, typed tracked/staged runners, focused contract tests,
  package/check or lint reachability, staged pre-commit hooks, gate-contract entries,
  and local documentation. Worker keeps its exact synthetic CLI Slack fixture
  isolated; Agent keeps test files in the standard scan and has no synthetic bypass.
  Knip config-driven dependency ownership was declared before the commits landed.
- Alternatives rejected: Rejected a baseline, a success cache, a broad Slack
  allowlist, ignoring tests, and copying Gateway's scope without checking the
  receiving package and hook contracts.
- Targeted verification: Worker and Agent `npm run lint:secrets` and staged routes
  passed; Worker `npm run lint` and raw tools typecheck passed; Agent `npm run lint`
  and raw tools typecheck passed. The combined import/Secretlint contract tests
  passed 10/10 in each sibling, including staged projection and an isolated
  live-shaped GitHub-token rejection.
- Mutation/restore: Worker snapshot
  `/tmp/ceal-worker-secretlint-proof.zQMJ1y/check-no-legacy-mjs.ts` had SHA-256
  `fe8bf68a9814dfd979b91129820d0534ef6899215adf0ba7c4d6b6658ff6582d`; a live-shaped
  token mutation made plain `npm run lint:secrets` exit 1, snapshot restoration
  returned the same hash and exit 0. Agent snapshot
  `/tmp/ceal-agent-secretlint-proof.sNDv1L/check-no-legacy-mjs.ts` had SHA-256
  `cb14fb7ad3e0b6a50b5af8ad6e9148f2239762c9edea29853dade931470fe107`; the same
  red/restore-green sequence passed. The earlier inert cache-variable wording was
  removed from docs; the runner has no cache and the durable proof uses the plain
  route.
- Critique: The delivered fresh-eye review found missing staged-projection coverage
  and an unsupported cache-proof claim; both were repaired in the contract tests and
  docs before the final commits. The evidence is recorded in
  `charness-artifacts/critique/2026-08-19-d1-secretlint-implementation-20260819.md`,
  and the primary re-ran the receiving lint and mutation routes.
- Off-goal findings: No Gateway source edit, push, CI watch, release, apply/restart,
  live readback, issue creation, or duplicate #671. Worker commit output retained
  three existing Knip configuration hints; disposition is deferred to the Worker
  quality-cleanup owner, not hidden or used as a reason to bypass the gate.

### Slice 6: D1 — receiving-local import hard-failure gate

- Objective: Add a portable hard-failure-only import/reference check to Worker and
  Agent while explicitly excluding Gateway loader-rewrite parity and diagnostic
  baseline regeneration.
- Why this approach: The Gateway checker reports `.js`→`.ts` loader-rewrite entries
  as a future runtime migration ratchet. Worker and Agent already declare
  NodeNext/rewrite-relative-import conventions, so the receiving route retains only
  absent runtime-relative targets and receiving-owned `scripts/`/`bin/` declarations.
- Commits: Worker `3125684` (`gate: add receiving import hard-failure check`), Agent
  `1781068` (`gate: add receiving import hard-failure check`), and Gateway critique
  record `6f24ba8f9`; no push or external boundary.
- What changed: Added typed AST scanners with no baseline or `--fix`, diagnostic
  baseline exclusion, normal and staged package routes, full-check/lint and hook
  wiring, gate-contract entries, local docs, virtual behavior tests, and temporary
  Git-index tests. The staged route enumerates the complete index and reads blobs
  with `git cat-file`, so staged additions and staged target deletions cannot be
  masked by working-tree content.
- Alternatives rejected: Rejected porting the full Gateway loader-rewrite ratchet,
  regenerating a baseline, scanning only changed path names in staged mode, and
  accepting the first implementation's working-tree/index mixture.
- Targeted verification: Both normal and staged import routes passed. Worker and
  Agent import contract tests passed 6/6; full Worker and Agent lint passed; raw
  tools typechecks passed; gate-contract checks passed; both sibling commits ran
  their pre-commit staged routes successfully.
- Mutation/restore: Final Worker snapshot
  `/tmp/ceal-worker-import-hard-final-proof.MDvzrE/check-no-legacy-mjs.ts` had SHA-256
  `fe8bf68a9814dfd979b91129820d0534ef6899215adf0ba7c4d6b6658ff6582d`; injecting a
  missing `.mjs` import made `npm run lint:import-hard-failures` exit 1, restoring
  the snapshot matched the hash and returned exit 0. Agent snapshot
  `/tmp/ceal-agent-import-hard-final-proof.i135aO/check-no-legacy-mjs.ts` had SHA-256
  `cb14fb7ad3e0b6a50b5af8ad6e9148f2239762c9edea29853dade931470fe107`; the same
  red/restore-green result passed.
- Critique: The first bounded fresh-eye review caught the staged false-green and
  missing index tests. The repair was re-read, tested against staged additions and
  deletions, and boundary fingerprints for the final attempted review window
  returned `ok: true`, `verdict: clean`, and `drift: []`. The evidence and the
  host-blocked post-repair retry are recorded in
  `charness-artifacts/critique/2026-08-19-d1-import-hard-failures-implementation-20260819.md`;
  the retry is recorded as non-evidence rather than claimed as a completed final
  review.
- Off-goal findings: Extensionless or dynamically assembled path references and a
  future bare-runtime `.js` migration remain deferred; no full Gateway parity claim
  is made. No push, CI watch, release, apply/restart, live readback, issue creation,
  or duplicate #671 occurred.

### Slice 7: D1 — Agent-local duplicate detector

- Objective: Add the final D1 structural gate in Agent with a local TypeScript
  scope, measured threshold, real report evaluation, package/check/hook/test-lane
  reachability, and retained-input mutation proof.
- Why this approach: Gateway's jscpd threshold and persistent report/cache shape
  are not portable defaults. Agent measured 44 clones across 259 selected files,
  564 duplicated lines, and 1.05% duplication with tests excluded; the receiving
  policy therefore pins a 1.2% threshold, `minLines: 5`, and `minTokens: 60`.
  The policy has no baseline, count cache, store path, or intentional-pair entry.
- Commits: Agent `ac26dcc298a4400ff46db5ff0d412f9e88f1a263`
  (`gate: add Agent duplicate detector`); Gateway critique artifact commit
  `67afbec6a42451490e9a22f0c9896c15c870eda6`; no push or external boundary.
- What changed: Added `jscpd@4.2.5` with lockfile ownership, `.jscpd.json`,
  `scripts/run-jscpd-duplicates.ts`, a real subprocess/report contract test,
  source test-lane registration, package/lint/check/pre-commit/gate-contract
  wiring, Knip config-driven dependency ownership, and contributor docs. The
  runner invokes jscpd with a temporary report and non-blocking tool threshold,
  evaluates the JSON itself, treats successful no-clone/no-report output as zero,
  and rejects policy drift or a nonempty allowlist.
- Repair during critique: The first fresh-eye review found that synthetic report
  tests did not execute the actual subprocess/report route and that permissive
  numeric parsing could admit an ineffective policy. The final test runs the
  real local binary against a clean fixture (exit 0, no-clone report omission)
  and a duplicate fixture (exit 1, 50% report); policy parsing now rejects
  threshold `101` and pins the measured values. The previously omitted Agent
  import/Secretlint contract tests were also registered in `config/test-lanes.json`
  when the owner runner exposed the coverage mismatch.
- Targeted verification: `npm run lint` passed; `npm run test:source --
  test/public/check-duplicates.test.ts` passed 6/6; `npm run lint:duplicates`
  passed at 1.05%; the Agent commit hook passed staged import, duplicate,
  Secretlint, lockfile, source-NUL, capability, typecheck, quality, and staged
  lint gates. Gateway critique validation passed for one artifact.
- Mutation/restore: final source snapshot
  `/tmp/ceal-agent-duplicate-final-proof.4kGDbp/audit-types.ts` had SHA-256
  `b254786dcd1ca63b0cbb25eb7bcecd022db48ca169e14387136e0afacb5c6c55`. Two
  retained duplicate blocks made plain `npm run lint:duplicates` exit 1 with
  45 clones, 671 duplicated lines, and 1.24% (threshold 1.2%). Restoring with
  the named snapshot matched the SHA-256, and the same route returned exit 0
  with 44 clones, 564 duplicated lines, and 1.05%.
- Critique: Fresh-eye satisfaction is parent-delegated. The reviewer returned
  the two blockers above plus a non-blocking threshold-ownership concern; the
  primary re-read the source, repaired the blockers, and reran the final route,
  test, lint, and mutation proof. The review is recorded in Gateway
  `charness-artifacts/critique/2026-08-19-d1-agent-duplicate-implementation-20260819.md`;
  its validator passed and the final Agent reviewer boundary returned
  `ok: true`, `verdict: clean`, and `drift: []` before repair edits.
- Off-goal findings: No Gateway source edit, push, CI watch, release,
  apply/restart, live readback, issue creation, or duplicate #671. Linux,
  remote-CI, release, and runtime proof remain non-claims. D1 is complete;
  Lane B is the next local slice.

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
port verification passed in both sibling checkouts. D1 import hard-failure and
Worker/Agent Secretlint gates, and Agent duplicate detection now have local
commits, contract reachability, and mutation/restore evidence. D1 is complete;
the later compiler/linter lanes remain. No compiler-only timing, Linux-only
runtime, push, release, or remote proof is claimed.

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
| Gateway import-resolution is the fixed source contract, and its full loader-rewrite port is not baseline-free green in either sibling | Gateway `scripts/check-import-resolution.ts:112-154,460-525` and fixed source commit `3cb729ba5d6f76ff6796e60a541454ff9ebbc924` | `git -C /Users/ted/codes/ceal diff --quiet 3cb729ba5d6f76ff6796e60a541454ff9ebbc924 -- scripts/check-import-resolution.ts config/import-resolution-policy.json scripts/check-import-resolution.test.ts`; from Gateway run the checker against each explicit sibling root and read direct exit codes/counts |
| Worker and Agent `.js` relative imports are an existing NodeNext convention, not evidence that a hard-failure-only checker is an equivalent import-resolution port | Worker `tsconfig.typecheck.json:2-23`; Agent `tsconfig.build.json:2-22`; positive-control source imports in each tree | `rg -n "rewriteRelativeImportExtensions|from ['\"]\./.*\\.js['\"]|from ['\"]\.\./.*\\.js['\"]" /Users/ted/codes/ceal-cli/tsconfig.typecheck.json /Users/ted/codes/ceal-cli/packages /Users/ted/codes/ceal-agent/tsconfig.build.json /Users/ted/codes/ceal-agent/src /Users/ted/codes/ceal-agent/scripts --glob '*.json' --glob '*.ts'`; retain the observed probe counts (Worker 170, Agent 396) without regenerating either policy |
| Gateway markdown wrapper cannot be copied into Worker as a complete source port because its authoring preflight delegates to upstream Charness and the receiving checkout has no owned helper/package surface | Gateway `scripts/check-markdown.sh:1-28`, `scripts/check_doc_authoring_preflight.py:1-6`; Worker `package.json:16-83`; Agent `package.json:40-100`, `scripts/lint-staged-files.ts:27-127` | `rg --files /Users/ted/codes/ceal-cli | rg 'check-markdown|check_doc_authoring_preflight|markdownlint|lint-staged'` and the corresponding Agent command; use the known-present Agent `lint:markdown`/`markdownlint-cli2` entries as the positive control |
| D1 markdown item is scoped to a Worker-owned markdownlint docs gate; upstream Charness authoring preflight is an explicit out-of-scope dependency, not a silently dropped equivalent | Goal D1 table `markdown lint | Worker` at lines 124-139; Gateway markdown script above; Charness ownership rule in the three AGENTS.md files | before implementation, inspect the Worker package/hook/full-check contract and add a Worker-local scope/contract test that names markdownlint-only behavior and the preflight exclusion; do not copy cached or upstream Charness source |
| Worker Markdown full and staged routes are receiving-owned and reachable | Worker `scripts/check-markdown.ts:3-82`, `package.json:44-50`, `.githooks/pre-commit:48`, `config/gate-contract.json`, and `test/contract/check-markdown.test.ts:28-64` | from `/Users/ted/codes/ceal-cli`: `node --test test/contract/check-markdown.test.ts`; `npm run lint:markdown`; `npm run lint:markdown:staged`; `node test/gate-contract-lib.ts`; read each direct exit code |
| Worker Markdown scope excludes artifacts and uses distinct full/staged Git projections | Worker `scripts/check-markdown.ts:18-41`; `docs/gates.md:43-57`; contract test positive control `docs/gates.md` | from `/Users/ted/codes/ceal-cli`: `node --test test/contract/check-markdown.test.ts`; verify the test selects `README.md` and excludes `charness-artifacts/ignored.md`, then run `npm run lint:markdown` and `npm run lint:markdown:staged` |
| Worker Markdown gate is intentionally not Gateway Charness-preflight equivalent | Gateway `scripts/check-markdown.sh:1-28`, `scripts/check_doc_authoring_preflight.py:1-6`; Worker `scripts/check-markdown.ts:3-7`, `test/contract/check-markdown.test.ts:61-63`, `docs/gates.md:53-57` | `git -C /Users/ted/codes/ceal show 3cb729ba5d6f76ff6796e60a541454ff9ebbc924:scripts/check-markdown.sh`; `rg -n "markdownlint only|check_doc_authoring_preflight" /Users/ted/codes/ceal-cli/scripts/check-markdown.ts /Users/ted/codes/ceal-cli/test/contract/check-markdown.test.ts /Users/ted/codes/ceal-cli/docs/gates.md` |
| Worker Markdown mutation guard detects a retained violation and restores intended work from a current snapshot | Worker quality/impl records; `/tmp/ceal-worker-markdown-proof.Q4Ya5N/README.md`; `scripts/check-markdown.ts:51-70` | inject one extra blank line into `README.md`, require `npm run lint:markdown` exit 1 with `README.md:3 MD012`, restore from `/tmp/ceal-worker-markdown-proof.Q4Ya5N/README.md`, compare SHA-256 `06719b795979b68b297b36f4f7a9b180fb4ec0692d1a65d4188023912a89c3d8`, and require the route green |
| Worker markdownlint API dependency is typed and reachable without an ignore or baseline | Worker `scripts/check-markdown.ts:14-16,44-67`, `types/markdownlint-cli2.d.ts:1-8`, `tsconfig.tools.json`, `package.json:84` | from `/Users/ted/codes/ceal-cli`: `npm run lint:types:raw:tools`; `npm run lint:reachability`; `node --test test/contract/check-markdown.test.ts` |
| The broad Worker proof is green after repairing a retained global-environment test race | Worker `test/repo-build.ts:99-104,118-146`; `test/contract/repo-build.test.ts:327-364`; proof results under `/tmp/ceal-proof-jobs/worker-d1-markdown-check-unit/` and `/tmp/ceal-proof-jobs/worker-d1-markdown-check/` | from Gateway: `node scripts/run-proof-job.ts --name worker-d1-markdown-check-unit --run-id 20260819-markdown-attempt4 --cwd /Users/ted/codes/ceal-cli -- npm run check:unit`; `node scripts/run-proof-job.ts --name worker-d1-markdown-check --run-id 20260819-markdown-check-attempt1 --cwd /Users/ted/codes/ceal-cli -- npm run check`; read the exact result JSONs |
| Current import-resolution sibling probes remain red for a semantic reason, not a missing search | Gateway `scripts/check-import-resolution.ts:20-44,491-535`, `config/import-resolution-policy.json`; Worker/Agent `rewriteRelativeImportExtensions` configs and positive `.js` source imports | from Gateway: `node scripts/check-import-resolution.ts --repo-root /Users/ted/codes/ceal-cli` and `node scripts/check-import-resolution.ts --repo-root /Users/ted/codes/ceal-agent`; record Worker 170 loader-rewrite and Agent 396 loader-rewrite plus 10 baseline-only dangling references; do not regenerate either policy |
| D1 import hard-failure route is intentionally not full Gateway loader-rewrite parity | Goal `D1 import-resolution boundary` and critique `charness-artifacts/critique/2026-08-19-d1-import-gate-port-20260819.md`; Gateway checker `scripts/check-import-resolution.ts:20-44,106-115,500-515` | from Gateway rerun the checker against both explicit sibling roots and retain loader-rewrite as excluded; from each sibling run `npm run lint:import-hard-failures` plus its contract test and final mutation proof |
| Agent typecheck baseline JSON is diagnostic data, not an invoked path surface | Agent `config/typecheck-baseline.json`, `config/typecheck-baseline-ts6.json`; critique F2 | from Gateway: run the receiving hard-failure route with a positive control path in a package/hook/config file and inspect that baseline JSON paths do not enter the scan; never use `--write-baseline` or update-baseline routes |
| D1 secretlint and duplicate gates are local contracts, not copied Gateway scopes | critique F3 and D1 receiving-local secret/duplicate gate contract | inspect each receiving dependency/lockfile, config, scan roots, fixture/allowlist, package/check/hook reachability; Worker/Agent Secretlint and Agent duplicate are proven as receiving-local gates |
| D1 decision review is fresh-eye complete and boundary-clean | Gateway critique artifact and `/tmp/d1-decision-{gateway,worker,agent}-20260819.json` | run `python3 /Users/ted/.codex/plugins/cache/local/charness/6.2.0/shared/scripts/reviewer_boundary_fingerprint.py verify` once per explicit root with its matching snapshot/window; require `ok: true`, `verdict: clean`, and `drift: []` |
| Worker and Agent Secretlint are receiving-owned and reachable | Worker/Agent `scripts/run-secretlint.ts:8-139`, package scripts, `.githooks/pre-commit`, gate contracts, and contract tests | from `/Users/ted/codes/ceal-cli`: `npm run lint:secrets`, `npm run lint:secrets:staged`, `node --test test/contract/check-secretlint.test.ts`; from `/Users/ted/codes/ceal-agent`: same routes and `node --test test/public/check-secretlint.test.ts` |
| Secretlint mutation proof is cache-independent and restored from current snapshots | Worker/Agent `test/*/check-secretlint.test.ts:69-93,65-85`; `/tmp/ceal-worker-secretlint-proof.zQMJ1y/check-no-legacy-mjs.ts`; `/tmp/ceal-agent-secretlint-proof.sNDv1L/check-no-legacy-mjs.ts` | mutate a retained source with an assembled live-shaped token, require plain `npm run lint:secrets` exit 1, restore with the named snapshot, compare the recorded SHA-256, and require the same route exit 0 |
| Worker and Agent import hard-failure routes use receiving-owned AST checks and no baseline | Worker `scripts/check-import-hard-failures.ts:51-211`; Agent `scripts/check-import-hard-failures.ts:43-179`; package/hook/contract surfaces | from each explicit sibling root: `npm run lint:import-hard-failures`, `npm run lint:import-hard-failures:staged`, and the corresponding `node --test test/contract/check-import-hard-failures.test.ts` or `node --test test/public/check-import-hard-failures.test.ts` |
| D1 staged import routes read the Git index and catch staged additions/deletions | Worker/Agent `scripts/check-import-hard-failures.ts:75-105,182-195` / `67-97,168-178`; staged projection tests at Worker `test/contract/check-import-hard-failures.test.ts:50-70` and Agent `test/public/check-import-hard-failures.test.ts:51-71` | run the two import contract tests; each creates a temporary Git index where working-tree content differs from the staged blob and where a target deletion is staged, requiring both failures |
| D1 import mutation proof is final-code red/restore-green | Gateway critique `charness-artifacts/critique/2026-08-19-d1-import-hard-failures-implementation-20260819.md`; `/tmp/ceal-worker-import-hard-final-proof.MDvzrE/check-no-legacy-mjs.ts`; `/tmp/ceal-agent-import-hard-final-proof.i135aO/check-no-legacy-mjs.ts` | inject `import "./__ceal_missing_import_proof__.mjs";` into the retained script, require each plain `npm run lint:import-hard-failures` exit 1, restore from its snapshot, compare SHA-256, and require exit 0 |
| D1 implementation boundary review and index repair are recorded honestly | Gateway critique `charness-artifacts/critique/2026-08-19-d1-import-hard-failures-implementation-20260819.md` F1-F4; Worker commit `3125684`; Agent commit `1781068` | run `python3 /Users/ted/.codex/plugins/cache/local/charness/6.2.0/shared/scripts/reviewer_boundary_fingerprint.py verify` against `/tmp/d1-import-worker-final-20260819.json` and `/tmp/d1-import-agent-final-20260819.json`; require `ok: true`, `verdict: clean`, and `drift: []`; do not claim the host-blocked post-repair retry as a delivered review |
| Agent duplicate policy owns a measured local scope and no portable Gateway default | Agent commit `ac26dcc298a4400ff46db5ff0d412f9e88f1a263`: `.jscpd.json`, `scripts/run-jscpd-duplicates.ts`, `CONTRIBUTING.md` | from `/Users/ted/codes/ceal-agent`: run `npm run lint:duplicates`; require the direct result `44 clones across 259 files, 564 duplicated lines (1.05%)` below the pinned 1.2% threshold; inspect `.jscpd.json` for `src`/`scripts`, TypeScript-only scope, test exclusion, and empty allowlist |
| Agent duplicate wrapper has real report evaluation, no persistent cache, and test-lane reachability | Agent `scripts/run-jscpd-duplicates.ts`, `test/public/check-duplicates.test.ts`, `config/test-lanes.json`, package/hook/gate contracts | from `/Users/ted/codes/ceal-agent`: run `npm run test:source -- test/public/check-duplicates.test.ts`, `npm run lint:gate-contract`, and `npm run lint`; require 6/6 contract tests, contract PASS, and lint exit 0; inspect the test's clean/no-report and duplicate/report subprocess fixtures and assert no `--store`/`--store-path` |
| Agent duplicate gate policy fails closed on drift and retains no allowlist/baseline | Agent `scripts/run-jscpd-duplicates.ts:51-94`; `.jscpd.json`; `test/public/check-duplicates.test.ts:37-47` | from `/Users/ted/codes/ceal-agent`: run `npm run test:source -- test/public/check-duplicates.test.ts`; require the threshold-101 malformed-policy assertion and inspect that the runner rejects nonempty `allowlist`, pins 5 lines/60 tokens/1.2%, and has no baseline/update route |
| Agent duplicate mutation proof is final-code red and snapshot-restore green | Agent commit `ac26dcc298a4400ff46db5ff0d412f9e88f1a263`; `/tmp/ceal-agent-duplicate-final-proof.4kGDbp/audit-types.ts` SHA-256 `b254786dcd1ca63b0cbb25eb7bcecd022db48ca169e14387136e0afacb5c6c55`; Slice 7 record | inject two duplicate blocks into the retained file and run `npm run lint:duplicates`, requiring exit 1 at 1.24%; restore with the named snapshot, compare SHA-256, and require the same route exit 0 at 1.05%; never restore from HEAD |
| Agent duplicate implementation received a fresh-eye critique and repair | Gateway `charness-artifacts/critique/2026-08-19-d1-agent-duplicate-implementation-20260819.md`, commit `67afbec6a42451490e9a22f0c9896c15c870eda6`; Agent reviewer window `/tmp/d1-duplicate-agent-20260819.json` | from `/Users/ted/codes/ceal`: run `python3 scripts/validate_critique_artifacts.py --repo-root . --paths charness-artifacts/critique/2026-08-19-d1-agent-duplicate-implementation-20260819.md`; recheck the matching reviewer window with `python3 /Users/ted/.codex/plugins/cache/local/charness/6.2.0/shared/scripts/reviewer_boundary_fingerprint.py verify --repo-root /Users/ted/codes/ceal-agent --before /tmp/d1-duplicate-agent-20260819.json --window-id d1-duplicate-agent-20260819` and record parent-attributed post-review edits rather than claiming them as reviewer drift |
