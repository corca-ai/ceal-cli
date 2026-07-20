# Changelog

## 0.65.0

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
