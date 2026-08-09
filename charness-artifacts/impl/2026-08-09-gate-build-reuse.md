# Gate Build Reuse

## Current Slice

Make the worker gates reuse the workspace `dist` build they already produced,
then make unchanged workspace builds incremental without editing the frozen
protocol package.

## Fixed Decisions

- `test/repo-build.mjs` remains the single owner for writing shared workspace
  `dist` trees.
- Package-local `pretest` and `precoverage` keep standalone commands safe by
  entering that owner.
- Root coverage runs after `build:worker`, so it suppresses package lifecycle
  hooks instead of asking a second process to prove the same build is fresh.
- Incremental build info lives under gitignored `node_modules/.cache` and is
  invalidated when `dist` is absent.
- `packages/ceal-protocol` source and manifest remain untouched.

## Deferred Decisions

- No release or package version changes belong to this slice.
- Historical timing samples remain historical; the quality adapter derives its
  initial bars from the recorded host window.

## Acceptance Checks

- Contract tests prove the root gate bypasses redundant lifecycle builds and
  package-local hooks still route through the shared owner.
- A repeated `npm run build:worker` leaves the `dist` digest unchanged.
- `npm run check:unit` and the final `npm run check` pass.
- Runtime-budget rendering no longer reports missing budgets for the measured
  host profile.
