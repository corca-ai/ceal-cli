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
- Pending final-consumer proof: a new immutable amd64 release tag must complete
  the test and publish the signed static asset set.

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
- Final-Consumer Proof: pending a successful amd64 tag job; the failed job
  already proves that its build gate consumes the mismatch.
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
- Disproving Observation: the source-derived fixture passes the new amd64 tag.
- What Local Reasoning Cannot Prove: GitHub runner execution and R2 publication.
- Generalization Pressure: monitor

## Interrupt Decision

- Resolution: open
- Critique Required: yes
- Next Step: spec
- Handoff Artifact: charness-artifacts/spec/2026-07-24-release-amd64-version-fixture.md

## Prevention

Replace the stale literal with the worker package manifest version, retain the
amd64 release gate, and record the successful replacement tag before closing.
