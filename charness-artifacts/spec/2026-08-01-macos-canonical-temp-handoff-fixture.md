# macOS Canonical Temporary Handoff Fixture Contract

## Problem

The protocol-handoff archive fixture was created below `tmpdir()` without
canonicalizing its path. On macOS, `tmpdir()` can begin at `/var`, an OS-owned
alias to `/private/var`; the production archive validator correctly refuses
symbolic-link ancestry, so the positive fixture never reaches archive
validation.

## Capability Contract

The worker contract suite must exercise a regular archive fixture on macOS and
Linux while preserving production refusal of a caller-supplied archive that
traverses a symbolic link.

## Current Slice

Canonicalize only the fixture root immediately after `mkdtempSync`. Do not
weaken the production `assertNoSymlinkAncestor` boundary.

## Fixed Decisions

- `realpathSync(mkdtempSync(...))` is the fixture root.
- Production archive-path rejection remains unchanged.

## Probe Questions

- None; the macOS CI log directly identifies the `/var` ancestor rejection.

## Deferred Decisions

- Whether user-supplied macOS `/var/...` paths should be normalized is a
  separate product/security decision; this test fixture does not decide it.

## Non-Goals

- No Gateway handoff, worker protocol, or carrier behavior change.
- No broader symbolic-link policy change.

## Constraints

- A final archive file and every non-OS-alias ancestor remain non-symlinked.
- The fixture cleanup continues to target the canonical temporary directory.

## Success Criteria

- The two positive/negative archive tests run on macOS.
- An explicit directory-symlink-ancestor negative test rejects the same valid
  archive with `invalid_protocol_handoff_archive`.

## Acceptance Checks

- `unit`: `node --test test/contract/worker-gateway-protocol-handoff-archive.test.mjs` passes on Linux.
- `integration`: the macOS `check-native` job reaches the full contract suite without failing on its OS temporary-root alias.

## Boundary Ownership

- Test fixture ownership: `corca-ai/ceal-cli`.
- Archive path-security policy: unchanged `corca-ai/ceal-cli` production code.

## Critique

- Interrupt Source: `charness-artifacts/debug/2026-08-01-debug-review.md`.
- Seam Summary: macOS filesystem alias versus a test fixture, not a Gateway or provider boundary.
- Chosen Next Step: fixture-only implementation.
- Impl Status: ready.
- Impl Status Reason: the observed macOS error and a code reading identify the precise fixture path.
- What Disproving Observation Is Resolved: the failure is reproducible from the fixture's noncanonical `tmpdir()` root; no production behavior is changed.

## Canonical Artifact

This file plus `test/contract/worker-gateway-protocol-handoff-archive.test.mjs`.

## First Implementation Slice

Import `realpathSync`, canonicalize the fixture root, add the directory-symlink
negative case, and run the focused test.
