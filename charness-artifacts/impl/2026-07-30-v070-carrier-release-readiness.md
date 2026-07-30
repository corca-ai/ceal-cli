# Worker 0.70 Carrier Release Readiness — Closeout

## Implemented

Prepared worker version `0.70.0` from the existing verified-email first-device
adoption and private leased-consumer carrier source. Native artifact builds now
refuse generated Gateway handoff drift before bundling; every platform manifest
records that handoff identity, and merge rejects a cross-platform split.

## Capability Delivered

A future signed worker release can carry the employee-facing `ceal session
adopt` surface and the Agent private carrier without allowing a stale generated
Gateway conformance handoff to ship on a platform that did not run the source
generator.

## Contract Source

`gateway-leased-consumer-call-handoff-lock.json`, its vendored Gateway
conformance handoff, `gateway-handoff-lock.json`, and the worker release
workflow. Gateway handoff v0.68.0 is publicly retrievable and SHA-256 matches
the lock; that is an input fact, not a release claim.

## Verification

- `npm ci --ignore-scripts --no-audit --no-fund` passed.
- `npm run check` passed after the final source, test, documentation, version,
  and lockfile changes.
- `node --test test/contract/worker-release-assets.test.mjs` passed 9/9,
  including stale generated-handoff and cross-platform handoff-identity
  rejection.
- Public read-only HEAD of the v0.68.0 Gateway archive returned HTTP 200 before
  the release preparation; no Gateway route or employee mailbox was called.

## Lint Gate

ran-pass `npm run lint` and `npm run check`.

## Truth Surface Sync

`AGENTS.md` now records `vinc` as the temporary integrated ceal-cli operating
checkout and removes the obsolete Gateway source-projection rule.
`docs/release-and-enrollment.md` makes verified-email first-device adoption the
preferred flow while preserving the live-proof boundary. `docs/handoff.md` and
`CHANGELOG.md` record the published handoff origin, candidate scope, and
non-claims.

## Boundary Ownership

owned-correctly — worker source, worker release manifests, and worker tags are
ceal-cli-owned. Gateway archive generation, Gateway apply, mail delivery,
device acceptance, audit custody, and Agent service cutover remain outside this
slice.

## Critique

full parent-delegated fresh-eye review. One reviewer found the actual
all-platform stale-generated-handoff sealing gap; it was fixed and the same
reviewer re-verified the correction as PASS. A release-boundary reviewer also
identified and corrected the obsolete source-projection ownership text.

## Residual Risks and Non-Claims

This is local source proof only. No source commit has been pushed in this
slice; no workflow dispatch, tag, signature, release-origin upload, stable
pointer move, Gateway apply, mail delivery, device enrollment, installed-client
acceptance, or provider call occurred. `ceal-v0.70.0` does not exist yet.

## Next Slice

With separate approval: push `main` and observe normal CI; then run the
non-publishing release workflow dispatch. Only after it succeeds should an
explicitly approved `ceal-v0.70.0` tag trigger signing, publication, and stable
pointer movement.

Instance apply: not applicable.
