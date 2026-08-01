# macOS Protocol Handoff Fixture Debug
Date: 2026-08-01

## Problem

`check-native` failed before the worker release could be tagged: the two
protocol-handoff archive fixture tests reported `invalid_protocol_handoff_archive`.

## Correct Behavior

Given macOS supplies `/var` as an alias, when the test creates a regular
temporary archive, then the positive fixture reaches archive validation; a
real symlinked archive path remains refused.

## Observed Facts

- GitHub job `91361004987` failed only on macOS.
- Its log names `/var → /private/var` ancestry as the failing condition.
- The fixture uses `mkdtempSync(path.join(tmpdir(), ...))` without `realpathSync`.
- Neighboring release fixtures canonicalize their temporary roots.

## Reproduction

- macOS CI job `91361004987`, test 92: a valid archive at the fixture root is
  rejected before archive bytes are inspected.

## Candidate Causes

- macOS temporary-root alias is mistaken for an attacker-controlled symlink.
- The fixture archive itself is unexpectedly symlinked.
- The lock/manifest is malformed before archive validation.

## Hypothesis

- The fixture root alias is the cause; canonicalizing its root will let the
  same regular archive reach the existing lock and manifest checks. | disconfirmer:
  inspect the CI stack and fixture construction.

## Verification

- confirmed — CI stack fails in `assertNoSymlinkAncestor` before archive
  inspection, and the fixture has the sole noncanonical temporary root.

## Root Cause

The test fixture handed the validator a macOS alias path; the production
validator correctly treats every symlink ancestor as unsafe.

## Invariant Proof

- Invariant: when the fixture supplies a regular handoff archive, the validator
  must see its canonical test root before evaluating archive bytes; a
  caller-supplied symbolic-link ancestor remains rejected.
- Producer Proof: `archiveFixture` creates the path under `tmpdir()`.
- Final-Consumer Proof: `consumeLockedGatewayProtocolHandoffArchive` rejects it
  in `assertNoSymlinkAncestor` before parsing the archive.
- Focused Security Proof: the archive validator test now passes the exact
  archive through a directory symlink and expects
  `invalid_protocol_handoff_archive`.
- Interface-Shape Sibling Scan: temporary release fixtures that pass paths to
  strict output/input guards already use `realpathSync(mkdtempSync(...))`.
- Non-Claims: this does not prove a production user path should permit `/var`.

## Detection Gap

- Linux-only local gate | Linux `/tmp` has no alias | macOS CI exposed it; use
  the canonical fixture idiom shared by cross-platform fixtures.

## Sibling Search

- Mental model: a temporary directory is always a canonical directory.
- same layer: `test/worker-release-package-fixture.mjs` | decision: reuse its
  canonical-root idiom | proof: source reading.
- production: `scripts/worker-gateway-protocol-handoff-archive.mjs` | decision:
  preserve strict refusal | proof: it is the final security consumer.
- cross-file: `test/gateway-protocol-fixture.mjs` | decision: no change; already
  canonicalizes | proof: source reading.

## Seam Risk

- Interrupt ID: macos-temp-alias-protocol-handoff-fixture
- Risk Class: external-seam
- Seam: macOS temporary-directory alias to strict path-security validator
- Disproving Observation: CI stack reaches `assertNoSymlinkAncestor` before archive parsing
- What Local Reasoning Cannot Prove: the macOS rerun until the next CI result
- Generalization Pressure: monitor

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: impl
- Handoff Artifact: charness-artifacts/spec/2026-08-01-macos-canonical-temp-handoff-fixture.md

## Prevention

Use canonical temporary roots in cross-platform fixtures that pass paths to
strict anti-symlink guards; retain the guard itself.
