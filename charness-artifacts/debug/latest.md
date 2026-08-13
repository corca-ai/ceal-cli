# Target Catalog Continuation Fixture Debug Review
Date: 2026-08-13

## Problem

The Worker CLI target-recovery test failed with `invalid_response` after signed
Protocol 0.72.21 became source authority.

## Correct Behavior

An incomplete selected page returns at least one target and a cursor; the CLI
preserves the selected Profile in continuation guidance. Empty pages are
complete and receive terminal or match-qualified guidance.

## Observed Facts

- The fixture declared one total target, zero returned targets, incomplete, and
  a cursor while sending `targets: []`.
- Protocol rejects every empty incomplete page.
- Two sibling expectations survived the handoff: one expected signed target
  identity metadata to be stripped, and the session non-rotation proof still
  expected a granted target query to exit unavailable.

## Reproduction

- The focused source-runner test returned `invalid_response` before rendering.

## Candidate Causes

- Decoder regression on valid paging.
- Impossible retained fixture.
- Mixed old Worker/new Protocol resolution.

## Hypothesis

- The fixture is invalid; returning one signed target makes the renderer proof
  pass. | disconfirmer: Protocol positive paging and empty-page mutation.

## Verification

- Confirmed: Protocol paging proof and the repaired recovery/metadata tests pass.
- A subsequent full coverage run exposed the second stale unavailable-target
  expectation; its exact source-authoritative subtest passes after repair.

## Root Cause

The fixture retained a pre-handoff model where an empty incomplete page could
continue and signed target identity metadata was unavailable. Source authority
correctly exposed both stale assumptions.

## Invariant Proof

- Invariant: an incomplete decoded target page has rows and a cursor before the
  Worker offers continuation.
- Producer Proof: Protocol accepts one row plus cursor and rejects empty incomplete.
- Final-Consumer Proof: Worker preserves Profile guidance and renders signed metadata.
- Interface-Shape Sibling Scan: selected, match, cursor, and bare discovery use
  the same decoder; focused Worker and Protocol tests cover them.
- Non-Claims: no live Gateway, installed binary, provider, or release proof.

## Detection Gap

- Stale checkout-dist execution hid the invalid fixture; source authority now
  fails on it directly.

## Sibling Search

- Mental model: guidance is downstream of the signed paging invariant.
- same file: selected/match/cursor queries | fixed now | Worker proof.
- same file outside the focused name filter: session non-rotation target query |
  fixed now | exact source-authoritative subtest.
- abstraction up: Protocol validator | retained | mutation proof.
- cross-file: obsolete renderer metadata cast | removed | type/source proof.

## Seam Risk

- Interrupt ID: target-catalog-continuation-fixture
- Risk Class: external-seam
- Seam: signed Protocol discovery response to Worker guidance.
- Disproving Observation: Protocol accepts an empty incomplete page.
- What Local Reasoning Cannot Prove: live Gateway emission.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-08-13-target-catalog-continuation-fixture.md

## Prevention

Build Worker response fixtures from the signed paging invariant and keep the
decoder mutation beside final-consumer guidance proof.
