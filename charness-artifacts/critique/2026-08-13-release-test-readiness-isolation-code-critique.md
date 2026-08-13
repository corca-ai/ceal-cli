# Release Test Readiness Isolation Code Critique

Date: 2026-08-13

## Decision Under Review

Isolate package/native post-guard tests behind one converged release-build
fixture while retaining the production Protocol shipment guard and its direct
divergence/chokepoint tests.

## Execution

One bounded parent-delegated fresh-eye reviewer traced the current code diff,
fixture ownership, production guard, and targeted/full proof artifacts. The
reviewer reported no Act Before Ship blocker. Its one Bundle Anyway finding was
an inaccurate lock comment; the comment now states that the workspace lock
protects the `dist` snapshot and packing reads only the immutable fixture copy.

## Fresh-Eye Satisfaction

parent-delegated

## Reviewed Input Identity

- Base HEAD: `6785b508e0a0d6dbffe51fbb47057ade0740c6a3`
- Reviewed code-diff SHA256 before the comment-only repair:
  `b5d1f998b41aac71e7572146056e1d8a5b83f1cb56436dfcc02caf6240b04e39`
- Targeted proof:
  `/tmp/ceal-proof-jobs/ceal-cli-release-fixture-targeted/result.20260813d.json`
- Full proof:
  `/tmp/ceal-proof-jobs/ceal-cli-release-fixture-full-check/result.20260813a.json`

## Findings

### Act Before Ship

None.

### Bundle Anyway

- Correct the fixture comment so it does not claim packing holds the workspace
  lock. Implemented after review; the code path itself was already race-safe.

### Valid but Defer

- Signed Protocol handoff, publish, install, and live Gateway proof remain in
  the final release DAG.

### Over-Worry

- Requiring real codesign or a Gateway roundtrip from this deterministic Linux
  fixture would conflate local post-guard coverage with release proof.

## Boundary Ownership

- Producer: converged scratch repository for deterministic post-guard inputs;
  real checkout Protocol pin for readiness refusal.
- Consumer: package/native behavior tests and dedicated guard contracts.
- Owning surface: ceal-cli release fixtures and release input chokepoint.
- Verdict: owned-correctly.

## Self-Refutation

The strongest objection is that a converged fixture could hide the real
checkout's divergence. It does not: the production guard remains unchanged and
the dedicated divergence plus call-order tests pass independently in the full
gate. The fixture proves only behavior after that guard.
