# Full-Gate Coverage Contention Debug

Date: 2026-08-11

## Problem

The worker coverage phase passed in the iteration run but failed under the
final gate with three load-sensitive assertions: a fresh Codex rollout became
`unknown`, concurrent receipt appends returned `spool_busy`, and some concurrent
drop markers were not counted.

## Correct Behavior

Tests of bounded runtime deadlines must control their clocks. Subprocess tests
of production lock exclusion must not spend that production lock budget on
coverage profiles the proof does not consume.

## Observed Facts

- The audit walk starts a monotonic deadline and checks it before every shard;
  scheduler delay can expire it before a fixture entry is read.
- Receipt child processes inherited `NODE_V8_COVERAGE` from c8 even though only
  the parent coverage map consumes these cross-process proof paths.
- Receipt stores intentionally bound lock waits and may report/drop advisory
  evidence under sustained contention; an exact large-herd success assertion
  was stronger than the runtime contract.

## Reproduction

- `npm run check` exposed all three failures in the worker coverage phase.
- Injecting a monotonic sequence that crosses the walk deadline deterministically
  reproduces the audit `unknown` result.
- Running the receipt concurrency cases under c8 reproduced lock-budget loss;
  removing inherited child coverage made the same exclusion proof pass.

## Candidate Causes

- Production lock corruption.
- Fixture timestamps drifting against wall time.
- Test orchestration consuming the bounded deadline and lock budgets it meant
  to observe.

## Hypothesis

The third cause is correct. A fixed test clock and uninstrumented proof children
exposed that the exclusion oracle also needed a test-owned wait policy rather
than the production best-effort deadline. A production timeout or missing lock
must remain observable in dedicated tests.

## Verification

- `inspectAgentAudit` and `inspectAgentSessionEvents` now accept an internal
  monotonic-clock dependency; production still defaults to `performance.now`.
- Audit tests use a fixed clock, and a separate sequence-clock test proves the
  deadline still returns partial/unknown rather than inactivity.
- Receipt process-gate children clear only `NODE_V8_COVERAGE`; they still launch
  real Node processes against the built store and one shared start barrier.
- Those exclusion-only children inject a non-expiring lock wait and carry a
  process watchdog. Production callers still use the bounded defaults, while a
  broken test lock cannot hang the suite.
- Concurrent drop proof keeps the first-write race concurrent; cap completion is
  now tested sequentially because it is not a concurrency fact.
- The complete worker coverage command passes after the repair.

## Root Cause

The tests combined two concepts: production boundedness and deterministic proof
orchestration. Host scheduling and discarded coverage I/O were therefore able
to change the expected semantic result.

## Invariant Proof

- Invariant: production audit and advisory-store waits remain bounded; exact
  exclusion tests use an explicit test timing policy instead of treating those
  waits as a liveness guarantee.
- Producer Proof: the default audit clock and receipt lock constants are unchanged.
- Final-Consumer Proof: fixed-clock audit cases and real subprocess receipt
  exclusion cases pass under c8; a process watchdog bounds the test seam and
  explicit production timeout/busy tests remain.
- Interface-Shape Sibling Scan: only the two receipt process-gate spawns discard
  coverage; subprocesses that prove script coverage retain it.
- Non-Claims: no production wait was lengthened and advisory receipt persistence
  is not claimed to be lossless under arbitrary contention.

## Detection Gap

The iteration gate's earlier run did not create enough scheduler pressure to
cross these bounds. The final gate remains the reproducer; deterministic injected
clock and process environment now pin the cause without relying on that pressure.

## Sibling Search

- same layer: audit inventory and drill-down share one clock seam.
- same layer: append and drop process gates share one child environment owner.
- abstraction up: worker coverage consumes parent source profiles, not child
  proof-process profiles.
- specialization down: drop cap is sequential; first-write exclusion stays concurrent.
- cross-file: prior guide binary smokes already clear child coverage for the same
  non-consumed-profile reason.

## Seam Risk

- Interrupt ID: full-gate-coverage-contention
- Risk Class: test-seam
- Seam: c8/host scheduling to bounded audit and advisory-store tests.
- Disproving Observation: production defaults change, or a missing lock/deadline
  mutation passes the focused tests.
- What Local Reasoning Cannot Prove: scheduler behavior on every CI host.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: implementation proof
- Handoff Artifact: docs/handoff.md

## Prevention

Inject time for deadline semantics, keep non-consumed coverage out of proof-only
children, and do not turn a bounded best-effort store into an exact liveness
contract merely to make a stress test look stronger.
