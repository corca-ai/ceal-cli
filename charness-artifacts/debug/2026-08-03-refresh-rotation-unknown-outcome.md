# Refresh Rotation Unknown-Outcome Debug
Date: 2026-08-03

## Problem

When a personal-client refresh receives no usable response, `ceal` reported
`session_renewal_unavailable` as retryable and told the employee to retry the
same command.  A subsequent Gateway response can be `refresh_replayed`.

## Correct Behavior

Given a one-time refresh credential and a response that may have been lost
after Gateway state committed, when the worker cannot validate that response,
then it must not recommend reuse of the credential.  It must preserve local
state and give safe recovery instructions until a versioned idempotent recovery
protocol exists.

## Observed Facts

- `client-session.ts` mapped `session_renewal_unavailable` to `retryable: true`
  and “retry the same command”.
- The current v1 refresh request contains only `schema_version`, `refresh_token`
  and client metadata; it has no attempt identity or recovery operation.
- Gateway `refreshSession` marks the old record `used`, issues a new token, and
  `revokeWithFailure(..., "refresh_replayed", ...)` revokes the family when the
  old token returns.
- The local session lock prevents two local processes from interleaving but
  cannot bridge a committed Gateway response that fails before local persistence.

## Reproduction

- Unit: an expired stored session receives a non-JSON refresh response.  Before
  this slice all `capabilities`, `call`, and `receipt show` results said retryable
  and advised same-command retry; after the change they must refuse that retry.
- Source-level producer check: Gateway rotation happens before HTTP response and
  a repeated used token invokes family revocation.

## Candidate Causes

- The refresh token was never consumed and ordinary transport retry is safe.
- The Gateway consumed the token and the response was lost or malformed.
- Two local worker processes raced to consume the same credential.

## Hypothesis

- The ambiguous commit/response window makes a v1 same-command retry unsafe.
  Disconfirmer: a v1 request carries a stable attempt identity and Gateway can
  return the original rotated result without another rotation or revocation.

## Verification

- Confirmed: `npm run check:unit` passes: lint, build, worker and client unit
  suites, and consumer contract suites.
- Confirmed: the focused worker proof covers malformed refresh response,
  pre-send persistence failure, typed Gateway denial, durable v2 store
  round-trip, and a separate packaged-worker invocation that makes no second
  refresh request.
- The changed worker result is non-retryable, states that the credential may
  have been consumed, directs re-enrollment instead of replay, and writes a
  v2 local `renewal_blocked_reason` marker **before sending** the token.

## Root Cause

The worker treated an unknown remote mutation outcome like an unissued request.
It had no protocol-level idempotency or recovery handle to distinguish the two,
while the Gateway intentionally treats reuse as hostile replay. The initial
wording-only repair also left the old token callable by the next process; the
repair now durably quarantines it before the first request, and refuses to send
when that write cannot complete.

## Invariant Proof

- Invariant: when Gateway rotation might have consumed a one-time credential,
  the employee-facing worker must refuse a same-credential retry before it can
  claim that retry is safe.
- Producer Proof: `gateway-personal-client-sessions.ts` uses the old credential
  once and revokes its family on `refresh_replayed`.
- Final-Consumer Proof: the worker CLI test checks the YAML result rendered by
  `capabilities`, `call`, and `receipt show`; a separate packaged-worker test
  proves the second process makes no refresh request after v2 quarantine.
- Interface-Shape Sibling Scan: explicit typed Gateway denials already use
  non-retryable replacement enrollment; local lock contention remains retryable
  because no remote mutation has been attempted.
- Non-Claims: this does not recover a committed rotation or prove a released
  worker / live Gateway transaction.

## Detection Gap

- Worker renewal tests | modeled malformed response but asserted retryability |
  retain malformed-response plus separate-process fixtures and assert durable
  no-replay quarantine, preserving a typed Gateway denial such as
  `refresh_invalid`, and zero network calls when the pre-send write fails.

## Sibling Search

- Mental model: transport unavailability means the remote state is unchanged.
- session-refresh axis: v1 personal client renewal | decision: unsafe outcome
  gets non-retryable output plus durable quarantine | proof: source and
  focused separate-process worker test.
- local-lock axis: concurrent local refresh | decision: preserve retryable
  `refresh_busy` | proof: no request is issued before that result.
- admin-auth axis: `cealctl` also rotates tokens | decision: follow-up
  `refresh-recovery-cealctl-parity` | proof: source review only.
- cross-file: `../ceal/scripts/agent-runtime/cealctl-token-client.mjs` |
  decision: keep administrative-token recovery outside this personal-client
  slice | proof: verified-by-reading.

## Seam Risk

- Interrupt ID: personal-client-refresh-unknown-outcome
- Risk Class: external-seam, repeated-symptom
- Seam: persistent Gateway rotation -> lost HTTP result -> worker local session.
- Disproving Observation: versioned Gateway recovery returns one original result
  for the same attempt without another rotation or family revocation.
- What Local Reasoning Cannot Prove: encrypted retention and released
  cross-host recovery behavior.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-08-03-personal-client-refresh-recovery.md

## Prevention

Treat any response-lost remote mutation as unknown unless its protocol offers a
stable recovery identity.  Do not let a generic transport classification imply
that a one-time credential is safe to replay; durable local state must enforce
the refusal across processes until recovery exists.
