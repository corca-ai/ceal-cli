# Quality Review
Date: 2026-08-19
Title: Worker temporary TypeScript fixture compiler scope

## Scope

Target boundary: the temporary `tsconfig.json` written by `test/artifact-workspace.ts`
for isolated package artifacts, and the four tests that consume it. Production
typecheck configurations and diagnostic baselines are explicitly out of scope.

Ambient repo findings: `rg -l 'compilerOptions' --glob '*.test.ts' --glob '*.test.mjs' .`
found only contract readers; the actual temporary compiler producer was found by
tracing `compile()` into `test/client-artifact.test.ts`.

## Surface Contract Review

- semantic coverage: `partial` — temporary artifact compilation and its test proof were
  read end to end; no user-facing or release surface was changed.
- surface: isolated Worker package artifact compilation and the client-artifact tests.
- owner: `test/artifact-workspace.ts` owns fixture config creation; `test/client-artifact.test.ts`
  owns the four retained-path assertions; package build configs remain production owners.
- projections: temporary `tsconfig.json`, emitted isolated `dist`, and ABI/export assertions.
- state scope: one `mkdtempSync` artifact root per compile; checkout `dist` is not used.
- transitions: package build config is extended, constrained `tsc -p` runs, and the artifact
  assertions observe either a green compile/test or a failed compiler invocation.
- proof boundary: raw Worker tools typecheck, four artifact tests, diff check, and one
  before/after wall-clock sample; no compiler-phase-only benchmark.
- unexamined axes: repeated timing distribution, other Node/OS versions, DOM-dependent
  fixtures, and full CI/release behavior.

## Current Gates

- `npm run lint:types:raw:tools`: passed after the fixture change.
- `node --test test/client-artifact.test.ts`: passed, 4/4; the test duration was 1107 ms.
- `git diff --check`: passed.
- production typecheck and ratchet/baseline regeneration: intentionally not run or changed.

## Runtime Signals

- runtime source: `/usr/bin/time -p` around `node --test test/client-artifact.test.ts`;
  structured timing capture is missing for this narrow slice.
- runtime hot spots: no structured hot-spot ranking; the one-off before/after observation
  is recorded below and is not a stable runtime claim.
- coverage gate: the retained artifact test and raw tools typecheck passed; no coverage
  floor was relevant to this fixture-only change.
- evaluator depth: deterministic local gates plus bounded fresh-eye review; no live or
  release evaluator was applicable.

## Healthy

- The temporary program now selects `lib: ["ES2022"]`, `types: ["node"]`, and
  `skipLibCheck: true` while retaining the existing Node `typeRoots` and optional paths.
- The production `tsconfig.build.json` path was not modified, so dependency declaration
  checking remains enabled at its existing production boundary.
- All four retained-path artifact tests remain green.

## Weak

- The timing evidence is a single end-to-end sample and cannot claim a stable compiler-only
  speedup or a CI-wide percentage.
- The one-off observation was `real 1.27 s` before versus `1.16 s` after, with the test
  duration about `1241 ms` versus `1107 ms` (`command: /usr/bin/time -p ...`).
- `skipLibCheck` does not make source `.ts` diagnostics disappear; this slice narrows the
  fixture class while preserving source checking.

## Missing

- A repeated benchmark that separates temporary `tsc` startup/program creation from artifact
  assertions is not present.
- No proof was run for browser/DOM or non-Node ambient-type fixture classes.

## Deferred

- A phase-level benchmark is deferred until timing becomes an acceptance criterion because
  the current end-to-end signal is sufficient to justify the narrow config boundary.
- Other temporary compiler producers and sibling repositories are covered by the paired
  Agent review, not by this Worker artifact alone.

## Advisory

- structural review result (`command: rg -n 'compilerOptions|tsconfig' test scripts package.json`):
  only the traced artifact helper needed this performance boundary; production configs were
  left untouched.
- prose review result (`command: rg -n 'lib|skipLibCheck|types' test/artifact-workspace.ts`):
  the comment and options now describe an ES2022+Node fixture without claiming that Node
  ambient types are absent.
- runtime economics (`command: /usr/bin/time -p node --test test/client-artifact.test.ts`):
  the directional improvement is useful evidence, but its scope is explicitly end to end.

## Delegated Review

- Delegated Review: executed — three parent-delegated reviewers covered fixture boundary,
  runtime economics, and type portability; a separate counterweight found no Act Before Ship
  blocker. The round-2 reviewer confirmed the Worker config is a real temporary `tsc -p`
  input and recommended only the more precise comment, which was applied.
- Fresh-Eye Satisfaction: parent-delegated; both round-2 reviewer-boundary verifications
  returned `ok: true`, `verdict: clean`, and `drift: []`.
- Slow-gate lenses: `fixture-economics`, `parallel-critical-path`, and `duplicated-proof`
  were considered; no additional broad gate was justified for this fixture slice.

## Commands Run

- `npm run lint:types:raw:tools`
- `node --test test/client-artifact.test.ts`
- `/usr/bin/time -p node --test test/client-artifact.test.ts` before and after the patch
- `git diff --check`
- `reviewer_boundary_fingerprint.py verify` for the round-2 Worker snapshot

## Recommended Next Quality Moves

- active continue the goal's Lane D1 raw compiler-route proof — capability_needed=compiler
  enforcement; next_center=the remaining ratchet consumer; transformation=port and falsify
  the raw gate before deletion; proof_boundary=raw compiler plus mutation-red/restore-green;
  enforcement_posture=existing compiler gate.
- passive add a phase-level repeated benchmark until the performance claim becomes an
  acceptance criterion because the current one-sample end-to-end signal cannot support it.

## History

- [Previous Worker quality review](history/2026-07-26-quality-review.md)
