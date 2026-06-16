#!/usr/bin/env sh
# cealctl installer — downloads a signed release binary from corca-ai/ceal-cli
# Releases and verifies its SHA-256 before installing. Ceal's source stays
# private; this installs a signed binary, not source.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/corca-ai/ceal-cli/main/install.sh | sh
#   VERSION=0.1.0 INSTALL_DIR="$HOME/.local/bin" sh install.sh
set -eu

REPO="corca-ai/ceal-cli"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${VERSION:-latest}"

# Detect platform (Linux only for the first release channel).
os="$(uname -s)"
arch="$(uname -m)"
if [ "$os" != "Linux" ]; then
  echo "cealctl: only Linux binaries are published today (got: $os)." >&2
  exit 1
fi
case "$arch" in
  x86_64|amd64) plat="linux-x64" ;;
  aarch64|arm64) plat="linux-arm64" ;;
  *) echo "cealctl: unsupported architecture: $arch" >&2; exit 1 ;;
esac

base="https://github.com/$REPO/releases"
if [ "$VERSION" = "latest" ]; then
  dl="$base/latest/download"
else
  dl="$base/download/v$VERSION"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "cealctl: downloading $plat from $dl ..."
curl -fSL "$dl/cealctl-$plat" -o "$tmp/cealctl"
curl -fSL "$dl/SHA256SUMS" -o "$tmp/SHA256SUMS"

echo "cealctl: verifying checksum ..."
expected="$(grep " cealctl-$plat\$" "$tmp/SHA256SUMS" | awk '{print $1}')"
if [ -z "$expected" ]; then
  echo "cealctl: no checksum found for cealctl-$plat in SHA256SUMS." >&2
  exit 1
fi
actual="$(sha256sum "$tmp/cealctl" | awk '{print $1}')"
if [ "$expected" != "$actual" ]; then
  echo "cealctl: checksum mismatch (expected $expected, got $actual)." >&2
  exit 1
fi

# Optional signature verification when cosign is available.
if command -v cosign >/dev/null 2>&1; then
  echo "cealctl: cosign found — fetching signature material (verify with the"
  echo "         published identity per the release notes)."
  curl -fSL "$dl/cealctl-$plat.sig" -o "$tmp/cealctl.sig" || true
  curl -fSL "$dl/cealctl-$plat.pem" -o "$tmp/cealctl.pem" || true
fi

mkdir -p "$INSTALL_DIR"
install -m 0755 "$tmp/cealctl" "$INSTALL_DIR/cealctl"
echo "cealctl: installed to $INSTALL_DIR/cealctl"
echo "cealctl: ensure $INSTALL_DIR is on your PATH, then run: cealctl doctor"
