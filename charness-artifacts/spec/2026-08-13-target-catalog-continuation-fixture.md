# Implementation Contract

Date: 2026-08-13
Title: Signed Target Catalog Continuation Fixture
Status: active

## Problem

The Worker CLI recovery test constructs an incomplete target-catalog page with
zero returned targets. Signed Protocol 0.72.21 rejects that impossible page, so
the test never reaches the recovery guidance it claims to prove.

## Slice

- Make the shared selected-target fixture satisfy the signed metadata contract.
- Model continuation with a non-empty returned page and a next cursor.
- Replace the pre-handoff expectation that target queries are unavailable with
  current source-authoritative success assertions.

## Success Criteria

1. The continuation fixture decodes and preserves the selected Profile in its
   next action.
2. Empty complete match and unfiltered pages retain their distinct guidance.
3. Selected target queries render signed connector/target/access metadata.
4. Protocol's existing mutation still rejects an empty incomplete page.

## Constraints

- No decoder fallback or compatibility branch.
- Do not change frozen Protocol semantics, versions, pins, or release inputs.
- Run only focused source-authoritative proof; no broad build or gate.

## Proof Boundary

Local source-runner CLI tests plus the existing Protocol paging mutation and a
bounded fresh-eye review. No runtime apply, publish, push, or release.
