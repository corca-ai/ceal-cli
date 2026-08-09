# Ceal CLI Freeze Handoff

## Workflow Trigger

If this file is mentioned with no other task, do not start implementation.
Confirm the repository is still frozen and report the release and backlog
pointers below. Source work resumes only on an explicit operator unfreeze.

## Continuation Capability

Preserve the released `ceal-v0.76.0` worker as an immutable input and leave this
checkout quiescent. Consumers receive the public release identity; no sibling
repository edit or live-system action is part of this handoff.

## Current State

- `ceal-v0.76.0` is published, signed, selected by the stable pointer, and
  installed/read back on Linux ARM64. The release record owns exact evidence.
- Gateway Protocol handoff `gateway-protocol-handoff-v0.72.13` is the frozen
  input consumed by the release. Downstream selection is a consumer proof, not
  additional work or a claim in this repository.
- `main` contains the post-release closeout. The release tag deliberately points
  to its immutable release commit rather than to later documentation commits.
- Ordinary performance, quality, feature, and debt work is frozen. Record a new
  defect as an issue; do not patch or release until the operator unfreezes this
  repository.

## Next Session

1. Stay frozen unless the operator explicitly requests ceal-cli work.
2. On unfreeze, refresh the live issue inventory and re-confirm each item in
   [carried debt](debt.md) before scheduling it.
3. Continue Slice 2 of the unfinished
   [release-guard goal](release-guard-reachability.md) by first re-checking its
   acceptance-packet and release-script candidates. Do not redo completed
   Slices 1, 3, or the implemented Slice 4 signal.
4. Keep [issue #7](https://github.com/corca-ai/ceal-cli/issues/7) and
   [issue #9](https://github.com/corca-ai/ceal-cli/issues/9) open as deferred
   worker-owned backlog. Issues `#8` and `#12` shipped in `ceal-v0.76.0` and are
   closed.

## Discuss

- Installed macOS readback is still absent and remains ceal-cli worker-lane
  proof debt. After an explicit unfreeze, follow
  [operator acceptance](operator-acceptance.md); it does not require a source
  change by itself.
- Historical acceptance-record defects and the structural raw-session-writer
  hole remain parked in [carried debt](debt.md). The same file owns the macOS
  install-proof gap and the closed shutdown-hang history.
- Refresh kept: immutable release identity, freeze boundary, every durable debt
  owner, and the complete open-issue inventory.
- Refresh non-claims: no installed-Mac, downstream selection, provider
  roundtrip, or live audit proof.

## References

- [release record](../charness-artifacts/release/2026-08-09-ceal-v0-76-0.md) ·
  [carried debt](debt.md) ·
  [standing release-guard goal](release-guard-reachability.md) ·
  [release procedure](release-and-enrollment.md)
