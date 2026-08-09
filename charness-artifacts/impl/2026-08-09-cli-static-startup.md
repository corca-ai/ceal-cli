# CLI Static Startup

## Current Slice

Keep command discovery and help on a lightweight startup path that does not
initialize or import session, Gateway, receipt, observer, update, audit, or
private-worker runtimes.

## User Capability

An agent or operator can inspect `ceal`, descend through command help, list the
machine-readable command inventory, read the installed version, and receive an
unknown-command refusal without paying for unrelated stateful subsystems.

## Fixed Decisions

- The command and subcommand declarations remain the single source for both the
  lightweight surface and the full dispatcher.
- The package entrypoint asks the lightweight surface first. Only an unhandled
  stateful command imports and constructs the full runtime.
- Static output and exit codes remain byte-compatible with the full dispatcher.
- The native artifact continues to bundle one entrypoint; no second executable
  or alternate command registry is introduced.

## Acceptance Checks

- Direct `runCealCommand` tests and packaged-bin help/command tests return the
  same output and exit codes.
- A regression fixture proves a static invocation does not evaluate the full
  runtime module.
- The standing startup probe is re-run after a build:
  `python3 /home/ubuntu/.codex/plugins/cache/local/charness/4.0.0/skills/quality/scripts/measure_startup_probes.py --detail`
- Repository iteration gate: `npm run check:unit`.

## Deferred Decisions

- macOS installed-worker proof remains post-release by operator decision.
- Stateful command network latency and Gateway-controlled adoption pacing are
  separate slices; this one removes only local bootstrap work that those routes
  do not need.

## Non-Claims

- Startup measurements on this checkout are local source/build evidence, not
  released-binary proof.
- This slice does not claim a live Gateway or provider readback.

## Verification

- `npm run check:unit`
- `python3 /home/ubuntu/.codex/plugins/cache/local/charness/4.0.0/skills/quality/scripts/measure_startup_probes.py --detail`
- The release builder's esbuild CJS mode produced help and version output
  byte-identical to the package dist entrypoint in a disposable local bundle.
- Fresh-eye review found that the first bootstrap used an independent private
  argv prefix and that its marker fixture covered only top-level help. Exact
  entrypoint argv now comes from the generated, source-verified contract
  modules, and the fixture covers representative static routes plus positive
  controls for both lazy runtime boundaries. Re-review found no remaining
  act-before-commit issue.
