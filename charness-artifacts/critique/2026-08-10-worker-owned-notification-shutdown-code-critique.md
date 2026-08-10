# Worker Owned Notification Shutdown Code Critique

## Execution

Three parent-delegated read-only reviewer passes examined the Worker lifecycle,
the proof oracles, and the counterweight. A final repaired-surface pass read the
complete source, test, and spec after all accepted findings were applied.

## Fresh-Eye Satisfaction

parent-delegated

## Packet Consumed

n/a (no adapter sections)

## Reviewed Input Identity

No adapter packet sections were configured. Reviewers read the current
working-tree source, test, and spec diff against base HEAD
`9b39982aa62cc0b58abcff27d2755d52beb8e25a`. All four parent fingerprint
windows returned `verdict: clean` with no worktree, index, or HEAD drift.

## Reviewer Tier Evidence

- Requested tier: high-leverage
- Requested spawn fields: none; the existing parent-delegated follow-up surface
  exposes no model or reasoning fields and this repo has no critique adapter.
- Host exposure state: unsupported
- Application state: unproven
- Delivery state: findings-received

## Target

Code/runtime critique of the Worker-owned notification shutdown classifier and
its fail-closed process oracle.

## Change

Accept Node's exact `ERR_STREAM_PREMATURE_CLOSE` only after Agent EOF has put
the Worker into its normal owned-shutdown path. Keep every early FD5,
malformed-frame, output, and unrelated-error path unsuccessful.

## Capability at Stake

A successfully cancelled active runner must not end as Worker exit 3 merely
because the Worker destroyed its own inherited FD5 socket; an independent FD5
failure must never be laundered into a clean exit.

## Angles

- Lifecycle security: traced Agent EOF, the owned latch, abort, FD5 close, and
  notification result ordering for false-green races.
- Proof integrity: checked that the real child socketpair and the mutation
  oracle fail for independent intended reasons.
- Counterweight: rejected expanding this slice into concurrent channel-loss,
  signed release, Gateway selection, or Agent changes.

## Findings

- The exact error code behind the owned latch is the correct owner-side repair.
- The first process oracle distinguished real owned shutdown from FD5-first
  EOF, but did not prevent broad `Error` or message-based classification.
- A same-message/wrong-code owned-latch oracle was required. Broadening the
  helper to every `Error` made it red with `true !== false`; restoring the exact
  code made it green.
- The first mutation fixture used a yield-free async generator and made Biome
  red. Replacing it with an explicit `AsyncIterator.next()` preserved the
  failure shape and restored lint.
- One reviewer incorrectly reported the spec absent. Parent positive-control
  readback proved the file existed; that finding was discarded.

## Counterweight Triage

### Act Before Ship

- Add and mutation-prove the same-message/wrong-code oracle — completed.
- Repair the Biome `useYield` failure and rerun the latest full iteration gate
  — completed.

### Bundle Anyway

- Retain the real inherited FD5 two-arm process oracle and the small injected
  classifier oracle; neither substitutes for the other.
- Record the Gateway transport and active-runner compositions that both reach
  Worker exit zero against the repaired local build.

### Over-Worry

- A general error taxonomy, new Gateway/Agent harness, arbitrary-recipient
  input threat, or signed-release proof inside this source slice.

### Valid but Defer

- Concurrent notification plus channel-loss abort idempotency and immutable
  release/selection/apply proof.

## Deliberately Not Doing

The classifier does not accept the error message, all `Error` objects, or all
Node stream errors. This slice does not change Gateway or Agent code and does
not claim the separately deferred concurrent-close race.

## Repaired-Surface Review

The final reviewer found no blocker or should-fix item. The real socketpair
still exercises the shipped stream constructor, the auxiliary iterator is
limited to classifier mutation sensitivity, and the spec preserves release,
apply, provider, Slack, latency, and C11a non-claims.

## Boundary Ownership

- Producer: Agent control EOF starts the Worker-owned normal shutdown and the
  Worker destroys its inherited notification socket.
- Consumer: the Worker notification loop classifies the resulting stream end
  before the process exit becomes Gateway composition evidence.
- Owning surface: ceal-cli Worker stream lifecycle and exit classification;
  Gateway and Agent retain composition/selection and broker-cancellation.
- Verdict: moved-to-owner.

## Next Move

Run the final pre-push gate, commit the bounded repair, and publish only through
the separately approved Worker release procedure before Gateway selection or
instance apply.
