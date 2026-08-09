# Darwin Local Store Lock Anchor

## Implemented

- Linux retains direct child operations through `/proc/self/fd/<fd>`.
- Darwin verifies the visible parent against the held descriptor's type,
  device, inode, and owner-only mode immediately before each path operation.
- Candidate, owner, quarantine, release, and owned-file cleanup paths share one
  resolver. A Darwin rename or substitution fails closed without following the
  replacement parent.

## Capability Delivered

Concurrent macOS `ceal` processes can use session, cache, and receipt stores
without the lock rejecting every ordinary write, while parent replacement
still preserves files outside the opened store.

## Contract Source

`charness-artifacts/spec/2026-08-09-darwin-local-store-lock-anchor.md`

## Verification

- Focused build and lock/guard suites passed locally.
- `npm run check`, `npm run check:duplication`, `npm run lint:shell`, debug
  artifact validation, and `git diff --check` passed on the release host.
- Exact commit `f86de98fac4d3f629f1c74ba64785d5da124032a`
  passed GitHub run `31328838700`: macOS job `93283655563` and Linux job
  `93283655579` both completed the full gate.
- The macOS job is source/test host proof, not an installed macOS release proof.

## Lint Gate

Ran and passed through the local full gate, pre-push iteration gate,
maintainer-local duplication ratchet, and shell lint.

## Truth Surface Sync

The debug artifact records both disproved Darwin descriptor-path designs and
the final host proof. The release record and handoff name the exact green run.

## Boundary Ownership

Owned correctly: the shared repository lock owns platform adaptation; store
callers retain their typed outcomes and do not copy host policy.

## Critique

Full fresh-eye review found and closed captured candidate/quarantine path
windows. Re-review accepted the final verified-visible-path design subject to
the exact hosted macOS full gate, which passed.

## Contract Updates

The contract now states the observed Darwin limit: Node cannot traverse or
recover a directory pathname through `/dev/fd`, so parent replacement fails
closed instead of following a renamed directory.

## Residual Risks

- A same-UID hostile process can target the narrow identity-check-to-syscall
  interval; eliminating that requires native `*at` operations outside the
  Node-core-only contract.
- Darwin may leave a nonce-private candidate or owned generation in the renamed
  directory when it fails closed. It cannot become the stable lock in the
  replacement parent and is recoverable or inert.
- Installed macOS and live Gateway/provider behavior remain unclaimed.

## Next Slice

Continue the release dry run, immutable tag workflow, public artifact
verification, and installed Linux readback.
