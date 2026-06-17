# cealctl

Public operator CLI distribution for Ceal.

This repository contains only customer-facing cealctl release material:
platform binaries, checksums, cosign signatures, release manifests, install
scripts, and operator documentation. It is not a mirror of the Ceal product
source tree.

Public binaries are built for Linux and macOS: `linux-x64`, `linux-arm64`,
`macos-x64` (Intel), and `macos-arm64` (Apple Silicon).

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/corca-ai/ceal-cli/main/install.sh | sh
```

The installer detects your platform, installs the latest release (set
`CEALCTL_VERSION=v0.1.0` to pin a specific tag), verifies SHA256, verifies the
cosign certificate identity for the cealctl release workflow, and installs the
binary atomically under `$HOME/.local/bin` by default. On macOS the binary is
installed via `curl` (no quarantine attribute), so Gatekeeper does not block it.
`cosign` is required for signature verification.

## Verify Manually

Release assets are published under tags such as `v0.1.0`:

- `cealctl-linux-x64` (+ `.sig`, `.pem`)
- `cealctl-linux-arm64` (+ `.sig`, `.pem`)
- `cealctl-macos-x64` (+ `.sig`, `.pem`)
- `cealctl-macos-arm64` (+ `.sig`, `.pem`)
- `SHA256SUMS`
- `ceal-release-manifest.json`

Use `cosign verify-blob` with issuer
`https://token.actions.githubusercontent.com`, repository
`corca-ai/ceal-cli`, and workflow ref `refs/tags/<tag>`.
