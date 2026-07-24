# Worker Static-Origin Install/Update Move

Status: in progress (contract first; closeout ledger appended at slice end).
Source handoff: `corca-ai/ceal` `docs/handoff.md` Next Session item 4 — move
worker install/update to its own static-origin prefix; do not use Gateway
`releases/gateway/` or edit a Gateway copy.

## Current Slice

Move worker `ceal` install/update distribution resolution off the GitHub
release API onto the worker-owned static-origin prefix
`https://ceal.borca.ai/releases/worker/`, so an anonymous customer can install
and `ceal update` without repository credentials once an operator publishes a
release there.

## Fixed Decisions

1. Worker-owned prefix is `https://ceal.borca.ai/releases/worker/`. The shared
   delivery hostname does not imply shared ownership; the worker never reads
   or writes Gateway `releases/gateway/`.
2. Versioned immutable layout: `releases/worker/<tag>/<asset>` holds exactly
   the signed release inventory (`ceal-<platform>`, per-platform manifest,
   guide, notices, `install-ceal.sh`, `SHA256SUMS`, each with `.sig`/`.pem`).
3. Stable lane: `releases/worker/stable/ceal-worker-stable-release.json` with
   schema `ceal.worker_stable_release.v1`, fields `tag` (exact `ceal-vX.Y.Z`)
   and `sha256sums_sha256` (SHA-256 of that tag's `SHA256SUMS`). The installer
   validates the schema, the tag grammar, and — after downloading and
   signature-verifying the release set — that the downloaded `SHA256SUMS`
   digest equals the pointer digest. Promotion also rotates
   `releases/worker/stable/install-ceal.sh`, a byte-identical copy of the
   stable tag's signed installer, as the anonymous bootstrap entrypoint; the
   bootstrap copy is convenience only, since the installer re-downloads and
   signature-verifies `install-ceal.sh` from the versioned prefix.
   A stable-resolved run ignores `CEAL_GITHUB_TOKEN` entirely and always
   downloads from the static origin.
4. Signature trust is unchanged: every asset is still verified against the
   cosign keyless OIDC identity `ceal-release.yml@refs/tags/<tag>` regardless
   of download origin. The stable pointer can only select among genuinely
   signed worker releases and binds the exact release set bytes.
5. Static-origin fetches are always plain anonymous `curl`; the
   `CEAL_GITHUB_TOKEN` bearer header must never be sent to the static origin.
6. The authenticated GitHub API lane remains only for maintainers verifying a
   private prerelease with an explicit tag before promotion. Stable
   resolution always uses the static origin.
7. Publication machinery is out of this slice: populating
   `releases/worker/` and writing the stable pointer are separate operator
   release actions. Until the first publication, a 404 from the prefix is the
   honest expected state (same pre-publication state as the Gateway-owned
   `cealctl` stable manifest).

## Deferred Decisions

- Signing or transparency-logging the stable pointer itself (an operator
  edit, not a tag workflow output); downgrade of a fresh install by a
  tampered pointer is bounded to older genuinely-signed releases and update
  downgrade stays blocked by `CEAL_MINIMUM_VERSION`.
- The operator publish helper/command for uploading a release set and
  rotating the stable pointer (needs distribution credentials; belongs to the
  next release action, not this source slice).

## Acceptance Checks

- Installer tests: stable resolves through the static-origin pointer with no
  GitHub API call; malformed pointer (schema/tag/digest grammar) is rejected
  before any install mutation; a pointer digest that does not match the
  downloaded `SHA256SUMS` is rejected; anonymous asset downloads hit
  `releases/worker/<tag>/` without an Authorization header; with a token set,
  the stable pointer fetch still carries no Authorization header while
  explicit-tag private downloads keep the authenticated API lane.
- Existing failure-mode and platform tests keep passing.
- `npm run check` clean.
- Truth surfaces synced: README install section, installer comments, release
  workflow promotion comment.
