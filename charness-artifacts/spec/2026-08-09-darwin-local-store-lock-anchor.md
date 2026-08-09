# Darwin Local Store Lock Anchor
Date: 2026-08-09

## Problem

The shared local-store lock uses a traversable Linux procfs descriptor path on
Darwin, where `/dev/fd/<n>` identifies a descriptor but is not a directory that
accepts child path lookup. The macOS worker therefore cannot acquire any local
store lock.

## Capability Contract

On Linux and supported macOS, Ceal must atomically publish one complete lock
generation, serialize local writers, recover abandoned generations, and avoid
mutating a replacement store parent. Host adaptation may differ; the caller and
typed user-visible outcomes may not.

## Current Slice

Replace the static descriptor-root string in both the lock and owned-file
cleanup with one shared anchored-parent abstraction. Linux may keep direct
`/proc/self/fd/<fd>` traversal. Darwin must
derive the current real directory path from its still-open descriptor, verify
the resolved path has the descriptor's device/inode and owner-only mode, and
resolve again at each mutation boundary that can follow a parent rename.

## Fixed Decisions

- Keep the parent descriptor open from acquisition through release.
- Never fall back to the unverified original user-visible parent after a
  substitution is detected.
- Candidate publication remains a complete private directory followed by one
  same-parent atomic rename.
- Candidate, stable lock, quarantine, owner read, and release paths derive from
  one resolver; owned-file cleanup uses the same resolver and no platform policy
  is copied into store callers.
- Unsupported or unverifiable host behavior fails closed as the caller's typed
  `unsafe_store` outcome.

## Probe Questions

- Does `realpathSync('/dev/fd/<open-directory-fd>')` on the GitHub macOS runner
  return the directory's current path after that directory is renamed?
- Does APFS preserve the candidate-to-stable directory rename collision
  outcomes the lock classifies as contention?

## Deferred Decisions

- A native `openat`/`renameat` addon is deferred unless the bounded Node-core
  solution is disproved by macOS.

## Non-Goals

- Changing lock wait budgets, store schemas, error kinds, or CLI recovery text.
- Claiming a released macOS install or live Gateway/provider behavior.

## Deliberately Not Doing

- Do not disable the macOS gate or loosen owner-only mode checks.
- Do not use the visible original parent as an unconditional Darwin fallback.
- Do not revert to mkdir-then-owner-write, which reopens the incomplete visible
  generation race this lock already closed.

## Constraints

- Node 22 core filesystem APIs only; no runtime compiler or native dependency.
- Linux substitution and concurrency regressions must remain green.
- The release tag remains uncreated until main CI and the release dry run pass.

## Success Criteria

- Ordinary first acquisition succeeds on Linux and macOS.
- Two processes still serialize and a dead owner is still reclaimed.
- Candidate publication never exposes a lock without its owner record.
- Replacing the visible parent during the critical section cannot remove or
  replace a victim lock; release targets the opened parent or fails closed.
- The full Linux and macOS gates pass on the same commit.

## Acceptance Checks

- `unit`: focused `local-store-lock`, session-store, receipt-spool, and
  discovery-cache tests.
- `integration`: `npm run check` locally on Linux.
- `integration`: exact commit's `check.yml` Linux and macOS jobs.
- `specdown`: source census shows every lock path operation derives from the
  anchored-parent abstraction.

## Boundary Ownership

Repository-owned shared lock and tests own the host adaptation. GitHub's macOS
runner owns final host proof; local Linux evidence cannot substitute for it.

## Critique

- Interrupt Source: `darwin-local-store-lock-anchor` from
  `charness-artifacts/debug/latest.md`.
- Seam Summary: a Linux descriptor-path property was generalized to Darwin and
  failed only at the hosted host boundary.
- Chosen Next Step: probe and implement one platform-aware anchored resolver.
- Impl Status: blocked pending the smallest Darwin-capable resolver slice.
- Impl Status Reason: the tag is irreversible and current main CI is red.
- What Disproving Observation Is Resolved: macOS must prove descriptor
  realpath/re-anchoring through the parent-swap test and full consumer suite.

## Canonical Artifact

This file is the implementation contract until the macOS gate is green.

## First Implementation Slice

Refactor `local-store-lock.ts` so every path is requested from the held parent
anchor, add a Darwin-specific resolution seam test without weakening the
existing parent-swap test, then run focused Linux proof and push for exact
macOS CI proof.
