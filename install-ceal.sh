#!/usr/bin/env sh
set -eu

# Worker-only installer.  This deliberately has no operator role or cealctl
# compatibility path: it can change only the ceal link and .ceal-cli/worker.
REPO="corca-ai/ceal-cli"
VERSION="${CEAL_VERSION:-}"
INSTALL_DIR="${CEAL_INSTALL_DIR:-$HOME/.local/bin}"
WORKFLOW_FILE="ceal-release.yml"
ISSUER="https://token.actions.githubusercontent.com"
COSIGN_VERSION="v2.6.4"
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

fail() { printf '%s\n' "$1" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required"; }
sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

detect_platform() {
  os="$(uname -s)"; arch="$(uname -m)"
  case "$os:$arch" in
    Linux:aarch64|Linux:arm64) printf '%s\n' linux-arm64 ;;
    Linux:x86_64|Linux:amd64) printf '%s\n' linux-amd64 ;;
    *) fail "Unsupported Ceal worker platform: $os $arch (supported: linux-arm64, linux-amd64)" ;;
  esac
}

bootstrap_cosign() {
  command -v cosign >/dev/null 2>&1 && return 0
  for tool in curl sha256sum chmod; do command -v "$tool" >/dev/null 2>&1 || fail "cosign is required; install it from https://docs.sigstore.dev/cosign/system_config/installation/"; done
  case "$PLATFORM" in
    linux-amd64) cosign_sha256=309779b0c4e409186b0a80daba99041fe2cf65a920ce645013901df6211895a9 ;;
    linux-arm64) cosign_sha256=df408e5418129306fed7349ec46e27be0445d05c5127c07f435e9a566af67593 ;;
    *) fail "cosign auto-install is not supported on $PLATFORM" ;;
  esac
  cosign_dir="$TMP_DIR/cosign-bootstrap"
  mkdir "$cosign_dir" || fail "Could not create the ephemeral cosign bootstrap directory"
  cosign_url="https://github.com/sigstore/cosign/releases/download/$COSIGN_VERSION/cosign-$PLATFORM"
  curl -fsSL "$cosign_url" -o "$cosign_dir/cosign" || fail "Could not download pinned cosign $COSIGN_VERSION"
  [ "$(sha256_of "$cosign_dir/cosign")" = "$cosign_sha256" ] || fail "Pinned cosign $COSIGN_VERSION checksum mismatch; refusing to use it"
  chmod 755 "$cosign_dir/cosign"
  PATH="$cosign_dir:$PATH"; export PATH
}

is_tag() { printf '%s\n' "$1" | grep -Eq '^ceal-v(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$'; }

# GitHub has one global `latest` release.  Legacy bare-v releases retain that
# lane, so worker stable selection reads the release list and accepts only the
# first current, non-draft ceal-v semantic tag.  The selected tag is still
# verified by its exact OIDC identity below.
resolve_stable_tag() {
  curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=100" -o "$TMP_DIR/releases.json" \
    || fail "Could not resolve the worker stable release list"
  candidate="$(python3 - "$TMP_DIR/releases.json" <<'PY'
import json
import re
import sys

try:
    releases = json.load(open(sys.argv[1], encoding="utf-8"))
except (OSError, ValueError):
    sys.exit(1)
if not isinstance(releases, list):
    sys.exit(1)
tag_pattern = re.compile(r"^ceal-v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$")
for release in releases:
    if not isinstance(release, dict):
        continue
    tag = release.get("tag_name")
    if release.get("draft") is False and release.get("prerelease") is False and isinstance(tag, str) and tag_pattern.fullmatch(tag):
        print(tag)
        sys.exit(0)
sys.exit(1)
PY
)" || fail "Worker release list did not resolve to a canonical stable ceal-v tag"
  is_tag "$candidate" || fail "Worker release list did not resolve to a canonical stable ceal-v tag"
  printf '%s\n' "$candidate"
}

version_is_older() {
  candidate="${1#ceal-v}"; baseline="$2"
  previous_ifs="$IFS"; IFS=.; set -- $candidate; candidate_major="$1"; candidate_minor="$2"; candidate_patch="$3"
  set -- $baseline; baseline_major="$1"; baseline_minor="$2"; baseline_patch="$3"; IFS="$previous_ifs"
  [ "$candidate_major" -lt "$baseline_major" ] && return 0
  [ "$candidate_major" -gt "$baseline_major" ] && return 1
  [ "$candidate_minor" -lt "$baseline_minor" ] && return 0
  [ "$candidate_minor" -gt "$baseline_minor" ] && return 1
  [ "$candidate_patch" -lt "$baseline_patch" ]
}

verify_signature() {
  asset="$1"; identity="https://github.com/$REPO/.github/workflows/$WORKFLOW_FILE@refs/tags/$VERSION"
  cosign verify-blob --certificate "$TMP_DIR/$asset.pem" --signature "$TMP_DIR/$asset.sig" \
    --certificate-identity "$identity" --certificate-oidc-issuer "$ISSUER" \
    --certificate-github-workflow-repository "$REPO" \
    --certificate-github-workflow-ref "refs/tags/$VERSION" "$TMP_DIR/$asset" >/dev/null
}

verify_checksum() {
  asset="$1"; matches="$(grep -Ec "^[a-f0-9]{64}  $asset$" "$TMP_DIR/SHA256SUMS" || true)"
  [ "$matches" = 1 ] || fail "SHA256SUMS must contain exactly one entry for $asset"
  expected="$(grep -E "^[a-f0-9]{64}  $asset$" "$TMP_DIR/SHA256SUMS" | cut -d' ' -f1)"
  [ "$expected" = "$(sha256_of "$TMP_DIR/$asset")" ] || fail "Checksum mismatch for $asset"
}

verify_checksum_inventory() {
  [ "$(wc -l < "$TMP_DIR/SHA256SUMS" | tr -d ' ')" = 7 ] || fail "SHA256SUMS must contain exactly seven worker release entries"
  invalid="$(grep -Evc '^[a-f0-9]{64}  (THIRD_PARTY_NOTICES[.]txt|ceal-worker-release-manifest-linux-(amd64|arm64)[.]json|ceal-guide-SKILL[.]md|ceal-linux-(amd64|arm64)|install-ceal[.]sh)$' "$TMP_DIR/SHA256SUMS" || true)"
  [ "$invalid" = 0 ] || fail "SHA256SUMS contains a malformed or unexpected worker entry"
  observed="$(sed -n 's/^[a-f0-9]\{64\}  //p' "$TMP_DIR/SHA256SUMS" | sort)"
  expected="$(printf '%s\n' THIRD_PARTY_NOTICES.txt ceal-guide-SKILL.md ceal-linux-amd64 ceal-linux-arm64 ceal-worker-release-manifest-linux-amd64.json ceal-worker-release-manifest-linux-arm64.json install-ceal.sh | sort)"
  [ "$observed" = "$expected" ] || fail "SHA256SUMS must contain exactly the worker-only release entries"
  for asset in "$COMMAND_ASSET" "$MANIFEST_ASSET" THIRD_PARTY_NOTICES.txt ceal-guide-SKILL.md install-ceal.sh; do verify_checksum "$asset"; done
}

verify_manifest_guide() {
  guide_sha="$(grep -E '^[a-f0-9]{64}  ceal-guide-SKILL[.]md$' "$TMP_DIR/SHA256SUMS" | cut -d' ' -f1)"
  python3 - "$TMP_DIR/$MANIFEST_ASSET" "${VERSION#ceal-v}" "$PLATFORM" "$guide_sha" <<'PY' \
    || fail "Selected guide does not match the signed worker platform manifest"
import json
import sys

try:
    value = json.load(open(sys.argv[1], encoding="utf-8"))
except (OSError, ValueError):
    sys.exit(1)
guide = value.get("guide") if isinstance(value, dict) else None
valid = (
    value.get("schema_version") == "ceal.worker_release_manifest.v1"
    and value.get("version") == sys.argv[2]
    and value.get("platform") == sys.argv[3]
    and value.get("command") == "ceal"
    and isinstance(guide, dict)
    and guide.get("name") == "ceal-guide-SKILL.md"
    and guide.get("sha256") == sys.argv[4]
)
sys.exit(0 if valid else 1)
PY
}

verify_version_output() {
  binary="$1"; stdout_path="$TMP_DIR/ceal-version.yaml"; stderr_path="$TMP_DIR/ceal-version.stderr"; expected_path="$TMP_DIR/ceal-version.expected.yaml"
  "$binary" version >"$stdout_path" 2>"$stderr_path" || fail "ceal version probe failed"
  [ ! -s "$stderr_path" ] || fail "ceal version probe wrote unexpected stderr"
  printf '%s\n' "schema_version: ceal.version.v1" "command: ceal" "version: ${VERSION#ceal-v}" "protocol_version: 1.3.0" "supported_gateway_protocol_range:" "  minimum: 1.3.0" "  maximum: 1.3.0" "credential_context: gateway_issued_client_session" > "$expected_path"
  cmp -s "$stdout_path" "$expected_path" || fail "ceal reported an invalid version YAML document for $VERSION"
}

download_signed_asset() { asset="$1"; curl -fsSL "$BASE_URL/$asset" -o "$TMP_DIR/$asset"; curl -fsSL "$BASE_URL/$asset.sig" -o "$TMP_DIR/$asset.sig"; curl -fsSL "$BASE_URL/$asset.pem" -o "$TMP_DIR/$asset.pem"; }
require_regular_directory() { [ -d "$1" ] && [ ! -L "$1" ] || fail "Existing worker release generation is unsafe"; }
require_regular_file() { [ -f "$1" ] && [ ! -L "$1" ] || fail "Existing worker release generation is unsafe"; }

capture_target() {
  if [ -L "$COMMAND_TARGET" ]; then
    TARGET_PREVIOUS_LINK="$(readlink "$COMMAND_TARGET")"
    case "$TARGET_PREVIOUS_LINK" in
      "$COMMAND_LINK_TARGET") TARGET_STATE=managed_link ;;
      "$LEGACY_COMMAND_LINK_TARGET") TARGET_STATE=managed_link; TARGET_NEEDS_LINK_UPDATE=1 ;;
      *) fail "Existing ceal symlink is not managed by the worker installer" ;;
    esac
  elif [ -f "$COMMAND_TARGET" ]; then cp -p "$COMMAND_TARGET" "$TMP_DIR/previous-command"; TARGET_STATE=regular_file; TARGET_NEEDS_LINK_UPDATE=1
  elif [ -e "$COMMAND_TARGET" ]; then fail "Existing ceal target must be a regular file or managed symlink"
  else TARGET_NEEDS_LINK_UPDATE=1
  fi
}

restore_target() { rm -f "$COMMAND_TARGET"; case "$TARGET_STATE" in managed_link) ln -s "$TARGET_PREVIOUS_LINK" "$COMMAND_TARGET" ;; regular_file) cp -p "$TMP_DIR/previous-command" "$COMMAND_TARGET" ;; esac; }

acquire_install_lock() {
  if [ -e "$LOCK_PATH" ] || [ -L "$LOCK_PATH" ]; then [ ! -L "$LOCK_PATH" ] && [ -f "$LOCK_PATH" ] || fail "Ceal worker install lock is unsafe; remove it only after confirming no installation is active"
  else (umask 077; : > "$LOCK_PATH") || fail "Could not create Ceal worker install lock"; fi
  exec 9<>"$LOCK_PATH" || fail "Could not open Ceal worker install lock"
  flock -n 9 || { exec 9>&-; fail "Another Ceal worker installation is active"; }
  LOCK_HELD=1
}
release_install_lock() { [ "$LOCK_HELD" = 1 ] || return; flock -u 9 2>/dev/null || true; exec 9>&-; LOCK_HELD=0; }

cleanup() {
  status=$?; trap - EXIT HUP INT TERM
  if [ "$COMMITTED" != 1 ]; then
    if [ "$CURRENT_SWITCHED" = 1 ]; then if [ -n "$PREVIOUS_CURRENT" ]; then ln -s "$PREVIOUS_CURRENT" "$CURRENT_LINK.rollback.$$"; mv -Tf "$CURRENT_LINK.rollback.$$" "$CURRENT_LINK"; else rm -f "$CURRENT_LINK"; fi; fi
    [ "$TARGET_MUTATED" = 1 ] && restore_target
    [ "$GENERATION_CREATED" = 1 ] && rm -rf "$GENERATION_DIR"
    [ -n "$STAGED_GENERATION" ] && rm -rf "$STAGED_GENERATION"
  fi
  [ -n "$CURRENT_LINK" ] && rm -f "$CURRENT_LINK.next.$$" 2>/dev/null || true
  release_install_lock
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR"
  exit "$status"
}

[ -n "$VERSION" ] || fail "CEAL_VERSION is required; set stable or an explicit tag such as ceal-v0.65.0."
[ "$VERSION" = stable ] || is_tag "$VERSION" || fail "CEAL_VERSION must be stable or an explicit tag such as ceal-v0.65.0."
PLATFORM="$(detect_platform)"
need mktemp; TMP_DIR="$(mktemp -d)"; trap cleanup EXIT HUP INT TERM
bootstrap_cosign
for tool in cmp curl cosign flock grep python3 sed sha256sum sort uname mktemp readlink; do need "$tool"; done
if [ "$VERSION" = stable ]; then VERSION="$(resolve_stable_tag)"; fi
if [ -n "${CEAL_MINIMUM_VERSION:-}" ]; then
  printf '%s\n' "$CEAL_MINIMUM_VERSION" | grep -Eq '^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$' || fail "CEAL_MINIMUM_VERSION must be a semantic version when stable update is requested"
  version_is_older "$VERSION" "$CEAL_MINIMUM_VERSION" && fail "Latest stable Ceal worker release is older than the installed worker release"
fi
BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
if [ ! -e "$INSTALL_DIR" ]; then (umask 077; mkdir -p "$INSTALL_DIR"); elif [ -L "$INSTALL_DIR" ] || [ ! -d "$INSTALL_DIR" ]; then fail "Install directory must be a regular directory"; fi
STATE_ROOT="$INSTALL_DIR/.ceal-cli"; [ ! -e "$STATE_ROOT" ] && (umask 077; mkdir "$STATE_ROOT")
[ -d "$STATE_ROOT" ] && [ ! -L "$STATE_ROOT" ] || fail "Ceal worker state directory must be a regular directory"
STATE_DIR="$STATE_ROOT/worker"; [ ! -e "$STATE_DIR" ] && (umask 077; mkdir "$STATE_DIR")
[ -d "$STATE_DIR" ] && [ ! -L "$STATE_DIR" ] || fail "Worker state directory must be a regular directory"
[ ! -e "$STATE_DIR/releases" ] && (umask 077; mkdir "$STATE_DIR/releases")
[ -d "$STATE_DIR/releases" ] && [ ! -L "$STATE_DIR/releases" ] || fail "Worker releases directory must be a regular directory"
LOCK_PATH="$STATE_DIR/install.lock"; acquire_install_lock
COMMAND_ASSET="ceal-$PLATFORM"; MANIFEST_ASSET="ceal-worker-release-manifest-$PLATFORM.json"
for asset in "$COMMAND_ASSET" "$MANIFEST_ASSET" THIRD_PARTY_NOTICES.txt ceal-guide-SKILL.md install-ceal.sh SHA256SUMS; do download_signed_asset "$asset"; verify_signature "$asset"; done
verify_checksum_inventory; verify_manifest_guide
chmod 755 "$TMP_DIR/$COMMAND_ASSET"; verify_version_output "$TMP_DIR/$COMMAND_ASSET"; "$TMP_DIR/$COMMAND_ASSET" --help >/dev/null
COMMAND_TARGET="$INSTALL_DIR/ceal"; COMMAND_LINK_TARGET=".ceal-cli/worker/current/$COMMAND_ASSET"; LEGACY_COMMAND_LINK_TARGET=".ceal-cli/current/$COMMAND_ASSET"; CURRENT_LINK="$STATE_DIR/current"; capture_target
if [ -L "$CURRENT_LINK" ]; then PREVIOUS_CURRENT="$(readlink "$CURRENT_LINK")"; elif [ -e "$CURRENT_LINK" ]; then fail "Worker current pointer must be a symlink"; fi
RELEASE_SET_SHA="$(sha256_of "$TMP_DIR/SHA256SUMS")"; GENERATION_ID="${VERSION#ceal-v}-$PLATFORM-$RELEASE_SET_SHA"; GENERATION_DIR="$STATE_DIR/releases/$GENERATION_ID"
if [ ! -e "$GENERATION_DIR" ]; then
  STAGED_GENERATION="$STATE_DIR/releases/.next-$GENERATION_ID-$$"; mkdir "$STAGED_GENERATION"
  for asset in "$COMMAND_ASSET" "$MANIFEST_ASSET" THIRD_PARTY_NOTICES.txt install-ceal.sh SHA256SUMS; do cp "$TMP_DIR/$asset" "$STAGED_GENERATION/$asset"; done
  mkdir "$STAGED_GENERATION/guide"; cp "$TMP_DIR/ceal-guide-SKILL.md" "$STAGED_GENERATION/guide/SKILL.md"; chmod 755 "$STAGED_GENERATION/$COMMAND_ASSET" "$STAGED_GENERATION/install-ceal.sh"
  GENERATION_CREATED=1; mv "$STAGED_GENERATION" "$GENERATION_DIR"
else
  require_regular_directory "$GENERATION_DIR"; require_regular_directory "$GENERATION_DIR/guide"
  for asset in "$COMMAND_ASSET" "$MANIFEST_ASSET" THIRD_PARTY_NOTICES.txt install-ceal.sh SHA256SUMS; do require_regular_file "$GENERATION_DIR/$asset"; [ "$(sha256_of "$GENERATION_DIR/$asset")" = "$(sha256_of "$TMP_DIR/$asset")" ] || fail "Existing worker release generation does not match the signed release"; done
  require_regular_file "$GENERATION_DIR/guide/SKILL.md"; [ "$(sha256_of "$GENERATION_DIR/guide/SKILL.md")" = "$(sha256_of "$TMP_DIR/ceal-guide-SKILL.md")" ] || fail "Existing worker release generation does not match the signed guide"
fi
ln -s "releases/$GENERATION_ID" "$CURRENT_LINK.next.$$"; mv -Tf "$CURRENT_LINK.next.$$" "$CURRENT_LINK"; CURRENT_SWITCHED=1
if [ "$TARGET_NEEDS_LINK_UPDATE" = 1 ]; then TARGET_MUTATED=1; rm -f "$COMMAND_TARGET"; ln -s "$COMMAND_LINK_TARGET" "$COMMAND_TARGET"; fi
verify_version_output "$COMMAND_TARGET"; COMMITTED=1
printf 'Installed ceal %s (%s) as worker at %s\n' "$VERSION" "$PLATFORM" "$INSTALL_DIR"
printf 'Signed guide staged at %s; register it through the selected agent runtime (it is not auto-loaded).\n' "$GENERATION_DIR/guide/SKILL.md"
