# Session Handoff

## Workflow Trigger

If this file is mentioned with no other task, start `charness:handoff` at the
first item in `## Next Session`.

## Continuation Capability

Consume the next signed Gateway Protocol handoff without confusing a local
Gateway checkout, a remote tag, and a published release; then cut the worker
release only from one coherent pinned input slice.

## Current State

- Gate builds, package-local test/coverage hooks, and release fixtures now share
  the `dist` owner documented in [gates.md](gates.md). The current-slice contract
  and proof commands live in
  [2026-08-09-gate-build-reuse.md](../charness-artifacts/impl/2026-08-09-gate-build-reuse.md).
- The v5 worker release remains ordered behind the exact signed handoff named in
  [the Gateway request](requests/2026-08-09-to-gateway-protocol-handoff-v0-72-13.md).
  A dirty or advanced `../ceal` worktree is not a release input.

## Next Session

1. Read the remote tag and published-release state with
   `git -C ../ceal ls-remote --tags origin 'gateway-protocol-handoff-v0.72.13*'`
   and the four assets under
   `https://ceal.borca.ai/releases/gateway-protocol-handoff/gateway-protocol-handoff-v0.72.13/`.
   Gateway creates no GitHub Release. If any asset is absent, stop.
2. Before consuming any bytes, add and prove the repo-owned read-only bootstrap
   required by [release-and-enrollment.md](release-and-enrollment.md). It must
   verify sums, Sigstore identity, remote tag/commit, archive inventory, and the
   candidate lock tuple without writing this repository. Until it exists, stop;
   do not derive a lock or vendor bytes from `../ceal`.
3. Use only that verified candidate to commit the frozen protocol tree, both pin
   files, private control-session contract, generated source, and workflow
   literals as one handoff-input slice. Falsify the pin before accepting it.
4. Make the manifest/package-lock version bump as a separate release commit,
   run `npm run check`, and confirm the free preconditions in
   [operator-acceptance.md](operator-acceptance.md).
5. At each push, tag, and publish boundary apply `AGENTS.md` `## Boundaries`
   separately. After the approved main push, read its `check.yml`; only then
   obtain both tag and release-publish authority before the tag push.
6. Complete the worker release procedure through installed `ceal update`
   readback. Do not describe that as a live provider readback without a real
   Gateway session.

## Discuss

- A release tag is irreversible. Gateway writes remain a separate approval and
  are not part of this continuation.

## References

- [release procedure](release-and-enrollment.md) ·
  [release preconditions and proof ceiling](operator-acceptance.md) ·
  [protocol pin rules](gates.md) · [standing goal](release-guard-reachability.md)

Refresh kept: the signed-handoff dependency, missing trust bootstrap, and exact
release sequence.
Refresh non-claims: no Gateway handoff release, worker tag, installed update, or
live provider behavior is claimed here; the commands above must re-read them.
