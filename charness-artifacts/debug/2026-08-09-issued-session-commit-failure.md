# Issued Session Commit Failure Debug
Date: 2026-08-09

## Problem

After the Gateway issues a new enrollment or adoption session, a local lock,
load, or save failure can leave that incoming session usable at the Gateway even
though the CLI reports failure and stores no credential.

## Correct Behavior

Given a Gateway-issued session, when the host cannot commit it to the one local
session store, then the worker must attempt to revoke that incoming session and
report the revocation disposition in the command's single failure document.

## Observed Facts

- `commitEnrolledSession` revokes an incoming session on identity conflict.
- Its save-failure branch revokes incoming only when a prior session existed.
- Failures raised by the session-lock wrapper bypass the commit callback and do
  not attempt incoming revocation.
- Enrollment and adoption both use this one commit function after remote issue.

## Reproduction

- Direct built-module reproduction: an empty store whose save throws returns
  `session_save_failed` with zero revoke calls.
- Direct built-module reproduction: a `withSessionStateLock` seam throwing
  `CealSessionStoreError("refresh_busy")` returns `refresh_busy` with zero
  revoke calls.
- Positive control: the existing identity-conflict tests record one revoke of
  the refused incoming credential.

## Candidate Causes

- The enrollment/adoption callers may discard the issued credential before the
  common commit helper can dispose of it.
- The common helper may treat “no previous session” as “nothing needs revoke.”
- Lock-wrapper failures may occur outside the callback that owns save-failure
  cleanup.

## Hypothesis

- The incoming cleanup is scoped to a previous-session branch instead of the
  invariant “every issued-but-uncommitted session is disposed.” If true,
  unconditional incoming revoke in both save and outer failure paths changes
  both reproductions from zero to one revoke without changing successful writes.

## Verification

- confirmed — the source condition at `session-replacement.ts` guards revoke by
  `current`, and the two direct built-module reproductions return zero revoke
  calls before repair.

## Root Cause

The code modeled commit failure as damage to a displaced previous session. That
mental model omitted the independently live incoming session when there was no
previous session, and placed lock-wrapper failures outside the only cleanup
branch.

## Invariant Proof

- Invariant: when enrollment/adoption produces an incoming Gateway session that
  the local commit consumer cannot store, the final CLI failure must dispose it
  and surface the disposition before claiming the transaction ended safely.
- Producer Proof: the enrollment exchange and adopted sealed payload each
  produce a complete `CealStoredSession` before `commitEnrolledSession`.
- Final-Consumer Proof: focused enrollment and adoption regressions assert
  `issued_session_revoked`, method-specific recovery, and revoke-unavailable
  expiry/operator warnings in each command's own schema.
- Interface-Shape Sibling Scan: identity conflict already implements the same
  issued-but-not-kept disposal; save and lock failures are the missing siblings.
- Non-Claims: no live Gateway, released binary, or provider behavior was tested.

## Detection Gap

- session replacement tests | save-failure tests asserted only local failure and
  did not count incoming revoke calls | assert every issued-but-uncommitted
  branch and its final YAML disposition.

## Sibling Search

- Mental model: only a displaced stored credential needs lifecycle cleanup.
- same layer: save failure with and without a previous session | decision: same
  bug, fix now | proof: local payload proof.
- abstraction up: lock/load failures outside the callback | decision: same bug,
  fix now | proof: direct runtime-seam proof.
- specialization down: identity conflict | decision: intentional existing
  disposal boundary | proof: focused unit tests.
- cross-file: `client-session.ts` enrollment and `device-adoption.ts` adoption
  both consume the commit result and must render its incoming disposition.

## Seam Risk

- Interrupt ID: issued-session-local-commit-seam
- Risk Class: external-seam
- Seam: Gateway session issue -> worker local commit -> CLI failure document.
- Disproving Observation: every issued-but-uncommitted branch performs one
  bounded revoke and its CLI result names that disposition.
- What Local Reasoning Cannot Prove: live Gateway acceptance of the revoke.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: implemented and proven through the paired spec and slice closeout
- Handoff Artifact: charness-artifacts/spec/2026-08-09-issued-session-commit-failure.md

## Prevention

Make issued-but-uncommitted disposal a field of the shared commit result and
prove it at both enrollment and adoption final-consumer surfaces.

## Resolution Proof

- `node --test --test-name-pattern='first enrollment save failure|enrollment lock failure|replacement enrollment save failure' packages/ceal-worker-cli/test/cli.test.mjs`
- `node --test --test-name-pattern='store that cannot write|adoption lock failure|failed forced adoption' packages/ceal-worker-cli/test/device-adoption.test.mjs`
- `npm --workspace @corca-ai/ceal-worker-cli test`
