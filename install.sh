#!/usr/bin/env sh
set -eu

REPO="corca-ai/ceal-cli"
VERSION="${CEAL_VERSION:-}"
ROLE="${CEAL_INSTALL_ROLE:-worker}"
INSTALL_DIR="${CEAL_INSTALL_DIR:-$HOME/.local/bin}"
WORKFLOW_FILE="cealctl-release.yml"
ISSUER="https://token.actions.githubusercontent.com"
TMP_DIR=""
LOCK_PATH=""
LOCK_HELD=0
COMMITTED=0
GENERATION_CREATED=0
CURRENT_SWITCHED=0
TARGET_MUTATED=0
PREVIOUS_CURRENT=""
STAGED_GENERATION=""
CURRENT_LINK=""
GENERATION_DIR=""
TARGET_STATE=absent
TARGET_PREVIOUS_LINK=""
TARGET_NEEDS_LINK_UPDATE=0

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

select_role() {
  case "$ROLE" in
    worker)
      COMMAND="ceal"
      COMMAND_SCHEMA="ceal.version.v1"
      COMMAND_CREDENTIAL_CONTEXT="gateway_issued_client_session"
      GUIDE_ID="ceal-guide"
      GUIDE_ASSET="ceal-guide-SKILL.md"
      GUIDE_BINARY="ceal"
      ;;
    operator)
      COMMAND="cealctl"
      COMMAND_SCHEMA="cealctl.version.v1"
      COMMAND_CREDENTIAL_CONTEXT="cealctl_operator_admin_session"
      GUIDE_ID="cealctl-guide"
      GUIDE_ASSET="cealctl-guide-SKILL.md"
      GUIDE_BINARY="cealctl"
      ;;
    *) fail "CEAL_INSTALL_ROLE must be worker (default) or operator" ;;
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
  [ "$(wc -l < "$TMP_DIR/SHA256SUMS" | tr -d ' ')" = 10 ] \
	|| fail "SHA256SUMS must contain exactly ten physical lines"
  invalid_lines="$(grep -Evc '^[a-f0-9]{64}  (THIRD_PARTY_NOTICES[.]txt|ceal-cli-platform-release-manifest-linux-(amd64|arm64)[.]json|ceal-guide-SKILL[.]md|cealctl-guide-SKILL[.]md|ceal-linux-(amd64|arm64)|cealctl-linux-(amd64|arm64)|install[.]sh)$' "$TMP_DIR/SHA256SUMS" || true)"
  [ "$invalid_lines" = 0 ] \
    || fail "SHA256SUMS contains a malformed or unexpected entry"
  observed="$(sed -n 's/^[a-f0-9]\{64\}  //p' "$TMP_DIR/SHA256SUMS" | sort)"
  expected="$(printf '%s\n' \
    THIRD_PARTY_NOTICES.txt \
    ceal-cli-platform-release-manifest-linux-amd64.json \
    ceal-cli-platform-release-manifest-linux-arm64.json \
    ceal-guide-SKILL.md cealctl-guide-SKILL.md \
    ceal-linux-amd64 ceal-linux-arm64 \
    cealctl-linux-amd64 cealctl-linux-arm64 install.sh | sort)"
  [ "$observed" = "$expected" ] \
	|| fail "SHA256SUMS must contain exactly the ten dual-platform release entries"
  verify_checksum "$COMMAND_ASSET"
  verify_checksum "$MANIFEST_ASSET"
  verify_checksum "$NOTICE_ASSET"
  verify_checksum "$GUIDE_ASSET"
}

verify_manifest_guide() {
  expected="$(grep -E "^[a-f0-9]{64}  $GUIDE_ASSET$" "$TMP_DIR/SHA256SUMS" | cut -d' ' -f1)"
  awk \
    -v guide_id="$GUIDE_ID" \
    -v guide_name="$GUIDE_ASSET" \
    -v guide_binary="$GUIDE_BINARY" \
    -v guide_sha256="$expected" '
      $0 == "    \"" guide_id "\": {" { inside = 1; found = 1; next }
      inside && $0 ~ /^    }[,]?$/ {
        valid = name && binary && sha256
        exit
      }
      inside && index($0, "\"name\": \"" guide_name "\"") { name = 1 }
      inside && index($0, "\"binary\": \"" guide_binary "\"") { binary = 1 }
      inside && index($0, "\"sha256\": \"" guide_sha256 "\"") { sha256 = 1 }
      END { exit (found && valid) ? 0 : 1 }
    ' "$TMP_DIR/$MANIFEST_ASSET" \
    || fail "Selected guide does not match the signed platform manifest"
}

require_regular_directory() {
  [ -d "$1" ] && [ ! -L "$1" ] || fail "Existing release generation is unsafe"
}

require_regular_file() {
  [ -f "$1" ] && [ ! -L "$1" ] || fail "Existing release generation is unsafe"
}

verify_version_output() {
  binary="$1"
  stdout_path="$TMP_DIR/$COMMAND-version.yaml"
  stderr_path="$TMP_DIR/$COMMAND-version.stderr"
  expected_path="$TMP_DIR/$COMMAND-version.expected.yaml"
  "$binary" version >"$stdout_path" 2>"$stderr_path" \
    || fail "$COMMAND version probe failed"
  [ ! -s "$stderr_path" ] || fail "$COMMAND version probe wrote unexpected stderr"
  printf '%s\n' \
    "schema_version: $COMMAND_SCHEMA" \
    "command: $COMMAND" \
    "version: ${VERSION#v}" \
    "protocol_version: 1.3.0" \
    "supported_gateway_protocol_range:" \
    "  minimum: 1.3.0" \
    "  maximum: 1.3.0" \
    "credential_context: $COMMAND_CREDENTIAL_CONTEXT" >"$expected_path"
  cmp -s "$stdout_path" "$expected_path" \
    || fail "$COMMAND reported an invalid version YAML document for $VERSION"
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
  legacy_link="$3"
  backup_name="$4"
  if [ -L "$target" ]; then
    TARGET_PREVIOUS_LINK="$(readlink "$target")"
    case "$TARGET_PREVIOUS_LINK" in
      "$expected_link") TARGET_STATE=managed_link ;;
      "$legacy_link") TARGET_STATE=managed_link; TARGET_NEEDS_LINK_UPDATE=1 ;;
      *) fail "Existing command symlink is not managed by the selected Ceal CLI role" ;;
    esac
  elif [ -f "$target" ]; then
    cp -p "$target" "$TMP_DIR/$backup_name"
    TARGET_STATE=regular_file
    TARGET_NEEDS_LINK_UPDATE=1
  elif [ -e "$target" ]; then
    fail "Existing command target must be a regular file or managed symlink"
  else
    TARGET_NEEDS_LINK_UPDATE=1
  fi
}

restore_target() {
  rm -f "$COMMAND_TARGET"
  case "$TARGET_STATE" in
    managed_link) ln -s "$TARGET_PREVIOUS_LINK" "$COMMAND_TARGET" ;;
    regular_file) cp -p "$TMP_DIR/previous-command" "$COMMAND_TARGET" ;;
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
    if [ "$TARGET_MUTATED" = 1 ]; then
      restore_target
    fi
    if [ "$GENERATION_CREATED" = 1 ]; then
      rm -rf "$GENERATION_DIR"
    fi
    if [ -n "$STAGED_GENERATION" ]; then rm -rf "$STAGED_GENERATION"; fi
  fi
  if [ -n "$CURRENT_LINK" ]; then rm -f "$CURRENT_LINK.next.$$" 2>/dev/null || true; fi
  release_install_lock
  if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi
  exit "$status"
}

[ -n "$VERSION" ] \
  || fail "CEAL_VERSION is required until a compatible signed release is approved; set an explicit tag such as v0.65.0."
printf '%s\n' "$VERSION" | grep -Eq '^v(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$' \
  || fail "CEAL_VERSION must be an explicit tag such as v0.65.0."
select_role

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

STATE_ROOT="$INSTALL_DIR/.ceal-cli"
if [ -e "$STATE_ROOT" ]; then
  if [ -L "$STATE_ROOT" ] || [ ! -d "$STATE_ROOT" ]; then fail "Ceal CLI state directory must be a regular directory"; fi
else
  (umask 077; mkdir "$STATE_ROOT")
fi
STATE_DIR="$STATE_ROOT/$ROLE"
if [ -e "$STATE_DIR" ]; then
  if [ -L "$STATE_DIR" ] || [ ! -d "$STATE_DIR" ]; then fail "Selected Ceal CLI role state directory must be a regular directory"; fi
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

COMMAND_ASSET="$COMMAND-$PLATFORM"
MANIFEST_ASSET="ceal-cli-platform-release-manifest-$PLATFORM.json"
NOTICE_ASSET="THIRD_PARTY_NOTICES.txt"

for asset in "$COMMAND_ASSET" "$MANIFEST_ASSET" "$NOTICE_ASSET" "$GUIDE_ASSET" "SHA256SUMS"; do
  download_signed_asset "$asset"
  verify_signature "$asset"
done
verify_checksum_inventory
verify_manifest_guide

chmod 755 "$TMP_DIR/$COMMAND_ASSET"
verify_version_output "$TMP_DIR/$COMMAND_ASSET"
"$TMP_DIR/$COMMAND_ASSET" --help >/dev/null

COMMAND_TARGET="$INSTALL_DIR/$COMMAND"
COMMAND_LINK_TARGET=".ceal-cli/$ROLE/current/$COMMAND_ASSET"
LEGACY_COMMAND_LINK_TARGET=".ceal-cli/current/$COMMAND_ASSET"
CURRENT_LINK="$STATE_DIR/current"
capture_target "$COMMAND_TARGET" "$COMMAND_LINK_TARGET" "$LEGACY_COMMAND_LINK_TARGET" previous-command

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
  cp "$TMP_DIR/$COMMAND_ASSET" "$STAGED_GENERATION/$COMMAND_ASSET"
  cp "$TMP_DIR/$MANIFEST_ASSET" "$STAGED_GENERATION/$MANIFEST_ASSET"
  cp "$TMP_DIR/$NOTICE_ASSET" "$STAGED_GENERATION/$NOTICE_ASSET"
  mkdir "$STAGED_GENERATION/guide"
  cp "$TMP_DIR/$GUIDE_ASSET" "$STAGED_GENERATION/guide/SKILL.md"
  cp "$TMP_DIR/SHA256SUMS" "$STAGED_GENERATION/SHA256SUMS"
  chmod 755 "$STAGED_GENERATION/$COMMAND_ASSET"
  GENERATION_CREATED=1
  mv "$STAGED_GENERATION" "$GENERATION_DIR"
else
  require_regular_directory "$GENERATION_DIR"
  require_regular_directory "$GENERATION_DIR/guide"
  for asset in "$COMMAND_ASSET" "$MANIFEST_ASSET" "$NOTICE_ASSET" SHA256SUMS; do
    require_regular_file "$GENERATION_DIR/$asset"
    [ "$(sha256_of "$GENERATION_DIR/$asset")" = "$(sha256_of "$TMP_DIR/$asset")" ] \
      || fail "Existing release generation does not match the signed release"
  done
  require_regular_file "$GENERATION_DIR/guide/SKILL.md"
  [ "$(sha256_of "$GENERATION_DIR/guide/SKILL.md")" = "$(sha256_of "$TMP_DIR/$GUIDE_ASSET")" ] \
    || fail "Existing release generation does not match the signed guide"
fi

ln -s "releases/$GENERATION_ID" "$CURRENT_LINK.next.$$"
mv -Tf "$CURRENT_LINK.next.$$" "$CURRENT_LINK"
CURRENT_SWITCHED=1

if [ "$TARGET_NEEDS_LINK_UPDATE" = 1 ]; then
  TARGET_MUTATED=1
  rm -f "$COMMAND_TARGET"
  ln -s "$COMMAND_LINK_TARGET" "$COMMAND_TARGET"
fi

verify_version_output "$COMMAND_TARGET"
COMMITTED=1
printf 'Installed %s %s (%s) as %s at %s\n' "$COMMAND" "$VERSION" "$PLATFORM" "$ROLE" "$INSTALL_DIR"
printf 'Signed guide staged at %s; register it through the selected agent runtime (it is not auto-loaded).\n' "$GENERATION_DIR/guide/SKILL.md"
