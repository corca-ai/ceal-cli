# Worker Test Runner Carrier Hang Debug
Date: 2026-07-31

## Problem

After `malformed key material and truncated messages are refused by name`,
`npm test` appears to stop producing output for a long time.

## Correct Behavior

Given the worker test suite is launched by Node's test runner, when the HPKE
file reaches its final test, then the runner must finish all other test files
and exit rather than leaving a child process blocked.

## Observed Facts

- Root `npm test` runs client tests, then worker tests, then contract and
  release suites; it is not only the HPKE file.
- Worker package test runs `node --test test/*.test.mjs`, so files execute in
  parallel and output order does not identify the active file.
- `ps` showed the HPKE test worker had ended its visible work, while
  `leased-consumer-carrier.test.mjs` and its child
  `dist/bin.js --internal-leased-consumer-carrier` remained at 0% CPU.
- The stuck test is `leased-consumer-carrier.test.mjs:218-233`, which calls
  synchronous `spawnSync` with piped stdin/stdout and `input`.
- Node is v22.22.1 on macOS.

## Reproduction

- `npm test` reaches the HPKE line and then remains running.
- `node --test --test-name-pattern='shipped private mode rejects' packages/ceal-worker-cli/test/leased-consumer-carrier.test.mjs`
  also remains running.
- The same child invocation performed from a normal `node --input-type=module
  -e` process returns immediately with status 2, so the internal carrier and
  its non-pipe FD-4 rejection are not intrinsically stuck.

## Candidate Causes

- `spawnSync` with `input` and piped stdio deadlocks when invoked inside a
  Node test-runner worker on this host/runtime combination.
- The child inherits a test-runner-managed stdin/IPC descriptor shape, so the
  request is not observed as EOF by `readLeasedConsumerRequest`.
- An earlier carrier test leaves a descriptor or child resource open and the
  later synchronous child waits on that inherited state.

## Hypothesis

- The final carrier test is a Node test-runner/`spawnSync` stdio interaction,
  not an HPKE failure. Disconfirmer: run the exact `spawnSync` call outside
  `node --test`; it should return promptly.

## Verification

- Confirmed: the exact child call outside the test runner returned in about
  0.12s with the expected JSON and status 2.
- Confirmed: the focused test-runner invocation remained blocked with only the
  carrier test child alive.
- The long pause is therefore downstream of the displayed HPKE test line; the
  line is merely the last completed output emitted by another parallel test
  file.

## Root Cause

The apparent HPKE hang is caused by `leased-consumer-carrier.test.mjs`'s
final synchronous child-process test. Under Node v22.22.1's test-runner
worker on this macOS checkout, its piped `spawnSync` invocation does not
complete, leaving the internal carrier child waiting and the suite open.

## Invariant Proof

- Invariant: every test-created child process must return or be bounded before
  the worker test process can exit.
- Producer Proof: the carrier test creates the child synchronously at line 220
  with piped stdio and no explicit timeout.
- Final-Consumer Proof: the parent test runner remains alive while the child
  remains alive; the same invocation outside the runner completes.
- Interface-Shape Sibling Scan: other worker tests use child processes, but the
  carrier test is the only observed synchronous child with this FD-4 setup.
- Non-Claims: this does not prove a Node upstream defect or a released-binary
  behavior; it proves the local runtime/test-runner seam.

## Detection Gap

- Worker package test | no timeout or child-liveness assertion around the
  synchronous carrier subprocess | use an async bounded child invocation or a
  timeout-backed test helper so a regression fails visibly.
- Root test gate | reports only the last completed parallel test output | run
  the focused carrier test or add per-file progress when diagnosing hangs.

## Sibling Search

- Mental model: parallel test output identifies the active test, while a
  synchronous child can hold the runner open silently.
- same layer: `packages/ceal-worker-cli/test/leased-consumer-carrier.test.mjs:220`
  | decision: same bug, fix now | proof: focused reproduction.
- abstraction up: `packages/ceal-worker-cli/test/local-store-file.test.mjs:173`
  | decision: same class, diagnostic-only for this slice | proof: static scan;
  it uses asynchronous `spawn`, so it does not match the synchronous deadlock
  shape.
- specialization down: `packages/ceal-worker-cli/src/bin.ts:13` |
  decision: intentional plain-text or non-rendering boundary | proof: direct
  child invocation exits outside the test runner; carrier behavior is not the
  observed hang.
- cross-file: `packages/ceal-worker-cli/test/local-store-file.test.mjs:173` |
  decision: same class, diagnostic-only for this slice | proof: static scan.

## Seam Risk

- Interrupt ID: worker-test-runner-spawn-sync-carrier
- Risk Class: external-seam
- Seam: Node test runner worker to synchronous child stdio on macOS
- Disproving Observation: the same spawn call completes outside `node --test`
- What Local Reasoning Cannot Prove: whether another Node version or CI runner
  reproduces the same deadlock
- Generalization Pressure: monitor

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-07-31-worker-test-runner-carrier-hang.md

## Prevention

Replace or bound the synchronous carrier subprocess test before treating the
worker gate as healthy on this host. Until then, run the focused test with a
watchdog and report this carrier subprocess as the blocking surface, not the
preceding HPKE test.
