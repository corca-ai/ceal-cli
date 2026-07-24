# Worker version independence and the ceal-v0.65.1 release inputs

Status: current implementation contract, 2026-07-24.
Upstream frame: the ceal handoff authorizes a worker-only `ceal-v0.65.1`
release reusing the signed `gateway-handoff-v0.65.0` archive while the exact
protocol/client artifact digests stay its pinned Gateway inputs; the earlier
"stays 0.65.0" decision explicitly deferred version independence to this
moment. The v2 receipt timing source contract is already on `main` and must
ship in a signed installed worker before the Stage 3 v2 packet.

## Capability Contract

The worker lane can cut a worker-only release whose version moves
independently of the pinned Gateway protocol artifact: worker and client
version together (0.65.1), the protocol dependency stays an exact 0.65.0 pin
matching the supplied archive artifact, and the frozen compatibility packages
and legacy dual-lane contract remain untouched at 0.65.0.

## Fixed Decisions

- Worker-owned versions move together: root `package.json`, `@corca-ai/ceal`,
  and `@corca-ai/ceal-worker-cli` become `0.65.1`; `@corca-ai/ceal-worker-cli`
  depends on `@corca-ai/ceal@0.65.1`.
- Frozen compatibility packages stay `0.65.0`: `@corca-ai/ceal-protocol` and
  `@corca-ai/ceal-operator-cli` are not bumped, executed, or amended.
- The exact protocol pin is the compatibility contract: worker and client keep
  `"@corca-ai/ceal-protocol": "0.65.0"` and the existing
  `protocol_version_mismatch` checks keep enforcing pin == supplied artifact.
- `resolveVersion` in the worker package and native builders requires
  worker == client only; the protocol artifact version is recorded evidence,
  not a required equal. The `version_mismatch` message changes accordingly.
- Hardcoded client-identification versions (`CEAL_PACKAGE_VERSION`, the
  enrollment/session `client.version` strings) move to `0.65.1`; a drift test
  pins each constant to its package manifest version.
- `release-contract.json` is frozen legacy material and is not amended; its
  test re-scopes version binding to the frozen packages it still governs, and
  the legacy `build-platform-binaries` proof binds the frozen operator lane
  without asserting current worker-owned versions.
- `gateway-handoff-lock.json` is unchanged; no new Gateway archive is needed.
- CHANGELOG gains the 0.65.1 worker entry (v2 receipt timing + Workbench).

## Probe Questions

- Which tests encode the old three-way equality? Enumerate via `npm run check`
  and re-model each honestly rather than loosening assertions blindly.

## Deferred Decisions

- npm registry publication; darwin CI; deleting the legacy dual lane (Stage 5
  ledger gates); deriving version constants at build time.

## Non-Goals

- No legacy `release:binaries`/`release:manifest` execution or amendment; no
  protocol/operator source change; no tag/publication inside this slice.

## Gate Debt

- The linux-amd64 `npm run check` at tag time builds a real SEA artifact four
  times (worker-native test, real-consumer artifact test, the worker-lane
  install/update test, and the CI compose determinism pair). Necessary while
  each proves a distinct seam; revisit if a shared fixture artifact becomes
  safe to reuse. The arm64 job proves native smoke adaptively but exercises
  the installer integration only with stub binaries.

## Acceptance Checks

- `release:worker:inputs`, `release:worker:package`, and
  `release:worker:native` succeed locally against the locked archive with
  worker/client at 0.65.1 and report the pinned protocol 0.65.0 identity.
- Version-drift unit test binds constants to manifests; `npm run check` clean.
- The isolated packed consumer proves the worker resolves only the supplied
  protocol artifact (no workspace/link fallback).
