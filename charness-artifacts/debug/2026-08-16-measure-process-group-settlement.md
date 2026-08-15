# Measure Process-Group Settlement Debug Review
Date: 2026-08-16

## Problem

`skills/ceal-capability-audit/scripts/measure_ceal.py` can raise `PermissionError`
from `os.killpg` while settling a timed-out or output-limited child, before it
can emit its bounded metric or return a deterministic status.

## Correct Behavior

Given a bounded child whose process-group signal raises `EPERM`, when settlement
is requested, then the helper attempts direct leader termination and waits for
that leader with a finite bound; it must either settle or report a clear
termination failure, never silently continue or wait forever.

## Observed Facts

- `terminate_group` currently catches only `ProcessLookupError` around
  `os.killpg`, then calls unbounded `process.wait()`.
- The prior macOS gate record reports `TERM`-then-`KILL` group settlement raised
  `EPERM`; the current single-shot `SIGKILL` avoided that exact sequence but has
  no fallback when `killpg` itself raises `PermissionError`.
- The Node sibling catches group-signal errors and falls back to direct child
  termination (`packages/ceal-worker-cli/src/bounded-process.ts:140-148`).

## Reproduction

An injected Python harness replaces `os.killpg` with a function that raises
`PermissionError`. A deterministic fake process proves the fallback's bounded
wait argument and explicit `RuntimeError` when `wait()` raises
`subprocess.TimeoutExpired`; actual sleeping and output-flooding children then
prove direct fallback and 124/125 result semantics. Before the fix, the actual
timeout case exits through the injected error before direct termination.

## Candidate Causes

- macOS process-group ownership/lifecycle can make a group signal fail after
  the leader/descendants change state.
- The helper assumes `killpg` is the only termination authority and has no
  direct-leader fallback.
- Unbounded `wait()` can preserve a hang if both signal paths fail or if a
  descendant keeps pipes open.

## Hypothesis

If `PermissionError` from `killpg` is handled by direct leader `SIGKILL` plus a
bounded wait, the injected regression will settle successfully and the real
helper will preserve its timeout/output-limit contract; disconfirmer: the
injected direct-kill path still raises or the helper waits past its bound.

## Verification

- Mutation check: an in-memory pre-fix override of `terminate_group` propagated
  `PermissionError: injected EPERM` from an actual timed child (expected red).
- After repair: `node --test test/contract/script-lib.test.mjs` is green 14/14;
  the fake-process branch proves `wait(timeout=1.0)` and explicit
  `RuntimeError` on `TimeoutExpired`; the actual-child branch proves direct
  fallback, timeout exit 124/settlement `timeout`, output exit
  125/settlement `output_limit`, non-null `child_exit`, and completion under
  two seconds for each injected run. `npm run lint` passes and
  `npm run check:unit` passes its full declared chain with 205 contract tests.
- Legacy conversion timing probe: `time node test/run-source-tests.mjs
  test/contract/legacy-mjs-conversion.test.ts` reported TAP 6537ms and wall
  6.600s; direct Node test with concurrency 1 reported TAP 5641ms and wall
  5.672s. Its synchronous git/Node children all returned, so the observed
  425s report is not reproduced and does not share this settlement path on
  this host.

## Root Cause

`terminate_group` treated `os.killpg` as infallible except for a gone group.
On `EPERM` it propagated before direct leader termination, and its unbounded
`wait()` could not provide a finite failure boundary. The repair aligns the
Python helper with the Node sibling's fallback and keeps both termination and
post-signal waiting explicit.

## Invariant Proof

- Invariant: every non-completed measurement has a bounded, observable
  settlement outcome.
- Producer Proof: `terminate_group` owns process-group and leader signals.
- Final-Consumer Proof: `run_bounded` emits `settlement` and exit code only
  after the process is settled or an explicit failure is raised.
- Interface-Shape Sibling Scan: Node `runBoundedProcess` provides the direct
  child fallback; Python must preserve equivalent ownership semantics.
- Non-Claims: the fake process does not prove kernel behavior; actual-child
  tests do not prove descendants are cleaned up when `killpg` raises `EPERM`,
  and injected `EPERM` on this macOS host does not prove the hosted runner's
  natural kernel failure mode.

## Detection Gap

- `test/contract/script-lib.test.mjs` covered timeout/output/descendant paths
  but not injected `killpg` failure on a real child or the bounded wait
  failure path; the new regression now fails visibly if direct fallback,
  `wait(timeout=1.0)`, explicit failure, or either 124/125 settlement contract
  is removed.

Xhigh critique:

- Finding: a fake process alone could prove only the bounded wait argument and
  failure path, not that a real child was reaped. Disposition: fixed now by
  retaining both the fake branch and actual timeout/output-limit children,
  asserting non-null `child_exit` plus bounded wall time for the latter.
- Finding: local injection on macOS does not reproduce the hosted runner's
  natural kernel permission failure or descendant cleanup after an EPERM group signal. Disposition:
  accepted with explicit non-claims; hosted macOS proof remains required before
  treating the external seam as fully verified.
- Finding: output-limit coverage could be flaky if the child emits too slowly.
  Disposition: fixed now with a tight infinite `os.write` producer, a 1024-byte
  cap, and a 3-second parent harness bound; the focused test passes.

## Sibling Search

- Mental model: group termination is preferred custody, direct leader kill is
  the bounded fallback, and failure of both must remain explicit.
- same-file: `terminate_group` | repaired with injected failure proof.
- cross-file: `packages/ceal-worker-cli/src/bounded-process.ts:140-148` |
  retain its direct fallback and align Python semantics.

## Seam Risk

- Interrupt ID: measure-process-group-settlement
- Risk Class: external-seam
- Seam: Python `os.killpg` and macOS process-group ownership/lifecycle.
- Disproving Observation: none locally; Linux injection only proves control flow.
- What Local Reasoning Cannot Prove: hosted macOS signal permission behavior.
- Generalization Pressure: monitor

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-08-16-measure-process-group-settlement.md

## Prevention

Keep injected group-signal failure coverage beside the existing measurement
contract tests, retain explicit bounded failure if direct termination cannot
settle, and report hosted macOS proof separately from local injected evidence.
