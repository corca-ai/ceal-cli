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
verify the caller's visible parent has the held descriptor's device/inode and
owner-only mode immediately before each path operation. Node cannot recover or
traverse a directory pathname from Darwin `/dev/fd`; a rename or substitution
therefore fails closed instead of following either path.

## Fixed Decisions

- Keep the parent descriptor open from acquisition through release.
- Never fall back to the unverified original user-visible parent after a
  substitution is detected.
- Darwin may leave the current private candidate or owned lock generation for
  later stale recovery when its parent is renamed; it must not redirect cleanup
  into the replacement parent.
- Candidate publication remains a complete private directory followed by one
  same-parent atomic rename.
- Candidate, stable lock, quarantine, owner read, and release paths derive from
  one resolver; owned-file cleanup uses the same resolver and no platform policy
  is copied into store callers.
- Unsupported or unverifiable host behavior fails closed as the caller's typed
  `unsafe_store` outcome.

## Resolved Probes

- GitHub macOS run `31328528711`, job `93282848863`, disproved descriptor
  pathname recovery: `realpathSync('/dev/fd/<open-directory-fd>')` was refused
  both before ordinary lock work and after rename.
- The next host proof therefore tests verified visible-path operation and
  fail-closed parent replacement, not descriptor-path recovery.

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
  replace a victim lock; Linux targets the opened parent and Darwin fails
  closed without following the replacement.
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
- Chosen Next Step: verify the visible Darwin parent against the held
  descriptor at every operation boundary.
- Impl Status: complete.
- Impl Status Reason: commit `f86de98` passed GitHub run `31328838700` on both
  hosted macOS and Linux after the first realpath design was disproved.
- What Disproving Observation Is Resolved: macOS disproved descriptor
  realpath/re-anchoring; the replacement must pass the parent-swap tests and
  full consumer suite by failing closed on rename.

## Canonical Artifact

This file records the completed implementation contract. Closeout evidence is
in `charness-artifacts/impl/2026-08-09-darwin-local-store-lock-anchor.md`.

## First Implementation Slice

Refactor `local-store-lock.ts` so every path verifies the visible parent against
the held descriptor, add a Darwin-specific fail-closed seam test without
weakening the existing victim-preservation assertions, then run focused Linux
proof and push for exact macOS CI proof.
