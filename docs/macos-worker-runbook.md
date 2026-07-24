# macOS worker build and acceptance runbook

Operator decision (2026-07-24): darwin artifacts are built manually from a Mac
checkout instead of macOS CI runners, to control runner cost while the lane
stabilizes. The `ceal-release.yml` matrix keeps the darwin entries commented
for the later CI cutover.

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

When darwin CI runners are enabled later, uncomment the two darwin matrix
entries in `.github/workflows/ceal-release.yml`; no other lane change is
required (the installer, updater, merge step, and checksum inventory already
accept the four-platform set).
