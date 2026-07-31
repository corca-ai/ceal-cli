# macOS worker build and acceptance runbook

Operator decision (2026-07-25, superseding the 2026-07-24 cost deferral):
`ceal-release.yml` builds and signs `darwin-arm64` on an Apple Silicon macOS CI runner, because
`install-ceal.sh` verifies every asset against its tag-bound OIDC signing
identity and has no unsigned bypass — a manual Mac build therefore has no
supported install path and cannot serve a macOS user.

This runbook remains the local diagnostic route for a Mac checkout. It
produces an unsigned candidate for direct execution only; it is not a release
path and not an installed-client acceptance.

Prerequisites on the Mac: Node `>=22.19.0` and Xcode command line tools
(`codesign`). The release archive is fetched from the static Ceal release
origin; a GitHub Release credential is not involved.

## 1. Build and check from a clean checkout

```sh
git clone https://github.com/corca-ai/ceal-cli.git && cd ceal-cli
npm ci
npm run prewarm:offline-cache
npm run check
```

The prewarm step caches the exact lockfile-pinned dependency closure that the
`npm install --offline` packed-consumer proofs need; a cold npm cache
otherwise fails those proofs with `ENOTCACHED`.

`npm run check` is darwin-aware: the native artifact integration test builds a
real `ceal-darwin-<arch>` SEA binary, removes the runtime signature before
postject injection (`--macho-segment-name NODE_SEA`), and ad-hoc re-signs it.

## 2. Obtain the locked Gateway handoff archive

The only consumable Protocol input is the archive pinned by
`gateway-handoff-lock.json`. Download the static, versioned archive and
verify its digest:

```sh
curl -fsSLo "$HOME/Downloads/ceal-gateway-handoff-0.65.0.tar.gz" \
  https://ceal.borca.ai/releases/gateway-handoff/gateway-handoff-v0.65.0/ceal-gateway-handoff-0.65.0.tar.gz
shasum -a 256 "$HOME/Downloads/ceal-gateway-handoff-0.65.0.tar.gz"
# must equal archive.sha256 in gateway-handoff-lock.json
```

## 3. Compose the darwin asset set

```sh
npm run release:worker:assets -- compose \
  --out "$HOME/ceal-worker-assets-darwin" \
  --gateway-handoff-archive "$HOME/Downloads/ceal-gateway-handoff-0.65.0.tar.gz" \
  --json
```

The output directory is already installer-shaped for one platform: binary,
platform manifest, guide, notices, `install-ceal.sh`, and `SHA256SUMS`.

## 4. What this proves, and what it does not

Running the composed binary directly (`./ceal-darwin-arm64 version`,
`commands`, `capabilities --help`, `observe`) proves the native darwin build
and worker-only surface. It is an unsigned local candidate: it proves no
signed release, no installed-client acceptance, and no Gateway/provider
action. The roadmap's macOS acceptance milestone (native install, `ceal
update`, guide registration, enrollment, one read-only governed capability)
requires a cosign-signed darwin release from the CI lane, because
`install-ceal.sh` fail-closes on unsigned assets by design — do not bypass its
verification to fake an installed acceptance.

## 5. Why the CI cutover was not a two-line change

The installer retains the historical four-platform vocabulary so an immutable
Intel release can still be verified or rolled back to, but new release builds
name only `linux-arm64`, `linux-amd64`, and `darwin-arm64`. Five release-lane
sites name the current platforms explicitly and must move together, plus one
macOS portability defect:

- `assemble` downloaded and merged two named linux handoffs;
- `sign-and-publish` pinned an exact linux inventory string, a per-platform
  manifest loop, and the signing array;
- `ceal-worker-stable-rollback.yml` now verifies the signed `SHA256SUMS`
  before it derives a bounded complete platform set, so it can roll back both
  older four-platform tags and future three-platform tags without trusting an
  arbitrary inventory name;
- the build job verified the handoff archive with `sha256sum`, which macOS
  runners do not ship; it now uses node.

`release-contract.json` `native_build_matrix` declares the current three
release platforms, but note what it does and does not do: the worker lane's build gate is `resolvePlatform` in
`build-worker-native-artifact.mjs`, which validates against its own hardcoded
`linux|darwin` pattern and never reads the contract. `requireTargetPlatform`
in `build-platform-binaries.mjs` belongs to the frozen `cealctl` lane. The
contract entry is the declared release surface and the source the tests derive
from — not the thing that unblocks a darwin build leg.

`worker-release-assets.test.mjs` derives every site above from
`signed_release_platforms`, so adding or dropping a platform fails the tests
until all five agree.
