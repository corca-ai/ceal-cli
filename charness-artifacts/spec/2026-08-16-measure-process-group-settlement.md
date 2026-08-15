# Measure Process-Group Settlement Follow-up

## Contract

The Python capability-audit measurement helper must settle a timed-out or
output-limited actual child when process-group signalling raises `EPERM` by
falling back to direct leader termination with a finite wait. Local injection
on macOS proves control flow; the hosted runner's natural failure remains an external verification
boundary.

## Proof

`test/contract/script-lib.test.mjs` uses a deterministic fake process to assert
that the fallback calls `wait(timeout=1.0)` and converts
`subprocess.TimeoutExpired` to an explicit `RuntimeError`. It also runs actual
timeout and output-flooding children through `run_bounded` with injected
`os.killpg PermissionError` and asserts direct fallback, exit codes 124/125,
settlement labels, non-null child exit values, and bounded completion. The
dated debug artifact records the mutation check and validator commands.

## Non-Claim

This follow-up does not claim hosted macOS kernel permission behavior or
descendant cleanup after `killpg` raises `EPERM` has been verified locally.
