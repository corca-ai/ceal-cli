# Quality Review
Date: 2026-08-11
Title: Lifecycle HTTP Duplication Repair

## Scope

Target boundary: the owned `@corca-ai/ceal` client lifecycle HTTP paths for
device adoption, enrollment, refresh, and revoke. This is a focused repair of
the duplication ratchet, not a repo-wide quality claim.

B1 remains outside this slice. The frozen protocol vendor does not yet contain
the signed additive capability decoder/relay contract, so no discovery header
or local protocol substitute was added.

## Surface Contract Review

- semantic coverage: `partial` — deterministic client tests and local repo
  gates exercise the source implementation.
- surface: endpoint validation, bounded JSON POST exchange, timeout and fetch
  classification, redirects, content type, UTF-8/JSON parsing, and typed
  non-success protocol responses.
- owner: `request-bounds.ts` owns outbound public-HTTP endpoint safety;
  `session-http-client.ts` owns lifecycle JSON exchange; each public client owns
  its route, protocol decoder, and caller-facing error vocabulary.
- projections: endpoint plus request body becomes a bounded decoded value or a
  caller-specific typed error.
- state scope: one request; these helpers own no persisted session state.
- transitions: success, typed protocol failure on non-success HTTP status,
  malformed response, timeout, redirect, and transport failure.
- proof boundary: focused package tests, iteration/final repo gates,
  maintainer-local duplicate and shell gates, and delegated repaired-tree
  review.
- unexamined axes: signed released packages, live Gateway behavior, provider
  readback, and the future B1 protocol handoff.

## Current Gates

`npm run check:unit` is the iteration gate and `npm run check` is final.
The duplication ratchet separately binds newly detected structural clone
families to repair or explicit review; the pre-push hook also runs the local
shell check.

## Runtime Signals

- runtime source: structured metrics in `.charness/quality/command-timing.jsonl`
  when a local hook run
  records the relevant command. <!-- reproduction-source -->
- runtime hot spots: not measured in this slice; no timing claim is made for
  this refactor, which removes repeated
  request machinery without adding network exchanges.
- coverage gate: client coverage is enforced by `npm run check:unit`; script
  coverage remains part of `npm run check`.
- evaluator depth: deterministic tests and one independent fresh-eye review;
  no live Gateway evaluator ran.

## Healthy

- One shared seam now owns lifecycle redirect, abort, bounded-read,
  content-type, UTF-8, JSON, and low-level failure classification.
- Public endpoint safety has one owner shared with the general HTTP transport.
- Adoption retains route-specific non-success status mapping, while enrollment,
  refresh, and revoke retain typed protocol-failure decoding.
- Focused regressions prove typed enrollment, refresh, and revoke failures are
  not collapsed into `invalid_response` merely because HTTP status is not
  successful.
- The duplicate ratchet accepts the repaired tree with no new fixable family.

## Weak

- The remaining client option/error shapes are structurally similar, but their
  public vocabularies are deliberately separate; a generic base would expose a
  shallower abstraction than the shared request seam.
- Route pairs remain explicit at their owning clients rather than being hidden
  behind a generic map.

## Missing

- Signed released-package execution.
- Live Gateway and provider readback.
- The canonical signed additive capability protocol required before B1 can be
  implemented in this repository.

## Deferred

- B1 consumption and the generic discovery request header wait for a signed
  Gateway protocol artifact and matching vendor re-pin.

## Advisory

- artifact: `charness-artifacts/quality/dup-review.json` records the intentionally retained
  structural families and their ownership rationale.
- artifact: `docs/handoff.md` says not to add the B1 header to enrollment,
  adoption, or personal-session paths;
  the queued scope is generic discovery HTTP after the canonical decoder exists.

## Delegated Review

- Delegated Review: executed — `/root/dup_quality_review` inspected the bounded
  repaired tree independently.
- The reviewer found one package-private exported type and missing non-success
  protocol-response proofs; both findings were repaired before closeout.
- The reviewer found no endpoint, timeout, error-typing, or request-seam behavior
  regression and classified each remaining duplicate family as intentional.
- Reviewer-boundary fingerprint verification was clean.
- Closeout claims review: executed — `/root/final_claims_review` returned pass
  with one repaired documentation link finding.
- Reviewer tier: `high-leverage`; host exposure: `host-defaulted`; application
  is not claimed because provider metadata was hidden.

## Commands Run

- Focused `@corca-ai/ceal` client build and test suite.
- `npm run check:unit` and `npm run check:duplication`.
- `npm run check`, `npm run lint:shell`, installed-hook verification, and
  `bash .githooks/pre-push`.
- Quality artifact validation and `git diff --check`.

## Recommended Next Quality Moves

- active consume signed B1 protocol handoff — capability_needed=canonical
  additive decoding and relay; next_center=`packages/ceal-protocol` vendor pin;
  transformation=consume and re-pin the signed artifact, then add the generic
  discovery request header; proof_boundary=protocol conformance plus generic
  HTTP contract tests; enforcement_posture=advisory.
- passive release remains operator-gated because no release was requested —
  capability_needed=explicit operator approval; next_center=worker release
  procedure; transformation=none before approval; proof_boundary=signed package
  and release readback; enforcement_posture=blocking.

## History

- [Prior quality baseline](history/2026-07-27-quality-review-second-pass.md)
