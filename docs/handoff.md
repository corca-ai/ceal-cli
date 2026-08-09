# Session Handoff

## Workflow Trigger

If this file is mentioned with no other task, start `charness:handoff` at the
first item in `## Next Session`.

## Continuation Capability

Finish the `ceal-v0.76.0` worker release from the already verified and committed
Gateway Protocol handoff without weakening its proof boundary.

## Current State

- The public signed Gateway handoff `gateway-protocol-handoff-v0.72.13` was
  verified through the repo-owned bootstrap and consumed in commit `68be134`.
  `gateway-protocol-handoff-lock.json` binds Gateway commit
  `b644bdcc1883a12f30dec9f15a918eca3676b740`; the committed frozen Protocol tree
  passes `node scripts/verify-protocol-vendor-pin.mjs`.
- The CLI user-quality and startup work is committed locally. It includes static
  route startup, secret-free `--timing` JSONL on stderr, truthful recovery and
  effects, atomic local-store locking, identity-bound receipt history, and the
  concurrency/error-reporting fixes recorded under `charness-artifacts/impl/`.
- The manifests and lockfile are prepared for `0.76.0`. Source commit `f86de98`
  is pushed and GitHub run `31328838700` passed the full gate on both hosted
  macOS and Linux, including the Darwin local-store repair. The dispatch dry
  run, tag, public workflow, installed update, and final handoff refresh have
  not yet completed. Do not describe this candidate as released.

## Next Session

1. Dispatch and read the `ceal-release.yml` dry run because the workflow changed.
2. Create and push `ceal-v0.76.0`, watch the tag workflow, and verify the public
   release inventory, checksums, and signatures.
3. Confirm no legacy `ceal` process is running, then run `ceal update` and the
   local installed readbacks. Leave macOS install and live Gateway/provider
   readback explicitly unclaimed.
4. Refresh this handoff and the release record to the evidence actually reached,
   commit that documentation, and push it.

## References

- [release procedure](release-and-enrollment.md) ·
  [release preconditions and proof ceiling](operator-acceptance.md) ·
  [Protocol pin rules](gates.md) ·
  [release record](../charness-artifacts/release/2026-08-09-ceal-v0-76-0.md)
