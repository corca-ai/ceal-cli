# cealctl

`cealctl` is the operator/control client for [Ceal](https://ceal.borca.ai) — a
Slack-first organizational AI coworker runtime that runs in **your** environment.

This repository distributes **signed `cealctl` binaries only**. Ceal's source
stays private; nothing here is the product source.

## Install (Linux)

```sh
curl -fsSL https://raw.githubusercontent.com/corca-ai/ceal-cli/main/install.sh | sh
```

This downloads the latest signed binary and verifies its SHA-256 before
installing to `~/.local/bin`. To pin a version or change the location:

```sh
VERSION=0.1.0 INSTALL_DIR="$HOME/.local/bin" sh install.sh
```

Binaries are published per release with `SHA256SUMS`, a release manifest, and
keyless [cosign](https://docs.sigstore.dev/) signatures (`.sig` + `.pem`). The
signing identity is this repo's `cealctl-release.yml` workflow at the matching
release tag — verify with `cosign verify-blob` using that identity.

Linux `x64` and `arm64` are supported today. macOS/Windows are not yet published.

## Getting started

See the **[Quickstart](https://ceal.borca.ai/quickstart)**.

Common commands:

```sh
cealctl doctor      # readiness (Slack tokens, AI auth, scopes, provider health)
cealctl status      # healthy / degraded / blocked
cealctl logs --limit 50
```

Recovery is preview-first (`cealctl restart --plan`, `cealctl update --check`).

## Status

Ceal is invitation-only MVP. Request access through your Ceal contact.
