#!/usr/bin/env sh
set -eu

REPO="corca-ai/ceal-cli"
VERSION="${CEAL_VERSION:-}"
INSTALL_DIR="${CEAL_INSTALL_DIR:-$HOME/.local/bin}"
WORKFLOW_FILE="cealctl-release.yml"
ISSUER="https://token.actions.githubusercontent.com"
TMP_DIR=""
LOCK_PATH=""
LOCK_HELD=0
COMMITTED=0
GENERATION_CREATED=0
CURRENT_SWITCHED=0
TARGETS_MUTATED=0
PREVIOUS_CURRENT=""
STAGED_GENERATION=""
CEAL_TARGET_STATE=absent
CEALCTL_TARGET_STATE=absent

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
    Linux:aarch64|Linux:arm64) printf '%s\n' linux-arm64 ;;
    Linux:x86_64|Linux:amd64) printf '%s\n' linux-amd64 ;;
    *) fail "Unsupported Ceal CLI platform: $os $arch (supported: linux-arm64, linux-amd64)" ;;
  esac
}

sha256_of() {
  sha256sum "$1" | cut -d' ' -f1
}

verify_signature() {
  asset="$1"
  identity="https://github.com/$REPO/.github/workflows/$WORKFLOW_FILE@refs/tags/$VERSION"
  cosign verify-blob \
    --certificate "$TMP_DIR/$asset.pem" \
    --signature "$TMP_DIR/$asset.sig" \
    --certificate-identity "$identity" \
    --certificate-oidc-issuer "$ISSUER" \
    --certificate-github-workflow-repository "$REPO" \
    --certificate-github-workflow-ref "refs/tags/$VERSION" \
    "$TMP_DIR/$asset" >/dev/null
}

verify_checksum() {
  asset="$1"
  matches="$(grep -Ec "^[a-f0-9]{64}  $asset$" "$TMP_DIR/SHA256SUMS" || true)"
  [ "$matches" = 1 ] || fail "SHA256SUMS must contain exactly one entry for $asset"
  expected="$(grep -E "^[a-f0-9]{64}  $asset$" "$TMP_DIR/SHA256SUMS" | cut -d' ' -f1)"
  actual="$(sha256_of "$TMP_DIR/$asset")"
  [ "$expected" = "$actual" ] || fail "Checksum mismatch for $asset"
}

verify_checksum_inventory() {
	[ "$(wc -l < "$TMP_DIR/SHA256SUMS" | tr -d ' ')" = 8 ] \
		|| fail "SHA256SUMS must contain exactly eight physical lines"
	invalid_lines="$(grep -Evc '^[a-f0-9]{64}  (THIRD_PARTY_NOTICES[.]txt|ceal-cli-platform-release-manifest-linux-(amd64|arm64)[.]json|ceal-linux-(amd64|arm64)|cealctl-linux-(amd64|arm64)|install[.]sh)$' "$TMP_DIR/SHA256SUMS" || true)"
	[ "$invalid_lines" = 0 ] \
		|| fail "SHA256SUMS contains a malformed or unexpected entry"
	observed="$(sed -n 's/^[a-f0-9]\{64\}  //p' "$TMP_DIR/SHA256SUMS" | sort)"
	expected="$(printf '%s\n' \
		THIRD_PARTY_NOTICES.txt \
		ceal-cli-platform-release-manifest-linux-amd64.json \
		ceal-cli-platform-release-manifest-linux-arm64.json \
		ceal-linux-amd64 ceal-linux-arm64 \
		cealctl-linux-amd64 cealctl-linux-arm64 install.sh | sort)"
	[ "$observed" = "$expected" ] \
		|| fail "SHA256SUMS must contain exactly the eight dual-platform release entries"
  verify_checksum "$CEAL_ASSET"
  verify_checksum "$CEALCTL_ASSET"
  verify_checksum "$MANIFEST_ASSET"
  verify_checksum "$NOTICE_ASSET"
}

verify_version_output() {
  binary="$1"
  command="$2"
  schema="$3"
  credential_context="$4"
  stdout_path="$TMP_DIR/$command-version.yaml"
  stderr_path="$TMP_DIR/$command-version.stderr"
  expected_path="$TMP_DIR/$command-version.expected.yaml"
  "$binary" version >"$stdout_path" 2>"$stderr_path" \
    || fail "$command version probe failed"
  [ ! -s "$stderr_path" ] || fail "$command version probe wrote unexpected stderr"
  printf '%s\n' \
    "schema_version: $schema" \
    "command: $command" \
    "version: ${VERSION#v}" \
    "protocol_version: 1.2.0" \
    "supported_gateway_protocol_range:" \
	"  minimum: 1.2.0" \
	"  maximum: 1.2.0" \
    "credential_context: $credential_context" >"$expected_path"
  cmp -s "$stdout_path" "$expected_path" \
    || fail "$command reported an invalid version YAML document for $VERSION"
}

download_signed_asset() {
  asset="$1"
  curl -fsSL "$BASE_URL/$asset" -o "$TMP_DIR/$asset"
  curl -fsSL "$BASE_URL/$asset.sig" -o "$TMP_DIR/$asset.sig"
  curl -fsSL "$BASE_URL/$asset.pem" -o "$TMP_DIR/$asset.pem"
}

capture_target() {
  target="$1"
  expected_link="$2"
  state_name="$3"
  backup_name="$4"
  if [ -L "$target" ]; then
    [ "$(readlink "$target")" = "$expected_link" ] || fail "Existing command symlink is not managed by Ceal CLI"
    eval "$state_name=managed_link"
  elif [ -f "$target" ]; then
    cp -p "$target" "$TMP_DIR/$backup_name"
    eval "$state_name=regular_file"
  elif [ -e "$target" ]; then
    fail "Existing command target must be a regular file or managed symlink"
  fi
}

restore_target() {
  target="$1"
  state="$2"
  expected_link="$3"
  backup_name="$4"
  rm -f "$target"
  case "$state" in
    managed_link) ln -s "$expected_link" "$target" ;;
    regular_file) cp -p "$TMP_DIR/$backup_name" "$target" ;;
    absent) ;;
  esac
}

acquire_install_lock() {
  if [ -e "$LOCK_PATH" ] || [ -L "$LOCK_PATH" ]; then
    if [ -L "$LOCK_PATH" ] || [ ! -f "$LOCK_PATH" ]; then
      fail "Ceal CLI install lock is unsafe; remove it only after confirming no installation is active"
    fi
  else
    (umask 077; : > "$LOCK_PATH") || fail "Could not create Ceal CLI install lock"
  fi
  exec 9<>"$LOCK_PATH" || fail "Could not open Ceal CLI install lock"
  if ! flock -n 9; then
    exec 9>&-
    fail "Another Ceal CLI installation is active"
  fi
  LOCK_HELD=1
}

release_install_lock() {
  [ "$LOCK_HELD" = 1 ] || return
  flock -u 9 2>/dev/null || true
  exec 9>&-
  LOCK_HELD=0
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$COMMITTED" != 1 ]; then
    if [ "$CURRENT_SWITCHED" = 1 ]; then
      if [ -n "$PREVIOUS_CURRENT" ]; then
        ln -s "$PREVIOUS_CURRENT" "$CURRENT_LINK.rollback.$$"
        mv -Tf "$CURRENT_LINK.rollback.$$" "$CURRENT_LINK"
      else
        rm -f "$CURRENT_LINK"
      fi
    fi
    if [ "$TARGETS_MUTATED" = 1 ]; then
      restore_target "$CEAL_TARGET" "$CEAL_TARGET_STATE" "$CEAL_LINK_TARGET" previous-ceal
      restore_target "$CEALCTL_TARGET" "$CEALCTL_TARGET_STATE" "$CEALCTL_LINK_TARGET" previous-cealctl
    fi
    if [ "$GENERATION_CREATED" = 1 ]; then
      rm -rf "$GENERATION_DIR"
    fi
    if [ -n "$STAGED_GENERATION" ]; then rm -rf "$STAGED_GENERATION"; fi
  fi
  if [ -n "${CURRENT_LINK:-}" ]; then rm -f "$CURRENT_LINK.next.$$" 2>/dev/null || true; fi
  release_install_lock
  if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi
  exit "$status"
}

[ -n "$VERSION" ] \
  || fail "CEAL_VERSION is required until a compatible dual-binary release is approved; set an explicit tag such as v0.64.0."
printf '%s\n' "$VERSION" | grep -Eq '^v(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$' \
  || fail "CEAL_VERSION must be an explicit tag such as v0.64.0."

PLATFORM="$(detect_platform)"
for tool in cmp curl cosign flock sha256sum uname mktemp readlink; do need "$tool"; done

BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
TMP_DIR="$(mktemp -d)"
trap cleanup EXIT HUP INT TERM

if [ ! -e "$INSTALL_DIR" ]; then
  (umask 077; mkdir -p "$INSTALL_DIR")
else
  if [ -L "$INSTALL_DIR" ] || [ ! -d "$INSTALL_DIR" ]; then fail "Install directory must be a regular directory"; fi
fi

STATE_DIR="$INSTALL_DIR/.ceal-cli"
if [ -e "$STATE_DIR" ]; then
  if [ -L "$STATE_DIR" ] || [ ! -d "$STATE_DIR" ]; then fail "Ceal CLI state directory must be a regular directory"; fi
else
  (umask 077; mkdir "$STATE_DIR")
fi
if [ -e "$STATE_DIR/releases" ]; then
  if [ -L "$STATE_DIR/releases" ] || [ ! -d "$STATE_DIR/releases" ]; then fail "Ceal CLI releases directory must be a regular directory"; fi
else
  (umask 077; mkdir "$STATE_DIR/releases")
fi
LOCK_PATH="$STATE_DIR/install.lock"
acquire_install_lock

CEAL_ASSET="ceal-$PLATFORM"
CEALCTL_ASSET="cealctl-$PLATFORM"
MANIFEST_ASSET="ceal-cli-platform-release-manifest-$PLATFORM.json"
NOTICE_ASSET="THIRD_PARTY_NOTICES.txt"

for asset in "$CEAL_ASSET" "$CEALCTL_ASSET" "$MANIFEST_ASSET" "$NOTICE_ASSET" "SHA256SUMS"; do
  download_signed_asset "$asset"
  verify_signature "$asset"
done
verify_checksum_inventory

chmod 755 "$TMP_DIR/$CEAL_ASSET" "$TMP_DIR/$CEALCTL_ASSET"
verify_version_output "$TMP_DIR/$CEAL_ASSET" ceal ceal.version.v1 gateway_issued_client_session
verify_version_output "$TMP_DIR/$CEALCTL_ASSET" cealctl cealctl.version.v1 cealctl_operator_admin_profile
"$TMP_DIR/$CEAL_ASSET" --help >/dev/null
"$TMP_DIR/$CEALCTL_ASSET" --help >/dev/null

CEAL_TARGET="$INSTALL_DIR/ceal"
CEALCTL_TARGET="$INSTALL_DIR/cealctl"
CEAL_LINK_TARGET=".ceal-cli/current/$CEAL_ASSET"
CEALCTL_LINK_TARGET=".ceal-cli/current/$CEALCTL_ASSET"
CURRENT_LINK="$STATE_DIR/current"
capture_target "$CEAL_TARGET" "$CEAL_LINK_TARGET" CEAL_TARGET_STATE previous-ceal
capture_target "$CEALCTL_TARGET" "$CEALCTL_LINK_TARGET" CEALCTL_TARGET_STATE previous-cealctl

if [ -L "$CURRENT_LINK" ]; then
  PREVIOUS_CURRENT="$(readlink "$CURRENT_LINK")"
elif [ -e "$CURRENT_LINK" ]; then
  fail "Ceal CLI current pointer must be a symlink"
fi

RELEASE_SET_SHA="$(sha256_of "$TMP_DIR/SHA256SUMS")"
GENERATION_ID="${VERSION#v}-$PLATFORM-$RELEASE_SET_SHA"
GENERATION_DIR="$STATE_DIR/releases/$GENERATION_ID"
if [ ! -e "$GENERATION_DIR" ]; then
  STAGED_GENERATION="$STATE_DIR/releases/.next-$GENERATION_ID-$$"
  mkdir "$STAGED_GENERATION"
  cp "$TMP_DIR/$CEAL_ASSET" "$STAGED_GENERATION/$CEAL_ASSET"
  cp "$TMP_DIR/$CEALCTL_ASSET" "$STAGED_GENERATION/$CEALCTL_ASSET"
  cp "$TMP_DIR/$MANIFEST_ASSET" "$STAGED_GENERATION/$MANIFEST_ASSET"
  cp "$TMP_DIR/$NOTICE_ASSET" "$STAGED_GENERATION/$NOTICE_ASSET"
  cp "$TMP_DIR/SHA256SUMS" "$STAGED_GENERATION/SHA256SUMS"
  chmod 755 "$STAGED_GENERATION/$CEAL_ASSET" "$STAGED_GENERATION/$CEALCTL_ASSET"
  GENERATION_CREATED=1
  mv "$STAGED_GENERATION" "$GENERATION_DIR"
else
  if [ ! -d "$GENERATION_DIR" ] || [ -L "$GENERATION_DIR" ]; then fail "Existing release generation is unsafe"; fi
  for asset in "$CEAL_ASSET" "$CEALCTL_ASSET" "$MANIFEST_ASSET" "$NOTICE_ASSET" SHA256SUMS; do
    [ "$(sha256_of "$GENERATION_DIR/$asset")" = "$(sha256_of "$TMP_DIR/$asset")" ] \
      || fail "Existing release generation does not match the signed release"
  done
fi

ln -s "releases/$GENERATION_ID" "$CURRENT_LINK.next.$$"
CURRENT_SWITCHED=1
mv -Tf "$CURRENT_LINK.next.$$" "$CURRENT_LINK"

if [ "$CEAL_TARGET_STATE" != managed_link ] || [ "$CEALCTL_TARGET_STATE" != managed_link ]; then
  TARGETS_MUTATED=1
  if [ "$CEAL_TARGET_STATE" != managed_link ]; then
    rm -f "$CEAL_TARGET"
    ln -s "$CEAL_LINK_TARGET" "$CEAL_TARGET"
  fi
  if [ "$CEALCTL_TARGET_STATE" != managed_link ]; then
    rm -f "$CEALCTL_TARGET"
    ln -s "$CEALCTL_LINK_TARGET" "$CEALCTL_TARGET"
  fi
fi

verify_version_output "$CEAL_TARGET" ceal ceal.version.v1 gateway_issued_client_session
verify_version_output "$CEALCTL_TARGET" cealctl cealctl.version.v1 cealctl_operator_admin_profile
COMMITTED=1
printf 'Installed ceal and cealctl %s (%s) at %s\n' "$VERSION" "$PLATFORM" "$INSTALL_DIR"
