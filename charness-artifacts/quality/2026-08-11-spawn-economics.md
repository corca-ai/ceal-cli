# Quality Review
Date: 2026-08-11
Title: Worker guide contract spawn economics

## Scope

Target boundary: subprocess use in the standing `ceal-cli` test paths, with `test/contract/worker-guide-contract.test.mjs` as the measured hot spot.
Ambient repo findings: none. The frozen Protocol package and sibling Gateway repository are outside this slice.

## Surface Contract Review

- semantic coverage: `observed` — guide-to-help navigation and the retained
  binary entrypoint/result boundary are exercised.
- surface: the checkout-built `ceal` help and cold-start capability-discovery path
  taught by `skills/ceal-guide/SKILL.md`.
- owner: `packages/ceal-worker-cli/src/command-surface.ts` owns help semantics;
  `bin.ts` owns process exit and stdio delivery.
- projections: help text on stdout and the cold-start unavailable YAML result.
- state scope: one isolated HOME per contract file; help is stateless.
- transitions: static help success and unconfigured capability failure.
- proof boundary: focused contract test plus the repo iteration gate.
- unexamined axes: installed signed artifact and live Gateway behavior.

## Current Gates

- `npm run check:unit` is the iteration gate and includes this contract file.
- `npm run check` is the final gate; `.githooks/pre-push` enforces the iteration route for ordinary pushes.

## Runtime Signals

- runtime source: the gitignored command timing log rendered by
  `render_runtime_summary.py`; profile `local-linux-aarch64-2cpu`. <!-- reproduction-source -->
- runtime hot spots: the standing gates remain within their adapter-owned
  budgets; the focused guide contract is measured separately below.
- coverage gate: the final pre-push run below includes `npm run check:unit`.
- evaluator depth: deterministic gates only; this is a local test-runner shape,
  not an evaluator-backed behavior surface.

## Healthy

- Worker package tests already exercise ordinary CLI behavior in-process
  through `runCealCommand`; real processes in store, lock, FD, installer, and
  release tests mostly own genuine process semantics.
- The repaired guide contract follows rendered root and parent help in-process,
  while a named inventory keeps three distinct checkout-binary boundaries.
- The cross-process refresh proof now observes the second process entering the
  session-lock wait before releasing the first Gateway response.

## Weak

- Before this repair, the guide contract ran every top-level and child help route through a new Node process even though it asserted help semantics already reachable through the importable command runner.
- The hook exposed a sibling process test whose fixed response delay did not prove that its second process had read the pre-rotation session.

## Missing

- No missing production seam: `runCealCommand` is already the canonical
  in-process path. A repo-wide spawn budget would be a new heuristic without a
  demonstrated recurring bypass class.

## Deferred

- Release/installer/native-artifact subprocesses remain unchanged because they
  prove packaging, tool execution, process isolation, or installed-binary
  behavior rather than ordinary help rendering.

## Advisory

- command: `inventory_standing_test_economics.py --summary` reports nested CLI fanout but
  cannot classify Node test-tier ownership, so its zero standing-file buckets
  are not a clean result; direct call-site and runtime inspection supplied that
  attribution.
- command: `inventory_structural_waste.py --summary` found no broad scanner or duplicate
  discovery candidate; the cost here is process startup inside one test file.
- Existing-convention check: command: `git log -S 'const SPAWNS'` finds a prior caching
  repair, but no subprocess tier or budget contract. The structural response is
  to use the existing in-process owner, not add a second runner abstraction.

## Candidate Scorecard

Behavior value: preserve guide/help and real-binary confidence while making
  routine iteration materially cheaper.
Intent overlap: directly answers the operator's spawn-economics request.
Structural signal class: owned extraction to the existing in-process command
  runner; no new production interface.
Tool signals: focused timing and direct call graph are strong for cost/shape;
  the generic inventory is advisory and tier-blind for Node.
Ownership: help assertions stay with the guide contract; help production
  stays in `command-surface.ts`; process smoke stays in `bin.ts` execution.
Gate blast radius: one contract test file, then focused contract,
  `check:unit`, and pre-push lint/quality checks.
Cost: small test-helper rewrite with no production or package surface change.
Disposition: do now; keep representative real-binary smokes.
Stop condition: repeated help descent is in-process, retained binary probes
  cover root help, explicit deep help, and cold unavailable/exit behavior, and
  the focused test plus iteration gate pass.

## Comparison Card

Workload identity: same guide text, rendered routes, help fields, isolated
  HOME, unavailable capability result, stdout/stderr, and exit assertions.
Ownership: the test selects scenarios; `runCealCommand` renders help; the
  checkout binary remains the executor for representative process contracts.
Compatibility envelope: both help argv forms keep their field and usage
  contracts; representative root and deep help outputs stay byte-equal across
  the in-process and checkout-binary paths.
Consumption proof: one explicit deep-help route is compared byte-for-byte,
  and cold `capabilities` remains a real process.
Evidence: focused baseline/candidate commands and outcomes are recorded below.

## Delegated Review

- Delegated Review: executed — bounded fresh-eye review confirmed the three
  named binary boundaries and required the in-process helper to assert its exit
  code; its second pass confirmed the refresh barrier observes the post-load
  lock-wait stage. Both repairs are included.
- Slow-gate lenses (fixture-economics, parallel-critical-path,
  duplicated-proof): delegated together because the candidate changes a
  standing subprocess proof path.

## Commands Run

- `python3 .../inventory_standing_test_economics.py --repo-root . --summary`
- `python3 .../inventory_structural_waste.py --repo-root . --summary`
- `python3 .../render_runtime_summary.py --repo-root . --summary`
- Node in-process route inventory command from the comparison card, before the
  edit; it prints the derived routes and unique-spawn formula.
- `/usr/bin/time -f 'elapsed=%e maxrss_kb=%M' node --test --test-reporter=spec test/contract/worker-guide-contract.test.mjs`
  — pass before and after the edit; the command is the timing owner.
- `bash .githooks/pre-push` — pass on the repaired tree, including `npm run check:unit`, duplicate ratchet, and shell lint.
- `npm --ignore-scripts --prefix packages/ceal-worker-cli run coverage` —
  reproduced the refresh race assumption before its timing-stage barrier and
  passed after the observed barrier replaced the fixed delay.

## Recommended Next Quality Moves

- passive add a repo-wide subprocess budget only if another import-safe standing test regresses because one hot spot does not establish a recurring bypass class; capability_needed=prevent repeated boundary bypass; next_center=test economics inventory; transformation=emit a Node-aware boundary-bypass payload and ratchet; proof_boundary=a deliberately added looped binary helper turns the ratchet red; enforcement_posture=no-gate because the current structural repair and named smoke inventory are sufficient evidence.
## History

- [Previous repo-wide quality review](2026-08-11-codebase-quality-sweep.md)
- [Earlier test-economics review](history/2026-07-27-quality-review-second-pass.md)
