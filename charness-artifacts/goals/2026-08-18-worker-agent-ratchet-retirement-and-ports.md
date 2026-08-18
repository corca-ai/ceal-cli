# Achieve Goal: Worker and Agent ratchet retirement and gate ports

Status: draft
Created: 2026-08-18
Activation: /goal @../ceal-cli/charness-artifacts/goals/2026-08-18-worker-agent-ratchet-retirement-and-ports.md
Timebox: no operator-supplied duration; continue through the next valuable bounded slice and stop at the proof boundary.
Activation time: record the host, sibling roots, and three checkout identities when the next session starts.
Closeout reserve: reserve the final bundle for cross-checkout identity, local gates, mutation/restore evidence, fresh-eye review, and explicit non-claims.
Done-early policy: continue_next_improvement within the local scope; never turn done-early continuation into push, CI watch, release, apply, or live readback.

This file is the living goal scratchpad. It becomes active only when the user
runs the activation command.

## Active Operating Frame

- Current disposition: real draft/backlog. This is the Worker/Agent half of a
  two-goal split authored 2026-08-18. The sibling goal
  ../ceal/charness-artifacts/goals/2026-08-18-gateway-type-debt-and-gate-audit.md
  owns Gateway source work. The three repositories are sibling checkouts on one
  machine; they are not independent machine lanes and no session may pretend a
  copied host path is an authority.
- Execution host: activate from the Gateway ceal checkout so its AGENTS.md and
  three-repository rules are loaded first. Discover the other roots with
  git -C ../ceal-cli rev-parse --show-toplevel and
  git -C ../ceal-agent rev-parse --show-toplevel; do not execute this goal
  from an independently-running Worker session.
- Current slice: none started. The first implementation slice is the Worker
  ratchet retirement pilot because it is the only lane measured at one file
  from zero and it tests whether raw compiler checks can replace hand-managed
  diagnostic bookkeeping.
- Next action: read all three repository rules and the current target
  identities, run the pursue-readiness check, then repair the Worker's
  test/contract/repo-gates.test.ts diagnostics. Only after the raw checks and
  mutation/restore proof are green may the custom ratchet be deleted.
- Enforcement policy: compiler and linter options are the source of truth for
  code-quality diagnostics. Custom code remains only for structural, packaging,
  repository, or cross-surface contracts that the compiler/linter cannot own.
  No diagnostic ratchet or baseline regeneration may be added to avoid paying a
  compiler/linter migration.
- Verification cadence: cheap deterministic checks at commit boundaries;
  each meaningful slice re-derives its own scope and runs direct mutation/red
  and snapshot-restore/green proof; a bounded fresh-eye review closes each
  cross-surface or deletion slice.
Gate cadence: narrow checks while a slice is in flight; run the broad local
bundle only at --verification-lock after all slice dependencies are coherent;
no push, remote-CI watch, release, apply, or live readback is part of this
activation.

## Goal

Reduce hand-managed quality state across the Worker and Agent while preserving
real structural gates:

- retire the Worker's typecheck diagnostic ratchet once its raw compiler
  replacement is proven across the Worker projects;
- enable the measured compiler options and the lint rules that are currently
  disabled, including noNonNullAssertion and no-explicit-any, repairing code
  with guards, typed adapters, and ordinary source changes rather than new
  baselines;
- port Gateway structural gates into the repositories that need them, with
  receiving-repository wiring and mutation proof rather than dead copied files;
- remove only provably paid entries from the Agent's two typecheck baselines,
  retaining non-zero diagnostics and both TS6/TS7 lanes.

The rule is simple: compiler/linter enforcement should own source-level
correctness; repo-owned gates should own boundaries the compiler/linter cannot
see; hand-maintained diagnostic ratchets should not sit between the two.

## Scope Boundary With The Sibling Goal

- This goal owns changes in the sibling checkouts ../ceal-cli (Worker) and
  ../ceal-agent (Agent). The goal control artifact lives in
  ../ceal-cli/charness-artifacts/goals/; Agent-owned implementation, baseline,
  test, and proof artifacts remain in ../ceal-agent.
- The Gateway checkout ceal is read-only input for Lane D. Port sources are
  read from Gateway commit
  3cb729ba5d6f76ff6796e60a541454ff9ebbc924 with
  git -C . show PORT_COMMIT:PORT_SOURCE_PATH. If the Gateway source or tree changes before
  the port slice, rebind the source identity and re-review the closure.
- The runtime-path restriction is a Gateway packaging-fixture contract, not a
  live Agent source file. Gateway
  scripts/agent-runtime/customer-package-deb.test.ts:197-212 creates the
  synthetic distRoot/ceal-agent/src/esm-sentinel.js fixture, and
  config/runtime-path-resolution-policy.json records that fixture surface.
  Do not create, move, or rename ../ceal-agent/src/esm-sentinel.js to satisfy
  this goal; update the Gateway fixture only if a port genuinely changes that
  fixture contract.
- No executable command in this artifact depends on a host-specific absolute
  path. The activation host resolves sibling roots and records the actual
  identities before implementation.

## Lane A — retire the Worker typecheck ratchet (the pilot)

Distance is per project, not per repository. Worker packages and tests are
both at zero; tools holds one file,
test/contract/repo-gates.test.ts, with 92 diagnostics. Re-derive this from
the baseline and raw compiler output at activation; do not treat the draft
number as proof after the checkout moves.

The payoff is quantified in the preparation snapshot:
scripts/check-typecheck-ratchet.ts (271 lines), its baseline (38), and
test/contract/typecheck-ratchet.test.ts plus
test/contract/typecheck-source-gate.test.ts (249) total about 558 lines.
lint:types:raw:* already exists as the replacement, so no substitute
diagnostic manager is permitted.

Acceptance for Lane A:

1. Snapshot the Worker's relevant scripts, baseline, configs, tests, and
   package scripts before mutation.
2. Repair the one remaining project/file to zero under the raw compiler route.
3. Prove the raw route for every Worker project that the old ratchet covered,
   and show the package/check wiring reaches those routes.
4. Search for ratchet consumers with a positive control: the search must find a
   known present raw route or package script before a zero consumer result is
   interpreted as absence.
5. Delete the ratchet implementation, baseline, and ratchet-only tests only
   after their failure mode is unreachable and no live caller remains.
6. Mutate a retained source/config input so the raw replacement is red with a
   direct nonzero exit, restore from the pre-mutation snapshot, and require the
   same raw route to be green again with the intended diff intact.
7. Do not rewrite or regenerate a baseline as the retirement mechanism.

Two honest outcomes are allowed: the deletion lands with the complete proof, or
the slice stops with a falsifiable reason in Slice Log. A failed deletion
does not authorize a second deletion shape or a baseline rewrite in this goal.
Independent read-only preparation may continue, but no downstream source slice
is closed on an unproven replacement.

Then evaluate the Agent's baseline/checker shape separately. This goal does not
silently claim that 379 Agent diagnostics can be retired by deleting its
baseline; Lane E is only the paid-entry cleanup unless a later, explicitly
recorded slice proves an equivalent raw replacement.

## Lane B — configure the compilers

strict: true is set in every TypeScript project in both checkouts; the
preparation measurement found the following costs against zero baselines:

| option | Worker packages | Agent build |
| --- | ---: | ---: |
| noFallthroughCasesInSwitch | 0 | 0 |
| noImplicitReturns | 0 | 0 |
| noImplicitOverride | 1 | 0 |
| noUnusedLocals | 0 | 1 |
| noUnusedParameters | 0 | 3 |
| noUncheckedIndexedAccess | 9 | 73 |
| exactOptionalPropertyTypes | 9 | 95 |

All seven measured options are in scope for compiler enforcement. Apply them
to every owning project that the raw check actually compiles, not just the
first table row, and repair diagnostics in source. The compiler owns the
result immediately; no ratchet is allowed.

noPropertyAccessFromIndexSignature remains a separately-sized readability
migration because the preparation measurement found about 1600 diagnostics in
Worker packages alone. It is not an accepted permanent exception and it must
not be replaced by a custom ratchet. Reopen it as an explicit compiler-option
slice after this bundle, with a measured migration plan and the same
compiler-owned enforcement policy.

Re-derive option cost with the owning repository's declared raw typecheck
command and direct tsc invocation where the command is intentionally a
measurement. Count compiler diagnostics from the command's unfiltered result;
do not use npx tsc -p x, because it can consume -p as the wrong command layer.

## Lane C — remove disabled lint escape hatches

The existing off sites are historical policy exceptions, not evidence that
the rules should remain off. This lane retires those exceptions and aligns
their owner docs in the same slice:

| site | rule | required change |
| --- | --- | --- |
| ../ceal-agent/eslint.config.ts:36 | @typescript-eslint/no-explicit-any | enable it; replace boundary any with unknown, narrow guards, or typed SDK adapters; let ESLint own future enforcement |
| ../ceal-cli/biome.json:30 | noNonNullAssertion | enable it; remove options[index]!, map/index assertions, and equivalent sites with explicit guards or helpers; update ../ceal-cli/docs/gates.md:103-107 so the old bounds-check rationale is no longer a live exception |

The preparation count is not an acceptance criterion. The linter/compiler
result, source-level type guards, and owner documentation are. as const is
the settled intentional exception unless the active source/config contract
proves otherwise; it is not a reason to leave noNonNullAssertion disabled.

The earlier draft placed noUncheckedIndexedAccess before this lane. Keep that
dependency: remeasure assertion sites after Lane B and repair them once against
the final index/optional types. Do not solve new diagnostics by adding
non-null assertions or by weakening the rule.

## Lane D — port structural gates in with their contracts

| gate | source | receiving checkout | policy |
| --- | --- | --- | --- |
| lint:import-resolution | Gateway | Worker and Agent | required; preserve the source commit/tree and full helper/policy/test closure |
| lint:secrets | Gateway | Worker and Agent | required for Worker signed release and Agent signed service-runtime release |
| lint:source-nul-bytes | Gateway | Worker and Agent | required; preserve the NUL-byte search contract |
| lint:explicit-any | Gateway | Worker and Agent | required after Lane C; compiler/linter result, not a new any-count ratchet |
| markdown lint | Gateway and Agent | Worker | required where the receiving repo's docs gate reaches it |
| duplicate detector | Gateway and Worker | Agent | required; keep the Agent's own allowlist and scope |

lint:node-modules-drift, ported to both repositories on 2026-08-18, is the
worked example: receiving configuration and allowlists stayed local, the
script was typed on entry, and mutation proved the gate before landing.

Every new port must name and prove its complete closure:

- source commit, source files, local helpers, policy/config, tests, and
  platform assumptions;
- receiving files, package script, gate-contract entry, hook/full-check
  reachability, and CI job or an explicit local-only non-claim;
- receiving allowlists and scan roots, with no copied source-specific path
  silently retained;
- a retained-input mutation that makes the gate red with a direct nonzero
  exit, followed by snapshot restore and a direct green exit;
- a fresh-eye review for the cross-surface port.

Split this lane around the rule dependency: D1 covers structural ports that do
not depend on the new explicit-any rule, and D2 closes lint:explicit-any
after Lane C. A copied script that is not reachable from the receiving gate is
not a port.

## Lane E — clear stale content inside the Agent's baselines

The Agent's two typecheck baselines currently carry 137 and 136 zero-count
entries against 113 and 114 non-zero entries. Re-derive these counts from
../ceal-agent/config/typecheck-baseline.json and
../ceal-agent/config/typecheck-baseline-ts6.json at activation.

Acceptance requires more than aggregate counts:

- compute the before/after key-set diff for each baseline;
- remove only zero-valued entries proven paid by the current raw checker;
- preserve every non-zero diagnostic entry and the TS7/TS6 lane distinction;
- run both declared typecheck lanes and their checker tests;
- prove no baseline-update command or min-merge path is being used to hide
  new diagnostics;
- record the exact removed-key evidence in the Agent-owned artifact or test
  output, not only in this control document.

The Agent's legacy .mjs ratchet remains because a tracked .mjs can still be
added and the guard mechanically enforces a live prohibition. Zero is not by
itself a retirement argument.

## Non-Goals

- No push, tag, publish, remote-CI watch, apply/restart, or live readback in
  this activation. CI/Linux proof and any split publication are separate
  external boundaries requiring their own approval.
- No edits to the Gateway checkout. Reading the fixed Gateway source commit for
  a port is in scope; implementing Gateway changes is owned by the sibling goal.
- No creation, move, or rename of a real Agent src/esm-sentinel.js; the
  relevant path is a synthetic Gateway packaging fixture.
- No custom diagnostic baseline, ratchet, grep count, or regeneration workflow
  may be added to make a compiler/linter migration appear green.
- No claim that either checkout becomes free of all any or all type
  assertions. The in-scope disabled rules must be enabled and paid; explicit
  intentional exceptions remain documented and narrow.
- noPropertyAccessFromIndexSignature is a deferred, separately-sized
  compiler migration, not a permanent safety exemption.

## Boundaries

- Activate from the Gateway checkout. Read AGENTS.md,
  ../ceal-cli/AGENTS.md, and ../ceal-agent/AGENTS.md before editing, then
  prove all three sibling roots with positive git rev-parse results.
- Each checkout proves itself; a green gate in one is not evidence for another.
- Source ownership is strict: Worker changes go to ../ceal-cli, Agent changes
  go to ../ceal-agent, Gateway source is read-only in this goal, and the
  control artifact is kept with the Worker-owned goal.
- A ported gate carries the receiving repository's configuration, not the
  source's, and is typed on entry wherever a compiler/linter gate owns the
  behavior.
- A gate or compiler replacement is proven by a mutation shown red and a
  snapshot restore shown green. Read exit codes directly without a pipe.
- Before a mutation, snapshot uncommitted intended work and restore from that
  snapshot, never from HEAD. Verify the restore by rerunning the same gate.
- Before every commit, parent-relative cached git diff --name-status must
  equal the intended path set. Classify every other dirty path as commit-now,
  intentionally leave, or discard-if-mine-and-disposable.
- Deleting a guard requires showing its failure mode is unreachable, not merely
  that it has never fired.
- External side effects are phase-scoped. This draft authorizes preparation and
  later local implementation only; it does not carry approval into push, CI,
  release, apply, or live runtime actions.

## User Acceptance

The user can verify that:

- the Worker diagnostic ratchet and its ratchet-only tests are gone only after
  raw compiler checks cover every former project and a mutation/restore proof
  shows the replacement still fails closed;
- all seven measured compiler options are enabled in their owning projects, the
  two disabled lint rules are enabled, the noNonNullAssertion rationale is
  removed or replaced in docs/gates.md, and source repairs use guards or
  typed boundaries rather than new assertions or baselines;
- each structural gate port names its Gateway source identity, receiving
  configuration and reachability, and has red/restore-green evidence;
- Agent baseline cleanup is a key-set change that removes only paid zero
  entries while retaining all non-zero TS6/TS7 diagnostics;
- local commits and exact proof records exist, while no push, remote-CI,
  release, apply, or live-readback claim is made.

The timing owner is Active Operating Frame; this section states outcomes only.

## Agent Verification Plan

### Low-Cost Checks

- read all three AGENTS.md files and verify sibling roots, uname, and the
  preparation commit identities;
- run check_goal_artifact.py --pursue-ready and the default goal artifact
  check on this draft before activation;
- inspect package scripts, gate contracts, compiler configs, baselines, and
  source-to-receiver closures with positive-control searches;
- run targeted raw typecheck/lint commands and baseline key-set/count checks;
- verify each intended commit's cached name-status before committing.

### High-Confidence Checks

- run the narrow slice tests and declared check routes for each owning checkout;
- run mutation/red and snapshot-restore/green proof for Lane A and every new
  port, reading the direct exit code;
- run the full local quality bundle only after the dependency order is complete;
- bind a distinct fresh-eye critique to the final cross-surface/deletion bundle;
- re-read the active goal artifact, commit identities, and proof records before
  any terminal status flip.

### External Or Live Proof

Skipped by scope: no push, remote CI, Linux-only proof, signed publication,
runtime apply/restart, Slack action, or live readback is authorized here.
Record those as explicit non-claims at closeout and reopen them only under a
separately approved boundary.

## Slice Plan

| Slice | Objective | Why Now | Expected Evidence | Status |
| --- | --- | --- | --- | --- |
| A | Retire the Worker diagnostic ratchet after raw replacement proof | It is the smallest deletion and establishes the no-ratchet recipe | raw project checks, no-consumer proof, mutation red, snapshot restore green, no baseline rewrite | pending |
| D1 | Port structural gates whose behavior does not depend on no-explicit-any | It preserves cross-repo boundary coverage before compiler/linter migrations | source/receiver closure, package/check/hook reachability, mutation/restore proof | pending |
| B | Enable all seven measured compiler options | Compiler owns source diagnostics immediately and shrinks custom enforcement | option config diff, targeted repairs, raw compiler proof, no ratchet | pending |
| C | Enable noNonNullAssertion and no-explicit-any and align docs | Disabled lint rules are the remaining source-level escape hatches | lint proof, typed guards/adapters, old rationale removed, no new assertions/baseline | pending |
| D2 | Close the explicit-any gate port | Its receiving behavior depends on Lane C's enabled rule | full closure and mutation/restore proof | pending |
| E | Remove only paid zero entries from Agent TS6/TS7 baselines | It is independent cleanup after the enforcement surface is stable | key-set diff, non-zero preservation, both lane checks | pending |
| Closeout | Bundle local proof and bind non-claims | The goal is cross-checkout and deletion-sensitive | fresh-eye, final identities, local gate results, explicit external non-claims | pending |

Order is A → D1 → B → C → D2 → E. If Lane A fails, record the falsifiable
reason and stop all dependent implementation; do not try a second deletion
shape or regenerate the baseline in this goal. Only independent read-only
evidence work may continue.

## Backlog Recount

- Counted: 4 open GitHub issues in corca-ai/ceal-cli, checked 2026-08-18 with
  gh issue list --repo corca-ai/ceal-cli --state open --limit 1000 --json number --jq length;
  local issue artifacts in the Worker checkout were also checked and counted
  as 0.
- Claims: none — this is a local Worker/Agent quality goal, not issue
  resolution.
- Not claimed: all 4 open corca-ai/ceal-cli issues; none is silently adopted
  by this goal.

## Operator Decision Queue

none — the consequential activation decisions were resolved before this draft
was prepared:

- activate from the Gateway context so all three-repository rules are loaded;
- keep this activation local-only with no push, CI watch, publish, apply, or
  live readback;
- let compiler/linter options own source-quality enforcement and minimize
  custom diagnostic-management code;
- enable all seven measured compiler options plus noNonNullAssertion and
  no-explicit-any; keep noPropertyAccessFromIndexSignature as a separately
  sized compiler migration, never a custom ratchet;
- use A → D1 → B → C → D2 → E, and stop dependent work if Lane A deletion
  cannot be proven;
- track the upstream Charness portability defect as issue #671 rather than
  pretending the local consumer artifact fixes the validator.

## Coordination Cues

- Phases: impl, quality
- Routing: charness:achieve — own the auditable goal lifecycle and activation
  boundary
- Routing: charness:impl — source/config/test changes in bounded slices
- Routing: charness:quality — compiler/linter/gate/baseline quality proof
- Routing: charness:critique — deletion and cross-surface fresh-eye review
- Fresh-eye: parent-delegated bounded readers plus a separate counterweight
  pass; the primary re-reads every load-bearing claim before acting on it
- Gather: n/a — no public source was gathered; local owner docs and source are
  the inputs
- Release: n/a — no release surface is touched
- Issue closeout: n/a — issue #671 is an upstream report tracked as an
  off-goal finding, not resolved by this goal
- Successor goal: none — if the deferred index-signature compiler migration
  remains open at closeout, record the successor artifact or explicit owner
  disposition there

## Discuss Before Activation

- Discuss before activation: RESOLVED 2026-08-18 — activate from the Gateway
  ceal checkout, verify all three sibling roots and AGENTS.md rules, keep
  the run local-only, prefer compiler/linter enforcement over custom ratchets,
  enable the named compiler/linter rules and refactor assertions/any, use the
  fixed Gateway source commit for ports, stop dependent work on an unproven
  Lane A deletion, and leave Linux/remote/runtime proof to separate approval.
  The host-dependent artifact-path defect was filed as corca-ai/charness#671.

## Slice Log

No implementation slice has started. Preparation only: the original draft was
fresh-eye reviewed, the portability issue was filed upstream, and this artifact
is being reshaped while it remains Status: draft.

## Context Sources

1. AGENTS.md — Gateway host rules, three-repository ownership, claim ledger,
   mutation/restore, external-boundary, and search discipline.
2. ../ceal-cli/AGENTS.md — Worker ownership, local gate and publication
   boundaries.
3. ../ceal-agent/AGENTS.md — Agent ownership, service-runtime boundary, and
   Agent artifact custody.
4. docs/dogfooding.md — which sibling checkout serves which surface.
5. docs/verification-philosophy.md — proof-level and non-claim language.
6. ../ceal-cli/docs/gates.md:103-107 — the existing non-null assertion
   rationale that Lane C must retire or replace.
7. ../ceal-agent/docs/roadmap.md and
   ../ceal-agent/docs/operator-acceptance.md — Agent quality baseline and
   platform-appropriate proof context; this goal runs as a separate local
   quality goal and does not reorder the Agent A4 program.
8. ../ceal/charness-artifacts/goals/2026-08-18-gateway-type-debt-and-gate-audit.md
   — sibling Gateway goal; read for boundary context, do not edit or wait on it.
9. Gateway commit 3cb729ba5d6f76ff6796e60a541454ff9ebbc924 — immutable source
   snapshot selected for Lane D at preparation time.

## Interview Decisions

- Problem framing: remove hand-managed diagnostic enforcement and strengthen
  compiler/linter enforcement while preserving structural gates.
- Execution context: Gateway ceal session with explicit sibling-root
  discovery; rejected independently-running ceal-cli activation because it
  can miss Gateway rules and three-repository ownership.
- Enforcement choice: enable the named compiler/linter rules and repair source;
  rejected new or regenerated diagnostic ratchets because they preserve the
  custom state the goal is removing.
- noNonNullAssertion: enable it and refactor the five preparation sites;
  rejected preserving the old bounds-check exception because the policy is to
  make the linter enforce the source contract.
- no-explicit-any: enable it and use unknown/guards/adapters at boundaries;
  rejected a textual occurrence count as acceptance.
- noPropertyAccessFromIndexSignature: defer only as a separately-sized
  compiler migration after the measured 1600-diagnostic cost; rejected a
  permanent off exception and rejected a custom ratchet.
- Slice order: A → D1 → B → C → D2 → E; rejected an ambiguous order because
  Lane A and noUncheckedIndexedAccess change the code and gate surfaces.
- Lane A failure: stop dependent implementation and record the falsifiable
  reason; rejected a second deletion shape and baseline rewrite in one goal.
- External boundaries: local-only; rejected carrying a prior split-push
  assumption into this activation.

## Plan Critique Findings

The original draft was read from frozen SHA
2c990dc7956192f396a844d3b1b396bc34209f73f98daf40b7a9f8077ce4e747 by three
bounded fresh-eye angles and a separate counterweight pass. The primary then
re-verified load-bearing claims against current source.

Act before activation: remove stale host-specific roots and the wrong cross-root
commands; replace the broken literal-pipe/line-count claim; specify Lane A/B/D/E
postconditions and wiring; remove the ambiguous push boundary; add the required
achieve sections and binding plan. These are folded into Scope, Lanes,
Boundaries, Verification, and Slice Plan.

Bundle with the goal: change noNonNullAssertion from an allegedly unreasoned
off to an explicit policy transition and align docs/gates.md; describe
esm-sentinel.js as a synthetic Gateway fixture; separate Worker coverage,
installed-binary proof, and Agent Linux proof; distinguish Worker signed
release from Agent signed service-runtime release. These are folded into Lanes,
Scope, Context, and non-claims.

Over-worry not carried: an immutable Gateway source SHA does not require a
second machine freeze; adding noPropertyAccessFromIndexSignature or a live
Agent sentinel file would expand this goal without proof of need. The option
remains a named follow-up, not a new custom gate.

Fresh-eye satisfaction: parent-delegated. No implementation or runtime claim
was accepted from a subagent without primary re-reading.

## Closeout Binding Plan

- Reviewed inputs: current goal text, all three AGENTS.md files, owner docs,
  compiler/linter configs, baselines, gate scripts/contracts, the sibling goal,
  and the frozen fresh-eye/counterweight findings; record the final review
  artifacts in Final Verification.
- Frozen target: at activation capture git -C ., git -C ../ceal-cli, and
  git -C ../ceal-agent full HEAD/tree identities, plus the Gateway port source
  commit; rebind if any semantic input changes.
- Fresh-eye: use a distinct delegated reviewer for the final deletion and
  cross-surface bundle, and keep the primary's direct command output as the
  different evidence channel.
- Verification lock: record exact local gate/mutation/restore commands and
  result artifacts in the owning checkout; a source/config edit after the lock
  requires rerunning the affected proof and rebinding the identity.
- Complete flip: only after slice logs, local commits, fresh-eye evidence,
  final verification, non-claims, and Auto-Retro dispositions are written may
  the goal status change from draft/active to a terminal status.

## Off-Goal Findings

- corca-ai/charness#671 — open, body_verified: true, owner
  corca-ai/charness: achieve should reject host-specific absolute paths in
  portable goal artifacts. The local goal now uses sibling-relative activation
  and root discovery; the Charness validator remains an upstream-owned
  follow-up and is not fixed or closed here.
- Linux-only Worker/Agent proof and any remote publication remain separate
  external work, not missing local implementation.
- The large noPropertyAccessFromIndexSignature migration remains a named
  compiler-owned successor candidate; no custom ratchet is proposed.

## Final Verification

Preparation-only verification: the original draft failed pursue-ready because
it lacked required sections, backlog fields, resolved discussion, and closeout
binding fields. After this edit, rerun the default goal check and
check_goal_artifact.py --pursue-ready; no implementation, runtime, push, or
remote proof is claimed by this section.

Retro: skipped: preparation-only draft; no implementation work unit has closed.
Host log probe: skipped: no live instance, runtime apply, or external side effect
was authorized.
Disposition review: skipped: no terminal closeout or issue resolution is being
claimed.

## User Verification Instructions

For the next session:

1. Start in the Gateway ceal checkout, not in an independently-running
   Worker checkout.
2. Read AGENTS.md, ../ceal-cli/AGENTS.md, and ../ceal-agent/AGENTS.md,
   then positively verify all three roots and current HEADs.
3. Run the goal artifact default check and --pursue-ready before activation.
4. Activate exactly:

   /goal @../ceal-cli/charness-artifacts/goals/2026-08-18-worker-agent-ratchet-retirement-and-ports.md

5. Keep the first active action to identity/readiness verification. The first
   code slice is Lane A; do not push, watch CI, apply a runtime, or claim
   Linux/live proof.

## Auto-Retro

Retro dispositions: not run — this session prepared and verified a draft but
did not execute an implementation work unit; run charness:retro at closeout
and disposition every improvement it surfaces.
Structural follow-up: issue #671 (recurs: portable goal artifacts accepted
host-specific absolute paths); the local consumer guard is applied in this goal,
and the upstream validator fix remains with corca-ai/charness.

## Claim Ledger

| claim | source | re-check command |
| --- | --- | --- |
| the active session must load all three repository rule sets | Gateway/Worker/Agent AGENTS.md | from Gateway root: git -C . rev-parse --show-toplevel; git -C ../ceal-cli rev-parse --show-toplevel; git -C ../ceal-agent rev-parse --show-toplevel; read each AGENTS.md |
| preparation machine is Darwin arm64 | host identity | uname -s; uname -m |
| preparation checkout identities | git state at preparation | git -C . rev-parse HEAD; git -C ../ceal-cli rev-parse HEAD; git -C ../ceal-agent rev-parse HEAD; re-record at activation |
| Gateway port source is the selected immutable commit | Gateway git object and source files | git -C . cat-file -t 3cb729ba5d6f76ff6796e60a541454ff9ebbc924; git -C . show --stat --oneline 3cb729ba5d6f76ff6796e60a541454ff9ebbc924 |
| Worker tools is one file from zero in the preparation snapshot | ../ceal-cli/charness-artifacts/quality/typecheck-ratchet-baseline.json | parse projects.tools.files, then run the Workers declared raw typecheck for the same project and compare the diagnostic file set |
| the Worker ratchet replacement already exists | ../ceal-cli/package.json:29-37 | rg -n "lint:types:raw|check-typecheck-ratchet|typecheck-ratchet" ../ceal-cli/package.json ../ceal-cli/scripts ../ceal-cli/test with a positive control for lint:types:raw |
| the old Worker ratchet has no live consumer after Lane A | Worker package/scripts/tests | first require the positive control above, then search the declared Worker source/test/config roots for check-typecheck-ratchet, ratchet baseline, and ratchet-only test names; record zero only after the control hit |
| Worker and Agent compiler options are compiler-owned | Worker/Agent tsconfigs and package scripts | run each owning repositories declared raw typecheck with each option enabled; read the direct exit code and diagnostic output |
| noNonNullAssertion has a current rationale that must be retired | ../ceal-cli/docs/gates.md:103-107, ../ceal-cli/biome.json:30 | read both files before Lane C, enable the rule, rerun Biome, and reread the owner doc after the source repair |
| Agent no-explicit-any is lint-owned after the flip | ../ceal-agent/eslint.config.ts:36 and boundary source files | run npm --prefix ../ceal-agent run lint with the rule enabled; acceptance is the linter result and typed boundary code, not a grep total |
| all seven measured compiler options are in scope | preparation table and current owning configs | inspect each owning tsconfig*.json, enable the options, and run the corresponding raw compiler commands; record per-project results in the slice ledger |
| noPropertyAccessFromIndexSignature is a separately-sized migration | Worker compiler measurement, about 1600 diagnostics | rerun the owning raw compiler with that option alone; keep it compiler-owned and record the successor decision |
| lint:import-resolution source closure includes more than one script | Gateway scripts/check-import-resolution.ts, helpers, policy, tests, and scripts/run-lint-suite.ts | git -C . show 3cb729ba5d6f76ff6796e60a541454ff9ebbc924:PORT_SOURCE_PATH for every closure file, then verify receiving package/gate/hook/CI reachability |
| every port is reachable and receiving-owned | source port files plus receiving package/gate contracts | run the receiving declared full gate, inspect the package script and gate contract, and record a retained-input mutation red plus snapshot-restore green |
| Agent baseline cleanup preserves paid diagnostics | ../ceal-agent/config/typecheck-baseline.json and typecheck-baseline-ts6.json | compute before/after key-set diffs, require all retained non-zero keys, then run both declared TS7/TS6 checker lanes and tests |
| Worker scripts coverage and installed-binary proof are different surfaces | ../ceal-cli/scripts/coverage-scripts.ts:72, ../ceal-cli/test/platform-proof.ts:14, CI workflow | read the source declarations and report local macOS non-claims separately from Linux/remote proof |
| no live Agent src/esm-sentinel.js is part of this goal | Gateway packaging test fixture and Agent source tree | read ../ceal/scripts/agent-runtime/customer-package-deb.test.ts:197-212 and confirm the receiving fixture/source boundary before any port edit |
| upstream portability defect is tracked | corca-ai/charness#671, body verified 2026-08-18 | gh issue view 671 --repo corca-ai/charness --json state,title,body,url |
