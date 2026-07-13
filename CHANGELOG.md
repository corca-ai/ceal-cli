# Changelog

## 0.64.0 (local candidate)

- Add separate public source packages for `ceal` and `cealctl`.
- Add native unsigned `linux-amd64` dual-binary builds for independent worker
  client acceptance while keeping the first signed release lane on
  `linux-arm64`.
- Add one protocol/client compatibility and release contract.
- Replace the inherited `cealctl`-only installer and signer with one
  source-built, OIDC-signed `linux-arm64` lane that installs both commands.
- Preserve immutable source baseline
  `f458a0bce291123644c84efdbeb48d5255a74c64` for a normal additive revert.
- Record `v0.1.1` only as the observed mutable legacy `cealctl`-only
  distribution pointer, not a dual-binary rollback release.

No public source push or release has occurred for this candidate.
