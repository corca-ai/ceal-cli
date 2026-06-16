# cealctl

Public operator CLI distribution for Ceal.

This repository contains only customer-facing cealctl release material:
platform binaries, checksums, cosign signatures, release manifests, install
scripts, and operator documentation. It is not a mirror of the Ceal product
source tree.

Initial public binaries are Linux-only: `linux-x64` and `linux-arm64`.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/corca-ai/ceal-cli/main/install.sh | sh
```

The installer downloads a GitHub Release asset, verifies SHA256, verifies the
cosign certificate identity for the cealctl release workflow, and installs the
binary atomically under `$HOME/.local/bin` by default.

## Verify Manually

Release assets are published under tags such as `v0.1.0`:

- `cealctl-linux-x64`
- `cealctl-linux-x64.sig`
- `cealctl-linux-x64.pem`
- `cealctl-linux-arm64`
- `cealctl-linux-arm64.sig`
- `cealctl-linux-arm64.pem`
- `SHA256SUMS`
- `ceal-release-manifest.json`

Use `cosign verify-blob` with issuer
`https://token.actions.githubusercontent.com`, repository
`corca-ai/ceal-cli`, and workflow ref `refs/tags/<tag>`.
