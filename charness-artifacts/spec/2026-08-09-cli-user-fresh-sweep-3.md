# CLI User Fresh Sweep 3 Contract

## Problem

A third user-oriented sweep found lifecycle failures that are rendered as clean
success, inconsistent public option validation, synchronous local scans whose
declared budget starts too late, and no opt-in way to distinguish local startup,
session, Gateway, readback, and advisory-tail latency.

## Capability Contract

The CLI reports partial success and local cleanup truth in its existing single
YAML result, rejects malformed public references before network work, bounds
local inspection before materializing an unbounded directory, and offers a
secret-free opt-in timing stream without changing ordinary stdout.

## Current Slice

- Dispose every Gateway-issued session that cannot be committed locally.
- Preserve Gateway logout disposition across local removal failure and expose
  advisory cleanup failure.
- Distinguish absent advisory files from unsafe cleanup targets.
- Enforce the public Profile reference grammar in stored-session option paths.
- Bound agent-audit enumeration at the filesystem iterator.
- Add `ceal --timing <command>` with a fixed, mechanically owned stage vocabulary
  and JSON events on stderr only.

## Fixed Decisions

- Ordinary command stdout and stderr are unchanged unless `--timing` is the
  first public argument.
- Timing events contain schema, sequence, event, stage, monotonic elapsed time
  on finish, and a fixed outcome only. They contain no endpoint, identity,
  request reference, payload, token, or free-form error text.
- Repeated phases use sequence ids; a start without finish remains useful when a
  process stalls or is killed.
- Logout can succeed remotely and fail locally; one logout-schema failure must
  carry both facts.
- Advisory cleanup failure does not undo a completed remote operation, but it is
  never rendered as cleared.

## Deferred Decisions

- Route-specific splitting of the eager public runtime follows measurement; it
  is not mixed into the instrumentation slice.
- Generation-safe GC for reclaimed lock tombstones requires a separate local
  store contract.
- Same-identity late receipt writers remain the existing generation-contract
  defer, not an excuse to hide immediate cleanup failure.

## Success Criteria

- Focused tests prove every issued-but-uncommitted session disposition reaches
  enrollment and adoption output.
- Logout output preserves remote disposition when local removal fails and names
  whether derived state was cleared on success.
- Unsafe widened or substituted advisory stores reject cleanup; absent files are
  still a successful no-op.
- Invalid `--profile` values stop before session or Gateway work in every shared
  parser consumer.
- Large audit directories stop at the declared iterator budget and report a
  partial inventory.
- `--timing` emits fixed-vocabulary start/finish events on stderr while stdout
  remains exactly one unchanged YAML document; ordinary invocations emit none.

## Non-Claims

- Local tests do not prove released-binary, macOS, live Gateway, or provider
  behavior.
- Timing visibility identifies phase latency; it does not itself reduce it.

## First Implementation Slice

Close the reproduced correctness gaps, then instrument bootstrap, runtime
import, session/local-store, Gateway, readback, observer, receipt-tail, and
update boundaries with focused output-contract tests.
