# Worker Release Version Fixture Debug
Date: 2026-07-24

## Problem

`ceal-v0.65.2` did not publish: the Linux amd64 release job failed its source
test before assembly, signing, R2 upload, or stable-pointer mutation with
`Worker artifact version must match the isolated worker package.`

## Correct Behavior

Given a worker version bump, when the amd64 real-native artifact proof runs,
then its requested version must equal the current worker package version and
the release job may proceed to its immutable-publication stages.

## Observed Facts

- GitHub Actions run `30133361438`, job `89612237072`, failed only test
  `test/build-worker-release-artifact.test.mjs:111`.
- The test requested `0.65.1` at line 123 while the isolated package from the
  `0.65.2` tag reports `0.65.2`.
- `requireWorkerSource` deliberately rejects this mismatch in
  `scripts/build-worker-release-artifact.mjs:117`.
- The same test is skipped on this ARM host, so the local full gate could not
  execute that AMD64-only integration path.

## Reproduction

- Authoritative reproduction: failed amd64 Actions job `89612237072` for the
  immutable tag `ceal-v0.65.2`; it reaches the real packed-consumer test and
  returns `version_mismatch` before any external publication.

## Candidate Causes

- The real-native test fixture retained the previous literal release version.
- The test had no shared source of truth for the worker package version.
- The local ARM gate skipped the architecture-specific test, hiding the stale
  literal until the amd64 release runner executed it.

## Hypothesis

- The stale literal is the cause: deriving the integration-test request from
  `packages/ceal-worker-cli/package.json` will make it match the isolated
  package after any future worker version bump. | disconfirmer: the amended
  amd64 release tag still returns `version_mismatch` from this test.

## Verification

- Confirmed by the failed job's exact error and the source comparison above.
- Replacement Actions run `30133762847` completed on `ceal-v0.65.3`: its amd64
  build job `89613434670`, assembly job `89613728899`, and signed R2 publication
  job `89613772651` all passed.
- Final-consumer proof: the public stable pointer selects `ceal-v0.65.3`
  (`SHA256SUMS` digest
  `c5392bb8b46c5f131334de47d412d6f844bd1ec414cc39580b62567385966cd4`), and a
  fresh temporary Linux arm64 installation verified all signed assets, reported
  `ceal version` `0.65.3`, then completed option-free `ceal update` unchanged
  in 13,518 ms. The end-to-end command took 27 seconds.

## Root Cause

The architecture-specific integration fixture encoded a release version that
must equal a source-owned manifest but was not derived from that manifest. The
structural cause is a missing source-of-truth invariant in the fixture.

## Invariant Proof

- Invariant: when the worker package emits its version, the real-native test
  must request that same version before the release workflow can claim a
  publishable artifact.
- Producer Proof: `packages/ceal-worker-cli/package.json` is the isolated
  package version checked by `requireWorkerSource`.
- Final-Consumer Proof: Actions run `30133762847` passed the replacement amd64
  tag job, published the signed static asset set, advanced the stable pointer,
  and a fresh public installer/update readback consumed that set.
- Interface-Shape Sibling Scan: searched explicit `version: "0.65.*"` release
  fixtures and all `buildWorkerReleaseArtifact` call sites.
- Non-Claims: no artifact, static object, stable pointer, installation, or
  Gateway action was produced by the failed `ceal-v0.65.2` tag.

## Detection Gap

- `test/build-worker-release-artifact.test.mjs:111` | ARM local check skips the
  amd64-only proof | derive its requested version from the worker manifest so a
  future version bump cannot leave a separate literal behind.
- GitHub release build | correctly stopped before publication | no change;
  this is the required final architecture-specific gate.

## Sibling Search

- Mental model: a versioned integration fixture may safely duplicate a package
  version that production code treats as exact.
- same layer: `test/build-worker-release-artifact.test.mjs:123` | decision:
  same bug, fix now | proof: failed amd64 job plus static source.
- abstraction up: explicit `0.65.*` values in stable-update and negative tests
  are historical fixture inputs, not expected to match the live package |
  decision: intentional plain-text or non-rendering boundary | proof: static
  scan.
- cross-file: `scripts/build-worker-release-artifact.mjs:117` | decision:
  same class, diagnostic-only for this slice | proof: static source; its exact
  guard is correct and must remain.

## Seam Risk

- Interrupt ID: release-amd64-version-fixture
- Risk Class: external-seam
- Seam: local ARM test selection to GitHub amd64 release gate
- Disproving Observation: the source-derived fixture passed the replacement
  amd64 tag in Actions run `30133762847`.
- What Local Reasoning Cannot Prove: this release proof does not prove Gateway
  connection, enrollment, an agent runtime, or a provider action.
- Generalization Pressure: monitor

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-07-24-release-amd64-version-fixture.md

## Prevention

Derive the requested version from the worker package manifest, retain the amd64
release gate, and use the immutable tag workflow as the final architecture
proof. `ceal-v0.65.3` is the successful replacement; `ceal-v0.65.2` remains a
failed, unpublished tag.
