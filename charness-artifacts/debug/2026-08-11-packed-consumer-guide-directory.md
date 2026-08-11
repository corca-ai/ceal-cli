# Packed Consumer Guide Directory Debug

Date: 2026-08-11

## Problem

The packed Gateway Protocol consumer failed before installation because it
passed `skills/ceal-guide` to a regular-file reader after the guide carrier had
become a directory.

## Correct Behavior

Every release-facing guide digest derives from the deterministic directory
bundle owned by `scripts/lib/skill-directory-bundle.mjs`.

## Observed Facts

- Native and package builders already use `createSkillDirectoryBundle`.
- The packed consumer verifier still hashed the former single-file guide path.
- The release-tier positive reached this stale sibling only after earlier
  coverage and contract phases passed.

## Reproduction

`node --test test/gateway-protocol-consumer.test.mjs` failed
`invalid_worker_release_inputs` at the guide digest read.

## Candidate Causes

- The Protocol tarball was not a regular file.
- The temporary packed artifact vanished.
- The guide carrier migration missed one release consumer.

## Hypothesis

The third cause is correct. Using the canonical directory bundler for the guide
digest should make the packed proof pass without changing Protocol inputs.

## Verification

- The verifier imports `createSkillDirectoryBundle` and maps an invalid guide
  directory to its existing typed release-input error.
- The release test compares the verifier's digest with the canonical bundle
  digest, so a future single-file regression fails.
- The complete packed consumer test passes.

## Root Cause

One concept had two representations: release builders treated the guide as a
directory bundle while the packed verifier retained the deleted file carrier.

## Invariant Proof

- Invariant: all release-facing guide identities derive from canonical bundle bytes.
- Producer Proof: `createSkillDirectoryBundle` owns ordering, modes, inventory,
  and ustar bytes.
- Final-Consumer Proof: packed consumer result records that bundle's digest.
- Interface-Shape Sibling Scan: native and package builders already consume the
  same owner; installer verifies the resulting archive.
- Non-Claims: no signed bundle, release, install, or live Gateway was proved.

## Detection Gap

The iteration tier does not run this real packed-consumer release test. The
final release tier correctly exposed the missed sibling.

## Sibling Search

- same layer: packed consumer | repaired to use directory bundler.
- abstraction up: worker release inventory | already names the guide directory.
- specialization down: native/package builders | already correct.
- cross-file: installer | consumes the resulting archive, not source files.

## Seam Risk

- Interrupt ID: packed-consumer-guide-directory
- Risk Class: release-seam
- Seam: source skill directory to packed-consumer release evidence.
- Disproving Observation: any release consumer hashes `SKILL.md` or a directory
  path independently of the canonical bundle.
- What Local Reasoning Cannot Prove: signed release archive identity.
- Generalization Pressure: factor-now

## Interrupt Decision

- Resolution: resolved
- Critique Required: yes
- Next Step: implementation proof
- Handoff Artifact: docs/handoff.md

## Prevention

When a carrier changes shape, search every release consumer and make each derive
from the carrier's canonical byte owner rather than reproducing its old shape.
