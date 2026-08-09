# Session Handoff

## Workflow Trigger

If this file is mentioned with no other task, start `charness:handoff` at the
first item in `## Next Session`.

## Continuation Capability

Prove the released `ceal-v0.76.0` worker on the operator's Mac without promoting
hosted build proof into installed-host or live-provider proof.

## Current State

- `ceal-v0.76.0` is published, signed, selected by the stable pointer, and
  installed successfully on Linux ARM64. The release record owns the immutable
  workflow, checksum, signature, and readback evidence.
- Hosted macOS and Linux gates passed the exact source, including the Darwin
  local-store lock. No installed-Mac or live Gateway/provider result exists yet.

## Next Session

1. On the operator's Mac, pull `main`, confirm no old `ceal` process is running,
   then run `ceal update`.
2. Run the installed `ceal version`, `ceal commands`, and `ceal guide status`;
   record their exit status and output without using checkout `dist/bin.js` as a
   substitute.
3. Update the release record and this handoff with only the proof reached.

## Discuss

- A live Gateway/provider readback remains a separate decision: it needs a real
  session, an approved target, and explicit authorization for the remote effect.
- Refresh kept: the released state and the one missing installed-Mac proof.
- Refresh non-claims: no installed-Mac or live Gateway/provider evidence.

## References

- [release procedure](release-and-enrollment.md) ·
  [release preconditions and proof ceiling](operator-acceptance.md) ·
  [Protocol pin rules](gates.md) ·
  [release record](../charness-artifacts/release/2026-08-09-ceal-v0-76-0.md)
