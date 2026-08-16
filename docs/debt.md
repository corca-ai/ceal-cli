# Carried Debt

Items known and not scheduled. Re-check that an item is still true before
starting on it, and delete it here when it stops being. Every item below was
re-confirmed against the tree on 2026-08-09, each against the `file:line` it now
names; four were restated because the surface had moved under them. Confirmed is
not scheduled, and a later reader owes the same re-check.

Work that belongs to the standing goal lives in
[release-guard-reachability.md](release-guard-reachability.md), not here.
Everything else not listed is owned by the comment at the site and by the gate
reasoning in [gates.md](gates.md).

- **CI runs macOS but proves no install there.** `check.yml`'s `check-native` leg
  and the release lane's `darwin-arm64` build both set
  `require_platform_proofs: "0"`, and `test/platform-proof.ts` grants a non-skip
  only on `linux`/`x64`, so every installed-binary and installer proof self-skips
  on macOS. Do not "fix" this by flipping the flag — requiring it across all of
  `linux-*` is what burned `ceal-v0.67.0`. What a Mac checkout can still do
  locally is the unsigned diagnostic build in
  [macos-worker-runbook.md](macos-worker-runbook.md), which is explicitly not a
  release path and not an installed-client acceptance.
- **Tag pre-push takes roughly four minutes on the current ARM64 maintainer
  host.** The two overlapping `ceal-v0.77.0` attempts recorded 263 seconds and
  259 seconds for the full-gate phase. The concurrency repair prevents paying
  that cost twice, but does not make one retained gate cheaper. Reopen after the
  release completes: use `.charness/quality/command-timing.jsonl` and a fresh
  proof run to attribute the slow phases, then improve retained-path scope or
  fixtures without removing the full coverage/build/release proof.
