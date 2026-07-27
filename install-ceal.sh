#!/usr/bin/env sh
set -eu

# Worker-only installer.  This deliberately has no operator role or cealctl
# compatibility path: it can change only the ceal link and .ceal-cli/worker.
# The published-worker origin is separate from every Gateway control endpoint.
# GitHub remains the tag-bound OIDC signer identity, not an artifact origin.
RELEASE_ORIGIN="${CEAL_RELEASE_ORIGIN:-https://ceal.borca.ai/releases}"
WORKER_RELEASE_ORIGIN="$RELEASE_ORIGIN/worker"
VERSION="${CEAL_VERSION:-}"
STABLE_RELEASE_SET_SHA=""
INSTALL_DIR="${CEAL_INSTALL_DIR:-$HOME/.local/bin}"
WORKFLOW_FILE="ceal-release.yml"
ISSUER="https://token.actions.githubusercontent.com"
COSIGN_VERSION="v2.6.4"
TMP_DIR=""
LOCK_PATH=""
LOCK_DIR=""
LOCK_HELD=0
MV_HAS_T=0
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

# Every download is bounded, and the reason is not politeness about slow links.
# `curl` with no deadline waits indefinitely on an origin that completes the
# connection and then goes silent — a black hole, a hung proxy, a load balancer
# holding the socket open. `ceal update` runs this script and waits for it, so an
# unbounded fetch here made that command unbounded too: no envelope, no exit,
# nothing for an agent to read. Every other wait in this CLI is bounded.
#
# The bound is a *stall* bound, not a transfer cap, and that distinction is the
# whole design. The worker binary is a Node SEA — the runtime plus a blob, over a
# hundred megabytes — and a flat --max-time large enough for that on a slow link
# is also large enough to sit in a black hole, while one small enough to catch
# the black hole hard-fails an install that was working. --speed-limit with
# --speed-time separates them: a transfer moving at all keeps going however long
# it takes, and one that stops moving is cut off in seconds. --max-time stays as
# an absolute backstop set well past any legitimate transfer.
CURL_CONNECT_TIMEOUT=15
CURL_STALL_BYTES=1024
CURL_STALL_SECONDS=30
CURL_MAX_TIME_ASSET=3600
CURL_MAX_TIME_POINTER=120

# Route every download through here rather than calling `curl` directly, so one
# added later cannot quietly reintroduce an unbounded wait.
fetch() {
  [ "$#" -ge 2 ] || fail "fetch requires a max-time and a URL"
  fetch_max_time="$1"; shift
  curl -fsSL \
    --connect-timeout "$CURL_CONNECT_TIMEOUT" \
    --speed-limit "$CURL_STALL_BYTES" --speed-time "$CURL_STALL_SECONDS" \
    --max-time "$fetch_max_time" "$@"
}

# macOS ships shasum but not sha256sum; both print "<sha256>  <path>".
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
need_sha256() { command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || fail "sha256sum or shasum is required"; }

# BSD mv has no -T and moves a file into a symlinked directory target. The
# probe keys on the actual mv, so the non-atomic fallback runs only where GNU
# mv is absent, and only while the install lock is held.
probe_mv_t() {
  : > "$TMP_DIR/.mv-t-src"
  if mv -T "$TMP_DIR/.mv-t-src" "$TMP_DIR/.mv-t-dst" 2>/dev/null; then MV_HAS_T=1; else MV_HAS_T=0; rm -f "$TMP_DIR/.mv-t-src"; fi
}
replace_link() {
  link_temp="$2.next.$$"; rm -f "$link_temp"; ln -s "$1" "$link_temp"
  if [ "$MV_HAS_T" = 1 ]; then mv -Tf "$link_temp" "$2"
  else rm -f "$2"; mv -f "$link_temp" "$2"; fi
}

detect_platform() {
  os="$(uname -s)"; arch="$(uname -m)"
  case "$os:$arch" in
    Linux:aarch64|Linux:arm64) printf '%s\n' linux-arm64 ;;
    Linux:x86_64|Linux:amd64) printf '%s\n' linux-amd64 ;;
    Darwin:arm64) printf '%s\n' darwin-arm64 ;;
    Darwin:x86_64) printf '%s\n' darwin-amd64 ;;
    *) fail "Unsupported Ceal worker platform: $os $arch (supported: linux-arm64, linux-amd64, darwin-arm64, darwin-amd64)" ;;
  esac
}

bootstrap_cosign() {
  command -v cosign >/dev/null 2>&1 && return 0
  need_sha256
  for tool in curl chmod; do command -v "$tool" >/dev/null 2>&1 || fail "cosign is required; install it from https://docs.sigstore.dev/cosign/system_config/installation/"; done
  case "$PLATFORM" in
    linux-amd64) cosign_sha256=309779b0c4e409186b0a80daba99041fe2cf65a920ce645013901df6211895a9 ;;
    linux-arm64) cosign_sha256=df408e5418129306fed7349ec46e27be0445d05c5127c07f435e9a566af67593 ;;
    darwin-amd64) cosign_sha256=ec648fddfedf1dad59dff9fbab177284a618204e03126ea37a87ab3cec4e7cb1 ;;
    darwin-arm64) cosign_sha256=b2987c1b55a1e2735c59ac5c3e140acbf7ba5c1ed0cc07dbbf1b85676595237e ;;
    *) fail "cosign auto-install is not supported on $PLATFORM" ;;
  esac
  cosign_dir="$TMP_DIR/cosign-bootstrap"
  mkdir "$cosign_dir" || fail "Could not create the ephemeral cosign bootstrap directory"
  cosign_url="$RELEASE_ORIGIN/tooling/cosign/$COSIGN_VERSION/cosign-$PLATFORM"
  fetch "$CURL_MAX_TIME_ASSET" "$cosign_url" -o "$cosign_dir/cosign" || fail "Could not download pinned cosign $COSIGN_VERSION"
  [ "$(sha256_of "$cosign_dir/cosign")" = "$cosign_sha256" ] || fail "Pinned cosign $COSIGN_VERSION checksum mismatch; refusing to use it"
  chmod 755 "$cosign_dir/cosign"
  PATH="$cosign_dir:$PATH"; export PATH
}

is_tag() { printf '%s\n' "$1" | grep -Eq '^ceal-v(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$'; }

download_asset() {
  download_name="$1"
  fetch "$CURL_MAX_TIME_ASSET" "$BASE_URL/$download_name" -o "$TMP_DIR/$download_name" \
    || fail "Could not download signed worker asset $download_name"
}

# Stable selection is a worker-owned static-origin pointer. It pins both the
# immutable tag and its signed SHA256SUMS bytes; every asset is then checked
# against the exact tag-bound OIDC identity below.
resolve_stable_release() {
  fetch "$CURL_MAX_TIME_POINTER" "$WORKER_RELEASE_ORIGIN/stable/ceal-worker-stable-release.json" -o "$TMP_DIR/stable-release.json" \
    || fail "Could not resolve the worker stable release pointer"
  # Extracted by key rather than by position so a later added field does not
  # break an already installed generation. A key that appears more than once is
  # rejected rather than resolved to whichever copy matched first. Because this
  # is a v1-only reader, the three key names are reserved: a future v1 document
  # must not reuse them at any nesting depth, or already installed generations
  # stop resolving stable.
  #
  # Portability, since this runs on whatever awk the host has: no interval
  # expressions and no POSIX character classes. macOS ships BWK awk 20070501,
  # which predates its character-class support, and [[:space:]] there would
  # parse as a bracket list plus a literal ] and never match.
  stable_resolved="$(awk '
    function occurrences(text, key,   copy) {
      copy = text
      return gsub("\"" key "\"[ \t]*:", "", copy)
    }
    function value_of(text, key,   copy) {
      copy = text
      if (!match(copy, "\"" key "\"[ \t]*:[ \t]*\"[^\"]*\"")) return ""
      copy = substr(copy, RSTART, RLENGTH)
      sub("^\"" key "\"[ \t]*:[ \t]*\"", "", copy)
      sub("\"$", "", copy)
      return copy
    }
    { document = document $0 "\n" }
    END {
      for (index_of_key = 1; index_of_key <= 3; index_of_key += 1) {
        key = (index_of_key == 1 ? "schema_version" : (index_of_key == 2 ? "tag" : "sha256sums_sha256"))
        if (occurrences(document, key) != 1) exit 1
      }
      if (value_of(document, "schema_version") != "ceal.worker_stable_release.v1") exit 1
      tag = value_of(document, "tag")
      release_set = value_of(document, "sha256sums_sha256")
      if (tag !~ /^ceal-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/) exit 1
      if (length(release_set) != 64 || release_set ~ /[^a-f0-9]/) exit 1
      print tag
      print release_set
    }
  ' "$TMP_DIR/stable-release.json")" \
    || fail "Worker stable release pointer is not a valid ceal.worker_stable_release.v1 document"
  VERSION="$(printf '%s\n' "$stable_resolved" | sed -n 1p)"
  STABLE_RELEASE_SET_SHA="$(printf '%s\n' "$stable_resolved" | sed -n 2p)"
  is_tag "$VERSION" || fail "Worker stable release pointer did not resolve to a canonical ceal-v tag"
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
  asset="$1"; identity="https://github.com/corca-ai/ceal-cli/.github/workflows/$WORKFLOW_FILE@refs/tags/$VERSION"
  cosign verify-blob --certificate "$TMP_DIR/$asset.pem" --signature "$TMP_DIR/$asset.sig" \
    --certificate-identity "$identity" --certificate-oidc-issuer "$ISSUER" \
    --certificate-github-workflow-repository "corca-ai/ceal-cli" \
    --certificate-github-workflow-ref "refs/tags/$VERSION" "$TMP_DIR/$asset" >/dev/null
}

verify_checksum() {
  asset="$1"; matches="$(grep -Ec "^[a-f0-9]{64}  $asset$" "$TMP_DIR/SHA256SUMS" || true)"
  [ "$matches" = 1 ] || fail "SHA256SUMS must contain exactly one entry for $asset"
  expected="$(grep -E "^[a-f0-9]{64}  $asset$" "$TMP_DIR/SHA256SUMS" | cut -d' ' -f1)"
  [ "$expected" = "$(sha256_of "$TMP_DIR/$asset")" ] || fail "Checksum mismatch for $asset"
}

# The signed inventory may cover any subset of the supported platforms, but it
# must stay worker-only: shared assets exactly once, every named platform as a
# complete binary+manifest pair, and nothing outside the allowlist.
verify_checksum_inventory() {
  invalid="$(grep -Evc '^[a-f0-9]{64}  (THIRD_PARTY_NOTICES[.]txt|ceal-worker-release-manifest-(linux|darwin)-(amd64|arm64)[.]json|ceal-guide-SKILL[.]md|ceal-(linux|darwin)-(amd64|arm64)|install-ceal[.]sh)$' "$TMP_DIR/SHA256SUMS" || true)"
  [ "$invalid" = 0 ] || fail "SHA256SUMS contains a malformed or unexpected worker entry"
  observed="$(sed -n 's/^[a-f0-9]\{64\}  //p' "$TMP_DIR/SHA256SUMS" | sort)"
  [ -z "$(printf '%s\n' "$observed" | uniq -d)" ] || fail "SHA256SUMS contains a duplicate worker entry"
  for shared in THIRD_PARTY_NOTICES.txt ceal-guide-SKILL.md install-ceal.sh; do
    printf '%s\n' "$observed" | grep -Fqx "$shared" || fail "SHA256SUMS is missing the required worker entry $shared"
  done
  release_platforms=0
  for candidate in linux-arm64 linux-amd64 darwin-arm64 darwin-amd64; do
    has_binary=0; has_manifest=0
    printf '%s\n' "$observed" | grep -Fqx "ceal-$candidate" && has_binary=1
    printf '%s\n' "$observed" | grep -Fqx "ceal-worker-release-manifest-$candidate.json" && has_manifest=1
    [ "$has_binary" = "$has_manifest" ] || fail "SHA256SUMS names an incomplete worker platform pair for $candidate"
    release_platforms=$((release_platforms + has_binary))
  done
  [ "$release_platforms" -ge 1 ] || fail "SHA256SUMS names no worker release platform"
  [ "$(wc -l < "$TMP_DIR/SHA256SUMS" | tr -d ' ')" = "$((3 + 2 * release_platforms))" ] || fail "SHA256SUMS must contain exactly the worker-only release entries"
  printf '%s\n' "$observed" | grep -Fqx "ceal-$PLATFORM" || fail "Signed worker release does not include this platform: $PLATFORM"
  for asset in "$COMMAND_ASSET" "$MANIFEST_ASSET" THIRD_PARTY_NOTICES.txt ceal-guide-SKILL.md install-ceal.sh; do verify_checksum "$asset"; done
}

verify_manifest_guide() {
  guide_sha="$(grep -E '^[a-f0-9]{64}  ceal-guide-SKILL[.]md$' "$TMP_DIR/SHA256SUMS" | cut -d' ' -f1)"
  # These bytes are already signature-verified, so this is a shape and binding
  # check, not a trust boundary. Anchored on the generator's exact two-space
  # layout so a top-level key cannot be satisfied by its namesake nested inside
  # protocol, artifact, or native_smoke; every key must appear exactly once.
  awk -v expected_version="${VERSION#ceal-v}" -v expected_platform="$PLATFORM" -v expected_guide_sha="$guide_sha" '
    function scalar(line,   value) {
      value = line
      sub("^[ \t]*\"[^\"]+\":[ \t]*\"", "", value)
      sub("\",?$", "", value)
      return value
    }
    /^  "schema_version": "[^"]*",?$/ { schema_version = scalar($0); schema_count += 1; next }
    /^  "version": "[^"]*",?$/        { version = scalar($0); version_count += 1; next }
    /^  "platform": "[^"]*",?$/       { platform = scalar($0); platform_count += 1; next }
    /^  "command": "[^"]*",?$/        { command = scalar($0); command_count += 1; next }
    /^  "guide": \{$/                 { in_guide = 1; guide_count += 1; next }
    in_guide && /^  \},?$/            { in_guide = 0; next }
    in_guide && /^    "name": "[^"]*",?$/   { guide_name = scalar($0); guide_name_count += 1; next }
    in_guide && /^    "sha256": "[^"]*",?$/ { guide_sha = scalar($0); guide_sha_count += 1; next }
    END {
      if (schema_count != 1 || version_count != 1 || platform_count != 1) exit 1
      if (command_count != 1 || guide_count != 1) exit 1
      if (guide_name_count != 1 || guide_sha_count != 1) exit 1
      if (schema_version != "ceal.worker_release_manifest.v1") exit 1
      if (version != expected_version || platform != expected_platform) exit 1
      if (command != "ceal") exit 1
      if (guide_name != "ceal-guide-SKILL.md" || guide_sha != expected_guide_sha) exit 1
    }
  ' "$TMP_DIR/$MANIFEST_ASSET" \
    || fail "Selected guide does not match the signed worker platform manifest"
}

verify_version_output() {
  binary="$1"; stdout_path="$TMP_DIR/ceal-version.yaml"; stderr_path="$TMP_DIR/ceal-version.stderr"; expected_path="$TMP_DIR/ceal-version.expected.yaml" # retained for older callers
  "$binary" version >"$stdout_path" 2>"$stderr_path" || fail "ceal version probe failed"
  [ ! -s "$stderr_path" ] || fail "ceal version probe wrote unexpected stderr"
  # Check the fields this installer actually depends on, not the whole document.
  # A byte comparison made `ceal version` unextendable: the installer that runs
  # during `ceal update` is the *installed* generation's, so any added line broke
  # every existing client's upgrade path rather than the new release.
  grep -qx "schema_version: ceal.version.v1" "$stdout_path" || fail "ceal reported an invalid version YAML document for $VERSION"
  grep -qx "command: ceal" "$stdout_path" || fail "ceal reported an invalid version YAML document for $VERSION"
  grep -qx "version: ${VERSION#ceal-v}" "$stdout_path" || fail "ceal reported an invalid version YAML document for $VERSION"
  grep -qx "protocol_version: 1.3.0" "$stdout_path" || fail "ceal reported an invalid version YAML document for $VERSION"
  grep -qx "credential_context: gateway_issued_client_session" "$stdout_path" || fail "ceal reported an invalid version YAML document for $VERSION"
}

download_signed_asset() { asset="$1"; download_asset "$asset"; download_asset "$asset.sig"; download_asset "$asset.pem"; }
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

# flock self-releases on crash but does not exist on macOS; the fallback mkdir
# lock is atomic everywhere and reports the exact stale path to remove.
acquire_install_lock() {
  if command -v flock >/dev/null 2>&1; then
    if [ -e "$LOCK_PATH" ] || [ -L "$LOCK_PATH" ]; then [ ! -L "$LOCK_PATH" ] && [ -f "$LOCK_PATH" ] || fail "Ceal worker install lock is unsafe; remove it only after confirming no installation is active"
    else (umask 077; : > "$LOCK_PATH") || fail "Could not create Ceal worker install lock"; fi
    exec 9<>"$LOCK_PATH" || fail "Could not open Ceal worker install lock"
    flock -n 9 || { exec 9>&-; fail "Another Ceal worker installation is active"; }
    LOCK_HELD=1
  else
    LOCK_DIR="$LOCK_PATH.d"
    mkdir "$LOCK_DIR" 2>/dev/null || fail "Another Ceal worker installation is active; if none is, remove the stale lock directory $LOCK_DIR"
    LOCK_HELD=2
  fi
}
release_install_lock() {
  case "$LOCK_HELD" in
    1) flock -u 9 2>/dev/null || true; exec 9>&- ;;
    2) rmdir "$LOCK_DIR" 2>/dev/null || true ;;
    *) return 0 ;;
  esac
  LOCK_HELD=0
}

cleanup() {
  status=$?; trap - EXIT HUP INT TERM
  if [ "$COMMITTED" != 1 ]; then
    if [ "$CURRENT_SWITCHED" = 1 ]; then if [ -n "$PREVIOUS_CURRENT" ]; then replace_link "$PREVIOUS_CURRENT" "$CURRENT_LINK"; else rm -f "$CURRENT_LINK"; fi; fi
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
probe_mv_t
bootstrap_cosign
need_sha256
for tool in awk cmp curl cosign cut grep sed sort tr uniq wc uname mktemp readlink; do need "$tool"; done
if [ "$VERSION" = stable ]; then resolve_stable_release; fi
if [ -n "${CEAL_MINIMUM_VERSION:-}" ]; then
  printf '%s\n' "$CEAL_MINIMUM_VERSION" | grep -Eq '^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$' || fail "CEAL_MINIMUM_VERSION must be a semantic version when stable update is requested"
  version_is_older "$VERSION" "$CEAL_MINIMUM_VERSION" && fail "Latest stable Ceal worker release is older than the installed worker release"
fi
BASE_URL="$WORKER_RELEASE_ORIGIN/$VERSION"
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
[ -z "$STABLE_RELEASE_SET_SHA" ] || [ "$(sha256_of "$TMP_DIR/SHA256SUMS")" = "$STABLE_RELEASE_SET_SHA" ] || fail "Stable release pointer does not match the downloaded signed SHA256SUMS"
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
replace_link "releases/$GENERATION_ID" "$CURRENT_LINK"; CURRENT_SWITCHED=1
if [ "$TARGET_NEEDS_LINK_UPDATE" = 1 ]; then TARGET_MUTATED=1; rm -f "$COMMAND_TARGET"; ln -s "$COMMAND_LINK_TARGET" "$COMMAND_TARGET"; fi
verify_version_output "$COMMAND_TARGET"; COMMITTED=1
printf 'Installed ceal %s (%s) as worker at %s\n' "$VERSION" "$PLATFORM" "$INSTALL_DIR"
printf 'Signed guide staged at %s; register it through the selected agent runtime (it is not auto-loaded).\n' "$GENERATION_DIR/guide/SKILL.md"
