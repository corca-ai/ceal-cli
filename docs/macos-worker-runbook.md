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
`gateway-protocol-handoff-lock.json`. Read the version out of the lock rather
than typing one: this procedure outlived two handoff origins, and a hard-coded
version here is a procedure that keeps working against the wrong archive.

```sh
tag="$(node -p 'require("./gateway-protocol-handoff-lock.json").gateway.tag')"
origin="$(node -p 'require("./gateway-protocol-handoff-lock.json").gateway.origin')"
archive="$(node -p 'require("./gateway-protocol-handoff-lock.json").archive.filename')"
curl -fsSLo "$HOME/Downloads/$archive" "$origin/$tag/$archive"
shasum -a 256 "$HOME/Downloads/$archive"
# must equal archive.sha256 in gateway-protocol-handoff-lock.json
```

The origin also publishes `SHA256SUMS`, `$archive.sig`, and `$archive.pem`
alongside the archive. Verifying the signature is a separate, stronger act than
the digest comparison above, and it is the one that says the bytes came from the
Gateway's release workflow rather than from whoever answered the URL:

```sh
cosign verify-blob --certificate "$HOME/Downloads/$archive.pem" \
  --signature "$HOME/Downloads/$archive.sig" \
  --certificate-identity "$(node -p 'require("./gateway-protocol-handoff-lock.json").reviewed_signature.certificate_identity')" \
  --certificate-oidc-issuer "$(node -p 'require("./gateway-protocol-handoff-lock.json").reviewed_signature.oidc_issuer')" \
  "$HOME/Downloads/$archive"
```

## 3. Compose the darwin asset set

```sh
npm run release:worker:assets -- compose \
  --out "$HOME/ceal-worker-assets-darwin" \
  --gateway-handoff-archive "$HOME/Downloads/$archive" \
  --json
```

The output directory is already installer-shaped for one platform: binary,
platform manifest, deterministic `ceal-guide.tar` containing the complete skill
directory, notices, `install-ceal.sh`, and `SHA256SUMS`.

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

The release platform set is declared in one place: the `build` job's matrix in
`.github/workflows/ceal-release.yml`. Note what that does and does not do — the
worker lane's build gate is `resolvePlatform` in
`build-worker-native-artifact.mjs`, which validates against its own hardcoded
`linux|darwin` pattern and never reads the matrix. The matrix is the declared
release surface and the source the tests derive from, not the thing that unblocks
a darwin build leg.

The legacy `release-contract.json` used to hold this list, and
`build-platform-binaries.mjs` used to gate on its own copy; both went with the
frozen `cealctl` lane.

`worker-release-assets.test.mjs` derives every site above from that build matrix,
so adding or dropping a platform fails the tests until all five agree.
