#!/usr/bin/env sh
set -eu

REPO="corca-ai/ceal-cli"
VERSION="${CEALCTL_VERSION:-}"
INSTALL_DIR="${CEALCTL_INSTALL_DIR:-$HOME/.local/bin}"
WORKFLOW_FILE="cealctl-release.yml"
ISSUER="https://token.actions.githubusercontent.com"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

detect_platform() {
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os:$arch" in
    Linux:x86_64|Linux:amd64) printf '%s\n' linux-x64 ;;
    Linux:aarch64|Linux:arm64) printf '%s\n' linux-arm64 ;;
    Darwin:arm64) printf '%s\n' macos-arm64 ;;
    Darwin:x86_64) printf '%s\n' macos-x64 ;;
    *) fail "Unsupported cealctl platform: $os $arch (supported: linux-x64, linux-arm64, macos-x64, macos-arm64)" ;;
  esac
}

# macOS ships shasum (not sha256sum); support both rather than depend on one.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

resolve_latest_version() {
  curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep '"tag_name":' | head -n 1 | sed -e 's/.*"tag_name":[[:space:]]*"//' -e 's/".*//'
}

PLATFORM="$(detect_platform)"
need curl
need cosign
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || fail "sha256sum or shasum is required"

# CEALCTL_VERSION pins a release tag; if unset, install the latest release.
if [ -z "$VERSION" ]; then
  VERSION="$(resolve_latest_version)"
fi
case "$VERSION" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) fail "Could not determine a cealctl release version. Set CEALCTL_VERSION to a tag such as v0.1.0." ;;
esac

ASSET="cealctl-$PLATFORM"
BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

curl -fsSL "$BASE_URL/$ASSET" -o "$TMP_DIR/$ASSET"
curl -fsSL "$BASE_URL/$ASSET.sig" -o "$TMP_DIR/$ASSET.sig"
curl -fsSL "$BASE_URL/$ASSET.pem" -o "$TMP_DIR/$ASSET.pem"
curl -fsSL "$BASE_URL/SHA256SUMS" -o "$TMP_DIR/SHA256SUMS"

EXPECTED="$(grep -E "^[a-f0-9]{64}  $ASSET$" "$TMP_DIR/SHA256SUMS" | head -n 1 | cut -d' ' -f1)"
[ -n "$EXPECTED" ] || fail "SHA256SUMS is missing $ASSET"
ACTUAL="$(sha256_of "$TMP_DIR/$ASSET")"
[ "$EXPECTED" = "$ACTUAL" ] || fail "Checksum mismatch for $ASSET"

IDENTITY="^https://github[.]com/$REPO/[.]github/workflows/$WORKFLOW_FILE@refs/tags/$VERSION$"
cosign verify-blob \
  --certificate "$TMP_DIR/$ASSET.pem" \
  --signature "$TMP_DIR/$ASSET.sig" \
  --certificate-identity-regexp "$IDENTITY" \
  --certificate-oidc-issuer "$ISSUER" \
  --certificate-github-workflow-repository "$REPO" \
  --certificate-github-workflow-ref "refs/tags/$VERSION" \
  "$TMP_DIR/$ASSET" >/dev/null

mkdir -p "$INSTALL_DIR"
[ ! -L "$INSTALL_DIR" ] || fail "Install directory must not be a symlink"
chmod 700 "$INSTALL_DIR"
chmod 755 "$TMP_DIR/$ASSET"
TARGET="$INSTALL_DIR/cealctl"
NEXT="$TARGET.tmp.$$"
cp "$TMP_DIR/$ASSET" "$NEXT"
mv "$NEXT" "$TARGET"

printf 'Installed cealctl %s (%s) at %s\n' "$VERSION" "$PLATFORM" "$TARGET"
