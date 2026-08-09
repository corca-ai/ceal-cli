# Gateway Handoff Release Continuation Critique
Date: 2026-08-09

## Decision Under Review

Refresh the worker handoff so a future operator detects, verifies, consumes,
pins, and releases the next signed Gateway Protocol handoff without treating a
local Gateway checkout or a GitHub ref as released bytes.

## Release Scope

No worker version or tag is selected here. This locks only the continuation
sequence that will eventually consume `gateway-protocol-handoff-v0.72.13`.

## Failure Angles

- Operational checklist: the draft queried a GitHub Release the producer never
  creates and lacked the trust bootstrap that makes a new lock honest.
- First reader and authority: approval boundaries sat after imperative push/tag
  steps, and the handoff-input and release-version commits had no unique order.

## Counterweight Pass

- The R2-origin mismatch and missing candidate-lock bootstrap are real ship
  blockers. The handoff now stops on both instead of inventing release proof.
- Approval prose stays owned by `AGENTS.md`; the handoff points to it at each
  effect boundary rather than copying the rule.
- The handoff-input commit now precedes a separate version commit.
- A new proof taxonomy was rejected: `docs/operator-acceptance.md` already owns
  the positive `surface` level and the distinctions above it.

## Surface-Lock Inventory

- Gateway tag and the R2 archive, `.sig`, `.pem`, and `SHA256SUMS`.
- Gateway handoff lock, vendor pin, frozen protocol, private contract, generated
  source, and workflow literals.
- Worker manifests, package lock, tag, signed artifacts, stable update, and
  installed readback. Live Gateway/provider behavior remains outside this lock.

## Operator Action Required

- Build and prove the read-only candidate-lock bootstrap before consuming the
  next handoff.
- Keep handoff input and worker version changes in their declared commit order.
- Obtain push, tag, and release-publish authority at their separate boundaries.

## Upgrade Path

Verified handoff commit, version commit, final gate, approved push and CI
readback, approved tag/publish, then installed `ceal update` readback. Stable
rollback remains the existing immutable-tag rollback workflow.

## Structured Findings

- F1 | bin: act-before-ship | evidence: strong | ref: ../ceal/.github/workflows/gateway-protocol-handoff-release.yml:101 | action: fix | note: replace the nonexistent GitHub Release check with the R2 asset surface
- F2 | bin: act-before-ship | evidence: strong | ref: scripts/worker-gateway-handoff-archive.mjs:61 | action: fix | note: stop consumption until a read-only signed candidate-lock bootstrap exists
- F3 | bin: bundle-anyway | evidence: contested | ref: AGENTS.md#boundaries | action: fix | note: point to separate approval checks at each effect boundary
- F4 | bin: bundle-anyway | evidence: moderate | ref: docs/release-and-enrollment.md#release | action: fix | note: order the handoff-input and version commits explicitly
- F5 | bin: over-worry | evidence: strong | ref: docs/operator-acceptance.md#naming-what-you-could-not-prove | action: document | note: keep proof-level vocabulary in its existing owner

## Reviewer Tier Evidence

- Requested tier: high-leverage
- Requested spawn fields: n/a
- Host exposure state: host-defaulted
- Application state: host did not expose applied model metadata
- Delivery state: findings-received

## Fresh-Eye Satisfaction

parent-delegated

## Reviewed Input Identity

Packet Consumed: n/a (no adapter sections)

## Boundary Ownership

- Producer: Gateway handoff workflow and immutable R2 origin.
- Consumer: ceal-cli maintainer preparing the worker release.
- Owning surface: standing release procedure plus continuation handoff.
- Verdict: owned-correctly
