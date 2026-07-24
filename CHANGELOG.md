# Changelog

## 0.65.2 (`ceal-v0.65.2`)

- Remove GitHub Releases from the worker delivery path. The tag workflow now
  publishes and reads back the signed worker asset set through the Ceal static
  release origin, then advances a digest-bound stable pointer. The installer
  and missing-cosign bootstrap fetch only that origin; GitHub remains the
  source and tag-bound OIDC signing identity.
- Add the explicit, re-verified stable rollback workflow. It can move only the
  stable pointer after it has re-downloaded the selected versioned inventory,
  checked its hashes, and verified every OIDC signature.

## 0.65.1 (`ceal-v0.65.1`)

- Version the worker independently of the pinned Gateway Protocol artifact:
  worker and client move together to 0.65.1 while both keep the exact
  `@corca-ai/ceal-protocol@0.65.0` pin from the signed
  `gateway-handoff-v0.65.0` archive; frozen compatibility packages and the
  legacy dual-lane contract stay at 0.65.0.
- Complete the receipt event-level timing contract: strict decode accepts the
  negotiated top-level `gateway_elapsed_ms`, denied/failed receipts render
  `error_code`, `non_claims`, and `timing` with the event envelope
  authoritative over call-detail timing, and missing negotiation omits timing
  rather than rendering zero.
- Shape `ceal observe` into the Workbench first navigation: separate
  "My agent work" and "Ceal" views plus a "Privacy & retention" view backed by
  a declared-source `privacy` state section (local sources, retention bounds,
  fixed no-forwarding boundary).

## 0.65.0 (worker-only release addendum, `ceal-v0.65.0`)

- Cut the first worker-only signed release route: `ceal-release.yml` builds
  per-platform asset sets from the locked Gateway handoff archive, signs them
  keyless, and publishes a `ceal-v*` prerelease that `install-ceal.sh`
  verifies fail-closed. This lane supersedes the legacy dual `v0.65.0`
  release for worker installs; the version number stays 0.65.0 because the
  supplied Gateway Protocol artifact and the frozen release contract pin it.
- Extend the worker lane to `darwin-arm64`/`darwin-amd64`: portable installer
  (shasum/mkdir-lock/BSD-mv fallbacks, darwin cosign pins), Mach-O SEA
  ad-hoc signing in the native builder, and darwin-aware `ceal update`.
  macOS artifacts are built manually from a Mac checkout for now
  (`docs/macos-worker-runbook.md`); darwin CI runners stay disabled.
- Add loopback-only `ceal observe`: a guarded 127.0.0.1 page over cached
  session (tokens structurally redacted), capability/target catalog, install
  generation, and guide status; receipts render as `unknown` and the server
  never contacts the Gateway or a provider.

## 0.65.0

- Add option-free, stable-only `ceal update` for a verified installed worker
  release. It reuses only the staged release-signed installer, preserves the
  operator command, reports version/digest/platform/elapsed readback as YAML,
  and rejects an older resolved stable release.
- Make `ceal capabilities` concise by default (omit each capability's
  `input_contract`/`write_contract`); add `--detail` to restore the full
  contracts, keeping the catalog small on every call.
- Cache the worker discovery catalog client-side so a warm `ceal capabilities`
  skips the ~4.3s Gateway probe; harden the cache directory to owner-only 0700.
- First signed public release cut from the reproducible dual-binary lane,
  superseding the unpublished 0.64.0 local candidate.

## 0.64.0 (local candidate)

- Add separate public source packages for `ceal` and `cealctl`.
- Add native unsigned `linux-amd64` dual-binary builds for independent worker
  client acceptance while keeping the first signed release lane on
  `linux-arm64`.
- Add stdin-token, outbound-only Gateway handshake and capability discovery to
  the worker `ceal` command without adding admin authority or inbound reachability.
- Add one protocol/client compatibility and release contract.
- Replace the inherited `cealctl`-only installer and signer with one
  source-built, OIDC-signed `linux-arm64` lane that installs both commands.
- Preserve immutable source baseline
  `f458a0bce291123644c84efdbeb48d5255a74c64` for a normal additive revert.
- Record `v0.1.1` only as the observed mutable legacy `cealctl`-only
  distribution pointer, not a dual-binary rollback release.

No public source push or release has occurred for this candidate.
