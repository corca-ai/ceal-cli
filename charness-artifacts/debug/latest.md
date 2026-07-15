# Operator Refresh Serialization Debug Review
Date: 2026-07-15

## Problem

Two concurrent `cealctl` control-plane reads used the same rotated refresh token.
The Gateway returned `refresh_replayed`, then invalidated the operator session
family, forcing an unnecessary browser re-login.

## Correct Behavior

Given two local `cealctl` processes sharing one operator session, when both need
an access token, then they serialize refresh-token rotation and each completes
with a valid short-lived access token. A refresh replay must remain a server-side
theft signal, not be caused by ordinary local concurrency.

## Observed Facts

- On 2026-07-15, concurrent `access show` and `connectors show` against the
  same `ceal-prod` operator session produced `refresh_replayed` followed by
  `session_family_invalidated`.
- Every remote operator command refreshes before its API call
  (`packages/ceal-operator-cli/src/index.ts`).
- Before this repair, `refreshOperatorSession` posted the caller-provided token
  and only then used an atomic compare-and-replace write
  (`packages/ceal-operator-cli/src/operator-session-client.ts`,
  `operator-session-store.ts`).
- The Gateway deliberately revokes a replayed refresh family. The production
  response therefore demonstrates the intended server defense, not a server
  defect.

## Reproduction

- Two separate packaged `cealctl access show` processes with the same HOME and
  a deliberately delayed fake refresh endpoint reproduced the dangerous
  in-flight window. Before the repair both can submit the old token; after the
  repair they submit the old token and its rotation in order.

## Candidate Causes

- Independent CLI processes read the same session before either writes its
  rotation. Confirmed: both session stores previously exposed this path.
- Atomic replacement occurs after the externally visible single-use refresh.
  Confirmed: it prevents only a lost final file write, not token replay.
- The Gateway may reject a valid newly rotated token. Rejected: the delayed
  independent-process tests succeed when clients send the rotated token in
  order, and the live replay response is the intended theft defense.

## Hypothesis

- Candidate claim: the client has no owner-only inter-process refresh critical
  section, so concurrent commands replay the old token. | disconfirmer: an
  independent-process test reaches the delayed endpoint only once with the old
  token after the client change.

## Verification

- Result: confirmed and repaired. The pre-repair client had no critical section;
  the new independent-process tests observe the required request order and both
  commands complete.

## Root Cause

The root cause was treating atomic local file replacement as though it also
serialized the preceding remote single-use refresh. It does not: two processes
can read the same stored token and both submit it before either replacement.
The same structural gap existed in both the operator session store and the
personal-client worker session store.

## Invariant Proof

- Invariant: when a local process mutates a renewable Ceal session, every
  sibling process sharing its owner-only state must observe the resulting state
  before it can submit a conflicting refresh, revoke, selection, or save.
- Producer Proof: both stores use an owner-only, bounded state lock across the
  remote operation and the locked replacement/removal; a waiter rereads session
  state after lock acquisition. Login/save, selection, and logout use that same
  store lock, so they cannot overwrite a completed rotation.
- Final-Consumer Proof: `packages/ceal-operator-cli/test/operator-cli.test.mjs`
  runs two independent packaged `cealctl` processes against a delayed fake Admin
  API and both complete while using distinct tokens. `packages/ceal-worker-cli/
  test/cli.test.mjs` runs two independent packaged `ceal` processes; the first
  refreshes once and the second reuses its still-current stored session.
- Interface-Shape Sibling Scan: operator sessions and personal-client sessions
  were both repaired. No third renewable, owner-local Ceal session store exists
  in this repository.
- Non-Claims: this record does not claim a live recovery or a production
  provider action; it records the observed operator-session failure.

## Detection Gap

- Operator and worker CLI tests | sequential refresh fixtures passed while
  separate processes sharing HOME were absent | add delayed-endpoint,
  independent-process shared-HOME tests and serialize all state mutations.

## Sibling Search

- Mental model: atomic persistence is not a lock around a single-use network
  credential.
- operator-session refresh, login/save, selection, and logout | repaired with
  one owner-only state lock | independent-process proof passes.
- cross-file: `packages/ceal-worker-cli/src/profile-store.ts` and
  `packages/ceal-worker-cli/src/client-session.ts` | personal-client worker
  refresh, enrollment save, and logout | repaired with
  one owner-only state lock | independent-process proof passes.

## Seam Risk

- Interrupt ID: operator-single-use-refresh-serialization
- Risk Class: operator-visible-recovery
- Seam: CLI process -> owner-only session state -> Admin API refresh endpoint.
- Disproving Observation: a concurrent test sends distinct refresh tokens
  without a lock, or the server accepts duplicate old-token refreshes.
- What Local Reasoning Cannot Prove: recovery of the already invalidated live
  operator session requires a new user-approved login.
- Generalization Pressure: monitor

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: impl
- Handoff Artifact: charness-artifacts/debug/latest.md

## Prevention

Keep replay family invalidation enabled on the Gateway. Any future renewable
owner-local credential store must explicitly choose this same state-lock pattern
or prove why it has no multi-process access path.
