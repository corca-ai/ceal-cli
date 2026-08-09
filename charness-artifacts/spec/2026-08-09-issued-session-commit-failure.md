# Issued Session Commit Failure Contract

## Problem

Enrollment and adoption can receive a live Gateway session and then fail their
local store commit. The CLI currently drops that credential from memory without
revoking it on first-session save failure or any lock-wrapper failure.

## Capability Contract

A user whose session acquisition fails locally does not leave an unnamed live
Gateway credential silently behind. The command attempts bounded revocation and
truthfully reports whether the incoming session was revoked, already unusable,
or could not be revoked.

## Current Slice

Make `commitEnrolledSession` own disposal for every issued session it does not
commit, then project that disposition through enrollment and adoption failures.

## Fixed Decisions

- Every `CealSessionCommit` store failure carries `issuedSessionRevoked`.
- Save failure revokes incoming regardless of whether a previous session exists.
- Lock/load/other failures outside the commit callback also revoke incoming.
- `refresh_busy` remains a local retry condition, but a spent enrollment code or
  completed adoption transaction still requires incoming disposal and a fresh
  acquisition attempt.
- Failure output uses the existing `CealRevokeDisposition` vocabulary and one
  YAML document; it never renders a credential or Gateway-controlled prose.

## Probe Questions

- Whether a revoke-unavailable result needs operator escalation is answered by
  a final-output regression: the result must say the issued session may remain
  usable until expiry and direct the user to report it.

## Deferred Decisions

- Protocol-level recovery of a remotely issued session after a lost local
  commit remains Gateway-owned; this slice only performs bounded revocation.
- Fine-grained performance visibility is a separate concurrent quality finding.

## Non-Goals

- No Gateway protocol, vendored protocol, release, enrollment-code exchange, or
  session-store format changes.
- No live Gateway or provider call.

## Deliberately Not Doing

- Do not retry the local commit with an incoming one-time acquisition hidden in
  memory; after failure the safe contract is dispose and reacquire.
- Do not infer revoke success from a local failure class.

## Constraints

- Revocation stays bounded by the existing personal-session client transport.
- A successful stored session is never revoked by this failure cleanup.
- Previous-session disposition and incoming-session disposition remain separate
  concepts in the result.

## Success Criteria

- First-session save failure performs one incoming revoke and reports its
  disposition.
- Lock/load failure performs one incoming revoke and preserves the local failure
  kind, including `refresh_busy`.
- Replacement save failure reports both whether the previous session ended and
  how the incoming session was disposed.
- Revoke-unavailable output makes no clean-cleanup claim.
- Successful, conflict, enrollment-specific, and adoption-specific paths retain
  their existing behavior.

## Acceptance Checks

- unit — common commit tests cover save and outer failures with revoked,
  already-unusable, and unavailable dispositions.
- integration — enrollment YAML reports `issued_session_revoked` and local
  recovery for `refresh_busy` without Gateway-URL blame.
- unit — adoption YAML reports the same disposition using adoption recovery and
  never requests an enrollment code.
- integration — package suite and repo gates retain the one-document contract.

## Boundary Ownership

- Producer: Gateway enrollment/adoption client yields the incoming session.
- Consumer: worker local session commit and the enrollment/adoption YAML result.
- Owner: `session-replacement.ts` owns issued-but-uncommitted disposal;
  enrollment/adoption own method-specific rendering.
- Verdict: `owned-correctly`.

## Critique

- Interrupt Source: `issued-session-local-commit-seam` from the paired debug
  artifact.
- Seam Summary: remote issue succeeds before local lock/load/save can fail.
- Chosen Next Step: factor disposal into the shared commit result and prove both
  final CLI consumers.
- Impl Status: ready.
- Impl Status Reason: disposition vocabulary and bounded revoke transport
  already exist; no protocol choice is required.
- What Disproving Observation Is Resolved: direct save and lock reproductions
  currently record zero revokes and will be required to record one.
- Fresh-eye: parent-delegated Luna/xhigh lifecycle review reproduced the gap;
  repaired-tree review remains required before closeout.

## Canonical Artifact

This file is the implementation contract; the paired debug artifact preserves
the RCA.

## First Implementation Slice

Extend the common store-failure result with incoming disposition, update the two
renderers, and add focused failure-path tests before broader gates.
