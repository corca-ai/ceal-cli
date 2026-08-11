# Worker Guide Spawn Economics Closeout

## Implemented

- The guide contract now follows rendered root and parent help through the
  existing public `runCealCommand` seam instead of booting Node for every help
  assertion.
- A fixed `REAL_BINARY_SMOKES` inventory retains root help, explicit deep help,
  and cold `capabilities` as checkout-binary process proofs.
- Both in-process and process helpers assert exit behavior, stderr, and output;
  process probes retain one isolated HOME.
- The cross-process refresh proof now releases its first Gateway response only
  after the second process emits the session-lock wait stage, replacing a
  scheduler-sensitive fixed delay with an observed barrier.

## Capability Delivered

Maintainers get faster guide-contract feedback without weakening the command
navigation, process-entrypoint, or unconfigured-runtime contracts.

## Contract Source

`charness-artifacts/quality/2026-08-11-spawn-economics.md` contains the
candidate scorecard and proof-path comparison card.

## Verification

- The focused guide contract passed before and after the execution-shape
  change using the timing command recorded in the quality artifact.
- `bash .githooks/pre-push` passed on the repaired tree, including the iteration
  gate, duplicate ratchet, and shell lint.
- Worker coverage and the focused refresh test passed after the barrier repair.
- Verification level: local checkout source/runtime only; no signed or
  installed worker and no live Gateway/provider path ran.

## Lint Gate

ran-pass `bash .githooks/pre-push`.

## Truth Surface Sync

The quality record, this closeout, and `docs/handoff.md` describe the repaired
test boundary. Product/release inputs did not change.

## Boundary Ownership

`owned-correctly` — `command-surface.ts` continues to produce help semantics,
`bin.ts` and the public runtime produce process results, and the guide contract
owns only scenario traversal and representative parity checks.

## Critique

Short parent-delegated fresh-eye review required the in-process helper to retain
its exit-code assertion, narrowed checkout-binary proof to three named smokes,
and confirmed the refresh barrier observes the post-load lock-wait stage. Both
repaired review windows had clean fingerprint verdicts.

## Contract Updates

The final comparison card distinguishes field/usage coverage for both help argv
forms from byte parity on the representative root and deep routes. No
acceptance criterion was dropped.

## Residual Risks

- A repo-wide spawn budget remains deferred until another import-safe semantic
  test repeats this class; current process-heavy tests largely own real lock,
  FD, packaging, installer, or isolation behavior.
- Signed/installed artifact behavior remains release-lane proof.

## Next Slice

Return to the B1 packet wait or another evidence-led quality slice. Ask before
any push, tag, publish, or release.

## Completion Categories

- durable: guide-contract execution-shape repair and synchronized records.
- external-writes: none.
- test-only: the named checkout-binary smoke inventory and in-process runner.
- verification: focused contract, iteration gate, local hook, fresh-eye review.
- unverified-future: signed/installed/live behavior and a future spawn ratchet.
