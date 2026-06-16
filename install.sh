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
    *) fail "Unsupported cealctl platform: $os $arch. Initial public cealctl binaries are Linux-only." ;;
  esac
}

case "$VERSION" in
  v[0-9]*.[0-9]*.[0-9]*)
    ;;
  "")
    fail "Set CEALCTL_VERSION to a release tag such as v0.1.0"
    ;;
  *)
    fail "CEALCTL_VERSION must be a v-prefixed release tag"
    ;;
esac

PLATFORM="$(detect_platform)"
need curl
need sha256sum
need cosign

ASSET="cealctl-$PLATFORM"
BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

curl -fsSL "$BASE_URL/$ASSET" -o "$TMP_DIR/$ASSET"
curl -fsSL "$BASE_URL/$ASSET.sig" -o "$TMP_DIR/$ASSET.sig"
curl -fsSL "$BASE_URL/$ASSET.pem" -o "$TMP_DIR/$ASSET.pem"
curl -fsSL "$BASE_URL/SHA256SUMS" -o "$TMP_DIR/SHA256SUMS"

grep -E "^[a-f0-9]{64}  $ASSET$" "$TMP_DIR/SHA256SUMS" >/dev/null || fail "SHA256SUMS is missing $ASSET"
(cd "$TMP_DIR" && sha256sum -c SHA256SUMS --ignore-missing)

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

printf 'Installed cealctl at %s\n' "$TARGET"
