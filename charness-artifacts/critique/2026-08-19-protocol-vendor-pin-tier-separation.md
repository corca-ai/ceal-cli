# Protocol Vendor-Pin Tier Separation Critique

Date: 2026-08-19

## Decision Under Review

Separate repository-binding Protocol vendor-pin assertions from the ordinary
Worker contract/unit iteration lane. Keep injected validator and error-branch
fixtures in `test/contract/`; put assertions that read the real checkout,
Git tree/index, pin, lock, or tracked helper blob in the root release tier.

Success means `npm run check:unit` does not execute live vendor-pin assertions,
while `npm run test:release` and the full `test:tiers` path still execute them.
The current vendored-tree mismatch remains a release-specific red proof.

Out of scope: changing `packages/ceal-protocol`, re-pinning or regenerating
the handoff, weakening the validator, changing release inputs, CI, or any
external boundary.

## Fresh-Eye Review

Fresh-Eye Satisfaction: parent-delegated. Three bounded angle reviewers and a
separate counterweight reviewer read the frozen pre-implementation source.
All four reviewer boundary fingerprints returned `ok: true`,
`verdict: clean`, and `drift: []`:

- `/tmp/vendor-pin-separation-framing.json`
- `/tmp/vendor-pin-separation-diagnostic.json`
- `/tmp/vendor-pin-separation-operations.json`
- `/tmp/vendor-pin-separation-counterweight.json`

## Findings

### Act Before Ship

- Move the four live assertions from
  `test/contract/protocol-vendor-pin.test.ts` to
  `test/protocol-vendor-pin.test.ts` so directory-owned tier execution carries
  the boundary.
- Make the remaining contract fixtures synthetic. The old fixture helper read
  the real lock at module load and the validator read the real quarantine file
  and Git tracking state for default divergence cases.
- Preserve a release-specific red proof for the current
  `e93e491a...` vendored tree versus the `cfee89e...` pin/lock tree.
- Require the live validator result to report `diverged: false`, so a matching
  vendored tree cannot hide a source-commit versus shipment-lock divergence.

### Bundle Anyway

- Update `docs/gates.md` to state that live checkout binding belongs to the
  release tier while contract tests use injected/synthetic inputs.
- Keep production `assertShippableProtocolVendorPin` calls and their source
  reachability contract unchanged.

### Over-Worry

- A new release script or third suite is unnecessary: existing directory
  ownership already maps `test/*.test.ts` to `test:release`.
- Duplicate release/acceptance protection is intentional because production
  guards must not depend on whether a test command ran.

### Valid but Defer

- Ordinary iteration no longer reports live pin drift immediately; the
  explicit `check:protocol-dev` path and release/full tier remain available.

## Acceptance Tightening

- `test:contract:built` reaches no root live vendor-pin suite.
- `test:release` reaches all four live repository-binding assertions.
- Contract fixture tests do not read the real pin, lock, Git tree/index, or
  repository quarantine file.
- No protocol source, pin, lock, baseline, or release input is changed.
