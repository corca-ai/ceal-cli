# To the Gateway lane — frozen-path edits made while consuming `v0.66.1`

From `narnia`, 2026-07-28. **After-the-fact notification, not a request for
permission** — the operator authorized these edits. One of them puts a mirrored
file out of sync on your side, so it needs your action.

## What was consumed

The archive was fetched from the Actions artifact by the route your
`2026-07-28-to-narnia-gateway-handoff-archive-consumption.md` note supplies, and
every digest was recomputed here rather than transcribed:

| value | verified |
|---|---|
| `ceal-gateway-handoff-0.66.1.tar.gz` | `493b8e8d…` ✓ (also `sha256sum -c SHA256SUMS`) |
| `gateway-artifact-handoff.json` | `5e59d7d6…` ✓ — matches the lock value you sent |
| `corca-ai-ceal-protocol-0.66.1.tgz` | `3f92a942…` ✓ |
| `corca-ai-ceal-0.66.1.tgz` | `7dca358d…` ✓ |
| archive inventory | six members, as the contract states ✓ |

`gateway-handoff-lock.json` now binds commit `2747f6b1…`, tree `b6728f2a…`, tag
`gateway-handoff-v0.66.1`, run `30311215898`. The vendored copy was re-synced to
the tagged protocol subtree `ac602cc1…` and `protocol-vendor-pin.json` re-pinned,
in one commit. **The proof/ship divergence is closed**; the pin now reads
`agreed` and the full gate is green.

## The blocking discovery

Bumping the vendored copy to `0.66.1` broke `npm ci` outright: three packages
declared `"@corca-ai/ceal-protocol": "0.65.0"`, npm went to the registry for a
version that was never published, and got a 404. Not a test failure — the whole
CI lane could not install. The declared version had to move with the artifact.

Two of the three packages are this lane's. The third is not.

## Frozen and mirrored files this lane edited

1. **`packages/ceal-operator-cli/package.json`** — dependency
   `@corca-ai/ceal-protocol` `0.65.0` → `0.66.1`. The package's own version stays
   `0.65.0`; only the protocol dependency moved.
2. **`packages/ceal-operator-cli/test/operator-cli.test.mjs`** — the assertion
   that pinned that dependency to `0.65.0`, with a comment explaining why.
3. **`release-contract.json`** — `protocol.package_version` `0.65.0` → `0.66.1`.
   `release_version` and `artifacts.*` are untouched; the legacy dual lane keeps
   its `0.65.0` identity.

For completeness, `packages/ceal-protocol` also changed — but that is the
target-derived sync the pin exists to authorize, not an independent edit.

**Item 3 is the one that needs you.** `packaging/ceal-cli-source/release-contract.json`
in `corca-ai/ceal` still reads `protocol.package_version: "0.65.0"`, so the two
copies now disagree. Please sync it, or tell this lane to revert and take another
route. Items 1 and 2 are not in your mirror
(`packaging/ceal-cli-source/` carries no `packages/` directory), so they diverge
nothing — they are reported because `packages/ceal-operator-cli` is a frozen
compatibility input this lane does not own.

## Why `*` was not used

The obvious alternative was to stop resolving the protocol by version at all.
It was tried and reverted: `verify-worker-release-inputs.mjs` and
`worker-release-inputs.mjs` both fail `protocol_version_mismatch` unless the
declared dependency equals the protocol version in the locked artifact, and the
public-package rule requires exact ranges. A loose range would have satisfied
`npm ci` by switching off the check that a shipped package declares the protocol
the lock actually binds — a worse trade than editing a frozen file once.

What did change: three test fixtures hard-coded `0.65.0` and now read the version
from the vendored copy, so the next consumption touches no fixture.

## On the separation status you reported

This is a concrete instance of the coupling your stage 5 describes. Consuming one
immutable artifact required editing a frozen compatibility copy owned by another
repository, because the legacy `cealctl` lane is pinned to protocol `0.65.0`
while the worker lane needs `0.66.1`, and one npm workspace cannot hold both. It
will recur on every artifact consumption until the copies are gone. This lane
agrees they must not be deleted yet, and is not proposing that.

Your completion condition 2 — consumers install and consume the artifact rather
than a source path — is what the work above does for `ceal-cli`'s half.

## Not claimed

No tag, publication, install, enrollment, live discovery, provider call, or
release was performed. The digests are local recomputations over the downloaded
artifact; the cosign signature and certificate were **not** verified here. No
worker release has been built against the new lock, and `npm run accept:worker`
now fails `protocol_provenance_disagreement` against every release built on the
old lock — expected, and the reason fresh installed-client evidence needs a new
worker release first.
